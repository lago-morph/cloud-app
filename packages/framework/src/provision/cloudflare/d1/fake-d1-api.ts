/**
 * Test support: a fake of the D1 HTTP API (`api.cloudflare.com/client/v4/accounts/{id}/d1/database…`)
 * backed by local D1 (Miniflare through Wrangler's getPlatformProxy, DEC-0105). It answers with
 * the request and response shapes recorded by spikes A-05 and A-06 (DEC-0093, DEC-0097):
 *
 * - create `POST …/database {name}` → `result.uuid`; over `maxDatabases` → 403, code 7406;
 * - list `GET …/database?name=&page=&per_page=` → `result[]`, `result_info`;
 * - delete `DELETE …/database/{uuid}` → `success: true`; unknown → 404;
 * - `POST …/database/{uuid}/query` with `{sql, params}` or `{batch: [{sql, params}, …]}`: one atomic
 *   batch; success → 200, `result[]` one entry per statement; failure → 400, code 7500, `result: []`.
 *
 * Local D1 binds JSON numbers as REAL, like remote D1 (A-06 probe E5d). Booleans bind
 * differently there (TEXT remotely), so the fake refuses them. `intercept` lets a test answer
 * after or instead of the real effect (A-05 E8/E9: a 502 after a committed batch). Never
 * contacts the network. Not part of the package's public surface.
 */
import { randomUUID } from "node:crypto";
import type { D1Like, D1StatementLike } from "../../../mig/apply.js";
import { startPlatformProxy } from "../../../targets/local/platform-proxy.js";
import type { CloudflareApi } from "../account.js";

type Method = Parameters<CloudflareApi>[0];
export interface FakeRequest {
  readonly method: Method;
  readonly path: string;
  readonly body: unknown;
}
export interface FakeResponse {
  readonly status: number;
  readonly body: unknown;
}

interface BatchBinding extends D1Like {
  batch(statements: D1StatementLike[]): Promise<{ results?: unknown[]; meta?: unknown }[]>;
}

export interface FakeD1Api {
  readonly api: CloudflareApi;
  /** Every request received, in order. */
  readonly requests: FakeRequest[];
  /** When set, called instead of the real handler; `run` performs the real effect and returns its response. */
  intercept: ((req: FakeRequest, run: () => Promise<FakeResponse>) => Promise<FakeResponse>) | undefined;
  /** Direct access to a database by UUID (test assertions). */
  database(uuid: string): D1Like;
  close(): Promise<void>;
}

const fail = (status: number, code: number, message: string): FakeResponse => ({
  status,
  body: { success: false, errors: [{ code, message }], messages: [], result: status === 400 ? [] : null },
});
const ok = (result: unknown, extra: Record<string, unknown> = {}): FakeResponse => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...extra } });

export async function openFakeD1Api(options: { accountId: string; maxDatabases?: number }): Promise<FakeD1Api> {
  // Outside the dev registry; guarded by "fake D1 HTTP API and the dev registry" in fake-d1-api.unit.test.ts.
  const proxy = await startPlatformProxy<Record<string, BatchBinding>>(new URL("./fixtures/wrangler.jsonc", import.meta.url).pathname);
  const pool = Object.keys(proxy.env)
    .sort()
    .map((k) => proxy.env[k] as BatchBinding);
  const limit = options.maxDatabases ?? 10;
  const live = new Map<string, { name: string; binding: BatchBinding; created_at: string }>();
  const base = `/accounts/${options.accountId}/d1/database`;

  async function query(binding: BatchBinding, body: unknown): Promise<FakeResponse> {
    const b = body as { sql?: string; params?: unknown[]; batch?: { sql: string; params?: unknown[] }[] };
    const items = b.batch ?? [{ sql: b.sql ?? "", params: b.params }];
    for (const item of items) {
      if ((item.params ?? []).some((p) => typeof p === "boolean")) throw new Error("fake D1: remote D1 binds booleans as TEXT; send 0/1");
    }
    try {
      const results = await binding.batch(items.map((i) => binding.prepare(i.sql).bind(...(i.params ?? []))));
      return ok(results.map((r) => ({ results: r.results ?? [], success: true, meta: r.meta ?? {} })));
    } catch (error) {
      return fail(400, 7500, error instanceof Error ? error.message.replace(/^D1_ERROR: /, "") : String(error));
    }
  }

  async function handle(req: FakeRequest): Promise<FakeResponse> {
    const url = new URL(req.path, "https://api.cloudflare.com");
    if (!url.pathname.startsWith(base)) return fail(404, 7003, "Could not route to the requested account");
    const rest = url.pathname.slice(base.length).split("/").filter(Boolean);
    if (rest.length === 0 && req.method === "POST") {
      const name = (req.body as { name?: string }).name ?? "";
      if (live.size >= limit) return fail(403, 7406, `System limit reached: databases per account (${limit})`);
      if ([...live.values()].some((d) => d.name === name)) return fail(400, 7502, "A database with that name already exists");
      const binding = pool.shift();
      if (!binding) throw new Error("fake D1: fixture pool exhausted; add bindings to fixtures/wrangler.jsonc");
      const uuid = randomUUID();
      const created_at = new Date().toISOString();
      live.set(uuid, { name, binding, created_at });
      return ok({ uuid, name, created_at, version: "production" });
    }
    if (rest.length === 0 && req.method === "GET") {
      const name = url.searchParams.get("name");
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const all = [...live.entries()].filter(([, d]) => name === null || d.name.includes(name)).map(([uuid, d]) => ({ uuid, name: d.name, created_at: d.created_at, version: "production" }));
      const result = all.slice((page - 1) * perPage, page * perPage);
      return ok(result, { result_info: { page, per_page: perPage, count: result.length, total_count: all.length } });
    }
    const db = rest[0] ? live.get(rest[0]) : undefined;
    if (!db) return fail(404, 7404, "The database could not be found");
    if (rest.length === 1 && req.method === "DELETE") {
      live.delete(rest[0] as string);
      return ok(null);
    }
    if (rest.length === 2 && rest[1] === "query" && req.method === "POST") return query(db.binding, req.body);
    return fail(405, 10000, `fake D1: ${req.method} ${url.pathname} not supported`);
  }

  const fake: FakeD1Api = {
    requests: [],
    intercept: undefined,
    api: async (method, path, body) => {
      const req = { method, path, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) };
      fake.requests.push(req);
      const run = () => handle(req);
      return fake.intercept ? fake.intercept(req, run) : run();
    },
    database(uuid) {
      const db = live.get(uuid);
      if (!db) throw new Error(`fake D1: no database ${uuid}`);
      return db.binding;
    },
    close: () => proxy.dispose(),
  };
  return fake;
}
