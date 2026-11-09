import { describe, expect, it } from "vitest";
import { FeedFormatError, mergeFeeds, parseFeed, speakerText, type FeedKind, type ParsedSession } from "../src/server/sessionize";
import { feed as colocatedFeed } from "./fixtures/sessionize/colocated";
import { feed as mainFeed } from "./fixtures/sessionize/main";
import { feed as maintainerFeed } from "./fixtures/sessionize/maintainer";
import { feed as sponsorFeed } from "./fixtures/sessionize/sponsor";

/**
 * The importer's pure parsing and merging (requirement 1), against small fixtures cut from the
 * Sessionize feeds in data/raw (see README "Test fixtures").
 */

function byId(sessions: readonly ParsedSession[], id: string): ParsedSession {
  const found = sessions.find((s) => s.id === id);
  if (found === undefined) throw new Error(`session ${id} not found`);
  return found;
}

function all(): { kind: FeedKind; sessions: ParsedSession[] }[] {
  return [
    { kind: "main", sessions: parseFeed(mainFeed, "main") },
    { kind: "colocated", sessions: parseFeed(colocatedFeed, "colocated") },
    { kind: "maintainer", sessions: parseFeed(maintainerFeed, "maintainer") },
    { kind: "sponsor", sessions: parseFeed(sponsorFeed, "sponsor") },
  ];
}

describe("parseFeed: main conference feed", () => {
  const sessions = parseFeed(mainFeed, "main");

  it("returns every session of the feed", () => {
    expect(sessions.map((s) => s.id).sort()).toEqual(
      ["1202489", "1250326", "1250350", "1289755", "1289947", "1302801", "1340051", "1344383", "1367757"],
    );
  });

  it("keeps the feed's event-local wall-clock times unchanged and derives the day from the start", () => {
    const keynote = byId(sessions, "1302801");
    expect(keynote).toMatchObject({
      title: "Welcome + Opening Remarks",
      day: "2026-11-10",
      startsAt: "2026-11-10T09:00:00",
      endsAt: "2026-11-10T09:31:00",
      room: "Salt Palace | Level 1 | Hall DE",
      track: "Keynote Sessions",
      format: null,
      events: [],
      source: "main",
    });
  });

  it("names each speaker with the company and title from the feed's questions", () => {
    const keynote = byId(sessions, "1302801");
    expect(keynote.speakers).toHaveLength(6);
    expect(keynote.speakers).toContainEqual({ name: "Chris Aniszczyk", company: "The Linux Foundation", title: "CTO, Cloud and Infrastructure" });
    // A speaker with no tagline still gets the company answer.
    expect(keynote.speakers).toContainEqual({ name: "Jonathan Bryce", company: "The Linux Foundation", title: "Executive Director, Cloud and Infrastructure" });
  });

  it("keeps a session that runs past midnight on the day it starts", () => {
    const late = byId(sessions, "1340051");
    expect(late.day).toBe("2026-11-11");
    expect(late.startsAt).toBe("2026-11-11T19:00:00");
    expect(late.endsAt).toBe("2026-11-12T00:00:00");
    expect(late.title.startsWith("🧩 Save Phippy")).toBe(true);
    expect(late.room).toBe("Off-Site Location");
  });

  it("gives the description, or an empty string when there is none", () => {
    expect(byId(sessions, "1250350").description.length).toBeGreaterThan(0);
    const umbrella = byId(sessions, "1289755");
    expect(typeof umbrella.description).toBe("string");
  });
});

describe("parseFeed: CNCF-hosted co-located feed", () => {
  const sessions = parseFeed(colocatedFeed, "colocated");

  it("puts the co-located event name in events, the format in format, under the co-located track", () => {
    expect(byId(sessions, "1311951")).toMatchObject({
      title: "ArgoCon Project Update",
      day: "2026-11-09",
      startsAt: "2026-11-09T09:10:00",
      endsAt: "2026-11-09T09:35:00",
      track: "CNCF-hosted Co-located Events",
      format: "Breakout Session",
      events: ["ArgoCon"],
      source: "colocated",
    });
    expect(byId(sessions, "1311951").speakers).toHaveLength(4);
  });

  it("files a break shared by several events under Breaks, with every event it belongs to", () => {
    const pause = byId(sessions, "1309409");
    expect(pause.track).toBe("Breaks");
    expect(pause.events).toEqual(["ArgoCon", "BackstageCon", "FluxCon", "Observability Day"]);
  });

  it("files the shared reception under Experiences", () => {
    const reception = byId(sessions, "1309453");
    expect(reception.track).toBe("Experiences");
    expect(reception.events).toHaveLength(11);
    expect(reception.events).toContain("Platform Engineering Day");
  });

  it("files registration entries under Registration", () => {
    expect(byId(sessions, "1311893").track).toBe("Registration");
    expect(byId(sessions, "1311893").events).toEqual([]);
  });
});

describe("parseFeed: Maintainer Summit feed", () => {
  const sessions = parseFeed(maintainerFeed, "maintainer");

  it("files every session under the Maintainer Summit track and event, with its category as format", () => {
    expect(byId(sessions, "1318410")).toMatchObject({
      day: "2026-11-08",
      track: "Maintainer Summit",
      events: ["CNCF Maintainer Summit"],
      format: "Keynote Sessions",
    });
    expect(byId(sessions, "1318410").speakers).toHaveLength(4);
  });
});

describe("parseFeed: edge cases", () => {
  const tiny = (session: Record<string, unknown>, speakers: unknown[] = []): unknown => ({
    sessions: [
      {
        id: "1",
        title: "  Padded title  ",
        description: null,
        startsAt: "2026-11-10T10:00:00",
        endsAt: "2026-11-10T10:30:00",
        speakers: [],
        categoryItems: [],
        roomId: null,
        ...session,
      },
    ],
    speakers,
    questions: [{ id: 10, question: "Company" }, { id: 11, question: "Speaker Title" }],
    categories: [],
    rooms: [],
  });

  it("trims the title, and uses defaults for a missing room, track and description", () => {
    const [s] = parseFeed(tiny({}), "main");
    expect(s).toMatchObject({ title: "Padded title", room: "", track: "Other", description: "", speakers: [] });
  });

  it("uses the tagline as the title of a speaker with no company answer", () => {
    const speaker = { id: "a", fullName: "Ada Lovelace", tagLine: "Engineer @ Analytical", questionAnswers: [] };
    const [s] = parseFeed(tiny({ speakers: ["a"] }, [speaker]), "main");
    expect(s?.speakers).toEqual([{ name: "Ada Lovelace", company: null, title: "Engineer @ Analytical" }]);
  });

  it("skips a session without a start or end time, and a speaker ID the feed does not list", () => {
    expect(parseFeed(tiny({ startsAt: null }), "main")).toEqual([]);
    expect(parseFeed(tiny({ endsAt: null }), "main")).toEqual([]);
    const [s] = parseFeed(tiny({ speakers: ["missing"] }), "main");
    expect(s?.speakers).toEqual([]);
  });

  it("accepts a numeric session ID and returns it as text", () => {
    const [s] = parseFeed(tiny({ id: 42 }), "main");
    expect(s?.id).toBe("42");
  });

  it("refuses a feed that is not Sessionize's All view", () => {
    expect(() => parseFeed({ sessions: "nope" }, "main")).toThrow(FeedFormatError);
    expect(() => parseFeed(null, "main")).toThrow(FeedFormatError);
    expect(() => parseFeed(tiny({ startsAt: "10:00" }), "main")).toThrow(FeedFormatError);
  });
});

describe("mergeFeeds", () => {
  it("drops the main feed's co-located umbrella blocks when the co-located feed has the detailed talks", () => {
    const merged = mergeFeeds(all());
    expect(merged.map((s) => s.id)).not.toContain("1289755");
    expect(merged.some((s) => s.title.includes("Hosted by CNCF"))).toBe(false);
  });

  it("keeps the umbrella blocks when the co-located feed has no sessions", () => {
    const feeds = all().map((f) => (f.kind === "colocated" ? { ...f, sessions: [] } : f));
    expect(mergeFeeds(feeds).map((s) => s.id)).toContain("1289755");
  });

  it("drops the co-located feed's registration entries, which repeat the main feed's", () => {
    const merged = mergeFeeds(all());
    expect(merged.map((s) => s.id)).not.toContain("1311893");
    expect(merged.map((s) => s.id)).toContain("1289947");
  });

  it("keeps one copy of a session the sponsor-hosted feed repeats, as the main feed has it", () => {
    const merged = mergeFeeds(all());
    const copies = merged.filter((s) => s.id === "1344383");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.source).toBe("main");
    expect(merged.map((s) => s.id)).toContain("1341814");
  });

  it("returns every other session once, ordered by start time then ID", () => {
    const merged = mergeFeeds(all());
    // main 9 - 1 umbrella, co-located 6 - 1 registration, Maintainer Summit 3, sponsor 2 - 1 repeat.
    expect(merged).toHaveLength(17);
    expect(new Set(merged.map((s) => s.id)).size).toBe(17);
    const keys = merged.map((s) => `${s.startsAt} ${s.id.padStart(12, "0")}`);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("speakerText", () => {
  it("joins names with their companies", () => {
    expect(
      speakerText([
        { name: "Ada", company: "Analytical", title: null },
        { name: "Grace", company: null, title: "Admiral" },
      ]),
    ).toBe("Ada (Analytical), Grace");
    expect(speakerText([])).toBe("");
  });
});
