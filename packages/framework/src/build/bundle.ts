/**
 * Composing a Worker bundle with esbuild (PAR-119) from a generated entry point (CORE-REQ-006,
 * CF-REQ-003). The bundle is fully self-contained, minified (so comments and source paths do
 * not survive), and resolved with the Workers export conditions.
 *
 * Two framework modules reachable from the runtime still import Node-only code at module
 * scope; the bundle replaces those imports with inert stand-ins so no Node module or Postgres
 * harness code enters a Worker bundle (DEC-PENDING-B-16-4):
 * - `sql/drivers.ts` imports PGlite (`@electric-sql/pglite`, `drizzle-orm/pglite`) for the
 *   Postgres harness, which only test processes use;
 * - `mig/framework.ts` computes the package's migrations directory with `node:url` and
 *   `import.meta.url`, which only Node callers use.
 */
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/** Modules that must never run in a Worker; their imports resolve to stand-ins that throw if used. */
const EXCLUDED: Readonly<Record<string, string>> = {
  "@electric-sql/pglite": "export const PGlite = { create: excluded };",
  "drizzle-orm/pglite": "export const drizzle = excluded;",
  "node:url": "export const fileURLToPath = (url) => String(url);",
};
const EXCLUDED_FILTER = /^(?:@electric-sql\/pglite|drizzle-orm\/pglite|node:url)$/;

const excludeNodeOnly: esbuild.Plugin = {
  name: "exclude-node-only",
  setup(build) {
    build.onResolve({ filter: EXCLUDED_FILTER }, (args) => ({ path: args.path, namespace: "excluded" }));
    build.onLoad({ filter: /.*/, namespace: "excluded" }, (args) => ({
      contents: `function excluded() { throw new Error("not available in a Worker"); }\n${EXCLUDED[args.path] ?? ""}`,
      loader: "js",
    }));
  },
};

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
    // A fixed value: the only use (mig/framework.ts) computes a path that Workers never read.
    define: { "import.meta.url": JSON.stringify("file:///worker/framework/mig/framework.js") },
    plugins: [excludeNodeOnly, frameworkSideEffectFree],
  });
  // Modules with code in the output (an import whose code is tree-shaken away contributes 0 bytes).
  const contributed = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => path),
  );
  return { modules: [...new Set(contributed)].filter((path) => !path.startsWith("excluded:")) };
}
