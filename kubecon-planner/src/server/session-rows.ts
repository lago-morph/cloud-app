import { z } from "@lago-morph/prototype-framework";
import type { SessionSummary, Speaker } from "../shared/types";
import { sessions } from "./schema";

/** The columns a `SessionSummary` is built from (no description, no speaker JSON). */
export const summaryColumns = {
  sessionizeId: sessions.sessionizeId,
  title: sessions.title,
  day: sessions.day,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  room: sessions.room,
  track: sessions.track,
  format: sessions.format,
  events: sessions.events,
  speakerText: sessions.speakerText,
};

export interface SummaryRow {
  readonly sessionizeId: string;
  readonly title: string;
  readonly day: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: string;
  readonly track: string;
  readonly format: string | null;
  readonly events: string;
  readonly speakerText: string;
}

/** "|ArgoCon|FluxCon|" → ["ArgoCon", "FluxCon"]. */
export function eventList(column: string): string[] {
  return column.split("|").filter((e) => e !== "");
}

export function toSummary(row: SummaryRow, selected: boolean): SessionSummary {
  return {
    id: row.sessionizeId,
    title: row.title,
    day: row.day,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    room: row.room,
    track: row.track,
    format: row.format,
    events: eventList(row.events),
    speakers: row.speakerText,
    selected,
  };
}

const speakerSchema = z.array(z.object({ name: z.string(), company: z.string().nullable(), title: z.string().nullable() }));

/** The stored speaker JSON, or an empty list if it does not parse. */
export function speakerList(column: string): Speaker[] {
  try {
    const parsed = speakerSchema.safeParse(JSON.parse(column));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Sessionize session IDs: digits in the 2026 feeds; letters and hyphens allowed for service sessions. */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
