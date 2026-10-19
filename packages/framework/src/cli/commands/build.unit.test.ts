import { describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { buildCommand } from "./build.js";

describe("build --target <t> --stage <s> (CLI-REQ-001)", () => {
  it("builds the app in the working directory for the target and stage and says where", async () => {
    const calls: unknown[] = [];
    const io = captureIo("/apps/one");
    const build = buildCommand({
      buildApp: async (options) => {
        calls.push(options);
        return { outDir: "/apps/one/.framework/cloudflare", deployment: { app: "one", stage: "test-x" } };
      },
    });
    expect(await build(["--target", "cloudflare", "--stage", "test-x"], io)).toBe(0);
    expect(calls).toEqual([{ appDir: "/apps/one", target: "cloudflare", stage: "test-x" }]);
    expect(io.out).toContain(".framework/cloudflare");
  });

  it("refuses incomplete options without building", async () => {
    let built = false;
    const build = buildCommand({
      buildApp: async () => {
        built = true;
        return { outDir: "", deployment: { app: "", stage: "" } };
      },
    });
    await expect(build(["--target", "local"], captureIo())).rejects.toThrow(UsageError);
    expect(built).toBe(false);
  });
});
