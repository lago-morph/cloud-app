import { describe, expect, it } from "vitest";
import { FakeTarget } from "../../../packages/framework/src/provision/core/fake-target.js";
import { stageLeftovers } from "./leftovers.js";

const stage = { app: "reference", stage: "test-abcdefghij12345" };

describe("[COMPL-AC-004] leftover check through listStageResources", () => {
  it("lists the stage's databases by the exact pattern and every resource by exact identifier, R2 API token included", async () => {
    const t = new FakeTarget({
      databases: [{ name: "reference-test-abcdefghij12345-db-1" }, { name: "reference-test-abcdefghij12345x-db-1" }, { name: "reference-prodcheck-db-1" }],
    });
    t.stages.set("reference/test-abcdefghij12345", {
      resources: [
        { kind: "R2 API token", id: "tok-123" },
        { kind: "Worker", id: "reference-test-abcdefghij12345" },
      ],
      secrets: null,
      code: null,
      running: false,
    });
    expect(await stageLeftovers(t, stage)).toEqual(["database reference-test-abcdefghij12345-db-1", "R2 API token tok-123", "Worker reference-test-abcdefghij12345"]);
    expect(t.calls).toEqual(["listStageResources reference/test-abcdefghij12345"]);
  });

  it("is empty for a removed stage, and refuses a stage that is not a test stage (prodcheck is never checked or cleaned)", async () => {
    expect(await stageLeftovers(new FakeTarget(), stage)).toEqual([]);
    await expect(stageLeftovers(new FakeTarget(), { app: "reference", stage: "prodcheck" })).rejects.toThrow(/test-/);
  });
});
