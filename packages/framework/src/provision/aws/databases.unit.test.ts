/**
 * AWS database operations (G-09) against the G-F1 Data API fake, and PROV's target-neutral
 * deploy sequence with them (MIG-REQ-003 failure path, MIG-REQ-006 copy-migrate-check-replace).
 * A PRE-CHECK, never AWS evidence (DEC-0445). No AWS call: the network guard records
 * any attempt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeginTransactionCommand, RollbackTransactionCommand, type RDSDataClient } from "@aws-sdk/client-rds-data";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { captureIo } from "../../cli/io.test-support.js";
import type { Histories } from "../../mig/apply.js";
import { appSchema, generateMigrations } from "../../mig/generate.js";
import { checksumOf, readHistory, splitStatements, type Migration } from "../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { DataApiFake, FAKE_RESOURCE_ARN, FAKE_SECRET_ARN } from "../../sql/data-api-fake.test-support.js";
import type { DataApiClock } from "../../sql/data-api.js";
import { id, integer, ref, text } from "../../sql/columns.js";
import { defineTable } from "../../sql/table.js";
import { runDeploy } from "../core/deploy.js";
import { FakeTarget } from "../core/fake-target.js";
import type { StageDatabase, TargetOperations } from "../core/operations.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "./aws-network-guard.test-support.js";
import { awsDatabaseOperations, ruleHolds, type AwsDatabaseOperations } from "./databases.js";

const stage = { app: "notes", stage: "test-abc" };

/**
 * The fake's client as the SDK would behave. The G-F1 fake attaches the PGlite error (with its
 * pg `code`) as `cause` of the SQL exception, which no SDK exception has; these tests strip it,
 * so the operations must read the SQLSTATE from the message, as on AWS. They do not depend on
 * the `cause` (the G-F1 follow-up that removes it changes nothing here).
 */
function sdkLike(client: RDSDataClient, after?: (command: unknown) => Error | undefined): RDSDataClient {
  const send = async (command: unknown): Promise<unknown> => {
    let out: unknown;
    try {
      out = await (client.send as (c: unknown) => Promise<unknown>)(command);
    } catch (e) {
      if (typeof e === "object" && e !== null && "cause" in e) delete (e as { cause?: unknown }).cause;
      throw e;
    }
    const lost = after?.(command);
    if (lost) throw lost;
    return out;
  };
  return new Proxy(client, { get: (t, p) => (p === "send" ? send : Reflect.get(t, p, t)) });
}

/** A clock whose sleep advances time at once. */
function instantClock(): DataApiClock & { slept: number[] } {
  let t = 0;
  const slept: number[] = [];
  return { slept, now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)), random: () => 0.5 };
}

const migration = (name: string, sql: string): Migration => ({
  id: `app/${name}`,
  name,
  file: `/app/migrations/postgres/${name}.sql`,
  text: sql,
  checksum: checksumOf(sql),
  statements: splitStatements(sql),
});

const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "postgres", "framework");
const sdb = (name: string): StageDatabase => ({ name, number: Number(/(\d+)$/.exec(name)?.[1]), id: name });

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  guard.uninstall();
  expect(guard.attempts).toEqual([]);
});

describe("AWS database operations (Data API fake; pre-check)", { timeout: 60_000 }, () => {
  let fake: DataApiFake;
  let clock: ReturnType<typeof instantClock>;
  let ops: AwsDatabaseOperations;
  const make = (client: RDSDataClient = sdkLike(fake.client)) => awsDatabaseOperations({ client, resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, clock });
  const q = async (db: string, sql: string) => (await fake.pglite(db).query<Record<string, unknown>>(sql)).rows;

  beforeEach(async () => {
    fake = await DataApiFake.create({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN });
    clock = instantClock();
    ops = make();
  });
  afterEach(async () => {
    await fake.close();
  });

  it("creates the first database on postgres with C collation from template0, and lists it by name", async () => {
    const db = await ops.createDatabase(stage, "notes-test-abc-db-1");
    expect(db).toEqual({ name: "notes-test-abc-db-1", number: 1, id: "notes-test-abc-db-1" });
    const created = fake.calls.find((c) => c.sql?.startsWith("CREATE DATABASE"));
    expect(created).toMatchObject({ database: "postgres", sql: `CREATE DATABASE "notes-test-abc-db-1" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'` });
    expect(await q("postgres", `SELECT datcollate, datctype FROM pg_database WHERE datname = 'notes-test-abc-db-1'`)).toEqual([{ datcollate: "C", datctype: "C" }]);
    const listed = await ops.listDatabases();
    expect(listed).toContainEqual({ name: "notes-test-abc-db-1", id: "notes-test-abc-db-1" });
    expect(listed.map((d) => d.name)).not.toContain("template0");
    expect(listed.map((d) => d.name)).not.toContain("template1");
  });

  it("waits for a resuming cluster before the first operation, then runs it", async () => {
    fake.resume({ calls: 3 });
    await ops.createDatabase(stage, "notes-test-abc-db-1");
    expect(clock.slept).toHaveLength(3);
    expect(fake.calls[3]).toMatchObject({ command: "ExecuteStatement", sql: "SELECT 1", database: "postgres" });
    expect(fake.databaseNames()).toContain("notes-test-abc-db-1");
  });

  it("gives up after PAR-210 when the cluster keeps resuming, creating nothing", async () => {
    fake.resume({ untilMs: Number.POSITIVE_INFINITY });
    await expect(ops.createDatabase(stage, "notes-test-abc-db-1")).rejects.toThrow(/did not answer: .*still resuming/);
    expect(clock.now()).toBeLessThanOrEqual(45_000);
    expect(fake.databaseNames()).toEqual(["postgres"]);
  });

  it("copies a database with CREATE DATABASE … TEMPLATE: data and C collation carried over, source unchanged", async () => {
    const one = await ops.createDatabase(stage, "notes-test-abc-db-1");
    await fake.pglite(one.name).exec(`CREATE TABLE "t" ("id" text PRIMARY KEY); INSERT INTO "t" VALUES ('a'), ('b')`);
    const two = await ops.copyDatabase(stage, one, "notes-test-abc-db-2");
    expect(two).toEqual({ name: "notes-test-abc-db-2", number: 2, id: "notes-test-abc-db-2" });
    expect(fake.calls.some((c) => c.database === "postgres" && c.sql === `CREATE DATABASE "notes-test-abc-db-2" TEMPLATE "notes-test-abc-db-1"`)).toBe(true);
    expect(await q(two.name, `SELECT "id" FROM "t" ORDER BY "id"`)).toEqual([{ id: "a" }, { id: "b" }]);
    expect(await q("postgres", `SELECT datcollate FROM pg_database WHERE datname = 'notes-test-abc-db-2'`)).toEqual([{ datcollate: "C" }]);
    expect(await q(one.name, `SELECT count(*)::int AS n FROM "t"`)).toEqual([{ n: 2 }]);
  });

  it("a copy refused because the source is in use (55006) leaves no new database and says why", async () => {
    const one = await ops.createDatabase(stage, "notes-test-abc-db-1");
    const tx = await fake.send(new BeginTransactionCommand({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, database: one.name }));
    await expect(ops.copyDatabase(stage, one, "notes-test-abc-db-2")).rejects.toThrow(/copying database notes-test-abc-db-1 into notes-test-abc-db-2 failed \(SQLSTATE 55006\).*another session is connected/s);
    await fake.send(new RollbackTransactionCommand({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, transactionId: tx.transactionId }));
    expect((await ops.listDatabases()).map((d) => d.name)).not.toContain("notes-test-abc-db-2");
  });

  it("an unclear answer to a create is resolved by the exact name in pg_database (DEC-0094)", async () => {
    const lostAnswer = (c: unknown) => ((c as { input?: { sql?: string } }).input?.sql?.startsWith("CREATE DATABASE") ? Object.assign(new Error("socket hang up"), { name: "TimeoutError" }) : undefined);
    const db = await make(sdkLike(fake.client, lostAnswer)).createDatabase(stage, "notes-test-abc-db-1");
    expect(db.name).toBe("notes-test-abc-db-1");
    // Failed before it ran: the name is absent, so the create fails.
    fake.inject(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }), { sql: /^CREATE DATABASE/ });
    await expect(ops.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/creating database notes-test-abc-db-2 failed: socket hang up/);
  });

  it("refuses a name Postgres would truncate", async () => {
    await expect(ops.createDatabase(stage, `${"a".repeat(60)}-db-1`)).rejects.toThrow(/63-byte limit/);
    expect(fake.calls.filter((c) => c.sql?.startsWith("CREATE"))).toEqual([]);
  });

  it("drops with WITH (FORCE), also while a transaction is open on it; a database already gone counts as dropped", async () => {
    const one = await ops.createDatabase(stage, "notes-test-abc-db-1");
    await fake.send(new BeginTransactionCommand({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, database: one.name }));
    await ops.dropDatabase(stage, one);
    expect(fake.calls.some((c) => c.database === "postgres" && c.sql === `DROP DATABASE "notes-test-abc-db-1" WITH (FORCE)`)).toBe(true);
    expect(fake.databaseNames()).toEqual(["postgres"]);
    await expect(ops.dropDatabase(stage, one)).resolves.toBeUndefined();
  });

  it("applies each migration file in one Data API transaction with its record row; a failing file leaves nothing of itself", async () => {
    const one = await ops.createDatabase(stage, "notes-test-abc-db-1");
    const db = ops.migrationDatabase(one);
    expect(await db.recordedIds()).toEqual(new Set());
    for (const m of framework) await db.applyAtomically(m, 1_700_000_000_000);
    const good = migration("0001_a", `CREATE TABLE "a" ("id" text PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO "a" VALUES ('x');`);
    await db.applyAtomically(good, 1_700_000_000_001);
    expect(await db.recordedIds()).toEqual(new Set([...framework.map((m) => m.id), "app/0001_a"]));
    expect(await q(one.name, `SELECT "dialect", "applied_at"::text AS at FROM "__framework_migrations" WHERE "id" = 'app/0001_a'`)).toEqual([{ dialect: "postgres", at: "1700000000001" }]);

    const bad = migration("0002_b", `CREATE TABLE "b" ("id" text);\n--> statement-breakpoint\nINSERT INTO "a" VALUES ('x');`);
    const before = fake.calls.length;
    await expect(db.applyAtomically(bad, 1_700_000_000_002)).rejects.toThrow(/SQLState: 23505/);
    expect(fake.calls.slice(before).map((c) => c.command)).toEqual(["BeginTransaction", "ExecuteStatement", "ExecuteStatement", "RollbackTransaction"]);
    expect(await q(one.name, `SELECT to_regclass('public.b')::text AS t`)).toEqual([{ t: null }]);
    expect(await db.recordedIds()).not.toContain("app/0002_b");
  });

  describe("checkMigratedDatabase", () => {
    const setup = async () => {
      const one = await ops.createDatabase(stage, "notes-test-abc-db-1");
      const m1 = migration("0001_s", `CREATE TABLE "p" ("id" text PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE "c" ("id" text PRIMARY KEY, "p" text REFERENCES "p"("id"));`);
      for (const m of [...framework, m1]) await ops.migrationDatabase(one).applyAtomically(m, 1);
      await fake.pglite(one.name).exec(`INSERT INTO "p" VALUES ('p1'), ('p2'); INSERT INTO "c" VALUES ('c1', 'p1'), ('c2', NULL)`);
      const two = await ops.copyDatabase(stage, one, "notes-test-abc-db-2");
      return { one, two, m1 };
    };
    const migrate = async (two: StageDatabase, m: Migration) => ops.migrationDatabase(two).applyAtomically(m, 2);
    const input = (one: StageDatabase, two: StageDatabase, m1: Migration, m2: Migration) => ({
      stage,
      previous: one,
      next: two,
      applied: [m2.id],
      migrations: { framework, app: [m1, m2] } satisfies Histories,
    });

    it("passes when rows, references, added-column rules and the record agree", async () => {
      const { one, two, m1 } = await setup();
      const m2 = migration("0002_t", `ALTER TABLE "c" ADD COLUMN "rank" integer DEFAULT 0 NOT NULL;\n--> statement-breakpoint\nALTER TABLE "p" ADD COLUMN "at" bigint;`);
      await migrate(two, m2);
      await expect(ops.checkMigratedDatabase(input(one, two, m1, m2))).resolves.toBeUndefined();
    });

    it("reports a changed row count, an orphaned reference and an added column breaking its rule", async () => {
      const { one, two, m1 } = await setup();
      const m2 = migration(
        "0002_t",
        `ALTER TABLE "p" ADD COLUMN "at" bigint DEFAULT -1;\n--> statement-breakpoint\nALTER TABLE "p" ADD COLUMN "score" double precision DEFAULT 'NaN';\n--> statement-breakpoint\n` +
          `ALTER TABLE "c" DROP CONSTRAINT "c_p_fkey";\n--> statement-breakpoint\nINSERT INTO "c" VALUES ('c3', 'nope');\n--> statement-breakpoint\n` +
          `ALTER TABLE "c" ADD CONSTRAINT "c_p_fkey" FOREIGN KEY ("p") REFERENCES "p"("id") NOT VALID;`,
      );
      await migrate(two, m2);
      await expect(ops.checkMigratedDatabase(input(one, two, m1, m2))).rejects.toThrow(
        /^database notes-test-abc-db-2: table c has 3 rows in the new database, 2 expected; 1 rows of table c reference rows that do not exist; added column p\.at: 2 rows break its rule \(bigint, nullable\); added column p\.score: 2 rows break its rule \(double precision, nullable\)$/,
      );
    });

    it("reports a table missing without a DROP TABLE and a record lacking a migration", async () => {
      const { one, two, m1 } = await setup();
      const m2 = migration("0002_t", `SELECT 1;`);
      await fake.pglite(two.name).exec(`DROP TABLE "c"`);
      await expect(ops.checkMigratedDatabase(input(one, two, m1, m2))).rejects.toThrow(/table c is missing from the new database.*the migration record lacks app\/0002_t/);
    });
  });

  it("column rules come from the declared Postgres type", () => {
    expect(ruleHolds({ name: "n", type: "integer", notNull: true })).toBe(`("n" IS NOT NULL AND TRUE)`);
    expect(ruleHolds({ name: "t", type: "bigint", notNull: false })).toBe(`("t" IS NULL OR "t" BETWEEN 0 AND 9007199254740991)`);
    expect(ruleHolds({ name: "x", type: "double precision", notNull: false })).toMatch(/NOT IN \('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8\)/);
  });
});

// ---- PROV deploy sequence with the AWS database operations -------------------------------------

const parents = defineTable("parents", { id: id(), name: text() });
const children = defineTable("children", { id: id(), parentId: ref(() => parents.id), label: text() });
const old = defineTable("old", { id: id(), parentId: ref(() => parents.id) });
// v2: unique names (fails over duplicates), a defaulted column, the child table `old` dropped.
const parents2 = defineTable("parents", { id: id(), name: text().unique() });
const children2 = defineTable("children", { id: id(), parentId: ref(() => parents2.id), label: text(), rank: integer().default(0) });

const dirs: string[] = [];
let histories: { v1: Histories; v2: Histories } | undefined;
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function load(): Promise<{ v1: Histories; v2: Histories }> {
  if (histories) return histories;
  const root = mkdtempSync(join(tmpdir(), "aws-deploy-"));
  dirs.push(root);
  await generateMigrations({ root, schema: appSchema({ parents, children, old }) });
  await generateMigrations({ root, schema: appSchema({ parents: parents2, children: children2 }) });
  const app = readHistory(root, "postgres", "app");
  histories = { v1: { framework, app: app.slice(0, 1) }, v2: { framework, app } };
  return histories;
}

/** The core's FakeTarget (postgres dialect) with its database operations replaced by G-09's. */
function withAws(t: FakeTarget, aws: AwsDatabaseOperations): TargetOperations {
  return new Proxy(t, {
    get(target, prop, receiver) {
      // FakeTarget's code step needs to know the database the code is bound to
      if (prop === "deployCode")
        return (input: Parameters<TargetOperations["deployCode"]>[0]) => {
          target.databases.set(input.database.name, { id: input.database.id, records: new Set(), rows: 0 });
          return target.deployCode(input);
        };
      if (prop === "listStageResources") return async (s: typeof stage) => ({ ...(await target.listStageResources(s)), databases: await aws.listDatabases() });
      if (typeof prop === "string" && prop in aws && prop !== "listDatabases" && prop !== "waitForResume") return (aws as unknown as Record<string, unknown>)[prop];
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as TargetOperations;
}

describe("deploy with AWS databases (Data API fake; pre-check, not AWS evidence)", { timeout: 120_000 }, () => {
  let fake: DataApiFake;
  let aws: AwsDatabaseOperations;
  let t: FakeTarget;
  let ops: TargetOperations;
  beforeEach(async () => {
    await load();
    fake = await DataApiFake.create({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN });
    aws = awsDatabaseOperations({ client: sdkLike(fake.client), resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, clock: instantClock() });
    t = new FakeTarget({ dialect: "postgres" });
    ops = withAws(t, aws);
  }, 60_000);
  afterEach(async () => {
    await fake.close();
  });

  const deploy = (migrations: Histories) => runDeploy(ops, { stage, migrations, requiredSecrets: [] }, captureIo());
  const stageDbs = () => fake.databaseNames().filter((n) => n.startsWith("notes-test-abc-db-"));
  const rows = async (db: string, sql: string) => (await fake.pglite(db).query<Record<string, unknown>>(sql)).rows;

  it(tag(["MIG-AC-003", "MIG-AC-006"], "AWS pre-check: a failing migration keeps the old database unchanged with no new one behind; after fixing the data the copy is migrated, checked and left as the only database"), async () => {
    const { v1, v2 } = await load();
    expect((await deploy(v1)).status).toBe(0);
    expect(stageDbs()).toEqual(["notes-test-abc-db-1"]);
    const first = "notes-test-abc-db-1";
    await fake.pglite(first).exec(
      `INSERT INTO "parents" VALUES ('p1', 'same'), ('p2', 'same');
       INSERT INTO "children" ("id", "parent_id", "label") VALUES ('c1', 'p1', 'a'), ('c2', 'p2', 'b');
       INSERT INTO "old" VALUES ('o1', 'p1');`,
    );
    const snapshot = async () => ({
      parents: await rows(first, `SELECT * FROM "parents" ORDER BY "id"`),
      children: await rows(first, `SELECT * FROM "children" ORDER BY "id"`),
      old: await rows(first, `SELECT * FROM "old"`),
      record: await rows(first, `SELECT "id", "checksum" FROM "__framework_migrations" ORDER BY "id"`),
      columns: await rows(first, `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
      constraints: await rows(first, `SELECT conname FROM pg_constraint ORDER BY conname`),
    });
    const before = await snapshot();

    const failed = await deploy(v2);
    expect(failed.status).toBe(1);
    expect(failed.failure).toMatchObject({ step: "migrate", migrationFile: v2.app[1]?.file });
    expect(failed.failure?.databaseError).toMatch(/SQLState: 23505/);
    expect(stageDbs()).toEqual(["notes-test-abc-db-1"]);
    expect(await snapshot()).toEqual(before);
    expect(t.calls.filter((c) => /^(stopApp|startApp)/.test(c))).toEqual(["startApp notes/test-abc", "stopApp notes/test-abc", "startApp notes/test-abc"]);
    expect(t.answering(stage)).toBe("notes-test-abc-db-1");

    await fake.pglite(first).exec(`UPDATE "parents" SET "name" = 'other' WHERE "id" = 'p2'`);
    const ok = await deploy(v2);
    expect(ok.status).toBe(0);
    expect(stageDbs()).toEqual(["notes-test-abc-db-2"]);
    const second = "notes-test-abc-db-2";
    expect(await rows(second, `SELECT "id", "parent_id", "label", "rank" FROM "children" ORDER BY "id"`)).toEqual([
      { id: "c1", parent_id: "p1", label: "a", rank: 0 },
      { id: "c2", parent_id: "p2", label: "b", rank: 0 },
    ]);
    expect(await rows(second, `SELECT to_regclass('public.old')::text AS t`)).toEqual([{ t: null }]);
    expect(t.calls).toContain("deployCode notes/test-abc notes-test-abc-db-2");
  });

  it(tag("MIG-AC-003", "AWS pre-check: a failing step-4 check deletes the copy and restarts the old version"), async () => {
    const { v1, v2 } = await load();
    expect((await deploy(v1)).status).toBe(0);
    await fake.pglite("notes-test-abc-db-1").exec(`INSERT INTO "parents" VALUES ('p1', 'a'), ('p2', 'b')`);
    // A copy that loses a row (as a faulty copy would) is caught by the row-count comparison.
    const copy = aws.copyDatabase.bind(aws);
    aws.copyDatabase = async (s, from, name) => {
      const made = await copy(s, from, name);
      await fake.pglite(name).exec(`DELETE FROM "parents" WHERE "id" = 'p2'`);
      return made;
    };
    const failed = await deploy(v2);
    expect(failed.status).toBe(1);
    expect(failed.failure?.step).toBe("migrate");
    expect(failed.failure?.message).toMatch(/the check of the migrated database failed: .*table parents has 1 rows in the new database, 2 expected/);
    expect(stageDbs()).toEqual(["notes-test-abc-db-1"]);
    expect(t.answering(stage)).toBe("notes-test-abc-db-1");
  });

  it(tag("MIG-AC-002", "AWS pre-check: a redeploy with nothing pending creates, copies and writes nothing"), async () => {
    const { v1 } = await load();
    expect((await deploy(v1)).status).toBe(0);
    const start = fake.calls.length;
    expect((await deploy(v1)).status).toBe(0);
    const later = fake.calls.slice(start);
    expect(later.filter((c) => c.command !== "ExecuteStatement" || !/^\s*SELECT\b/i.test(c.sql ?? ""))).toEqual([]);
    expect(stageDbs()).toEqual(["notes-test-abc-db-1"]);
    expect(t.calls.filter((c) => /^stopApp/.test(c))).toEqual([]);
  });
});
