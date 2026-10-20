import { asc, atomic, defineTable, eq, id, integer, newId, now, ref, text, timestamp, type PortableDb, type WriteStep } from "@lago-morph/prototype-framework";
import type { ChildDump, ParentDump } from "../shared/types";
import type { FixtureChild, FixtureParent } from "./fixture-data";

/**
 * Migration fixture, version 2 (E2E-010, MIG-AC-003): overlay of `src/server/evolution.ts`.
 * Against version 1 it adds `children.rank` (defaulted), adds an index on
 * `children(parentId, rank)`, and drops `parents.note` (a table with child rows). Only MIG §2
 * supported changes.
 */
export const SCHEMA_VERSION = "v2";

export const parents = defineTable("parents", {
  id: id(),
  name: text(),
  createdAt: timestamp(),
});

export const children = defineTable(
  "children",
  {
    id: id(),
    parentId: ref(() => parents.id),
    label: text(),
    rank: integer().default(0),
  },
  { indexes: [["parentId", "rank"]] },
);

/** Inserts the fixture rows as one all-or-nothing unit (`note` no longer exists). */
export async function loadEvolution(db: PortableDb, fixtureParents: readonly FixtureParent[], fixtureChildren: readonly FixtureChild[]): Promise<void> {
  const ids = new Map(fixtureParents.map((p) => [p.name, newId()]));
  const createdAt = now();
  const steps: WriteStep[] = [];
  for (const p of fixtureParents) {
    const parentId = ids.get(p.name) ?? newId();
    steps.push((w) => w.insert(parents).values({ id: parentId, name: p.name, createdAt }));
  }
  for (const c of fixtureChildren) {
    const parentId = ids.get(c.parent) ?? newId();
    steps.push((w) => w.insert(children).values({ id: newId(), parentId, label: c.label }));
  }
  await atomic(db, steps);
}

/** Reads every fixture row in this version's shape, sorted for comparison. */
export async function dumpEvolution(db: PortableDb): Promise<{ parents: ParentDump[]; children: ChildDump[] }> {
  const parentRows = await db.select({ name: parents.name }).from(parents).orderBy(asc(parents.name));
  const childRows = await db
    .select({ parent: parents.name, label: children.label, rank: children.rank })
    .from(children)
    .innerJoin(parents, eq(children.parentId, parents.id))
    .orderBy(asc(parents.name), asc(children.label));
  return {
    parents: parentRows.map((p) => ({ name: p.name })),
    children: childRows.map((c) => ({ parent: c.parent, label: c.label, rank: c.rank })),
  };
}

/** Whether any fixture row exists. */
export async function evolutionLoaded(db: PortableDb): Promise<boolean> {
  const rows = await db.select({ id: parents.id }).from(parents).limit(1);
  return rows.length > 0;
}
