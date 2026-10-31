/**
 * Test support: the auth app's Worker entry (worker.ts) bundled as one ES module, as a deploy would
 * upload it, plus a tiny "app" Worker that calls the auth app over a real service binding
 * (`env.AUTH`, entrypoint `AuthApp`). Run under local workerd by Miniflare; no network.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function bundleAuthAppWorker(): Promise<string> {
  const out = await build({ entryPoints: [join(HERE, "worker.ts")], bundle: true, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers"], write: false, logLevel: "silent" });
  return out.outputFiles[0]!.text;
}

/**
 * Miniflare 5 worker definitions: `auth` (the bundle, with D1 `DB` and `settings` as text
 * bindings) first, so it receives Miniflare's own HTTP requests, and `app` (CALLER_WORKER) bound to
 * it as `AUTH` with entrypoint `AuthApp`.
 */
export function authAppMiniflareWorkers(script: string, settings: Record<string, string>) {
  const text = Object.fromEntries(Object.entries(settings).map(([k, value]) => [k, { type: "text" as const, value }]));
  const manifest = (source: string) => ({ mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: source } } });
  return [
    { config: { name: "auth", compatibilityDate: "2026-10-01", manifest: manifest(script), env: { DB: { type: "d1" as const, id: "auth-db" }, ...text } } },
    { config: { name: "app", compatibilityDate: "2026-10-01", manifest: manifest(CALLER_WORKER), env: { AUTH: { type: "worker" as const, worker: "auth", exportName: "AuthApp" } } } },
  ];
}

/** An app Worker whose `POST /redeem` and `POST /role` forward their JSON body to `env.AUTH`. */
export const CALLER_WORKER = `
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const body = await request.json();
    try {
      const result = path === "/redeem" ? await env.AUTH.redeem(body) : await env.AUTH.role(body.sub);
      return Response.json({ result });
    } catch (e) {
      return Response.json({ error: String(e && e.message) }, { status: 502 });
    }
  },
};
`;
