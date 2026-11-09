import { and, asc, eq, FrameworkError, newId, now, requireUser } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { MyDay, MySchedule, SessionSummary } from "../../shared/types";
import type { Env } from "../env";
import { layoutDay } from "../layout";
import { selections, sessions } from "../schema";
import { sessionIdSchema, summaryColumns, toSummary } from "../session-rows";

/** More selections than anyone could attend in five days. */
const MAX_SELECTIONS = 1000;

function sessionId(raw: string): string {
  const parsed = sessionIdSchema.safeParse(raw);
  if (!parsed.success) throw new FrameworkError("HTTP.NOT_FOUND", "session not found");
  return parsed.data;
}

/** The signed-in user's schedule: add and remove sessions, and see them by day (requirements 3 and 4). */
export function myScheduleRoutes(api: Hono<Env>): void {
  api.get("/my-schedule", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(selections)
      .innerJoin(sessions, eq(sessions.sessionizeId, selections.sessionizeId))
      .where(eq(selections.ownerId, c.var.user.id))
      .orderBy(asc(sessions.startsAt), asc(selections.id))
      .limit(MAX_SELECTIONS);
    const days = await c.var.sql.selectDistinct({ day: sessions.day }).from(sessions).orderBy(asc(sessions.day)).limit(100);
    const byDay = new Map<string, SessionSummary[]>(days.map((d) => [d.day, []]));
    for (const r of rows) byDay.get(r.day)?.push(toSummary(r, true));
    const placed: MyDay[] = [...byDay].map(([day, list]) => ({ day, sessions: layoutDay(list) }));
    const body: MySchedule = {
      days: placed,
      conflicted: placed.reduce((n, d) => n + d.sessions.filter((s) => s.conflictsWith.length > 0).length, 0),
    };
    return c.json(body);
  });

  api.put("/my-schedule/:id", requireUser(), async (c) => {
    const id = sessionId(c.req.param("id"));
    const [found] = await c.var.sql.select({ id: sessions.id }).from(sessions).where(eq(sessions.sessionizeId, id)).limit(1);
    if (found === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "session not found");
    await c.var.sql
      .insert(selections)
      .values({ id: newId(), ownerId: c.var.user.id, sessionizeId: id, createdAt: now() })
      .onConflictDoNothing({ target: [selections.ownerId, selections.sessionizeId] });
    return c.body(null, 204);
  });

  api.delete("/my-schedule/:id", requireUser(), async (c) => {
    const id = sessionId(c.req.param("id"));
    await c.var.sql.delete(selections).where(and(eq(selections.ownerId, c.var.user.id), eq(selections.sessionizeId, id)));
    return c.body(null, 204);
  });
}
