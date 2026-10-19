/**
 * Loading an app's definition at build time (CORE-REQ-002: one `defineApp` call in the entry
 * module `src/app.ts`, cli.md §2 "App layout"). The entry module is TypeScript with
 * extension-less relative imports, so it is bundled with esbuild for Node (every import from
 * outside the app — packages and the framework — stays external, so the app shares the
 * framework instance the caller runs) and imported once. Node only.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { FrameworkError } from "../core/errors.js";
import type { DefinedApp } from "../core/public.js";
import type { ConfigDeclaration } from "../config/public.js";

/** The app's entry module, relative to the app directory. */
export const APP_ENTRY = "src/app.ts";
/** Where the build writes everything (git-ignored). */
export const BUILD_DIR = ".framework";

export type AnyDefinedApp = DefinedApp<ConfigDeclaration, string>;

export interface LoadedApp {
  readonly defined: AnyDefinedApp;
  /** The export that holds the definition: `default` or `app` (DEC-PENDING-B-T1-5). */
  readonly exportName: "default" | "app";
}

function isDefinedApp(value: unknown): value is AnyDefinedApp {
  if (typeof value !== "object" || value === null) return false;
  const definition = (value as { definition?: unknown }).definition;
  return typeof definition === "object" && definition !== null && typeof (definition as { name?: unknown }).name === "string";
}

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Imports from outside the app directory stay external (absolute for paths, as written for packages). */
const externalOutsideApp = (appDir: string): esbuild.Plugin => ({
  name: "external-outside-app",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return undefined;
      const relativeOrAbsolute = args.path.startsWith(".") || isAbsolute(args.path);
      if (!relativeOrAbsolute) return { path: args.path, external: true };
      const target = resolve(args.resolveDir, args.path);
      return inside(appDir, target) ? undefined : { path: target, external: true };
    });
  },
});

export async function loadAppModule(appDir: string): Promise<LoadedApp> {
  const root = resolve(appDir);
  const entry = join(root, APP_ENTRY);
  if (!existsSync(entry)) throw new FrameworkError("CORE.MISCONFIGURED", `the app's entry module ${APP_ENTRY} was not found in ${root}`);
  const loadDir = join(root, BUILD_DIR, ".load");
  const outfile = join(loadDir, `app-${randomUUID()}.mjs`);
  mkdirSync(loadDir, { recursive: true });
  let module: Record<string, unknown>;
  try {
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [externalOutsideApp(root)],
    });
    module = (await import(pathToFileURL(outfile).href)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new FrameworkError("CORE.MISCONFIGURED", `the app's entry module ${APP_ENTRY} could not be loaded: ${detail}`);
  } finally {
    rmSync(loadDir, { recursive: true, force: true });
  }
  for (const exportName of ["default", "app"] as const) {
    if (isDefinedApp(module[exportName])) return { defined: module[exportName], exportName };
  }
  throw new FrameworkError("CORE.MISCONFIGURED", `${APP_ENTRY} must export the result of its defineApp call (as the default export, or as "app")`);
}

/** The app definition exported by `<appDir>/src/app.ts`. */
export async function loadApp(appDir: string): Promise<AnyDefinedApp> {
  return (await loadAppModule(appDir)).defined;
}
