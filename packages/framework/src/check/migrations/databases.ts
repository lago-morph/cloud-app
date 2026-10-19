/**
 * Fresh, empty local databases for the migration checker (check.md §2): local D1 through
 * Wrangler's getPlatformProxy (DEC-0105), not persisted, and the PGlite harness with C
 * collation (DEC-0106). Each is wrapped as MIG's `MigrationDatabase`, so the checker applies
 * migrations exactly as `dev` and `createTestApp` do, and can be introspected.
 *
 * Introspection gives each table's columns (declared type, nullability, static default,
 * primary key), non-unique indexes and unique column sets (by columns, not by name), and
 * references, normalized so the same logical schema reads the same in both dialects except
 * for the declared type names (compared through `logicalType`).
 */
import type { PGlite } from "@electric-sql/pglite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1MigrationDatabase, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "../../mig/apply.js";
import type { Dialect } from "../../sql/dialect.js";
import { openPostgres } from "../../sql/postgres.js";

export interface ColumnSchema {
  /** Declared type, lowercase (`integer`, `double precision`, …). */
  readonly type: string;
  readonly notNull: boolean;
  /** The static default as SQL text, casts removed; null without one. */
  readonly default: string | null;
  readonly primaryKey: boolean;
}

export interface TableSchema {
  /** By SQL column name. */
  readonly columns: Readonly<Record<string, ColumnSchema>>;
  /** Non-unique indexes as comma-joined column lists, sorted. */
  readonly indexes: readonly string[];
  /** Unique constraints and unique indexes (not the primary key) as comma-joined column lists, sorted. */
  readonly uniques: readonly string[];
  /** `<cols> -> <table>(<cols>) on update <action> on delete <action>`, sorted. */
  readonly foreignKeys: readonly string[];
}

/** By table name. */
export type DatabaseSchema = Readonly<Record<string, TableSchema>>;

export interface CheckDatabase {
  readonly dialect: Dialect;
  readonly migrations: MigrationDatabase;
  introspect(): Promise<DatabaseSchema>;
  close(): Promise<void>;
}

export function openCheckDatabase(dialect: Dialect): Promise<CheckDatabase> {
  return dialect === "sqlite" ? openD1() : openPglite();
}

const WRANGLER_CONFIG = {
  name: "migration-checker",
  compatibility_date: "2026-10-01",
  d1_databases: [{ binding: "DB", database_name: "migration-checker", database_id: "00000000-0000-0000-0000-000000000000" }],
};

async function openD1(): Promise<CheckDatabase> {
  const { getPlatformProxy } = await import("wrangler");
  const dir = mkdtempSync(join(tmpdir(), "migration-checker-"));
  const configPath = join(dir, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(WRANGLER_CONFIG));
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Like }>>>;
  try {
    proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath, persist: false });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const d1 = proxy.env.DB;
  return {
    dialect: "sqlite",
    migrations: d1MigrationDatabase(d1),
    introspect: () => introspectSqlite(d1),
    async close() {
      try {
        await proxy.dispose();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

async function openPglite(): Promise<CheckDatabase> {
  const pg = await openPostgres();
  return {
    dialect: "postgres",
    migrations: pgliteMigrationDatabase(pg),
    introspect: () => introspectPostgres(pg),
    close: () => pg.close(),
  };
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

async function introspectSqlite(d1: D1Like): Promise<DatabaseSchema> {
  const rows = async (sql: string, ...values: unknown[]): Promise<Row[]> => (await d1.prepare(sql).bind(...values).all<Row>()).results;
  const tables = await rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name`);
  const out: Record<string, TableSchema> = {};
  for (const t of tables) {
    const table = str(t["name"]);
    const columns: Record<string, ColumnSchema> = {};
    for (const c of await rows(`SELECT name, type, "notnull" AS nn, dflt_value AS d, pk FROM pragma_table_info(?) ORDER BY cid`, table)) {
      const type = str(c["type"]).toLowerCase();
      columns[str(c["name"])] = { type, notNull: Number(c["nn"]) === 1, default: normalizeDefault(c["d"], type), primaryKey: Number(c["pk"]) > 0 };
    }
    const indexes: string[] = [];
    const uniques: string[] = [];
    for (const i of await rows(`SELECT name, "unique" AS u, origin FROM pragma_index_list(?)`, table)) {
      if (str(i["origin"]) === "pk") continue;
      const cols = (await rows(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, str(i["name"]))).map((r) => str(r["name"])).join(",");
      (Number(i["u"]) === 1 ? uniques : indexes).push(cols);
    }
    const fks = new Map<string, { from: string[]; to: string[]; table: string; onUpdate: string; onDelete: string }>();
    for (const f of await rows(`SELECT id, "table" AS t, "from" AS f, "to" AS o, on_update AS u, on_delete AS d FROM pragma_foreign_key_list(?) ORDER BY id, seq`, table)) {
      const key = str(f["id"]);
      const fk = fks.get(key) ?? { from: [], to: [], table: str(f["t"]), onUpdate: str(f["u"]).toLowerCase(), onDelete: str(f["d"]).toLowerCase() };
      fk.from.push(str(f["f"]));
      fk.to.push(str(f["o"]));
      fks.set(key, fk);
    }
    const foreignKeys = [...fks.values()].map((fk) => foreignKey(fk.from, fk.table, fk.to, fk.onUpdate, fk.onDelete));
    out[table] = { columns, indexes: sorted(indexes), uniques: sorted(uniques), foreignKeys: sorted(foreignKeys) };
  }
  return out;
}

const PG_ACTIONS: Readonly<Record<string, string>> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

/** Column names of an attribute-number array, in order (PGlite returns `int2vector`/`int2[]` as text). */
const PG_COLS = (keys: string, rel: string): string =>
  `array_to_string(array(SELECT a.attname FROM unnest(${keys}) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = ${rel} AND a.attnum = k.attnum ORDER BY k.ord), ',')`;

async function introspectPostgres(pg: PGlite): Promise<DatabaseSchema> {
  const rows = async (sql: string): Promise<Row[]> => (await pg.query<Row>(sql)).rows;
  const out: Record<string, { columns: Record<string, ColumnSchema>; indexes: string[]; uniques: string[]; foreignKeys: string[] }> = {};
  for (const t of await rows(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)) {
    out[str(t["name"])] = { columns: {}, indexes: [], uniques: [], foreignKeys: [] };
  }
  const primary = new Set(
    (
      await rows(
        `SELECT t.relname AS t, ${PG_COLS("ix.indkey", "t.oid")} AS cols FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND ix.indisprimary`,
      )
    ).flatMap((r) => str(r["cols"]).split(",").map((c) => `${str(r["t"])}.${c}`)),
  );
  for (const c of await rows(`SELECT table_name AS t, column_name AS c, data_type AS type, is_nullable AS nullable, column_default AS d FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)) {
    const table = out[str(c["t"])];
    if (table === undefined) continue;
    const name = str(c["c"]);
    const type = str(c["type"]).toLowerCase();
    table.columns[name] = { type, notNull: str(c["nullable"]) === "NO", default: normalizeDefault(c["d"], type), primaryKey: primary.has(`${str(c["t"])}.${name}`) };
  }
  for (const i of await rows(
    `SELECT t.relname AS t, ix.indisunique AS u, ${PG_COLS("ix.indkey", "t.oid")} AS cols FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND NOT ix.indisprimary`,
  )) {
    const table = out[str(i["t"])];
    if (table !== undefined) (i["u"] === true ? table.uniques : table.indexes).push(str(i["cols"]));
  }
  for (const f of await rows(
    `SELECT cl.relname AS t, ${PG_COLS("c.conkey", "c.conrelid")} AS cols, rt.relname AS ref, ${PG_COLS("c.confkey", "c.confrelid")} AS refcols, c.confupdtype::text AS u, c.confdeltype::text AS d FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class rt ON rt.oid = c.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE c.contype = 'f' AND n.nspname = 'public'`,
  )) {
    const table = out[str(f["t"])];
    if (table !== undefined) table.foreignKeys.push(foreignKey(str(f["cols"]).split(","), str(f["ref"]), str(f["refcols"]).split(","), PG_ACTIONS[str(f["u"])] ?? str(f["u"]), PG_ACTIONS[str(f["d"])] ?? str(f["d"])));
  }
  const result: Record<string, TableSchema> = {};
  for (const [name, t] of Object.entries(out)) result[name] = { columns: t.columns, indexes: sorted(t.indexes), uniques: sorted(t.uniques), foreignKeys: sorted(t.foreignKeys) };
  return result;
}

function foreignKey(from: readonly string[], table: string, to: readonly string[], onUpdate: string, onDelete: string): string {
  return `${from.join(",")} -> ${table}(${to.join(",")}) on update ${onUpdate} on delete ${onDelete}`;
}

/** A default as SQL text: Postgres casts (`'x'::text`) and wrapping parentheses removed; quoted numbers of numeric columns unquoted. */
function normalizeDefault(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  for (;;) {
    const next = text.replace(/::[a-z][a-z0-9 _]*(?:\[\])?$/i, "").replace(/^\((.*)\)$/s, "$1").trim();
    if (next === text) break;
    text = next;
  }
  if (type !== "text" && /^'-?\d+(?:\.\d+)?'$/.test(text)) text = text.slice(1, -1);
  return text;
}
