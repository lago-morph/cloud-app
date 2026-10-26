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
  return { cloud, databases, options, target: createCloudflareTarget(options), health: () => healthCalls };
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
    // Files are stored under numbered keys (a stage key may be up to R2's 1024 bytes); the manifest maps them (DEC-0556).
    expect([...backups].sort()).toEqual([`${prefix}database/notes-prod-db-1.sql`, `${prefix}files/000001`, `${prefix}files/000002`, `${prefix}manifest.json`].sort());
    expect(cloud.objectBytes.get(`prototype-backups/${prefix}files/000002`)).toEqual({ bytes: photo, contentType: "image/png" });
    expect(new TextDecoder().decode(cloud.objectBytes.get(`prototype-backups/${prefix}database/notes-prod-db-1.sql`)!.bytes)).toMatch(/dump of notes-prod-db-1/);
    expect(JSON.parse(new TextDecoder().decode(cloud.objectBytes.get(`prototype-backups/${prefix}manifest.json`)!.bytes))).toMatchObject({
      app: "notes",
      stage: "prod",
      files: 2,
      databases: ["database/notes-prod-db-1.sql"],
      fileObjects: [
        { object: "files/000001", key: "notes.txt\u0001", contentType: "text/plain", bytes: 5 },
        { object: "files/000002", key: "photos/a.png\u0001", contentType: "image/png", bytes: 5 },
      ],
    });
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

  it("after turning the route off, remove waits PAR-315 for requests in flight before it reads anything for the backup", async () => {
    const waits: { ms: number; route: boolean | undefined; exports: number }[] = [];
    const s: ReturnType<typeof setup> = setup({ sleep: async (ms) => void waits.push({ ms, route: route(s.cloud, prod), exports: s.databases.calls.filter((c) => c.startsWith("export")).length }) });
    expect((await runDeploy(s.target, request(prod), captureIo())).status).toBe(0);
    waits.length = 0;
    const io = captureIo();
    expect((await runRemove(s.target, prod, io)).status).toBe(0);
    expect(waits).toContainEqual({ ms: 60_000, route: false, exports: 0 });
    expect(io.out).toMatch(/waited 60 s \(PAR-315\) for requests in flight/);
  });

  it("a stored key of R2's full 1024 bytes is backed up (numbered backup keys, the key in the manifest)", async () => {
    const { cloud, target } = await deployedProd();
    const longKey = `${"k".repeat(1023)}\u0001`;
    cloud.putBytes("notes-prod-files", longKey, new Uint8Array([7]), "application/pdf");
    const io = captureIo();
    expect((await runRemove(target, prod, io)).status).toBe(0);
    const manifest = JSON.parse(new TextDecoder().decode(cloud.objectBytes.get(`prototype-backups/${prefix}manifest.json`)!.bytes)) as { fileObjects: { object: string; key: string; contentType: string }[] };
    const entry = manifest.fileObjects.find((f) => f.key === longKey)!;
    expect(entry.contentType).toBe("application/pdf");
    expect(cloud.objectBytes.get(`prototype-backups/${prefix}${entry.object}`)).toEqual({ bytes: new Uint8Array([7]), contentType: "application/pdf" });
  });

  it("a table D1's dump would not keep exactly is also backed up losslessly, referenced from the manifest (DEC-0096)", async () => {
    const s = await deployedProd();
    s.databases.lossyTables.set("notes-prod-db-1", ["counters"]);
    const io = captureIo();
    const result = await runRemove(s.target, prod, io);
    expect(result.status).toBe(0);
    const keys = [...s.cloud.buckets.get("prototype-backups")!];
    expect(keys).toContain(`${prefix}database/notes-prod-db-1.lossless.json`);
    expect(keys).toContain(`${prefix}database/notes-prod-db-1.restore.sql`);
    const manifest = JSON.parse(new TextDecoder().decode(s.cloud.objectBytes.get(`prototype-backups/${prefix}manifest.json`)!.bytes)) as unknown;
    expect(manifest).toMatchObject({
      lossless: [{ database: "notes-prod-db-1", tables: ["counters"], json: "database/notes-prod-db-1.lossless.json", restore: "database/notes-prod-db-1.restore.sql" }],
    });
    expect(result.backup?.items).toContain("database notes-prod-db-1 (table counters also row by row, losslessly)");
  });

  it("a retry after a partial remove lists every backup of the stage, the complete one first, and flags the one missing databases", async () => {
    const first = await deployedProd();
    first.cloud.failSst.add("remove");
    expect((await runRemove(first.target, prod, captureIo())).status).toBe(1);
    expect([...first.databases.dbs.values()]).toEqual([]);
    first.cloud.failSst.delete("remove");

    const LATER = NOW + 3_600_000;
    const retryTarget = createCloudflareTarget({ ...first.options, now: () => LATER });
    const io = captureIo();
    const retry = await runRemove(retryTarget, prod, io);
    expect(retry.status).toBe(0);
    const complete = `notes/prod/${backupStamp(NOW)}/`;
    const partial = `notes/prod/${backupStamp(LATER)}/`;
    // The listing: one indented line per backup, after "backups of stage prod".
    const lines = io.out.split("\n").filter((l) => l.startsWith("  "));
    const at = (p: string) => lines.findIndex((l) => l.includes(p));
    expect(at(complete)).toBeGreaterThan(-1);
    expect(at(partial)).toBeGreaterThan(at(complete));
    expect(lines[at(complete)]).toMatch(/1 database\(s\)/);
    expect(lines[at(partial)]).toContain(`INCOMPLETE: holds 0 of the 1 database(s) of the earlier backup ${backupStamp(NOW)}; do not restore from it`);
    expect(io.out).toMatch(new RegExp(`to restore it, use R2 bucket prototype-backups, prefix ${complete.replace(/\//g, "\\/")}`));
  });

  it("a backup from an earlier lifetime of the stage, with other and more databases, does not make the fresh backup look incomplete", async () => {
    const s = await deployedProd();
    const old = "notes/prod/20261001T000000Z/";
    const manifest = { app: "notes", stage: "prod", databases: ["database/notes-prod-db-1.sql", "database/notes-prod-db-2.sql"], databaseIds: ["old-1", "old-2"], files: 0 };
    s.cloud.putBytes("prototype-backups", `${old}manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)), "application/json");
    const io = captureIo();
    expect((await runRemove(s.target, prod, io)).status).toBe(0);
    const listing = io.out.split("\n").filter((l) => l.startsWith("  "));
    expect(listing[0]).toContain(prefix);
    expect(io.out).not.toMatch(/do not restore/);
    expect(io.out).toMatch(new RegExp(`to restore it, use R2 bucket prototype-backups, prefix ${prefix.replace(/\//g, "\\/")}`));
    const written = JSON.parse(new TextDecoder().decode(s.cloud.objectBytes.get(`prototype-backups/${prefix}manifest.json`)!.bytes)) as { databaseIds: string[] };
    expect(written.databaseIds).toEqual(["uuid-1"]);
  });

  it("a backup without a manifest (an interrupted one) is listed as incomplete", async () => {
    const s = await deployedProd();
    s.cloud.putBytes("prototype-backups", "notes/prod/20261001T000000Z/database/notes-prod-db-1.sql", new Uint8Array([1]));
    const io = captureIo();
    expect((await runRemove(s.target, prod, io)).status).toBe(0);
    expect(io.out).toMatch(/notes\/prod\/20261001T000000Z\/: INCOMPLETE: no manifest \(the backup did not finish\); do not restore from it/);
    expect(io.out.indexOf(prefix)).toBeLessThan(io.out.indexOf("20261001T000000Z"));
  });

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
