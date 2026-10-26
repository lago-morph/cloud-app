/**
 * `verify` (CLI-REQ-002, LOCAL-REQ-003, CHECK-REQ-006): the scripted pre-completion check.
 * Steps, in order: type checking with the app lib set; the portability rules (from this
 * package, never the app's lint configuration); the migration checker; the installed `zod`
 * version (PAR-112, check.md §2); the app's tests once per SQL dialect, each in its own
 * test-runner process. Every step runs and reports, so one run shows every problem
 * (DEC-0238); `verify` fails if any step fails or no test ran. Output holds no clock
 * times or durations, so two runs on the same app print the same text.
 */
import type { Dialect } from "../../sql/dialect.js";
import { parseOptions } from "../args.js";
import { EXIT, type Command } from "../io.js";

/** One problem found by a static step, in the shape of CHECK's diagnostics. */
export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** Rule ID, or the TypeScript error code (`TS2322`). */
  readonly rule: string;
  readonly message: string;
  /** The skill reference to read (portability and migration diagnostics). */
  readonly reference?: string;
}

export interface TestCase {
  /** App-relative test file. */
  readonly file: string;
  /** Suite names and the test name, joined with " > ". */
  readonly name: string;
  readonly state: "passed" | "failed" | "skipped";
  readonly errors: readonly string[];
}

export interface TestRun {
  readonly tests: readonly TestCase[];
  /** Files that failed to load or run outside any test. */
  readonly fileErrors: readonly { readonly file: string; readonly message: string }[];
  /** The test runner itself failed. */
  readonly error?: string;
}

export interface VerifyDeps {
  typeCheck(appDir: string): Promise<readonly Diagnostic[]>;
  /** `warn`: what the rules could not check (printed, not a problem). */
  portabilityRules(appDir: string, warn: (message: string) => void): Promise<readonly Diagnostic[]>;
  migrationChecker(appDir: string): Promise<readonly Diagnostic[]>;
  zodVersion(appDir: string): Promise<{ readonly expected: string; readonly installed: string | undefined }>;
  runTests(appDir: string, dialect: Dialect): Promise<TestRun>;
}

export const VERIFY_DIALECTS: readonly Dialect[] = ["sqlite", "postgres"];

/** One line per diagnostic, the layout of CHECK's `formatDiagnostic` (CHECK-REQ-003). */
export function formatVerifyDiagnostic(d: Diagnostic): string {
  const message = d.message.replace(/\s*\r?\n\s*/g, " ");
  const reference = d.reference === undefined ? "" : `  (read ${d.reference})`;
  return `${d.file}:${String(d.line)}:${String(d.column)}  error  ${message}  ${d.rule}${reference}`;
}

function sorted(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message));
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function indent(text: string, prefix: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `${prefix}${l}`.trimEnd())
    .join("\n");
}

/** Failing and skipped tests in file and name order, each failure's errors indented below it. */
export function formatTestRun(run: TestRun): string {
  const lines: string[] = [];
  for (const e of [...run.fileErrors].sort((a, b) => byText(a.file, b.file) || byText(a.message, b.message))) {
    lines.push(`  FAIL  ${e.file} (the file did not run)`, indent(e.message, "        "));
  }
  // Passing tests are only counted: a line naming a file reads as a problem with that file.
  const tests = run.tests.filter((t) => t.state !== "passed").sort((a, b) => byText(a.file, b.file) || byText(a.name, b.name));
  for (const t of tests) {
    lines.push(`  ${t.state === "passed" ? "pass" : t.state === "failed" ? "FAIL" : "skip"}  ${t.file} > ${t.name}`);
    for (const e of t.errors) lines.push(indent(e, "        "));
  }
  if (run.error !== undefined) lines.push(indent(run.error, "  "));
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function testCounts(run: TestRun): string {
  const count = (s: TestCase["state"]) => run.tests.filter((t) => t.state === s).length;
  return `${String(count("passed"))} passed, ${String(count("failed"))} failed, ${String(count("skipped"))} skipped`;
}

/** Why a test run fails `verify`, or undefined when it passes. */
export function testRunProblem(run: TestRun): string | undefined {
  if (run.error !== undefined) return "the test runner failed";
  const failedTests = run.tests.filter((t) => t.state === "failed").length;
  if (run.fileErrors.length > 0 || failedTests > 0) return `${String(failedTests + run.fileErrors.length)} failed`;
  if (!run.tests.some((t) => t.state === "passed")) return "no tests ran (zero tests: verify needs at least one passing test)";
  return undefined;
}

export function verifyCommand(deps: VerifyDeps): Command {
  return async (args, io) => {
    parseOptions(args, []);
    const dir = io.cwd;
    const failed: string[] = [];
    const staticStep = async (label: string, run: () => Promise<readonly Diagnostic[]>): Promise<void> => {
      io.stdout(`verify: ${label}\n`);
      const diagnostics = sorted(await run());
      for (const d of diagnostics) io.stdout(`${formatVerifyDiagnostic(d)}\n`);
      if (diagnostics.length > 0) failed.push(label);
      io.stdout(`verify: ${label}: ${diagnostics.length === 0 ? "passed" : `${String(diagnostics.length)} problem${diagnostics.length === 1 ? "" : "s"}`}\n`);
    };
    await staticStep("type checking", () => deps.typeCheck(dir));
    await staticStep("portability rules", () => deps.portabilityRules(dir, (message) => io.stdout(`verify: warning: ${message}\n`)));
    await staticStep("migration checker", () => deps.migrationChecker(dir));

    io.stdout("verify: zod version\n");
    const zod = await deps.zodVersion(dir);
    if (zod.installed === zod.expected) io.stdout(`verify: zod version: passed (${zod.expected})\n`);
    else {
      failed.push("zod version");
      io.stdout(
        zod.installed === undefined
          ? `zod is not installed; apps depend on zod at exactly ${zod.expected} (PAR-112), the version the framework re-exports\n`
          : `zod ${zod.installed} is installed; apps depend on zod at exactly ${zod.expected} (PAR-112), the version the framework re-exports\n`,
      );
    }

    for (const dialect of VERIFY_DIALECTS) {
      const label = `tests (${dialect})`;
      io.stdout(`verify: ${label}\n`);
      const run = await deps.runTests(dir, dialect);
      const text = formatTestRun(run);
      if (text !== "") io.stdout(text);
      const problem = testRunProblem(run);
      if (problem !== undefined) failed.push(label);
      io.stdout(`verify: ${label}: ${problem ?? "passed"} (${testCounts(run)})\n`);
    }
    if (failed.length > 0) {
      io.stdout(`verify failed: ${failed.join(", ")}\n`);
      return EXIT.failed;
    }
    io.stdout("verify passed\n");
    return EXIT.ok;
  };
}
