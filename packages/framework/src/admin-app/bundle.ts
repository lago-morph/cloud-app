/**
 * The admin app as the one ES module the bootstrap uploads (DEC-0712): `worker.ts` (or, in the
 * published package, `dist/admin-app/worker.js`) bundled by esbuild, a dependency of the framework
 * already used by `build`. Built when the bootstrap runs, so the upload is always this framework
 * version's admin app. Node only; the Worker never imports this file.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let cached: Promise<string> | undefined;

export function bundleAdminApp(): Promise<string> {
  cached ??= (async () => {
    const { build } = await import("esbuild");
    const source = join(HERE, "worker.ts");
    const entry = existsSync(source) ? source : join(HERE, "worker.js");
    const out = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent", legalComments: "none" });
    return out.outputFiles[0]!.text;
  })();
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}
