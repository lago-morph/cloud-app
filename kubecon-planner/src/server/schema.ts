import { defineTable, id, text, timestamp } from "@lago-morph/prototype-framework";

/**
 * One row per imported session, keyed by its Sessionize ID (`sessionizeId`, unique) so that a
 * re-import updates rows in place. Times are event-local text (`YYYY-MM-DDTHH:MM:SS`,
 * America/Denver), as the feed gives them.
 */
export const sessions = defineTable(
  "sessions",
  {
    id: id(),
    sessionizeId: text().unique(),
    source: text(),
    title: text(),
    description: text(),
    day: text(),
    startsAt: text(),
    endsAt: text(),
    room: text(),
    track: text(),
    format: text().nullable(),
    /** Co-located event names as "|ArgoCon|BackstageCon|" ("" for none), so one event matches by substring. */
    events: text(),
    /** JSON array of `Speaker`, validated on read. */
    speakers: text(),
    /** "Name (Company), …", for display and search. */
    speakerText: text(),
    /** Hash of the stored fields, so a re-import writes only the sessions that changed. */
    fingerprint: text(),
  },
  { indexes: [["day", "startsAt"]] },
);

/**
 * One row per session a user put in their schedule. It names the session by Sessionize ID, not
 * by row reference, so it survives a re-import (and a session that leaves the feed and returns).
 */
export const selections = defineTable(
  "selections",
  {
    id: id(),
    ownerId: text(),
    sessionizeId: text(),
    createdAt: timestamp(),
  },
  { uniques: [["ownerId", "sessionizeId"]] },
);
