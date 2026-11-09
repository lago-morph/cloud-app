import { desc, eq, jsonBody, newId, now, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { NoteList } from "../../shared/types";
import type { Env } from "../env";
import { notes } from "../schema";

export const newNote = z.object({ text: z.string().trim().min(1).max(500) });

/** SQL and log: a logged-in user writes notes and lists their own. */
export function noteRoutes(api: Hono<Env>): void {
  api.get("/notes", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select({ id: notes.id, text: notes.text, createdAt: notes.createdAt })
      .from(notes)
      .where(eq(notes.ownerId, c.var.user.id))
      .orderBy(desc(notes.createdAt), desc(notes.id))
      .limit(50);
    const body: NoteList = { notes: rows };
    return c.json(body);
  });

  api.post("/notes", requireUser(), jsonBody(newNote), async (c) => {
    const noteId = newId();
    await c.var.sql.insert(notes).values({
      id: noteId,
      ownerId: c.var.user.id,
      text: c.req.valid("json").text,
      createdAt: now(),
    });
    c.var.log.write("notes", "info", `note ${noteId} created`);
    return c.json({ id: noteId }, 201);
  });
}
