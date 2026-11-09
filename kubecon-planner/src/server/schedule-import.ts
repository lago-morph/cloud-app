import { atomic, eq, inArray, newId, type PortableDb, type WriteStep } from "@lago-morph/prototype-framework";
import type { Speaker } from "../shared/types";
import { sessions } from "./schema";
import { FEEDS, feedUrl, mergeFeeds, parseFeed, speakerText, type FeedKind, type ParsedSession } from "./sessionize";

/**
 * Fetches the Sessionize feeds and stores the merged schedule (requirement 1). Rows are matched
 * by Sessionize ID: new sessions are inserted, changed ones updated in place, and sessions no
 * longer in any feed deleted, all in one `atomic` unit. Selections name sessions by Sessionize ID,
 * so no import touches them.
 */

/** Per-feed request budget; Sessionize answered in well under a second when this was written. */
const FEED_TIMEOUT_MS = 20_000;
/** Bound parameters per statement (PAR-216): 15 columns per row, so 6 rows per insert. */
const MAX_PARAMS = 100;
const COLUMNS = 15;
const ROWS_PER_INSERT = Math.floor(MAX_PARAMS / COLUMNS);
/** Upper bound on stored sessions read back while importing (the 2026 feeds have about 860). */
const MAX_SESSIONS = 5000;

export interface StoreResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
}

type SessionRow = Omit<typeof sessions.$inferInsert, "id">;

/** The fetch the importer uses; the route passes the global `fetch`. */
export type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;

async function fetchFeed(fetcher: FeedFetch, kind: FeedKind, code: string): Promise<ParsedSession[]> {
  const url = feedUrl(code);
  const res = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Sessionize feed ${code} (${kind}) answered HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Sessionize feed ${code} (${kind}) did not answer JSON`);
  }
  try {
    return parseFeed(body, kind);
  } catch (error) {
    throw new Error(`Sessionize feed ${code}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Fetches every feed in `FEEDS` and merges them; throws, naming the feed, if any one fails. */
export async function fetchSchedule(fetcher: FeedFetch): Promise<ParsedSession[]> {
  const feeds = await Promise.all(FEEDS.map(async (f) => ({ kind: f.kind, sessions: await fetchFeed(fetcher, f.kind, f.code) })));
  return mergeFeeds(feeds);
}

function eventsColumn(events: readonly string[]): string {
  return events.length === 0 ? "" : `|${events.map((e) => e.replaceAll("|", "/")).join("|")}|`;
}

async function fingerprint(row: Omit<SessionRow, "fingerprint">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(row)));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function toRow(s: ParsedSession): Promise<SessionRow> {
  const speakers: readonly Speaker[] = s.speakers;
  const row = {
    sessionizeId: s.id,
    source: s.source,
    title: s.title,
    description: s.description,
    day: s.day,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    room: s.room,
    track: s.track,
    format: s.format,
    events: eventsColumn(s.events),
    speakers: JSON.stringify(speakers),
    speakerText: speakerText(speakers),
  };
  return { ...row, fingerprint: await fingerprint(row) };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Stores `merged` as the whole schedule. Refuses an empty schedule (a feed outage that answers
 * no sessions must not wipe the stored one).
 */
export async function storeSchedule(db: PortableDb, merged: readonly ParsedSession[]): Promise<StoreResult> {
  if (merged.length === 0) throw new Error("the Sessionize feeds returned no sessions; the stored schedule was kept");
  const existing = await db
    .select({ sessionizeId: sessions.sessionizeId, fingerprint: sessions.fingerprint })
    .from(sessions)
    .limit(MAX_SESSIONS);
  const stored = new Map(existing.map((r) => [r.sessionizeId, r.fingerprint]));
  const rows = await Promise.all(merged.map(toRow));
  const incoming = new Set(rows.map((r) => r.sessionizeId));

  const added = rows.filter((r) => !stored.has(r.sessionizeId));
  const changed = rows.filter((r) => stored.has(r.sessionizeId) && stored.get(r.sessionizeId) !== r.fingerprint);
  const removed = existing.map((r) => r.sessionizeId).filter((id) => !incoming.has(id));

  const steps: WriteStep[] = [
    ...chunks(added, ROWS_PER_INSERT).map((chunk): WriteStep => (w) => w.insert(sessions).values(chunk.map((r) => ({ id: newId(), ...r })))),
    ...changed.map((r): WriteStep => (w) => w.update(sessions).set(r).where(eq(sessions.sessionizeId, r.sessionizeId))),
    ...chunks(removed, MAX_PARAMS).map((chunk): WriteStep => (w) => w.delete(sessions).where(inArray(sessions.sessionizeId, chunk))),
  ];
  if (steps.length > 0) await atomic(db, steps);
  return { added: added.length, updated: changed.length, removed: removed.length };
}
