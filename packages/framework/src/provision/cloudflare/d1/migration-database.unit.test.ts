/**
 * Applying migration files to a D1 database through the HTTP API (DEC-0093, DEC-0094) against the
 * fake D1 HTTP API. Uses real drizzle-kit files from the MIG generator, including a table-level
 * `unique()` and a foreign key added to an existing column (DEC-0095).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../../tests/support/tags.js";
import { applyMigrations, MigrationFailedError, type Histories } from "../../../mig/apply.js";
import { appSchema, generateMigrations } from "../../../mig/generate.js";
import { readHistory } from "../../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../../mig/migrations-dir.js";
import { id, ref, text } from "../../../sql/columns.js";
import { defineTable } from "../../../sql/table.js";
import type { AnyTable } from "../../../sql/types.js";
import { openFakeD1Api, type FakeD1Api, type FakeRequest } from "./fake-d1-api.js";
import { d1DatabaseOperations } from "./operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

const parents = defineTable("parents", { id: id(), name: text(), code: text().nullable() });
const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text(), ownerId: text().nullable() });
// Version 2: a table-level unique() over two columns, and a foreign key added to an existing column.
const parents2 = defineTable("parents", { id: id(), name: text(), code: text().nullable() }, { uniques: [["name", "code"]] });
const children2 = defineTable("children", { id: id(), parentId: ref(() => parents2.id), label: text(), ownerId: ref(() => parents2.id).nullable() });

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const C1 = "00000000-0000-4000-8000-00000000000a";

const dirs: string[] = [];
let root = "";
let histories: { v1: Histories; v2: Histories };
async function appHistory(...versions: Record<string, AnyTable>[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "d1-mig-"));
  dirs.push(dir);
  for (const tables of versions) await generateMigrations({ root: dir, schema: appSchema(tables) });
  return dir;
}
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const isRecordInsert = (req: FakeRequest) => JSON.stringify(req.body ?? null).includes("INSERT INTO \\\"__framework_migrations\\\"");

describe("D1 migration database over the HTTP API", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  beforeEach(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    if (root === "") {
      root = await appHistory({ parents, children }, { parents: parents2, children: children2 });
      const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework");
      const app = readHistory(root, "sqlite", "app");
      histories = { v1: { framework, app: app.slice(0, 1) }, v2: { framework, app } };
    }
  }, 60_000);
  afterEach(async () => {
    fake.intercept = undefined;
    await fake?.close();
  });

  const open = async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const db = await ops.createDatabase(stage, "notes-test-abc-db-1");
    return { ops, db, mdb: ops.migrationDatabase(db), local: fake.database(db.id) };
  };
  const rows = async (local: ReturnType<FakeD1Api["database"]>, sql: string) => (await local.prepare(sql).all<Record<string, unknown>>()).results;
  const seed = async (local: ReturnType<FakeD1Api["database"]>, code2: string | null) => {
    await local.prepare(`INSERT INTO "parents" ("id", "name", "code") VALUES ('${P1}', 'same', 'x')`).run();
    await local.prepare(`INSERT INTO "parents" ("id", "name", "code") VALUES (?, 'same', ?)`).bind(P2, code2).run();
    await local.prepare(`INSERT INTO "children" ("id", "parent_id", "label", "owner_id") VALUES ('${C1}', '${P1}', 'c', '${P2}')`).run();
  };

  it(tag("MIG-AC-002", "each migration file is one /query request: deferred-FK prefix, the file's statements, then its record row with an INTEGER applied_at"), async () => {
    const { mdb, local } = await open();
    expect(mdb.dialect).toBe("sqlite");
    expect(await mdb.recordedIds()).toEqual(new Set());
    const before = fake.requests.length;
    const result = await applyMigrations(mdb, histories.v1, () => 1_760_000_000_123);
    const ids = [...histories.v1.framework, ...histories.v1.app].map((m) => m.id);
    expect(result.applied).toEqual(ids);
    const applies = fake.requests.slice(before).filter(isRecordInsert);
    expect(applies).toHaveLength(ids.length);
    for (const [i, req] of applies.entries()) {
      const batch = (req.body as { batch: { sql: string; params?: unknown[] }[] }).batch;
      const migration = [...histories.v1.framework, ...histories.v1.app][i];
      expect(batch[0]).toEqual({ sql: "PRAGMA defer_foreign_keys = on" });
      expect(batch.slice(1, -1).map((s) => s.sql)).toEqual(migration?.statements);
      expect(batch.at(-1)?.params).toEqual([migration?.id, "sqlite", migration?.checksum, "1760000000123"]);
    }
    expect(await rows(local, `SELECT "id", typeof("applied_at") AS t, "applied_at" FROM "__framework_migrations" ORDER BY "id"`)).toEqual(
      [...ids].sort().map((i) => ({ id: i, t: "integer", applied_at: 1_760_000_000_123 })),
    );
    expect(await mdb.recordedIds()).toEqual(new Set(ids));
  });

  it(tag("MIG-AC-003", "supported changes incl. a table-level unique() and an added foreign key apply on D1 and keep every row and reference"), async () => {
    const { mdb, local } = await open();
    await applyMigrations(mdb, histories.v1);
    await seed(local, "y");
    const result = await applyMigrations(mdb, histories.v2);
    expect(result.applied).toEqual([histories.v2.app[1]?.id]);
    expect(await rows(local, `SELECT "id", "name", "code" FROM "parents" ORDER BY "id"`)).toEqual([
      { id: P1, name: "same", code: "x" },
      { id: P2, name: "same", code: "y" },
    ]);
    expect(await rows(local, `SELECT "id", "parent_id", "owner_id" FROM "children"`)).toEqual([{ id: C1, parent_id: P1, owner_id: P2 }]);
    expect((await rows(local, `PRAGMA foreign_key_list("children")`)).map((r) => r["from"]).sort()).toEqual(["owner_id", "parent_id"]);
    expect(await rows(local, "PRAGMA foreign_key_check")).toEqual([]);
    await expect(local.prepare(`INSERT INTO "parents" ("id", "name", "code") VALUES ('00000000-0000-4000-8000-000000000003', 'same', 'x')`).run()).rejects.toThrow(/UNIQUE/);
  });

  it(tag("MIG-AC-003", "a data-dependent failing migration (unique over duplicates) is refused as one unit: schema, rows and record unchanged"), async () => {
    const { mdb, local } = await open();
    await applyMigrations(mdb, histories.v1);
    await seed(local, "x");
    const snapshot = async () => ({
      schema: await rows(local, `SELECT "type", "name", "sql" FROM sqlite_master WHERE "name" NOT LIKE '_cf_%' ORDER BY "name"`),
      parents: await rows(local, `SELECT * FROM "parents" ORDER BY "id"`),
      children: await rows(local, `SELECT * FROM "children"`),
      record: await rows(local, `SELECT * FROM "__framework_migrations" ORDER BY "id"`),
    });
    const before = await snapshot();
    const err = await applyMigrations(mdb, histories.v2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(err).toMatchObject({ migration: histories.v2.app[1]?.id, applied: [] });
    expect(String((err as Error).message)).toMatch(/UNIQUE/);
    expect(await snapshot()).toEqual(before);
  });

  it("an unclear answer after D1 committed the file counts as applied, because the record lists it (DEC-0094)", async () => {
    const { mdb } = await open();
    fake.intercept = async (req, run) => {
      if (!isRecordInsert(req)) return run();
      await run();
      return { status: 502, body: "upstream request failed" };
    };
    const result = await applyMigrations(mdb, histories.v1);
    expect(result.applied).toEqual([...histories.v1.framework, ...histories.v1.app].map((m) => m.id));
  });

  it("an unclear answer when nothing was committed is a failed migration", async () => {
    const { mdb } = await open();
    fake.intercept = async (req, run) => (isRecordInsert(req) ? Promise.reject(new Error("socket hang up")) : run());
    const err = await applyMigrations(mdb, histories.v1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(String((err as Error).message)).toMatch(/no answer from the D1 API \(socket hang up\)/);
  });
});
