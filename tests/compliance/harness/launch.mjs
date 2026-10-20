// Runs a TypeScript entry point of the compliance harness or tools under Node: bundles it with
// esbuild (PAR-119; resolves the `.js` specifiers of TypeScript sources, which Node's type
// stripping does not) into the gitignored `.framework/compliance/`, then imports it.
// Packages stay external; only repository sources are bundled.
import { build } from "esbuild";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export async function launch(entry) {
  const outfile = join(repoRoot, ".framework", "compliance", `${basename(entry, ".ts")}.mjs`);
  await build({
    entryPoints: [resolve(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    outfile,
    logLevel: "warning",
  });
  process.env.COMPLIANCE_REPO_ROOT = repoRoot;
  await import(pathToFileURL(outfile).href);
}
