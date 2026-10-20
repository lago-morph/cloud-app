# Example: storing rows in SQL, with validation and a log entry

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `schema.ts`: one table with `id()`, an owner column, an index that matches the query.
- `routes/notes.ts`: `requireUser()` on each route, `jsonBody` with a Zod schema, a `select` ordered by `desc(createdAt), desc(id)` (a total order) with `limit`, an `insert` with `newId()` and `now()`, and `c.var.log.write`.
- `pages/notes.ts`: the browser page for it.
- The generated migrations for both dialects (made by `generate-migration`, never edited).
- From the reference app, `evolution.ts`: `atomic` for an all-or-nothing multi-row write, an inner join, and `asc` ordering.

## `apps/template/src/server/schema.ts`

<!-- example-source: apps/template/src/server/schema.ts -->
```ts
import { defineTable, id, text, timestamp } from "@lago-morph/prototype-framework";

/** One note per row, owned by the user who wrote it. */
export const notes = defineTable(
  "notes",
  {
    id: id(),
    ownerId: text(),
    text: text(),
    createdAt: timestamp(),
  },
  { indexes: [["ownerId", "createdAt"]] },
);
```

## `apps/template/src/server/routes/notes.ts`

<!-- example-source: apps/template/src/server/routes/notes.ts -->
```ts
import { desc, eq, jsonBody, newId, now, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { NoteList } from "../../shared/types";
import type { Env } from "../env";
import { notes } from "../schema";

const newNote = z.object({ text: z.string().trim().min(1).max(500) });

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
```

## `apps/template/src/client/pages/notes.ts`

<!-- example-source: apps/template/src/client/pages/notes.ts -->
```ts
import { api } from "@lago-morph/prototype-framework/client";
import type { NoteList } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Write a note and list your own notes (SQL). */
export function notesPage(): HTMLElement {
  const page = section("Notes");
  const input = el("input");
  input.placeholder = "Write a note";
  const add = el("button", "Add");
  const message = el("p");
  const list = el("ul");
  page.append(input, add, message, list);

  async function refresh(): Promise<void> {
    const { notes } = await api<NoteList>("/notes");
    list.replaceChildren(...notes.map((n) => el("li", `${new Date(n.createdAt).toLocaleString()}: ${n.text}`)));
  }

  add.addEventListener("click", () => {
    message.textContent = "";
    void api("/notes", { method: "POST", body: { text: input.value } })
      .then(() => {
        input.value = "";
        return refresh();
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
```

## `apps/template/migrations/sqlite/0000_schema.sql`

<!-- example-source: apps/template/migrations/sqlite/0000_schema.sql -->
```sql
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_owner_id_created_at_idx` ON `notes` (`owner_id`,`created_at`);
```

## `apps/template/migrations/postgres/0000_schema.sql`

<!-- example-source: apps/template/migrations/postgres/0000_schema.sql -->
```sql
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_owner_id_created_at_idx" ON "notes" USING btree ("owner_id","created_at");
```

## `apps/reference/src/server/evolution.ts`

<!-- example-source: apps/reference/src/server/evolution.ts -->
```ts
import { asc, atomic, defineTable, eq, id, newId, now, ref, text, timestamp, type PortableDb, type WriteStep } from "@lago-morph/prototype-framework";
import type { ChildDump, ParentDump } from "../shared/types";
import type { FixtureChild, FixtureParent } from "./fixture-data";

/**
 * Migration fixture, version 1 (E2E-010, MIG-AC-003). Each overlay under `versions/` replaces
 * this file and `migrations/` in a copy of the app (ROUTES.md "Migration overlays"); everything
 * that depends on the version's columns lives here.
 */
export const SCHEMA_VERSION = "v1";

export const parents = defineTable("parents", {
  id: id(),
  name: text(),
  note: text().nullable(),
  createdAt: timestamp(),
});

export const children = defineTable("children", {
  id: id(),
  parentId: ref(() => parents.id),
  label: text(),
});

/** Inserts the fixture rows as one all-or-nothing unit. */
export async function loadEvolution(db: PortableDb, fixtureParents: readonly FixtureParent[], fixtureChildren: readonly FixtureChild[]): Promise<void> {
  const ids = new Map(fixtureParents.map((p) => [p.name, newId()]));
  const createdAt = now();
  const steps: WriteStep[] = [];
  for (const p of fixtureParents) {
    const parentId = ids.get(p.name) ?? newId();
    steps.push((w) => w.insert(parents).values({ id: parentId, name: p.name, note: p.note, createdAt }));
  }
  for (const c of fixtureChildren) {
    const parentId = ids.get(c.parent) ?? newId();
    steps.push((w) => w.insert(children).values({ id: newId(), parentId, label: c.label }));
  }
  await atomic(db, steps);
}

/** Reads every fixture row in this version's shape, sorted for comparison. */
export async function dumpEvolution(db: PortableDb): Promise<{ parents: ParentDump[]; children: ChildDump[] }> {
  const parentRows = await db.select({ id: parents.id, name: parents.name, note: parents.note }).from(parents).orderBy(asc(parents.name));
  const childRows = await db
    .select({ parent: parents.name, label: children.label })
    .from(children)
    .innerJoin(parents, eq(children.parentId, parents.id))
    .orderBy(asc(parents.name), asc(children.label));
  return {
    parents: parentRows.map((p) => ({ name: p.name, note: p.note })),
    children: childRows.map((c) => ({ parent: c.parent, label: c.label })),
  };
}

/** Whether any fixture row exists. */
export async function evolutionLoaded(db: PortableDb): Promise<boolean> {
  const rows = await db.select({ id: parents.id }).from(parents).limit(1);
  return rows.length > 0;
}
```
