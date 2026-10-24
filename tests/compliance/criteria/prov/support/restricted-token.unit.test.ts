// PROV-AC-002 restricted-credential gate (DEC-0420): the proxy no longer replaces the
// Authorization header, so a supplied restricted token is used even when HTTPS_PROXY is set.
// The token is a fake value; nothing is deployed.
import { describe, expect, it } from "vitest";
import { PrerequisiteMissingError } from "../../../harness/index.js";
import { RESTRICTED_TOKEN_ENV, restrictedToken } from "./restricted-token.js";

const FAKE = "fake-restricted-token-not-a-credential";

describe("restrictedToken (DEC-0420)", () => {
  it("returns the supplied token when HTTPS_PROXY is set", () => {
    expect(restrictedToken({ HTTPS_PROXY: "http://proxy.invalid:1", [RESTRICTED_TOKEN_ENV]: FAKE })).toBe(FAKE);
  });

  it("returns the supplied token without a proxy", () => {
    expect(restrictedToken({ [RESTRICTED_TOKEN_ENV]: FAKE })).toBe(FAKE);
  });

  it("is a missing prerequisite naming the variable when no token is supplied", () => {
    for (const env of [{}, { [RESTRICTED_TOKEN_ENV]: "" }, { HTTPS_PROXY: "http://proxy.invalid:1" }]) {
      expect(() => restrictedToken(env)).toThrow(PrerequisiteMissingError);
      expect(() => restrictedToken(env)).toThrow(RESTRICTED_TOKEN_ENV);
    }
  });
});
