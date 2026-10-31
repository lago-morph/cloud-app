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
import { fileURLToPath } from "node:url";
import type { Target } from "../harness/catalogue.js";
import { parsePlaywrightJson, parseVitestJson } from "../harness/reports.js";
import { driverChecks } from "../harness/prodcheck.js";
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
  /** Limit on each runner process, with everything it starts (default LISTING_CHILD_TIMEOUT_MS). */
  readonly timeoutMs?: number;
}

/*
 * Limits (root cause ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md, binding fixes 1
 * and 4). A listing runs its runners synchronously, so neither Vitest's nor Playwright's per-test timer can
 * fire while a child runs (the record's Evidence 5): only the child's own limit bounds the listing and
 * catches a hang. The per-child limit is sized from the worst complete child the record measured (Vitest's
 * collection, 254 s with 6 parallel copies and 4 CPU-burner loops on 4 CPUs). A test that lists takes
 * `driverListingLimitMs` as its own limit: a ceiling that the children's limits already guarantee, so the
 * test's timer never fails a listing that completed, and a hang fails as ListingTimeoutError instead.
 */
export const LISTING_CHILD_TIMEOUT_MS = 300_000;
/** Outside the children's limits: catalogue reading, report parsing and process start-up. */
export const LISTING_OVERHEAD_MS = 30_000;

/** The ceiling on `listDriverTests(target)` with the default limits: every child at its limit, plus overhead. */
export function driverListingLimitMs(target: Target): number {
  return runnerSelection({ target }).length * LISTING_CHILD_TIMEOUT_MS + LISTING_OVERHEAD_MS;
}

/** A runner process outlived its limit; it and every process it started were killed. The listing is incomplete. */
export class ListingTimeoutError extends Error {
  override readonly name = "ListingTimeoutError";
  constructor(label: string, command: readonly string[], timeoutMs: number) {
    super(`${label}: \`${command.join(" ")}\` timed out after ${timeoutMs / 1000} s; listing incomplete (the runner and every process it started were killed)`);
  }
}

/** The runners load the criteria, which import the framework's build; `npm run test:unit` does not build it. */
export const FRAMEWORK_BUILD = "packages/framework/dist/testing/index.js";

/** The framework build is missing, so the runners could not load the criteria. */
export class FrameworkBuildMissingError extends Error {
  override readonly name = "FrameworkBuildMissingError";
  constructor(root: string) {
    super(`the framework build is missing (${join(root, FRAMEWORK_BUILD)}): run \`npm run build -w packages/framework\` before listing tests`);
  }
}

// The child runs in its own process group under run-bounded.mjs, which kills the whole group at the limit
// and exits with BOUNDED_TIMED_OUT. execFileSync's own timeout is only a backstop for the wrapper itself.
const BOUNDED = fileURLToPath(new URL("./run-bounded.mjs", import.meta.url));
const BOUNDED_TIMED_OUT = 124;
const BACKSTOP_MS = 15_000;

function exec(label: string, command: string, args: readonly string[], options: ListOptions, env: NodeJS.ProcessEnv, errors: string[]): void {
  const timeoutMs = options.timeoutMs ?? LISTING_CHILD_TIMEOUT_MS;
  try {
    execFileSync(process.execPath, [BOUNDED, String(timeoutMs), command, ...args], { cwd: options.root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs + BACKSTOP_MS, killSignal: "SIGKILL" });
  } catch (error) {
    const { status, code, stderr } = error as { status?: number | null; code?: string; stderr?: unknown };
    if (status === BOUNDED_TIMED_OUT || code === "ETIMEDOUT") throw new ListingTimeoutError(label, [command, ...args], timeoutMs);
    errors.push(`${args.slice(0, 4).join(" ")} exited non-zero; its listing may be partial${typeof stderr === "string" && stderr.trim() !== "" ? `: ${stderr.trim().split("\n")[0] ?? ""}` : ""}`);
  }
}

/**
 * The tests one runner invocation would run, unscoped (every tag in each title). Throws
 * FrameworkBuildMissingError before starting a runner when the framework is not built, and
 * ListingTimeoutError when a runner outlives `options.timeoutMs`.
 */
export function listSelection(selection: RunnerSelection, options: ListOptions): Listing {
  if (!existsSync(join(options.root, FRAMEWORK_BUILD))) throw new FrameworkBuildMissingError(options.root);
  const dir = mkdtempSync(join(tmpdir(), "listing-"));
  const errors: string[] = [];
  const out = join(dir, `${selection.label}.json`);
  // The output file is always our own: a listing inside a driver run must not overwrite the run's report.
  const env = { ...(options.env ?? process.env), PLAYWRIGHT_JSON_OUTPUT_NAME: out };
  try {
    if (selection.runner === "vitest") exec(selection.label, "npx", [...selection.args, "-t", COLLECT_ONLY, "--passWithNoTests", "--reporter=json", `--outputFile=${out}`], options, env, errors);
    else exec(selection.label, "npx",[...selection.args, "--list", "--reporter=json"], options, env, errors);
    const text = existsSync(out) ? readFileSync(out, "utf8") : "";
    const parsed = selection.runner === "vitest" ? parseVitestJson(text, options.root) : parsePlaywrightJson(text, "");
    errors.push(...parsed.errors.map((e) => `${selection.label}: ${e}`));
    return { tests: parsed.outcomes.map((o) => ({ title: o.title, file: o.file })), errors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The tests a driver run on `target` selects, each with the IDs it may evidence (exactly the
 * driver's selection), and the driver's own checks on that target (`check-login` on `prodcheck`,
 * harness/prodcheck.ts).
 */
export function listDriverTests(target: Target, options: ListOptions): Listing {
  const tests: ListedTest[] = [...driverChecks(target)];
  const errors: string[] = [];
  for (const selection of runnerSelection({ target })) {
    const listing = listSelection(selection, options);
    tests.push(...scopeTests(selection, listing.tests));
    errors.push(...listing.errors);
  }
  return { tests, errors };
}
