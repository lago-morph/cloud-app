/**
 * `verify` step 1 (CLI-REQ-002): type checking of every app file under `src/` and `tests/`
 * with the app lib set `APP_COMPILER_OPTIONS` (CHECK §2), never the app's `tsconfig.json`.
 * App code (`src/`) is checked in a program of its own, so the type declarations test files
 * pull in (the test runner's, which reference Node's) cannot make Node globals such as
 * `Buffer` type-check in server code; test files are checked in a second program.
 */
import { relative } from "node:path";
import ts from "typescript";
import { APP_COMPILER_OPTIONS, collectAppFiles } from "../../check/engine.js";
import type { Diagnostic } from "../commands/verify.js";

function toDiagnostics(appDir: string, program: ts.Program): Diagnostic[] {
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const rule = `TS${String(d.code)}`;
    if (d.file === undefined || d.start === undefined) return { file: "(app)", line: 0, column: 0, rule, message };
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return { file: relative(appDir, d.file.fileName).split("\\").join("/"), line: line + 1, column: character + 1, rule, message };
  });
}

export async function typeCheckApp(appDir: string): Promise<Diagnostic[]> {
  const files = await collectAppFiles(appDir);
  const isTest = (f: string) => relative(appDir, f).split("\\").join("/").startsWith("tests/");
  const groups = [files.filter((f) => !isTest(f)), files.filter(isTest)].filter((g) => g.length > 0);
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const group of groups) {
    for (const d of toDiagnostics(appDir, ts.createProgram(group, APP_COMPILER_OPTIONS))) {
      const key = `${d.file}:${String(d.line)}:${String(d.column)}:${d.rule}:${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}
