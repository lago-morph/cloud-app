import { describe, expect, it } from "vitest";
import { CREDENTIAL_NAMES, missingCredentials, sstEnvironment } from "./environment.js";

describe("Cloudflare credentials and the SST tool environment (PROV §2 'Credentials'; DEC-0107)", () => {
  it("[PROV-AC-002] preflight part: names each missing credential variable, by name only", () => {
    expect(CREDENTIAL_NAMES).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
    expect(missingCredentials({ CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "a" })).toEqual([]);
    expect(missingCredentials({ CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "a" })).toEqual(["CLOUDFLARE_API_TOKEN"]);
    expect(missingCredentials({})).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  });

  it("SST gets the token variable, the account as CLOUDFLARE_DEFAULT_ACCOUNT_ID, NODE_USE_ENV_PROXY=1, no telemetry, non-interactive; the rest of the environment is kept", () => {
    const env = sstEnvironment({ PATH: "/bin", HTTPS_PROXY: "http://proxy", CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc" });
    expect(env).toEqual({
      PATH: "/bin",
      HTTPS_PROXY: "http://proxy",
      CLOUDFLARE_API_TOKEN: "placeholder",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_DEFAULT_ACCOUNT_ID: "acc",
      NODE_USE_ENV_PROXY: "1",
      SST_TELEMETRY_DISABLED: "1",
      CI: "1",
    });
  });
});
