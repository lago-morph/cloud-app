/**
 * Cloudflare `copyDatabase`: the fallback page-by-page copy (DEC-0096; migrations.md §2
 * "Cloudflare") against the fake D1 HTTP API. Fixture: tens of rows covering the A-06 cases
 * (reference order, cycles, value types and edge values, rowids, indexes, sequence).
 */
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../../tests/support/tags.js";
import { AUTH_MODEL_NAMES, authSchema } from "../../../auth/password/tables.js";
import { applyMigrations, type D1Like } from "../../../mig/apply.js";
import { readHistory } from "../../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../../mig/migrations-dir.js";
import { openFakeD1Api, type FakeD1Api, type FakeRequest } from "./fake-d1-api.js";
import { d1DatabaseOperations, type D1DatabaseOperations } from "./operations.js";
import type { StageDatabase } from "../../core/operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

const SCHEMA = [
  // created before the table it references
  `CREATE TABLE "a_child" ("id" text PRIMARY KEY NOT NULL, "parent_id" text NOT NULL REFERENCES "z_parent"("id"), "n" integer, "r" real, "note" text, "b" blob)`,
  `CREATE TABLE "z_parent" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "code" text)`,
  `CREATE UNIQUE INDEX "z_parent_code_unique" ON "z_parent" ("code")`,
  `CREATE INDEX "a_child_parent_idx" ON "a_child" ("parent_id")`,
  `CREATE TABLE "self_ref" ("id" text PRIMARY KEY NOT NULL, "up" text REFERENCES "self_ref"("id"))`,
  `CREATE TABLE "cyc_a" ("id" text PRIMARY KEY NOT NULL, "b_id" text REFERENCES "cyc_b"("id"))`,
  `CREATE TABLE "cyc_b" ("id" text PRIMARY KEY NOT NULL, "a_id" text REFERENCES "cyc_a"("id"))`,
  `CREATE TABLE "x_seq" ("id" integer PRIMARY KEY AUTOINCREMENT, "v" text)`,
  `CREATE TABLE "__framework_kv" ("key" text PRIMARY KEY NOT NULL, "value" text NOT NULL)`,
];

async function seed(db: D1Like): Promise<void> {
  const s = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params);
  await db.batch([
    s("PRAGMA defer_foreign_keys = on"),
    ...SCHEMA.map((sql) => s(sql)),
    // children before parents, rowids out of key order
    s(`INSERT INTO "a_child" VALUES ('c1', 'p1', 2147483647, 0.1, 'x', X'00ff')`),
    s(`INSERT INTO "a_child" VALUES ('c2', 'p2', -2147483648, ?, '', X'')`, 1 / 3),
    s(`INSERT INTO "a_child" VALUES ('c3', 'p1', 9007199254740991, 1e308, NULL, NULL)`),
    s(`INSERT INTO "a_child" VALUES ('c4', 'p3', CAST('9223372036854775807' AS INTEGER), 2.0, 'tab\tnew\nline', NULL)`),
    s(`INSERT INTO "a_child" VALUES ('c5', 'p3', 0, -2.5e-10, ?, NULL)`, "a\u0000b"),
    s(`INSERT INTO "z_parent" VALUES ('p3', '👩‍👩‍👧 ‮rtl é', NULL)`),
    s(`INSERT INTO "z_parent" VALUES ('p1', '', 'one')`),
    s(`INSERT INTO "z_parent" VALUES ('p2', 'NULL', '')`),
    s(`INSERT INTO "self_ref" VALUES ('s2', 's1')`),
    s(`INSERT INTO "self_ref" VALUES ('s1', NULL)`),
    s(`INSERT INTO "self_ref" VALUES ('s3', 's3')`),
    s(`INSERT INTO "cyc_a" VALUES ('a1', 'b1')`),
    s(`INSERT INTO "cyc_b" VALUES ('b1', 'a1')`),
    s(`INSERT INTO "x_seq" ("v") VALUES ('one'), ('two'), ('three')`),
    s(`DELETE FROM "x_seq" WHERE "id" = 3`),
    s(`INSERT INTO "__framework_kv" VALUES ('k', '{"a":"; -- /* */ ''q''"}')`),
  ]);
}

/** Schema, every value with its type in rowid order, the sequence and the FK check. */
async function fingerprint(db: D1Like): Promise<unknown> {
  const all = async (sql: string) => (await db.prepare(sql).all<Record<string, unknown>>()).results;
  const schema = await all(`SELECT "type", "name", "tbl_name", "sql" FROM sqlite_master WHERE "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY "type", "name"`);
  const tables: Record<string, unknown> = {};
  for (const t of schema.filter((r) => r["type"] === "table" && r["name"] !== "sqlite_sequence")) {
    const name = String(t["name"]);
    const cols = (await all(`PRAGMA table_info("${name}")`)).map((c) => String(c["name"]));
    const sel = ["rowid", ...cols].map((c) => `typeof("${c}"), CASE typeof("${c}") WHEN 'integer' THEN CAST("${c}" AS TEXT) WHEN 'blob' THEN hex("${c}") ELSE "${c}" END`).join(", ");
    tables[name] = await (db.prepare(`SELECT ${sel} FROM "${name}" ORDER BY rowid`) as unknown as { raw(): Promise<unknown[][]> }).raw();
  }
  const sequence = schema.some((r) => r["name"] === "sqlite_sequence") ? await all(`SELECT * FROM sqlite_sequence ORDER BY "name"`) : [];
  return { schema, tables, sequence, fk: await all("PRAGMA foreign_key_check") };
}

type Batch = { sql: string; params?: unknown[] }[];
const batchOf = (req: FakeRequest): Batch => (req.body as { batch?: Batch } | undefined)?.batch ?? [];
const isWrite = (req: FakeRequest) => batchOf(req)[0]?.sql === "PRAGMA defer_foreign_keys = on";
const data = (b: Batch) => b.filter((s) => s.sql.startsWith("INSERT INTO") && !s.sql.startsWith("INSERT INTO sqlite_sequence"));
const rowsIn = (b: Batch) => data(b).reduce((n, s) => n + (s.sql.match(/\), \(/g)?.length ?? 0) + 1, 0);
const valueBytes = (b: Batch) =>
  data(b).flatMap((s) => s.params ?? []).reduce<number>((n, p) => n + (typeof p === "string" ? new TextEncoder().encode(p).length : p === null ? 0 : 8), 0);

describe("D1 copyDatabase (fallback page-by-page copy)", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  let source: StageDatabase;
  beforeEach(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    source = await d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT }).createDatabase(stage, "notes-test-abc-db-1");
    await seed(fake.database(source.id));
  }, 60_000);
  afterEach(async () => {
    fake.intercept = undefined;
    await fake?.close();
  });

  const copy = (ops: D1DatabaseOperations) => ops.copyDatabase(stage, source, "notes-test-abc-db-2");

  it(tag("MIG-AC-003", "the copy is identical: schema, every value with its type, rowids, indexes, sequence, intact references"), async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const before = await fingerprint(fake.database(source.id));
    const copied = await copy(ops);
    expect(copied).toMatchObject({ name: "notes-test-abc-db-2", number: 2 });
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
    expect(await fingerprint(fake.database(source.id))).toEqual(before);
  });

  it("a small database is copied cheaply: one create, three metadata reads, one value read, one write page", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const start = fake.requests.length;
    await copy(ops);
    const reqs = fake.requests.slice(start);
    expect(reqs.filter((r) => r.method === "POST" && r.path.endsWith("/d1/database"))).toHaveLength(1);
    expect(reqs.filter(isWrite)).toHaveLength(1);
    expect(reqs).toHaveLength(6);
  });

  it("pages stay within the limits (rows, value bytes, 100 parameters per statement); a larger row goes alone", async () => {
    const big = "é".repeat(600); // 1,200 bytes > the page's 1,000
    await fake.database(source.id).prepare(`INSERT INTO "__framework_kv" VALUES ('big', ?)`).bind(big).run();
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, limits: { pageRows: 4, pageBytes: 1000 } });
    const before = await fingerprint(fake.database(source.id));
    const start = fake.requests.length;
    const copied = await copy(ops);
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
    const writes = fake.requests.slice(start).filter(isWrite).map(batchOf);
    expect(writes.length).toBeGreaterThanOrEqual(5);
    for (const b of writes) {
      expect(rowsIn(b)).toBeLessThanOrEqual(4);
      if (valueBytes(b) > 1000) expect(rowsIn(b), JSON.stringify(b).slice(0, 300)).toBe(1);
      for (const s of b) {
        expect((s.params ?? []).length).toBeLessThanOrEqual(100);
        expect(new TextEncoder().encode(s.sql).length).toBeLessThan(100_000);
      }
    }
  });

  it("a reference cycle larger than one page is copied parents first, never splitting a row cycle", async () => {
    const db = fake.database(source.id);
    // a chain s10 -> s9 -> … -> s4 -> s1 inserted child first, plus a two-row cycle
    const chain = Array.from({ length: 7 }, (_, i) => db.prepare(`INSERT INTO "self_ref" VALUES (?, ?)`).bind(`s${10 - i}`, i === 6 ? "s1" : `s${9 - i}`));
    await db.batch([db.prepare("PRAGMA defer_foreign_keys = on"), ...chain, db.prepare(`INSERT INTO "cyc_a" VALUES ('a2', 'b2')`), db.prepare(`INSERT INTO "cyc_b" VALUES ('b2', 'a2')`)]);
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, limits: { pageRows: 2 } });
    const before = await fingerprint(db);
    const copied = await copy(ops);
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
  });

  it("a failed copy deletes the new database and names the step that failed", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    fake.intercept = async (req, run) => (isWrite(req) ? { status: 400, body: { success: false, errors: [{ code: 7500, message: "boom" }], result: [] } } : run());
    const err = await copy(ops).then(
      () => new Error("expected a failure"),
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/copying D1 database notes-test-abc-db-1 into notes-test-abc-db-2 failed: .*boom/);
    expect(err.message).toMatch(/the new database was deleted/);
    fake.intercept = undefined;
    expect((await ops.listDatabases()).map((d) => d.name)).toEqual(["notes-test-abc-db-1"]);
  });

  it("a table with more columns than one statement can bind is refused clearly", async () => {
    const cols = Array.from({ length: 100 }, (_, i) => `"c${i}" text`).join(", ");
    await fake.database(source.id).prepare(`CREATE TABLE "wide" (${cols})`).run();
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    await expect(copy(ops)).rejects.toThrow(/table wide has 101 columns including rowid; the copy binds at most 100 values per statement/);
  });
});

// Better Auth's tables (password.md §2 "Tables"; plan-auth.md item I-A): the copy copies them
// like any other table, so accounts survive a schema-changing deploy.
describe("D1 copyDatabase with the framework history, Better Auth's tables included", { timeout: 60_000 }, () => {
  const ORIGIN = "http://localhost:8787";
  const auth = (binding: D1Like) =>
    betterAuth({
      baseURL: ORIGIN,
      basePath: "/api/auth/password",
      secret: "copy-unit-test-secret-0123456789abcdef0123",
      trustedOrigins: [ORIGIN],
      telemetry: { enabled: false },
      logger: { level: "error" },
      database: drizzleAdapter(drizzleD1(binding as never), { provider: "sqlite", schema: authSchema("sqlite") }),
      user: { modelName: AUTH_MODEL_NAMES.user },
      account: { modelName: AUTH_MODEL_NAMES.account },
      session: { modelName: AUTH_MODEL_NAMES.session },
      verification: { modelName: AUTH_MODEL_NAMES.verification },
      rateLimit: { enabled: true, storage: "database", modelName: AUTH_MODEL_NAMES.rateLimit, window: 60, max: 100 },
      advanced: { disableOriginCheck: false, ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
      emailAndPassword: { enabled: true, requireEmailVerification: false, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    });
  const post = (path: string, body: unknown) =>
    new Request(`${ORIGIN}/api/auth/password${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "192.0.2.20" },
      body: JSON.stringify(body),
    });
  const credentials = { email: "dora@example.test", password: "a long enough password" };

  let fake: FakeD1Api;
  afterEach(async () => {
    await fake?.close();
  });

  it(tag("MIG-AC-003", "every Better Auth table and row is copied identically, and an account made before the copy signs in on the copy"), async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const source = await ops.createDatabase(stage, "notes-test-abc-db-1");
    const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework");
    await applyMigrations(ops.migrationDatabase(source), { framework, app: [] });

    const before = auth(fake.database(source.id));
    expect((await before.handler(post("/sign-up/email", { ...credentials, name: "Dora" }))).status).toBe(200);
    expect((await before.handler(post("/sign-in/email", credentials))).status).toBe(200);
    const ctx = await before.$context;
    await ctx.internalAdapter.createVerificationValue({ identifier: "reset-password:copy", value: "v", expiresAt: new Date(Date.now() + 3_600_000) });
    const db = fake.database(source.id);
    for (const table of Object.values(AUTH_MODEL_NAMES)) {
      const n = (await db.prepare(`SELECT count(*) AS n FROM "${table}"`).all<{ n: number }>()).results[0]?.n;
      expect(n, table).toBeGreaterThan(0);
    }

    const print = await fingerprint(db);
    const copied = await ops.copyDatabase(stage, source, "notes-test-abc-db-2");
    expect(await fingerprint(fake.database(copied.id))).toEqual(print);
    await ops.checkMigratedDatabase({ stage, previous: source, next: copied, applied: [], migrations: { framework, app: [] } });

    const after = auth(fake.database(copied.id));
    const signIn = await after.handler(post("/sign-in/email", credentials));
    expect(signIn.status).toBe(200);
    expect(((await signIn.json()) as { user: { name: string } }).user.name).toBe("Dora");
  });
});
