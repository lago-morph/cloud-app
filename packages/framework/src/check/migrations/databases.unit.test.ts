/**
 * Fresh local databases for the migration checker and their introspected logical schema
 * (check.md §2: "applies both histories to fresh local D1 and PGlite databases, then compares
 * their introspected schemas"). Real local D1 (getPlatformProxy) and PGlite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../mig/apply.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { appSchema, generateMigrations } from "../../mig/generate.js";
import { readHistory } from "../../mig/history.js";
import { boolean, id, integer, number, ref, text, timestamp } from "../../sql/columns.js";
import { defineTable } from "../../sql/table.js";
import { openCheckDatabase, type TableSchema } from "./databases.js";

const parents = defineTable("parents", { id: id(), name: text().default("it's"), at: timestamp(), n: number().default(1.5), b: boolean().default(false), k: integer().nullable() }, { indexes: [["name", "at"]] });
const kids = defineTable("kids", { id: id(), parentId: ref(() => parents.id), u: text().unique(), v: integer().default(-1) }, { uniques: [["parentId", "v"]] });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const expectedFor = (pg: boolean): Record<string, TableSchema> => ({
  parents: {
    columns: {
      id: { type: "text", notNull: true, default: null, primaryKey: true },
      name: { type: "text", notNull: true, default: "'it''s'", primaryKey: false },
      at: { type: pg ? "bigint" : "integer", notNull: true, default: null, primaryKey: false },
      n: { type: pg ? "double precision" : "real", notNull: true, default: "1.5", primaryKey: false },
      b: { type: pg ? "boolean" : "integer", notNull: true, default: "false", primaryKey: false },
      k: { type: "integer", notNull: false, default: null, primaryKey: false },
    },
    indexes: ["name,at"],
    uniques: [],
    foreignKeys: [],
  },
  kids: {
    columns: {
      id: { type: "text", notNull: true, default: null, primaryKey: true },
      parent_id: { type: "text", notNull: true, default: null, primaryKey: false },
      u: { type: "text", notNull: true, default: null, primaryKey: false },
      v: { type: "integer", notNull: true, default: "-1", primaryKey: false },
    },
    indexes: [],
    uniques: ["parent_id,v", "u"],
    foreignKeys: ["parent_id -> parents(id) on update no action on delete no action"],
  },
});

describe.each(["sqlite", "postgres"] as const)("%s", (dialect) => {
  it(
    "[CHECK-AC-004] introspects tables, columns (declared type, nullability, static default, primary key), indexes, uniques and references",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mig-check-db-"));
      dirs.push(root);
      await generateMigrations({ root, schema: appSchema({ parents, kids }) });
      const db = await openCheckDatabase(dialect);
      try {
        await applyMigrations(db.migrations, { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework"), app: readHistory(root, dialect, "app") });
        const schema = await db.introspect();
        expect(Object.keys(schema).sort()).toEqual(["__framework_kv", "__framework_migrations", "kids", "parents"]);
        const expected = expectedFor(dialect === "postgres");
        expect(schema["parents"]).toEqual(expected["parents"]);
        expect(schema["kids"]).toEqual(expected["kids"]);
      } finally {
        await db.close();
      }
    },
    60_000,
  );
});
