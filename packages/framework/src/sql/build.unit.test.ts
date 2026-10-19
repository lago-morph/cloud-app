import { getTableConfig as pgConfig, type PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { boolean, id, integer, number, ref, text, timestamp } from "./columns.js";
import { processDialect } from "./dialect.js";
import { defineTable, tableDefinition, tableFor } from "./table.js";

const parents = defineTable("parents", { id: id(), name: text().unique() });
const every = defineTable(
  "every_type",
  {
    id: id(),
    title: text(),
    body: text().nullable(),
    rank: integer().default(7),
    score: number().nullable(),
    createdAt: timestamp(),
    isDone: boolean().default(false),
    parentId: ref(() => parents.id),
  },
  { indexes: [["parentId", "createdAt"]], uniques: [["title", "parentId"]] },
);

function summary(config: ReturnType<typeof sqliteConfig> | ReturnType<typeof pgConfig>) {
  return {
    name: config.name,
    columns: config.columns.map((c) => ({
      name: c.name,
      sqlType: c.getSQLType(),
      notNull: c.notNull,
      primary: c.primary,
      unique: c.isUnique ? c.uniqueName : undefined,
      default: c.default,
    })),
    indexes: config.indexes.map((i) => ({ name: i.config.name, columns: i.config.columns.map((c) => (c as { name: string }).name) })),
    uniques: config.uniqueConstraints.map((u) => ({ name: u.name, columns: u.columns.map((c) => c.name) })),
    foreignKeys: config.foreignKeys.map((f) => {
      const ref = f.reference();
      return { name: f.getName(), columns: ref.columns.map((c) => c.name), foreignColumns: ref.foreignColumns.map((c) => c.name), onDelete: f.onDelete };
    }),
  };
}

describe("defineTable builds Drizzle tables per dialect (sql.md §2.1, §2.2)", () => {
  it("returns the table of the process dialect", () => {
    expect(tableFor(every, processDialect())).toBe(every);
  });

  it("keeps one dialect-neutral definition for both dialect tables", () => {
    expect(tableDefinition(tableFor(every, "sqlite"))).toBe(tableDefinition(tableFor(every, "postgres")));
    expect(tableDefinition(every)?.name).toBe("every_type");
  });

  it(tag("SQL-AC-001", "SQLite: snake_case names, types, NOT NULL, primary key, defaults, named indexes, uniques and FK"), () => {
    const s = summary(sqliteConfig(tableFor(every, "sqlite") as unknown as SQLiteTable));
    expect(s.name).toBe("every_type");
    expect(s.columns).toEqual([
      { name: "id", sqlType: "text", notNull: true, primary: true, unique: undefined, default: undefined },
      { name: "title", sqlType: "text", notNull: true, primary: false, unique: undefined, default: undefined },
      { name: "body", sqlType: "text", notNull: false, primary: false, unique: undefined, default: undefined },
      { name: "rank", sqlType: "integer", notNull: true, primary: false, unique: undefined, default: 7 },
      { name: "score", sqlType: "real", notNull: false, primary: false, unique: undefined, default: undefined },
      { name: "created_at", sqlType: "integer", notNull: true, primary: false, unique: undefined, default: undefined },
      { name: "is_done", sqlType: "integer", notNull: true, primary: false, unique: undefined, default: false },
      { name: "parent_id", sqlType: "text", notNull: true, primary: false, unique: undefined, default: undefined },
    ]);
    expect(s.indexes).toEqual([{ name: "every_type_parent_id_created_at_idx", columns: ["parent_id", "created_at"] }]);
    expect(s.uniques).toEqual([{ name: "every_type_title_parent_id_unique", columns: ["title", "parent_id"] }]);
    expect(s.foreignKeys).toEqual([{ name: "every_type_parent_id_fk", columns: ["parent_id"], foreignColumns: ["id"], onDelete: undefined }]);
  });

  it(tag("SQL-AC-001", "Postgres: snake_case names, types, NOT NULL, primary key, defaults, named indexes, uniques and FK"), () => {
    const s = summary(pgConfig(tableFor(every, "postgres") as unknown as PgTable));
    expect(s.columns.map((c) => [c.name, c.sqlType, c.notNull])).toEqual([
      ["id", "text", true],
      ["title", "text", true],
      ["body", "text", false],
      ["rank", "integer", true],
      ["score", "double precision", false],
      ["created_at", "bigint", true],
      ["is_done", "boolean", true],
      ["parent_id", "text", true],
    ]);
    expect(s.columns.map((c) => c.default)).toEqual([undefined, undefined, undefined, 7, undefined, undefined, false, undefined]);
    expect(s.indexes).toEqual([{ name: "every_type_parent_id_created_at_idx", columns: ["parent_id", "created_at"] }]);
    expect(s.uniques).toEqual([{ name: "every_type_title_parent_id_unique", columns: ["title", "parent_id"] }]);
    // Drizzle pg-core spells the default action out; both mean "fail while referenced".
    expect(s.foreignKeys).toEqual([{ name: "every_type_parent_id_fk", columns: ["parent_id"], foreignColumns: ["id"], onDelete: "no action" }]);
  });

  it(tag("SQL-AC-001", "column-level unique() gets a named unique constraint in both dialects"), () => {
    for (const s of [summary(sqliteConfig(tableFor(parents, "sqlite") as unknown as SQLiteTable)), summary(pgConfig(tableFor(parents, "postgres") as unknown as PgTable))]) {
      expect(s.columns.find((c) => c.name === "name")?.unique).toBe("parents_name_unique");
    }
  });

  it("a ref resolves to the referenced table of the same dialect", () => {
    for (const dialect of ["sqlite", "postgres"] as const) {
      const config = dialect === "sqlite" ? sqliteConfig(tableFor(every, dialect) as unknown as SQLiteTable) : pgConfig(tableFor(every, dialect) as unknown as PgTable);
      const fk = config.foreignKeys[0]?.reference();
      expect(fk?.foreignTable).toBe(tableFor(parents, dialect));
    }
  });

  it(tag("SQL-AC-001", "a ref to a column other than an id() column is rejected when it resolves"), () => {
    const bad = defineTable("bad_ref", { id: id(), parentName: ref(() => parents.name as never) });
    let err: unknown;
    try {
      sqliteConfig(tableFor(bad, "sqlite") as unknown as SQLiteTable).foreignKeys[0]?.reference();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FrameworkError);
    expect((err as FrameworkError).code).toBe("CORE.MISCONFIGURED");
    expect((err as FrameworkError).message).toContain('"parentName"');
  });

  it(tag("SQL-AC-004", "a bound value that breaks the column rule raises SQL.INVALID_VALUE while the query is built"), () => {
    for (const dialect of ["sqlite", "postgres"] as const) {
      const t = tableFor(every, dialect) as Record<string, { mapToDriverValue(v: unknown): unknown }>;
      expect(() => t["rank"]?.mapToDriverValue(2147483648)).toThrow(expect.objectContaining({ code: "SQL.INVALID_VALUE" }));
      expect(t["rank"]?.mapToDriverValue(2147483647)).toBe(2147483647);
      expect(() => t["title"]?.mapToDriverValue("a\u0000")).toThrow(expect.objectContaining({ code: "SQL.INVALID_VALUE", message: expect.stringContaining("every_type.title") }));
    }
    expect((tableFor(every, "sqlite") as Record<string, { mapToDriverValue(v: unknown): unknown }>)["isDone"]?.mapToDriverValue(true)).toBe(1);
  });
});
