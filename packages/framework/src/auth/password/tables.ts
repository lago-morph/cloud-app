/**
 * Better Auth's tables (password.md §2 "Tables"; plan-auth.md §1 "Tables"; DEC-0509, DEC-0510).
 *
 * BA's five models are renamed with `modelName` to `__framework_auth_user`, `…_account`,
 * `…_session`, `…_verification` and `…_rate_limit`. They are plain Drizzle tables (BA makes
 * the IDs, so they are not `defineTable` tables) and part of the framework schema
 * (`frameworkSchema`, framework.ts), so the framework migration histories of both dialects
 * hold them (MIG §2). BA's own `migrate` is never used.
 *
 * - Object keys are BA's field names (camelCase); SQL columns are snake_case.
 * - The keys of `authSchema(dialect)` are the `modelName`s, which is what BA's Drizzle adapter
 *   looks up (`drizzleAdapter(db, { provider, schema: authSchema(dialect) })`).
 * - Dates are epoch milliseconds in both dialects (sqlite `integer`, postgres `bigint`), like
 *   every other framework timestamp (SQL §2.1), so the two histories have the same logical
 *   schema (CHECK-REQ-004). BA reads and writes them as `Date`.
 * - Index, unique and reference names follow `defineTable`'s convention
 *   (`<table>_<column>_idx|_unique|_fk`).
 *
 * Workers-compatible: framework.ts, which imports this, is in every Worker bundle.
 */
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  customType as pgCustomType,
  foreignKey as pgForeignKey,
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  text as pgText,
  unique as pgUnique,
} from "drizzle-orm/pg-core";
import {
  foreignKey as sqliteForeignKey,
  index as sqliteIndex,
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
  unique as sqliteUnique,
} from "drizzle-orm/sqlite-core";
import type { Dialect } from "../../sql/dialect.js";

/** BA's model → its framework table name (the `modelName` option of each model). */
export const AUTH_MODEL_NAMES = {
  user: "__framework_auth_user",
  account: "__framework_auth_account",
  session: "__framework_auth_session",
  verification: "__framework_auth_verification",
  rateLimit: "__framework_auth_rate_limit",
} as const;

const T = AUTH_MODEL_NAMES;

/** Postgres `bigint` holding epoch milliseconds, read and written as `Date`. */
const pgEpochMs = pgCustomType<{ data: Date; driverData: string | number }>({
  dataType: () => "bigint",
  toDriver: (value) => value.getTime(),
  fromDriver: (value) => new Date(Number(value)),
});

function buildSqlite() {
  const ts = (name: string) => sqliteInteger(name, { mode: "timestamp_ms" });
  const user = sqliteTable(
    T.user,
    {
      id: sqliteText("id").primaryKey(),
      name: sqliteText("name").notNull(),
      email: sqliteText("email").notNull(),
      emailVerified: sqliteInteger("email_verified", { mode: "boolean" }).notNull().default(false),
      image: sqliteText("image"),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [sqliteUnique(`${T.user}_email_unique`).on(t.email)],
  );
  const session = sqliteTable(
    T.session,
    {
      id: sqliteText("id").primaryKey(),
      expiresAt: ts("expires_at").notNull(),
      token: sqliteText("token").notNull(),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
      ipAddress: sqliteText("ip_address"),
      userAgent: sqliteText("user_agent"),
      userId: sqliteText("user_id").notNull(),
    },
    (t) => [
      sqliteUnique(`${T.session}_token_unique`).on(t.token),
      sqliteIndex(`${T.session}_user_id_idx`).on(t.userId),
      sqliteForeignKey({ name: `${T.session}_user_id_fk`, columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    ],
  );
  const account = sqliteTable(
    T.account,
    {
      id: sqliteText("id").primaryKey(),
      accountId: sqliteText("account_id").notNull(),
      providerId: sqliteText("provider_id").notNull(),
      userId: sqliteText("user_id").notNull(),
      accessToken: sqliteText("access_token"),
      refreshToken: sqliteText("refresh_token"),
      idToken: sqliteText("id_token"),
      accessTokenExpiresAt: ts("access_token_expires_at"),
      refreshTokenExpiresAt: ts("refresh_token_expires_at"),
      scope: sqliteText("scope"),
      password: sqliteText("password"),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [
      sqliteIndex(`${T.account}_user_id_idx`).on(t.userId),
      sqliteForeignKey({ name: `${T.account}_user_id_fk`, columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    ],
  );
  const verification = sqliteTable(
    T.verification,
    {
      id: sqliteText("id").primaryKey(),
      identifier: sqliteText("identifier").notNull(),
      value: sqliteText("value").notNull(),
      expiresAt: ts("expires_at").notNull(),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [sqliteIndex(`${T.verification}_identifier_idx`).on(t.identifier)],
  );
  const rateLimit = sqliteTable(
    T.rateLimit,
    {
      id: sqliteText("id").primaryKey(),
      key: sqliteText("key").notNull(),
      count: sqliteInteger("count", { mode: "number" }).notNull(),
      lastRequest: sqliteInteger("last_request", { mode: "number" }).notNull(),
    },
    (t) => [sqliteUnique(`${T.rateLimit}_key_unique`).on(t.key)],
  );
  return { user, account, session, verification, rateLimit };
}

function buildPostgres() {
  const ts = (name: string) => pgEpochMs(name);
  const user = pgTable(
    T.user,
    {
      id: pgText("id").primaryKey(),
      name: pgText("name").notNull(),
      email: pgText("email").notNull(),
      emailVerified: pgBoolean("email_verified").notNull().default(false),
      image: pgText("image"),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [pgUnique(`${T.user}_email_unique`).on(t.email)],
  );
  const session = pgTable(
    T.session,
    {
      id: pgText("id").primaryKey(),
      expiresAt: ts("expires_at").notNull(),
      token: pgText("token").notNull(),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
      ipAddress: pgText("ip_address"),
      userAgent: pgText("user_agent"),
      userId: pgText("user_id").notNull(),
    },
    (t) => [
      pgUnique(`${T.session}_token_unique`).on(t.token),
      pgIndex(`${T.session}_user_id_idx`).on(t.userId),
      pgForeignKey({ name: `${T.session}_user_id_fk`, columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    ],
  );
  const account = pgTable(
    T.account,
    {
      id: pgText("id").primaryKey(),
      accountId: pgText("account_id").notNull(),
      providerId: pgText("provider_id").notNull(),
      userId: pgText("user_id").notNull(),
      accessToken: pgText("access_token"),
      refreshToken: pgText("refresh_token"),
      idToken: pgText("id_token"),
      accessTokenExpiresAt: ts("access_token_expires_at"),
      refreshTokenExpiresAt: ts("refresh_token_expires_at"),
      scope: pgText("scope"),
      password: pgText("password"),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [
      pgIndex(`${T.account}_user_id_idx`).on(t.userId),
      pgForeignKey({ name: `${T.account}_user_id_fk`, columns: [t.userId], foreignColumns: [user.id] }).onDelete("cascade"),
    ],
  );
  const verification = pgTable(
    T.verification,
    {
      id: pgText("id").primaryKey(),
      identifier: pgText("identifier").notNull(),
      value: pgText("value").notNull(),
      expiresAt: ts("expires_at").notNull(),
      createdAt: ts("created_at").notNull(),
      updatedAt: ts("updated_at").notNull(),
    },
    (t) => [pgIndex(`${T.verification}_identifier_idx`).on(t.identifier)],
  );
  const rateLimit = pgTable(
    T.rateLimit,
    {
      id: pgText("id").primaryKey(),
      key: pgText("key").notNull(),
      count: pgInteger("count").notNull(),
      lastRequest: pgBigint("last_request", { mode: "number" }).notNull(),
    },
    (t) => [pgUnique(`${T.rateLimit}_key_unique`).on(t.key)],
  );
  return { user, account, session, verification, rateLimit };
}

const sqlite = buildSqlite();
const postgres = buildPostgres();

/** BA's tables of `dialect`, by BA model (`user`, `account`, `session`, `verification`, `rateLimit`). */
export function authTables(dialect: "sqlite"): typeof sqlite;
export function authTables(dialect: "postgres"): typeof postgres;
export function authTables(dialect: Dialect): typeof sqlite | typeof postgres;
export function authTables(dialect: Dialect): typeof sqlite | typeof postgres {
  return dialect === "sqlite" ? sqlite : postgres;
}

/** The `schema` option of BA's Drizzle adapter: the tables keyed by their `modelName`. */
export function authSchema(dialect: Dialect): Record<(typeof AUTH_MODEL_NAMES)[keyof typeof AUTH_MODEL_NAMES], unknown> {
  const t = authTables(dialect);
  return {
    [T.user]: t.user,
    [T.account]: t.account,
    [T.session]: t.session,
    [T.verification]: t.verification,
    [T.rateLimit]: t.rateLimit,
  };
}
