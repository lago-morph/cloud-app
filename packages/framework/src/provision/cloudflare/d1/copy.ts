/**
 * Cloudflare's database copy: the fallback page-by-page copy (DEC-0096; migrations.md §2
 * "Cloudflare"), ported from spike A-06's `fallback_copy.py`. Never D1 export/import.
 *
 * 1. Read the source's schema (`sqlite_master`), columns and references (`PRAGMA table_info`,
 *    `PRAGMA foreign_key_list`), and each table's row count and value bytes.
 * 2. Group tables into strongly connected components of the reference graph, parents first.
 * 3. Read values as (type, exact text form) and write them in pages: each page is one atomic
 *    `/query` batch of `PRAGMA defer_foreign_keys = on` and multi-row INSERTs with at most
 *    PAR-216 bound parameters per statement; a page holds at most PAR-218's rows and value bytes,
 *    and a single larger row goes alone. The first page also creates the tables; the last also
 *    creates indexes, triggers and views and copies `sqlite_sequence`.
 * 4. Values are bound by stored type: integer → `CAST(? AS INTEGER)` from decimal text (D1 binds
 *    JSON numbers as REAL), real → JSON number, text → string, blob → `unhex(?)` from hex,
 *    null → `NULL`. The hidden rowid is copied, so the copy keeps scan order.
 *
 * Cost for a small database (everything within one page): three metadata reads, one value
 * read and one write request; rows read ≈ 2 × rows (sizes, values), rows written = rows plus
 * index entries. Larger tables add one size probe and one value read per page. A reference
 * cycle (a self-reference, or tables referencing each other) that does not fit one page also
 * reads its rowids and keys once to order rows parents first, and a row cycle never spans pages.
 */
import type { D1Client, D1Row, D1Statement } from "./client.js";
import { foldCase } from "./native-copy.js";

export interface CopyLimits {
  /** PAR-218: rows per write request. */
  readonly pageRows: number;
  /** PAR-218: bytes of values per write request (a single larger row is sent alone). */
  readonly pageBytes: number;
  /** PAR-216: bound parameters per statement. */
  readonly maxParams: number;
}

export const DEFAULT_COPY_LIMITS: CopyLimits = { pageRows: 1000, pageBytes: 1_000_000, maxParams: 100 };

export interface CopyStats {
  readonly requests: number;
  readonly writePages: number;
  readonly rows: number;
}

interface TableMeta {
  readonly name: string;
  /** Copied columns: `rowid` first unless the table has an INTEGER PRIMARY KEY alias. */
  readonly cols: readonly string[];
  readonly pk: readonly string[];
  /** References: parent table, local column. */
  readonly refs: readonly { readonly parent: string; readonly from: string }[];
  readonly rows: number;
  readonly bytes: number;
}

/** One row as read: per copied column, its `typeof` and its value in exact transport form. */
type Row = readonly { readonly type: string; readonly value: unknown }[];
interface Unit {
  readonly table: TableMeta;
  readonly row: Row;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const utf8 = new TextEncoder();
const NOT_INTERNAL = `"name" NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND "name" NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;

function selectValues(cols: readonly string[]): string {
  return cols
    .map((c, k) => `typeof(${q(c)}) AS "t${k}", CASE typeof(${q(c)}) WHEN 'integer' THEN CAST(${q(c)} AS TEXT) WHEN 'blob' THEN hex(${q(c)}) ELSE ${q(c)} END AS "v${k}"`)
    .join(", ");
}
const sizeExpr = (cols: readonly string[]) => cols.map((c) => `coalesce(length(CAST(${q(c)} AS BLOB)), 0)`).join(" + ");

/** A value's placeholder and bound parameter, by stored type (A-06: JSON numbers bind as REAL). */
function bind(type: string, value: unknown): [string, string | number | undefined] {
  if (type === "null") return ["NULL", undefined];
  if (type === "integer") return ["CAST(? AS INTEGER)", String(value)];
  if (type === "blob") return ["unhex(?)", String(value)];
  if (type === "real") return ["?", Number(value)];
  return ["?", String(value)];
}

function toRow(r: D1Row, n: number): Row {
  return Array.from({ length: n }, (_, k) => ({ type: String(r[`t${k}`]), value: r[`v${k}`] }));
}

function rowBytes(row: Row): number {
  let n = 0;
  for (const { type, value } of row) {
    if (type === "text") n += utf8.encode(String(value)).length;
    else if (type === "blob") n += String(value).length / 2;
    else if (type !== "null") n += 8;
  }
  return n;
}

/** Strongly connected components, each after the components it points to (edges: node → parents). */
export function componentsParentsFirst<T>(nodes: readonly T[], parents: (node: T) => readonly T[]): T[][] {
  const index = new Map<T, number>();
  const low = new Map<T, number>();
  const onStack = new Set<T>();
  const stack: T[] = [];
  const out: T[][] = [];
  let counter = 0;
  // iterative Tarjan: a deep reference chain must not overflow the call stack
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { node: T; edges: readonly T[]; i: number }[] = [];
    const enter = (v: T) => {
      index.set(v, counter);
      low.set(v, counter);
      counter += 1;
      stack.push(v);
      onStack.add(v);
      work.push({ node: v, edges: parents(v), i: 0 });
    };
    enter(start);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: T; edges: readonly T[]; i: number };
      if (frame.i < frame.edges.length) {
        const w = frame.edges[frame.i] as T;
        frame.i += 1;
        if (!index.has(w)) enter(w);
        else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(w) as number));
        continue;
      }
      work.pop();
      const v = frame.node;
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(v) as number));
      if (low.get(v) === index.get(v)) {
        const comp: T[] = [];
        for (;;) {
          const w = stack.pop() as T;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        out.push(comp);
      }
    }
  }
  return out;
}

export async function copyD1Database(client: D1Client, from: string, to: string, limits: CopyLimits = DEFAULT_COPY_LIMITS): Promise<CopyStats> {
  let requests = 0;
  let writePages = 0;
  let copiedRows = 0;
  const read = (statements: readonly D1Statement[]) => {
    requests += 1;
    return client.batch(from, statements);
  };

  // 1. Schema, columns, references, sizes.
  const [master = []] = await read([{ sql: `SELECT "type", "name", "sql" FROM sqlite_master WHERE "sql" IS NOT NULL AND ${NOT_INTERNAL} ORDER BY rowid` }]);
  const tableDdl = master.filter((m) => m["type"] === "table");
  const laterDdl = master.filter((m) => m["type"] !== "table").map((m) => String(m["sql"]));
  const names = tableDdl.map((m) => String(m["name"]));
  const usesSequence = tableDdl.some((m) => /AUTOINCREMENT/i.test(String(m["sql"])));
  const info = names.length === 0 ? [] : await read(names.flatMap((t) => [{ sql: `PRAGMA table_info(${q(t)})` }, { sql: `PRAGMA foreign_key_list(${q(t)})` }]));
  const shapes = names.map((name, i) => {
    const columns = info[2 * i] ?? [];
    const pkCols = columns.filter((c) => Number(c["pk"]) > 0).sort((a, b) => Number(a["pk"]) - Number(b["pk"]));
    const alias = pkCols.length === 1 && String(pkCols[0]?.["type"]).toUpperCase() === "INTEGER";
    const cols = [...(alias ? [] : ["rowid"]), ...columns.map((c) => String(c["name"]))];
    if (cols.length > limits.maxParams) {
      throw new Error(`table ${name} has ${cols.length} columns including rowid; the copy binds at most ${limits.maxParams} values per statement (PAR-216)`);
    }
    // SQLite matches table names without regard to ASCII case: a reference names its parent's canonical spelling here.
    const refs = (info[2 * i + 1] ?? [])
      .map((f) => ({ parent: names.find((n) => foldCase(n) === foldCase(String(f["table"]))), from: String(f["from"]) }))
      .filter((f): f is { parent: string; from: string } => f.parent !== undefined);
    return { name, cols, pk: pkCols.map((c) => String(c["name"])), refs };
  });
  const sizes =
    names.length === 0
      ? []
      : await read([
          ...shapes.map((s) => ({ sql: `SELECT count(*) AS "n", coalesce(sum(${sizeExpr(s.cols)}), 0) AS "b" FROM ${q(s.name)}` })),
          ...(usesSequence ? [{ sql: `SELECT "name", CAST("seq" AS TEXT) AS "seq" FROM sqlite_sequence` }] : []),
        ]);
  const tables = new Map<string, TableMeta>(shapes.map((s, i) => [s.name, { ...s, rows: Number(sizes[i]?.[0]?.["n"] ?? 0), bytes: Number(sizes[i]?.[0]?.["b"] ?? 0) }]));
  const sequence = usesSequence ? (sizes[shapes.length] ?? []) : [];

  // 3. Writer: pages within the limits, the table DDL in the first page, the rest in the last.
  let pending: Unit[] = [];
  let pendingBytes = 0;
  let first = true;
  const insertStatements = (units: readonly Unit[]): D1Statement[] => {
    const out: D1Statement[] = [];
    let i = 0;
    while (i < units.length) {
      const table = (units[i] as Unit).table;
      let tuples: string[] = [];
      let params: (string | number | null)[] = [];
      const emit = () => {
        if (tuples.length === 0) return;
        out.push({ sql: `INSERT INTO ${q(table.name)} (${table.cols.map(q).join(", ")}) VALUES ${tuples.join(", ")}`, params });
        tuples = [];
        params = [];
      };
      for (; i < units.length && (units[i] as Unit).table === table; i += 1) {
        const parts: string[] = [];
        const rowParams: (string | number | null)[] = [];
        for (const { type, value } of (units[i] as Unit).row) {
          const [sql, param] = bind(type, value);
          parts.push(sql);
          if (param !== undefined) rowParams.push(param);
        }
        if (params.length + rowParams.length > limits.maxParams) emit();
        tuples.push(`(${parts.join(", ")})`);
        params.push(...rowParams);
      }
      emit();
    }
    return out;
  };
  const flush = async (last: boolean) => {
    if (pending.length === 0 && !first && !last) return;
    const statements: D1Statement[] = [{ sql: "PRAGMA defer_foreign_keys = on" }];
    if (first) statements.push(...tableDdl.map((m) => ({ sql: String(m["sql"]) })));
    statements.push(...insertStatements(pending));
    if (last) {
      statements.push(...laterDdl.map((sql) => ({ sql })));
      if (sequence.length > 0) {
        statements.push({ sql: "DELETE FROM sqlite_sequence" });
        for (const s of sequence) statements.push({ sql: `INSERT INTO sqlite_sequence ("name", "seq") VALUES (?, CAST(? AS INTEGER))`, params: [String(s["name"]), String(s["seq"])] });
      }
    }
    requests += 1;
    writePages += 1;
    await client.batch(to, statements);
    copiedRows += pending.length;
    pending = [];
    pendingBytes = 0;
    first = false;
  };
  /** Adds rows that must share one page (a row cycle). */
  const add = async (group: readonly Unit[]) => {
    const bytes = group.reduce((n, u) => n + rowBytes(u.row), 0);
    if (pending.length > 0 && (pending.length + group.length > limits.pageRows || pendingBytes + bytes > limits.pageBytes)) await flush(false);
    pending.push(...group);
    pendingBytes += bytes;
  };

  // Reads of whole tables that fit one page are batched into one request until the batch is full.
  let readBatch: { kind: "table" | "group"; tables: TableMeta[] }[] = [];
  let batchRows = 0;
  let batchBytes = 0;
  const flushReads = async () => {
    if (readBatch.length === 0) return;
    const all = readBatch.flatMap((u) => u.tables);
    const results = await read(all.map((t) => ({ sql: `SELECT ${selectValues(t.cols)} FROM ${q(t.name)} ORDER BY rowid` })));
    let k = 0;
    for (const unit of readBatch) {
      const groupUnits: Unit[] = [];
      for (const t of unit.tables) {
        const rows = (results[k] ?? []).map((r) => ({ table: t, row: toRow(r, t.cols.length) }));
        k += 1;
        if (unit.kind === "group") groupUnits.push(...rows);
        else for (const u of rows) await add([u]);
      }
      if (groupUnits.length > 0) await add(groupUnits);
    }
    readBatch = [];
    batchRows = 0;
    batchBytes = 0;
  };
  const queueRead = async (kind: "table" | "group", group: TableMeta[], rows: number, bytes: number) => {
    if (readBatch.length > 0 && (batchRows + rows > limits.pageRows || batchBytes + bytes > limits.pageBytes)) await flushReads();
    readBatch.push({ kind, tables: group });
    batchRows += rows;
    batchBytes += bytes;
  };
  const fits = (rows: number, bytes: number) => rows <= limits.pageRows && bytes <= limits.pageBytes;

  // 2. Groups, parents first.
  const groups = componentsParentsFirst(names, (t) => (tables.get(t) as TableMeta).refs.map((r) => r.parent));
  for (const groupNames of groups) {
    const group = groupNames.map((t) => tables.get(t) as TableMeta);
    const rows = group.reduce((n, t) => n + t.rows, 0);
    const bytes = group.reduce((n, t) => n + t.bytes, 0);
    if (rows === 0) continue;
    const cyclic = group.length > 1 || (group[0] as TableMeta).refs.some((r) => r.parent === (group[0] as TableMeta).name);
    if (fits(rows, bytes)) {
      await queueRead(cyclic ? "group" : "table", group, rows, bytes);
      continue;
    }
    await flushReads();
    if (!cyclic) await copyLargeTable(group[0] as TableMeta);
    else await copyLargeCycle(group);
  }
  await flushReads();
  await flush(true);
  return { requests, writePages, rows: copiedRows };

  /** An acyclic table larger than a page: size probe, then a rowid range, per page. */
  async function copyLargeTable(t: TableMeta): Promise<void> {
    let last: string | null = null;
    for (;;) {
      const [probe = []] = await read([
        {
          sql: `SELECT CAST(rowid AS TEXT) AS "r", ${sizeExpr(t.cols)} AS "s" FROM ${q(t.name)}${last === null ? "" : " WHERE rowid > CAST(? AS INTEGER)"} ORDER BY rowid LIMIT ${limits.pageRows}`,
          ...(last === null ? {} : { params: [last] }),
        },
      ]);
      if (probe.length === 0) return;
      let take = 0;
      let acc = 0;
      for (const p of probe) {
        const s = Number(p["s"]);
        if (take > 0 && acc + s > limits.pageBytes) break;
        take += 1;
        acc += s;
      }
      const lo = String(probe[0]?.["r"]);
      const hi = String(probe[take - 1]?.["r"]);
      const [values = []] = await read([
        { sql: `SELECT ${selectValues(t.cols)} FROM ${q(t.name)} WHERE rowid BETWEEN CAST(? AS INTEGER) AND CAST(? AS INTEGER) ORDER BY rowid`, params: [lo, hi] },
      ]);
      for (const r of values) await add([{ table: t, row: toRow(r, t.cols.length) }]);
      if (take === probe.length && probe.length < limits.pageRows) return;
      last = hi;
    }
  }

  /** A reference cycle larger than a page: order rows parents first by their keys, never split a row cycle. */
  async function copyLargeCycle(group: readonly TableMeta[]): Promise<void> {
    const inGroup = new Set(group.map((t) => t.name));
    const nodes: string[] = [];
    const nodeTable = new Map<string, TableMeta>();
    const nodeRowid = new Map<string, string>();
    const nodeBytes = new Map<string, number>();
    const byKey = new Map<string, string>();
    const parentKeys = new Map<string, string[]>();
    const metas = await read(
      group.map((t) => ({
        sql: `SELECT CAST(rowid AS TEXT) AS "r", ${sizeExpr(t.cols)} AS "s"${t.pk.map((c, k) => `, ${q(c)} AS "k${k}"`).join("")}${t.refs
          .filter((r) => inGroup.has(r.parent))
          .map((r, k) => `, ${q(r.from)} AS "f${k}"`)
          .join("")} FROM ${q(t.name)} ORDER BY rowid`,
      })),
    );
    group.forEach((t, i) => {
      const refs = t.refs.filter((r) => inGroup.has(r.parent));
      for (const m of metas[i] ?? []) {
        const node = `${t.name}\u0000${String(m["r"])}`;
        nodes.push(node);
        nodeTable.set(node, t);
        nodeRowid.set(node, String(m["r"]));
        nodeBytes.set(node, Number(m["s"]));
        byKey.set(JSON.stringify([t.name, ...t.pk.map((_, k) => m[`k${k}`])]), node);
        parentKeys.set(
          node,
          refs.flatMap((r, k) => (m[`f${k}`] === null || m[`f${k}`] === undefined ? [] : [JSON.stringify([r.parent, m[`f${k}`]])])),
        );
      }
    });
    const parentsOf = (node: string) => (parentKeys.get(node) ?? []).flatMap((key) => (byKey.has(key) ? [byKey.get(key) as string] : []));
    const rowCycles = componentsParentsFirst(nodes, parentsOf);
    // Read values in rowid lists of at most maxParams ids, up to a page of rows/bytes per request,
    // in the order the cycles are emitted; then emit each cycle as one unit.
    const values = new Map<string, Row>();
    let pos = 0;
    const order = rowCycles.flat();
    const emitted = { cycles: 0 };
    while (pos < order.length) {
      const chunk: string[] = [];
      let bytes = 0;
      while (pos < order.length && (chunk.length === 0 || (chunk.length < limits.pageRows && bytes + (nodeBytes.get(order[pos] as string) ?? 0) <= limits.pageBytes))) {
        const node = order[pos] as string;
        chunk.push(node);
        bytes += nodeBytes.get(node) ?? 0;
        pos += 1;
      }
      const statements: D1Statement[] = [];
      const owners: TableMeta[] = [];
      for (const t of group) {
        const ids = chunk.filter((n) => nodeTable.get(n) === t).map((n) => nodeRowid.get(n) as string);
        for (let i = 0; i < ids.length; i += limits.maxParams) {
          const part = ids.slice(i, i + limits.maxParams);
          statements.push({
            sql: `SELECT CAST(rowid AS TEXT) AS "__r", ${selectValues(t.cols)} FROM ${q(t.name)} WHERE rowid IN (${part.map(() => "CAST(? AS INTEGER)").join(", ")})`,
            params: part,
          });
          owners.push(t);
        }
      }
      const results = await read(statements);
      results.forEach((rows, i) => {
        const t = owners[i] as TableMeta;
        for (const r of rows) values.set(`${t.name}\u0000${String(r["__r"])}`, toRow(r, t.cols.length));
      });
      // emit every cycle whose rows are all read
      while (emitted.cycles < rowCycles.length && (rowCycles[emitted.cycles] as string[]).every((n) => values.has(n))) {
        const cycle = rowCycles[emitted.cycles] as string[];
        await add(cycle.map((n) => ({ table: nodeTable.get(n) as TableMeta, row: values.get(n) as Row })));
        for (const n of cycle) values.delete(n);
        emitted.cycles += 1;
      }
    }
  }
}
