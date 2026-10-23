/**
 * Cloudflare `checkMigratedDatabase`: MIG's step-4 check (mig/cloud/check.ts) read from D1
 * through the HTTP API, after a real copy and real drizzle-kit migrations, on the fake D1 API.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../../tests/support/tags.js";
import { applyMigrations, type Histories } from "../../../mig/apply.js";
import { appSchema, generateMigrations } from "../../../mig/generate.js";
import { readHistory } from "../../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../../mig/migrations-dir.js";
import { id, integer, ref, text } from "../../../sql/columns.js";
import { defineTable } from "../../../sql/table.js";
import type { StageDatabase } from "../../core/operations.js";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";
import { d1DatabaseOperations, type D1DatabaseOperations } from "./operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

const parents = defineTable("parents", { id: id(), name: text() });
const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text() });
const old = defineTable("old", { id: id() });
// Version 2: a defaulted NOT NULL column and a nullable column added, a table dropped.
const children2 = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text(), rank: integer().default(0), note: text().nullable() });

const dirs: string[] = [];
let histories: { v1: Histories; v2: Histories } | undefined;
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function load(): Promise<{ v1: Histories; v2: Histories }> {
  if (histories) return histories;
  const root = mkdtempSync(join(tmpdir(), "d1-check-"));
  dirs.push(root);
  await generateMigrations({ root, schema: appSchema({ parents, children, old }) });
  await generateMigrations({ root, schema: appSchema({ parents, children: children2 }) });
  const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework");
  const app = readHistory(root, "sqlite", "app");
  histories = { v1: { framework, app: app.slice(0, 1) }, v2: { framework, app } };
  return histories;
}

describe("D1 checkMigratedDatabase", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  let ops: D1DatabaseOperations;
  let h: { v1: Histories; v2: Histories };
  let previous: StageDatabase;
  let next: StageDatabase;
  let applied: readonly string[];
  beforeEach(async () => {
    h = await load();
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    previous = await ops.createDatabase(stage, "notes-test-abc-db-1");
    await applyMigrations(ops.migrationDatabase(previous), h.v1);
    const db = fake.database(previous.id);
    await db.batch([
      db.prepare(`INSERT INTO "parents" VALUES ('p1', 'one'), ('p2', 'two')`),
      db.prepare(`INSERT INTO "children" ("id", "parent_id", "label") VALUES ('c1', 'p1', 'a'), ('c2', 'p1', 'b'), ('c3', 'p2', 'c')`),
      db.prepare(`INSERT INTO "old" VALUES ('o1')`),
    ]);
    next = await ops.copyDatabase(stage, previous, "notes-test-abc-db-2");
    applied = (await applyMigrations(ops.migrationDatabase(next), h.v2)).applied;
  }, 60_000);
  afterEach(async () => {
    await fake?.close();
  });

  const check = () => ops.checkMigratedDatabase({ stage, previous, next, applied, migrations: h.v2 });

  it(tag("MIG-AC-003", "a copied and migrated database passes: rows kept, dropped table allowed, added columns valid, record complete"), async () => {
    expect(applied).toEqual([h.v2.app[1]?.id]);
    const start = fake.requests.length;
    await check();
    expect(fake.requests.length - start).toBeLessThanOrEqual(8);
  });

  it(tag("MIG-AC-003", "a lost row fails the check, naming the table and both counts"), async () => {
    await fake.database(next.id).prepare(`DELETE FROM "children" WHERE "id" = 'c3'`).run();
    await expect(check()).rejects.toThrow(/table children has 2 rows in the new database, 3 expected/);
  });

  it("values breaking an added column's rule fail the check (wrong type; NUL in text)", async () => {
    const db = fake.database(next.id);
    await db.prepare(`UPDATE "children" SET "rank" = 'x' WHERE "id" = 'c1'`).run();
    await db.prepare(`UPDATE "children" SET "note" = ? WHERE "id" = 'c2'`).bind("a\u0000b").run();
    await expect(check()).rejects.toThrow(/added column children.rank: 1 rows break its rule \(integer, not null\).*added column children.note: 1 rows break its rule \(text, nullable\)/);
  });

  it("an incomplete record fails the check", async () => {
    await fake.database(next.id).prepare(`DELETE FROM "__framework_migrations" WHERE "id" = ?`).bind(h.v2.app[1]?.id).run();
    await expect(check()).rejects.toThrow(/the migration record lacks app\//);
  });
});
