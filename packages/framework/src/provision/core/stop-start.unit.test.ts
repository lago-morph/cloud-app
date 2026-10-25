/**
 * `stop`, `start` and a deploy of a stopped stage (DEC-0544), the copy method in the deploy
 * output (DEC-0545) and the production `remove`'s backup-first order (DEC-0543), on the
 * in-memory target.
 */
import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import type { Histories } from "../../mig/apply.js";
import type { Migration } from "../../mig/history.js";
import { runDeploy, type DeployRequest } from "./deploy.js";
import { FakeTarget } from "./fake-target.js";
import { runRemove } from "./remove.js";
import { runStart, runStop } from "./stop-start.js";

const stage = { app: "notes", stage: "test-abc" };
const prod = { app: "notes", stage: "prod" };
const db = (s: { stage: string }, n: number) => `notes-${s.stage}-db-${n}`;
const mig = (id: string): Migration => ({ id, name: id.split("/")[1]!, file: `/app/migrations/sqlite/${id.split("/")[1]!}.sql`, text: "", checksum: "0", statements: [] });
const histories = (app: string[] = ["app/0000_schema"]): Histories => ({ framework: [mig("framework/0000_framework_tables")], app: app.map(mig) });
const ALL = ["framework/0000_framework_tables", "app/0000_schema"];
const request = (overrides: Partial<DeployRequest> = {}): DeployRequest => ({ stage, migrations: histories(), requiredSecrets: [], ...overrides });

function deployed(s = stage): FakeTarget {
  const t = new FakeTarget({ databases: [{ name: db(s, 1), records: ALL, rows: 5 }] });
  const st = t.stageState(s);
  st.resources.push({ kind: "bucket", id: `${s.stage}-b` }, { kind: "runtime", id: `${s.stage}-r` });
  st.secrets = new Set();
  st.code = { database: db(s, 1) };
  st.running = true;
  return t;
}

describe("stop and start (DEC-0544)", () => {
  it("stop turns the app off, then records the stop; start clears the record first, then starts", async () => {
    const t = deployed();
    expect(await runStop(t, stage, captureIo())).toBe(0);
    expect(t.calls).toEqual(["stopApp notes/test-abc", "writeStageRecord notes/test-abc stopped"]);
    expect(t.answering(stage)).toBeNull();
    t.calls.length = 0;
    expect(await runStart(t, stage, captureIo())).toBe(0);
    expect(t.calls).toEqual(["writeStageRecord notes/test-abc running", "startApp notes/test-abc"]);
    expect(t.answering(stage)).toBe(db(stage, 1));
    expect(t.stageState(stage).stopped).toBe(false);
  });

  it("a stop whose record cannot be written exits 1 and says a deploy would start the app again", async () => {
    const t = deployed().fail("writeStageRecord");
    const io = captureIo();
    expect(await runStop(t, stage, io)).toBe(1);
    expect(io.err).toMatch(/the app is stopped, but a deploy would start it again/);
    expect(io.err).toMatch(/run stop again/);
  });

  it("a failed stopApp records nothing; a failed startApp leaves the stage no longer recorded as stopped", async () => {
    const a = deployed().fail("stopApp");
    expect(await runStop(a, stage, captureIo())).toBe(1);
    expect(a.calls.some((c) => c.startsWith("writeStageRecord"))).toBe(false);

    const b = deployed();
    await runStop(b, stage, captureIo());
    b.fail("startApp");
    const io = captureIo();
    expect(await runStart(b, stage, io)).toBe(1);
    expect(b.stageState(stage).stopped).toBe(false);
    expect(io.err).toMatch(/the next deploy starts it/);
  });

  it("a deploy leaves a stopped stage stopped and skips the health check; --start clears the record and starts it", async () => {
    const t = deployed();
    await runStop(t, stage, captureIo());
    t.calls.length = 0;
    const io = captureIo();
    const kept = await runDeploy(t, request(), io);
    expect(kept).toMatchObject({ status: 0, stopped: true });
    expect(t.calls).toContain("stopApp notes/test-abc");
    expect(t.calls.some((c) => c.startsWith("startApp") || c.startsWith("checkHealth") || c.startsWith("writeStageRecord"))).toBe(false);
    expect(t.answering(stage)).toBeNull();
    expect(io.out).toMatch(/leaves it stopped \(add --start to start it\)/);

    t.calls.length = 0;
    const started = await runDeploy(t, request({ start: true }), captureIo());
    expect(started.status).toBe(0);
    const order = t.calls.filter((c) => /^(writeStageRecord|startApp|checkHealth)/.test(c));
    expect(order).toEqual(["writeStageRecord notes/test-abc running", "startApp notes/test-abc", expect.stringMatching(/^checkHealth/)]);
    expect(t.answering(stage)).toBe(db(stage, 1));
  });

  it("a stopped stage whose code deploy fails after turning the route on (DEC-0091) is turned off again, and the failure says so", async () => {
    const t = deployed();
    await runStop(t, stage, captureIo());
    // The real target: `sst deploy` turns the route on, then the framework secrets fail.
    const deployCode = t.deployCode.bind(t);
    t.deployCode = async (input) => {
      await deployCode(input);
      t.stageState(stage).running = true;
      throw new Error("setting the framework secrets failed");
    };
    t.calls.length = 0;
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result.status).toBe(1);
    expect(t.answering(stage)).toBeNull();
    expect(t.calls.slice(t.calls.findIndex((c) => c.startsWith("deployCode")))).toContain("stopApp notes/test-abc");
    expect(t.calls.some((c) => c.startsWith("startApp"))).toBe(false);
    expect(result.failure?.stageState).toMatch(/turned off again, as recorded by stop/);
    expect(result.failure?.stageState).not.toMatch(/may be stopped/);
    expect(io.err).toMatch(/turned off again/);
  });

  it("a stopped stage whose re-stop fails after a failed code deploy reports that it may be answering, and how to stop it", async () => {
    const t = deployed();
    await runStop(t, stage, captureIo());
    t.fail("deployCode", new Error("sst deploy failed"), 1).fail("stopApp", new Error("route API down"));
    const result = await runDeploy(t, request(), captureIo());
    expect(result.status).toBe(1);
    expect(result.failure?.cleanupErrors.join("\n")).toMatch(/turning the app off again.*route API down/);
    expect(result.failure?.stageState).toMatch(/may be answering although the stage is recorded as stopped/);
    expect(result.failure?.nextAction).toMatch(/run stop --target fake --stage test-abc/);
  });

  it("a stopped stage stopped at the after-code abort point is turned off again", async () => {
    const t = deployed();
    await runStop(t, stage, captureIo());
    const deployCode = t.deployCode.bind(t);
    t.deployCode = async (input) => {
      const out = await deployCode(input);
      t.stageState(stage).running = true;
      return out;
    };
    const result = await runDeploy(t, request({ abortAt: "after-code" }), captureIo());
    expect(result.status).toBe(1);
    expect(t.answering(stage)).toBeNull();
    expect(result.failure?.stageState).toMatch(/turned off again, as recorded by stop/);
  });

  it("a failed migration of a stopped stage deletes the new database and leaves the previous version stopped", async () => {
    const t = deployed();
    await runStop(t, stage, captureIo());
    t.failingMigrations.set("app/0001_more", new Error("syntax error"));
    t.calls.length = 0;
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), captureIo());
    expect(result.status).toBe(1);
    expect(result.failure?.stageState).toMatch(/^previous version left stopped, as recorded by stop; database notes-test-abc-db-1 unchanged/);
    expect(t.calls.some((c) => c.startsWith("startApp"))).toBe(false);
    expect(t.databaseNames(stage)).toEqual([db(stage, 1)]);
  });

  it("a schema-changing deploy prints how the database was copied (DEC-0545)", async () => {
    const t = deployed();
    t.copyMethod = "row-by-row copy (table tree references itself)";
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result).toMatchObject({ status: 0, copyMethod: "row-by-row copy (table tree references itself)" });
    expect(io.out).toContain("copied database notes-test-abc-db-1 into notes-test-abc-db-2: row-by-row copy (table tree references itself)");
    const quiet = captureIo();
    expect((await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), quiet)).copyMethod).toBeUndefined();
    expect(quiet.out).not.toContain("copied database");
  });
});

describe("production remove: backup first (DEC-0543)", () => {
  it("backs up the stage's databases before deleting anything; a test stage has no backup", async () => {
    const t = deployed(prod);
    const io = captureIo();
    const result = await runRemove(t, prod, io);
    expect(result.status).toBe(0);
    expect(result.backup).toEqual({ location: "fake backups/notes/prod/", items: ["database notes-prod-db-1", "files"] });
    expect(t.calls.indexOf("backupStage notes/prod notes-prod-db-1")).toBeLessThan(t.calls.indexOf("dropDatabase notes-prod-db-1"));
    expect(io.out).toMatch(/backed up stage prod to fake backups\/notes\/prod\/: database notes-prod-db-1, files/);

    const u = deployed();
    expect((await runRemove(u, stage, captureIo())).backup).toBeUndefined();
    expect(u.calls.some((c) => c.startsWith("backupStage"))).toBe(false);
  });

  it("a failed backup deletes nothing and exits 1", async () => {
    const t = deployed(prod).fail("backupStage", new Error("the R2 bucket prototype-backups is missing; run setup-account --target cloudflare first"));
    const io = captureIo();
    expect(await runRemove(t, prod, io)).toEqual({ status: 1, leftovers: [] });
    expect(t.calls.some((c) => /^(dropDatabase|removeStage)/.test(c))).toBe(false);
    expect(io.err).toMatch(/the backup failed: the R2 bucket prototype-backups is missing/);
    expect(io.err).toMatch(/nothing was deleted; the stage is unchanged/);
  });
});
