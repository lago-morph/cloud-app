import { expect, test, type APIRequestContext } from "@playwright/test";
import type { MySchedule, PlacedSession, SessionList, SessionSummary } from "../../../src/shared/types";
import { ensureImported, errorCode, signIn } from "./support";

/**
 * Flow: build my schedule (add and remove sessions, conflicts allowed) and see it by day, through
 * the HTTP API of a local `dev` server holding the live 2026 schedule (imported if empty).
 *
 * Edge cases (the skill's reference/testing/e2e.md):
 * - Boundaries: an empty schedule still lists every conference day; one selection; two and three
 *   overlapping selections; a session that ends exactly when another starts is not a conflict.
 * - Text: `..`, `/`, spaces and percent-encoding in a session ID answer 404 and store nothing.
 * - Order and time: each day's sessions come back by start time; the grid minutes match the
 *   event-local start and end times.
 * - Access: anonymous is refused (401); one user never sees or changes another's selections.
 * - Repetition: adding twice keeps one selection; removing twice is fine.
 * - Failures: an unavailable database is in-process only (tests/app.test.ts).
 */

async function day(request: APIRequestContext, date: string): Promise<SessionSummary[]> {
  const body: SessionList = await (await request.get("/api/sessions", { params: { day: date } })).json();
  return body.sessions;
}

async function mine(request: APIRequestContext): Promise<MySchedule> {
  const res = await request.get("/api/my-schedule");
  expect(res.status()).toBe(200);
  return res.json();
}

const ids = (schedule: MySchedule): string[] => schedule.days.flatMap((d) => d.sessions.map((s) => s.id));
const minutes = (time: string): number => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));

/** Talks of at most 90 minutes on their own day (all-day registration blocks overlap everything). */
function talks(sessions: readonly SessionSummary[]): SessionSummary[] {
  return sessions.filter((s) => s.endsAt.slice(0, 10) === s.day && minutes(s.endsAt) > minutes(s.startsAt) && minutes(s.endsAt) - minutes(s.startsAt) <= 90);
}

/** Two talks whose times overlap, and one that overlaps neither. */
function pick(sessions: readonly SessionSummary[]): { a: SessionSummary; b: SessionSummary; free: SessionSummary } {
  const candidates = talks(sessions);
  for (const a of candidates) {
    const b = candidates.find((x) => x.id !== a.id && x.startsAt < a.endsAt && a.startsAt < x.endsAt);
    const free = candidates.find((x) => x.startsAt >= (b !== undefined && b.endsAt > a.endsAt ? b.endsAt : a.endsAt));
    if (b !== undefined && free !== undefined && free.startsAt >= b.endsAt) return { a, b, free };
  }
  throw new Error("no overlapping pair found");
}

test.beforeEach(async ({ request }) => {
  await signIn(request);
  await ensureImported(request);
});

test("an empty schedule lists every conference day with nothing on it", async ({ request }) => {
  const schedule = await mine(request);
  expect(schedule.days.map((d) => d.day)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  expect(schedule.days.every((d) => d.sessions.length === 0)).toBe(true);
  expect(schedule.conflicted).toBe(0);
});

test("conflicting selections are saved and placed side by side, marked as conflicts", async ({ request }) => {
  const { a, b, free } = pick(await day(request, "2026-11-10"));
  for (const s of [a, b, free]) expect((await request.put(`/api/my-schedule/${s.id}`)).status()).toBe(204);

  const schedule = await mine(request);
  expect(schedule.conflicted).toBe(2);
  const tuesday = schedule.days.find((d) => d.day === "2026-11-10")?.sessions ?? [];
  expect(tuesday.map((s) => s.id).sort()).toEqual([a.id, b.id, free.id].sort());
  const starts = tuesday.map((s) => s.startsAt);
  expect(starts).toEqual([...starts].sort());

  const placed = (id: string): PlacedSession | undefined => tuesday.find((s) => s.id === id);
  expect(placed(a.id)?.conflictsWith).toEqual([b.id]);
  expect(placed(b.id)?.conflictsWith).toEqual([a.id]);
  expect(placed(free.id)).toMatchObject({ conflictsWith: [], column: 0, columns: 1 });
  expect([placed(a.id)?.column, placed(b.id)?.column].sort()).toEqual([0, 1]);
  expect(placed(a.id)?.columns).toBe(2);
  expect(placed(a.id)).toMatchObject({ startMinute: minutes(a.startsAt), endMinute: minutes(a.endsAt), selected: true });

  // The browse list shows them as selected.
  const listed = await day(request, "2026-11-10");
  expect(listed.filter((s) => s.selected).map((s) => s.id).sort()).toEqual([a.id, b.id, free.id].sort());
});

test("a third overlapping selection widens the group, and removing one updates the conflicts", async ({ request }) => {
  const sessions = talks(await day(request, "2026-11-10"));
  const overlap = (x: SessionSummary, y: SessionSummary): boolean => x.id !== y.id && x.startsAt < y.endsAt && y.startsAt < x.endsAt;
  // Three talks that overlap each other pairwise (Tuesday has many parallel 30-minute talks).
  const triple = sessions.flatMap((a) =>
    sessions.filter((b) => overlap(a, b)).flatMap((b) => sessions.filter((c) => c.id !== a.id && overlap(a, c) && overlap(b, c)).map((c) => [a, b, c])),
  )[0];
  expect(triple).toBeDefined();
  const [a, b, c] = triple ?? [];
  if (a === undefined || b === undefined || c === undefined) return;
  for (const s of [a, b, c]) expect((await request.put(`/api/my-schedule/${s.id}`)).status()).toBe(204);
  const three = (await mine(request)).days.find((d) => d.day === "2026-11-10")?.sessions ?? [];
  expect(three.every((s) => s.columns === 3 && s.conflictsWith.length === 2)).toBe(true);

  expect((await request.delete(`/api/my-schedule/${c.id}`)).status()).toBe(204);
  const two = await mine(request);
  expect(two.conflicted).toBe(2);
  expect(ids(two).sort()).toEqual([a.id, b.id].sort());
});

test("adding twice keeps one selection; removing twice is fine", async ({ request }) => {
  const [first] = await day(request, "2026-11-11");
  expect(first).toBeDefined();
  const id = first?.id ?? "";
  expect((await request.put(`/api/my-schedule/${id}`)).status()).toBe(204);
  expect((await request.put(`/api/my-schedule/${id}`)).status()).toBe(204);
  expect(ids(await mine(request))).toEqual([id]);
  expect((await request.delete(`/api/my-schedule/${id}`)).status()).toBe(204);
  expect((await request.delete(`/api/my-schedule/${id}`)).status()).toBe(204);
  expect(ids(await mine(request))).toEqual([]);
});

test("a session that starts when another ends is not a conflict", async ({ request }) => {
  const sessions = talks(await day(request, "2026-11-12"));
  const a = sessions.find((x) => sessions.some((y) => y.startsAt === x.endsAt && y.startsAt > x.startsAt));
  const b = sessions.find((y) => a !== undefined && y.startsAt === a.endsAt && y.startsAt > a.startsAt);
  expect(a !== undefined && b !== undefined).toBe(true);
  for (const s of [a, b]) expect((await request.put(`/api/my-schedule/${s?.id ?? ""}`)).status()).toBe(204);
  const schedule = await mine(request);
  expect(schedule.conflicted).toBe(0);
  expect(schedule.days.find((d) => d.day === "2026-11-12")?.sessions.every((s) => s.columns === 1)).toBe(true);
});

test("unknown and malformed session IDs are refused and store nothing", async ({ request }) => {
  for (const id of ["999999999", "..%2F..%2Fx", "a%20b", "x".repeat(65)]) {
    const res = await request.put(`/api/my-schedule/${id}`);
    expect(res.status(), id).toBe(404);
    expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
  }
  expect(ids(await mine(request))).toEqual([]);
});

test("each user sees and changes only their own selections", async ({ request }) => {
  const [first, second] = await day(request, "2026-11-12");
  const alice = await signIn(request);
  expect((await request.put(`/api/my-schedule/${first?.id ?? ""}`)).status()).toBe(204);

  await signIn(request);
  expect(ids(await mine(request))).toEqual([]);
  expect((await day(request, "2026-11-12")).some((s) => s.selected)).toBe(false);
  expect((await request.delete(`/api/my-schedule/${first?.id ?? ""}`)).status()).toBe(204);
  expect((await request.put(`/api/my-schedule/${second?.id ?? ""}`)).status()).toBe(204);
  expect(ids(await mine(request))).toEqual([second?.id]);

  await signIn(request, alice);
  expect(ids(await mine(request))).toEqual([first?.id]);
});

test("anonymous callers are refused", async ({ request }) => {
  await request.post("/api/auth/logout");
  for (const res of [await request.get("/api/my-schedule"), await request.put("/api/my-schedule/1"), await request.delete("/api/my-schedule/1")]) {
    expect(res.status()).toBe(401);
    expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
  }
});
