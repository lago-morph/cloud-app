import { describe, expect, it } from "vitest";
import { layoutDay, minuteOfDay } from "../src/server/layout";
import type { PlacedSession, SessionSummary } from "../src/shared/types";

/**
 * Requirement 4: selected sessions on a day's vertical time grid, sized by duration, with
 * overlapping sessions side by side and marked as conflicts. Times are event-local text.
 */

function session(id: string, start: string, end: string, day = "2026-11-10"): SessionSummary {
  const endDay = end.length > 5 ? end.slice(0, 10) : day;
  const endTime = end.length > 5 ? end.slice(11) : end;
  return {
    id,
    title: `Session ${id}`,
    day,
    startsAt: `${day}T${start}:00`,
    endsAt: `${endDay}T${endTime}:00`,
    room: "Room",
    track: "Track",
    format: null,
    events: [],
    speakers: "",
    selected: true,
  };
}

function placement(placed: readonly PlacedSession[]): Record<string, [number, number, readonly string[]]> {
  return Object.fromEntries(placed.map((p) => [p.id, [p.column, p.columns, p.conflictsWith]]));
}

describe("minuteOfDay", () => {
  it("counts minutes after the day's midnight, and caps a time on a later day at 24:00", () => {
    expect(minuteOfDay("2026-11-10T00:00:00", "2026-11-10")).toBe(0);
    expect(minuteOfDay("2026-11-10T09:31:00", "2026-11-10")).toBe(571);
    expect(minuteOfDay("2026-11-11T00:00:00", "2026-11-10")).toBe(1440);
    expect(minuteOfDay("2026-11-11T02:00:00", "2026-11-10")).toBe(1440);
  });
});

describe("layoutDay", () => {
  it("places nothing for no selections", () => {
    expect(layoutDay([])).toEqual([]);
  });

  it("sizes one session by its start and end, in one column, with no conflict", () => {
    const [p] = layoutDay([session("a", "09:00", "09:31")]);
    expect(p).toMatchObject({ id: "a", startMinute: 540, endMinute: 571, column: 0, columns: 1, conflictsWith: [] });
  });

  it("puts two overlapping sessions side by side, the longer on the left, and marks each as conflicting with the other", () => {
    expect(placement(layoutDay([session("a", "11:30", "12:00"), session("b", "11:30", "12:50")]))).toEqual({
      a: [1, 2, ["b"]],
      b: [0, 2, ["a"]],
    });
  });

  it("does not treat a session that starts when another ends as a conflict", () => {
    expect(placement(layoutDay([session("a", "09:00", "10:00"), session("b", "10:00", "11:00")]))).toEqual({
      a: [0, 1, []],
      b: [0, 1, []],
    });
  });

  it("reuses a column freed inside a group: one long session against two short ones in turn", () => {
    expect(
      placement(layoutDay([session("long", "09:00", "11:00"), session("x", "09:00", "10:00"), session("y", "10:00", "11:00")])),
    ).toEqual({
      long: [0, 2, ["x", "y"]],
      x: [1, 2, ["long"]],
      y: [1, 2, ["long"]],
    });
  });

  it("groups a chain of overlaps together, but lists only direct overlaps as conflicts", () => {
    expect(
      placement(layoutDay([session("a", "09:00", "10:00"), session("b", "09:30", "10:30"), session("c", "10:15", "11:00")])),
    ).toEqual({
      a: [0, 2, ["b"]],
      b: [1, 2, ["a", "c"]],
      c: [0, 2, ["b"]],
    });
  });

  it("sizes separate groups independently", () => {
    const placed = placement(
      layoutDay([
        session("a", "09:00", "10:00"),
        session("b", "09:00", "10:00"),
        session("c", "09:00", "10:00"),
        session("d", "13:00", "14:00"),
      ]),
    );
    expect(placed["d"]).toEqual([0, 1, []]);
    expect([placed["a"]?.[0], placed["b"]?.[0], placed["c"]?.[0]].sort()).toEqual([0, 1, 2]);
    expect(placed["a"]?.[1]).toBe(3);
    expect(placed["a"]?.[2]).toEqual(["b", "c"]);
  });

  it("returns sessions ordered by start, then the longer first, then ID, whatever the input order", () => {
    const placed = layoutDay([session("z", "14:00", "15:00"), session("b", "09:00", "10:00"), session("c", "09:00", "09:30"), session("a", "09:00", "10:00")]);
    expect(placed.map((p) => p.id)).toEqual(["a", "b", "c", "z"]);
    expect(placed.map((p) => p.column)).toEqual([0, 1, 2, 0]);
  });

  it("caps a session that runs past midnight at the end of its day", () => {
    const [p] = layoutDay([session("late", "19:00", "2026-11-11T00:00")]);
    expect(p).toMatchObject({ startMinute: 1140, endMinute: 1440, columns: 1 });
  });

  it("counts a zero-length session inside another as a conflict", () => {
    expect(placement(layoutDay([session("a", "09:00", "10:00"), session("b", "09:30", "09:30")]))).toEqual({
      a: [0, 2, ["b"]],
      b: [1, 2, ["a"]],
    });
  });
});
