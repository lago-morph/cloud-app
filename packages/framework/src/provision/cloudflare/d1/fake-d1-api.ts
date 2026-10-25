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
 * - export `POST …/database/{uuid}/export {output_format: "polling"}` → `status: "active"` with
 *   `at_bookmark`, then (re-sent with `current_bookmark`) `status: "complete"` and
 *   `result.signed_url`, downloaded through `transfer`. The dump has A-06's shape: `PRAGMA
 *   defer_foreign_keys=TRUE;`, each table's `CREATE TABLE` and one `INSERT` per row with inline
 *   literals in creation order, `sqlite_sequence`, then indexes, triggers and views; one
 *   statement per line (newlines in text written as `char(10)`).
 * - import `POST …/database/{uuid}/import` `init {etag}` → `upload_url`, `filename`; the dump is
 *   `PUT` there through `transfer`; `ingest {etag, filename}` → `status: "active"`; `poll
 *   {current_bookmark}` → `complete`, or `status: "error"` and `error` when a statement failed
 *   (the whole import rolled back, as live).
 *
 * Local D1 binds JSON numbers as REAL, like remote D1 (A-06 probe E5d). Booleans bind
 * differently there (TEXT remotely), so the fake refuses them. `intercept` lets a test answer
 * after or instead of the real effect (A-05 E8/E9: a 502 after a committed batch). Never
 * contacts the network. Not part of the package's public surface.
 */
import { createHash, randomUUID } from "node:crypto";
import type { D1Like, D1StatementLike } from "../../../mig/apply.js";
import { startPlatformProxy } from "../../../targets/local/platform-proxy.js";
import type { CloudflareApi } from "../account.js";
import type { SignedTransfer } from "./native-copy.js";

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
  /** The signed-URL downloads and uploads of export and import. */
  readonly transfer: SignedTransfer;
  /** Every export's dump, in order (test assertions). */
  readonly dumps: string[];
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

  const signed = new Map<string, Uint8Array>();
  const dumps: string[] = [];
  let nextUrl = 1;
  const pendingImports = new Map<string, { status: "complete" } | { status: "error"; error: string }>();

  async function dumpOf(binding: BatchBinding): Promise<string> {
    const all = async (sql: string) => ((await binding.prepare(sql).all()) as { results: Record<string, unknown>[] }).results;
    const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
    const lines = ["PRAGMA defer_foreign_keys=TRUE;"];
    const master = await all(`SELECT "type", "name", "sql" FROM sqlite_master WHERE "sql" IS NOT NULL AND "name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY rowid`);
    for (const t of master.filter((m) => m["type"] === "table")) {
      const name = String(t["name"]);
      lines.push(`${String(t["sql"])};`);
      const cols = (await all(`PRAGMA table_info(${q(name)})`)).map((c) => String(c["name"]));
      const values = cols.map((c) => `replace(replace(quote(${q(c)}), char(13), '''||char(13)||'''), char(10), '''||char(10)||''')`).join(` || ',' || `);
      for (const r of await all(`SELECT 'INSERT INTO ${q(name).replace(/'/g, "''")} (${cols.map(q).join(",").replace(/'/g, "''")}) VALUES(' || ${values} || ');' AS "line" FROM ${q(name)} ORDER BY rowid`)) lines.push(String(r["line"]));
    }
    if ((await all(`SELECT 1 FROM sqlite_master WHERE "name" = 'sqlite_sequence'`)).length > 0) {
      lines.push("DELETE FROM sqlite_sequence;");
      for (const s of await all(`SELECT "name", "seq" FROM sqlite_sequence`)) lines.push(`INSERT INTO "sqlite_sequence" VALUES('${String(s["name"]).replace(/'/g, "''")}',${String(s["seq"])});`);
    }
    for (const m of master.filter((x) => x["type"] !== "table")) lines.push(`${String(m["sql"])};`);
    return `${lines.join("\n")}\n`;
  }

  async function exportAction(binding: BatchBinding, body: unknown): Promise<FakeResponse> {
    const b = body as { output_format?: unknown; current_bookmark?: unknown };
    if (b.output_format !== "polling") return fail(400, 7400, "output_format must be polling");
    if (b.current_bookmark === undefined) return ok({ type: "export", status: "active", at_bookmark: "export-bookmark", success: true });
    const dump = await dumpOf(binding);
    dumps.push(dump);
    const url = `https://fake-d1-export.invalid/${nextUrl++}.sql`;
    signed.set(url, new TextEncoder().encode(dump));
    return ok({ type: "export", status: "complete", at_bookmark: "export-bookmark", success: true, result: { filename: "dump.sql", signed_url: url } });
  }

  async function importAction(binding: BatchBinding, body: unknown): Promise<FakeResponse> {
    const b = body as { action?: unknown; etag?: unknown; filename?: unknown; current_bookmark?: unknown };
    if (b.action === "init") {
      const url = `https://fake-d1-import.invalid/${nextUrl++}`;
      return ok({ type: "import", success: true, upload_url: url, filename: `${String(b.etag)}.sql` });
    }
    if (b.action === "ingest") {
      const upload = [...signed].find(([u]) => u.startsWith("https://fake-d1-import.invalid/") && createHash("md5").update(signed.get(u)!).digest("hex") === b.etag);
      if (!upload) return ok({ type: "import", success: false, status: "error", error: "no uploaded file matches the etag" });
      const statements = new TextDecoder()
        .decode(upload[1])
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => binding.prepare(l.replace(/^PRAGMA defer_foreign_keys=TRUE;$/, "PRAGMA defer_foreign_keys = on")));
      const bookmark = `import-${nextUrl++}`;
      try {
        await binding.batch(statements);
        pendingImports.set(bookmark, { status: "complete" });
      } catch (error) {
        pendingImports.set(bookmark, { status: "error", error: error instanceof Error ? error.message : String(error) });
      }
      return ok({ type: "import", success: true, status: "active", at_bookmark: bookmark });
    }
    if (b.action === "poll") {
      const done = pendingImports.get(String(b.current_bookmark));
      if (!done) return fail(400, 7400, "unknown bookmark");
      return ok(done.status === "complete" ? { type: "import", success: true, status: "complete", at_bookmark: b.current_bookmark, result: { num_queries: 1 } } : { type: "import", success: false, status: "error", error: done.error });
    }
    return fail(400, 7400, "unknown import action");
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
    if (rest.length === 2 && rest[1] === "export" && req.method === "POST") return exportAction(db.binding, req.body);
    if (rest.length === 2 && rest[1] === "import" && req.method === "POST") return importAction(db.binding, req.body);
    return fail(405, 10000, `fake D1: ${req.method} ${url.pathname} not supported`);
  }

  const fake: FakeD1Api = {
    requests: [],
    intercept: undefined,
    dumps,
    transfer: async (method, url, body) => {
      fake.requests.push({ method: method === "GET" ? "GET" : "PUT", path: url, body: undefined });
      if (method === "GET") {
        const bytes = signed.get(url);
        return bytes ? { status: 200, bytes } : { status: 404, bytes: new Uint8Array() };
      }
      if (!url.startsWith("https://fake-d1-import.invalid/") || body === undefined) return { status: 403, bytes: new Uint8Array() };
      signed.set(url, body.slice());
      return { status: 200, bytes: new Uint8Array() };
    },
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
