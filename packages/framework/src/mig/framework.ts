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
 * - `__framework_test_mail(id, recipient, sender, subject, text_body, html_body, sent_at)` — the
 *   test-stage mail capture (mail.md §2): written only by the `test-*` stages' capture sender,
 *   so it stays empty on production stages. `sent_at` is an ISO 8601 UTC time (sortable as text).
 *
 * These are plain Drizzle tables, not `defineTable` tables: their keys are not UUIDs.
 * Workers-compatible; the histories' location (Node only) is `migrations-dir.ts`.
 */
import { bigint as pgBigint, pgTable, text as pgText } from "drizzle-orm/pg-core";
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import type { Dialect } from "../sql/dialect.js";

export const KV_TABLE = "__framework_kv";
export const MIGRATIONS_TABLE = "__framework_migrations";
export const TEST_MAIL_TABLE = "__framework_test_mail";

const TEST_MAIL_COLUMNS = ["id", "recipient", "sender", "subject", "text_body", "html_body", "sent_at"] as const;

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
      testMail: sqliteTable(TEST_MAIL_TABLE, {
        id: sqliteText(TEST_MAIL_COLUMNS[0]).primaryKey(),
        recipient: sqliteText(TEST_MAIL_COLUMNS[1]).notNull(),
        sender: sqliteText(TEST_MAIL_COLUMNS[2]).notNull(),
        subject: sqliteText(TEST_MAIL_COLUMNS[3]).notNull(),
        text: sqliteText(TEST_MAIL_COLUMNS[4]).notNull(),
        html: sqliteText(TEST_MAIL_COLUMNS[5]).notNull(),
        sentAt: sqliteText(TEST_MAIL_COLUMNS[6]).notNull(),
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
    testMail: pgTable(TEST_MAIL_TABLE, {
      id: pgText(TEST_MAIL_COLUMNS[0]).primaryKey(),
      recipient: pgText(TEST_MAIL_COLUMNS[1]).notNull(),
      sender: pgText(TEST_MAIL_COLUMNS[2]).notNull(),
      subject: pgText(TEST_MAIL_COLUMNS[3]).notNull(),
      text: pgText(TEST_MAIL_COLUMNS[4]).notNull(),
      html: pgText(TEST_MAIL_COLUMNS[5]).notNull(),
      sentAt: pgText(TEST_MAIL_COLUMNS[6]).notNull(),
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

/** The framework schema for the generator. */
export function frameworkSchema(dialect: Dialect): Record<string, unknown> {
  return { ...frameworkTables(dialect) };
}
