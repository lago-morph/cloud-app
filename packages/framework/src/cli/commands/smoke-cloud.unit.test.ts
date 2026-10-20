import { describe, expect, it } from "vitest";
import { captureIo } from "../io.test-support.js";
import { cloudProcessProblems, withCloudProcessCheck } from "./smoke-cloud.js";

describe("cloud commands' process environment (DEC-0085, DEC-0107)", () => {
  it("behind a proxy, a process without NODE_USE_ENV_PROXY=1 is named as the problem", () => {
    expect(cloudProcessProblems({ HTTPS_PROXY: "http://proxy:1" })).toEqual([expect.stringContaining("NODE_USE_ENV_PROXY=1")]);
    expect(cloudProcessProblems({ https_proxy: "http://proxy:1", NODE_USE_ENV_PROXY: "0" })).toHaveLength(1);
  });

  it("with NODE_USE_ENV_PROXY=1, or with no proxy at all (an owner machine), there is no problem", () => {
    expect(cloudProcessProblems({ HTTPS_PROXY: "http://proxy:1", NODE_USE_ENV_PROXY: "1" })).toEqual([]);
    expect(cloudProcessProblems({})).toEqual([]);
  });

  it("[CLI-AC-005] smoke against a cloud stage stops with status 1 before any request when the process cannot use the proxy", async () => {
    let ran = false;
    const smoke = withCloudProcessCheck(async () => ((ran = true), 0), { HTTPS_PROXY: "http://proxy:1" });
    const io = captureIo();
    expect(await smoke(["--target", "cloudflare", "--stage", "test-abc"], io)).toBe(1);
    expect(ran).toBe(false);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
  });

  it("[CLI-AC-005] smoke --target local is passed through unchanged", async () => {
    let ran = false;
    const smoke = withCloudProcessCheck(async () => ((ran = true), 0), { HTTPS_PROXY: "http://proxy:1" });
    expect(await smoke(["--target", "local"], captureIo())).toBe(0);
    expect(await smoke(["--target=local"], captureIo())).toBe(0);
    expect(ran).toBe(true);
  });
});
