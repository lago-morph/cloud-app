/**
 * SQL-AC-001 (identical-schema part): a schema using every column type and option creates
 * identical logical schemas on SQLite and Postgres, with lowerCamelCase keys mapped to
 * snake_case SQL names.
 *
 * The schema is created the way an app's database is: `generate-migration` (CLI) writes
 * one history per dialect from `src/app.ts` (MIG-REQ-001); this test applies them to a
 * fresh local D1 database (Wrangler's `getPlatformProxy`, DEC-0105) and to a fresh PGlite
 * database, introspects both, and compares each with the expected logical schema (names,
 * the §2.1 physical type per dialect, nullability, primary key, defaults, references,
 * unique sets, indexes) and with each other. Nothing is mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createAppDir, migrationFiles, removeAppDir, runCli } from "./support/app-dir.js";

const APP_SOURCE = `import { boolean, defineApp, defineTable, id, integer, number, ref, text, timestamp } from "@lago-morph/prototype-framework";

export const notebooks = defineTable("notebooks", { id: id(), name: text().unique() });

export const noteItems = defineTable(
  "note_items",
  {
    id: id(),
    notebookId: ref(() => notebooks.id),
    archiveNotebookId: ref(() => notebooks.id).nullable(),
    title: text(),
    bodyText: text().nullable(),
    viewCount: integer().default(0),
    ratingValue: number().nullable(),
    createdAt: timestamp(),
    isPinned: boolean().default(false),
    shortCode: text().default("n/a"),
    weightFactor: number().default(1.5),
    sortKey: integer().nullable().unique(),
    lastSeenAt: timestamp().nullable(),
    isArchived: boolean().nullable(),
  },
  { indexes: [["notebookId", "createdAt"]], uniques: [["notebookId", "title"]] },
);

export const app = defineApp({
  name: "schemaall",
  config: {},
  secrets: [],
  tables: { notebooks, noteItems },
  routes: () => {},
});
export default app;
`;

type Kind = "id" | "text" | "integer" | "number" | "timestamp" | "boolean";

/** sql.md §2.1, per dialect. */
const PHYSICAL: Record<"sqlite" | "postgres", Record<Kind, string>> = {
  sqlite: { id: "text", text: "text", integer: "integer", number: "real", timestamp: "integer", boolean: "integer" },
  postgres: { id: "text", text: "text", integer: "integer", number: "double precision", timestamp: "bigint", boolean: "boolean" },
};

interface LogicalColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly default: string | number | boolean | null;
  readonly references: string | null; // "table.column (fail while referenced)"
}
interface LogicalTable {
  readonly columns: LogicalColumn[];
  readonly uniques: string[][];
  readonly indexes: string[][];
}
type LogicalSchema = Record<string, LogicalTable>;

type ExpectedColumn = [name: string, kind: Kind, notNull: boolean, def: string | number | boolean | null, references: string | null];

const EXPECTED: Record<string, { columns: ExpectedColumn[]; uniques: string[][]; indexes: string[][] }> = {
  notebooks: {
    columns: [
      ["id", "id", true, null, null],
      ["name", "text", true, null, null],
    ],
    uniques: [["name"]],
    indexes: [],
  },
  note_items: {
    columns: [
      ["archive_notebook_id", "text", false, null, "notebooks.id"],
      ["body_text", "text", false, null, null],
      ["created_at", "timestamp", true, null, null],
      ["id", "id", true, null, null],
      ["is_archived", "boolean", false, null, null],
      ["is_pinned", "boolean", true, false, null],
      ["last_seen_at", "timestamp", false, null, null],
      ["notebook_id", "text", true, null, "notebooks.id"],
      ["rating_value", "number", false, null, null],
      ["short_code", "text", true, "n/a", null],
      ["sort_key", "integer", false, null, null],
      ["title", "text", true, null, null],
      ["view_count", "integer", true, 0, null],
      ["weight_factor", "number", true, 1.5, null],
    ],
    uniques: [["notebook_id", "title"], ["sort_key"]],
    indexes: [["notebook_id", "created_at"]],
  },
};

function expectedSchema(dialect: "sqlite" | "postgres"): LogicalSchema {
  const out: LogicalSchema = {};
  for (const [table, spec] of Object.entries(EXPECTED)) {
    out[table] = {
      columns: spec.columns.map(([name, kind, notNull, def, references]) => ({
        name,
        type: PHYSICAL[dialect][kind],
        notNull,
        primaryKey: name === "id",
        default: def,
        references: references === null ? null : `${references} (fail while referenced)`,
      })),
      uniques: spec.uniques,
      indexes: spec.indexes,
    };
  }
  return out;
}

function withoutTypes(schema: LogicalSchema): unknown {
  return Object.fromEntries(Object.entries(schema).map(([t, v]) => [t, { ...v, columns: v.columns.map(({ type: _type, ...rest }) => rest) }]));
}

const sortLists = (lists: string[][]): string[][] => [...lists].sort((a, b) => a.join(",").localeCompare(b.join(",")));

/** Defaults as introspected: `0`, `'n/a'`, `'n/a'::text`, `false`, `(1.5)` … → JS values. */
function normalizeDefault(raw: unknown, type: string): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  s = s.replace(/::[a-z ]+$/i, "");
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (/^(true|false)$/i.test(s) || (type === "boolean" && /^[01]$/.test(s))) return /^(true|1)$/.test(s.toLowerCase());
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

// ---- local D1 ------------------------------------------------------------------------

interface D1Statement { all<T>(): Promise<{ results: T[] }> }
interface D1Like { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown> }

async function introspectD1(db: D1Like): Promise<LogicalSchema> {
  const q = async <T>(sql: string): Promise<T[]> => (await db.prepare(sql).all<T>()).results;
  const names = (await q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'"))
    .map((r) => r.name)
    .filter((n) => !n.startsWith("sqlite_") && !n.startsWith("_cf_") && !n.startsWith("__framework_") && n !== "d1_migrations");
  const schema: LogicalSchema = {};
  for (const table of names.sort()) {
    const cols = await q<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>(`PRAGMA table_info("${table}")`);
    const fks = await q<{ table: string; from: string; to: string; on_delete: string }>(`PRAGMA foreign_key_list("${table}")`);
    const indexList = await q<{ name: string; unique: number; origin: string }>(`PRAGMA index_list("${table}")`);
    const uniques: string[][] = [];
    const indexes: string[][] = [];
    for (const idx of indexList) {
      if (idx.origin === "pk") continue;
      const info = await q<{ seqno: number; name: string }>(`PRAGMA index_info("${idx.name}")`);
      const columns = info.sort((a, b) => a.seqno - b.seqno).map((i) => i.name);
      (idx.unique === 1 ? uniques : indexes).push(columns);
    }
    schema[table] = {
      columns: cols
        .map((c) => {
          const fk = fks.find((f) => f.from === c.name);
          const type = c.type.toLowerCase();
          return {
            name: c.name,
            type,
            notNull: c.notnull === 1 || c.pk > 0,
            primaryKey: c.pk > 0,
            default: normalizeDefault(c.dflt_value, type),
            references: fk === undefined ? null : `${fk.table}.${fk.to} (${failAction(fk.on_delete)})`,
          };
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      uniques: sortLists(uniques),
      indexes: sortLists(indexes),
    };
  }
  return schema;
}

function failAction(action: string): string {
  const a = action.trim();
  return ["NO ACTION", "RESTRICT"].includes(a.toUpperCase()) || a === "a" || a === "r" ? "fail while referenced" : `on delete ${a}`;
}

/** SQLite has no boolean type (§2.1: integer, boolean mode): read 0/1 defaults of boolean columns as booleans. */
function booleanDefaults(schema: LogicalSchema): LogicalSchema {
  const out: LogicalSchema = {};
  for (const [table, value] of Object.entries(schema)) {
    const kinds = new Map((EXPECTED[table]?.columns ?? []).map(([name, kind]) => [name, kind]));
    out[table] = {
      ...value,
      columns: value.columns.map((c) =>
        kinds.get(c.name) === "boolean" && (c.default === 0 || c.default === 1) ? { ...c, default: c.default === 1 } : c),
    };
  }
  return out;
}

// ---- PGlite ------------------------------------------------------------------------

async function introspectPg(pg: PGlite): Promise<LogicalSchema> {
  const cols = (await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public'`,
  )).rows;
  const idx = (await pg.query<{ table_name: string; is_unique: boolean; is_primary: boolean; cols: string[] }>(
    `SELECT t.relname AS table_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
            array_agg(a.attname::text ORDER BY k.ord) AS cols
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
      GROUP BY t.relname, ix.indexrelid, ix.indisunique, ix.indisprimary`,
  )).rows;
  const fks = (await pg.query<{ table_name: string; column_name: string; ref_table: string; ref_column: string; del: string }>(
    `SELECT cl.relname AS table_name, att.attname AS column_name, fcl.relname AS ref_table, fatt.attname AS ref_column, c.confdeltype::text AS del
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class fcl ON fcl.oid = c.confrelid
       JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
       JOIN pg_attribute fatt ON fatt.attrelid = c.confrelid AND fatt.attnum = c.confkey[1]
      WHERE c.contype = 'f'`,
  )).rows;
  const tables = [...new Set(cols.map((c) => c.table_name))].filter((t) => !t.startsWith("__framework_")).sort();
  const schema: LogicalSchema = {};
  for (const table of tables) {
    const primary = idx.find((i) => i.table_name === table && i.is_primary)?.cols ?? [];
    schema[table] = {
      columns: cols
        .filter((c) => c.table_name === table)
        .map((c) => {
          const fk = fks.find((f) => f.table_name === table && f.column_name === c.column_name);
          return {
            name: c.column_name,
            type: c.data_type.toLowerCase(),
            notNull: c.is_nullable === "NO",
            primaryKey: primary.includes(c.column_name),
            default: normalizeDefault(c.column_default, c.data_type.toLowerCase()),
            references: fk === undefined ? null : `${fk.ref_table}.${fk.ref_column} (${failAction(fk.del)})`,
          };
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      uniques: sortLists(idx.filter((i) => i.table_name === table && i.is_unique && !i.is_primary).map((i) => i.cols)),
      indexes: sortLists(idx.filter((i) => i.table_name === table && !i.is_unique).map((i) => i.cols)),
    };
  }
  return schema;
}

const splitStatements = (text: string): string[] =>
  text.split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter((s) => s.length > 0);

describe("SQL logical schema on both dialects", () => {
  let appDir: string | undefined;
  let d1Dir: string | undefined;
  let sqliteSchema: LogicalSchema;
  let postgresSchema: LogicalSchema;

  beforeAll(async () => {
    appDir = createAppDir({ "src/app.ts": APP_SOURCE });
    const generated = await runCli(appDir, ["generate-migration"]);
    expect(generated.status, `generate-migration failed:\n${generated.output}`).toBe(0);
    const dir = appDir;
    const sqliteFiles = migrationFiles(dir, "sqlite").map((f) => readFileSync(join(dir, f), "utf8"));
    const postgresFiles = migrationFiles(dir, "postgres").map((f) => readFileSync(join(dir, f), "utf8"));
    expect(sqliteFiles.length).toBeGreaterThan(0);
    expect(postgresFiles.length).toBeGreaterThan(0);

    d1Dir = mkdtempSync(join(tmpdir(), "fw-b-t2-d1-"));
    writeFileSync(join(d1Dir, "wrangler.json"), JSON.stringify({
      name: "introspect",
      compatibility_date: "2025-09-01",
      d1_databases: [{ binding: "DB", database_name: "introspect", database_id: "introspect-local" }],
    }));
    const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: join(d1Dir, "wrangler.json"), persist: { path: join(d1Dir, "state") }, remoteBindings: false });
    try {
      const db = proxy.env.DB;
      for (const file of sqliteFiles) await db.batch(splitStatements(file).map((s) => db.prepare(s)));
      sqliteSchema = booleanDefaults(await introspectD1(db));
    } finally {
      await proxy.dispose();
    }

    const pg = await PGlite.create();
    try {
      for (const file of postgresFiles) await pg.exec(file);
      postgresSchema = await introspectPg(pg);
    } finally {
      await pg.close();
    }
  }, 600_000);

  afterAll(() => {
    removeAppDir(appDir);
    if (d1Dir !== undefined) rmSync(d1Dir, { recursive: true, force: true });
  });

  it(tag("SQL-AC-001", "every column type and option creates the expected logical schema on SQLite (local D1), snake_case names"), () => {
    expect(sqliteSchema).toEqual(expectedSchema("sqlite"));
  });

  it(tag("SQL-AC-001", "every column type and option creates the expected logical schema on Postgres (PGlite), snake_case names"), () => {
    expect(postgresSchema).toEqual(expectedSchema("postgres"));
  });

  it(tag("SQL-AC-001", "the SQLite and Postgres logical schemas are identical apart from the §2.1 physical types"), () => {
    expect(withoutTypes(sqliteSchema)).toEqual(withoutTypes(postgresSchema));
  });
});
