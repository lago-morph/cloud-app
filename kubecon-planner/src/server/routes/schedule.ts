import {
  and, asc, containsText, count, eq, FrameworkError, jsonBody, now, or, queryParams, requireUser, z, type PortableDb,
} from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { DayCount, ImportResult, LastImport, ScheduleMeta, SessionDetail, SessionList, SessionSummary } from "../../shared/types";
import { EVENT_TIME_ZONE } from "../../shared/types";
import type { Env } from "../env";
import { fetchSchedule, storeSchedule } from "../schedule-import";
import { selections, sessions } from "../schema";
import { eventList, sessionIdSchema, speakerList, summaryColumns, toSummary } from "../session-rows";

const LAST_IMPORT_KEY = "schedule:last-import";
const lastImportSchema = z.object({ at: z.number(), sessions: z.number() });
/** More than any day of the 2026 schedule has (Monday: about 300). */
const MAX_PER_DAY = 1000;
const MAX_ROWS = 5000;

export const refreshBody = z.object({ onlyIfEmpty: z.boolean().optional() });

export const sessionQuery = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  track: z.string().min(1).max(200).optional(),
  event: z.string().min(1).max(200).optional(),
});

async function sessionCount(db: PortableDb): Promise<number> {
  const [row] = await db.select({ n: count() }).from(sessions);
  return row?.n ?? 0;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The schedule: importing it, its filters, the session list and one session's details. */
export function scheduleRoutes(api: Hono<Env>): void {
  api.get("/schedule/meta", requireUser(), async (c) => {
    const rows = await c.var.sql.select({ day: sessions.day, track: sessions.track, events: sessions.events }).from(sessions).limit(MAX_ROWS);
    const days = new Map<string, number>();
    const tracks = new Set<string>();
    const events = new Set<string>();
    for (const r of rows) {
      days.set(r.day, (days.get(r.day) ?? 0) + 1);
      tracks.add(r.track);
      for (const e of eventList(r.events)) events.add(e);
    }
    const stored = await c.var.kv.get(LAST_IMPORT_KEY);
    let lastImport: LastImport | null = null;
    if (stored !== null) {
      try {
        const parsed = lastImportSchema.safeParse(JSON.parse(stored));
        if (parsed.success) lastImport = parsed.data;
      } catch {
        lastImport = null;
      }
    }
    const dayCounts: DayCount[] = [...days].map(([day, n]) => ({ day, count: n })).sort((a, b) => byText(a.day, b.day));
    const body: ScheduleMeta = {
      sessionCount: rows.length,
      lastImport,
      days: dayCounts,
      tracks: [...tracks].sort(byText),
      events: [...events].sort(byText),
      timeZone: EVENT_TIME_ZONE,
    };
    return c.json(body);
  });

  api.post("/schedule/refresh", requireUser(), jsonBody(refreshBody), async (c) => {
    if (c.req.valid("json").onlyIfEmpty === true) {
      const n = await sessionCount(c.var.sql);
      if (n > 0) {
        const skipped: ImportResult = { skipped: true, sessions: n, added: 0, updated: 0, removed: 0 };
        return c.json(skipped);
      }
    }
    const merged = await fetchSchedule((url, init) => fetch(url, init));
    const stored = await storeSchedule(c.var.sql, merged);
    const record: LastImport = { at: now(), sessions: merged.length };
    await c.var.kv.put(LAST_IMPORT_KEY, JSON.stringify(record));
    c.var.log.write("import", "info", `schedule imported: ${merged.length} sessions, ${stored.added} added, ${stored.updated} updated, ${stored.removed} removed`);
    const body: ImportResult = { skipped: false, sessions: merged.length, ...stored };
    return c.json(body);
  });

  api.get("/sessions", requireUser(), queryParams(sessionQuery), async (c) => {
    const { day, q, track, event } = c.req.valid("query");
    const terms = (q ?? "").split(/\s+/).filter((t) => t !== "").slice(0, 10);
    const filters = [
      track === undefined ? undefined : eq(sessions.track, track),
      event === undefined ? undefined : containsText(sessions.events, `|${event}|`),
      ...terms.map((term) => or(containsText(sessions.title, term), containsText(sessions.speakerText, term))),
    ];
    // One query per day keeps each result well under the 256 KiB select limit (PAR-215).
    const days = day === undefined
      ? (await c.var.sql.selectDistinct({ day: sessions.day }).from(sessions).orderBy(asc(sessions.day)).limit(100)).map((r) => r.day)
      : [day];
    const out: SessionSummary[] = [];
    for (const d of days) {
      const rows = await c.var.sql
        .select({ ...summaryColumns, selectionId: selections.id })
        .from(sessions)
        .leftJoin(selections, and(eq(selections.sessionizeId, sessions.sessionizeId), eq(selections.ownerId, c.var.user.id)))
        .where(and(eq(sessions.day, d), ...filters))
        .orderBy(asc(sessions.startsAt), asc(sessions.title), asc(sessions.id))
        .limit(MAX_PER_DAY);
      for (const r of rows) out.push(toSummary(r, r.selectionId !== null));
    }
    const body: SessionList = { sessions: out };
    return c.json(body);
  });

  api.get("/sessions/:id", requireUser(), async (c) => {
    const id = sessionIdSchema.safeParse(c.req.param("id"));
    if (!id.success) throw new FrameworkError("HTTP.NOT_FOUND", "session not found");
    const [row] = await c.var.sql
      .select({ ...summaryColumns, description: sessions.description, speakers: sessions.speakers, selectionId: selections.id })
      .from(sessions)
      .leftJoin(selections, and(eq(selections.sessionizeId, sessions.sessionizeId), eq(selections.ownerId, c.var.user.id)))
      .where(eq(sessions.sessionizeId, id.data))
      .limit(1);
    if (row === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "session not found");
    const body: SessionDetail = {
      ...toSummary(row, row.selectionId !== null),
      description: row.description,
      speakerList: speakerList(row.speakers),
    };
    return c.json(body);
  });
}
