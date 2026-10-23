/**
 * E2E-011 — Logs land in the shared bucket (Where: Local, cloud).
 *
 * "On each cloud, exercise the reference app, including its route that throws a plain Error.
 * Find that request's entry by its requestId in the account's log bucket […]. Locally, repeat
 * with an injected failing log writer. Pass: app and framework entries appear under the app
 * and stage prefix with timestamps, and the forced error's entry is found by its requestId.
 * With log writes failing, the app still works."
 *
 * - Every target: exercise the app (`POST /api/ref/log` writes an app entry; `GET
 *   /api/ref/throw-plain` makes the framework write an `error` entry) and find both entries by
 *   request ID where the target stores them: on a cloud, the shared log bucket under
 *   `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json` (LOG-REQ-004), read
 *   through D-T2's log-listing hook; locally, `.logs/<yyyy-mm-dd>.log` of the app that `dev`
 *   runs (LOG-REQ-003), whose entries carry the app and stage.
 * - Locally only: the same requests with an injected failing log writer (`createTestApp`
 *   `logWriter: "failing"`) still succeed.
 * - "Using only commands copied from the skill's troubleshooting reference" is re-checked by
 *   E-RUN once the skill exists (plan §6); the AWS deny case is not run (AWS phase not started).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { CLOUD_WAITS, client, REFERENCE_APP, tag, target, waitFor } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { cloudLogEntries, utcDay } from "./support/cloud.js";
import { referenceTestApp } from "./support/in-process.js";
import { REFERENCE_DIR } from "./support/process.js";

interface Entry {
  readonly time: string;
  readonly app: string;
  readonly stage: string;
  readonly target: string;
  readonly component: string;
  readonly severity: string;
  readonly message: string;
  readonly requestId?: string;
}

/** The local stage `dev` runs (cli.md: `dev` builds for `local`/`local`). */
const LOCAL_STAGE = "local";

function localEntries(appDir: string): Entry[] {
  const dir = join(appDir, ".logs");
  if (!existsSync(dir)) return [];
  const out: Entry[] = [];
  for (const name of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort()) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      out.push(JSON.parse(line) as Entry);
    }
  }
  return out;
}

const KEY = /^([^/]+)\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})(\d{2})\.(\d{3})-([a-z]+)-([^/]+)\.json$/;

interface Found {
  readonly entry: Entry;
  /** The bucket key, on a cloud. */
  readonly key?: string;
}

async function findEntries(requestIds: readonly string[], since: Date): Promise<Map<string, Found[]>> {
  const t = target();
  const byId = (found: readonly Found[]): Map<string, Found[]> => {
    const map = new Map<string, Found[]>();
    for (const f of found) {
      const id = f.entry.requestId;
      if (id !== undefined && requestIds.includes(id)) map.set(id, [...(map.get(id) ?? []), f]);
    }
    return map;
  };
  const complete = (map: Map<string, Found[]>): boolean => requestIds.every((id) => (map.get(id) ?? []).length > 0);
  if (t.target === "local") {
    return waitFor(
      () => {
        const map = byId(localEntries(REFERENCE_DIR).map((entry) => ({ entry })));
        return Promise.resolve(complete(map) ? map : undefined);
      },
      { what: "the entries in apps/reference/.logs", timeoutMs: 15_000, intervalMs: 500 },
    );
  }
  const stage = t.stage ?? "";
  const days = [...new Set([utcDay(since), utcDay(new Date())])];
  return waitFor(
    async () => {
      const found: Found[] = [];
      for (const day of days) {
        for (const stored of await cloudLogEntries(t.target, REFERENCE_APP, stage, day)) found.push({ entry: JSON.parse(stored.body) as Entry, key: stored.key });
      }
      const map = byId(found);
      return complete(map) ? map : undefined;
    },
    { what: "the entries in the shared log bucket", timeoutMs: CLOUD_WAITS.requestMs, intervalMs: 5_000 },
  );
}

function checkPlacement(found: Found, expected: { readonly stage: string; readonly severity: string; readonly requestId: string }, window: { readonly from: Date; readonly to: Date }): void {
  const { entry } = found;
  expect(entry.app).toBe(REFERENCE_APP);
  expect(entry.stage).toBe(expected.stage);
  expect(entry.target).toBe(target().target);
  expect(entry.severity).toBe(expected.severity);
  expect(entry.requestId).toBe(expected.requestId);
  // A timestamp within the test's own time window (a minute of clock skew allowed).
  const time = Date.parse(entry.time);
  expect(Number.isNaN(time), `entry time ${entry.time} is a timestamp`).toBe(false);
  expect(time).toBeGreaterThanOrEqual(window.from.getTime() - 60_000);
  expect(time).toBeLessThanOrEqual(window.to.getTime() + 60_000);
  if (found.key !== undefined) {
    // Under the app and stage prefix, at the entry's UTC time, with its severity and request ID.
    const m = KEY.exec(found.key);
    expect(m, `bucket key ${found.key} follows <app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json`).not.toBeNull();
    const d = new Date(time);
    const p = (n: number, w = 2): string => String(n).padStart(w, "0");
    expect(m?.slice(1, 12)).toEqual([
      REFERENCE_APP,
      expected.stage,
      String(d.getUTCFullYear()),
      p(d.getUTCMonth() + 1),
      p(d.getUTCDate()),
      p(d.getUTCHours()),
      p(d.getUTCMinutes()),
      p(d.getUTCSeconds()),
      p(d.getUTCMilliseconds(), 3),
      expected.severity,
      expected.requestId,
    ]);
  }
}

test(tag("E2E-011", "app and framework entries are stored under the app and stage with timestamps, and the plain-Error request's entry is found by its requestId"), async () => {
  const t = target();
  const stage = t.target === "local" ? LOCAL_STAGE : (t.stage ?? "");
  expect(stage, "the run's stage").not.toBe("");
  const api = client();
  const from = new Date();
  const message = `e2e-011 app entry ${randomSuffix()}`;

  const logged = api.expectStatus(await api.post("/api/ref/log", { severity: "info", message }), 200);
  const appRequestId = logged.json<{ requestId: string }>().requestId;
  const failed = api.expectError(await api.get("/api/ref/throw-plain"), 500, "CORE.INTERNAL");
  const errorRequestId = failed.requestId ?? "";
  expect(errorRequestId).not.toBe("");
  const to = new Date();

  const found = await findEntries([appRequestId, errorRequestId], from);
  const appEntries = (found.get(appRequestId) ?? []).filter((f) => f.entry.component === "reference" && f.entry.message === message);
  expect(appEntries, "the app's own entry for its request").toHaveLength(1);
  const appEntry = appEntries[0];
  if (appEntry !== undefined) checkPlacement(appEntry, { stage, severity: "info", requestId: appRequestId }, { from, to });

  // The framework's entry for the plain Error (LOG-REQ-005: component CORE, severity error).
  const errorEntries = (found.get(errorRequestId) ?? []).filter((f) => f.entry.severity === "error");
  expect(errorEntries.map((f) => f.entry.component), "the framework's error entry for the forced error").toEqual(["CORE"]);
  const errorEntry = errorEntries[0];
  if (errorEntry !== undefined) checkPlacement(errorEntry, { stage, severity: "error", requestId: errorRequestId }, { from, to });
});

if (target().target === "local") {
  test(tag("E2E-011", "local part: with an injected failing log writer the app still works"), async () => {
    const app = await referenceTestApp({ logWriter: "failing" });
    try {
      const logged = await app.request("/api/ref/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ severity: "error", message: "e2e-011 failing writer" }) });
      expect(logged.status).toBe(200);
      expect(await logged.json()).toEqual({ requestId: expect.any(String) });

      // The forced error still answers as a normal catalogue error, although its log entry cannot be written.
      const failed = await app.request("/api/ref/throw-plain");
      expect(failed.status).toBe(500);
      expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("CORE.INTERNAL");

      // Other capabilities keep working (KV and SQL-backed routes as a user).
      const user = app.as(mockUsers.user(`e2e011-${randomSuffix()}`));
      const put = await user.request("/api/kv/value", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "e2e011:k", value: "v" }) });
      expect(put.status).toBe(204);
      expect(await (await user.request("/api/kv/value?key=e2e011%3Ak")).json()).toEqual({ value: "v" });
      expect((await user.request("/api/levels/user")).status).toBe(200);
      expect((await app.request("/api/ref/request-id")).status).toBe(200);

      // The failing writer stored nothing.
      expect(app.logs()).toEqual([]);
    } finally {
      await app.dispose();
    }
  });
}
