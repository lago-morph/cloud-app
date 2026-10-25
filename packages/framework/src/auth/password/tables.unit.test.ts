/**
 * Better Auth's tables in the framework migration histories (password.md §2 "Tables";
 * plan-auth.md item I-A), on the real local databases: local D1 through Wrangler's
 * getPlatformProxy (DEC-0105) and the PGlite harness with C collation (DEC-0106).
 *
 * - the framework history (0000, 0001_auth_tables, then MAIL's 0002_framework_test_mail) applies on both, recorded per file;
 * - after each framework migration pair the two dialects have the same logical schema, by the
 *   migration checker's own introspection and `compareDialects` (the `migration-dialects`
 *   check), and each migration is a supported, data-free change;
 * - a minimal BA instance (PAR-122, `better-auth/minimal` + `better-auth/adapters/drizzle`)
 *   over these tables reads and writes each of its five models.
 */
import type { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { compareDialects, dataStatements, unsupportedChanges } from "../../check/migrations/compare.js";
import { openCheckDatabase, type DatabaseSchema, type TableSchema } from "../../check/migrations/databases.js";
import { applyMigrations, d1MigrationDatabase, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "../../mig/apply.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { readHistory } from "../../mig/history.js";
import type { Dialect } from "../../sql/dialect.js";
import { openPostgres } from "../../sql/postgres.js";
import { AUTH_MODEL_NAMES, authSchema } from "./tables.js";

const AUTH_TABLES = Object.values(AUTH_MODEL_NAMES).sort();
const ORIGIN = "http://localhost:8787";
const SECRET = "auth-tables-unit-test-secret-0123456789abcdef";
const PASSWORD = "correct horse battery";

describe("the framework history holds Better Auth's tables", () => {
  it("is 0000_framework_tables then 0001_auth_tables in both dialects, paired, with checksums", () => {
    const sums = JSON.parse(readFileSync(`${FRAMEWORK_MIGRATIONS_DIR}checksums.json`, "utf8")) as Record<string, string>;
    for (const dialect of ["sqlite", "postgres"] as const) {
      const history = readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework");
      expect(history.map((m) => m.id)).toEqual(["framework/0000_framework_tables", "framework/0001_auth_tables", "framework/0002_framework_test_mail"]);
      for (const table of AUTH_TABLES) expect(history[1]?.text).toContain(table);
      expect(sums[`${dialect}/0001_auth_tables.sql`]).toBe(history[1]?.checksum);
    }
  });

  it(
    "both dialects apply it migration by migration and have the same logical schema after each pair (migration-dialects), with supported, data-free changes",
    async () => {
      const states: Record<Dialect, DatabaseSchema[]> = { sqlite: [], postgres: [] };
      // One dialect after the other, never concurrently (checker.ts).
      for (const dialect of ["sqlite", "postgres"] as const) {
        const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework");
        const db = await openCheckDatabase(dialect);
        try {
          let previous: DatabaseSchema = {};
          for (let i = 0; i < framework.length; i++) {
            const m = framework[i];
            if (m === undefined) continue;
            expect(dataStatements(m.statements), `${dialect}/${m.name}`).toEqual([]);
            const result = await applyMigrations(db.migrations, { framework: framework.slice(0, i + 1), app: [] });
            expect(result.applied).toEqual([m.id]);
            const state = await db.introspect();
            expect(unsupportedChanges(previous, state), `${dialect}/${m.name}`).toEqual([]);
            states[dialect].push(state);
            previous = state;
          }
          expect((await applyMigrations(db.migrations, { framework, app: [] })).applied).toEqual([]);
        } finally {
          await db.close();
        }
      }
      expect(states.sqlite.length).toBe(states.postgres.length);
      for (let i = 0; i < states.sqlite.length; i++) expect(compareDialects(states.sqlite[i] ?? {}, states.postgres[i] ?? {}), `after framework migration ${i}`).toEqual([]);

      const last = states.sqlite[states.sqlite.length - 1] ?? {};
      expect(Object.keys(last).sort()).toEqual(["__framework_kv", "__framework_migrations", "__framework_test_mail", ...AUTH_TABLES].sort());
      const shape = (t: TableSchema | undefined) => ({ columns: Object.keys(t?.columns ?? {}), indexes: t?.indexes, uniques: t?.uniques, foreignKeys: t?.foreignKeys });
      const cascade = ["user_id -> __framework_auth_user(id) on update no action on delete cascade"];
      expect(shape(last[AUTH_MODEL_NAMES.user])).toEqual({ columns: ["id", "name", "email", "email_verified", "image", "created_at", "updated_at"], indexes: [], uniques: ["email"], foreignKeys: [] });
      expect(shape(last[AUTH_MODEL_NAMES.session])).toEqual({
        columns: ["id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_id"],
        indexes: ["user_id"],
        uniques: ["token"],
        foreignKeys: cascade,
      });
      expect(shape(last[AUTH_MODEL_NAMES.account])).toEqual({
        columns: ["id", "account_id", "provider_id", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at"],
        indexes: ["user_id"],
        uniques: [],
        foreignKeys: cascade,
      });
      expect(shape(last[AUTH_MODEL_NAMES.verification])).toEqual({ columns: ["id", "identifier", "value", "expires_at", "created_at", "updated_at"], indexes: ["identifier"], uniques: [], foreignKeys: [] });
      expect(shape(last[AUTH_MODEL_NAMES.rateLimit])).toEqual({ columns: ["id", "key", "count", "last_request"], indexes: [], uniques: ["key"], foreignKeys: [] });
      // Timestamps are epoch milliseconds in both dialects, like every framework timestamp.
      expect(states.postgres[states.postgres.length - 1]?.[AUTH_MODEL_NAMES.user]?.columns["created_at"]?.type).toBe("bigint");
      expect(last[AUTH_MODEL_NAMES.user]?.columns["created_at"]?.type).toBe("integer");
    },
    120_000,
  );
});

interface Harness {
  readonly dialect: Dialect;
  readonly migrations: MigrationDatabase;
  /** A Drizzle database over the same connection, for BA's adapter. */
  readonly db: unknown;
  readonly provider: "sqlite" | "pg";
  /** Rows of a raw query (`?` placeholders). */
  rows(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  const binding = proxy.env.DB;
  return {
    dialect: "sqlite",
    migrations: d1MigrationDatabase(binding),
    db: drizzleD1(binding as never),
    provider: "sqlite",
    rows: async (sql, ...params) => (await binding.prepare(sql).bind(...params).all<Record<string, unknown>>()).results,
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg: PGlite = await openPostgres();
  return {
    dialect: "postgres",
    migrations: pgliteMigrationDatabase(pg),
    db: drizzlePglite(pg),
    provider: "pg",
    rows: async (sql, ...params) => {
      let n = 0;
      return (await pg.query<Record<string, unknown>>(sql.replace(/\?/g, () => `$${++n}`), params)).rows;
    },
    close: () => pg.close(),
  };
}

/** A minimal BA instance over the framework tables, with the options password.md §2 forces on. */
function minimalAuth(h: Harness) {
  return betterAuth({
    baseURL: ORIGIN,
    basePath: "/api/auth/password",
    secret: SECRET,
    trustedOrigins: [ORIGIN],
    telemetry: { enabled: false },
    logger: { level: "error" },
    database: drizzleAdapter(h.db as never, { provider: h.provider, schema: authSchema(h.dialect) }),
    user: { modelName: AUTH_MODEL_NAMES.user },
    account: { modelName: AUTH_MODEL_NAMES.account },
    session: { modelName: AUTH_MODEL_NAMES.session },
    verification: { modelName: AUTH_MODEL_NAMES.verification },
    rateLimit: { enabled: true, storage: "database", modelName: AUTH_MODEL_NAMES.rateLimit, window: 60, max: 100 },
    advanced: { disableOriginCheck: false, ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    emailAndPassword: { enabled: true, requireEmailVerification: false, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
  });
}

const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}/api/auth/password${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "192.0.2.10" },
    body: JSON.stringify(body),
  });

describe.each([
  ["sqlite (local D1)", openD1],
  ["postgres (PGlite)", openPg],
] as const)("Better Auth's Drizzle adapter on %s", (_name, open) => {
  let h: Harness;
  let auth: ReturnType<typeof minimalAuth>;

  beforeAll(async () => {
    h = await open();
    const applied = await applyMigrations(h.migrations, {
      framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, h.dialect, "framework"),
      app: [],
    });
    expect(applied.applied).toEqual(["framework/0000_framework_tables", "framework/0001_auth_tables", "framework/0002_framework_test_mail"]);
    auth = minimalAuth(h);
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  const count = async (table: string) => Number((await h.rows(`SELECT count(*) AS n FROM "${table}"`))[0]?.["n"]);

  it("sign-up and sign-in through BA's handler write the user, account, session and rate-limit tables", async () => {
    const signUp = await auth.handler(post("/sign-up/email", { email: "alice@example.test", password: PASSWORD, name: "Alice" }));
    expect(signUp.status).toBe(200);
    const users = await h.rows(`SELECT * FROM "${AUTH_MODEL_NAMES.user}"`);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: "Alice", email: "alice@example.test" });
    const accounts = await h.rows(`SELECT * FROM "${AUTH_MODEL_NAMES.account}"`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ provider_id: "credential", user_id: users[0]?.["id"] });
    expect(String(accounts[0]?.["password"])).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await count(AUTH_MODEL_NAMES.session)).toBe(0); // autoSignIn: false

    const signIn = await auth.handler(post("/sign-in/email", { email: "alice@example.test", password: PASSWORD }));
    expect(signIn.status).toBe(200);
    const body = (await signIn.json()) as { token: string; user: { id: string; name: string; emailVerified: boolean; createdAt: string } };
    expect(body.user).toMatchObject({ id: users[0]?.["id"], name: "Alice", emailVerified: false });
    expect(Number.isNaN(Date.parse(body.user.createdAt))).toBe(false);
    const sessions = await h.rows(`SELECT * FROM "${AUTH_MODEL_NAMES.session}" WHERE "token" = ?`, body.token);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user_id: body.user.id, ip_address: "192.0.2.10" });
    // Dates are stored as epoch milliseconds.
    expect(Math.abs(Number(sessions[0]?.["created_at"]) - Date.now())).toBeLessThan(60_000);
    expect(Number(sessions[0]?.["expires_at"])).toBeGreaterThan(Date.now());

    const wrong = await auth.handler(post("/sign-in/email", { email: "alice@example.test", password: "wrong password!!" }));
    expect(wrong.status).toBe(401);
    const limits = await h.rows(`SELECT * FROM "${AUTH_MODEL_NAMES.rateLimit}" ORDER BY "key"`);
    expect(limits.map((r) => [r["key"], Number(r["count"])])).toEqual([
      ["192.0.2.10|/sign-in/email", 2],
      ["192.0.2.10|/sign-up/email", 1],
    ]);
    expect(Number(limits[0]?.["last_request"])).toBeGreaterThan(Date.now() - 60_000);
  });

  it("the adapter creates, reads, updates and deletes a row of each model, with dates and booleans round-tripped", async () => {
    const ctx = await auth.$context;
    const adapter = ctx.adapter;
    const at = new Date(Date.UTC(2026, 9, 25, 12, 0, 0, 123));
    const later = new Date(at.getTime() + 3_600_000);

    const user = await adapter.create<Record<string, unknown>>({ model: "user", data: { name: "Bob", email: "bob@example.test", emailVerified: true, createdAt: at, updatedAt: at } });
    const userId = String(user["id"]);
    expect(await adapter.findOne({ model: "user", where: [{ field: "email", value: "bob@example.test" }] })).toMatchObject({ id: userId, name: "Bob", emailVerified: true, createdAt: at });
    await adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { name: "Bobby", updatedAt: later } });
    expect(await adapter.findOne({ model: "user", where: [{ field: "id", value: userId }] })).toMatchObject({ name: "Bobby", updatedAt: later });

    const account = await adapter.create<Record<string, unknown>>({
      model: "account",
      data: { accountId: userId, providerId: "credential", userId, password: "x", accessTokenExpiresAt: later, createdAt: at, updatedAt: at },
    });
    expect(await adapter.findOne({ model: "account", where: [{ field: "id", value: String(account["id"]) }] })).toMatchObject({ userId, providerId: "credential", accessTokenExpiresAt: later });

    const session = await adapter.create<Record<string, unknown>>({ model: "session", data: { token: "tok-bob", userId, expiresAt: later, createdAt: at, updatedAt: at, userAgent: "ua" } });
    expect(await adapter.findOne({ model: "session", where: [{ field: "token", value: "tok-bob" }] })).toMatchObject({ id: session["id"], userId, expiresAt: later, userAgent: "ua" });
    expect(await adapter.count({ model: "session", where: [{ field: "expiresAt", operator: "gt", value: at }] })).toBeGreaterThanOrEqual(1);

    const verification = await ctx.internalAdapter.createVerificationValue({ identifier: "reset-password:tok", value: userId, expiresAt: later });
    expect(await ctx.internalAdapter.findVerificationValue("reset-password:tok")).toMatchObject({ id: verification.id, value: userId, expiresAt: later });
    await ctx.internalAdapter.deleteVerificationByIdentifier("reset-password:tok");
    expect(await ctx.internalAdapter.findVerificationValue("reset-password:tok")).toBeNull();

    await adapter.create({ model: "rateLimit", data: { key: "198.51.100.1|/x", count: 1, lastRequest: at.getTime() } });
    await adapter.update({ model: "rateLimit", where: [{ field: "key", value: "198.51.100.1|/x" }], update: { count: 2, lastRequest: later.getTime() } });
    expect(await adapter.findOne({ model: "rateLimit", where: [{ field: "key", value: "198.51.100.1|/x" }] })).toMatchObject({ count: 2, lastRequest: later.getTime() });
    await adapter.delete({ model: "rateLimit", where: [{ field: "key", value: "198.51.100.1|/x" }] });
    expect(await adapter.findOne({ model: "rateLimit", where: [{ field: "key", value: "198.51.100.1|/x" }] })).toBeNull();

    // Deleting the user cascades to its account and session rows.
    await adapter.delete({ model: "user", where: [{ field: "id", value: userId }] });
    expect(await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.account}" WHERE "user_id" = ?`, userId)).toEqual([]);
    expect(await h.rows(`SELECT "id" FROM "${AUTH_MODEL_NAMES.session}" WHERE "user_id" = ?`, userId)).toEqual([]);
  });

  it("the unique email refuses a second user with the same address", async () => {
    const ctx = await auth.$context;
    const at = new Date();
    await ctx.adapter.create({ model: "user", data: { name: "Carol", email: "carol@example.test", emailVerified: false, createdAt: at, updatedAt: at } });
    await expect(ctx.adapter.create({ model: "user", data: { name: "Carol 2", email: "carol@example.test", emailVerified: false, createdAt: at, updatedAt: at } })).rejects.toThrow();
  });
});
