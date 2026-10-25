/**
 * Cloudflare `copyDatabase` with D1's native export/import (DEC-0545): the pre-check decides,
 * the native path copies exactly, and every shape spike A-06 found to break it falls back to the
 * row-by-row copy, which the deploy output names. Against the fake D1 HTTP API (no Cloudflare call).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { D1Like } from "../../../mig/apply.js";
import type { StageDatabase } from "../../core/operations.js";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";
import { exportDump } from "./native-copy.js";
import { d1Client } from "./client.js";
import { d1DatabaseOperations, type D1DatabaseOperations } from "./operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

const SAFE_SCHEMA = [
  `CREATE TABLE "parents" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "n" integer, "r" real)`,
  `CREATE TABLE "children" ("id" text PRIMARY KEY NOT NULL, "parent_id" text NOT NULL REFERENCES "parents"("id"), "note" text, "b" blob)`,
  `CREATE UNIQUE INDEX "parents_name_unique" ON "parents" ("name")`,
  `CREATE TABLE "x_seq" ("id" integer PRIMARY KEY AUTOINCREMENT, "v" text)`,
];

async function seedSafe(db: D1Like): Promise<void> {
  const s = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params);
  await db.batch([
    ...SAFE_SCHEMA.map((sql) => s(sql)),
    s(`INSERT INTO "parents" VALUES ('p2', 'two', -2147483648, ?)`, 1 / 3),
    s(`INSERT INTO "parents" VALUES ('p1', '👩‍👩‍👧 ‮rtl é ''q''', 9007199254740991, 1e308)`),
    s(`INSERT INTO "parents" VALUES ('p3', '', NULL, NULL)`),
    s(`INSERT INTO "children" VALUES ('c1', 'p1', 'tab\tnew\nline\r', X'00ff')`),
    s(`INSERT INTO "children" VALUES ('c2', 'p3', '; -- /* */', NULL)`),
    s(`INSERT INTO "x_seq" ("v") VALUES ('one'), ('two'), ('three')`),
    s(`DELETE FROM "x_seq" WHERE "id" = 3`),
  ]);
}

async function fingerprint(db: D1Like): Promise<unknown> {
  const all = async (sql: string) => (await db.prepare(sql).all<Record<string, unknown>>()).results;
  const schema = await all(`SELECT "type", "name", "sql" FROM sqlite_master WHERE "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY "type", "name"`);
  const tables: Record<string, unknown> = {};
  for (const t of schema.filter((r) => r["type"] === "table" && r["name"] !== "sqlite_sequence")) {
    const name = String(t["name"]);
    const cols = (await all(`PRAGMA table_info("${name}")`)).map((c) => String(c["name"]));
    const sel = cols.map((c) => `typeof("${c}") AS "t_${c}", CASE typeof("${c}") WHEN 'integer' THEN CAST("${c}" AS TEXT) WHEN 'blob' THEN hex("${c}") ELSE "${c}" END AS "v_${c}"`).join(", ");
    tables[name] = await all(`SELECT ${sel} FROM "${name}" ORDER BY rowid`);
  }
  const sequence = schema.some((r) => r["name"] === "sqlite_sequence") ? await all(`SELECT * FROM sqlite_sequence ORDER BY "name"`) : [];
  return { schema, tables, sequence, fk: await all("PRAGMA foreign_key_check") };
}

describe("D1 copyDatabase: native export/import when the pre-check allows it (DEC-0545)", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  let ops: D1DatabaseOperations;
  let source: StageDatabase;
  beforeEach(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, native: { transfer: fake.transfer, sleep: async () => undefined } });
    source = await ops.createDatabase(stage, "notes-test-abc-db-1");
  }, 60_000);
  afterEach(async () => {
    fake.intercept = undefined;
    await fake?.close();
  });

  const copy = () => ops.copyDatabase(stage, source, "notes-test-abc-db-2");
  const nativeRequests = () => fake.requests.filter((r) => /\/(export|import)$/.test(r.path));

  it("a database with none of A-06's failure shapes is copied by export and import, exactly, and the method is reported", async () => {
    await seedSafe(fake.database(source.id));
    const before = await fingerprint(fake.database(source.id));
    const copied = await copy();
    expect(copied).toMatchObject({ name: "notes-test-abc-db-2", number: 2, method: "D1 native export/import" });
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
    expect(nativeRequests().map((r) => `${r.path.endsWith("export") ? "export" : "import"} ${String((r.body as { action?: string }).action ?? "")}`)).toEqual([
      "export ",
      "export ",
      "import init",
      "import ingest",
      "import poll",
    ]);
    // No row-by-row write page was sent to the new database.
    expect(fake.requests.some((r) => r.path.endsWith(`/${copied.id}/query`) && JSON.stringify(r.body).includes("PRAGMA defer_foreign_keys = on"))).toBe(false);
    expect(await ops.listDatabases()).toHaveLength(2);
  });

  const unsafe: [string, (db: D1Like) => Promise<unknown>, RegExp][] = [
    ["a self-reference", (db) => db.prepare(`CREATE TABLE "tree" ("id" text PRIMARY KEY NOT NULL, "up" text REFERENCES "tree"("id"))`).run(), /table tree references itself/],
    [
      "a reference to a table created later",
      (db) => db.batch([db.prepare(`CREATE TABLE "a_child" ("id" text PRIMARY KEY NOT NULL, "z_id" text REFERENCES "z_parent"("id"))`), db.prepare(`CREATE TABLE "z_parent" ("id" text PRIMARY KEY NOT NULL)`)]),
      /table a_child references table z_parent, which was created after it/,
    ],
    ["a self-reference spelled in another case", (db) => db.prepare(`CREATE TABLE "tree" ("id" text PRIMARY KEY NOT NULL, "up" text REFERENCES "TREE"("id"))`).run(), /table tree references itself/],
    [
      "a reference to a table created later, spelled in another case",
      (db) => db.batch([db.prepare(`CREATE TABLE "a_child" ("id" text PRIMARY KEY NOT NULL, "z_id" text REFERENCES "Z_Parent"("id"))`), db.prepare(`CREATE TABLE "z_parent" ("id" text PRIMARY KEY NOT NULL)`)]),
      /table a_child references table Z_Parent, which was created after it/,
    ],
    ["a row over PAR-312", (db) => db.prepare(`INSERT INTO "parents" VALUES ('big', ?, NULL, NULL)`).bind("x".repeat(40_001)).run(), /a row of \d+ bytes, more than 40000 \(PAR-312\)/],
    ["a NUL in text", (db) => db.prepare(`INSERT INTO "parents" VALUES ('nul', ?, NULL, NULL)`).bind("a\u0000b").run(), /NUL character or an integer beyond/],
    ["an integer beyond 2^53", (db) => db.prepare(`INSERT INTO "parents" VALUES ('i64', 'i', CAST('9223372036854775807' AS INTEGER), NULL)`).run(), /NUL character or an integer beyond/],
  ];
  for (const [what, add, why] of unsafe) {
    it(`${what} makes the copy take the row-by-row path, named with the reason, and it is still exact`, async () => {
      await seedSafe(fake.database(source.id));
      await add(fake.database(source.id));
      const before = await fingerprint(fake.database(source.id));
      const copied = await copy();
      expect(copied.method).toMatch(/^row-by-row copy \(/);
      expect(copied.method).toMatch(why);
      expect(nativeRequests()).toEqual([]);
      expect(await fingerprint(fake.database(copied.id))).toEqual(before);
    });
  }

  it("a pre-check that fails (D1 refuses its scan, e.g. a big database) falls back to the row-by-row path, naming why", async () => {
    await seedSafe(fake.database(source.id));
    const before = await fingerprint(fake.database(source.id));
    fake.intercept = async (req, run) =>
      req.path.endsWith(`/${source.id}/query`) && JSON.stringify(req.body).includes('AS \\"bad\\"')
        ? { status: 400, body: { success: false, errors: [{ code: 7500, message: "D1_ERROR: query exceeded the CPU limit" }], messages: [], result: [] } }
        : run();
    const copied = await copy();
    expect(copied.method).toMatch(/^row-by-row copy \(the native copy's pre-check failed \(.*CPU limit/);
    expect(nativeRequests()).toEqual([]);
    fake.intercept = undefined;
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
  });

  it("a database over PAR-313 in all takes the row-by-row path", async () => {
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, native: { transfer: fake.transfer, limits: { maxTotalBytes: 50 } } });
    await seedSafe(fake.database(source.id));
    expect((await copy()).method).toMatch(/more than 50 \(PAR-313\)/);
    expect(nativeRequests()).toEqual([]);
  });

  it("a failed import is not trusted: the new database is recreated and copied row by row, exactly", async () => {
    await seedSafe(fake.database(source.id));
    const before = await fingerprint(fake.database(source.id));
    fake.intercept = async (req, run) =>
      (req.body as { action?: string } | undefined)?.action === "ingest" ? { status: 200, body: { success: true, result: { status: "error", error: "statement too long: SQLITE_TOOBIG" } } } : run();
    const copied = await copy();
    expect(copied.method).toMatch(/^row-by-row copy \(the native export\/import failed \(.*SQLITE_TOOBIG/);
    expect(await fingerprint(fake.database(copied.id))).toEqual(before);
    expect((await ops.listDatabases()).map((d) => d.name).sort()).toEqual(["notes-test-abc-db-1", "notes-test-abc-db-2"]);
  });

  it("an export that never completes is bounded by PAR-314", async () => {
    let clock = 0;
    const client = d1Client(fake.api, ACCOUNT);
    fake.intercept = async (req, run) => (req.path.endsWith("/export") ? { status: 200, body: { success: true, result: { status: "active", at_bookmark: "b" } } } : run());
    await expect(
      exportDump(client, source.id, { transfer: fake.transfer, limits: { timeoutMs: 5_000, pollMs: 1_000 }, now: () => clock, sleep: async (ms) => void (clock += ms) }),
    ).rejects.toThrow(/did not complete within 5000 ms \(PAR-314\)/);
  });

  it("without the native option the copy is row by row, as before", async () => {
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    await seedSafe(fake.database(source.id));
    expect((await copy()).method).toBe("row-by-row copy (the native copy is not configured)");
    expect(nativeRequests()).toEqual([]);
  });
});
