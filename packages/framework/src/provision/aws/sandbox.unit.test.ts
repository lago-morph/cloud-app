// DEC-0507: the sandbox-limits setting (PROTOTYPE_AWS_SANDBOX) and its region guard. No AWS request.
import { describe, expect, it } from "vitest";
import { AWS_SANDBOX_ENV, awsSandbox, SANDBOX_REGIONS, sandboxRegionProblem } from "./sandbox.js";

describe("AWS sandbox limits (PROTOTYPE_AWS_SANDBOX)", () => {
  it("is off unless the variable is set; pluralsight is the one known sandbox; anything else is refused", () => {
    expect(AWS_SANDBOX_ENV).toBe("PROTOTYPE_AWS_SANDBOX");
    expect(awsSandbox({})).toBeUndefined();
    expect(awsSandbox({ PROTOTYPE_AWS_SANDBOX: "" })).toBeUndefined();
    expect(awsSandbox({ PROTOTYPE_AWS_SANDBOX: "pluralsight" })).toBe("pluralsight");
    expect(() => awsSandbox({ PROTOTYPE_AWS_SANDBOX: "Pluralsight" })).toThrow(/PROTOTYPE_AWS_SANDBOX=Pluralsight is not a known sandbox \(known: pluralsight\)/);
  });

  it("allows only us-east-1 and us-west-2 in the Pluralsight sandbox, and every region when off", () => {
    expect(SANDBOX_REGIONS.pluralsight).toEqual(["us-east-1", "us-west-2"]);
    const on = { PROTOTYPE_AWS_SANDBOX: "pluralsight" };
    expect(sandboxRegionProblem(on, "us-east-1")).toBeUndefined();
    expect(sandboxRegionProblem(on, "us-west-2")).toBeUndefined();
    for (const region of ["us-east-2", "us-west-1", "eu-west-1", "ap-southeast-2"]) {
      expect(sandboxRegionProblem(on, region)).toMatch(new RegExp(`^region ${region} is not allowed in the pluralsight sandbox \\(PROTOTYPE_AWS_SANDBOX=pluralsight\\): only us-east-1, us-west-2`));
    }
    expect(sandboxRegionProblem({}, "eu-west-1")).toBeUndefined();
  });
});
