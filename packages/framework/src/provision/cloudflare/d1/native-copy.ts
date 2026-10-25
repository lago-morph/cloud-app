/**
 * D1's native export and import (DEC-0545; migrations.md §2 "Cloudflare", *Copy*), used by
 * `copyDatabase` when a quick pre-check shows the database has none of the shapes spike A-06
 * found to break it (DEC-0096), and by the production `remove`'s backup (DEC-0543).
 *
 * **Pre-check** (`nativeCopyPrecheck`): reads only, three requests (the tables in
 * `sqlite_master`; each table's columns and references; each table's sizes and unsafe values).
 * - every reference points to a table created earlier (the dump writes tables in creation
 *   order, and the import's foreign-key deferral spans only about 4 KB): no self-reference, no
 *   reference to a later table, no cycle; table names compare without regard to ASCII case, as
 *   SQLite's do;
 * - no row's values are larger than PAR-312 bytes (the dump writes each row as one INSERT with
 *   inline literals, and D1 refuses a statement over PAR-217; quoting can double a value);
 * - no text value holds a NUL (an import silently stops at it) and no integer is beyond ±2^53
 *   (the dump rounds it);
 * - the values add up to at most PAR-313 bytes (within the sizes A-06 exercised).
 * Any of these, or a table with a WITHOUT ROWID, virtual or other shape the check cannot read,
 * makes the copy take the row-by-row path; the reason is reported. So does a pre-check that
 * throws (D1 refusing one of its reads, e.g. on a large database): `copyDatabase` catches it.
 *
 * **Export**: `POST …/export {"output_format":"polling"}`, re-sent with `current_bookmark` until
 * `status` is `complete`; then the dump is downloaded from `result.signed_url` (a Cloudflare-owned
 * bucket, no credentials). **Import**: `{"action":"init","etag":<md5 hex>}` → `upload_url` and
 * `filename`; the dump is `PUT` there; `{"action":"ingest","etag","filename"}`; then
 * `{"action":"poll","current_bookmark"}` until `complete`. Shapes as spike A-06 recorded them.
 * After the import the row count of every table is compared with the source's, which catches a
 * silently shortened import. Waits are bounded by PAR-314.
 */
import { createHash } from "node:crypto";
import type { D1Client, D1Row } from "./client.js";
import { lossyRowCondition } from "./lossless.js";

/** Downloads from or uploads to a signed URL (no credentials): the export's and the import's. */
export type SignedTransfer = (method: "GET" | "PUT", url: string, body?: Uint8Array) => Promise<{ readonly status: number; readonly bytes: Uint8Array }>;

export const fetchTransfer =
  (doFetch: typeof fetch = fetch): SignedTransfer =>
  async (method, url, body) => {
    const response = await doFetch(url, { method, ...(body === undefined ? {} : { body: new Blob([body.slice()]) }) });
    return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  };

export interface NativeCopyLimits {
  /** PAR-312: the largest row (bytes of its values) the native path accepts. */
  readonly maxRowBytes: number;
  /** PAR-313: the largest database (bytes of all values) the native path accepts. */
  readonly maxTotalBytes: number;
  /** PAR-314: how long an export or import may take, polled every `pollMs`. */
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export const DEFAULT_NATIVE_LIMITS: NativeCopyLimits = { maxRowBytes: 40_000, maxTotalBytes: 5_000_000, timeoutMs: 120_000, pollMs: 1_000 };

export interface DumpOptions {
  readonly transfer: SignedTransfer;
  readonly limits?: Partial<NativeCopyLimits>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const NOT_INTERNAL = `"name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;

/** A SQLite identifier as SQLite compares it: ASCII letters without regard to case. */
export const foldCase = (name: string): string => name.replace(/[A-Z]/g, (c) => c.toLowerCase());

export type Precheck = { readonly safe: true; readonly tables: readonly string[] } | { readonly safe: false; readonly reason: string };

/** Whether the native export/import copies database `uuid` exactly (DEC-0096's failure shapes absent). Reads only. */
export async function nativeCopyPrecheck(client: D1Client, uuid: string, limits: NativeCopyLimits = DEFAULT_NATIVE_LIMITS): Promise<Precheck> {
  const [master = []] = await client.batch(uuid, [{ sql: `SELECT "name", "sql" FROM sqlite_master WHERE "type" = 'table' AND "sql" IS NOT NULL AND ${NOT_INTERNAL} ORDER BY rowid` }]);
  const names = master.map((m) => String(m["name"]));
  for (const m of master) {
    const sql = String(m["sql"]);
    if (/^\s*CREATE\s+VIRTUAL/i.test(sql) || /WITHOUT\s+ROWID/i.test(sql)) return { safe: false, reason: `table ${String(m["name"])} is a virtual or WITHOUT ROWID table` };
  }
  if (names.length === 0) return { safe: true, tables: [] };
  const info = await client.batch(uuid, names.flatMap((t) => [{ sql: `PRAGMA table_info(${q(t)})` }, { sql: `PRAGMA foreign_key_list(${q(t)})` }]));
  const statements = names.map((t, i) => {
    const cols = (info[2 * i] ?? []).map((c) => String(c["name"]));
    const size = cols.length === 0 ? "0" : cols.map((c) => `coalesce(length(CAST(${q(c)} AS BLOB)), 0)`).join(" + ");
    const bad = lossyRowCondition(cols);
    return { sql: `SELECT count(*) AS "n", coalesce(max(${size}), 0) AS "big", coalesce(sum(${size}), 0) AS "total", coalesce(sum(CASE WHEN ${bad} THEN 1 ELSE 0 END), 0) AS "bad" FROM ${q(t)}` };
  });
  // SQLite matches table names without regard to ASCII case, so a reference may spell its parent differently.
  const folded = names.map(foldCase);
  for (const [i, t] of names.entries()) {
    for (const ref of info[2 * i + 1] ?? []) {
      const parent = String(ref["table"]);
      const at = folded.indexOf(foldCase(parent));
      if (at === i) return { safe: false, reason: `table ${t} references itself` };
      if (at > i) return { safe: false, reason: `table ${t} references table ${parent}, which was created after it` };
    }
  }
  const stats = await client.batch(uuid, statements);
  let total = 0;
  for (const [i, t] of names.entries()) {
    const row: D1Row = stats[i]?.[0] ?? {};
    if (Number(row["bad"]) > 0) return { safe: false, reason: `table ${t} holds a text value with a NUL character or an integer beyond ±2^53` };
    if (Number(row["big"]) > limits.maxRowBytes) return { safe: false, reason: `table ${t} has a row of ${Number(row["big"])} bytes, more than ${limits.maxRowBytes} (PAR-312)` };
    total += Number(row["total"]);
  }
  if (total > limits.maxTotalBytes) return { safe: false, reason: `the database holds ${total} bytes of values, more than ${limits.maxTotalBytes} (PAR-313)` };
  return { safe: true, tables: names };
}

interface DumpStep {
  readonly status?: unknown;
  readonly at_bookmark?: unknown;
  readonly error?: unknown;
  readonly upload_url?: unknown;
  readonly filename?: unknown;
  readonly result?: { readonly signed_url?: unknown; readonly num_queries?: unknown } | null;
}

function limitsOf(options: DumpOptions): NativeCopyLimits {
  return { ...DEFAULT_NATIVE_LIMITS, ...options.limits };
}

/** Polls `step` until its status is `complete`; throws on `error` or after PAR-314. */
async function poll(what: string, options: DumpOptions, first: DumpStep, next: (bookmark: string) => Promise<DumpStep>): Promise<DumpStep> {
  const limits = limitsOf(options);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + limits.timeoutMs;
  let step = first;
  for (;;) {
    if (step.error !== undefined && step.error !== null) throw new Error(`${what} failed: ${String(step.error)}`);
    if (step.status === "complete") return step;
    if (step.status === "error") throw new Error(`${what} failed`);
    if (typeof step.at_bookmark !== "string") throw new Error(`${what}: the answer has no bookmark to poll (status ${String(step.status)})`);
    if (now() >= deadline) throw new Error(`${what} did not complete within ${limits.timeoutMs} ms (PAR-314)`);
    await sleep(limits.pollMs);
    step = await next(step.at_bookmark);
  }
}

/** The database's SQL dump, through D1's export (`output_format: polling`) and its signed URL. */
export async function exportDump(client: D1Client, uuid: string, options: DumpOptions): Promise<Uint8Array> {
  const what = `exporting D1 database ${uuid}`;
  const send = async (body: unknown) => (await client.dumpAction(what, uuid, "export", body)) as DumpStep;
  const done = await poll(what, options, await send({ output_format: "polling" }), (bookmark) => send({ output_format: "polling", current_bookmark: bookmark }));
  const url = done.result?.signed_url;
  if (typeof url !== "string") throw new Error(`${what}: the completed export has no signed_url`);
  const download = await options.transfer("GET", url);
  if (download.status < 200 || download.status >= 300) throw new Error(`${what}: downloading the dump answered HTTP ${download.status}`);
  return download.bytes;
}

/** Imports a SQL dump into database `uuid` through D1's import (init, upload, ingest, poll). */
export async function importDump(client: D1Client, uuid: string, dump: Uint8Array, options: DumpOptions): Promise<void> {
  const what = `importing into D1 database ${uuid}`;
  const send = async (body: unknown) => (await client.dumpAction(what, uuid, "import", body)) as DumpStep;
  const etag = createHash("md5").update(dump).digest("hex");
  const init = await send({ action: "init", etag });
  if (typeof init.upload_url === "string") {
    const upload = await options.transfer("PUT", init.upload_url, dump);
    if (upload.status < 200 || upload.status >= 300) throw new Error(`${what}: uploading the dump answered HTTP ${upload.status}`);
  }
  if (typeof init.filename !== "string") throw new Error(`${what}: the import's init answer has no filename`);
  const ingest = await send({ action: "ingest", etag, filename: init.filename });
  await poll(what, options, ingest, (bookmark) => send({ action: "poll", current_bookmark: bookmark }));
}

/** Row counts of the given tables. */
async function counts(client: D1Client, uuid: string, tables: readonly string[]): Promise<number[]> {
  if (tables.length === 0) return [];
  const rows = await client.batch(uuid, tables.map((t) => ({ sql: `SELECT count(*) AS "n" FROM ${q(t)}` })));
  return rows.map((r) => Number(r[0]?.["n"] ?? -1));
}

/**
 * Copies `from` into the empty database `to` by export and import, then compares every table's
 * row count. Throws on any failure; the caller then deletes `to` and copies row by row.
 */
export async function nativeCopy(client: D1Client, from: string, to: string, tables: readonly string[], options: DumpOptions): Promise<void> {
  const dump = await exportDump(client, from, options);
  await importDump(client, to, dump, options);
  const [before, after] = [await counts(client, from, tables), await counts(client, to, tables)];
  const differ = tables.filter((_, i) => before[i] !== after[i]);
  if (differ.length > 0) throw new Error(`the imported copy's row counts differ from the source's in ${differ.map((t) => `table ${t}`).join(", ")}`);
}
