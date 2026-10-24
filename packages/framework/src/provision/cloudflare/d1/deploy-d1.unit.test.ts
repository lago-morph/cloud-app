/**
 * PROV's target-neutral deploy sequence (C-03) with the Cloudflare database operations on the
 * fake D1 HTTP API: MIG-REQ-006 copy-migrate-check-replace and the MIG-REQ-003 failure path,
 * locally. Everything but the databases comes from C-03's FakeTarget. No Cloudflare call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../../tests/support/tags.js";
import { captureIo } from "../../../cli/io.test-support.js";
import type { Histories } from "../../../mig/apply.js";
import { appSchema, generateMigrations } from "../../../mig/generate.js";
import { readHistory } from "../../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../../mig/migrations-dir.js";
import { id, integer, ref, text } from "../../../sql/columns.js";
import { defineTable } from "../../../sql/table.js";
import { runDeploy } from "../../core/deploy.js";
import { FakeTarget } from "../../core/fake-target.js";
import type { TargetOperations } from "../../core/operations.js";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";
import { d1DatabaseOperations, type D1DatabaseOperations } from "./operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

const parents = defineTable("parents", { id: id(), name: text() });
const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text() });
const old = defineTable("old", { id: id(), parentId: ref(() => parents.id) });
// v2: unique names (fails over duplicates), a defaulted column, the child table `old` dropped.
const parents2 = defineTable("parents", { id: id(), name: text().unique() });
const children2 = defineTable("children", { id: id(), parentId: ref(() => parents2.id), label: text(), rank: integer().default(0) });

const dirs: string[] = [];
let h: { v1: Histories; v2: Histories } | undefined;
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function load(): Promise<{ v1: Histories; v2: Histories }> {
  if (h) return h;
  const root = mkdtempSync(join(tmpdir(), "d1-deploy-"));
  dirs.push(root);
  await generateMigrations({ root, schema: appSchema({ parents, children, old }) });
  await generateMigrations({ root, schema: appSchema({ parents: parents2, children: children2 }) });
  const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework");
  const app = readHistory(root, "sqlite", "app");
  h = { v1: { framework, app: app.slice(0, 1) }, v2: { framework, app } };
  return h;
}

/** C-03's FakeTarget with its database operations replaced by D-04's. */
function withD1(t: FakeTarget, d1: D1DatabaseOperations): TargetOperations {
  return new Proxy(t, {
    get(target, prop, receiver) {
      // FakeTarget's code step needs to know the database the code is bound to
      if (prop === "deployCode")
        return (input: Parameters<TargetOperations["deployCode"]>[0]) => {
          target.databases.set(input.database.name, { id: input.database.id, records: new Set(), rows: 0 });
          return target.deployCode(input);
        };
      if (prop === "listStageResources") return async (s: typeof stage) => ({ ...(await target.listStageResources(s)), databases: await d1.listDatabases() });
      if (typeof prop === "string" && prop in d1 && prop !== "listDatabases") return (d1 as unknown as Record<string, unknown>)[prop];
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as TargetOperations;
}

describe("deploy with D1 databases (fake D1 API)", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  let d1: D1DatabaseOperations;
  let t: FakeTarget;
  let ops: TargetOperations;
  beforeEach(async () => {
    await load();
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    d1 = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    t = new FakeTarget();
    ops = withD1(t, d1);
  }, 60_000);
  afterEach(async () => {
    await fake?.close();
  });

  const deploy = async (migrations: Histories) => {
    const io = captureIo();
    const result = await runDeploy(ops, { stage, migrations, requiredSecrets: [] }, io);
    return result;
  };
  const only = async () => {
    const dbs = await d1.listDatabases();
    expect(dbs).toHaveLength(1);
    return { name: dbs[0]?.name, db: fake.database(dbs[0]?.id as string) };
  };
  const rows = async (db: ReturnType<FakeD1Api["database"]>, sql: string) => (await db.prepare(sql).all<Record<string, unknown>>()).results;

  it(tag(["MIG-AC-003", "MIG-AC-006"], "a failing migration keeps the old database unchanged with no new one behind; after fixing the data the schema change copies, migrates and leaves exactly one database"), async () => {
    const { v1, v2 } = await load();
    expect((await deploy(v1)).status).toBe(0);
    const first = await only();
    expect(first.name).toBe("notes-test-abc-db-1");
    await first.db.batch([
      first.db.prepare(`INSERT INTO "parents" VALUES ('p1', 'same'), ('p2', 'same')`),
      first.db.prepare(`INSERT INTO "children" ("id", "parent_id", "label") VALUES ('c1', 'p1', 'a'), ('c2', 'p2', 'b')`),
      first.db.prepare(`INSERT INTO "old" VALUES ('o1', 'p1')`),
    ]);
    const snapshot = async () => ({
      parents: await rows(first.db, `SELECT * FROM "parents" ORDER BY "id"`),
      children: await rows(first.db, `SELECT * FROM "children" ORDER BY "id"`),
      old: await rows(first.db, `SELECT * FROM "old"`),
      record: await rows(first.db, `SELECT * FROM "__framework_migrations" ORDER BY "id"`),
      schema: await rows(first.db, `SELECT "sql" FROM sqlite_master WHERE "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY "name"`),
    });
    const before = await snapshot();

    const failed = await deploy(v2);
    expect(failed.status).toBe(1);
    expect(failed.failure).toMatchObject({ step: "migrate", migrationFile: v2.app[1]?.file });
    expect(failed.failure?.databaseError).toMatch(/UNIQUE/);
    expect((await only()).name).toBe("notes-test-abc-db-1");
    expect(await snapshot()).toEqual(before);
    expect(t.calls.filter((c) => /^(stopApp|startApp)/.test(c))).toEqual(["startApp notes/test-abc", "stopApp notes/test-abc", "startApp notes/test-abc"]);

    await first.db.prepare(`UPDATE "parents" SET "name" = 'other' WHERE "id" = 'p2'`).run();
    const ok = await deploy(v2);
    expect(ok.status).toBe(0);
    const second = await only();
    expect(second.name).toBe("notes-test-abc-db-2");
    expect(await rows(second.db, `SELECT "id", "parent_id", "label", "rank" FROM "children" ORDER BY "id"`)).toEqual([
      { id: "c1", parent_id: "p1", label: "a", rank: 0 },
      { id: "c2", parent_id: "p2", label: "b", rank: 0 },
    ]);
    expect(await rows(second.db, `SELECT "name" FROM sqlite_master WHERE "name" = 'old'`)).toEqual([]);
    expect(t.calls).toContain("deployCode notes/test-abc notes-test-abc-db-2");
  });

  it(tag("MIG-AC-002", "a redeploy with nothing pending creates, copies and writes nothing on D1"), async () => {
    const { v1 } = await load();
    expect((await deploy(v1)).status).toBe(0);
    const start = fake.requests.length;
    expect((await deploy(v1)).status).toBe(0);
    const later = fake.requests.slice(start);
    expect(later.filter((r) => r.method !== "GET" && !JSON.stringify(r.body).includes("SELECT"))).toEqual([]);
    expect(later.length).toBeLessThanOrEqual(4);
    expect((await only()).name).toBe("notes-test-abc-db-1");
  });
});
