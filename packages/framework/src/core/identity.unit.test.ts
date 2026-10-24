import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "./errors.js";
import { appIdentity, createDeployment } from "./identity.js";

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected a FrameworkError");
}

describe("createDeployment: app-name rule (PAR-290)", () => {
  it("accepts lowercase letters and digits up to 20 characters", () => {
    expect(createDeployment({ app: "notes2", stage: "dev", target: "local" }).app).toBe("notes2");
    expect(createDeployment({ app: "a".repeat(20), stage: "dev", target: "local" }).app).toBe("a".repeat(20));
  });

  it(tag("CORE-AC-007", "an app name with a hyphen fails with a message naming the app-name rule"), () => {
    const err = failure(() => createDeployment({ app: "my-notes", stage: "dev", target: "local" }));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain('"my-notes"');
    expect(err.message).toContain("app-name rule");
    expect(err.message).toContain("lowercase letters and digits only, no hyphens");
  });

  it.each([
    ["uppercase", "Notes"],
    ["underscore", "my_notes"],
    ["empty", ""],
    ["21 characters", "a".repeat(21)],
  ])("rejects an app name with %s", (_label, app) => {
    expect(failure(() => createDeployment({ app, stage: "dev", target: "local" })).message).toContain("app-name rule");
  });
});

describe("createDeployment: stage-name rule (PAR-291)", () => {
  it("accepts lowercase letters, digits and hyphens up to 20 characters", () => {
    expect(createDeployment({ app: "notes", stage: "test-ci-1", target: "local" }).stage).toBe("test-ci-1");
    expect(createDeployment({ app: "notes", stage: "s".repeat(20), target: "local" }).stage).toBe("s".repeat(20));
  });

  it.each([
    ["uppercase", "Dev"],
    ["underscore", "my_stage"],
    ["a dot", "dev.1"],
    ["empty", ""],
    ["21 characters", "s".repeat(21)],
  ])("rejects a stage name with %s, naming the stage-name rule", (_label, stage) => {
    const err = failure(() => createDeployment({ app: "notes", stage, target: "local" }));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain("stage-name rule");
    expect(err.message).toContain("lowercase letters, digits, and hyphens");
  });
});

describe("createDeployment: test-stage flag", () => {
  it.each([
    ["test-ci", true],
    ["test-", true],
    ["test", false],
    ["dev", false],
    ["mytest-1", false],
    ["prod", false],
  ])("stage %s gives isTestStage %s", (stage, expected) => {
    expect(createDeployment({ app: "notes", stage, target: "cloudflare" }).isTestStage).toBe(expected);
  });

  it("keeps the target and does not accept a test-stage flag from the caller", () => {
    const input = { app: "notes", stage: "dev", target: "cloudflare", isTestStage: true } as const;
    const d = createDeployment(input);
    expect(d).toEqual({ app: "notes", stage: "dev", target: "cloudflare", isTestStage: false });
    expect(Object.isFrozen(d)).toBe(true);
  });
});

describe("appIdentity", () => {
  it(tag("CORE-AC-003", "the app-facing identity has exactly the members app and stage"), () => {
    const identity = appIdentity(createDeployment({ app: "notes", stage: "test-a", target: "cloudflare" }));
    expect(Object.keys(identity).sort()).toEqual(["app", "stage"]);
    expect(identity).toEqual({ app: "notes", stage: "test-a" });
    expect(Object.isFrozen(identity)).toBe(true);
  });
});
