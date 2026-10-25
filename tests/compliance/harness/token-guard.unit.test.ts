// A Cloudflare API token refused with HTTP 401 is used for no further cloud call in the process
// (pass 3, PROV-AC-002 diagnosis): harness requests (fetchCfCall, the test hooks' cfApi), the
// framework operations of the leftover check, and the framework CLI calls. No network: fetch and
// the CLI runner are fakes, and the token values are fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cfApi } from "../criteria/_cloud/api.js";
import { cliStageOps } from "./node-deps.js";
import { fetchCfCall } from "./test-tokens.js";
import { guardFetch, InvalidTokenError, isRefusedToken, MAIN_TOKEN_PURPOSE, outputShowsRefusedToken, resetRefusedTokens } from "./token-guard.js";

const FAKE = "fake-main-token-not-a-credential";
const OTHER = "fake-other-token-not-a-credential";

function countingFetch(status: number): { fetch: typeof fetch; calls: () => number } {
  let n = 0;
  const f = (() => {
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ success: status === 200, errors: status === 200 ? [] : [{ code: 10000, message: "Authentication error" }], result: [] }), { status }));
  }) as typeof fetch;
  return { fetch: f, calls: () => n };
}

afterEach(() => {
  resetRefusedTokens();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a Cloudflare API token refused with HTTP 401", () => {
  it("fetchCfCall: the 401 is an error naming the token's purpose (not its value), and the token is sent no further request", async () => {
    const api = countingFetch(401);
    const call = fetchCfCall({ CLOUDFLARE_API_TOKEN: FAKE }, api.fetch);
    const first = await call("GET", "/accounts/a1/tokens").catch((e: unknown) => e);
    expect(first).toBeInstanceOf(InvalidTokenError);
    expect((first as Error).message).toContain(MAIN_TOKEN_PURPOSE);
    expect((first as Error).message).not.toContain(FAKE);
    expect(isRefusedToken(FAKE)).toBe(true);
    await expect(call("DELETE", "/accounts/a1/tokens/t1")).rejects.toThrow(MAIN_TOKEN_PURPOSE);
    await expect(fetchCfCall({ CLOUDFLARE_API_TOKEN: FAKE }, api.fetch)("GET", "/accounts/a1/subscriptions")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(api.calls(), "requests sent after the 401").toBe(1);
  });

  it("another token is not stopped, and other statuses stop nothing", async () => {
    await fetchCfCall({ CLOUDFLARE_API_TOKEN: FAKE }, countingFetch(401).fetch)("GET", "/x").catch(() => undefined);
    const ok = countingFetch(403);
    const call = fetchCfCall({ CLOUDFLARE_API_TOKEN: OTHER }, ok.fetch);
    expect((await call("GET", "/x")).status).toBe(403);
    expect((await call("GET", "/x")).status).toBe(403);
    expect(ok.calls()).toBe(2);
    expect(isRefusedToken(OTHER)).toBe(false);
  });

  it("guardFetch stops only Cloudflare API requests with the token", async () => {
    const api = countingFetch(401);
    const guarded = guardFetch(api.fetch, FAKE, "the test hook's token");
    await expect(guarded("https://api.cloudflare.com/client/v4/accounts/a1/workers/scripts")).rejects.toThrow("the test hook's token");
    await expect(guarded("https://api.cloudflare.com/client/v4/accounts/a1/r2/buckets")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(api.calls()).toBe(1);
    const other = countingFetch(401);
    expect((await guardFetch(other.fetch, FAKE, "x")("https://reference-test.example.workers.dev/api/health")).status).toBe(401);
  });

  it("the test hooks' cfApi: a 401 stops further requests with CLOUDFLARE_API_TOKEN in the process", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", FAKE);
    const api = countingFetch(401);
    vi.stubGlobal("fetch", api.fetch);
    await expect(cfApi("GET", "/accounts/a1/r2/buckets")).rejects.toThrow(MAIN_TOKEN_PURPOSE);
    await expect(cfApi("DELETE", "/accounts/a1/r2/buckets/b")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(api.calls()).toBe(1);
  });

  it("framework CLI calls: once one shows HTTP 401, the CLI is not run again with the token, and the error names its purpose", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", FAKE);
    const ran: string[] = [];
    const ops = cliStageOps("/repo-not-read", "cloudflare", {
      run: (c) => (ran.push(c.args[1] ?? ""), Promise.resolve({ status: 1, output: "remove: listing Worker scripts failed: HTTP 401: Authentication error (code 10000)\n" })),
      env: { CLOUDFLARE_ACCOUNT_ID: "a1" },
    });
    const first = await ops.remove("test-abcdefghij12345").catch((e: unknown) => e);
    expect(first).toBeInstanceOf(InvalidTokenError);
    expect((first as Error).message).toContain(MAIN_TOKEN_PURPOSE);
    expect((first as Error).message).not.toContain(FAKE);
    await expect(ops.remove("test-bbbbbbbbbbbbbbb")).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(ops.deploy("test-ccccccccccccccc")).rejects.toBeInstanceOf(InvalidTokenError);
    expect(ran).toEqual(["remove"]);
  });

  it("outputShowsRefusedToken reads the framework's HTTP 401 form only", () => {
    expect(outputShowsRefusedToken("failed: HTTP 401: Authentication error (code 10000)")).toBe(true);
    expect(outputShowsRefusedToken("failed: HTTP 403: forbidden")).toBe(false);
    expect(outputShowsRefusedToken("HTTP 4010")).toBe(false);
  });
});
