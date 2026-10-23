/**
 * LOG-AC-004 (Cloud): entries appear under the specified key layout
 * `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json` (LOG-REQ-004): an entry
 * written during a request has that request's ID and its severity in its key, one written outside
 * a request has a random final part. The removal clause ("after a stage is removed, the bucket
 * and other stages' entries remain") needs a stage to remove: secrets/further-stage.test.ts.
 */
import { describe, expect, it } from "vitest";
import { client, prerequisiteMissing, tag, waitFor } from "../../harness/index.js";
import { logEntryViolations, runDeployment, uniqueValue, utcDay } from "../core/support/repo.js";
import { cloudHooks, logDayPrefix } from "../core/support/stores.js";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The key's date and time parts as the entry's UTC time gives them. */
export function keyTimeParts(time: string): { day: string; hhmmss: string } {
  const iso = new Date(time).toISOString();
  return { day: iso.slice(0, 10), hhmmss: `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.${iso.slice(20, 23)}` };
}

describe("LOG: key layout in the shared bucket", () => {
  it(tag("LOG-AC-004", "an entry written during a request is stored at <app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<requestId>.json matching its UTC time"), async () => {
    const run = runDeployment();
    const hooks = await cloudHooks("LOG-AC-004");
    const c = client();
    const results: { severity: string; requestId: string; message: string }[] = [];
    for (const severity of ["warn", "debug"] as const) {
      const message = uniqueValue(`c-t1 LOG-AC-004 ${severity} `);
      const { requestId } = c.expectStatus(await c.post("/api/ref/log", { severity, message }), 200).json<{ requestId: string }>();
      results.push({ severity, requestId, message });
    }
    for (const { severity, requestId, message } of results) {
      const keyPattern = new RegExp(`^${escape(run.app)}/${escape(run.stage)}/(\\d{4})/(\\d{2})/(\\d{2})/(\\d{6}\\.\\d{3})-${severity}-${escape(requestId)}\\.json$`);
      const found = await waitFor(
        async () => {
          const keys: string[] = [];
          for (const day of [utcDay(new Date(Date.now() - 86_400_000)), utcDay(new Date())]) keys.push(...(await hooks.listLogKeys(logDayPrefix(run.app, run.stage, day))));
          for (const key of keys.filter((k) => k.endsWith(`-${requestId}.json`))) {
            const entry = JSON.parse(await hooks.readLogObject(key)) as Record<string, unknown>;
            if (entry.message === message) return { key, entry };
          }
          return undefined;
        },
        { what: `the ${severity} entry of request ${requestId} in the shared log bucket`, timeoutMs: 30_000, intervalMs: 1000 },
      );
      expect(logEntryViolations(found.entry), found.key).toEqual([]);
      const m = keyPattern.exec(found.key);
      expect(m, `key ${found.key} follows the layout with severity ${severity} and the request's ID`).not.toBeNull();
      const { day, hhmmss } = keyTimeParts(String(found.entry.time));
      expect(`${m?.[1] ?? ""}-${m?.[2] ?? ""}-${m?.[3] ?? ""}`, "date part = the entry's UTC date").toBe(day);
      expect(m?.[4], "time part = the entry's UTC time").toBe(hhmmss);
    }
  });

  it(tag("LOG-AC-004", "an entry written outside a request has a random final part in its key"), () => {
    // No reference route, and no app-facing API (log.d.ts), writes an entry outside an HTTP
    // request: every app write happens in a request. Recorded in decisions C-T1 as a missing fixture.
    prerequisiteMissing("LOG-AC-004 (outside-request clause): the reference app has no way to write a log entry outside an HTTP request (needs a fixture; see DEC-0277…DEC-0280 in docs/decisions/decision-log.md)");
  });
});
