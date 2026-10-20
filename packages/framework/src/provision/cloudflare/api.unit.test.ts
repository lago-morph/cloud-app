import { describe, expect, it } from "vitest";
import { API_BASE, createCloudflareApi, describeFailure, resultOf, succeeded } from "./api.js";

type Call = { url: string; init: RequestInit };

function stubFetch(response: () => Response | Promise<Response>): typeof fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  };
  return Object.assign(f as typeof fetch, { calls });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the real Cloudflare API seam (DEC-0271, DEC-0107)", () => {
  it("sends the request to api.cloudflare.com/client/v4 with the token from the environment as a bearer token and a JSON body", async () => {
    const f = stubFetch(() => json(200, { success: true, result: { ok: 1 } }));
    const api = createCloudflareApi({ token: "placeholder-token", fetch: f });
    const r = await api("POST", "/accounts/a/r2/buckets", { name: "b" });
    expect(API_BASE).toBe("https://api.cloudflare.com/client/v4");
    expect(r).toEqual({ status: 200, body: { success: true, result: { ok: 1 } } });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/a/r2/buckets");
    expect(f.calls[0]!.init.method).toBe("POST");
    const headers = new Headers(f.calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer placeholder-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(f.calls[0]!.init.body).toBe('{"name":"b"}');
  });

  it("a GET has no body; a non-JSON answer is returned as text", async () => {
    const f = stubFetch(() => new Response("upstream request failed", { status: 502, headers: { "content-type": "text/plain" } }));
    const r = await createCloudflareApi({ token: "t", fetch: f })("GET", "/x");
    expect(f.calls[0]!.init.body).toBeUndefined();
    expect(r).toEqual({ status: 502, body: "upstream request failed" });
  });

  it("a request that gets no response throws a message naming the method and path, never the token", async () => {
    const f = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const error = await createCloudflareApi({ token: "sekret-token-value", fetch: f })("DELETE", "/accounts/a/tokens/1").catch((e: unknown) => e as Error);
    expect(error.message).toMatch(/DELETE \/accounts\/a\/tokens\/1.*no response.*fetch failed/);
    expect(error.message).not.toContain("sekret-token-value");
  });

  it("success means a 2xx answer with success: true; resultOf returns the result or throws naming what failed, the status and Cloudflare's first error", () => {
    expect(succeeded({ status: 200, body: { success: true } })).toBe(true);
    expect(succeeded({ status: 200, body: { success: false } })).toBe(false);
    expect(succeeded({ status: 404, body: { success: true } })).toBe(false);
    expect(resultOf({ status: 200, body: { success: true, result: [1] } }, "listing")).toEqual([1]);
    expect(() => resultOf({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }, "listing tokens")).toThrow(
      "listing tokens failed: HTTP 403: Authentication error (code 10000)",
    );
    expect(describeFailure({ status: 502, body: "upstream request failed" })).toBe("HTTP 502: upstream request failed");
    expect(describeFailure({ status: 500, body: null })).toBe("HTTP 500: no error detail");
  });
});
