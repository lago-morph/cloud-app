/**
 * The bundles as uploaded run under local workerd (DEC-0720; review of PR #108): the auth app that
 * account setup uploads (A's routes answer, with its D1), and `node:crypto` as the account-setup code
 * calls it, through the same build options and `nodejs_compat`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { authAppMiniflareWorkers } from "../auth-app/worker-bundle.test-support.js";
import { ADMIN_APP_COMPATIBILITY_DATE, ADMIN_APP_COMPATIBILITY_FLAGS } from "../provision/cloudflare/admin-app-deploy.js";
import { ADMIN_APP_NODE_IMPORTS, BUNDLE_OPTIONS, bundleAuthApp } from "./bundle.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the bundles under workerd", () => {
  it("the auth app module account setup uploads serves A's routes with its D1", async () => {
    const mf = new Miniflare({
      workers: authAppMiniflareWorkers(await bundleAuthApp(), { AUTH_APP_CLIENT_ID: "c", AUTH_APP_CLIENT_SECRET: "s", AUTH_APP_ACCOUNT_ID: "a", AUTH_APP_ORIGIN: "https://prototype-auth.sub.workers.dev" }),
    });
    try {
      const r = await (await mf.getWorker("auth")).fetch("https://prototype-auth.sub.workers.dev/start");
      expect(r.status).toBe(400);
      expect(await r.text()).toContain("This sign-in link is incomplete.");
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("randomBytes (account.ts) and createHash (r2-token.ts's S3 key) run with nodejs_compat", async () => {
    const { build } = await import("esbuild");
    const entry = [
      'import { randomSubdomain } from "../provision/cloudflare/account.ts";',
      'import { createHash } from "node:crypto";',
      'export default { fetch() { return new Response(randomSubdomain() + " " + createHash("sha256").update("x").digest("hex")); } };',
    ].join("\n");
    const out = await build({ ...BUNDLE_OPTIONS, stdin: { contents: entry, resolveDir: HERE, loader: "ts" }, external: [...ADMIN_APP_NODE_IMPORTS] });
    const mf = new Miniflare({
      workers: [{ config: { name: "w", compatibilityDate: ADMIN_APP_COMPATIBILITY_DATE, compatibilityFlags: [...ADMIN_APP_COMPATIBILITY_FLAGS], manifest: { mainModule: "w.js", modules: { "w.js": { type: "esm" as const, contents: out.outputFiles[0]!.text } } } } }],
    });
    try {
      const text = await (await mf.dispatchFetch("https://w.example/")).text();
      expect(text).toMatch(/^pf-[a-z0-9]{12} 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881$/);
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});
