import { describe, expect, it } from "vitest";
import { parseTargetStage, UsageError } from "./args.js";

describe("--target / --stage options (CLI-REQ-001)", () => {
  it("reads both options in the space and = forms", () => {
    expect(parseTargetStage(["--target", "local", "--stage", "local"])).toEqual({ target: "local", stage: "local" });
    expect(parseTargetStage(["--stage=test-ab1", "--target=cloudflare"])).toEqual({ target: "cloudflare", stage: "test-ab1" });
  });

  it("refuses missing, repeated, unknown or valueless options, positionals and unknown targets", () => {
    for (const args of [
      ["--target", "local"],
      ["--stage", "local"],
      ["--target", "local", "--stage", "a", "--stage", "b"],
      ["--target", "local", "--stage", "local", "--force"],
      ["--target", "local", "--stage"],
      ["--target", "local", "--stage", "local", "extra"],
      ["--target", "aws", "--stage", "prod"],
    ]) {
      expect(() => parseTargetStage(args), args.join(" ")).toThrow(UsageError);
    }
  });

  it("never repeats an unexpected argument in its message (a mistyped secret is not printed, CLI-REQ-004)", () => {
    const value = `v-${crypto.randomUUID()}`;
    for (const args of [["--target", "local", "--stage", "local", value], ["--target", "local", "--stage", "local", `--${value}`], ["--target", value, "--stage", "x"]]) {
      try {
        parseTargetStage(args);
        expect.unreachable();
      } catch (e) {
        expect((e as Error).message).not.toContain(value);
      }
    }
  });
});
