import { describe, expect, it } from "vitest";
import { browserOptions, childEnv, ENV, readTargetEnv } from "./env.js";

describe("target environment shared by the driver and the tests", () => {
  it("reads target, stage, base URL and run ID that the driver set", () => {
    const env = { [ENV.target]: "cloudflare", [ENV.stage]: "test-abc", [ENV.baseUrl]: "https://w.x.workers.dev", [ENV.runId]: "abc" };
    expect(readTargetEnv(env)).toEqual({ target: "cloudflare", stage: "test-abc", baseUrl: "https://w.x.workers.dev", runId: "abc" });
  });

  it("defaults to local and explains a missing base URL when a test needs it", () => {
    const t = readTargetEnv({});
    expect(t.target).toBe("local");
    expect(() => t.baseUrl).toThrow(/COMPLIANCE_BASE_URL is not set: run the tests through `npm run compliance -- --target <t>`/);
  });

  it("refuses an unknown target", () => {
    expect(() => readTargetEnv({ [ENV.target]: "gcp" })).toThrow(/COMPLIANCE_TARGET/);
  });

  it("builds the child environment: NODE_USE_ENV_PROXY=1 for cloud targets only (DEC-0085)", () => {
    const base = { PATH: "/bin" };
    expect(childEnv(base, { target: "local", baseUrl: "http://localhost:1", runId: "r" })).toEqual({ PATH: "/bin", [ENV.target]: "local", [ENV.baseUrl]: "http://localhost:1", [ENV.runId]: "r" });
    expect(childEnv(base, { target: "cloudflare", stage: "test-r", baseUrl: "https://w", runId: "r" })).toMatchObject({ NODE_USE_ENV_PROXY: "1", [ENV.stage]: "test-r" });
  });

  it("gives Playwright the base URL and the explicit User-Agent", () => {
    expect(browserOptions({ [ENV.baseUrl]: "http://localhost:2" })).toEqual({ baseURL: "http://localhost:2", userAgent: expect.stringMatching(/prototype-framework-compliance/) as unknown });
    expect(browserOptions({})).toEqual({ userAgent: expect.any(String) as unknown });
  });
});
