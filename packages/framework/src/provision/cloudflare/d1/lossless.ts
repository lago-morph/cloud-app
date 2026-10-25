/**
 * The lossless part of the production `remove`'s backup (DEC-0543, DEC-0556). D1's own export
 * rounds integers beyond ±2^53 and its import stops at a NUL in a text value (DEC-0096, spike
 * A-06), so the backup's export first scans every table for those values (`lossyTables`, the
 * native copy pre-check's test, reads only). Each table that holds one is also read row by row
 * (`losslessExport`), every value in an exact transport form (integers and text as text and hex,
 * as the row-by-row copy reads them), and written twice:
 *
 * - **JSON** (`<database>.lossless.json`): `{ format, database, tables: [{ table, columns, rows }] }`.
 *   A row is an array in column order; a value is `null`, a JSON string (text, NUL and every other
 *   character intact), `{ "integer": "<decimal digits>" }` (every integer, so none is rounded),
 *   `{ "real": <number> }` (or `"Infinity"`/`"-Infinity"`) or `{ "blob": "<hex>" }`.
 * - **SQL** (`<database>.lossless.sql`), the same rows for `wrangler d1 execute --file`, one
 *   statement per line: `PRAGMA defer_foreign_keys = on`, then per table `DELETE FROM` and one
 *   `INSERT` per row with literals no import can misread: `CAST('<digits>' AS INTEGER)`,
 *   `CAST(X'<utf-8 hex>' AS TEXT)`, `X'<hex>'`, a real with a decimal point or exponent.
 *
 * Restore (provisioning.md "Restoring a removed production stage"): import D1's dump without the
 * listed tables' `INSERT` lines, then the lossless SQL.
 */
import type { D1Client, D1Row } from "./client.js";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const NOT_INTERNAL = `"name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;
/** ±(2^53 − 1): integers beyond it are rounded by the dump (A-06). */
const SAFE = "9007199254740991";

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
  return tables.map((m, i) => ({
    name: String(m["name"]),
    columns: (info[i] ?? []).map((c) => String(c["name"])),
    rowid: !/WITHOUT\s+ROWID/i.test(String(m["sql"])),
  }));
}

/** The tables of database `uuid` holding a text value with a NUL or an integer beyond ±2^53, in creation order. Reads only. */
export async function lossyTables(client: D1Client, uuid: string): Promise<string[]> {
  return (await scan(client, uuid)).map((t) => t.name);
}

async function scan(client: D1Client, uuid: string): Promise<TableShape[]> {
  const shapes = (await tableShapes(client, uuid)).filter((t) => t.columns.length > 0);
  if (shapes.length === 0) return [];
  const counts = await client.batch(uuid, shapes.map((t) => ({ sql: `SELECT count(*) AS "bad" FROM ${q(t.name)} WHERE ${lossyRowCondition(t.columns)}` })));
  return shapes.filter((_, i) => Number(counts[i]?.[0]?.["bad"] ?? 0) > 0);
}

export interface LosslessExport {
  /** The tables written, in creation order. */
  readonly tables: readonly string[];
  readonly json: Uint8Array;
  readonly sql: Uint8Array;
}

type Value = null | string | { readonly integer: string } | { readonly real: number | "Infinity" | "-Infinity" } | { readonly blob: string };

const utf8 = new TextDecoder("utf-8", { fatal: false });
const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

function valueOf(type: unknown, raw: unknown): Value {
  switch (type) {
    case "null":
      return null;
    case "integer":
      return { integer: String(raw) };
    case "text":
      return utf8.decode(hexBytes(String(raw)));
    case "blob":
      return { blob: String(raw).toUpperCase() };
    default: {
      const n = Number(raw);
      return { real: Number.isFinite(n) ? n : n > 0 ? "Infinity" : "-Infinity" };
    }
  }
}

function literal(value: Value): string {
  if (value === null) return "NULL";
  if (typeof value === "string") {
    const hex = Buffer.from(value, "utf8").toString("hex").toUpperCase();
    return `CAST(X'${hex}' AS TEXT)`;
  }
  if ("integer" in value) return `CAST('${value.integer}' AS INTEGER)`;
  if ("blob" in value) return `X'${value.blob}'`;
  if (value.real === "Infinity") return "9e999";
  if (value.real === "-Infinity") return "-9e999";
  const text = String(value.real);
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

function selectValues(cols: readonly string[]): string {
  return cols
    .map((c, k) => `typeof(${q(c)}) AS "t${k}", CASE typeof(${q(c)}) WHEN 'integer' THEN CAST(${q(c)} AS TEXT) WHEN 'blob' THEN hex(${q(c)}) WHEN 'text' THEN hex(${q(c)}) ELSE ${q(c)} END AS "v${k}"`)
    .join(", ");
}

/** Every row of `table`, `pageRows` per read: by rowid, or by offset for a WITHOUT ROWID table. */
async function readRows(client: D1Client, uuid: string, table: TableShape, pageRows: number): Promise<Value[][]> {
  const rows: Value[][] = [];
  const toRow = (r: D1Row) => table.columns.map((_, k) => valueOf(r[`t${k}`], r[`v${k}`]));
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

/**
 * The lossless JSON and SQL of every table of database `uuid` that D1's dump would not keep
 * exactly; undefined when there is none. Reads only.
 */
export async function losslessExport(client: D1Client, uuid: string, database: string, pageRows = 1000): Promise<LosslessExport | undefined> {
  const tables = await scan(client, uuid);
  if (tables.length === 0) return undefined;
  const json: { table: string; columns: readonly string[]; rows: Value[][] }[] = [];
  const sql: string[] = ["PRAGMA defer_foreign_keys = on;"];
  for (const t of tables) {
    const rows = await readRows(client, uuid, t, pageRows);
    json.push({ table: t.name, columns: t.columns, rows });
    sql.push(`DELETE FROM ${q(t.name)};`);
    for (const row of rows) sql.push(`INSERT INTO ${q(t.name)} (${t.columns.map(q).join(", ")}) VALUES (${row.map(literal).join(", ")});`);
  }
  const encoder = new TextEncoder();
  return {
    tables: tables.map((t) => t.name),
    json: encoder.encode(`${JSON.stringify({ format: "prototype-framework lossless rows 1", database, tables: json })}\n`),
    sql: encoder.encode(`${sql.join("\n")}\n`),
  };
}
