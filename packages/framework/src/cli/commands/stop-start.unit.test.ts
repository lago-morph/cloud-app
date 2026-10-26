import { describe, expect, it } from "vitest";
import type { Migration } from "../../mig/history.js";
import { FakeTarget } from "../../provision/core/fake-target.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { deployCommand } from "./deploy.js";
import { startCommand, stopCommand, type StopStartDeps } from "./stop-start.js";

const STAGE = { app: "notes", stage: "prod" };
const ARGS = ["--target", "cloudflare", "--stage", "prod"];
const migration = (id: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `/apps/notes/migrations/sqlite/${id}.sql`, text: "", checksum: "0", statements: [] });

function harness(env: Record<string, string> = {}) {
  const fake = new FakeTarget({ databases: [{ name: "notes-prod-db-1", records: ["app/0000_init"] }] });
  const s = fake.stageState(STAGE);
  s.resources.push({ kind: "Worker", id: "notes-prod" });
  s.secrets = new Set();
  s.code = { database: "notes-prod-db-1" };
  s.running = true;
  const events: string[] = [];
  const deps: StopStartDeps = {
    env,
    appName: async (appDir) => (events.push(`appName ${appDir}`), "notes"),
    operations: (input) => (events.push(`operations ${input.target}`), fake as TargetOperations),
  };
  return { fake, deps, events };
}

describe("stop and start (CLI-REQ-001; DEC-0544)", () => {
  it("stop stops a production stage without a confirmation and records it; start starts it again", async () => {
    const h = harness();
    const io = captureIo("/apps/notes");
    expect(await stopCommand(h.deps)(ARGS, io)).toBe(0);
    expect(h.events).toEqual(["appName /apps/notes", "operations cloudflare"]);
    expect(h.fake.answering(STAGE)).toBeNull();
    expect(h.fake.stageState(STAGE).stopped).toBe(true);
    expect(io.out).toMatch(/stopped notes stage prod on fake/);

    expect(await startCommand(h.deps)(ARGS, captureIo())).toBe(0);
    expect(h.fake.answering(STAGE)).toBe("notes-prod-db-1");
    expect(h.fake.stageState(STAGE).stopped).toBe(false);
  });

  it("refuses target local, a missing or invalid stage and unknown options with a usage error, before anything is loaded", async () => {
    const h = harness();
    await expect(stopCommand(h.deps)(["--target", "local", "--stage", "local"], captureIo())).rejects.toThrow(/stop works on cloud targets/);
    await expect(startCommand(h.deps)(["--target", "cloudflare"], captureIo())).rejects.toThrow(/--stage is missing/);
    await expect(stopCommand(h.deps)(["--target", "cloudflare", "--stage", "Bad_Stage"], captureIo())).rejects.toThrow(UsageError);
    await expect(stopCommand(h.deps)([...ARGS, "--start"], captureIo())).rejects.toThrow(UsageError);
    expect(h.events).toEqual([]);
  });

  it("exits 1 before any request when the process cannot use the HTTPS proxy", async () => {
    const h = harness({ HTTPS_PROXY: "http://proxy:1" });
    const io = captureIo();
    expect(await stopCommand(h.deps)(ARGS, io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.fake.calls).toEqual([]);
  });

  it("[CLI-AC-003] a failure exits 1", async () => {
    const h = harness();
    h.fake.fail("stopApp", new Error("HTTP 500"));
    expect(await stopCommand(h.deps)(ARGS, captureIo())).toBe(1);
  });

  it("deploy leaves a stopped stage stopped; deploy --start starts it", async () => {
    const h = harness();
    await stopCommand(h.deps)(ARGS, captureIo());
    const deployDeps = {
      env: {},
      prepare: async () => ({ app: "notes", migrations: { framework: [], app: [migration("app/0000_init")] }, requiredSecrets: [], code: {} }),
      operations: () => h.fake as TargetOperations,
      recordDeployOutput: () => undefined,
    };
    expect(await deployCommand(deployDeps)(ARGS, captureIo())).toBe(0);
    expect(h.fake.answering(STAGE)).toBeNull();
    expect(await deployCommand(deployDeps)([...ARGS, "--start"], captureIo())).toBe(0);
    expect(h.fake.answering(STAGE)).toBe("notes-prod-db-1");
    expect(h.fake.stageState(STAGE).stopped).toBe(false);
  });
});
