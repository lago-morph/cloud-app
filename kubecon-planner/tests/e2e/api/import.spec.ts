import { expect, test } from "@playwright/test";
import type { ImportResult, MySchedule, ScheduleMeta, SessionList } from "../../../src/shared/types";
import { ensureImported, errorCode, signIn } from "./support";

/**
 * Flow: import the schedule ("Refresh schedule", and the automatic import of an empty schedule),
 * through the HTTP API of a local `dev` server. The server fetches the real public Sessionize
 * feeds (data/SOURCE.md), so these tests need outbound HTTPS to sessionize.com and assert only
 * facts that hold for the live 2026 schedule, never exact totals.
 *
 * Edge cases (the skill's reference/testing/e2e.md):
 * - Boundaries: an empty schedule is imported by `onlyIfEmpty`; a filled one is not re-fetched.
 *   An empty or failing feed is in-process only (tests/app.test.ts): the live feeds cannot be broken here.
 * - Text: Unicode titles and event names come through unchanged (asserted on the event list);
 *   names, paths and percent-encoding do not apply to this flow's input (one boolean).
 * - Order and time: days come back in date order; times stay event-local (no offset added).
 * - Access: anonymous is refused (401); every signed-in user may refresh (the feed is public);
 *   there is no admin-only behaviour.
 * - Repetition: a second refresh changes nothing and keeps selections. Concurrent refreshes are
 *   not asserted: each one computes the same writes from the same feeds.
 * - Failures: an unavailable database or feed is in-process only (`setUnavailable`, fake feeds).
 */

test("a refresh imports every day of KubeCon NA 2026, Sunday to Thursday, with the Monday co-located talks", async ({ request }) => {
  await signIn(request);
  await ensureImported(request);
  const res = await request.post("/api/schedule/refresh", { data: {}, timeout: 90_000 });
  expect(res.status()).toBe(200);
  const result: ImportResult = await res.json();
  expect(result.skipped).toBe(false);
  expect(result.sessions).toBeGreaterThan(700);

  const meta: ScheduleMeta = await (await request.get("/api/schedule/meta")).json();
  expect(meta.sessionCount).toBe(result.sessions);
  expect(meta.timeZone).toBe("America/Denver");
  expect(meta.days.map((d) => d.day)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  expect(meta.lastImport?.sessions).toBe(result.sessions);
  for (const event of ["ArgoCon", "BackstageCon", "Observability Day", "Platform Engineering Day", "CNCF Maintainer Summit"]) {
    expect(meta.events).toContain(event);
  }
  expect(meta.tracks).toContain("Keynote Sessions");

  const monday: SessionList = await (await request.get("/api/sessions", { params: { day: "2026-11-09", event: "ArgoCon" } })).json();
  expect(monday.sessions.length).toBeGreaterThan(10);
  for (const s of monday.sessions) {
    expect(s.events).toContain("ArgoCon");
    expect(s.startsAt).toMatch(/^2026-11-09T\d{2}:\d{2}:00$/);
  }
  // The main feed's umbrella blocks are replaced by the detailed talks.
  const umbrellas: SessionList = await (await request.get("/api/sessions", { params: { q: "Hosted by CNCF" } })).json();
  expect(umbrellas.sessions).toEqual([]);
});

test("onlyIfEmpty does not re-import a filled schedule, and a refresh keeps every selection", async ({ request }) => {
  await signIn(request);
  await ensureImported(request);
  const again = await ensureImported(request);
  expect(again.skipped).toBe(true);

  const { sessions }: SessionList = await (await request.get("/api/sessions", { params: { day: "2026-11-10" } })).json();
  const picked = sessions.slice(0, 2).map((s) => s.id);
  for (const id of picked) expect((await request.put(`/api/my-schedule/${id}`)).status()).toBe(204);

  const refreshed = await request.post("/api/schedule/refresh", { data: {}, timeout: 90_000 });
  expect(refreshed.status()).toBe(200);
  const mine: MySchedule = await (await request.get("/api/my-schedule")).json();
  expect(mine.days.flatMap((d) => d.sessions.map((s) => s.id)).sort()).toEqual([...picked].sort());
});

test("refresh is refused to anonymous callers and with an invalid body", async ({ request }) => {
  const anonymous = await request.post("/api/schedule/refresh", { data: {} });
  expect(anonymous.status()).toBe(401);
  expect(await errorCode(anonymous)).toBe("AUTH.UNAUTHENTICATED");
  expect((await request.get("/api/schedule/meta")).status()).toBe(401);

  await signIn(request);
  const invalid = await request.post("/api/schedule/refresh", { data: { onlyIfEmpty: "yes" } });
  expect(invalid.status()).toBe(400);
  expect(await errorCode(invalid)).toBe("HTTP.INVALID_INPUT");
});
