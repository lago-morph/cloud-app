/**
 * Type fixtures for the revised sql.d.ts (DEC-0103), ported from spike A-09 (`src/checks.ts`,
 * `src/example.ts`). They are checked by `npm run typecheck`: every `@ts-expect-error` line
 * must produce an error (TS2578 otherwise). Only the `.` hub is imported, as app code does.
 * Query functions are declared, never run (atomic, asc, desc, sum, avg and containsText are B-06's).
 */
import { describe, expect, it } from "vitest";
import {
  and, asc, atomic, avg, boolean, containsText, count, defineTable, desc, eq, gte, id, integer, max, newId, now, ref, sum, text, timestamp,
  type Column, type ColumnBuilder, type PortableDb, type Table, type TableDefinitions, type WriteDb,
} from "../index.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assert<T extends true>(_?: T): void {}

// ---- sql.md §2.3 example, verbatim apart from the import ------------------------------
export const notebooks = defineTable("notebooks", { id: id(), name: text().unique() });
export const notes = defineTable("notes", {
  id: id(),
  notebookId: ref(() => notebooks.id),
  title: text(),
  body: text().nullable(),
  views: integer().default(0),
  createdAt: timestamp(),
}, { indexes: [["notebookId", "createdAt"]] });

export async function example(db: PortableDb, notebookId: string, since: number) {
  const noteId = newId();
  await db.insert(notes).values({ id: noteId, notebookId, title: "First", createdAt: now() });

  const recent = await db
    .select({ id: notes.id, title: notes.title, body: notes.body })
    .from(notes)
    .where(and(eq(notes.notebookId, notebookId), gte(notes.createdAt, since)))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(20);

  const renamed = await db
    .update(notes)
    .set({ title: "Renamed" })
    .where(eq(notes.id, noteId))
    .returning({ id: notes.id });
  const found = renamed.length === 1;

  await db.delete(notes).where(eq(notes.id, noteId));
  return { recent, found };
}

declare const db: PortableDb;

// ---- 1. Row / insert types inferred from defineTable ---------------------------------
type NoteRow = typeof notes.$inferSelect;
type NoteInsert = typeof notes.$inferInsert;
assert<Equal<NoteRow, {
  id: string; notebookId: string; title: string; body: string | null; views: number; createdAt: number;
}>>();
assert<Equal<NoteInsert, {
  id: string; notebookId: string; title: string; createdAt: number; body?: string | null | undefined; views?: number | undefined;
}>>();
assert<IsAny<NoteRow> extends false ? true : false>();
type ExampleResult = Awaited<ReturnType<typeof example>>;
assert<Equal<ExampleResult, { recent: { id: string; title: string; body: string | null }[]; found: boolean }>>();

// ---- 2. .returning({ id }) and void writes --------------------------------------------
export async function returning() {
  const r = await db.update(notes).set({ title: "x" }).where(eq(notes.id, "a")).returning({ id: notes.id });
  assert<Equal<typeof r, { id: string }[]>>();
  const all = await db.insert(notes).values({ id: newId(), notebookId: "n", title: "t", createdAt: now() }).returning();
  assert<Equal<typeof all, NoteRow[]>>();
  const v = await db.delete(notes).where(eq(notes.id, "a"));
  assert<Equal<typeof v, void>>();
  const u = await db.update(notes).set({ views: 1 });
  assert<Equal<typeof u, void>>();
}

// ---- 3. atomic tuple typing -----------------------------------------------------------
export async function atomicTyping() {
  const res = await atomic(db, [
    (w) => w.insert(notebooks).values({ id: newId(), name: "nb" }),
    (w) => w.update(notes).set({ title: "y" }).where(eq(notes.id, "a")).returning({ id: notes.id }),
    (w) => w.delete(notes).where(eq(notes.id, "b")).returning(),
  ]);
  assert<Equal<typeof res, [void, { id: string }[], NoteRow[]]>>();
  const empty = await atomic(db, []);
  assert<Equal<typeof empty, []>>();
  // @ts-expect-error select is not on WriteDb
  await atomic(db, [(w) => w.select().from(notes)]);
}

// ---- 4. Wrong-type inserts / updates / comparisons fail -------------------------------
export async function wrongTypes() {
  // @ts-expect-error title must be string
  await db.insert(notes).values({ id: newId(), notebookId: "n", title: 42, createdAt: now() });
  // @ts-expect-error createdAt is required (NOT NULL, no default)
  await db.insert(notes).values({ id: newId(), notebookId: "n", title: "t" });
  // @ts-expect-error title is NOT NULL
  await db.insert(notes).values({ id: newId(), notebookId: "n", title: null, createdAt: now() });
  // @ts-expect-error unknown column key
  await db.insert(notes).values({ id: newId(), notebookId: "n", title: "t", createdAt: now(), extra: 1 });
  // @ts-expect-error views is a number
  await db.update(notes).set({ views: "many" });
  // @ts-expect-error comparing a number column to a string
  await db.select().from(notes).where(eq(notes.createdAt, "yesterday"));
  // @ts-expect-error containsText needs a text column
  containsText(notes.views, "1");
  await db.insert(notes).values({ id: newId(), notebookId: "n", title: "t", body: null, createdAt: now() });
}

// ---- 5. defineTable / schema helpers (declared only: the bad ones also fail at runtime) -
export function schemaTyping() {
  const t1 = defineTable("t1", { id: id(), flag: boolean().default(false), n: integer() }, {
    // @ts-expect-error index over an unknown column key
    indexes: [["nope"]],
  });
  // @ts-expect-error default must match the column type
  defineTable("t2", { id: id(), n: integer().default("zero") });
  // @ts-expect-error ref target must be a string, non-null column
  defineTable("t3", { id: id(), r: ref(() => t1.n) });
}
export const tables: TableDefinitions = { notes, notebooks };
export const asNotes: Table<{ id: ColumnBuilder<string>; title: ColumnBuilder<string> }> | undefined = undefined;
export const asColumn: Column = notes.title;
export const asStrColumn: Column<string> = notes.title;
// @ts-expect-error a number column is not Column<string>
export const badStrColumn: Column<string> = notes.views;

// ---- 6. Disallowed members are not on the handles -------------------------------------
export function disallowed(w: WriteDb) {
  // @ts-expect-error raw execution is not part of PortableDb
  db.execute;
  // @ts-expect-error interactive transactions are not part of PortableDb
  db.transaction;
  // @ts-expect-error relational query API is not part of PortableDb
  db.query;
  // @ts-expect-error $count is not part of PortableDb
  db.$count;
  // @ts-expect-error refreshMaterializedView is not part of PortableDb
  db.refreshMaterializedView;
  // @ts-expect-error WriteDb has no select
  w.select;
}

// ---- 7. Other §2.3 features type-check (left joins, sum/avg as numbers: DEC-0103) -----
export async function supported() {
  const joined = await db
    .select({ title: notes.title, nb: notebooks.name })
    .from(notes)
    .innerJoin(notebooks, eq(notes.notebookId, notebooks.id))
    .orderBy(asc(notes.createdAt), asc(notes.id))
    .limit(10).offset(10);
  assert<Equal<typeof joined, { title: string; nb: string }[]>>();
  const left = await db.select({ t: notes.title, nb: notebooks.name }).from(notes).leftJoin(notebooks, eq(notes.notebookId, notebooks.id));
  assert<Equal<typeof left, { t: string; nb: string | null }[]>>();
  const agg = await db.select({ c: count(), s: sum(notes.views), m: max(notes.createdAt) }).from(notes);
  assert<Equal<typeof agg, { c: number; s: number | null; m: number | null }[]>>();
  const a2 = await db.select({ a: avg(notes.views) }).from(notes);
  assert<Equal<typeof a2, { a: number | null }[]>>();
  const cte = db.$with("recent").as(db.select({ id: notes.id }).from(notes).where(containsText(notes.title, "a")));
  const withRows = await db.with(cte).select().from(cte);
  assert<Equal<typeof withRows, { id: string }[]>>();
  await db.insert(notebooks).values({ id: newId(), name: "x" }).onConflictDoUpdate({ target: notebooks.name, set: { name: "x" } });
  await db.insert(notebooks).values({ id: newId(), name: "x" }).onConflictDoNothing();
}

describe("sql.d.ts type fixtures (DEC-0103)", () => {
  it("the §2.3 example tables are defined at import from the `.` hub", () => {
    expect(notes.title).toBeDefined();
    expect(notebooks.name).toBeDefined();
  });
});
