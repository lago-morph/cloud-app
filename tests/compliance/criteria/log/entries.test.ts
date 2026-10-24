/**
 * LOG-AC-002 (stored entries validate against the schema and carry the request ID from the
 * matching error response) and LOG-AC-005 (an app route throwing a plain Error produces an `error`
 * entry from the framework; locally a forced SQL outage also does), on this run's target
 * (docs/components/log.md §4). Stored entries: local `.logs/`, the cloud's shared bucket
 * (core/support/stores.ts).
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";
import { referenceTestApp, jsonOf } from "../core/support/in-process.js";
import { catalogueStatus, isLocal, logEntryViolations, runDeployment, uniqueValue, UUID } from "../core/support/repo.js";
import { waitForEntries } from "../core/support/stores.js";

describe("LOG: stored entries", () => {
  it(tag("LOG-AC-002", "the entries stored for a failing request and for an app-written entry validate against the log entry schema and carry the request ID of the response"), async () => {
    const run = runDeployment();
    const c = client();
    const failing = c.expectError(await c.get("/api/ref/throw-plain"), 500, "CORE.INTERNAL");
    const failingId = failing.requestId ?? "";
    expect(failingId).toMatch(UUID);

    const message = uniqueValue("c-t1 LOG-AC-002 ");
    const written = c.expectStatus(await c.post("/api/ref/log", { severity: "warn", message }), 200).json<{ requestId: string }>();
    expect(written.requestId).toMatch(UUID);

    for (const [requestId, what] of [
      [failingId, "the error response's request"],
      [written.requestId, "the app-written entry's request"],
    ] as const) {
      const entries = await waitForEntries(requestId, `LOG-AC-002: ${what}`);
      for (const stored of entries) {
        expect(stored.entry, `${stored.where} is a JSON object`).toBeDefined();
        expect(logEntryViolations(stored.entry), stored.where).toEqual([]);
        expect(stored.entry?.requestId, stored.where).toBe(requestId);
        expect({ app: stored.entry?.app, stage: stored.entry?.stage, target: stored.entry?.target }, stored.where).toEqual({ app: run.app, stage: run.stage, target: run.target });
      }
    }
    const appEntries = await waitForEntries(written.requestId, "LOG-AC-002: the app-written entry", (e) => e.some((s) => s.entry?.message === message));
    expect(appEntries.filter((s) => s.entry?.message === message).map((s) => ({ component: s.entry?.component, severity: s.entry?.severity }))).toEqual([{ component: "reference", severity: "warn" }]);
  });

  it(tag("LOG-AC-005", "an app route throwing a plain Error leaves exactly one framework error entry for its request, with component CORE"), async () => {
    const c = client();
    const r = c.expectError(await c.get("/api/ref/throw-plain"), 500, "CORE.INTERNAL");
    const requestId = r.requestId ?? "";
    const entries = await waitForEntries(requestId, "LOG-AC-005", (e) => e.some((s) => s.entry?.severity === "error"));
    const errors = entries.filter((s) => s.entry?.severity === "error");
    expect(errors.map((s) => ({ component: s.entry?.component, requestId: s.entry?.requestId })), "error entries for the request").toEqual([{ component: "CORE", requestId }]);
    expect(String(errors[0]?.entry?.message ?? ""), "the entry names the failing request and code").toContain("CORE.INTERNAL");
  });

  // The criterion's second clause is stated for the local case only.
  if (isLocal()) {
    it(tag("LOG-AC-005", "locally, a SQL outage forced with createTestApp's unavailable: [\"sql\"] produces exactly one error entry with component SQL"), async () => {
      const app = await referenceTestApp({ unavailable: ["sql"], secrets: { apiKey: "c-t1-in-process-value" } });
      try {
        const response = await app.request("/api/errors/SQL.UNAVAILABLE");
        const body = (await jsonOf(response)) as { error?: { code?: string; requestId?: string } } | undefined;
        expect({ status: response.status, code: body?.error?.code }).toEqual({ status: catalogueStatus("SQL.UNAVAILABLE"), code: "SQL.UNAVAILABLE" });
        const errors = app.logs().filter((e) => e.severity === "error" && e.requestId === body?.error?.requestId);
        expect(errors.map((e) => e.component)).toEqual(["SQL"]);
        expect(errors[0]?.message ?? "").toContain("SQL.UNAVAILABLE");
      } finally {
        await app.dispose();
      }
    });
  }
});
