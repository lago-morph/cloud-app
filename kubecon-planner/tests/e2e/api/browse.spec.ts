import { expect, test } from "@playwright/test";
import type { SessionDetail, SessionList, SessionSummary } from "../../../src/shared/types";
import { ensureImported, errorCode, signIn } from "./support";

/**
 * Flow: find sessions (search, filters) and read one session's details, through the HTTP API of a
 * local `dev` server holding the live 2026 schedule (imported if empty).
 *
 * Edge cases (the skill's reference/testing/e2e.md):
 * - Boundaries: no filter lists every day; a day with no sessions lists none; a search of 100
 *   characters is accepted and 101 refused; a blank search is no filter.
 * - Text: search ignores ASCII case; `%` and `_` are literal, not wildcards; a Unicode search term
 *   is accepted; an event name that is a prefix of another ("Argo" of "ArgoCon") matches nothing;
 *   `..`, `/` and percent-encoding in a session ID answer 404.
 * - Order and time: sessions come back by event-local start time, grouped by day in date order.
 * - Access: anonymous is refused (401); the `selected` flag is per user (my-schedule.spec.ts).
 * - Repetition: reads only; repeating them changes nothing.
 * - Failures: an unavailable database is in-process only (tests/app.test.ts).
 */

async function list(request: Parameters<typeof signIn>[0], params: Record<string, string> = {}): Promise<readonly SessionSummary[]> {
  const res = await request.get("/api/sessions", { params });
  expect(res.status()).toBe(200);
  const body: SessionList = await res.json();
  return body.sessions;
}

test.beforeEach(async ({ request }) => {
  await signIn(request);
  await ensureImported(request);
});

test("lists every session in start-time order, grouped by day, or one day's", async ({ request }) => {
  const everything = await list(request);
  expect(everything.length).toBeGreaterThan(700);
  const starts = everything.map((s) => s.startsAt);
  expect(starts).toEqual([...starts].sort());

  const tuesday = await list(request, { day: "2026-11-10" });
  expect(tuesday.length).toBeGreaterThan(50);
  expect(tuesday.every((s) => s.day === "2026-11-10" && s.startsAt.startsWith("2026-11-10T"))).toBe(true);
  expect(await list(request, { day: "2026-11-13" })).toEqual([]);
});

test("search matches title, speaker and company, ignoring case, with every word required", async ({ request }) => {
  const argo = await list(request, { q: "ARGOCON" });
  expect(argo.length).toBeGreaterThan(0);
  expect(argo.every((s) => `${s.title} ${s.speakers}`.toLowerCase().includes("argocon"))).toBe(true);

  // A speaker and a company taken from the data itself, so the test holds as the schedule changes.
  const sample = (await list(request, { day: "2026-11-10" })).find((s) => /\(([^)]+)\)/.test(s.speakers));
  expect(sample).toBeDefined();
  const company = /\(([^)]+)\)/.exec(sample?.speakers ?? "")?.[1] ?? "";
  const speaker = (sample?.speakers ?? "").split(" (")[0] ?? "";
  expect((await list(request, { q: company.toLowerCase() })).map((s) => s.id)).toContain(sample?.id);
  expect((await list(request, { q: speaker.toUpperCase() })).map((s) => s.id)).toContain(sample?.id);

  const both = await list(request, { q: `${company} zzzz-no-such-word` });
  expect(both).toEqual([]);
  expect(await list(request, { q: "100%_" })).toEqual([]);
  expect((await list(request, { q: "   " })).length).toBe((await list(request)).length);
  expect((await request.get("/api/sessions", { params: { q: "ü🧩" } })).status()).toBe(200);
});

test("filters by track and by exact co-located event, combined with day", async ({ request }) => {
  const keynotes = await list(request, { track: "Keynote Sessions" });
  expect(keynotes.length).toBeGreaterThan(5);
  expect(keynotes.every((s) => s.track === "Keynote Sessions")).toBe(true);

  const observability = await list(request, { event: "Observability Day", day: "2026-11-09" });
  expect(observability.length).toBeGreaterThan(10);
  expect(observability.every((s) => s.events.includes("Observability Day") && s.day === "2026-11-09")).toBe(true);
  expect(await list(request, { event: "Argo" })).toEqual([]);
  expect(await list(request, { event: "Observability Day", day: "2026-11-10" })).toEqual([]);
});

test("invalid filters are refused", async ({ request }) => {
  for (const params of [{ day: "11/10/2026" }, { q: "x".repeat(101) }, { track: "x".repeat(201) }]) {
    const res = await request.get("/api/sessions", { params });
    expect(res.status(), JSON.stringify(params).slice(0, 40)).toBe(400);
    expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
  }
  expect((await request.get("/api/sessions", { params: { q: "x".repeat(100) } })).status()).toBe(200);
});

test("a session's details give its description, speakers and room", async ({ request }) => {
  const withSpeakers = (await list(request, { day: "2026-11-10", track: "Maintainer Track" }))[0];
  expect(withSpeakers).toBeDefined();
  const res = await request.get(`/api/sessions/${withSpeakers?.id ?? ""}`);
  expect(res.status()).toBe(200);
  const detail: SessionDetail = await res.json();
  expect(detail).toMatchObject({ id: withSpeakers?.id, title: withSpeakers?.title, room: withSpeakers?.room });
  expect(detail.room).toMatch(/\|/);
  expect(detail.description.length).toBeGreaterThan(0);
  expect(detail.speakerList.length).toBeGreaterThan(0);
  expect(typeof detail.speakerList[0]?.name).toBe("string");
});

test("an unknown or malformed session ID answers 404, and anonymous callers 401", async ({ request }) => {
  for (const id of ["999999999", "..%2F..%2Fetc", "a%20b", "x".repeat(65)]) {
    const res = await request.get(`/api/sessions/${id}`);
    expect(res.status(), id).toBe(404);
    expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
  }
  await request.post("/api/auth/logout");
  const anonymous = await request.get("/api/sessions");
  expect(anonymous.status()).toBe(401);
  expect(await errorCode(anonymous)).toBe("AUTH.UNAUTHENTICATED");
});
