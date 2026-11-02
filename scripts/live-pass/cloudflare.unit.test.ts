// Unit tests for the live-pass runner's paged reads (scripts/live-pass/lib/cloudflare.mjs and
// lib/server.mjs) against stubs that page the way the Cloudflare API does. The shared fake world
// (test-support/fake-world.mjs) returns every R2 object and every Workers Logs event in one answer,
// so the runner's paging was never exercised: a run's records and the shared log bucket can hold
// more than one page (1,000 objects), and a run's Workers Logs more than one query's limit.
//
// Written by the independent test author (review of 2026-11-02) from the requirements: the analyst
// downloads every record; the records hold every Workers Logs event and every prototype-logs entry.
import { describe, expect, it } from "vitest";
import { createApi, r2Store } from "./lib/cloudflare.mjs";
import { copyLogBucket, queryWorkersLogs } from "./lib/server.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ok = (result: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...extra }), { status: 200, headers: { "content-type": "application/json" } });

/** R2 object listing as the API pages it: at most per_page keys, then result_info.cursor with is_truncated. */
function pagedBucket(keys: string[]) {
  const sorted = [...keys].sort();
  return async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const m = url.pathname.match(/\/r2\/buckets\/[^/]+\/objects(?:\/(.+))?$/);
    if (!m) return new Response("no route", { status: 404 });
    if (m[1] !== undefined) return new Response(`body of ${decodeURIComponent(m[1])}`, { status: 200 });
    const perPage = Math.min(Number(url.searchParams.get("per_page") ?? 1000), 1000);
    const prefix = url.searchParams.get("prefix") ?? "";
    const start = Number(url.searchParams.get("cursor") ?? 0);
    const matching = sorted.filter((k) => k.startsWith(prefix));
    const page = matching.slice(start, start + perPage);
    const truncated = start + perPage < matching.length;
    return ok(page.map((key) => ({ key, size: 1 })), { result_info: { per_page: perPage, is_truncated: truncated, cursor: truncated ? String(start + perPage) : "" } });
  };
}

describe("R2 listings with more than one page", () => {
  it("r2Store.list (the analyst's download) returns every key under the prefix, across pages", async () => {
    const keys = Array.from({ length: 2345 }, (_, i) => `runs/lp-1/steps/${String(i).padStart(4, "0")}.json`);
    const api = createApi({ token: "t".repeat(40), accountId: ACCOUNT, fetchImpl: pagedBucket([...keys, "runs/lp-2/state.json"]) as typeof fetch });
    const listed = await r2Store(api, "live-pass-records").list("runs/lp-1/");
    expect(listed.map((o: { key: string }) => o.key)).toEqual(keys);
  });

  it("copyLogBucket copies every object of prototype-logs, across pages", async () => {
    const keys = Array.from({ length: 1500 }, (_, i) => `livepass/prodcheck/2026/11/03/${String(i).padStart(4, "0")}-error-r.json`);
    const api = createApi({ token: "t".repeat(40), accountId: ACCOUNT, fetchImpl: pagedBucket(keys) as typeof fetch });
    const copied = await copyLogBucket(api);
    expect(copied.ok).toBe(true);
    expect(copied.entries.map((e: { key: string }) => e.key)).toEqual(keys);
  });
});

describe("Workers Logs over more than one query's limit", () => {
  it("returns every event of the window exactly once when the API answers at most `limit` events per query", async () => {
    const times = Array.from({ length: 23 }, (_, i) => 1_000_000 + i * 997);
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      // The query's timeframe, half-open, and its limit (the newest events first, as the query view returns them).
      const inWindow = times.filter((t) => t >= body.timeframe.from && t < body.timeframe.to).sort((a, b) => b - a);
      return ok({ events: { events: inWindow.slice(0, body.limit).map((t) => ({ timestamp: t, $metadata: { message: `e${t}` } })) } });
    };
    const api = createApi({ token: "t".repeat(40), accountId: ACCOUNT, fetchImpl: fetchImpl as typeof fetch });
    const q = await queryWorkersLogs(api, times[0], times.at(-1)! + 1, { limit: 4 });
    expect(q.ok).toBe(true);
    expect(q.events.map((e: { timestamp: number }) => e.timestamp).sort((a: number, b: number) => a - b)).toEqual(times);
  });
});
