/**
 * MIG-AC-002, MIG-AC-003 (local and cloud) and MIG-AC-006 (cloud), on stages these tests
 * deploy and remove themselves (support/stage.ts; local reading of "deployment": DEC-0144).
 * The tests of one describe block run in order on one stage, and the two blocks run one after
 * the other, so a cloud run holds at most one extra stage (two D1 databases during a
 * schema-changing deploy) at a time.
 *
 * Data: the reference app's data fixture (3 parents, 5 children, 2 files; ROUTES.md), loaded
 * once per stage, and at most WRITER_MAX KV writes during the schema-changing deploy.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag, type ComplianceClient } from "../../harness/index.js";
import { createStage, frameworkMigrations, type StageUnderTest } from "./support/stage.js";

const STEP_MS = 1_800_000;
/** Writes attempted while the schema-changing deploy runs (MIG-AC-006): bounded, a handful of rows. */
const WRITER_MAX = 20;
const WRITER_INTERVAL_MS = 3_000;
/** Health probes while the no-change redeploy runs on a cloud (no D1 rows). */
const PROBE_INTERVAL_MS = 2_000;

interface FixtureDump {
  readonly version: string;
  readonly parents: readonly { name: string; note?: string | null }[];
  readonly children: readonly { parent: string; label: string; rank?: number }[];
  readonly files: readonly { name: string; size: number; contentType: string; sha256: string }[];
}

type Rows = Record<string, unknown>[];
type Snapshot = Record<string, Rows>;

/** Every table of the stage's database with all its rows, sorted (D1 is SQLite on local and Cloudflare). */
async function snapshot(stage: StageUnderTest): Promise<Snapshot> {
  const tables = await stage.query("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY name");
  const out: Snapshot = {};
  for (const t of tables) {
    const name = String(t["name"]);
    const rows = await stage.query(`SELECT * FROM "${name}"`);
    out[name] = rows.map((r) => ({ ...r })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  return out;
}

/** MIG-REQ-002: the record lists every migration once, framework first, then app, each in file order (ids per DEC-0142). */
async function expectRecord(stage: StageUnderTest): Promise<void> {
  const record = (await stage.query("SELECT id FROM __framework_migrations ORDER BY rowid")).map((r) => String(r["id"]));
  const expected = [...frameworkMigrations().map((m) => `framework/${m}`), ...stage.appMigrations().map((m) => `app/${m}`)];
  expect(expected.length, "the framework and the app each have at least one migration").toBeGreaterThanOrEqual(2);
  expect(record).toEqual(expected);
}

async function dump(stage: StageUnderTest): Promise<FixtureDump> {
  const user = await stage.user();
  return user.expectStatus(await user.get("/api/fixture/dump"), 200).json<FixtureDump>();
}

async function expectAnswering(stage: StageUnderTest, version: string): Promise<void> {
  const anyone = await stage.user();
  anyone.expectStatus(await anyone.get("/api/__framework/health"), 204);
  expect(anyone.expectStatus(await anyone.get("/api/ref/schema-version"), 200).json()).toEqual({ version });
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe("MIG: initial and unchanged deployments, a failing data-dependent migration and its re-run", () => {
  let stage: StageUnderTest;
  let loaded: FixtureDump;

  beforeAll(async () => {
    stage = createStage();
    await stage.setSecret("apiKey", `c-t2-${randomBytes(12).toString("hex")}`);
  }, STEP_MS);
  afterAll(async () => {
    await stage?.remove();
  }, STEP_MS);

  it(tag("MIG-AC-002", "initial deployment creates the schema, the app answers, and the record lists every migration once"), async () => {
    const result = await stage.deploy("v1");
    expect(result.ok, `initial deploy failed (status ${String(result.status)}): ${result.output.slice(-1500)}`).toBe(true);
    const tables = (await stage.query("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r["name"]));
    expect(tables).toEqual(expect.arrayContaining(["authors", "posts", "tags", "blobs", "parents", "children", "__framework_kv", "__framework_migrations"]));
    await expectRecord(stage);
    await expectAnswering(stage, "v1");
    expect(await dump(stage)).toEqual({ version: "v1", parents: [], children: [], files: [] });
    expect(await stage.databases()).toHaveLength(1);
  }, STEP_MS);

  it(tag("MIG-AC-002", "a second deployment with no changes changes no data, does not stop the app (cloud: it answers throughout), and leaves it answering"), async () => {
    const user = await stage.user();
    expect(user.expectStatus(await user.post("/api/fixture/load"), 201).json()).toEqual({ parents: 3, children: 5, files: 2 });
    loaded = await dump(stage);
    const before = await snapshot(stage);
    const databasesBefore = await stage.databases();
    const probes: number[] = [];
    const cloud = stage.stage !== "local";
    const url = stage.baseUrl();
    const result = await stage.deploy("v1", async (signal) => {
      // Locally a deployment is a `dev` restart, so "does not stop the app" has no separate local
      // meaning; there the check is that nothing is applied (DEC-0144). On a cloud the app must
      // answer every probe while the deploy runs.
      if (!cloud) return;
      while (!signal.aborted) {
        const response = await fetch(`${url}/api/__framework/health`, { headers: { "user-agent": "prototype-framework-compliance/0.1.0" } }).catch(() => undefined);
        probes.push(response?.status ?? 0);
        await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
      }
    });
    expect(result.ok, `no-change deploy failed (status ${String(result.status)}): ${result.output.slice(-1500)}`).toBe(true);
    expect(await snapshot(stage), "every table, every row and the migration record (incl. applied times) are unchanged").toEqual(before);
    expect(await stage.databases()).toEqual(databasesBefore);
    await expectAnswering(stage, "v1");
    expect(await dump(stage)).toEqual(loaded);
    await expectRecord(stage);
    if (cloud) {
      expect(probes.length, "health probes made while the deploy ran").toBeGreaterThan(0);
      expect(probes.filter((s) => s !== 204), "health probes that did not answer 204 while the deploy ran").toEqual([]);
    }
  }, STEP_MS);

  it(tag("MIG-AC-003", "a data-dependent failing migration (unique over duplicate rows) exits with failure status, leaves the database unchanged and no new database, and the old app answers again"), async () => {
    const before = await snapshot(stage);
    const databasesBefore = await stage.databases();
    const result = await stage.deploy("unique-fail");
    expect(result.ok, "the deploy of the failing migration succeeded").toBe(false);
    expect(result.status, "exit status of the failed deploy").not.toBe(0);
    expect(result.status, "the failed deploy exited (status)").not.toBeNull();
    expect(await stage.databases(), "no new database is left behind").toEqual(databasesBefore);
    expect(await snapshot(stage), "the existing database is unchanged").toEqual(before);
    await expectAnswering(stage, "v1");
    expect(await dump(stage), "the old app reads the unchanged data").toEqual(loaded);
  }, STEP_MS);

  it(tag("MIG-AC-003", "a re-run after correcting the data succeeds and keeps every row"), async () => {
    const user = await stage.user();
    expect(user.expectStatus(await user.post("/api/cases/run", { set: "mig", name: "relabelDuplicate" }), 200).json()).toEqual({ outcome: "value", value: { changed: 1 } });
    const result = await stage.deploy("unique-fail");
    expect(result.ok, `re-run failed (status ${String(result.status)}): ${result.output.slice(-1500)}`).toBe(true);
    await expectAnswering(stage, "unique-fail");
    expect(await dump(stage)).toEqual({
      ...loaded,
      version: "unique-fail",
      children: loaded.children.map((c) => (c.parent === "beta" && c.label === "shared" ? { ...c, label: "shared-beta" } : c)),
    });
    await expectRecord(stage);
    expect(await stage.databases()).toHaveLength(1);
  }, STEP_MS);
});

describe("MIG: a schema-changing deployment with data, writes, a secret and a session", () => {
  let stage: StageUnderTest;
  let session: ComplianceClient;
  let before: Snapshot;
  let loaded: FixtureDump;
  const secret = `c-t2-${randomBytes(12).toString("hex")}`;
  const writerNs = `c-t2-mig-${randomBytes(6).toString("hex")}`;
  const acknowledged: { key: string; value: string }[] = [];
  let attempted = 0;
  let deployed = false;
  let meBefore: unknown;

  beforeAll(async () => {
    stage = createStage();
    await stage.setSecret("apiKey", secret);
    const result = await stage.deploy("v1");
    if (!result.ok) throw new Error(`deploying version 1 failed (status ${String(result.status)}): ${result.output.slice(-1500)}`);
    session = await stage.user();
    meBefore = session.expectStatus(await session.get("/api/ref/me"), 200).json();
    expect(meBefore).toMatchObject({ user: { level: "user" } });
    session.expectStatus(await session.post("/api/fixture/load"), 201);
    loaded = await dump(stage);
    before = await snapshot(stage);
  }, STEP_MS);
  afterAll(async () => {
    await stage?.remove();
  }, STEP_MS);

  it(tag("MIG-AC-003", "with parent and child rows present, supported changes incl. a column drop on a table with child rows preserve every row and reference not explicitly dropped"), async () => {
    const result = await stage.deploy("v2", async (signal) => {
      // MIG-AC-006: writes made while the deploy runs; the acknowledged ones must survive.
      while (!signal.aborted && attempted < WRITER_MAX) {
        const key = `${writerNs}/${String(attempted).padStart(2, "0")}`;
        const value = `written during the deploy ${String(attempted)}`;
        attempted++;
        const response = await session.request("PUT", "/api/kv/value", { json: { key, value } }).catch(() => undefined);
        if (response?.status === 204) acknowledged.push({ key, value });
        await new Promise((r) => setTimeout(r, WRITER_INTERVAL_MS));
      }
    });
    expect(result.ok, `schema-changing deploy failed (status ${String(result.status)}): ${result.output.slice(-1500)}`).toBe(true);
    deployed = true;
    await expectAnswering(stage, "v2");
    expect(await dump(stage)).toEqual({
      version: "v2",
      parents: loaded.parents.map((p) => ({ name: p.name })),
      children: loaded.children.map((c) => ({ ...c, rank: 0 })),
      files: loaded.files,
    });
    const after = await snapshot(stage);
    // Every row and reference: same IDs and references; `parents.note` was dropped, `children.rank` added with its default.
    expect(after["parents"]).toEqual((before["parents"] ?? []).map(({ note: _dropped, ...rest }) => rest));
    expect(after["children"]).toEqual((before["children"] ?? []).map((c) => ({ ...c, rank: 0 })));
    expect(await stage.query("SELECT count(*) AS n FROM children LEFT JOIN parents ON parents.id = children.parent_id WHERE parents.id IS NULL")).toEqual([{ n: 0 }]);
    for (const table of Object.keys(before)) {
      if (["parents", "children", "__framework_migrations", "__framework_kv"].includes(table)) continue;
      expect(after[table], `table ${table} is unchanged`).toEqual(before[table]);
    }
    expect(after["__framework_kv"], "KV entries present before the deploy are kept").toEqual(expect.arrayContaining(before["__framework_kv"] ?? []));
    await expectRecord(stage);
  }, STEP_MS);

  it(tag("MIG-AC-006", "after the schema-changing deploy every write acknowledged during it is present, the stage has one database, the secret set before is returned and the session is still accepted"), async () => {
    expect(deployed, "the schema-changing deploy ran (previous test)").toBe(true);
    expect(attempted, "writes attempted while the deploy ran").toBeGreaterThan(0);
    expect(acknowledged.length, "writes acknowledged while the deploy ran (none would prove nothing)").toBeGreaterThan(0);
    for (const { key, value } of acknowledged) {
      const read = session.expectStatus(await session.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json();
      expect(read, `acknowledged write ${key}`).toEqual({ value });
    }
    expect(await stage.databases()).toHaveLength(1);
    expect(session.expectStatus(await session.get("/api/ref/secret"), 200).json()).toEqual({ sha256: sha256(secret) });
    expect(session.expectStatus(await session.get("/api/ref/me"), 200).json(), "the session obtained before the deploy is still accepted").toEqual(meBefore);
  }, STEP_MS);
});
