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
