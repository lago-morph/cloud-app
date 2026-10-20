/**
 * The fake D1 HTTP API used by D-04's tests: local D1 (Miniflare through getPlatformProxy)
 * behind the request/response shapes recorded by spikes A-05 and A-06. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
