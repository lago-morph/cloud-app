/**
 * Runs the TypeScript compiler inside a test (B-T5, evaluation flag F7). Vitest does not
 * type-check, so `expectTypeOf` and `@ts-expect-error` assertions show nothing in a Vitest run
 * unless the compiler checks the file. `typeErrors` compiles the given test files with the
 * framework's own project settings (packages/framework/tsconfig.json) and returns the
 * diagnostics reported for those files, so a test can assert the compiler accepts them.
 *
 * `virtual` adds in-memory source files (absolute paths) to the same program; tests use them as
 * negative controls, showing that a wrong expectation does produce a diagnostic.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function projectOptions(): ts.CompilerOptions {
  const configPath = join(FRAMEWORK_DIR, "tsconfig.json");
  const read = ts.readConfigFile(configPath, (p) => ts.sys.readFile(p));
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, FRAMEWORK_DIR, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  }
  return { ...parsed.options, noEmit: true };
}

export interface CompilerDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly text: string;
}

export function typeErrors(files: readonly string[], virtual: Readonly<Record<string, string>> = {}): CompilerDiagnostic[] {
  const options = projectOptions();
  const host = ts.createCompilerHost(options, true);
  const virtualFiles = new Map(Object.entries(virtual).map(([p, text]) => [resolve(p), text]));
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  host.fileExists = (p) => virtualFiles.has(resolve(p)) || baseFileExists(p);
  host.readFile = (p) => virtualFiles.get(resolve(p)) ?? baseReadFile(p);
  host.getSourceFile = (p, languageVersion, onError, shouldCreate) => {
    const text = virtualFiles.get(resolve(p));
    if (text !== undefined) return ts.createSourceFile(p, text, languageVersion, true);
    return baseGetSourceFile(p, languageVersion, onError, shouldCreate);
  };
  const roots = [...files.map((f) => resolve(f)), ...virtualFiles.keys()];
  const program = ts.createProgram(roots, options, host);
  const wanted = new Set(roots);
  const out: CompilerDiagnostic[] = [];
  for (const d of [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()]) {
    out.push({ file: "<options>", line: 0, code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") });
  }
  for (const root of roots) {
    const source = program.getSourceFile(root);
    if (source === undefined) {
      out.push({ file: root, line: 0, code: 0, text: "file is not part of the program" });
      continue;
    }
    for (const d of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
      const file = d.file?.fileName ?? root;
      if (!wanted.has(resolve(file))) continue;
      const line = d.file !== undefined && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      out.push({ file, line, code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") });
    }
  }
  return out;
}

export function describeCompilerDiagnostics(errors: readonly CompilerDiagnostic[]): string {
  return errors.map((e) => `${e.file}:${String(e.line)} TS${String(e.code)}: ${e.text}`).join("\n");
}
