/**
 * Composing a Worker bundle with esbuild (PAR-119) from a generated entry point (CORE-REQ-006,
 * CF-REQ-003). The bundle is fully self-contained, minified (so comments and source paths do
 * not survive), and resolved with the Workers export conditions. Worker runtimes import no
 * Node-only framework module (the Postgres harness is `sql/postgres.ts`, the migrations
 * directory `mig/migrations-dir.ts`), so a Node built-in reaching the bundle fails the build
 * (DEC-0196, DEC-0197). `bundleLambda` composes the AWS Lambda bundle the same way, for Node 22
 * (plan-aws G-06).
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
  /** Imports left external (the bundle loads them at run time); only Node built-ins on AWS. */
  readonly externals?: readonly string[];
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
  return { modules: contributedModules(result.metafile) };
}

/** Modules with code in the output (an import whose code is tree-shaken away contributes 0 bytes). */
function contributedModules(metafile: esbuild.Metafile): string[] {
  const contributed = Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([path]) => path),
  );
  return [...new Set(contributed)];
}

/**
 * ESM output from CommonJS dependencies (the AWS SDK's `dist-cjs` fallbacks) calls `require` for
 * Node built-ins; Node's ESM scope has none, so the bundle defines it first.
 */
const LAMBDA_BANNER = 'import { createRequire as __frameworkCreateRequire } from "node:module";\nconst require = __frameworkCreateRequire(import.meta.url);';

/**
 * The AWS Lambda bundle (plan-aws G-06; aws.md §2; DEC-PENDING-g-s1-1, -2): Node 22 (PAR-272,
 * `nodejs22.x`), ESM, fully self-contained. The AWS SDK clients the runtime uses (rds-data, s3,
 * ssm) are bundled at the framework's pinned version (PAR-111), never taken from the copy in
 * the managed runtime, so nothing is external. ESM entry points of dependencies are preferred
 * (`module` before `main`), which lets esbuild drop unused SDK code. Minified without legal
 * comments, so comments and source paths do not survive (DEC-0240).
 */
export async function bundleLambda(entry: string, outfile: string): Promise<BundleResult> {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    mainFields: ["module", "main"],
    banner: { js: LAMBDA_BANNER },
    minify: true,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    plugins: [frameworkSideEffectFree],
  });
  const externals = Object.values(result.metafile.outputs).flatMap((output) => output.imports.filter((i) => i.external).map((i) => i.path));
  return { modules: contributedModules(result.metafile), externals: [...new Set(externals)] };
}
