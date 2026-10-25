/**
 * Cloudflare stage lifecycle beyond deploy and test-stage removal, on the fake Cloudflare account
 * (no Cloudflare call): `stop`/`start` with the stage record and a deploy that leaves a stopped
 * stage stopped (DEC-0544), and the production `remove`'s backup into `prototype-backups`
 * before anything is deleted (DEC-0543).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import type { Migration } from "../../mig/history.js";
import { runDeploy, type DeployRequest } from "../core/deploy.js";
import type { HealthOutcome, Stage } from "../core/operations.js";
import { runRemove } from "../core/remove.js";
import { runStart, runStop } from "../core/stop-start.js";
import { backupStamp } from "./backup.js";
import { ACCOUNT, FakeCloud, FakeDatabases } from "./fake-cloud.test-support.js";
import { stageRecordKey } from "./stage-record.js";
import { createCloudflareTarget, type CloudflareTargetOptions } from "./target.js";

const test = { app: "notes", stage: "test-abc" };
const prod = { app: "notes", stage: "prod" };
const ENV = { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PATH: "/usr/bin" };
const migration = (id: string): Migration => ({ id, name: id.split("/")[1]!, file: `${id}.sql`, text: "", checksum: "", statements: [] });
const MIGRATIONS = { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] };
const NOW = Date.UTC(2026, 9, 25, 15, 3, 1);

function setup(overrides: Partial<CloudflareTargetOptions> = {}) {
  const cloud = FakeCloud.withSharedResources();
  cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: "example.test" });
  cloud.buckets.get("sst-state")!.add("framework/account.json");
  const zone = cloud.zones.get("example.test")!;
  zone.sending.push({ id: "send1", name: "example.test", enabled: true, pollsUntilEnabled: 0 });
  const databases = new FakeDatabases();
  let healthCalls = 0;
  const options: CloudflareTargetOptions = {
    api: cloud.api,
    bytes: cloud.bytes,
    accountId: ACCOUNT,
    env: ENV,
    appDir: mkdtempSync(join(tmpdir(), "cf-lifecycle-")),
    databases,
    sst: cloud.sst,
    fetch: (async () => (healthCalls++, new Response(null, { status: 204 }))) as unknown as typeof fetch,
    code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
    files: { bucketCors: () => ({ rules: [] }), storagePreflight: async (): Promise<HealthOutcome> => ({ ok: true }) },
    randomKey: () => "generated-key",
    now: () => NOW,
    sleep: async () => {},
    email: { setupProblems: async () => [], setUp: async () => [], productionPrerequisites: async () => [] },
    ...overrides,
  };
  return { cloud, databases, target: createCloudflareTarget(options), health: () => healthCalls };
}

const request = (stage: Stage, extra: Partial<DeployRequest> = {}): DeployRequest => ({ stage, migrations: MIGRATIONS, requiredSecrets: [], ...extra });
const route = (cloud: FakeCloud, stage: Stage) => cloud.workers.get(`${stage.app}-${stage.stage}`)?.enabled;
const recordKey = (stage: Stage) => `sst-state/${stageRecordKey(stage)}`;

describe("stop and start (DEC-0544)", () => {
  it("stop turns the route off and records the stop in sst-state; start deletes the record and turns the route on", async () => {
    const { cloud, target } = setup();
    expect((await runDeploy(target, request(test), captureIo())).status).toBe(0);
    expect(route(cloud, test)).toBe(true);

    const stopIo = captureIo();
    expect(await runStop(target, test, stopIo)).toBe(0);
    expect(route(cloud, test)).toBe(false);
    expect(cloud.workers.get("notes-test-abc")!.previews).toBe(false);
    expect(cloud.objectBodies.get(recordKey(test))).toEqual({ stopped: true });
    expect(stopIo.out).toMatch(/stopped notes stage test-abc.*deploy leaves it stopped/);
    expect(await target.readStageRecord(test)).toEqual({ stopped: true });

    expect(await runStart(target, test, captureIo())).toBe(0);
    expect(route(cloud, test)).toBe(true);
    expect(cloud.buckets.get("sst-state")!.has(stageRecordKey(test))).toBe(false);
    expect(await target.readStageRecord(test)).toEqual({ stopped: false });
  });

  it("a deploy of a stopped stage leaves it stopped (the route the code deploy turned on is turned off again) and skips the health check; --start starts it", async () => {
    const { cloud, target, health } = setup();
    expect((await runDeploy(target, request(test), captureIo())).status).toBe(0);
    await runStop(target, test, captureIo());
    const before = health();

    const io = captureIo();
    const kept = await runDeploy(target, request(test), io);
    expect(kept).toMatchObject({ status: 0, stopped: true });
    expect(route(cloud, test)).toBe(false);
    expect(health()).toBe(before);
    expect(io.out).toMatch(/is stopped \(recorded by stop\); the deploy leaves it stopped \(add --start to start it\)/);
    expect(io.out).toMatch(/health check was skipped/);
    expect(cloud.objectBodies.get(recordKey(test))).toEqual({ stopped: true });

    const started = await runDeploy(target, request(test, { start: true }), captureIo());
    expect(started.status).toBe(0);
    expect(started.stopped).toBeUndefined();
    expect(route(cloud, test)).toBe(true);
    expect(health()).toBeGreaterThan(before);
    expect(cloud.buckets.get("sst-state")!.has(stageRecordKey(test))).toBe(false);
  });

  it("stop of a stage that does not exist fails and records nothing", async () => {
    const { cloud, target } = setup();
    const io = captureIo();
    expect(await runStop(target, test, io)).toBe(1);
    expect(io.err).toMatch(/stop of stage test-abc failed/);
    expect(cloud.buckets.get("sst-state")!.has(stageRecordKey(test))).toBe(false);
  });

  it("the stage record is listed as the stage's own and removed with the stage", async () => {
    const { cloud, target } = setup();
    await runDeploy(target, request(test), captureIo());
    await runStop(target, test, captureIo());
    expect((await target.listStageResources(test)).resources).toContainEqual({ kind: "stage record", id: stageRecordKey(test) });
    expect((await runRemove(target, test, captureIo())).status).toBe(0);
    expect(cloud.buckets.get("sst-state")!.has(stageRecordKey(test))).toBe(false);
  });
});

describe("production remove backs up first (DEC-0543)", () => {
  const stamp = backupStamp(NOW);
  const prefix = `notes/prod/${stamp}/`;

  async function deployedProd() {
    const s = setup();
    expect((await runDeploy(s.target, request(prod), captureIo())).status).toBe(0);
    const photo = new Uint8Array([0, 1, 2, 255, 128]);
    s.cloud.putBytes("notes-prod-files", "photos/a.png\u0001", photo, "image/png");
    s.cloud.putBytes("notes-prod-files", "notes.txt\u0001", new TextEncoder().encode("hello"), "text/plain");
    return { ...s, photo };
  }

  it("exports the database and copies every file with its bytes and type to prototype-backups, then deletes the stage", async () => {
    const { cloud, databases, target, photo } = await deployedProd();
    expect(backupStamp(NOW)).toBe("20261025T150301Z");
    const io = captureIo();
    const result = await runRemove(target, prod, io);
    expect(result.status).toBe(0);
    expect(result.backup?.location).toBe(`R2 bucket prototype-backups, prefix ${prefix}`);
    expect(result.backup?.items).toEqual(["database notes-prod-db-1", "2 file(s) of R2 bucket notes-prod-files"]);

    const backups = cloud.buckets.get("prototype-backups")!;
    expect([...backups].sort()).toEqual([`${prefix}database/notes-prod-db-1.sql`, `${prefix}files/notes.txt\u0001`, `${prefix}files/photos/a.png\u0001`, `${prefix}manifest.json`].sort());
    expect(cloud.objectBytes.get(`prototype-backups/${prefix}files/photos/a.png\u0001`)).toEqual({ bytes: photo, contentType: "image/png" });
    expect(new TextDecoder().decode(cloud.objectBytes.get(`prototype-backups/${prefix}database/notes-prod-db-1.sql`)!.bytes)).toMatch(/dump of notes-prod-db-1/);
    expect(JSON.parse(new TextDecoder().decode(cloud.objectBytes.get(`prototype-backups/${prefix}manifest.json`)!.bytes))).toMatchObject({ app: "notes", stage: "prod", files: 2, databases: ["database/notes-prod-db-1.sql"] });
    // Backup before deletion: the export precedes the drop.
    expect(databases.calls.indexOf("export notes-prod-db-1")).toBeLessThan(databases.calls.indexOf("drop notes-prod-db-1"));
    expect(cloud.buckets.has("notes-prod-files")).toBe(false);
    expect(cloud.workers.has("notes-prod")).toBe(false);
    expect(io.out).toMatch(/backed up stage prod to R2 bucket prototype-backups/);
    expect(io.out).toMatch(/Restore a removed production stage/);
  });

  const failures: [string, (s: Awaited<ReturnType<typeof deployedProd>>) => void, RegExp][] = [
    ["the database export fails", (s) => s.databases.failingExports.add("notes-prod-db-1"), /exporting D1 database notes-prod-db-1/],
    ["a file cannot be read", (s) => s.cloud.bytesFailures.set(`GET /accounts/${ACCOUNT}/r2/buckets/notes-prod-files/objects/${encodeURIComponent("notes.txt\u0001")}`, 500), /reading file "notes\.txt\\u0001"/],
    ["a backup object cannot be written", (s) => s.cloud.bytesFailures.set(`PUT /accounts/${ACCOUNT}/r2/buckets/prototype-backups/objects/${encodeURIComponent(`${prefix}manifest.json`)}`, 500), /writing .*manifest\.json to R2 bucket prototype-backups failed/],
    ["the backup bucket is missing", (s) => void s.cloud.buckets.delete("prototype-backups"), /R2 bucket prototype-backups is missing; run setup-account/],
  ];
  for (const [what, inject, why] of failures) {
    it(`when ${what}, nothing of the stage is deleted and remove exits 1`, async () => {
      const s = await deployedProd();
      inject(s);
      const io = captureIo();
      expect((await runRemove(s.target, prod, io)).status).toBe(1);
      expect(io.err).toMatch(why);
      expect(io.err).toMatch(/nothing was deleted/);
      expect(s.databases.calls.some((c) => c.startsWith("drop"))).toBe(false);
      expect([...s.databases.dbs.values()].map((d) => d.name)).toEqual(["notes-prod-db-1"]);
      expect(s.cloud.workers.has("notes-prod")).toBe(true);
      expect(s.cloud.buckets.get("notes-prod-files")!.size).toBe(2);
      expect(s.cloud.sstRuns.some((r) => r.startsWith("remove"))).toBe(false);
    });
  }

  it("a test stage is removed without a backup", async () => {
    const { cloud, databases, target } = setup();
    await runDeploy(target, request(test), captureIo());
    expect((await runRemove(target, test, captureIo())).status).toBe(0);
    expect(databases.calls.some((c) => c.startsWith("export"))).toBe(false);
    expect(cloud.buckets.get("prototype-backups")!.size).toBe(0);
  });

  it("without a byte transfer a production stage cannot be removed, and nothing is deleted", async () => {
    const s = setup({ bytes: undefined as never });
    await runDeploy(s.target, request(prod), captureIo());
    const io = captureIo();
    expect((await runRemove(s.target, prod, io)).status).toBe(1);
    expect(io.err).toMatch(/no byte transfer for R2 objects/);
    expect(s.cloud.workers.has("notes-prod")).toBe(true);
  });
});
