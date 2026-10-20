/**
 * The fake D1 HTTP API used by D-04's tests: local D1 (Miniflare through getPlatformProxy)
 * behind the request/response shapes recorded by spikes A-05 and A-06. No network.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";

const ACCOUNT = "acct";
const BASE = `/accounts/${ACCOUNT}/d1/database`;

describe("fake D1 HTTP API", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  beforeEach(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT, maxDatabases: 2 });
  }, 60_000);
  afterEach(async () => {
    await fake?.close();
  });

  const create = async (name: string) => {
    const r = await fake.api("POST", BASE, { name });
    return (r.body as { result: { uuid: string } }).result.uuid;
  };

  it("creates, lists and deletes databases with the recorded shapes", async () => {
    const uuid = await create("app-test-a-db-1");
    const list = await fake.api("GET", `${BASE}?name=app-test-a-db-1&per_page=100`);
    expect(list).toMatchObject({ status: 200, body: { success: true, result: [{ uuid, name: "app-test-a-db-1" }] } });
    expect(await fake.api("DELETE", `${BASE}/${uuid}`)).toMatchObject({ status: 200, body: { success: true } });
    expect(await fake.api("DELETE", `${BASE}/${uuid}`)).toMatchObject({ status: 404, body: { success: false } });
  });

  it("refuses a database over the account limit with 403 code 7406", async () => {
    await create("a");
    await create("b");
    const r = await fake.api("POST", BASE, { name: "c" });
    expect(r).toMatchObject({ status: 403, body: { success: false, errors: [{ code: 7406 }] } });
  });

  it("runs a batch atomically, binds JSON numbers as REAL, and answers a failure with 400 code 7500", async () => {
    const uuid = await create("a");
    const ok = await fake.api("POST", `${BASE}/${uuid}/query`, {
      batch: [{ sql: "CREATE TABLE t (x)" }, { sql: "INSERT INTO t VALUES (?), (CAST(? AS INTEGER))", params: [1, "2"] }, { sql: "SELECT typeof(x) AS t FROM t ORDER BY rowid" }],
    });
    expect(ok).toMatchObject({ status: 200, body: { success: true, result: [{ success: true }, { success: true }, { results: [{ t: "real" }, { t: "integer" }] }] } });
    const bad = await fake.api("POST", `${BASE}/${uuid}/query`, { batch: [{ sql: "INSERT INTO t VALUES (3)" }, { sql: "INSERT INTO nope VALUES (1)" }] });
    expect(bad).toMatchObject({ status: 400, body: { success: false, errors: [{ code: 7500 }], result: [] } });
    const count = await fake.api("POST", `${BASE}/${uuid}/query`, { sql: "SELECT count(*) AS n FROM t" });
    expect(count).toMatchObject({ body: { result: [{ results: [{ n: 2 }] }] } });
  });

  it("lets a test replace a response after or instead of the real effect", async () => {
    const uuid = await create("a");
    fake.intercept = async (_req, run) => {
      await run();
      return { status: 502, body: "upstream request failed" };
    };
    expect(await fake.api("POST", `${BASE}/${uuid}/query`, { sql: "CREATE TABLE t (x)" })).toEqual({ status: 502, body: "upstream request failed" });
    fake.intercept = undefined;
    const r = await fake.api("POST", `${BASE}/${uuid}/query`, { sql: "SELECT name FROM sqlite_master WHERE name = 't'" });
    expect(r).toMatchObject({ body: { result: [{ results: [{ name: "t" }] }] } });
    expect(fake.requests.map((q) => q.method)).toEqual(["POST", "POST", "POST"]);
  });
});

// Root cause 2026-10-20-testing-dev-registry.md (fix-registry-2): the fake never joins Miniflare's
// dev registry. WRANGLER_REGISTRY_PATH points at a scratch registry (never the host's) holding
// live foreign entries; the fake must write no entry there and leave the foreign ones alone. No
// caller runs the fake under fake timers, so the real clock is enough. This is also a guard for
// the shared helper's dependence on Wrangler reading the variable before its first await.
describe("fake D1 HTTP API and the dev registry", { timeout: 60_000 }, () => {
  let registry: string;
  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), "fake-d1-registry-"));
    vi.stubEnv("WRANGLER_REGISTRY_PATH", registry);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(registry, { recursive: true, force: true });
  });

  const snapshot = (): Record<string, { mtimeMs: number; content: string }> =>
    Object.fromEntries(readdirSync(registry).sort().map((name) => [name, { mtimeMs: statSync(join(registry, name)).mtimeMs, content: readFileSync(join(registry, name), "utf8") }]));

  it("writes no entry of its own, keeps live foreign entries, and restores the variable", async () => {
    for (const name of ["someone-elses-worker", "another-session"]) writeFileSync(join(registry, name), JSON.stringify({ instanceId: "foreign-process" }));
    const planted = snapshot();
    const fake = await openFakeD1Api({ accountId: ACCOUNT });
    let live: ReturnType<typeof snapshot>;
    try {
      expect(process.env.WRANGLER_REGISTRY_PATH).toBe(registry);
      expect(await fake.api("POST", BASE, { name: "a" })).toMatchObject({ status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      live = snapshot();
    } finally {
      await fake.close();
    }
    expect(live).toEqual(planted);
    expect(snapshot()).toEqual(planted);
  });
});
