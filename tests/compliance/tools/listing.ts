/**
 * Lists tests the way the runners name them, without running any test body (DEC-0265): a
 * Vitest run whose name filter matches nothing collects every file and reports each test as
 * skipped with its full title (`vitest list` 5.0.5 misses suites registered after a top-level
 * `await import(...)`); Playwright uses `--list`. Titles built at run time are therefore seen
 * exactly as in a run. Used by the traceability report and by E2E-004's coverage part, which
 * lists exactly the driver's selection (harness/selection.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Target } from "../harness/catalogue.js";
import { parsePlaywrightJson, parseVitestJson } from "../harness/reports.js";
import { runnerSelection, scopeTests, type RunnerSelection } from "../harness/selection.js";

/** A test-name filter no test title matches. */
export const COLLECT_ONLY = "^COLLECT-ONLY: no test matches this$";

export interface ListedTest {
  readonly title: string;
  readonly file: string;
  /** Set when the test may evidence fewer IDs than its title carries (selection.ts `scopeTests`). */
  readonly ids?: readonly string[];
}

export interface Listing {
  readonly tests: ListedTest[];
  /** Load errors and non-zero exits: the listing may be incomplete. */
  readonly errors: string[];
}

export interface ListOptions {
  readonly root: string;
  /** The environment of the listing processes (default: this process's). */
  readonly env?: NodeJS.ProcessEnv;
}

function exec(command: string, args: readonly string[], options: ListOptions, env: NodeJS.ProcessEnv, errors: string[]): void {
  try {
    execFileSync(command, args, { cwd: options.root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    errors.push(`${args.slice(0, 4).join(" ")} exited non-zero; its listing may be partial${typeof stderr === "string" && stderr.trim() !== "" ? `: ${stderr.trim().split("\n")[0] ?? ""}` : ""}`);
  }
}

/** The tests one runner invocation would run, unscoped (every tag in each title). */
export function listSelection(selection: RunnerSelection, options: ListOptions): Listing {
  const dir = mkdtempSync(join(tmpdir(), "listing-"));
  const errors: string[] = [];
  const out = join(dir, `${selection.label}.json`);
  // The output file is always our own: a listing inside a driver run must not overwrite the run's report.
  const env = { ...(options.env ?? process.env), PLAYWRIGHT_JSON_OUTPUT_NAME: out };
  try {
    if (selection.runner === "vitest") exec("npx", [...selection.args, "-t", COLLECT_ONLY, "--passWithNoTests", "--reporter=json", `--outputFile=${out}`], options, env, errors);
    else exec("npx", [...selection.args, "--list", "--reporter=json"], options, env, errors);
    const text = existsSync(out) ? readFileSync(out, "utf8") : "";
    const parsed = selection.runner === "vitest" ? parseVitestJson(text, options.root) : parsePlaywrightJson(text, "");
    errors.push(...parsed.errors.map((e) => `${selection.label}: ${e}`));
    return { tests: parsed.outcomes.map((o) => ({ title: o.title, file: o.file })), errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The tests a driver run on `target` selects, each with the IDs it may evidence (exactly the driver's selection). */
export function listDriverTests(target: Target, options: ListOptions): Listing {
  const tests: ListedTest[] = [];
  const errors: string[] = [];
  for (const selection of runnerSelection({ target })) {
    const listing = listSelection(selection, options);
    tests.push(...scopeTests(selection, listing.tests));
    errors.push(...listing.errors);
  }
  return { tests, errors };
}
