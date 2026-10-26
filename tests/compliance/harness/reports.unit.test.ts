import { describe, expect, it } from "vitest";
import { grepPattern, parsePlaywrightJson, parseVitestJson } from "./reports.js";
import SkipNotesReporter, { SKIP_NOTE_META } from "./skip-notes-reporter.js";

describe("test-runner reports into outcomes", () => {
  it("reads Vitest's JSON report with describe titles in the full title", () => {
    const report = {
      testResults: [
        {
          name: "/repo/tests/compliance/criteria/kv/kv.test.ts",
          status: "failed",
          message: "",
          assertionResults: [
            { ancestorTitles: ["kv"], title: "[KV-AC-001] put", status: "passed", failureMessages: [] },
            { ancestorTitles: ["[KV-AC-002] keys"], title: "empty", status: "failed", failureMessages: ["AssertionError: x\n  at y"] },
            { ancestorTitles: [], title: "[KV-AC-003] later", status: "pending", failureMessages: [] },
            { ancestorTitles: [], title: "[KV-AC-003] todo", status: "todo", failureMessages: [] },
          ],
        },
        { name: "/repo/tests/compliance/criteria/x.test.ts", status: "failed", message: "SyntaxError: bad", assertionResults: [] },
      ],
    };
    const parsed = parseVitestJson(JSON.stringify(report), "/repo");
    expect(parsed.outcomes).toEqual([
      { title: "kv > [KV-AC-001] put", file: "tests/compliance/criteria/kv/kv.test.ts", status: "passed" },
      { title: "[KV-AC-002] keys > empty", file: "tests/compliance/criteria/kv/kv.test.ts", status: "failed", message: "AssertionError: x\n  at y" },
      { title: "[KV-AC-003] later", file: "tests/compliance/criteria/kv/kv.test.ts", status: "skipped" },
      { title: "[KV-AC-003] todo", file: "tests/compliance/criteria/kv/kv.test.ts", status: "skipped" },
    ]);
    expect(parsed.errors).toEqual(["tests/compliance/criteria/x.test.ts: SyntaxError: bad"]);
  });

  it("reads Playwright's JSON report through nested suites; flaky counts as failed", () => {
    const report = {
      suites: [
        {
          title: "files/files.spec.ts",
          file: "files/files.spec.ts",
          specs: [{ title: "[FILES-AC-003] upload", file: "files/files.spec.ts", tests: [{ projectName: "integration", status: "expected", results: [{ status: "passed" }] }] }],
          suites: [
            {
              title: "browser",
              file: "files/files.spec.ts",
              specs: [
                { title: "[FILES-AC-004] download", file: "files/files.spec.ts", tests: [{ projectName: "integration", status: "unexpected", results: [{ status: "failed", error: { message: "Error: boom\nstack" } }] }] },
                { title: "[FILES-AC-006] flaky", file: "files/files.spec.ts", tests: [{ projectName: "integration", status: "flaky", results: [{ status: "failed", error: { message: "first" } }, { status: "passed" }] }] },
                { title: "[FILES-AC-005] skipped", file: "files/files.spec.ts", tests: [{ projectName: "integration", status: "skipped", results: [{ status: "skipped" }] }] },
              ],
              suites: [],
            },
          ],
        },
      ],
      errors: [{ message: "Error: config broke" }],
    };
    const parsed = parsePlaywrightJson(JSON.stringify(report), "tests/compliance/criteria");
    expect(parsed.outcomes).toEqual([
      { title: "[FILES-AC-003] upload", file: "tests/compliance/criteria/files/files.spec.ts", status: "passed" },
      { title: "browser > [FILES-AC-004] download", file: "tests/compliance/criteria/files/files.spec.ts", status: "failed", message: "Error: boom\nstack" },
      { title: "browser > [FILES-AC-006] flaky", file: "tests/compliance/criteria/files/files.spec.ts", status: "failed", message: "flaky (failed, then passed on retry): first" },
      { title: "browser > [FILES-AC-005] skipped", file: "tests/compliance/criteria/files/files.spec.ts", status: "skipped" },
    ]);
    expect(parsed.errors).toEqual(["Error: config broke"]);
  });

  // DEC-0500: a test that skips with its not-run reason as the note; the reason must reach the outcome.
  it("keeps a skipped test's note: Vitest's from meta.skipNote (skip-notes reporter), Playwright's from its skip annotation", () => {
    const vitest = {
      testResults: [
        {
          name: "/repo/tests/compliance/criteria/kv/skipped.test.ts",
          status: "passed",
          assertionResults: [
            { ancestorTitles: [], title: "[KV-AC-005] paused", status: "skipped", failureMessages: [], meta: { [SKIP_NOTE_META]: "not-run: the cluster did not pause within 15 minutes" } },
            { ancestorTitles: [], title: "[KV-AC-005] plain skip", status: "skipped", failureMessages: [], meta: {} },
            { ancestorTitles: [], title: "[KV-AC-005] blank note", status: "skipped", failureMessages: [], meta: { [SKIP_NOTE_META]: "  " } },
          ],
        },
      ],
    };
    expect(parseVitestJson(JSON.stringify(vitest), "/repo").outcomes).toEqual([
      { title: "[KV-AC-005] paused", file: "tests/compliance/criteria/kv/skipped.test.ts", status: "skipped", note: "not-run: the cluster did not pause within 15 minutes" },
      { title: "[KV-AC-005] plain skip", file: "tests/compliance/criteria/kv/skipped.test.ts", status: "skipped" },
      { title: "[KV-AC-005] blank note", file: "tests/compliance/criteria/kv/skipped.test.ts", status: "skipped" },
    ]);
    const playwright = {
      suites: [
        {
          title: "a.spec.ts",
          file: "a.spec.ts",
          specs: [{ title: "[E2E-002] aws part", file: "a.spec.ts", tests: [{ status: "skipped", annotations: [{ type: "skip", description: "no AWS stage in this run" }], results: [{ status: "skipped" }] }] }],
        },
      ],
    };
    expect(parsePlaywrightJson(JSON.stringify(playwright), "").outcomes).toEqual([{ title: "[E2E-002] aws part", file: "a.spec.ts", status: "skipped", note: "no AWS stage in this run" }]);
  });

  it("the skip-notes reporter copies a skip(note) into the JSON report's meta, and leaves other results alone", () => {
    const meta: Record<string, unknown> = {};
    const testCase = (result: unknown) => ({ result: () => result, meta: () => meta }) as unknown as Parameters<SkipNotesReporter["onTestCaseResult"]>[0];
    const reporter = new SkipNotesReporter();
    reporter.onTestCaseResult(testCase({ state: "passed", errors: undefined }));
    reporter.onTestCaseResult(testCase({ state: "skipped", errors: undefined, note: undefined }));
    expect(meta).toEqual({});
    reporter.onTestCaseResult(testCase({ state: "skipped", errors: undefined, note: "not-run: never paused" }));
    expect(meta).toEqual({ [SKIP_NOTE_META]: "not-run: never paused" });
  });

  it("reports an unreadable report as an error, not as outcomes", () => {
    expect(parseVitestJson("not json", "/r")).toEqual({ outcomes: [], errors: ["Vitest JSON report unreadable: not json"] });
    expect(parsePlaywrightJson("", "/r").errors[0]).toMatch(/Playwright JSON report unreadable/);
  });

  it("builds one name pattern matching exactly the bracketed IDs", () => {
    const re = new RegExp(grepPattern(["KV-AC-001", "E2E-004"]));
    expect(re.test("x > [KV-AC-001] put")).toBe(true);
    expect(re.test("[E2E-004] all")).toBe(true);
    expect(re.test("[KV-AC-0011] put")).toBe(false);
    expect(re.test("KV-AC-001 untagged")).toBe(false);
  });
});
