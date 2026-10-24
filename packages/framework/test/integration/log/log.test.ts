/**
 * LOG criteria in-process through `createTestApp` (testing.d.ts) and `TestApp.logs()`.
 * Criteria: docs/components/log.md §4.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp, TestAppOptions } from "../../../src/testing/index.js";
import { errorBody, logEntryViolations, PAR } from "../core/harness/harness.js";
import { APP_NAME, createRefApp, seenRequestIds } from "../core/harness/reference-app.js";

let apps: TestApp[] = [];
afterEach(async () => {
  for (const a of apps) await a.dispose();
  apps = [];
});

async function open(options: TestAppOptions = {}): Promise<TestApp> {
  const a = await createRefApp(options);
  apps.push(a);
  return a;
}

/**
 * LOG-AC-001 needs an injected log writer that fails and one that never completes. testing.d.ts
 * has no such option yet; this is the option the B-T1 decision draft proposes for it
 * (DEC-0210, owner of testing.d.ts: B-16; plan B-04 "failing and never-completing
 * writer injection for tests").
 */
type WithLogWriter = TestAppOptions & { readonly logWriter?: "failing" | "never-completing" };

async function timedRequest(t: TestApp, path: string): Promise<{ ms: number; status: number; body: unknown }> {
  const start = performance.now();
  const res = await t.request(path);
  const body = (await res.json()) as unknown;
  return { ms: performance.now() - start, status: res.status, body };
}

describe("LOG in-process", () => {
  for (const writer of ["failing", "never-completing"] as const) {
    it(tag("LOG-AC-001", `local: with a ${writer} log writer a request that writes entries still succeeds within PAR-260 of baseline`), async () => {
      const normal = await open();
      // Warm up, then take the best of three as the baseline.
      await timedRequest(normal, "/api/log");
      const baseline = Math.min(...(await Promise.all([0, 1, 2].map(() => timedRequest(normal, "/api/log")))).map((r) => r.ms));

      const options: WithLogWriter = { logWriter: writer };
      const broken = await open(options);
      for (let i = 0; i < 3; i++) {
        const r = await timedRequest(broken, `/api/log?message=${encodeURIComponent(`bt1 ${writer} ${i}`)}`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true });
        expect(r.ms - baseline).toBeLessThanOrEqual(PAR.logWait);
      }
    }, 60_000);
  }

  it(tag("LOG-AC-002", "stored entries validate against the schema and carry the request ID from the matching error response"), async () => {
    const t = await open();
    const dep = (await (await t.request("/api/deployment")).json()) as { app: string; stage: string };

    const probe = randomUUID();
    const logged = await t.request("/api/log?message=bt1-schema-entry", { headers: { "x-bt1-probe": probe } });
    expect(logged.status).toBe(200);
    const failed = await t.request("/api/throw/plain");
    expect(failed.status).toBe(500);
    const { error } = await errorBody(failed);

    const entries = t.logs();
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      expect(logEntryViolations(e), JSON.stringify(e)).toEqual([]);
      expect(e.app).toBe(APP_NAME);
      expect(e.stage).toBe(dep.stage);
      expect(e.target).toBe("local");
    }
    // Entries written during a request carry that request's ID.
    const appEntries = entries.filter((e) => e.message.startsWith("bt1-schema-entry"));
    expect(appEntries.length).toBe(2);
    for (const e of appEntries) expect(e.requestId).toBe(seenRequestIds.get(probe));
    // The framework's entry for the failure carries the error response's requestId.
    const matching = entries.filter((e) => e.severity === "error" && e.requestId === error.requestId);
    expect(matching.length).toBe(1);
  });

  it(tag("LOG-AC-005", "local: an app route throwing a plain Error produces an error entry from the framework"), async () => {
    const t = await open();
    const res = await t.request("/api/throw/plain");
    expect(res.status).toBe(500);
    const { error } = await errorBody(res);
    expect(error.code).toBe("CORE.INTERNAL");
    const entries = t.logs().filter((e) => e.severity === "error" && e.requestId === error.requestId);
    expect(entries.length).toBe(1);
    expect(entries[0]!.component).toBe("CORE");
  });

  it(tag("LOG-AC-005", "local: a SQL outage forced with unavailable: [\"sql\"] produces an error entry from the framework"), async () => {
    const t = await open({ unavailable: ["sql"] });
    const res = await t.request("/api/sql/items");
    expect(res.status).toBe(503);
    const { error } = await errorBody(res);
    expect(error.code).toBe("SQL.UNAVAILABLE");
    const entries = t.logs().filter((e) => e.severity === "error" && e.requestId === error.requestId);
    expect(entries.length).toBe(1);
    expect(entries[0]!.component).toBe("SQL");
    expect(entries[0]!.message).toContain("SQL.UNAVAILABLE");
  });
});
