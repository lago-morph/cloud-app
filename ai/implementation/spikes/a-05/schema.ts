// Schema versions for spike A-05. SCHEMA_VERSION selects v1 or v2; v2 makes only "supported changes"
// (migrations.md §2): add a nullable column, add a static-default column, add a table that references
// an existing one, add an index and a unique index, drop a column.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const v2 = process.env.SCHEMA_VERSION === "2";

export const parent = sqliteTable(
  "parent",
  {
    id: integer().primaryKey(),
    name: text().notNull(),
    ...(v2 ? { nickname: text(), score: integer().notNull().default(0) } : {}),
  },
  (t) => (v2 ? [uniqueIndex("parent_name_uq").on(t.name)] : []),
);

export const child = sqliteTable(
  "child",
  {
    id: integer().primaryKey(),
    parentId: integer()
      .notNull()
      .references(() => parent.id),
    ...(v2 ? {} : { legacy: text() }),
  },
  (t) => (v2 ? [index("child_parent_idx").on(t.parentId)] : []),
);

export const tag = v2
  ? sqliteTable("tag", {
      id: integer().primaryKey(),
      parentId: integer().references(() => parent.id),
      label: text().notNull(),
    })
  : undefined;
