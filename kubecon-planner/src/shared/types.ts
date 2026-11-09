/**
 * Response and request shapes shared by the server routes and the browser pages.
 *
 * Times are event-local wall-clock times in Salt Lake City (America/Denver; MST, UTC-07:00, in
 * November), written `YYYY-MM-DDTHH:MM:SS` with no offset, exactly as Sessionize publishes them.
 * A day is the `YYYY-MM-DD` part of a session's start.
 */

/** The time zone every `startsAt`/`endsAt` is local to. */
export const EVENT_TIME_ZONE = "America/Denver";

export interface Speaker {
  readonly name: string;
  readonly company: string | null;
  readonly title: string | null;
}

/** One session as the list and the schedule grid show it (no description). */
export interface SessionSummary {
  /** The Sessionize session ID. */
  readonly id: string;
  readonly title: string;
  readonly day: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: string;
  /** The track or session type, e.g. "Maintainer Track", "Keynote Sessions", "CNCF-hosted Co-located Events". */
  readonly track: string;
  /** The session format where the feed has one, e.g. "Breakout Session"; null otherwise. */
  readonly format: string | null;
  /** The co-located event names this session belongs to, e.g. ["ArgoCon"]; empty for main-conference sessions. */
  readonly events: readonly string[];
  /** Speakers for display and search: "Name (Company), Name (Company)". */
  readonly speakers: string;
  /** Whether it is in the signed-in user's schedule. */
  readonly selected: boolean;
}

export interface SessionList {
  readonly sessions: readonly SessionSummary[];
}

export interface SessionDetail extends SessionSummary {
  readonly description: string;
  readonly speakerList: readonly Speaker[];
}

export interface DayCount {
  readonly day: string;
  readonly count: number;
}

export interface LastImport {
  /** Epoch milliseconds. */
  readonly at: number;
  readonly sessions: number;
}

/** What the browse page needs to build its filters. */
export interface ScheduleMeta {
  readonly sessionCount: number;
  readonly lastImport: LastImport | null;
  readonly days: readonly DayCount[];
  readonly tracks: readonly string[];
  readonly events: readonly string[];
  readonly timeZone: string;
}

export interface ImportResult {
  /** True when `onlyIfEmpty` was asked and the schedule already had sessions: nothing was fetched. */
  readonly skipped: boolean;
  readonly sessions: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
}

/** A selected session placed on its day's grid. */
export interface PlacedSession extends SessionSummary {
  /** Minutes after the day's midnight; the end is capped at 24:00 for a session that runs past midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
  /** 0-based column within its group of overlapping sessions, and the number of columns of that group. */
  readonly column: number;
  readonly columns: number;
  /** IDs of the other selected sessions whose time overlaps this one. */
  readonly conflictsWith: readonly string[];
}

export interface MyDay {
  readonly day: string;
  readonly sessions: readonly PlacedSession[];
}

export interface MySchedule {
  /** Every conference day (from the imported schedule), each with the user's selections on it. */
  readonly days: readonly MyDay[];
  /** The number of selected sessions that overlap at least one other selection. */
  readonly conflicted: number;
}
