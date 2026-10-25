/**
 * Framework tables (migrations.md §2 "Generation", "Record"; kv.md §2) and the location of
 * their migration histories, shipped in the package under `migrations/`
 * (`FW/migrations/{sqlite,postgres}/`, generated from these definitions by the same engine as
 * app migrations; a unit test keeps them in step).
 *
 * - `__framework_kv(key text primary key, value text not null)` — KV storage (DEC-0010).
 * - `__framework_migrations(id, dialect, checksum, applied_at)` — the migration record:
 *   `id` is `<history>/<base name>` (`framework/0000_framework_tables`, `app/0001_schema`),
 *   `checksum` the file's SHA-256 hex, `applied_at` epoch milliseconds.
 * - `__framework_auth_{user,account,session,verification,rate_limit}` — Better Auth's tables
 *   for the password provider (password.md §2 "Tables"), defined in `auth/password/tables.ts`
 *   and added by the history's second migration, `0001_auth_tables`.
 *
 * These are plain Drizzle tables, not `defineTable` tables: their keys are not UUIDs.
 * Workers-compatible; the histories' location (Node only) is `migrations-dir.ts`.
 */
import { bigint as pgBigint, pgTable, text as pgText } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { authSchema } from "../auth/password/tables.js";
import type { Dialect } from "../sql/dialect.js";

export const KV_TABLE = "__framework_kv";
export const MIGRATIONS_TABLE = "__framework_migrations";

function build(dialect: Dialect) {
  if (dialect === "sqlite") {
    return {
      kv: sqliteTable(KV_TABLE, { key: sqliteText("key").primaryKey(), value: sqliteText("value").notNull() }),
      migrations: sqliteTable(MIGRATIONS_TABLE, {
        id: sqliteText("id").primaryKey(),
        dialect: sqliteText("dialect").notNull(),
        checksum: sqliteText("checksum").notNull(),
        appliedAt: sqliteInteger("applied_at", { mode: "number" }).notNull(),
      }),
    };
  }
  return {
    kv: pgTable(KV_TABLE, { key: pgText("key").primaryKey(), value: pgText("value").notNull() }),
    migrations: pgTable(MIGRATIONS_TABLE, {
      id: pgText("id").primaryKey(),
      dialect: pgText("dialect").notNull(),
      checksum: pgText("checksum").notNull(),
      appliedAt: pgBigint("applied_at", { mode: "number" }).notNull(),
    }),
  };
}

const sqlite = build("sqlite");
const postgres = build("postgres");

/** The framework tables of `dialect` (Drizzle tables; KV queries use `.kv`). */
export function frameworkTables(dialect: "sqlite"): typeof sqlite;
export function frameworkTables(dialect: "postgres"): typeof postgres;
export function frameworkTables(dialect: Dialect): typeof sqlite | typeof postgres;
export function frameworkTables(dialect: Dialect): typeof sqlite | typeof postgres {
  return dialect === "sqlite" ? sqlite : postgres;
}

/** The framework schema for the generator: KV, the migration record and Better Auth's tables. */
export function frameworkSchema(dialect: Dialect): Record<string, unknown> {
  return { ...frameworkTables(dialect), ...authSchema(dialect) };
}
