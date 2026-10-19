/**
 * `src/app.ts` versions of the scratch apps used by the MIG suites. They import the
 * framework package by name, exactly as an app does, and are only ever loaded by the CLI.
 *
 * Version 1 → 2 uses only the supported changes of migrations.md §2 (drop a column from a
 * table with child rows, add a column with a static default, add an index, add a table);
 * no migration both removes and adds columns of one table. Version 3 adds a unique
 * constraint over a column that holds duplicate values: a data-dependent failing migration.
 */

const PRELUDE = `import { asc, defineApp, defineTable, eq, id, integer, ref, text } from "@lago-morph/prototype-framework";
`;

const ROUTES = (parentColumns: string, childColumns: string, extra = ""): string => `
export const app = defineApp({
  name: "migapp",
  config: {},
  secrets: [],
  tables: { parents, children${extra === "" ? "" : ", tags"} },
  routes: (api) => {
    api.post("/seed", async (c) => {
      await c.var.sql.insert(parents).values([
        { id: "00000000-0000-4000-8000-000000000001", name: "one", ${parentColumns.includes("note") ? 'note: "n1", ' : ""}code: "dup" },
        { id: "00000000-0000-4000-8000-000000000002", name: "two", ${parentColumns.includes("note") ? "note: null, " : ""}code: "dup" },
      ]);
      await c.var.sql.insert(children).values([
        { id: "00000000-0000-4000-8000-00000000000a", parentId: "00000000-0000-4000-8000-000000000001", label: "a" },
        { id: "00000000-0000-4000-8000-00000000000b", parentId: "00000000-0000-4000-8000-000000000001", label: "b" },
        { id: "00000000-0000-4000-8000-00000000000c", parentId: "00000000-0000-4000-8000-000000000002", label: "c" },
      ]);
      return c.body(null, 204);
    });
    api.post("/fix-codes", async (c) => {
      await c.var.sql.update(parents).set({ code: "unique-2" }).where(eq(parents.id, "00000000-0000-4000-8000-000000000002"));
      return c.body(null, 204);
    });
    api.get("/data", async (c) => {
      const parentRows = await c.var.sql.select({ ${parentColumns} }).from(parents).orderBy(asc(parents.id));
      const childRows = await c.var.sql.select({ ${childColumns} }).from(children).orderBy(asc(children.id));
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

export const P1 = "00000000-0000-4000-8000-000000000001";
export const P2 = "00000000-0000-4000-8000-000000000002";
export const C1 = "00000000-0000-4000-8000-00000000000a";
export const C2 = "00000000-0000-4000-8000-00000000000b";
export const C3 = "00000000-0000-4000-8000-00000000000c";

/** `GET /api/data` after seeding version 1. */
export const DATA_V1 = {
  parents: [
    { id: P1, name: "one", note: "n1", code: "dup" },
    { id: P2, name: "two", note: null, code: "dup" },
  ],
  children: [
    { id: C1, parentId: P1, label: "a" },
    { id: C2, parentId: P1, label: "b" },
    { id: C3, parentId: P2, label: "c" },
  ],
};

/** The same data after version 2: `note` dropped, `rank` added with its default. */
export const DATA_V2 = {
  parents: [
    { id: P1, name: "one", code: "dup" },
    { id: P2, name: "two", code: "dup" },
  ],
  children: [
    { id: C1, parentId: P1, label: "a", rank: 0 },
    { id: C2, parentId: P1, label: "b", rank: 0 },
    { id: C3, parentId: P2, label: "c", rank: 0 },
  ],
};

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
