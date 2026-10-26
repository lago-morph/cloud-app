import { describe, expect, it } from "vitest";
import { FakeTarget } from "../../provision/core/fake-target.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { removeCommand, type RemoveDeps } from "./remove.js";

const STAGE = { app: "notes", stage: "test-abc" };

/** A fake account holding one deployed test stage and one other stage. */
function deployed(): FakeTarget {
  const fake = new FakeTarget({ databases: [{ name: "notes-test-abc-db-1" }, { name: "notes-test-other-db-1" }] });
  fake.stageState(STAGE).resources.push({ kind: "Worker", id: "notes-test-abc" });
  fake.stageState({ app: "notes", stage: "test-other" }).resources.push({ kind: "Worker", id: "notes-test-other" });
  return fake;
}

function harness(fake: FakeTarget = deployed(), env: Record<string, string> = {}) {
  const events: string[] = [];
  const deps: RemoveDeps = {
    env,
    appName: async (appDir) => (events.push(`appName ${appDir}`), "notes"),
    operations: (input) => (events.push(`operations ${input.target}`), fake),
    forgetDeployOutput: (appDir, target, stage) => void events.push(`forget ${appDir} ${target} ${stage}`),
  };
  return { deps, events, fake };
}

describe("remove (CLI-REQ-001, PROV-REQ-003, CLI-REQ-003)", () => {
  it("removes the named test stage through the PROV core and forgets its recorded deploy output", async () => {
    const h = harness();
    const io = captureIo("/apps/notes");
    expect(await removeCommand(h.deps)(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(0);
    expect(io.out).toContain("deleted database notes-test-abc-db-1");
    expect(io.out).toContain("removed stage test-abc");
    expect(h.fake.databaseNames(STAGE)).toEqual([]);
    expect(h.fake.databaseNames({ app: "notes", stage: "test-other" })).toEqual(["notes-test-other-db-1"]);
    expect(h.fake.stageState({ app: "notes", stage: "test-other" }).resources).toEqual([{ kind: "Worker", id: "notes-test-other" }]);
    expect(h.events).toContain("forget /apps/notes cloudflare test-abc");
  });

  it("[CLI-AC-003] leftovers exit 1, are printed by name, and keep the recorded deploy output", async () => {
    const fake = deployed();
    fake.undeletable.add("notes-test-abc");
    const h = harness(fake);
    const io = captureIo();
    expect(await removeCommand(h.deps)(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(1);
    expect(io.err).toContain("leftover: Worker notes-test-abc");
    expect(h.events.some((e) => e.startsWith("forget"))).toBe(false);
  });

  it("refuses a production stage unless --confirm-production repeats its name, before anything is touched", async () => {
    const h = harness();
    await expect(removeCommand(h.deps)(["--target", "cloudflare", "--stage", "prod"], captureIo())).rejects.toThrow(/only test stages.*--confirm-production prod/);
    await expect(removeCommand(h.deps)(["--target", "cloudflare", "--stage", "prod", "--confirm-production", "prodx"], captureIo())).rejects.toThrow(UsageError);
    expect(h.events).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });

  it("removes a production stage when --confirm-production names it", async () => {
    const h = harness();
    const io = captureIo();
    expect(await removeCommand(h.deps)(["--target", "cloudflare", "--stage", "prod", "--confirm-production", "prod"], io)).toBe(0);
    expect(h.fake.calls).toContain("removeStage notes/prod");
  });

  it("--confirm-production is refused for a test stage (it is never needed there)", async () => {
    await expect(removeCommand(harness().deps)(["--target", "cloudflare", "--stage", "test-abc", "--confirm-production", "test-abc"], captureIo())).rejects.toThrow(UsageError);
  });

  it("is refused for target local, and for an invalid stage name, before anything is touched", async () => {
    const h = harness();
    await expect(removeCommand(h.deps)(["--target", "local", "--stage", "local"], captureIo())).rejects.toThrow(UsageError);
    await expect(removeCommand(h.deps)(["--target", "cloudflare", "--stage", "test-ABC"], captureIo())).rejects.toThrow(UsageError);
    expect(h.events).toEqual([]);
  });

  it("stops with status 1 when the process cannot use the proxy", async () => {
    const h = harness(deployed(), { HTTPS_PROXY: "http://proxy:1" });
    const io = captureIo();
    expect(await removeCommand(h.deps)(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(h.fake.calls).toEqual([]);
  });
});
