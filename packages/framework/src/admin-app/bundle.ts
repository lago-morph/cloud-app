/**
 * The admin app as the one ES module the bootstrap uploads (DEC-0712, DEC-0720): `worker.ts` (or,
 * in the published package, `dist/admin-app/worker.js`) bundled by esbuild, a dependency of the
 * framework already used by `build`. Built when the bootstrap runs, so the upload is always this
 * framework version's admin app. Two values are compiled in:
 * - `__PF_AUTH_APP_SOURCE__`: the auth app's Worker (`auth-app/worker.ts`, its own bundle with
 *   `cloudflare:workers` external), which account setup (page 1) uploads;
 * - `__PF_FRAMEWORK_VERSION__`: this package's version, which page 1 records in the setup record.
 * `node:crypto` stays an import: page 1 reuses the framework's account-setup code (C's buckets, F's
 * signing credential), which uses it, so the Worker runs with `nodejs_compat` (admin-app-deploy.ts).
 * Node only; the Worker never imports this file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one Node built-in the admin app's bundle may import. */
export const ADMIN_APP_NODE_IMPORTS: readonly string[] = Object.freeze(["node:crypto"]);

const entry = (dir: string, name: string): string => (existsSync(join(dir, `${name}.ts`)) ? join(dir, `${name}.ts`) : join(dir, `${name}.js`));

function frameworkVersion(): string {
  const version = (JSON.parse(readFileSync(join(HERE, "..", "..", "package.json"), "utf8")) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error("the framework's package.json has no version");
  return version;
}

let cached: Promise<string> | undefined;

export function bundleAdminApp(): Promise<string> {
  cached ??= (async () => {
    const { build } = await import("esbuild");
    const common = { bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent", legalComments: "none" } as const;
    const auth = await build({ ...common, entryPoints: [entry(join(HERE, "..", "auth-app"), "worker")], external: ["cloudflare:workers"] });
    const out = await build({
      ...common,
      entryPoints: [entry(HERE, "worker")],
      external: [...ADMIN_APP_NODE_IMPORTS],
      define: { __PF_AUTH_APP_SOURCE__: JSON.stringify(auth.outputFiles[0]!.text), __PF_FRAMEWORK_VERSION__: JSON.stringify(frameworkVersion()) },
    });
    return out.outputFiles[0]!.text;
  })();
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}
