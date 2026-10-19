/**
 * Composing a Worker bundle with esbuild (PAR-119) from a generated entry point (CORE-REQ-006,
 * CF-REQ-003). The bundle is fully self-contained, minified (so comments and source paths do
 * not survive), and resolved with the Workers export conditions. Worker runtimes import no
 * Node-only framework module (the Postgres harness is `sql/postgres.ts`, the migrations
 * directory `mig/migrations-dir.ts`), so a Node built-in reaching the bundle fails the build
 * (DEC-PENDING-B-16a-3, DEC-PENDING-B-16a-4).
 */
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/** The framework package's directory (this file is `<package>/{src,dist}/build/bundle.*`). */
const FRAMEWORK_DIR = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Framework modules have no import-time side effects, so a module only re-exported by a target
 * runtime (e.g. the authentication mock, imported only by test-stage entries) is dropped
 * entirely when the entry does not use it, not just its unused functions (CORE-REQ-006).
 */
const frameworkSideEffectFree: esbuild.Plugin = {
  name: "framework-side-effect-free",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData === "framework-side-effect-free" || !args.importer.startsWith(FRAMEWORK_DIR)) return undefined;
      if (!args.path.startsWith(".")) return undefined;
      const resolved = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: "framework-side-effect-free" });
      if (resolved.errors.length > 0 || !resolved.path.startsWith(FRAMEWORK_DIR)) return undefined;
      return { path: resolved.path, sideEffects: false };
    });
  },
};

export interface BundleResult {
  /** Every module with code in the bundle (paths as esbuild reports them). */
  readonly modules: readonly string[];
}

export async function bundleWorker(entry: string, outfile: string): Promise<BundleResult> {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    target: "es2023",
    minify: true,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    plugins: [frameworkSideEffectFree],
  });
  // Modules with code in the output (an import whose code is tree-shaken away contributes 0 bytes).
  const contributed = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => path),
  );
  return { modules: [...new Set(contributed)] };
}
