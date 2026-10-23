/**
 * `src/app.ts` versions of the scratch apps used by the MIG suites. They import the
 * framework package by name, exactly as an app does, and are only ever loaded by the CLI.
 *
 * Version 1 → 2 uses only the supported changes of migrations.md §2 (drop a column from a
 * table with child rows, add a column with a static default, add an index, add a table);
 * no migration both removes and adds columns of one table. Version 3 adds a unique
 * constraint over a column that holds duplicate values: a data-dependent failing migration.
 */

const PRELUDE = `import { asc, defineApp, defineTable, eq, id, integer, jsonBody, newId, ref, text, z } from "@lago-morph/prototype-framework";
`;

/**
 * `/seed` inserts IDs from `newId()` (CHECK `framework-ids`; sql.md: `id()` holds IDs from
 * `newId()`) and returns them, so the tests build the expected data from them. Root cause:
 * `ai/implementation/root-causes/2026-10-19-MIG-AC-001-seed-literal-ids-fail-framework-ids.md`.
 * `/data` orders by the unique `name`/`label` values, so its order does not depend on the
 * random IDs. `/fix-codes` takes parent 2's ID in its JSON body.
 */
const ROUTES = (parentColumns: string, childColumns: string, extra = ""): string => `
export const app = defineApp({
  name: "migapp",
  config: {},
  secrets: [],
  tables: { parents, children${extra === "" ? "" : ", tags"} },
  routes: (api) => {
    api.post("/seed", async (c) => {
      const p1 = newId();
      const p2 = newId();
      const c1 = newId();
      const c2 = newId();
      const c3 = newId();
      await c.var.sql.insert(parents).values([
        { id: p1, name: "one", ${parentColumns.includes("note") ? 'note: "n1", ' : ""}code: "dup" },
        { id: p2, name: "two", ${parentColumns.includes("note") ? "note: null, " : ""}code: "dup" },
      ]);
      await c.var.sql.insert(children).values([
        { id: c1, parentId: p1, label: "a" },
        { id: c2, parentId: p1, label: "b" },
        { id: c3, parentId: p2, label: "c" },
      ]);
      return c.json({ parents: [p1, p2], children: [c1, c2, c3] });
    });
    api.post("/fix-codes", jsonBody(z.object({ parentId: z.string() })), async (c) => {
      await c.var.sql.update(parents).set({ code: "unique-2" }).where(eq(parents.id, c.req.valid("json").parentId));
      return c.body(null, 204);
    });
    api.get("/data", async (c) => {
      const parentRows = await c.var.sql.select({ ${parentColumns} }).from(parents).orderBy(asc(parents.name));
      const childRows = await c.var.sql.select({ ${childColumns} }).from(children).orderBy(asc(children.label));
      return c.json({ parents: parentRows, children: childRows });
    });
  },
});
export default app;
`;

export const APP_V1 = `${PRELUDE}
export const parents = defineTable("parents", { id: id(), name: text(), note: text().nullable(), code: text().nullable() });
export const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text() });
${ROUTES("id: parents.id, name: parents.name, note: parents.note, code: parents.code", "id: children.id, parentId: children.parentId, label: children.label")}`;

export const APP_V2 = `${PRELUDE}
export const parents = defineTable("parents", { id: id(), name: text(), code: text().nullable() });
export const children = defineTable(
  "children",
  { id: id(), parentId: ref(() => parents.id), label: text(), rank: integer().default(0) },
  { indexes: [["label"]] },
);
export const tags = defineTable("tags", { id: id(), name: text().unique() });
${ROUTES("id: parents.id, name: parents.name, code: parents.code", "id: children.id, parentId: children.parentId, label: children.label, rank: children.rank", "tags")}`;

export const APP_V3 = `${PRELUDE}
export const parents = defineTable("parents", { id: id(), name: text(), code: text().nullable().unique() });
export const children = defineTable(
  "children",
  { id: id(), parentId: ref(() => parents.id), label: text(), rank: integer().default(0) },
  { indexes: [["label"]] },
);
export const tags = defineTable("tags", { id: id(), name: text().unique() });
${ROUTES("id: parents.id, name: parents.name, code: parents.code", "id: children.id, parentId: children.parentId, label: children.label, rank: children.rank", "tags")}`;

/** The IDs `POST /api/seed` created and returned: parents one and two, children a, b and c. */
export interface SeedIds {
  readonly parents: readonly [string, string];
  readonly children: readonly [string, string, string];
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Checks the `/seed` response: 2 parent and 3 child IDs, five distinct UUID v4 values. */
export function seedIds(body: unknown): SeedIds {
  const b = (body ?? {}) as { parents?: unknown; children?: unknown };
  const ps: unknown[] = Array.isArray(b.parents) ? b.parents : [];
  const cs: unknown[] = Array.isArray(b.children) ? b.children : [];
  const all = [...ps, ...cs];
  if (ps.length !== 2 || cs.length !== 3 || !all.every((v) => typeof v === "string" && UUID_V4.test(v)) || new Set(all).size !== 5) {
    throw new Error(`/seed must return 2 parent and 3 child IDs, five distinct UUID v4 values: ${JSON.stringify(body)}`);
  }
  const [p1, p2, c1, c2, c3] = all as string[];
  return { parents: [p1 ?? "", p2 ?? ""], children: [c1 ?? "", c2 ?? "", c3 ?? ""] };
}

/** `GET /api/data` after seeding version 1: children a and b belong to parent one, c to two. */
export function dataV1({ parents: [p1, p2], children: [c1, c2, c3] }: SeedIds) {
  return {
    parents: [
      { id: p1, name: "one", note: "n1", code: "dup" },
      { id: p2, name: "two", note: null, code: "dup" },
    ],
    children: [
      { id: c1, parentId: p1, label: "a" },
      { id: c2, parentId: p1, label: "b" },
      { id: c3, parentId: p2, label: "c" },
    ],
  };
}

/** The same data after version 2: `note` dropped, `rank` added with its default. */
export function dataV2({ parents: [p1, p2], children: [c1, c2, c3] }: SeedIds) {
  return {
    parents: [
      { id: p1, name: "one", code: "dup" },
      { id: p2, name: "two", code: "dup" },
    ],
    children: [
      { id: c1, parentId: p1, label: "a", rank: 0 },
      { id: c2, parentId: p1, label: "b", rank: 0 },
      { id: c3, parentId: p2, label: "c", rank: 0 },
    ],
  };
}

/** `src/tests` file for `verify` (CLI-REQ-002 fails a project with zero tests). */
export const APP_TEST = `import { expect, it } from "vitest";
import { createTestApp } from "@lago-morph/prototype-framework/testing";
import { app } from "../src/app";

it("answers the health check", async () => {
  const test = await createTestApp(app);
  const res = await test.request("/api/__framework/health");
  expect(res.status).toBe(204);
  await test.dispose();
});
`;
