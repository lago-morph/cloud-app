/**
 * The fake D1 HTTP API used by D-04's tests: local D1 (Miniflare through getPlatformProxy)
 * behind the request/response shapes recorded by spikes A-05 and A-06. No network.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1StatementLike } from "../../../mig/apply.js";
import { d1Client } from "./client.js";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";
import { importDump } from "./native-copy.js";

const ACCOUNT = "acct";
const BASE = `/accounts/${ACCOUNT}/d1/database`;

/**
 * Root cause 2026-10-31-native-copy-fetch-failed.md: through getPlatformProxy, Miniflare's
 * `prepare` and `bind` are synchronous proxy calls that block the main thread. While `turns.on`
 * is set, the fake's bindings are wrapped (they still reach real local D1) so that each proxy call
 * records whether the event loop turned since the previous one: every call clears a flag and
 * schedules a `setImmediate` that sets it. Deterministic; no timing.
 */
const turns = vi.hoisted(() => ({ on: false, log: [] as { op: "prepare" | "bind" | "batch"; turned: boolean }[] }));
vi.mock("../../../targets/local/platform-proxy.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../targets/local/platform-proxy.js")>();
  let turned = true;
  const call = (op: "prepare" | "bind" | "batch") => {
    turns.log.push({ op, turned });
    turned = false;
    setImmediate(() => {
      turned = true;
    });
  };
  const unwrap = new WeakMap<object, D1StatementLike>();
  const statement = (st: D1StatementLike): D1StatementLike => {
    const wrapped = new Proxy(st, {
      get(target, prop) {
        if (prop === "bind")
          return (...values: unknown[]) => {
            call("bind");
            return statement(target.bind(...values));
          };
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (...a: unknown[]) => (v as (...x: unknown[]) => unknown).apply(target, a) : v;
      },
    });
    unwrap.set(wrapped, st);
    return wrapped;
  };
  type Binding = { prepare(sql: string): D1StatementLike; batch(s: D1StatementLike[]): Promise<unknown> };
  const binding = (b: Binding): Binding => ({
    prepare: (sql) => {
      call("prepare");
      return statement(b.prepare(sql));
    },
    batch: (list) => {
      call("batch");
      return b.batch(list.map((s) => unwrap.get(s) ?? s));
    },
  });
  return {
    ...real,
    startPlatformProxy: ((configPath: string) => {
      const started = real.startPlatformProxy<Record<string, Binding>>(configPath);
      if (!turns.on) return started;
      return started.then((proxy) => ({ ...proxy, env: Object.fromEntries(Object.entries(proxy.env).map(([k, b]) => [k, binding(b)])) }));
    }) as typeof real.startPlatformProxy,
  };
});

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

  it("an import's foreign-key deferral spans only about 4 KB of the dump (A-06): a child further than that from its parent fails the whole import", async () => {
    const client = d1Client(fake.api, ACCOUNT);
    const options = { transfer: fake.transfer, sleep: async () => undefined };
    const schema = [`PRAGMA defer_foreign_keys=TRUE;`, `CREATE TABLE "p" ("id" text PRIMARY KEY NOT NULL);`, `CREATE TABLE "c" ("id" text PRIMARY KEY NOT NULL, "p" text REFERENCES "p"("id"), "pad" text);`];
    const child = (i: number, pad: number) => `INSERT INTO "c" ("id","p","pad") VALUES('c${i}','p1','${"x".repeat(pad)}');`;
    const near = await create("near");
    await importDump(client, near, new TextEncoder().encode([...schema, child(1, 100), `INSERT INTO "p" ("id") VALUES('p1');`].join("\n")), options);
    expect((await fake.database(near).prepare(`SELECT count(*) AS "n" FROM "c"`).all<{ n: number }>()).results[0]?.n).toBe(1);

    const far = await create("far");
    const lines = [...schema, ...Array.from({ length: 50 }, (_, i) => child(i, 100)), `INSERT INTO "p" ("id") VALUES('p1');`];
    await expect(importDump(client, far, new TextEncoder().encode(lines.join("\n")), options)).rejects.toThrow(/importing into D1 database .* failed/);
    expect((await fake.database(far).prepare(`SELECT "name" FROM sqlite_master WHERE "type" = 'table'`).all()).results).toEqual([]);
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

// Root cause 2026-10-31-native-copy-fetch-failed.md: a long run of synchronous proxy calls inside
// one I/O continuation lets workerd close an idle pooled socket that the next call is written to
// ("fetch failed"). The fake must let the event loop turn after every statement it prepares (and
// binds), and before the batch that runs them.
describe("fake D1 HTTP API yields to the event loop between synchronous proxy calls", { timeout: 60_000 }, () => {
  let fake: FakeD1Api;
  beforeEach(async () => {
    turns.on = true;
    try {
      fake = await openFakeD1Api({ accountId: ACCOUNT });
    } finally {
      turns.on = false;
    }
  }, 60_000);
  afterEach(async () => {
    await fake?.close();
  });

  const create = async (name: string) => ((await fake.api("POST", BASE, { name })).body as { result: { uuid: string } }).result.uuid;
  const unturned = (op: "prepare" | "bind" | "batch", skipFirst: boolean) => turns.log.filter((e) => e.op === op).slice(skipFirst ? 1 : 0).filter((e) => !e.turned).length;

  it("an import's ingest: a turn before every prepare after the first, and before the batch", async () => {
    const uuid = await create("ingest");
    const lines = [`PRAGMA defer_foreign_keys=TRUE;`, `CREATE TABLE "t" ("id" integer PRIMARY KEY, "v" text);`, ...Array.from({ length: 60 }, (_, i) => `INSERT INTO "t" ("id","v") VALUES(${i},'v${i}');`)];
    turns.log.length = 0;
    await importDump(d1Client(fake.api, ACCOUNT), uuid, new TextEncoder().encode(lines.join("\n")), { transfer: fake.transfer, sleep: async () => undefined });
    expect((await fake.database(uuid).prepare(`SELECT count(*) AS "n" FROM "t"`).all<{ n: number }>()).results[0]?.n).toBe(60);
    const ingest = turns.log.slice(0, turns.log.findIndex((e) => e.op === "batch") + 1);
    turns.log.splice(0, turns.log.length, ...ingest);
    expect(turns.log.filter((e) => e.op === "prepare").length).toBeGreaterThan(60 * 4);
    expect.soft(unturned("prepare", true), "prepares with no event-loop turn since the previous proxy call").toBe(0);
    expect(turns.log.at(-1)?.op).toBe("batch");
    expect.soft(unturned("batch", false), "no event-loop turn between the last prepare and the batch").toBe(0);
  });

  it("a query batch with params: a turn after every statement's prepare and bind, and before the batch", async () => {
    const uuid = await create("query");
    await fake.api("POST", `${BASE}/${uuid}/query`, { sql: `CREATE TABLE "t" ("id" integer, "v" text)` });
    turns.log.length = 0;
    const r = await fake.api("POST", `${BASE}/${uuid}/query`, { batch: Array.from({ length: 8 }, (_, i) => ({ sql: `INSERT INTO "t" VALUES (?, ?)`, params: [i, `v${i}`] })) });
    expect(r).toMatchObject({ status: 200, body: { success: true } });
    expect(turns.log.map((e) => e.op)).toEqual([...Array.from({ length: 8 }, () => ["prepare", "bind"]).flat(), "batch"]);
    expect.soft(unturned("prepare", true), "prepares with no event-loop turn since the previous statement's bind").toBe(0);
    expect.soft(unturned("batch", false), "no event-loop turn between the last bind and the batch").toBe(0);
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
