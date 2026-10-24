import { describe, expect, it } from "vitest";
import { checkStageHealth, HEALTH_PATH, USER_AGENT } from "./health.js";

type Answer = Response | Error;

function stubFetch(answers: Answer[]): typeof fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (a instanceof Error) throw a;
    return a.clone();
  };
  return Object.assign(f as typeof fetch, { calls });
}

/** A clock that advances only when the check sleeps. */
function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
}

const ORIGIN = "https://notes-test-abc.example.workers.dev";
const okPreflight = async () => ({ ok: true }) as const;

describe("deploy step 7 on Cloudflare: health endpoint and storage CORS preflight (PROV-REQ-002)", () => {
  it("calls GET /api/__framework/health on the public origin with the framework's own User-Agent (DEC-0089); 204 passes", async () => {
    const f = stubFetch([new Response(null, { status: 204 })]);
    expect(await checkStageHealth({ fetch: f, publicOrigin: ORIGIN, storagePreflight: okPreflight, ...clock() })).toEqual({ ok: true });
    expect(HEALTH_PATH).toBe("/api/__framework/health");
    expect(f.calls[0]!.url).toBe(`${ORIGIN}/api/__framework/health`);
    expect(new Headers(f.calls[0]!.init.headers).get("user-agent")).toBe(USER_AGENT);
  });

  it("an error answer reports its status, error code and requestId", async () => {
    const body = JSON.stringify({ error: { code: "SEC.MISSING", message: "secret apiKey is not set", requestId: "r-1" } });
    const f = stubFetch([new Response(body, { status: 500, headers: { "content-type": "application/json" } })]);
    expect(await checkStageHealth({ fetch: f, publicOrigin: ORIGIN, storagePreflight: okPreflight, ...clock(), timeoutMs: 0 })).toEqual({
      ok: false,
      message: "health check failed: secret apiKey is not set",
      status: 500,
      code: "SEC.MISSING",
      requestId: "r-1",
    });
  });

  it("retries (bounded) while the route or a new secret is still propagating (DEC-0090, DEC-0092), then passes", async () => {
    const f = stubFetch([new TypeError("fetch failed"), new Response("error code: 1042", { status: 404 }), new Response(null, { status: 204 })]);
    const c = clock();
    expect(await checkStageHealth({ fetch: f, publicOrigin: ORIGIN, storagePreflight: okPreflight, ...c })).toEqual({ ok: true });
    expect(f.calls).toHaveLength(3);
    expect(c.now()).toBe(2000);
  });

  it("gives up after the bound (30 s by default) with the last failure", async () => {
    const f = stubFetch([new Response("error code: 1042", { status: 404 })]);
    const c = clock();
    const outcome = await checkStageHealth({ fetch: f, publicOrigin: ORIGIN, storagePreflight: okPreflight, ...c });
    expect(outcome).toEqual({ ok: false, message: "health check failed: HTTP 404: error code: 1042", status: 404 });
    expect(c.now()).toBeGreaterThanOrEqual(30_000);
    expect(c.now()).toBeLessThan(32_000);
  });

  it("after the health endpoint passes, the storage CORS preflight from the public origin must pass too", async () => {
    const f = stubFetch([new Response(null, { status: 204 })]);
    const origins: string[] = [];
    const failing = async (origin: string) => {
      origins.push(origin);
      return { ok: false as const, message: "storage CORS preflight failed: HTTP 403", status: 403 };
    };
    expect(await checkStageHealth({ fetch: f, publicOrigin: ORIGIN, storagePreflight: failing, ...clock(), timeoutMs: 0 })).toEqual({
      ok: false,
      message: "storage CORS preflight failed: HTTP 403",
      status: 403,
    });
    expect(origins).toEqual([ORIGIN]);
  });
});
