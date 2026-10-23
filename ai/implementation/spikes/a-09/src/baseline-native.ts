// Baseline: the same left join with native Drizzle pg-core tables (literal table names).
import { eq } from "drizzle-orm";
import { pgTable, text, type PgDatabase } from "drizzle-orm/pg-core";
import type { PortableQueryResult } from "@lago-morph/prototype-framework";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assert<T extends true>(_?: T): void {}
const nb = pgTable("notebooks", { id: text().primaryKey(), name: text().notNull().unique() });
const n = pgTable("notes", { id: text().primaryKey(), notebookId: text().notNull().references(() => nb.id), title: text().notNull() });
declare const db: PgDatabase<PortableQueryResult>;
export async function p() {
  const left = await db.select({ t: n.title, nb: nb.name }).from(n).leftJoin(nb, eq(n.notebookId, nb.id));
  assert<Equal<typeof left, { t: string; nb: string | null }[]>>();
}
