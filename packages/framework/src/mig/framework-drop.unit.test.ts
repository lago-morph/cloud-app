/**
 * Upgrading a 0.1.x database (plan-v0.2.0 §8; DEC-0674): the framework migration after
 * `0003_auth_role` drops the five `__framework_auth_*` tables and `__framework_test_mail`, and
 * keeps the app's data. Both dialects: local D1 through Wrangler's getPlatformProxy, and PGlite.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { openPostgres } from "../sql/postgres.js";
import { applyMigrations, d1MigrationDatabase, pgliteMigrationDatabase, type D1Like, type MigrationDatabase } from "./apply.js";
import { readHistory } from "./history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "./migrations-dir.js";

interface Harness {
  db: MigrationDatabase;
  rows(sql: string): Promise<Record<string, unknown>[]>;
  run(sql: string): Promise<void>;
  tables(): Promise<string[]>;
  close(): Promise<void>;
}

async function openD1(): Promise<Harness> {
  const proxy = await getPlatformProxy<{ DB: D1Like & { prepare(sql: string): { run(): Promise<unknown> } } }>({ configPath: new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  const b = proxy.env.DB;
  const rows = async (sql: string) => (await b.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    db: d1MigrationDatabase(b),
    rows,
    run: async (sql) => void (await b.prepare(sql).run()),
    tables: async () => (await rows("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r["name"])),
    close: () => proxy.dispose(),
  };
}

async function openPg(): Promise<Harness> {
  const pg = await openPostgres();
  const rows = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;
  return {
    db: pgliteMigrationDatabase(pg),
    rows,
    run: async (sql) => void (await pg.exec(sql)),
    tables: async () => (await rows("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => String(r["name"])),
    close: () => pg.close(),
  };
}

const DROPPED = ["__framework_auth_user", "__framework_auth_account", "__framework_auth_session", "__framework_auth_verification", "__framework_auth_rate_limit", "__framework_test_mail"];

let open: Harness | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe.each([
  ["sqlite", openD1],
  ["postgres", openPg],
] as const)("upgrading a 0.1.x database (%s)", (dialect, opener) => {
  it("the next framework migration drops the six password and test-mail tables and keeps the app's data", { timeout: 60_000 }, async () => {
    const h = (open = await opener());
    const history = readHistory(FRAMEWORK_MIGRATIONS_DIR, dialect, "framework");
    const v01 = history.filter((m) => m.id <= "framework/0003_auth_role");
    expect(v01.map((m) => m.id)).toEqual(["framework/0000_framework_tables", "framework/0001_auth_tables", "framework/0002_framework_test_mail", "framework/0003_auth_role"]);
    await applyMigrations(h.db, { framework: v01, app: [] });
    expect(await h.tables()).toEqual(expect.arrayContaining(DROPPED));
    // The app's own data, and a row in a table that goes.
    await h.run(`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
    await h.run(`INSERT INTO notes (id, body) VALUES ('n1', 'kept')`);
    await h.run(`INSERT INTO __framework_kv (key, value) VALUES ('k', 'v')`);
    // Rows in the tables that go, a reference between two of them included.
    await h.run(`INSERT INTO __framework_auth_user (id, name, email, created_at, updated_at) VALUES ('u1', 'U', 'u@example.test', 1, 1)`);
    await h.run(`INSERT INTO __framework_auth_account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES ('a1', 'u1', 'credential', 'u1', 1, 1)`);
    await h.run(`INSERT INTO __framework_test_mail (id, recipient, sender, subject, text_body, html_body, sent_at) VALUES ('m1', 'r@example.test', 's@example.test', 'S', 't', 'h', '2026-01-01T00:00:00Z')`);

    const { applied } = await applyMigrations(h.db, { framework: history, app: [] });
    expect(applied).toEqual(["framework/0004_drop_auth_mail_tables"]);
    const after = await h.tables();
    for (const table of DROPPED) expect(after, table).not.toContain(table);
    expect(after).toEqual(expect.arrayContaining(["__framework_kv", "__framework_migrations", "notes"]));
    expect(await h.rows(`SELECT id, body FROM notes`)).toEqual([{ id: "n1", body: "kept" }]);
    expect(await h.rows(`SELECT key, value FROM __framework_kv`)).toEqual([{ key: "k", value: "v" }]);
    // Applying again changes nothing.
    expect((await applyMigrations(h.db, { framework: history, app: [] })).applied).toEqual([]);
  });
});
