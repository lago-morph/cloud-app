import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { FakeTarget } from "./fake-target.js";
import { runRemove } from "./remove.js";

const one = { app: "notes", stage: "test-one" };
const two = { app: "notes", stage: "test-onex" };

function twoStages(): FakeTarget {
  const t = new FakeTarget({
    sharedResources: { "log bucket": "owned" },
    databases: [{ name: "notes-test-one-db-3" }, { name: "notes-test-one-db-4" }, { name: "notes-test-onex-db-1" }, { name: "notes-test-one-db-x" }],
  });
  for (const s of [one, two]) {
    const st = t.stageState(s);
    st.resources.push({ kind: "bucket", id: `${s.stage}-files` }, { kind: "runtime", id: `${s.stage}-worker` });
    st.secrets = new Set(["apiKey"]);
    st.code = { database: `notes-${s.stage}-db-1` };
    st.running = true;
  }
  return t;
}

describe("remove core (PROV-REQ-003)", () => {
  it("deletes the stage's databases by the exact pattern and the rest through the target; other stages and shared resources stay", async () => {
    const t = twoStages();
    const io = captureIo();
    expect(await runRemove(t, one, io)).toEqual({ status: 0, leftovers: [] });
    expect(t.calls.filter((c) => c.startsWith("dropDatabase"))).toEqual(["dropDatabase notes-test-one-db-3", "dropDatabase notes-test-one-db-4"]);
    expect([...t.databases.keys()].sort()).toEqual(["notes-test-one-db-x", "notes-test-onex-db-1"]);
    expect(t.calls).toContain("removeStage notes/test-one");
    expect(t.stageState(one).resources).toEqual([]);
    expect(t.stageState(two).resources).toHaveLength(2);
    expect(t.shared.get("log bucket")).toBe("owned");
    expect(t.calls.some((c) => c.startsWith("createSharedResources"))).toBe(false);
    expect(io.out).toMatch(/removed stage test-one/);
  });

  it("[CLI-AC-003] prints each leftover by name and exits non-zero when something cannot be deleted", async () => {
    const t = twoStages();
    t.undeletable.add("test-one-files");
    t.fail("dropDatabase", new Error("in use"), 1);
    const io = captureIo();
    const result = await runRemove(t, one, io);
    expect(result.status).toBe(1);
    expect(result.leftovers).toEqual(["database notes-test-one-db-3", "bucket test-one-files"]);
    expect(io.err).toContain("in use");
    expect(io.err).toContain("leftover: database notes-test-one-db-3");
    expect(io.err).toContain("leftover: bucket test-one-files");
    expect(t.calls).toContain("removeStage notes/test-one");
  });

  it("[CLI-AC-003] a failing leftover listing during cleanup keeps the original failure and its non-zero status", async () => {
    const t = twoStages();
    t.fail("removeStage", new Error("provisioning tool removal failed"));
    // The first listing (to find the databases) works; the final leftover listing fails.
    let listings = 0;
    const list = t.listStageResources.bind(t);
    t.listStageResources = async (s) => {
      listings += 1;
      if (listings > 1) throw new Error("listing refused");
      return list(s);
    };
    const io = captureIo();
    const result = await runRemove(t, one, io);
    expect(result.status).toBe(1);
    const err = io.err;
    expect(err.indexOf("provisioning tool removal failed")).toBeGreaterThanOrEqual(0);
    expect(err.indexOf("provisioning tool removal failed")).toBeLessThan(err.indexOf("listing refused"));
    expect(err).toMatch(/leftovers could not be listed/);
  });

  it("unregisters the stage through the target's optional hook before it deletes anything; a failed unregister is reported and the rest is still removed (DEC-0725, DEC-0730)", async () => {
    for (const failing of [false, true]) {
      const t = twoStages();
      const hooked = Object.assign(t, {
        unregisterStage: async (s: typeof one) => {
          t.calls.push(`unregisterStage ${s.app}/${s.stage}`);
          if (failing) throw new Error("the registry could not be reached");
        },
      });
      const io = captureIo();
      const result = await runRemove(hooked, one, io);
      const at = (prefix: string) => t.calls.findIndex((c) => c.startsWith(prefix));
      expect(t.calls.filter((c) => c.startsWith("unregisterStage"))).toEqual(["unregisterStage notes/test-one"]);
      expect(at("unregisterStage"), t.calls.join("\n")).toBeLessThan(at("dropDatabase"));
      expect(at("dropDatabase")).toBeLessThan(at("removeStage"));
      expect([...t.databases.keys()].sort(), "the databases are still deleted").toEqual(["notes-test-one-db-x", "notes-test-onex-db-1"]);
      expect(t.stageState(one).resources).toEqual([]);
      expect(result.status).toBe(failing ? 1 : 0);
      if (failing) expect(io.err).toMatch(/clearing the stage's sign-in registration failed: the registry could not be reached/);
    }
  });

  it("a stage with nothing deployed removes cleanly", async () => {
    const t = new FakeTarget();
    expect((await runRemove(t, { app: "notes", stage: "test-none" }, captureIo())).status).toBe(0);
  });
});
