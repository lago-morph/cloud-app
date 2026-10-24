// authHeader (DEC-0420): the cloud test hooks send the environment's Cloudflare token, proxy or not.
// No network: only the header is computed. The token is a fake value.
import { describe, expect, it } from "vitest";
import { authHeader } from "./api.js";

const FAKE = "fake-test-token-not-a-credential";

describe("authHeader (DEC-0420)", () => {
  it("sends Bearer CLOUDFLARE_API_TOKEN when HTTPS_PROXY is set", () => {
    expect(authHeader({ HTTPS_PROXY: "http://proxy.invalid:1", CLOUDFLARE_API_TOKEN: FAKE })).toEqual({ authorization: `Bearer ${FAKE}` });
  });

  it("sends Bearer CLOUDFLARE_API_TOKEN without a proxy", () => {
    expect(authHeader({ CLOUDFLARE_API_TOKEN: FAKE })).toEqual({ authorization: `Bearer ${FAKE}` });
  });

  it("sends no header when CLOUDFLARE_API_TOKEN is unset or empty", () => {
    expect(authHeader({ HTTPS_PROXY: "http://proxy.invalid:1" })).toEqual({});
    expect(authHeader({ CLOUDFLARE_API_TOKEN: "" })).toEqual({});
  });
});
