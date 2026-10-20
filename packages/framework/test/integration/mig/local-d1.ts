/**
 * Reads the local D1 database that `dev` keeps in the app directory (local.md §2: local
 * state lives in `.wrangler/`; Miniflare keeps D1 under `.wrangler/state/v3/d1/`), straight
 * from its SQLite file, after `dev` has
 * stopped. Used to compare the whole database (schema, rows, migration record) before and
 * after a local "deployment". Read-only: no statement here changes the database.
 */
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Miniflare/workerd keeps one `metadata.sqlite` per Durable Object namespace (D1 is one): it
 * holds only the `_cf_ALARM` table and is not a database. Miniflare's own explorer skips it
 * the same way. Root cause: `ai/implementation/root-causes/2026-10-19-MIG-AC-002-metadata-sqlite-counted-as-d1-database.md`.
 * Only this exact name is skipped: every other `.sqlite` file (a D1 database is
 * `<64 hex>.sqlite`) still counts, so a second database is still detected.
 */
const NAMESPACE_METADATA = "metadata.sqlite";

/** Every local D1 database file under the app directory (excluding node_modules). */
export function d1DatabaseFiles(appDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".sqlite") && entry !== NAMESPACE_METADATA && full.includes(`${sep}.wrangler${sep}`) && full.includes(`${sep}d1${sep}`)) found.push(full);
    }
  };
  walk(appDir);
  return found.sort();
}

export interface D1Snapshot {
  /** `sqlite_master` entries for app and framework objects: type, name, table, SQL text. */
  readonly schema: readonly { type: string; name: string; tbl_name: string; sql: string | null }[];
  /** Rows per table, each table's rows sorted by their JSON text. */
  readonly rows: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** `__framework_migrations` rows in insertion (rowid) order. */
  readonly record: readonly Record<string, unknown>[];
  /** `PRAGMA foreign_key_check` violations. */
  readonly foreignKeyViolations: readonly unknown[];
}

const internal = (name: string): boolean => name.startsWith("sqlite_") || name.startsWith("_cf_");

export function snapshotD1(file: string): D1Snapshot {
  const db = new DatabaseSync(file);
  try {
    const schema = (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as D1Snapshot["schema"][number][])
      .filter((r) => !internal(r.name) && !internal(r.tbl_name))
      .map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.sql }));
    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const t of schema.filter((s) => s.type === "table")) {
      const all = db.prepare(`SELECT * FROM "${t.name}"`).all() as Record<string, unknown>[];
      rows[t.name] = all.map((r) => ({ ...r })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    const hasRecord = schema.some((s) => s.type === "table" && s.name === "__framework_migrations");
    const record = hasRecord
      ? (db.prepare(`SELECT * FROM "__framework_migrations" ORDER BY rowid`).all() as Record<string, unknown>[]).map((r) => ({ ...r }))
      : [];
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
    return { schema, rows, record, foreignKeyViolations };
  } finally {
    db.close();
  }
}

/** The single local D1 database of the app (fails the caller's expectation if not exactly one). */
export function onlyD1Database(appDir: string): string {
  const files = d1DatabaseFiles(appDir);
  if (files.length !== 1) throw new Error(`expected exactly one local D1 database, found ${files.length}: ${files.join(", ")}`);
  return files[0] ?? "";
}
