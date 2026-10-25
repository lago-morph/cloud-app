// A Cloudflare API token refused with HTTP 401 is used for no further cloud call in the process
// (pass 3, PROV-AC-002 diagnosis): harness requests (fetchCfCall, the test hooks' cfApi), the
// framework operations of the leftover check, and the framework CLI calls. No network: fetch and
// the CLI runner are fakes, and the token values are fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cfApi } from "../criteria/_cloud/api.js";
import { cliStageOps } from "./node-deps.js";
import { fetchCfCall, NO_R2_TOKEN_PERMISSION_ENV, purposeOfToken } from "./test-tokens.js";
import { guardCliCall, guardFetch, InvalidTokenError, isRefusedToken, MAIN_TOKEN_PURPOSE, outputShowsRefusedToken, resetRefusedTokens } from "./token-guard.js";

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

  it("outputShowsRefusedToken reads only the CLI's Cloudflare API authentication failures, not an app's 401", () => {
    // provision/cloudflare/api.ts describeFailure: `HTTP <status>: <message> (code <n>)`; target.ts: the tokens/verify failure.
    expect(outputShowsRefusedToken("listing Worker scripts failed: HTTP 401: Authentication error (code 10000)")).toBe(true);
    expect(outputShowsRefusedToken("reading the D1 databases was refused: HTTP 401: Invalid access token (code 9109)")).toBe(true);
    expect(outputShowsRefusedToken("CLOUDFLARE_API_TOKEN is not usable: HTTP 401: Invalid API Token (code 1000)")).toBe(true);
    // provision/cloudflare/health.ts: the app itself answered 401; the token is fine.
    expect(outputShowsRefusedToken('health check failed: HTTP 401: {"error":{"code":"AUTH.UNAUTHENTICATED"}}')).toBe(false);
    expect(outputShowsRefusedToken("health check failed: HTTP 401: Authentication error (code 10000)")).toBe(false);
    expect(outputShowsRefusedToken("failed: HTTP 403: Authentication error (code 10000)")).toBe(false);
    expect(outputShowsRefusedToken("failed: HTTP 401: Unauthorized (code 7003)")).toBe(false);
  });

  it("framework CLI calls: a deploy whose health check got 401 from the app does not stop the token", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", FAKE);
    const ran: string[] = [];
    const ops = cliStageOps("/repo-not-read", "cloudflare", {
      run: (c) => (ran.push(c.args[1] ?? ""), Promise.resolve({ status: 1, output: "deploy: step 9: health check failed: HTTP 401: unauthorized\n" })),
      env: { CLOUDFLARE_ACCOUNT_ID: "a1" },
    });
    await expect(ops.deploy("test-abcdefghij12345")).rejects.not.toBeInstanceOf(InvalidTokenError);
    expect(isRefusedToken(FAKE)).toBe(false);
    await expect(ops.remove("test-abcdefghij12345")).rejects.toThrow("remove --target cloudflare");
    expect(ran).toEqual(["deploy", "remove"]);
  });

  it("guardCliCall (withCloudStage's CLI calls): after an API 401 the token's next call is not run, and the error names the token's purpose and keeps the output", async () => {
    const env = { CLOUDFLARE_API_TOKEN: FAKE, [NO_R2_TOKEN_PERMISSION_ENV]: OTHER };
    const purpose = purposeOfToken(OTHER, env);
    expect(purpose).toContain("PROV-AC-002");
    expect(purpose).toContain(NO_R2_TOKEN_PERMISSION_ENV);
    expect(purposeOfToken(FAKE, env)).toBe(MAIN_TOKEN_PURPOSE);
    let runs = 0;
    const refused = (): Promise<{ status: number; output: string }> => (runs++, Promise.resolve({ status: 1, output: "deploy: HTTP 401: Authentication error (code 10000)\n" }));
    const first = await guardCliCall(OTHER, purpose, "prototype-framework deploy", refused).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(InvalidTokenError);
    expect((first as InvalidTokenError).message).toContain("PROV-AC-002");
    expect((first as InvalidTokenError).message).not.toContain(OTHER);
    expect((first as InvalidTokenError).output).toContain("HTTP 401: Authentication error");
    await expect(guardCliCall(OTHER, purpose, "prototype-framework remove", refused)).rejects.toThrow("PROV-AC-002");
    expect(runs, "CLI runs with the refused token").toBe(1);
    expect(isRefusedToken(FAKE), "the main token is not stopped by another token's 401").toBe(false);
    expect((await guardCliCall(FAKE, MAIN_TOKEN_PURPOSE, "x", () => Promise.resolve({ status: 0, output: "ok" }))).output).toBe("ok");
  });
});
