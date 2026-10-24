/**
 * A Vitest reporter the driver adds before the JSON reporter (compliance.md "Driver": each skipped
 * tagged test adds a `not-run` entry). Vitest's JSON report has no field for the note a test passes
 * to `skip(note)`, so the reason a test gives for not running (AWS-AC-005: "the cluster did not
 * pause …") would be lost. This reporter copies the note into the test's `meta` as `skipNote`, which
 * the JSON report does carry (`assertionResults[].meta`), and `parseVitestJson` reads it from there.
 * It prints nothing.
 */
import type { Reporter, TestCase } from "vitest/node";

/** The `meta` key that carries a skipped test's note into the JSON report. */
export const SKIP_NOTE_META = "skipNote";

export default class SkipNotesReporter implements Reporter {
  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state !== "skipped" || result.note === undefined || result.note === "") return;
    (testCase.meta() as Record<string, unknown>)[SKIP_NOTE_META] = result.note;
  }
}
