// The one tagged sample test the harness self-test runs. It checks a clause of COMPL-AC-003
// itself (a not-run result without a reason does not validate), and that the driver handed the
// test process its target environment.
import { describe, expect, it } from "vitest";
import { validateEvidence } from "../../../../packages/framework/src/evidence/public.js";
import { tag } from "../../../support/tags.js";
import { readTargetEnv } from "../env.js";

describe("harness self-test", () => {
  it(tag("COMPL-AC-003", "self-test: a not-run result needs a reason; the driver passed the target environment"), () => {
    const record = {
      runId: "x",
      commit: "c",
      target: "local",
      command: "c",
      startedAt: "2026-10-20T00:00:00Z",
      finishedAt: "2026-10-20T00:00:01Z",
      exitStatus: 0,
      results: [{ id: "KV-AC-001", status: "not-run" }],
      versions: {},
    };
    expect(validateEvidence(record)).toEqual(["/results/0: missing required property detail"]);
    const env = readTargetEnv();
    expect(env.target).toBe("local");
    expect(env.runId).toMatch(/^[a-z0-9]{15}$/);
  });
});
