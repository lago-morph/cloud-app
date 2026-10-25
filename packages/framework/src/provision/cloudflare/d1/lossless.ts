/**
 * The lossless part of the production `remove`'s backup (DEC-0543, DEC-0556, DEC-0557). D1's own
 * export rounds integers beyond ±2^53 and its import stops at a NUL in a text value (DEC-0096,
 * spike A-06), so the backup's export first scans every table for those values (`readLossyTables`,
 * reads only): each table separately, `pageRows` rows per read by rowid (by offset for a WITHOUT
 * ROWID table), so no read covers a whole large table. A table whose scan D1 still refuses counts
 * as lossy: it is backed up losslessly rather than failing the backup. Each lossy table is read
 * row by row, every value in an exact transport form (integers as decimal text; text and blobs as
 * the hex of their stored bytes), and written twice (`buildLossless`):
 *
 * - **JSON** (`<database>.lossless.json`): `{ format, database, tables: [{ table, columns, rows }] }`.
 *   A row is an array in column order; a value is `null`, a JSON string (text that is valid UTF-8,
 *   every character intact, a leading U+FEFF included), `{ "textHex": "<hex>" }` (text that is not
 *   valid UTF-8, its stored bytes), `{ "integer": "<decimal digits>" }` (every integer),
 *   `{ "real": <number> }` (or `"Infinity"`/`"-Infinity"`) or `{ "blob": "<hex>" }`.
 * - **The restore file** (`<database>.restore.sql`): D1's dump, statement by statement, with each
 *   lossy table's `INSERT INTO "<table>"` statements replaced, at the place of the first one, by
 *   one `INSERT` per row with literals no import can misread (`CAST('<digits>' AS INTEGER)`,
 *   `CAST(X'<stored bytes>' AS TEXT)`, `X'<hex>'`, a real with a decimal point or exponent). The
 *   dump's order is kept, so a row referencing a lossy table's row stays as close to it as in the
 *   dump: the import's foreign-key deferral spans only about 4 KB (A-06). The number of statements
 *   replaced must equal the rows read, or the backup fails (the dump's shape is not the one A-06
 *   recorded, or the table changed between the two reads; stop the stage and run remove again).
 *   A value written as hex takes twice its size: a row whose statement exceeds PAR-217 is refused
 *   by the import, as in D1's own dump, and must be loaded by hand.
 */
import type { D1Client, D1Row } from "./client.js";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const NOT_INTERNAL = `"name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;
/** ±(2^53 − 1): integers beyond it are rounded by the dump (A-06). */
const SAFE = "9007199254740991";
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The SQL condition "this row holds a value D1's dump does not keep" over `cols`. */
export function lossyRowCondition(cols: readonly string[]): string {
  if (cols.length === 0) return "0";
  return cols.map((c) => `(typeof(${q(c)}) = 'text' AND instr(CAST(${q(c)} AS BLOB), X'00') > 0) OR (typeof(${q(c)}) = 'integer' AND (${q(c)} > ${SAFE} OR ${q(c)} < -${SAFE}))`).join(" OR ");
}

interface TableShape {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rowid: boolean;
}

async function tableShapes(client: D1Client, uuid: string): Promise<TableShape[]> {
  const [master = []] = await client.batch(uuid, [{ sql: `SELECT "name", "sql" FROM sqlite_master WHERE "type" = 'table' AND "sql" IS NOT NULL AND ${NOT_INTERNAL} ORDER BY rowid` }]);
  // A virtual table's rows live in its shadow tables, which are ordinary tables and scanned as such.
  const tables = master.filter((m) => !/^\s*CREATE\s+VIRTUAL/i.test(String(m["sql"])));
  if (tables.length === 0) return [];
  const info = await client.batch(uuid, tables.map((m) => ({ sql: `PRAGMA table_info(${q(String(m["name"]))})` })));
  return tables
    .map((m, i) => ({ name: String(m["name"]), columns: (info[i] ?? []).map((c) => String(c["name"])), rowid: !/WITHOUT\s+ROWID/i.test(String(m["sql"])) }))
    .filter((t) => t.columns.length > 0);
}

/** Whether the table holds a lossy value: paged reads, stopping at the first lossy page. */
async function tableIsLossy(client: D1Client, uuid: string, t: TableShape, pageRows: number): Promise<boolean> {
  const lossy = `CASE WHEN ${lossyRowCondition(t.columns)} THEN 1 ELSE 0 END AS "lossy"`;
  let last: string | undefined;
  for (let offset = 0; ; offset += pageRows) {
    const inner = t.rowid
      ? `SELECT rowid AS "r", ${lossy} FROM ${q(t.name)}${last === undefined ? "" : " WHERE rowid > CAST(? AS INTEGER)"} ORDER BY rowid LIMIT ${pageRows}`
      : `SELECT ${lossy} FROM ${q(t.name)} LIMIT ${pageRows} OFFSET ${offset}`;
    const sql = `SELECT ${t.rowid ? `CAST(max("r") AS TEXT)` : "NULL"} AS "last", count(*) AS "n", coalesce(sum("lossy"), 0) AS "lossy" FROM (${inner})`;
    const [rows = []] = await client.batch(uuid, [{ sql, ...(t.rowid && last !== undefined ? { params: [last] } : {}) }]);
    const row = rows[0] ?? {};
    if (Number(row["lossy"]) > 0) return true;
    if (Number(row["n"]) < pageRows) return false;
    last = String(row["last"]);
  }
}

/** One stored value: its `typeof` and its exact transport form (decimal text, hex, or a JSON number). */
interface Stored {
  readonly type: string;
  readonly raw: unknown;
}

export interface LossyTables {
  readonly tables: readonly { readonly name: string; readonly columns: readonly string[]; readonly rows: readonly (readonly Stored[])[] }[];
  /** Tables whose scan D1 refused, with why: backed up losslessly anyway. */
  readonly scanFailures: readonly string[];
}

function selectValues(cols: readonly string[]): string {
  return cols
    .map((c, k) => `typeof(${q(c)}) AS "t${k}", CASE typeof(${q(c)}) WHEN 'integer' THEN CAST(${q(c)} AS TEXT) WHEN 'blob' THEN hex(${q(c)}) WHEN 'text' THEN hex(${q(c)}) ELSE ${q(c)} END AS "v${k}"`)
    .join(", ");
}

/** Every row of `table`, `pageRows` per read: by rowid, or by offset for a WITHOUT ROWID table. */
async function readRows(client: D1Client, uuid: string, table: TableShape, pageRows: number): Promise<Stored[][]> {
  const rows: Stored[][] = [];
  const toRow = (r: D1Row) => table.columns.map((_, k) => ({ type: String(r[`t${k}`]), raw: r[`v${k}`] }));
  let last: string | undefined;
  for (let offset = 0; ; offset += pageRows) {
    const sql = table.rowid
      ? `SELECT CAST(rowid AS TEXT) AS "r", ${selectValues(table.columns)} FROM ${q(table.name)}${last === undefined ? "" : " WHERE rowid > CAST(? AS INTEGER)"} ORDER BY rowid LIMIT ${pageRows}`
      : `SELECT ${selectValues(table.columns)} FROM ${q(table.name)} LIMIT ${pageRows} OFFSET ${offset}`;
    const [page = []] = await client.batch(uuid, [{ sql, ...(table.rowid && last !== undefined ? { params: [last] } : {}) }]);
    rows.push(...page.map(toRow));
    if (page.length < pageRows) return rows;
    last = String(page[page.length - 1]?.["r"]);
  }
}

/** The tables of database `uuid` D1's dump would not keep exactly, with all their rows; undefined when there is none. Reads only. */
export async function readLossyTables(client: D1Client, uuid: string, pageRows = 1000): Promise<LossyTables | undefined> {
  const tables: LossyTables["tables"][number][] = [];
  const scanFailures: string[] = [];
  for (const t of await tableShapes(client, uuid)) {
    let lossy: boolean;
    try {
      lossy = await tableIsLossy(client, uuid, t, pageRows);
    } catch (error) {
      scanFailures.push(`table ${t.name}: ${messageOf(error)}`);
      lossy = true;
    }
    if (lossy) tables.push({ name: t.name, columns: t.columns, rows: await readRows(client, uuid, t, pageRows) });
  }
  return tables.length === 0 ? undefined : { tables, scanFailures };
}

type Value = null | string | { readonly textHex: string } | { readonly integer: string } | { readonly real: number | "Infinity" | "-Infinity" } | { readonly blob: string };

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

function jsonValue({ type, raw }: Stored): Value {
  switch (type) {
    case "null":
      return null;
    case "integer":
      return { integer: String(raw) };
    case "text":
      try {
        return strictUtf8.decode(hexBytes(String(raw)));
      } catch {
        return { textHex: String(raw).toUpperCase() };
      }
    case "blob":
      return { blob: String(raw).toUpperCase() };
    default: {
      const n = Number(raw);
      return { real: Number.isFinite(n) ? n : n > 0 ? "Infinity" : "-Infinity" };
    }
  }
}

function literal({ type, raw }: Stored): string {
  switch (type) {
    case "null":
      return "NULL";
    case "integer":
      return `CAST('${String(raw)}' AS INTEGER)`;
    case "text":
      // The stored bytes themselves: no decoding, so a BOM or invalid UTF-8 is kept exactly.
      return `CAST(X'${String(raw).toUpperCase()}' AS TEXT)`;
    case "blob":
      return `X'${String(raw).toUpperCase()}'`;
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) return n > 0 ? "9e999" : "-9e999";
      const text = String(n);
      return /[.e]/i.test(text) ? text : `${text}.0`;
    }
  }
}

const SEMICOLON = 0x3b;
const QUOTES = new Set([0x27, 0x22]);
const isSpace = (b: number | undefined) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

function trimBytes(bytes: Uint8Array): Uint8Array {
  let a = 0;
  let b = bytes.length;
  while (a < b && isSpace(bytes[a])) a++;
  while (b > a && isSpace(bytes[b - 1])) b--;
  return bytes.subarray(a, b);
}

/**
 * The SQL statements of a dump, split at `;` outside quoted strings and identifiers. It works on
 * the bytes (the delimiters are ASCII, which UTF-8 never uses inside a character), so every other
 * byte, invalid UTF-8 and NUL included, is kept exactly.
 */
export function splitStatements(dump: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  let quote: number | undefined;
  for (let i = 0; i < dump.length; i++) {
    const c = dump[i]!;
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (QUOTES.has(c)) quote = c;
    else if (c === SEMICOLON) {
      const statement = trimBytes(dump.subarray(start, i + 1));
      if (statement.length > 1) out.push(statement);
      start = i + 1;
    }
  }
  const rest = trimBytes(dump.subarray(start));
  if (rest.length > 0) out.push(rest);
  return out;
}

function concatLines(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    out[at + p.length] = 0x0a;
    at += p.length + 1;
  }
  return out;
}

export interface LosslessExport {
  /** The tables written, in creation order. */
  readonly tables: readonly string[];
  /** Tables whose scan D1 refused (backed up losslessly anyway). */
  readonly scanFailures: readonly string[];
  readonly json: Uint8Array;
  /** The one file to restore the database from: the dump with the lossy tables' rows in place. */
  readonly restore: Uint8Array;
}

/** The JSON and the restore file of `lossy` over D1's `dump`; throws when the dump's rows of a lossy table are not the rows read. */
export function buildLossless(lossy: LossyTables, dump: Uint8Array, database: string): LosslessExport {
  const latin = new TextDecoder("latin1");
  const encoder = new TextEncoder();
  const byInsert = new Map(lossy.tables.map((t) => [latin.decode(encoder.encode(`INSERT INTO ${q(t.name)}`)), t]));
  const replaced = new Map<string, number>();
  const out: Uint8Array[] = [];
  for (const statement of splitStatements(dump)) {
    // The head only, as single bytes: a table name is matched by its quoted UTF-8 bytes.
    const head = /^INSERT\s+INTO\s+("(?:[^"]|"")*")/i.exec(latin.decode(statement.subarray(0, 4096)));
    const table = head === null ? undefined : byInsert.get(`INSERT INTO ${head[1]}`);
    if (table === undefined) {
      out.push(statement);
      continue;
    }
    const seen = replaced.get(table.name) ?? 0;
    if (seen === 0) {
      for (const row of table.rows) out.push(encoder.encode(`INSERT INTO ${q(table.name)} (${table.columns.map(q).join(", ")}) VALUES (${row.map(literal).join(", ")});`));
    }
    replaced.set(table.name, seen + 1);
  }
  for (const t of lossy.tables) {
    const n = replaced.get(t.name) ?? 0;
    if (n !== t.rows.length) {
      throw new Error(
        `D1's export of table ${t.name} has ${n} row statement(s) but ${t.rows.length} row(s) were read, so its lossless restore file cannot be built ` +
          "(the table changed while it was backed up, or the export's shape is not the expected one); stop the stage (stop) and run remove again",
      );
    }
  }
  const json = lossy.tables.map((t) => ({ table: t.name, columns: t.columns, rows: t.rows.map((r) => r.map(jsonValue)) }));
  return {
    tables: lossy.tables.map((t) => t.name),
    scanFailures: lossy.scanFailures,
    json: encoder.encode(`${JSON.stringify({ format: "prototype-framework lossless rows 2", database, tables: json })}\n`),
    restore: concatLines(out),
  };
}
