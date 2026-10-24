/**
 * LOG-AC-001: with an injected log writer that fails and one that never completes, a request that
 * writes log entries still succeeds, and its response time grows by no more than PAR-260
 * (docs/components/log.md §4). The criterion's case is the local one ("on Cloudflare only the
 * local case applies"; the AWS deny case belongs to the AWS phase), so it runs in-process with
 * `createTestApp`'s `logWriter` option on every target this criterion runs on. The shared bucket is
 * never touched by this test.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { referenceTestApp, jsonOf, type TestApp, type TestAppOptions } from "../core/support/in-process.js";
import { logWaitMs, UUID } from "../core/support/repo.js";

async function timedRequests(app: TestApp, label: string): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    const response = await app.request("/api/ref/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ severity: "info", message: `c-t1 LOG-AC-001 ${label} ${String(i)}` }) });
    times.push(performance.now() - started);
    const body = (await jsonOf(response)) as { requestId?: string } | undefined;
    expect(response.status, `${label}: the request that writes a log entry succeeds`).toBe(200);
    expect(body?.requestId ?? "", label).toMatch(UUID);
    // A request whose failure writes the framework's error entry still answers its own error.
    const failing = await app.request("/api/ref/throw-plain");
    expect(failing.status, `${label}: throw-plain answers 500, not a log failure`).toBe(500);
    expect(((await jsonOf(failing)) as { error?: { code?: string } } | undefined)?.error?.code, label).toBe("CORE.INTERNAL");
  }
  times.sort((x, y) => x - y);
  return times[1] ?? Number.NaN;
}

describe("LOG: write-only, never fails the caller", () => {
  it(tag("LOG-AC-001", "with a failing and a never-completing injected log writer, a request writing entries succeeds and its median response time grows by at most PAR-260"), async () => {
    const limit = logWaitMs();
    const medians: Record<string, number> = {};
    for (const [label, options] of [
      ["in-memory", {}],
      ["failing", { logWriter: "failing" }],
      ["never-completing", { logWriter: "never-completing" }],
    ] as const satisfies readonly (readonly [string, TestAppOptions])[]) {
      const app = await referenceTestApp(options);
      try {
        medians[label] = await timedRequests(app, label);
      } finally {
        await app.dispose();
      }
    }
    const baseline = medians["in-memory"] ?? Number.NaN;
    for (const label of ["failing", "never-completing"]) {
      const growth = (medians[label] ?? Number.NaN) - baseline;
      expect(growth, `${label}: median ${String(medians[label])} ms vs ${String(baseline)} ms with the in-memory writer; PAR-260 = ${String(limit)} ms`).toBeLessThanOrEqual(limit);
    }
  });
});
