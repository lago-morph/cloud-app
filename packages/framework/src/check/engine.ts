/**
 * Runs the portability rules on an app (CHECK-REQ-001…003). Independent of type checking:
 * diagnostics are reported whether or not the app type-checks, so `verify` can report both
 * (DEC-0238). The rules always come from this package (CHECK-REQ-006).
 */
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { checkAppLintConfig } from "./app-config.js";
import { portabilityConfig } from "./config.js";
import { checkDependencyTree } from "./dependencies.js";
import { referenceFor } from "./references.js";

export interface CheckDiagnostic {
  /** App-relative path with `/` separators. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** Full rule ID, e.g. `prototype-framework/no-raw-sql`. */
  readonly rule: string;
  readonly message: string;
  /** The skill reference to read, e.g. `skill/reference/sql-and-migrations.md`. */
  readonly reference: string;
}

/**
 * The app lib set (CHECK §2, DEC-0115): ES plus Web APIs, no `@types/node`, no
 * `@cloudflare/workers-types`. Same options as the repository's `tsconfig.app.json`; `verify`'s
 * type check should use these too, so app-editable `tsconfig.json` cannot change them.
 */
export const APP_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  skipLibCheck: true,
  noEmit: true,
};

const APP_DIRS = ["src", "tests"];
const TS_FILE = /\.(?:ts|tsx|mts|cts)$/;

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (entry.isFile() && TS_FILE.test(entry.name)) out.push(path);
  }
}

/** Absolute paths of the app's TypeScript files under `src/` and `tests/`, sorted. */
export async function collectAppFiles(appDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of APP_DIRS) await walk(join(appDir, dir), out);
  return out.sort();
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/**
 * Lints every app file with the shipped configuration (never with the app's lint configuration),
 * reports an app lint configuration that disables or weakens a framework rule, and reports an app
 * dependency whose installed tree contains a platform SDK or database driver (DEC-0554). `warn`
 * receives what could not be checked (no npm lockfile), which is not a diagnostic.
 */
export async function runPortabilityRules(appDir: string, warn?: (message: string) => void): Promise<CheckDiagnostic[]> {
  return sortDiagnostics([...(await lintAppFiles(appDir)), ...(await checkAppLintConfig(appDir)), ...checkDependencyTree(appDir, warn)]);
}

async function lintAppFiles(appDir: string): Promise<CheckDiagnostic[]> {
  const files = await collectAppFiles(appDir);
  if (files.length === 0) return [];
  const program = ts.createProgram(files, APP_COMPILER_OPTIONS);
  const eslint = new ESLint({
    cwd: appDir,
    overrideConfigFile: true,
    allowInlineConfig: false,
    errorOnUnmatchedPattern: false,
    overrideConfig: portabilityConfig({ programs: [program] }),
  });
  const results = await eslint.lintFiles(files);
  const diagnostics: CheckDiagnostic[] = [];
  for (const result of results) {
    const file = toPosix(relative(appDir, result.filePath));
    for (const message of result.messages) {
      const rule = message.ruleId ?? "parse-error";
      diagnostics.push({
        file,
        line: message.line,
        column: message.column,
        rule,
        message: message.message,
        reference: referenceFor(message.ruleId),
      });
    }
  }
  return diagnostics;
}

export function sortDiagnostics(diagnostics: readonly CheckDiagnostic[]): CheckDiagnostic[] {
  return [...diagnostics].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
  );
}
