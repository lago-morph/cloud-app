/**
 * Unit-test harness for the portability rules: writes a minimal app into a temp directory and
 * runs the rule engine on it. The framework package is presented to the app as a stub package
 * whose type entry points are this checkout's sources (`src/**`), so unit tests do not depend on
 * a built `dist/`. Every other package resolves to the workspace's `node_modules`.
 * Used only by `*.unit.test.ts` files.
 */
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPortabilityRules, type CheckDiagnostic } from "./engine.js";

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_DIR = resolve(FRAMEWORK_DIR, "../..");
const PACKAGE = "@lago-morph/prototype-framework";

const SUBPATHS: Readonly<Record<string, string>> = {
  ".": "./src/index.ts",
  "./client": "./src/client/index.ts",
  "./testing": "./src/testing/index.ts",
  "./targets/local": "./src/targets/local/public.ts",
  "./targets/cloudflare": "./src/targets/cloudflare/public.ts",
  "./provision": "./src/provision/public.ts",
  "./check": "./src/check/public.ts",
};

export interface CheckApp {
  readonly dir: string;
  /** Diagnostics for every file, after writing `files` (app-relative path → content). */
  lint(): Promise<CheckDiagnostic[]>;
  write(files: Readonly<Record<string, string>>): Promise<void>;
  dispose(): Promise<void>;
}

export async function createCheckApp(files: Readonly<Record<string, string>> = {}): Promise<CheckApp> {
  const dir = await mkdtemp(join(tmpdir(), "b14-check-"));
  const modules = join(dir, "node_modules");
  await mkdir(join(modules, "@lago-morph", "prototype-framework"), { recursive: true });
  for (const entry of await readdir(join(REPO_DIR, "node_modules"))) {
    if (entry === "@lago-morph" || entry === ".bin") continue;
    await symlink(join(REPO_DIR, "node_modules", entry), join(modules, entry));
  }
  const pkg = join(modules, "@lago-morph", "prototype-framework");
  await symlink(join(FRAMEWORK_DIR, "src"), join(pkg, "src"));
  const exportsMap = Object.fromEntries(Object.entries(SUBPATHS).map(([k, v]) => [k, { types: v, default: v }]));
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: PACKAGE, version: "0.1.0", type: "module", exports: exportsMap }));
  const write = async (more: Readonly<Record<string, string>>): Promise<void> => {
    for (const [path, content] of Object.entries(more)) {
      const target = join(dir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  };
  await write(files);
  return {
    dir,
    lint: () => runPortabilityRules(dir),
    write,
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

/** The diagnostics naming one app-relative file. */
export function forFile(diagnostics: readonly CheckDiagnostic[], file: string): CheckDiagnostic[] {
  return diagnostics.filter((d) => d.file === file);
}

/** The short rule names (without plugin prefix) reported for one file. */
export function rulesFor(diagnostics: readonly CheckDiagnostic[], file: string): string[] {
  return forFile(diagnostics, file).map((d) => d.rule.replace(/^prototype-framework\//, ""));
}
