/**
 * Reads the Vitest and Playwright JSON reports into test outcomes, and builds the test-name
 * pattern that selects the tests tagged with a set of IDs (plan §10.3).
 */
import { posix, relative } from "node:path";
import type { TestOutcome } from "./results.js";
import { SKIP_NOTE_META } from "./skip-notes-reporter.js";

export interface ParsedReport {
  readonly outcomes: TestOutcome[];
  /** Problems outside single tests (a file that failed to load, a configuration error). */
  readonly errors: string[];
}

interface VitestAssertion {
  readonly ancestorTitles?: readonly string[];
  readonly title: string;
  readonly status: string;
  readonly failureMessages?: readonly string[];
  /** The test's meta; the skip-notes reporter puts a `skip(note)` there as `skipNote`. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface VitestFile {
  readonly name: string;
  readonly status?: string;
  readonly message?: string;
  readonly assertionResults?: readonly VitestAssertion[];
}

function unreadable(kind: string, text: string): ParsedReport {
  return { outcomes: [], errors: [`${kind} JSON report unreadable: ${text.slice(0, 200)}`] };
}

/** A usable skip note, or undefined for none or a blank one. */
function noteOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** A skipped outcome, with its note when the test gave one. */
function skipped(title: string, file: string, note: unknown): TestOutcome {
  const text = noteOf(note);
  return text === undefined ? { title, file, status: "skipped" } : { title, file, status: "skipped", note: text };
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/** `root`: the directory test file paths are made relative to. */
export function parseVitestJson(text: string, root: string): ParsedReport {
  let report: { testResults?: readonly VitestFile[] };
  try {
    report = JSON.parse(text) as { testResults?: readonly VitestFile[] };
  } catch {
    return unreadable("Vitest", text);
  }
  const outcomes: TestOutcome[] = [];
  const errors: string[] = [];
  for (const file of report.testResults ?? []) {
    const path = toPosix(relative(root, file.name));
    const assertions = file.assertionResults ?? [];
    if (assertions.length === 0 && file.status === "failed") errors.push(`${path}: ${file.message ?? "failed without tests"}`);
    for (const a of assertions) {
      const title = [...(a.ancestorTitles ?? []), a.title].join(" > ");
      if (a.status === "passed") outcomes.push({ title, file: path, status: "passed" });
      else if (a.status === "failed") outcomes.push({ title, file: path, status: "failed", message: a.failureMessages?.[0] ?? "failed" });
      else outcomes.push(skipped(title, path, a.meta?.[SKIP_NOTE_META]));
    }
  }
  return { outcomes, errors };
}

interface PlaywrightResult {
  readonly status?: string;
  readonly error?: { readonly message?: string };
}

interface PlaywrightTest {
  readonly status?: string;
  /** `test.skip(condition, description)` adds `{ type: "skip", description }`. */
  readonly annotations?: readonly { readonly type?: string; readonly description?: string }[];
  readonly results?: readonly PlaywrightResult[];
}

interface PlaywrightSuite {
  readonly title: string;
  readonly file?: string;
  readonly specs?: readonly { readonly title: string; readonly file?: string; readonly tests?: readonly PlaywrightTest[] }[];
  readonly suites?: readonly PlaywrightSuite[];
}

/** `prefix`: the Playwright root directory relative to the repository root ("" for the root config). */
export function parsePlaywrightJson(text: string, prefix: string): ParsedReport {
  let report: { suites?: readonly PlaywrightSuite[]; errors?: readonly { message?: string }[] };
  try {
    report = JSON.parse(text) as typeof report;
  } catch {
    return unreadable("Playwright", text);
  }
  const outcomes: TestOutcome[] = [];
  const walk = (suite: PlaywrightSuite, titles: readonly string[]): void => {
    for (const spec of suite.specs ?? []) {
      const file = posix.join(prefix, spec.file ?? suite.file ?? "");
      const title = [...titles, spec.title].join(" > ");
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const firstError = results.find((r) => r.error?.message !== undefined)?.error?.message ?? "failed";
        if (test.status === "expected") outcomes.push({ title, file, status: "passed" });
        else if (test.status === "skipped") outcomes.push(skipped(title, file, test.annotations?.find((x) => x.type === "skip" && noteOf(x.description) !== undefined)?.description));
        else if (test.status === "flaky") outcomes.push({ title, file, status: "failed", message: `flaky (failed, then passed on retry): ${firstError}` });
        else outcomes.push({ title, file, status: "failed", message: firstError });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // Top-level suites are files; their titles are paths, not describe titles.
  for (const fileSuite of report.suites ?? []) walk(fileSuite, []);
  return { outcomes, errors: (report.errors ?? []).map((e) => e.message ?? "unknown Playwright error") };
}

/** A regular expression source matching a test title that carries one of `ids` as a tag. */
export function grepPattern(ids: readonly string[]): string {
  return `\\[(?:${ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\]`;
}
