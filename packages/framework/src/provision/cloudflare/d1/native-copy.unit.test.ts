/**
 * Cloudflare `copyDatabase` with D1's native export/import (DEC-0545): the pre-check decides,
 * the native path copies exactly, and every shape spike A-06 found to break it falls back to the
 * row-by-row copy, which the deploy output names. Against the fake D1 HTTP API (no Cloudflare call).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { D1Like } from "../../../mig/apply.js";
import type { StageDatabase } from "../../core/operations.js";
import { openFakeD1Api, prepareAll, type FakeD1Api } from "./fake-d1-api.js";
import { exportDump, importDump } from "./native-copy.js";
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

// Seeds prepare through prepareAll, which lets the event loop turn between Miniflare's synchronous
// proxy calls (root cause 2026-10-31-native-copy-fetch-failed.md).
async function seedSafe(db: D1Like): Promise<void> {
  const s = (sql: string, ...params: unknown[]) => ({ sql, params });
  await db.batch(await prepareAll(db, [
    ...SAFE_SCHEMA.map((sql) => s(sql)),
    s(`INSERT INTO "parents" VALUES ('p2', 'two', -2147483648, ?)`, 1 / 3),
    s(`INSERT INTO "parents" VALUES ('p1', '👩‍👩‍👧 ‮rtl é ''q''', 9007199254740991, 1e308)`),
    s(`INSERT INTO "parents" VALUES ('p3', '', NULL, NULL)`),
    s(`INSERT INTO "children" VALUES ('c1', 'p1', 'tab\tnew\nline\r', X'00ff')`),
    s(`INSERT INTO "children" VALUES ('c2', 'p3', '; -- /* */', NULL)`),
    s(`INSERT INTO "x_seq" ("v") VALUES ('one'), ('two'), ('three')`),
    s(`DELETE FROM "x_seq" WHERE "id" = 3`),
  ]));
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

  it("the backup's export scans for NULs and integers beyond ±2^53 and writes those tables losslessly as JSON and SQL (DEC-0096, DEC-0543)", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    await db.batch([
      db.prepare(`INSERT INTO "parents" VALUES ('nul', ?, CAST('9223372036854775807' AS INTEGER), 2.0)`).bind("a\u0000b\nc"),
      db.prepare(`INSERT INTO "parents" VALUES ('neg', 'n', CAST('-9223372036854775808' AS INTEGER), NULL)`),
    ]);
    const before = await fingerprint(db);
    const exported = await ops.exportDatabase(source);
    expect(exported.dump.length).toBeGreaterThan(0);
    expect(exported.lossless?.tables).toEqual(["parents"]);
    const json = JSON.parse(new TextDecoder().decode(exported.lossless!.json)) as { database: string; tables: { table: string; columns: string[]; rows: unknown[][] }[] };
    expect(json.database).toBe("notes-test-abc-db-1");
    const parents = json.tables.find((t) => t.table === "parents")!;
    expect(parents.columns).toEqual(["id", "name", "n", "r"]);
    expect(parents.rows).toContainEqual(["nul", "a\u0000b\nc", { integer: "9223372036854775807" }, { real: 2 }]);
    expect(parents.rows).toContainEqual(["neg", "n", { integer: "-9223372036854775808" }, null]);
    expect(parents.rows).toContainEqual(["p2", "two", { integer: "-2147483648" }, { real: 1 / 3 }]);

    // The documented restore: the one restore file, D1's dump with the listed tables' rows in their place.
    const restored = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await importDump(d1Client(fake.api, ACCOUNT), restored.id, exported.lossless!.restore, { transfer: fake.transfer, sleep: async () => undefined });
    expect(await fingerprint(fake.database(restored.id))).toEqual(before);

    const safe = await ops.createDatabase(stage, "notes-test-abc-db-3");
    await seedSafe(fake.database(safe.id));
    expect((await ops.exportDatabase(safe)).lossless).toBeUndefined();
  });

  it("the restore file keeps the dump's order, so rows referencing a lossy table stay within the import's ~4 KB foreign-key deferral (A-06)", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    await db.batch(
      await prepareAll(db, [
        { sql: `INSERT INTO "parents" VALUES ('nul', ?, NULL, NULL)`, params: ["a\u0000b"] },
        ...Array.from({ length: 60 }, (_, i) => ({ sql: `INSERT INTO "children" VALUES (?, 'nul', ?, NULL)`, params: [`k${i}`, "y".repeat(100)] })),
      ]),
    );
    const before = await fingerprint(db);
    const exported = await ops.exportDatabase(source);
    expect(exported.lossless?.tables).toEqual(["parents"]);
    const client = d1Client(fake.api, ACCOUNT);
    const options = { transfer: fake.transfer, sleep: async () => undefined };

    // Appending the lossy table's rows after the dump puts every child more than 4 KB before its parent.
    const json = JSON.parse(new TextDecoder().decode(exported.lossless!.json)) as { tables: { rows: unknown[][] }[] };
    expect(json.tables[0]!.rows.length).toBe(4);
    const restoreText = new TextDecoder().decode(exported.lossless!.restore);
    const parentRows = restoreText.split("\n").filter((l) => l.startsWith(`INSERT INTO "parents"`));
    const appended = [...restoreText.split("\n").filter((l) => !l.startsWith(`INSERT INTO "parents"`)), ...parentRows].join("\n");
    const wrong = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await expect(importDump(client, wrong.id, new TextEncoder().encode(appended), options)).rejects.toThrow(/failed/);

    const restored = await ops.createDatabase(stage, "notes-test-abc-db-3");
    await importDump(client, restored.id, exported.lossless!.restore, options);
    expect(await fingerprint(fake.database(restored.id))).toEqual(before);
  });

  it("text values are restored byte for byte: a leading U+FEFF and invalid UTF-8 included", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    await db.batch([
      db.prepare(`INSERT INTO "parents" VALUES ('bom', ?, CAST('9223372036854775807' AS INTEGER), NULL)`).bind("﻿hello"),
      db.prepare(`INSERT INTO "parents" VALUES ('bad', CAST(X'C328FF41' AS TEXT), NULL, NULL)`),
    ]);
    const hexes = async (d: D1Like) => (await d.prepare(`SELECT "id", hex("name") AS "h", typeof("name") AS "t" FROM "parents" ORDER BY "id"`).all()).results;
    const before = await hexes(db);
    const exported = await ops.exportDatabase(source);
    const rows = (JSON.parse(new TextDecoder().decode(exported.lossless!.json)) as { tables: { rows: unknown[][] }[] }).tables[0]!.rows;
    expect(rows).toContainEqual(["bom", "﻿hello", { integer: "9223372036854775807" }, null]);
    expect(rows).toContainEqual(["bad", { textHex: "C328FF41" }, null, null]);
    const restored = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await importDump(d1Client(fake.api, ACCOUNT), restored.id, exported.lossless!.restore, { transfer: fake.transfer, sleep: async () => undefined });
    expect(await hexes(fake.database(restored.id))).toEqual(before);
  });

  it("the lossy scan reads each table in pages, so a database too large for one scan is still backed up", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    await db.prepare(`INSERT INTO "parents" VALUES ('i64', 'i', CAST('9223372036854775807' AS INTEGER), NULL)`).run();
    // D1 refuses any read of a whole table at once (as on a large database).
    fake.intercept = async (req, run) =>
      req.path.endsWith(`/${source.id}/query`) && /FROM \\"(parents|children|x_seq)\\"/.test(JSON.stringify(req.body)) && !/LIMIT/.test(JSON.stringify(req.body))
        ? { status: 400, body: { success: false, errors: [{ code: 7500, message: "D1_ERROR: query exceeded the CPU limit" }], messages: [], result: [] } }
        : run();
    const exported = await ops.exportDatabase(source);
    expect(exported.lossless?.tables).toEqual(["parents"]);
  });

  it("a WITHOUT ROWID table is scanned and read in pages by its primary key (keyset), never by OFFSET", async () => {
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, limits: { pageRows: 2 }, native: { transfer: fake.transfer, sleep: async () => undefined } });
    const db = fake.database(source.id);
    await db.batch([
      db.prepare(`CREATE TABLE "kv" ("ns" text NOT NULL, "k" integer NOT NULL, "v" text, PRIMARY KEY ("ns", "k")) WITHOUT ROWID`),
      ...Array.from({ length: 7 }, (_, i) => db.prepare(`INSERT INTO "kv" VALUES (?, ?, ?)`).bind(i % 2 === 0 ? "a" : "b", i, i === 5 ? "x\u0000y" : `v${i}`)),
    ]);
    const contents = async (d: D1Like) => (await d.prepare(`SELECT "ns", "k", hex("v") AS "v" FROM "kv" ORDER BY "ns", "k"`).all()).results;
    const before = await contents(db);
    const exported = await ops.exportDatabase(source);
    expect(exported.lossless?.tables).toEqual(["kv"]);
    const kvReads = fake.requests.filter((r) => r.path.endsWith(`/${source.id}/query`) && JSON.stringify(r.body).includes(`FROM \\"kv\\"`)).map((r) => JSON.stringify(r.body));
    expect(kvReads.length).toBeGreaterThan(3);
    for (const sql of kvReads) {
      expect(sql).not.toMatch(/OFFSET/);
      expect(sql).toMatch(/ORDER BY \\"ns\\", \\"k\\" LIMIT 2/);
    }
    expect(kvReads.some((sql) => /WHERE \(\\"ns\\", \\"k\\"\) > \(/.test(sql))).toBe(true);
    const rows = (JSON.parse(new TextDecoder().decode(exported.lossless!.json)) as { tables: { rows: unknown[][] }[] }).tables[0]!.rows;
    expect(rows).toHaveLength(7);
    const restored = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await importDump(d1Client(fake.api, ACCOUNT), restored.id, exported.lossless!.restore, { transfer: fake.transfer, sleep: async () => undefined });
    expect(await contents(fake.database(restored.id))).toEqual(before);
  });

  it("a WITHOUT ROWID table whose text keys hold NULs is read to its end in pages of 2 and restored exactly", async () => {
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, limits: { pageRows: 2 }, native: { transfer: fake.transfer, sleep: async () => undefined } });
    const db = fake.database(source.id);
    await db.batch([
      db.prepare(`CREATE TABLE "nk" ("k" text PRIMARY KEY NOT NULL, "v" integer) WITHOUT ROWID`),
      ...["a", "a\u0000x", "a\u0000y", "b\u0000", "c"].map((k, i) => db.prepare(`INSERT INTO "nk" VALUES (CAST(? AS TEXT), ?)`).bind(k, i)),
    ]);
    const contents = async (d: D1Like) => (await d.prepare(`SELECT hex("k") AS "k", "v" FROM "nk" ORDER BY "k"`).all()).results;
    const before = await contents(db);
    expect(before).toHaveLength(5);
    const exported = await ops.exportDatabase(source);
    expect(exported.lossless?.tables).toEqual(["nk"]);
    const restored = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await importDump(d1Client(fake.api, ACCOUNT), restored.id, exported.lossless!.restore, { transfer: fake.transfer, sleep: async () => undefined });
    expect(await contents(fake.database(restored.id))).toEqual(before);
  });

  it("a trigger body's inner semicolons do not split it: a trigger inserting into a lossy table keeps the restore file's count right", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    await db.batch([
      db.prepare(`CREATE TABLE "audit" ("id" integer PRIMARY KEY, "what" text)`),
      db.prepare(`INSERT INTO "audit" ("what") VALUES (?)`).bind("a\u0000b"),
      db.prepare(
        `CREATE TRIGGER "parents_audit" AFTER INSERT ON "parents" BEGIN INSERT INTO "audit" ("what") VALUES (CASE WHEN NEW."n" IS NULL THEN 'none' ELSE 'some' END); INSERT INTO "audit" ("what") VALUES ('x'); END`,
      ),
    ]);
    const exported = await ops.exportDatabase(source);
    expect(exported.lossless?.tables).toEqual(["audit"]);
    expect(new TextDecoder().decode(exported.lossless!.restore)).toContain(`CREATE TRIGGER "parents_audit" AFTER INSERT ON "parents" BEGIN INSERT INTO "audit"`);
  });

  it("a table whose scan D1 still refuses is backed up losslessly instead of failing the backup", async () => {
    const db = fake.database(source.id);
    await seedSafe(db);
    const before = await fingerprint(db);
    fake.intercept = async (req, run) =>
      req.path.endsWith(`/${source.id}/query`) && /FROM \\"children\\"/.test(JSON.stringify(req.body)) && /instr\(/.test(JSON.stringify(req.body))
        ? { status: 400, body: { success: false, errors: [{ code: 7500, message: "D1_ERROR: query exceeded the CPU limit" }], messages: [], result: [] } }
        : run();
    const exported = await ops.exportDatabase(source);
    fake.intercept = undefined;
    expect(exported.lossless?.tables).toEqual(["children"]);
    expect(exported.lossless?.scanFailures).toEqual([expect.stringMatching(/children.*CPU limit/)]);
    const restored = await ops.createDatabase(stage, "notes-test-abc-db-2");
    await importDump(d1Client(fake.api, ACCOUNT), restored.id, exported.lossless!.restore, { transfer: fake.transfer, sleep: async () => undefined });
    expect(await fingerprint(fake.database(restored.id))).toEqual(before);
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
