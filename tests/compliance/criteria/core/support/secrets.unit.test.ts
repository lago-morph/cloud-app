/**
 * `expectSecretMissing` against a local fake stage whose secret deletion reaches requests only
 * after a lag (root cause ai/implementation/root-causes/2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early.md,
 * "Red test"). This shows the wait, not Cloudflare's rollout delay (DEC-0092). No cloud call.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, createClient } from "../../../harness/index.js";
import { catalogueStatus } from "./repo.js";
import { expectSecretMissing } from "./secrets.js";

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; elapsed: () => number } {
  let t = 0;
  return { now: () => t, sleep: (ms) => ((t += ms), Promise.resolve()), elapsed: () => t };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const missing = (): Response => json(catalogueStatus("SEC.MISSING"), { error: { code: "SEC.MISSING", message: "secret apiKey has no value", requestId: randomUUID() } });

/**
 * A stage whose deletion is already answered but whose first `lag` requests are still served by
 * the previous version (200 with the value's hash), as in pass 2's trace; then `after()`.
 */
function laggingStage(lag: number, after: () => Response = missing): { fetch: typeof fetch; requests: string[] } {
  const requests: string[] = [];
  const fakeFetch = (input: string | URL | Request): Promise<Response> => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    requests.push(path);
    return Promise.resolve(requests.length <= lag ? json(200, { sha256: "0".repeat(64) }) : after());
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

describe("expectSecretMissing after a deleted secret", () => {
  it("bounds its wait by the secret rollout (DEC-0092)", () => {
    expect(CLOUD_WAITS.secretRolloutMs).toBe(60_000);
  });

  it("passes when the stage still serves the previous value for 2 requests after the delete", async () => {
    const stage = laggingStage(2);
    const clock = fakeClock();
    await expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), clock);
    // Two stale reads, the read that saw SEC.MISSING, then the unchanged assertions on fresh requests.
    expect(stage.requests).toEqual(["/api/ref/secret", "/api/ref/secret", "/api/ref/secret", "/api/ref/secret", "/api/errors/SEC.MISSING"]);
    expect(clock.elapsed()).toBe(4_000);
  });

  it("passes at once when the deletion already reached the stage", async () => {
    const stage = laggingStage(0);
    const clock = fakeClock();
    await expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), clock);
    expect(clock.elapsed()).toBe(0);
  });

  it("fails at the bound when the stage keeps serving the value", async () => {
    const stage = laggingStage(Number.POSITIVE_INFINITY);
    const clock = fakeClock();
    await expect(expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), clock)).rejects.toThrow(/timed out after 60 s waiting for the stage answering SEC\.MISSING/);
    expect(clock.elapsed()).toBe(CLOUD_WAITS.secretRolloutMs);
  });

  it.each([
    ["another error code", () => json(500, { error: { code: "SEC.UNDECLARED", message: "x", requestId: randomUUID() } })],
    ["SEC.MISSING's code with another status", () => json(503, { error: { code: "SEC.MISSING", message: "x", requestId: randomUUID() } })],
    ["a 500 without a body code", () => new Response("Internal Server Error", { status: 500 })],
    ["an empty value (200)", () => json(200, { sha256: "" })],
  ])("never accepts anything other than SEC.MISSING: %s keeps it waiting until the bound", async (_label, after) => {
    const stage = laggingStage(0, after);
    const clock = fakeClock();
    await expect(expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), clock)).rejects.toThrow(/timed out after 60 s/);
    expect(stage.requests.every((p) => p === "/api/ref/secret"), "no assertion request is made before SEC.MISSING was seen").toBe(true);
  });

  it("still makes every assertion after the wait: a SEC.MISSING without a request ID fails", async () => {
    const stage = laggingStage(0, () => json(catalogueStatus("SEC.MISSING"), { error: { code: "SEC.MISSING", message: "x", requestId: "" } }));
    await expect(expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), fakeClock())).rejects.toThrow(/\/api\/ref\/secret/);
  });

  it("still makes every assertion after the wait: a repeated request ID fails", async () => {
    const id = randomUUID();
    const stage = laggingStage(0, () => json(catalogueStatus("SEC.MISSING"), { error: { code: "SEC.MISSING", message: "x", requestId: id } }));
    await expect(expectSecretMissing(createClient({ baseUrl: "https://stage.test", fetch: stage.fetch }), fakeClock())).rejects.toThrow(/each response has its own request ID/);
  });
});
