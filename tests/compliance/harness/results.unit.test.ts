import { describe, expect, it } from "vitest";
import type { ExpectedEntry } from "./expected.js";
import { PREREQUISITE_MARKER } from "./blocked.js";
import { criterionResults, type TestOutcome } from "./results.js";

const run = (id: string, extra: Partial<ExpectedEntry> = {}): ExpectedEntry => ({ id, run: true, parts: [""], notRunParts: [], ...extra });
const outcome = (title: string, status: TestOutcome["status"], message?: string): TestOutcome => ({ title, file: "f.test.ts", status, ...(message === undefined ? {} : { message }) });

describe("[COMPL-AC-003] criterion results from test outcomes", () => {
  it("passes a criterion whose tagged tests all passed, also with several tags per test", () => {
    const results = criterionResults({
      target: "local",
      expected: [run("KV-AC-001"), run("KV-AC-004")],
      outcomes: [outcome("kv > [KV-AC-001] put", "passed"), outcome("[KV-AC-001][KV-AC-004] list", "passed")],
    });
    expect(results).toEqual([
      { id: "KV-AC-001", status: "passed" },
      { id: "KV-AC-004", status: "passed" },
    ]);
  });

  it("records a deliberately omitted criterion (no test ran) as not-run with a reason", () => {
    expect(criterionResults({ target: "local", expected: [run("KV-AC-002")], outcomes: [outcome("[KV-AC-001] put", "passed")] })).toEqual([
      { id: "KV-AC-002", status: "not-run", detail: "no test tagged [KV-AC-002] ran on local" },
    ]);
  });

  it("records the not-run rule's reason for a criterion that is not run, and a part rule as its own entry", () => {
    expect(
      criterionResults({
        target: "cloudflare",
        expected: [run("GOOGLE-AC-001", { run: false, notRun: "Google login mocked for this phase" }), run("AUTH-AC-009", { notRunParts: [{ part: "cloud production part", detail: "Google login mocked for this phase" }] })],
        outcomes: [outcome("[AUTH-AC-009] mock-login on a test stage", "passed")],
      }),
    ).toEqual([
      { id: "GOOGLE-AC-001", status: "not-run", detail: "Google login mocked for this phase" },
      { id: "AUTH-AC-009", status: "passed" },
      { id: "AUTH-AC-009", status: "not-run", detail: "cloud production part: Google login mocked for this phase" },
    ]);
  });

  it("a failing HTTP check carries status, code and requestId into detail", () => {
    const message = "HTTP check failed: GET /api/kv/x → status 500, code CORE.INTERNAL, requestId r-123 (expected status 200)\n    at stack";
    expect(criterionResults({ target: "local", expected: [run("HTTP-AC-001")], outcomes: [outcome("[HTTP-AC-001] a", "passed"), outcome("[HTTP-AC-001] b", "failed", message)] })).toEqual([
      { id: "HTTP-AC-001", status: "failed", detail: "1 of 2 tests failed: [HTTP-AC-001] b: HTTP check failed: GET /api/kv/x → status 500, code CORE.INTERNAL, requestId r-123 (expected status 200)" },
    ]);
  });

  it("records blocked from the driver's --blocked list (tests not run) or from a test's missing-prerequisite signal", () => {
    expect(
      criterionResults({
        target: "cloudflare",
        expected: [run("KV-AC-001"), run("SQL-AC-003")],
        outcomes: [outcome("[SQL-AC-003] cases", "failed", `${PREREQUISITE_MARKER}D1 daily rows-written limit reached\n at x`)],
        blocked: new Map([["KV-AC-001", "D1 unavailable on Cloudflare today: daily row limit exhausted"]]),
      }),
    ).toEqual([
      { id: "KV-AC-001", status: "blocked", detail: "D1 unavailable on Cloudflare today: daily row limit exhausted" },
      { id: "SQL-AC-003", status: "blocked", detail: "[SQL-AC-003] cases: D1 daily rows-written limit reached" },
    ]);
  });

  it("a failure outranks a blocked test of the same criterion", () => {
    const [result] = criterionResults({ target: "local", expected: [run("X-AC-001")], outcomes: [outcome("[X-AC-001] a", "failed", `${PREREQUISITE_MARKER}p`), outcome("[X-AC-001] b", "failed", "boom")] });
    expect(result?.status).toBe("failed");
  });

  it("never records a skipped test as passed: skipped tests add a not-run entry", () => {
    expect(criterionResults({ target: "local", expected: [run("X-AC-001")], outcomes: [outcome("[X-AC-001] a", "passed"), outcome("[X-AC-001] b", "skipped")] })).toEqual([
      { id: "X-AC-001", status: "passed" },
      { id: "X-AC-001", status: "not-run", detail: "1 tagged test skipped: [X-AC-001] b" },
    ]);
    expect(criterionResults({ target: "local", expected: [run("X-AC-001")], outcomes: [outcome("[X-AC-001] b", "skipped")] })).toEqual([
      { id: "X-AC-001", status: "not-run", detail: "1 tagged test skipped: [X-AC-001] b" },
    ]);
  });

  // DEC-0500: a test's not-run reason travels as the skip note and must become the detail.
  it("a skipped test's note becomes its not-run detail (a leading 'not-run:' dropped); skips without a note are listed as before", () => {
    const noted = (title: string, note: string): TestOutcome => ({ ...outcome(title, "skipped"), note });
    expect(
      criterionResults({
        target: "cloudflare",
        expected: [run("KV-AC-005")],
        outcomes: [noted("[KV-AC-005] expiry", "not-run: the key did not expire within 15 minutes; last observed: present")],
      }),
    ).toEqual([{ id: "KV-AC-005", status: "not-run", detail: "the key did not expire within 15 minutes; last observed: present" }]);
    expect(
      criterionResults({
        target: "local",
        expected: [run("X-AC-001")],
        outcomes: [outcome("[X-AC-001] a", "passed"), noted("[X-AC-001] b", "needs a second region"), outcome("[X-AC-001] c", "skipped"), noted("[X-AC-001] d", "x".repeat(3000))],
      }),
    ).toEqual([
      { id: "X-AC-001", status: "passed" },
      { id: "X-AC-001", status: "not-run", detail: "needs a second region" },
      { id: "X-AC-001", status: "not-run", detail: `${"x".repeat(1000)}…` },
      { id: "X-AC-001", status: "not-run", detail: "1 tagged test skipped: [X-AC-001] c" },
    ]);
  });

  // A clause of a criterion that needs its own test (the rule kind is kept for the AWS release, DEC-0508).
  it("records a required clause not-run when no executed test of its own shows it, even when the criterion's other tests pass", () => {
    const clauses = [{ part: "Data API retry-loop clause", titlePattern: String.raw`\bData API retry[- ]loop clause\b` }];
    const entry = run("SQL-AC-006", { clauses });
    expect(criterionResults({ target: "local", expected: [entry], outcomes: [outcome("[SQL-AC-006] duplicate is SQL.CONFLICT", "passed")] })).toEqual([
      { id: "SQL-AC-006", status: "passed" },
      { id: "SQL-AC-006", status: "not-run", detail: "Data API retry-loop clause: no test tagged [SQL-AC-006] for this clause ran on local" },
    ]);
    // A skipped clause test does not show it either.
    expect(criterionResults({ target: "local", expected: [entry], outcomes: [outcome("[SQL-AC-006] conflict", "passed"), outcome("[SQL-AC-006] Data API retry-loop clause", "skipped")] }).map((r) => r.detail)).toEqual([
      undefined,
      "1 tagged test skipped: [SQL-AC-006] Data API retry-loop clause",
      "Data API retry-loop clause: no test tagged [SQL-AC-006] for this clause ran on local",
    ]);
    expect(criterionResults({ target: "local", expected: [entry], outcomes: [outcome("[SQL-AC-006] conflict", "passed"), outcome("sql > [SQL-AC-006] Data API retry-loop clause (short waits): gives up", "passed")] })).toEqual([{ id: "SQL-AC-006", status: "passed" }]);
    expect(criterionResults({ target: "local", expected: [entry], outcomes: [outcome("[SQL-AC-006] Data API retry-loop clause: gives up", "failed", "expected SQL.UNAVAILABLE")] })).toEqual([
      { id: "SQL-AC-006", status: "failed", detail: "1 of 1 tests failed: [SQL-AC-006] Data API retry-loop clause: gives up: expected SQL.UNAVAILABLE" },
    ]);
  });

  it("names the milestone part a result covers", () => {
    expect(criterionResults({ target: "local", expected: [run("E2E-016", { parts: ["review"] })], outcomes: [outcome("[E2E-016] review", "passed")] })).toEqual([
      { id: "E2E-016", status: "passed", detail: "milestone part: review" },
    ]);
  });

  it("shortens long failure details", () => {
    const [result] = criterionResults({ target: "local", expected: [run("X-AC-001")], outcomes: [outcome("[X-AC-001] a", "failed", "x".repeat(5000))] });
    expect(result?.detail?.length).toBeLessThan(1100);
  });
});
