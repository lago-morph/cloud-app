/**
 * The environment of E2E-001's offline steps (root cause
 * ai/implementation/root-causes/2026-11-28-E2E-001-empty-home-hides-browsers.md): with HOME
 * replaced by an empty directory, Playwright must still find the machine's browsers, which
 * `npx playwright install` put under the real home (or PLAYWRIGHT_BROWSERS_PATH / XDG_CACHE_HOME).
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { noCredentials } from "./offline-env.js";

const REAL_HOME = "/home/runner";
const EMPTY_HOME = "/tmp/e2e-scaffold-x/home";

describe("noCredentials (E2E-001 offline environment)", () => {
  it("with HOME overridden, points Playwright at the browsers under the real home", () => {
    const env = noCredentials({ HOME: REAL_HOME, PATH: "/usr/bin" }, EMPTY_HOME);
    expect(env.HOME).toBe(EMPTY_HOME);
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(REAL_HOME, ".cache", "ms-playwright"));
    expect(env.PATH).toBe("/usr/bin");
  });

  it("with HOME overridden, follows XDG_CACHE_HOME as Playwright does on Linux", () => {
    const env = noCredentials({ HOME: REAL_HOME, XDG_CACHE_HOME: "/var/cache/runner" }, EMPTY_HOME);
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(join("/var/cache/runner", "ms-playwright"));
  });

  it("keeps a PLAYWRIGHT_BROWSERS_PATH that is already set (including Playwright's '0')", () => {
    expect(noCredentials({ HOME: REAL_HOME, PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, EMPTY_HOME).PLAYWRIGHT_BROWSERS_PATH).toBe("/opt/pw");
    expect(noCredentials({ HOME: REAL_HOME, PLAYWRIGHT_BROWSERS_PATH: "0" }, EMPTY_HOME).PLAYWRIGHT_BROWSERS_PATH).toBe("0");
  });

  it("without a HOME override, leaves HOME and PLAYWRIGHT_BROWSERS_PATH as they are", () => {
    const env = noCredentials({ HOME: REAL_HOME }, undefined);
    expect(env.HOME).toBe(REAL_HOME);
    expect(env).not.toHaveProperty("PLAYWRIGHT_BROWSERS_PATH");
  });

  it("still removes cloud credentials and compliance settings", () => {
    const env = noCredentials(
      { HOME: REAL_HOME, CLOUDFLARE_API_TOKEN: "t", CF_ACCOUNT_ID: "a", AWS_SECRET_ACCESS_KEY: "s", GOOGLE_APPLICATION_CREDENTIALS: "g", AZURE_CLIENT_SECRET: "z", SST_STAGE: "x", COMPLIANCE_TARGET: "c", KEEP: "1" },
      EMPTY_HOME,
    );
    expect(Object.keys(env).sort()).toEqual(["HOME", "KEEP", "PLAYWRIGHT_BROWSERS_PATH"]);
  });
});
