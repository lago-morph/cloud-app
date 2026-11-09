import type { PlacedSession, SessionSummary } from "../shared/types";

/**
 * Places one day's selected sessions on a vertical time grid (requirement 4). Pure: times are
 * the event-local `YYYY-MM-DDTHH:MM:SS` text the feed gives, compared as text and never
 * converted through a time zone.
 */

const DAY_MINUTES = 24 * 60;

/** Minutes after `day`'s midnight; a time on a later day is capped at 24:00. */
export function minuteOfDay(time: string, day: string): number {
  if (time.slice(0, 10) > day) return DAY_MINUTES;
  return Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether two sessions' times overlap; one that starts when the other ends does not. */
function overlaps(a: SessionSummary, b: SessionSummary): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Orders sessions by start, then the longer first, then ID; splits them into groups of
 * transitively overlapping sessions; gives each session the leftmost column free at its start
 * within its group, and each group as many columns as it uses. `conflictsWith` lists only the
 * sessions that overlap this one directly.
 */
export function layoutDay(sessions: readonly SessionSummary[]): PlacedSession[] {
  const ordered = [...sessions].sort(
    (a, b) => compare(a.startsAt, b.startsAt) || compare(b.endsAt, a.endsAt) || compare(a.id, b.id),
  );
  const placed: PlacedSession[] = [];
  let group: { session: SessionSummary; column: number }[] = [];
  let columnEnds: string[] = [];
  let groupEnd = "";

  const closeGroup = (): void => {
    for (const { session, column } of group) {
      placed.push({
        ...session,
        startMinute: minuteOfDay(session.startsAt, session.day),
        endMinute: minuteOfDay(session.endsAt, session.day),
        column,
        columns: columnEnds.length,
        conflictsWith: group
          .filter((other) => other.session.id !== session.id && overlaps(other.session, session))
          .map((other) => other.session.id)
          .sort(compare),
      });
    }
    group = [];
    columnEnds = [];
    groupEnd = "";
  };

  for (const session of ordered) {
    if (group.length > 0 && session.startsAt >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= session.startsAt);
    if (column === -1) column = columnEnds.push(session.endsAt) - 1;
    else columnEnds[column] = session.endsAt;
    group.push({ session, column });
    if (session.endsAt > groupEnd) groupEnd = session.endsAt;
  }
  closeGroup();
  return placed;
}
