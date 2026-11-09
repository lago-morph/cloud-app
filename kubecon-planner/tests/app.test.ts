import { createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import app from "../src/app";
import type { ImportResult, MySchedule, PlacedSession, ScheduleMeta, SessionDetail, SessionList } from "../src/shared/types";
import { editFeed, fakeSessionize, fixtureFeeds, type FakeSessionize } from "./support/feeds";

/**
 * Routes in process, on both SQL dialects (`verify` runs this file on SQLite and Postgres), with
 * the Sessionize API replaced by fixtures (tests/support/feeds.ts).
 *
 * Fixture facts used below: 17 sessions after merging; on Tuesday 2026-11-10, 1250350 and
 * 1202489 run 11:30-12:00 and 1250326 runs 11:30-12:50 (all three overlap); 1302801 is the
 * opening keynote (09:00-09:31, six speakers, Chris Aniszczyk of The Linux Foundation).
 */

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

let opened: TestApp[] = [];
let sessionize: FakeSessionize;

async function open(options?: Parameters<typeof createTestApp>[1]): Promise<TestApp> {
  const t = await createTestApp(app, options);
  opened.push(t);
  return t;
}

beforeEach(() => {
  sessionize = fakeSessionize();
});

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
  vi.unstubAllGlobals();
});

async function refresh(t: TestApp, body: unknown = {}): Promise<Response> {
  return t.request("/api/schedule/refresh", json("POST", body));
}

async function imported(): Promise<{ t: TestApp; alice: TestApp; bob: TestApp }> {
  const t = await open();
  const alice = t.as(mockUsers.user("alice"));
  const bob = t.as(mockUsers.user("bob"));
  expect((await refresh(alice)).status).toBe(200);
  return { t, alice, bob };
}

async function list(t: TestApp, query = ""): Promise<SessionList> {
  const res = await t.request(`/api/sessions${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

async function mine(t: TestApp): Promise<MySchedule> {
  const res = await t.request("/api/my-schedule");
  expect(res.status).toBe(200);
  return res.json();
}

const select = (t: TestApp, id: string): Promise<Response> => t.request(`/api/my-schedule/${id}`, { method: "PUT" });
const unselect = (t: TestApp, id: string): Promise<Response> => t.request(`/api/my-schedule/${id}`, { method: "DELETE" });

async function errorCode(res: Response): Promise<string | undefined> {
  const body: { error?: { code?: string } } = await res.json();
  return body.error?.code;
}

describe("access", () => {
  it("refuses every route to an anonymous caller", async () => {
    const t = await open();
    const requests: [string, RequestInit?][] = [
      ["/api/schedule/meta"],
      ["/api/schedule/refresh", json("POST", {})],
      ["/api/sessions"],
      ["/api/sessions/1302801"],
      ["/api/my-schedule"],
      ["/api/my-schedule/1302801", { method: "PUT" }],
      ["/api/my-schedule/1302801", { method: "DELETE" }],
    ];
    for (const [path, init] of requests) {
      const res = await t.request(path, init);
      expect(res.status, `${init?.method ?? "GET"} ${path}`).toBe(401);
      expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
    }
    expect(sessionize.calls).toEqual([]);
  });
});

describe("import (POST /api/schedule/refresh)", () => {
  it("starts empty", async () => {
    const t = await open({ user: mockUsers.user() });
    const res = await t.request("/api/schedule/meta");
    expect(res.status).toBe(200);
    const meta: ScheduleMeta = await res.json();
    expect(meta).toEqual({ sessionCount: 0, lastImport: null, days: [], tracks: [], events: [], timeZone: "America/Denver" });
  });

  it("fetches the four feeds once each, stores the merged sessions, and records the import", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T17:00:00Z"));
    try {
      const t = await open({ user: mockUsers.user() });
      const res = await refresh(t);
      expect(res.status).toBe(200);
      const result: ImportResult = await res.json();
      expect(result).toEqual({ skipped: false, sessions: 17, added: 17, updated: 0, removed: 0 });
      expect([...sessionize.calls].sort()).toEqual([
        "https://sessionize.com/api/v2/ayajbd6b/view/All",
        "https://sessionize.com/api/v2/etvmcsmr/view/All",
        "https://sessionize.com/api/v2/qtujim6y/view/All",
        "https://sessionize.com/api/v2/svi82w6c/view/All",
      ]);

      const meta: ScheduleMeta = await (await t.request("/api/schedule/meta")).json();
      expect(meta.sessionCount).toBe(17);
      expect(meta.lastImport).toEqual({ at: Date.parse("2026-11-09T17:00:00Z"), sessions: 17 });
      expect(meta.days).toEqual([
        { day: "2026-11-08", count: 4 },
        { day: "2026-11-09", count: 7 },
        { day: "2026-11-10", count: 5 },
        { day: "2026-11-11", count: 1 },
      ]);
      expect(meta.tracks).toContain("Keynote Sessions");
      expect(meta.tracks).toContain("CNCF-hosted Co-located Events");
      expect(meta.tracks).toEqual([...meta.tracks].sort());
      expect(meta.events).toEqual([
        "Agentics Day: MCP + Agents", "ArgoCon", "BackstageCon", "CNCF Maintainer Summit", "CiliumCon",
        "Cloud Native AI + Inference Day", "FluxCon", "Kubernetes on Edge Day", "Observability Day",
        "Open Source SecurityCon", "OpenTofu Day", "Platform Engineering Day",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with onlyIfEmpty, imports into an empty schedule and later does nothing", async () => {
    const t = await open({ user: mockUsers.user() });
    const first: ImportResult = await (await refresh(t, { onlyIfEmpty: true })).json();
    expect(first).toMatchObject({ skipped: false, sessions: 17, added: 17 });
    const calls = sessionize.calls.length;
    const second: ImportResult = await (await refresh(t, { onlyIfEmpty: true })).json();
    expect(second).toEqual({ skipped: true, sessions: 17, added: 0, updated: 0, removed: 0 });
    expect(sessionize.calls.length).toBe(calls);
  });

  it("a re-import updates changed sessions in place, removes dropped ones, and keeps every selection", async () => {
    const { alice } = await imported();
    for (const id of ["1302801", "1250350", "1367757"]) expect((await select(alice, id)).status).toBe(204);

    sessionize.setJson(
      "main",
      editFeed(fixtureFeeds.main, (sessions) =>
        sessions
          .filter((s) => s.id !== "1367757")
          .map((s) => (s.id === "1302801" ? { ...s, title: "Welcome + Opening Remarks (updated)" } : s)),
      ),
    );
    const again: ImportResult = await (await refresh(alice)).json();
    expect(again).toEqual({ skipped: false, sessions: 16, added: 0, updated: 1, removed: 1 });

    const tuesday = (await mine(alice)).days.find((d) => d.day === "2026-11-10");
    expect(tuesday?.sessions.map((s) => [s.id, s.title])).toEqual([
      ["1302801", "Welcome + Opening Remarks (updated)"],
      ["1250350", expect.any(String)],
    ]);

    // The dropped session comes back with the next import, still selected.
    sessionize.setJson("main", fixtureFeeds.main);
    const back: ImportResult = await (await refresh(alice)).json();
    expect(back).toEqual({ skipped: false, sessions: 17, added: 1, updated: 1, removed: 0 });
    const ids = (await mine(alice)).days.flatMap((d) => d.sessions.map((s) => s.id));
    expect(ids.sort()).toEqual(["1250350", "1302801", "1367757"]);
  });

  it("an unchanged re-import writes nothing", async () => {
    const { alice } = await imported();
    const again: ImportResult = await (await refresh(alice)).json();
    expect(again).toEqual({ skipped: false, sessions: 17, added: 0, updated: 0, removed: 0 });
  });

  it("keeps the stored schedule when a feed fails, answers an error, and logs which feed", async () => {
    const { t, alice } = await imported();
    for (const broken of [
      () => new Response("unavailable", { status: 503 }),
      () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => Response.json({ sessions: "not a list" }),
    ]) {
      sessionize.setResponse("colocated", broken);
      const res = await refresh(alice);
      expect(res.status).toBe(500);
      expect(await errorCode(res)).toBe("CORE.INTERNAL");
    }
    const meta: ScheduleMeta = await (await alice.request("/api/schedule/meta")).json();
    expect(meta.sessionCount).toBe(17);
    const errors = t.logs().filter((e) => e.severity === "error").map((e) => JSON.stringify(e));
    expect(errors.some((e) => e.includes("ayajbd6b"))).toBe(true);
  });

  it("refuses to replace the schedule with an empty one", async () => {
    const { alice } = await imported();
    for (const kind of ["main", "colocated", "maintainer", "sponsor"] as const) sessionize.setJson(kind, editFeed(fixtureFeeds[kind], () => []));
    const res = await refresh(alice);
    expect(res.status).toBe(500);
    const meta: ScheduleMeta = await (await alice.request("/api/schedule/meta")).json();
    expect(meta.sessionCount).toBe(17);
  });

  it("refuses an invalid body", async () => {
    const t = await open({ user: mockUsers.user() });
    for (const body of [{ onlyIfEmpty: "yes" }, [], "x"]) {
      const res = await refresh(t, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
    }
    expect(sessionize.calls).toEqual([]);
  });

  it("answers SQL.UNAVAILABLE when the database is down", async () => {
    const t = await open({ user: mockUsers.user(), unavailable: ["sql"] });
    const res = await refresh(t);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("SQL.UNAVAILABLE");
  });
});

describe("browse (GET /api/sessions)", () => {
  it("lists every session ordered by start time then title, or one day's", async () => {
    const { alice } = await imported();
    const everything = await list(alice);
    expect(everything.sessions).toHaveLength(17);
    const starts = everything.sessions.map((s) => s.startsAt);
    expect(starts).toEqual([...starts].sort());

    const tuesday = await list(alice, "?day=2026-11-10");
    expect(tuesday.sessions.map((s) => s.id)).toEqual(["1302801", "1367757", "1250326", "1250350", "1202489"]);
    expect(tuesday.sessions.every((s) => s.day === "2026-11-10")).toBe(true);
    expect((await list(alice, "?day=2026-11-13")).sessions).toEqual([]);
  });

  it("returns the fields the list shows, with event-local times", async () => {
    const { alice } = await imported();
    const argo = (await list(alice, "?day=2026-11-09")).sessions.find((s) => s.id === "1311951");
    expect(argo).toMatchObject({
      title: "ArgoCon Project Update",
      startsAt: "2026-11-09T09:10:00",
      endsAt: "2026-11-09T09:35:00",
      track: "CNCF-hosted Co-located Events",
      format: "Breakout Session",
      events: ["ArgoCon"],
      selected: false,
    });
    expect(argo?.speakers.length).toBeGreaterThan(0);
  });

  it("searches title, speaker name and company, ignoring case, with every word required", async () => {
    const { alice } = await imported();
    const ids = async (q: string): Promise<string[]> => (await list(alice, `?q=${encodeURIComponent(q)}`)).sessions.map((s) => s.id);
    expect(await ids("argocon PROJECT")).toEqual(["1311951"]);
    expect(await ids("aniszczyk")).toEqual(["1302801"]);
    expect(await ids("trade desk")).toContain("1250350");
    expect(await ids("argocon nosuchword")).toEqual([]);
    expect(await ids("   ")).toHaveLength(17);
    expect(await ids("100%")).toEqual([]);
    expect(await ids("🧩")).toEqual(["1340051"]);
  });

  it("filters by track and by exact co-located event name, combined with day and search", async () => {
    const { alice } = await imported();
    const keynotes = await list(alice, `?track=${encodeURIComponent("Keynote Sessions")}`);
    expect(keynotes.sessions.map((s) => s.id)).toEqual(["1302801", "1367757"]);

    const argo = await list(alice, "?event=ArgoCon");
    expect(argo.sessions.map((s) => s.id).sort()).toEqual(["1309409", "1309453", "1311945", "1311951", "1312032"]);
    expect((await list(alice, "?event=Argo")).sessions).toEqual([]);

    const combined = await list(alice, `?day=2026-11-09&event=ArgoCon&q=break`);
    expect(combined.sessions.map((s) => s.id)).toEqual(["1309409"]);
  });

  it("refuses invalid filters", async () => {
    const { alice } = await imported();
    for (const query of ["?day=11/10", "?day=2026-11-1", `?q=${"x".repeat(101)}`, `?track=${"x".repeat(201)}`]) {
      const res = await alice.request(`/api/sessions${query}`);
      expect(res.status, query).toBe(400);
      expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
    }
  });

  it("marks only the caller's own selections as selected", async () => {
    const { alice, bob } = await imported();
    expect((await select(alice, "1302801")).status).toBe(204);
    const forAlice = await list(alice, "?day=2026-11-10");
    expect(forAlice.sessions.filter((s) => s.selected).map((s) => s.id)).toEqual(["1302801"]);
    const forBob = await list(bob, "?day=2026-11-10");
    expect(forBob.sessions.some((s) => s.selected)).toBe(false);
  });
});

describe("session details (GET /api/sessions/:id)", () => {
  it("gives the description, speakers with companies, and room", async () => {
    const { alice } = await imported();
    const res = await alice.request("/api/sessions/1302801");
    expect(res.status).toBe(200);
    const detail: SessionDetail = await res.json();
    expect(detail).toMatchObject({ id: "1302801", room: "Salt Palace | Level 1 | Hall DE", selected: false, description: "" });
    expect(detail.speakerList).toHaveLength(6);
    const talk: SessionDetail = await (await alice.request("/api/sessions/1250350")).json();
    expect(talk.description.startsWith("On-premises compute is inelastic")).toBe(true);
    expect(detail.speakerList).toContainEqual({ name: "Chris Aniszczyk", company: "The Linux Foundation", title: "CTO, Cloud and Infrastructure" });
  });

  it("answers 404 for an unknown or malformed ID", async () => {
    const { alice } = await imported();
    for (const id of ["999999999", "..%2F..", "x".repeat(65), "%20"]) {
      const res = await alice.request(`/api/sessions/${id}`);
      expect(res.status, id).toBe(404);
      expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
    }
  });
});

describe("my schedule", () => {
  it("saves conflicting selections and places them side by side, marked as conflicts", async () => {
    const { alice } = await imported();
    for (const id of ["1250350", "1250326", "1302801"]) expect((await select(alice, id)).status).toBe(204);

    const schedule = await mine(alice);
    expect(schedule.days.map((d) => d.day)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(schedule.conflicted).toBe(2);
    const tuesday = schedule.days.find((d) => d.day === "2026-11-10")?.sessions ?? [];
    const byId = (id: string): PlacedSession | undefined => tuesday.find((s) => s.id === id);
    expect(byId("1302801")).toMatchObject({ startMinute: 540, endMinute: 571, column: 0, columns: 1, conflictsWith: [] });
    expect(byId("1250326")).toMatchObject({ startMinute: 690, endMinute: 770, column: 0, columns: 2, conflictsWith: ["1250350"] });
    expect(byId("1250350")).toMatchObject({ startMinute: 690, endMinute: 720, column: 1, columns: 2, conflictsWith: ["1250326"] });
    expect(schedule.days.find((d) => d.day === "2026-11-09")?.sessions).toEqual([]);
  });

  it("adding twice keeps one selection; removing takes it out; removing again is fine", async () => {
    const { alice } = await imported();
    expect((await select(alice, "1302801")).status).toBe(204);
    expect((await select(alice, "1302801")).status).toBe(204);
    expect((await mine(alice)).days.flatMap((d) => d.sessions).map((s) => s.id)).toEqual(["1302801"]);
    expect((await unselect(alice, "1302801")).status).toBe(204);
    expect((await mine(alice)).days.flatMap((d) => d.sessions)).toEqual([]);
    expect((await unselect(alice, "1302801")).status).toBe(204);
  });

  it("refuses to add a session that does not exist", async () => {
    const { alice } = await imported();
    for (const id of ["999999999", "bad%20id"]) {
      const res = await select(alice, id);
      expect(res.status, id).toBe(404);
      expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
    }
    expect((await mine(alice)).days.flatMap((d) => d.sessions)).toEqual([]);
  });

  it("is private to each user", async () => {
    const { alice, bob } = await imported();
    expect((await select(alice, "1250350")).status).toBe(204);
    expect((await select(bob, "1302801")).status).toBe(204);
    expect((await mine(alice)).days.flatMap((d) => d.sessions).map((s) => s.id)).toEqual(["1250350"]);
    expect((await mine(bob)).days.flatMap((d) => d.sessions).map((s) => s.id)).toEqual(["1302801"]);
    // Bob removing Alice's session removes nothing of hers.
    expect((await unselect(bob, "1250350")).status).toBe(204);
    expect((await mine(alice)).days.flatMap((d) => d.sessions).map((s) => s.id)).toEqual(["1250350"]);
  });

  it("is empty, with no days, before any import", async () => {
    const t = await open({ user: mockUsers.user() });
    expect(await mine(t)).toEqual({ days: [], conflicted: 0 });
  });

  it("caps a selection that runs past midnight at the end of its day", async () => {
    const { alice } = await imported();
    expect((await select(alice, "1340051")).status).toBe(204);
    const wednesday = (await mine(alice)).days.find((d) => d.day === "2026-11-11")?.sessions ?? [];
    expect(wednesday).toHaveLength(1);
    expect(wednesday[0]).toMatchObject({ startMinute: 1140, endMinute: 1440 });
  });
});
