/**
 * Logical-schema comparison of the two dialects (CHECK-REQ-004, MIG-REQ-001). Declared types
 * are compared through `logicalType` (SQLite has no boolean, bigint or double precision);
 * everything else — tables, columns, nullability, static defaults, primary keys, indexes,
 * unique column sets and references — must match exactly.
 */
import type { ColumnSchema, DatabaseSchema, TableSchema } from "./databases.js";

/** SQLite's storage class for a declared type of either dialect. */
export function logicalType(type: string): string {
  switch (type) {
    case "integer":
    case "bigint":
    case "smallint":
    case "boolean":
      return "integer";
    case "real":
    case "double precision":
    case "numeric":
      return "real";
    default:
      return type;
  }
}

const union = (a: Iterable<string>, b: Iterable<string>): string[] => [...new Set([...a, ...b])];

/** Differences between the SQLite and Postgres schemas, as sentences; empty when they match. */
export function compareDialects(sqlite: DatabaseSchema, postgres: DatabaseSchema): string[] {
  const out: string[] = [];
  const names = union(Object.keys(sqlite), Object.keys(postgres)).sort();
  for (const name of names) {
    if (postgres[name] === undefined) out.push(`table ${name} exists in sqlite but not in postgres`);
    else if (sqlite[name] === undefined) out.push(`table ${name} exists in postgres but not in sqlite`);
  }
  for (const name of names) {
    const s = sqlite[name];
    const p = postgres[name];
    if (s !== undefined && p !== undefined) out.push(...compareTables(name, s, p));
  }
  return out;
}

function compareTables(name: string, s: TableSchema, p: TableSchema): string[] {
  const out: string[] = [];
  for (const column of union(Object.keys(s.columns), Object.keys(p.columns))) {
    const sc = s.columns[column];
    const pc = p.columns[column];
    if (pc === undefined) out.push(`column ${name}.${column} exists in sqlite but not in postgres`);
    else if (sc === undefined) out.push(`column ${name}.${column} exists in postgres but not in sqlite`);
    else out.push(...compareColumns(`${name}.${column}`, sc, pc));
  }
  const sets: readonly [string, keyof Pick<TableSchema, "indexes" | "uniques" | "foreignKeys">, (x: string) => string][] = [
    ["index", "indexes", (x) => `(${x.split(",").join(", ")})`],
    ["unique", "uniques", (x) => `(${x.split(",").join(", ")})`],
    ["reference", "foreignKeys", (x) => x],
  ];
  for (const [what, key, show] of sets) {
    for (const x of s[key]) if (!p[key].includes(x)) out.push(`table ${name}: ${what} ${show(x)} exists in sqlite but not in postgres`);
    for (const x of p[key]) if (!s[key].includes(x)) out.push(`table ${name}: ${what} ${show(x)} exists in postgres but not in sqlite`);
  }
  return out;
}

function compareColumns(name: string, s: ColumnSchema, p: ColumnSchema): string[] {
  const out: string[] = [];
  if (logicalType(s.type) !== logicalType(p.type)) out.push(`column ${name}: type ${s.type} in sqlite but ${p.type} in postgres`);
  if (s.notNull !== p.notNull) out.push(`column ${name}: ${nullability(s.notNull)} in sqlite, ${nullability(p.notNull)} in postgres`);
  if (s.default !== p.default) out.push(`column ${name}: default ${s.default ?? "none"} in sqlite but ${p.default ?? "none"} in postgres`);
  if (s.primaryKey !== p.primaryKey) out.push(`column ${name}: ${s.primaryKey ? "primary key in sqlite, not in postgres" : "primary key in postgres, not in sqlite"}`);
  return out;
}

const nullability = (notNull: boolean): string => (notNull ? "NOT NULL" : "nullable");

const ADD_COPY_DROP_COLUMN =
  "Use the add-copy-drop pattern: add a new column (nullable or with a static default), copy the values in app code or an admin route, and drop the old column in a later migration (migrations.md §2).";
const ADD_COPY_DROP_TABLE = "Use the add-copy-drop pattern: add the new table, copy the rows in app code or an admin route, and drop the old table in a later migration (migrations.md §2).";

/**
 * The changes from `before` to `after` (one migration, one dialect) outside MIG §2's supported
 * list, as sentences naming the add-copy-drop pattern; empty when every change is supported.
 * Supported: add or drop a table; add a column that is nullable or has a static default; drop a
 * column (with its references); add or drop an index or a unique constraint. The judgement is by
 * the schema the migration leaves, not its statements, because drizzle-kit itself writes some
 * supported changes (a SQLite column drop with a reference) as a table rebuild.
 */
export function unsupportedChanges(before: DatabaseSchema, after: DatabaseSchema): string[] {
  const out: string[] = [];
  const removed = Object.keys(before).filter((t) => after[t] === undefined);
  const added = Object.keys(after).filter((t) => before[t] === undefined);
  if (removed.length > 0 && added.length > 0) {
    out.push(`this migration removes table${plural(removed)} ${removed.join(", ")} and adds table${plural(added)} ${added.join(", ")}: a table rename is not supported. ${ADD_COPY_DROP_TABLE}`);
  }
  for (const [name, now] of Object.entries(after)) {
    const was = before[name];
    if (was !== undefined) out.push(...tableChanges(name, was, now));
  }
  return out;
}

function tableChanges(name: string, was: TableSchema, now: TableSchema): string[] {
  const out: string[] = [];
  const gone = Object.keys(was.columns).filter((c) => now.columns[c] === undefined);
  const fresh = Object.keys(now.columns).filter((c) => was.columns[c] === undefined);
  if (gone.length > 0 && fresh.length > 0) {
    out.push(
      `this migration removes column${plural(gone)} ${gone.map((c) => `${name}.${c}`).join(", ")} and adds column${plural(fresh)} ${fresh.map((c) => `${name}.${c}`).join(", ")}: a column rename is not supported. ${ADD_COPY_DROP_COLUMN}`,
    );
  }
  for (const column of fresh) {
    const c = now.columns[column];
    if (c !== undefined && c.notNull && c.default === null) {
      out.push(`column ${name}.${column} is added to an existing table as NOT NULL without a static default; existing rows would have no value. Add it nullable or with a static default instead. ${ADD_COPY_DROP_COLUMN}`);
    }
  }
  for (const [column, c] of Object.entries(now.columns)) {
    const old = was.columns[column];
    if (old === undefined) continue;
    const changed = [
      old.type !== c.type ? `type (${old.type} to ${c.type})` : undefined,
      old.notNull !== c.notNull ? `nullability (${nullability(old.notNull)} to ${nullability(c.notNull)})` : undefined,
      old.default !== c.default ? `default (${old.default ?? "none"} to ${c.default ?? "none"})` : undefined,
      old.primaryKey !== c.primaryKey ? "primary key" : undefined,
    ].filter((x): x is string => x !== undefined);
    if (changed.length > 0) out.push(`column ${name}.${column} changes its ${changed.join(", ")}: changing an existing column is not supported. ${ADD_COPY_DROP_COLUMN}`);
  }
  const kept = (fk: string, columns: Readonly<Record<string, unknown>>, other: Readonly<Record<string, unknown>>): boolean =>
    (fk.split(" -> ")[0] ?? "").split(",").every((c) => c in columns && c in other);
  for (const fk of now.foreignKeys) {
    if (!was.foreignKeys.includes(fk) && kept(fk, was.columns, now.columns)) {
      out.push(`table ${name} gains reference ${fk} on an existing column: adding a reference to an existing column is not supported. ${ADD_COPY_DROP_COLUMN}`);
    }
  }
  for (const fk of was.foreignKeys) {
    if (!now.foreignKeys.includes(fk) && kept(fk, was.columns, now.columns)) {
      out.push(`table ${name} loses reference ${fk} while keeping its column: changing an existing column's reference is not supported. ${ADD_COPY_DROP_COLUMN}`);
    }
  }
  return out;
}

const plural = (xs: readonly unknown[]): string => (xs.length === 1 ? "" : "s");

const DATA = /^\s*(insert|update|delete|replace|truncate|merge)\b/i;
/** drizzle-kit's SQLite table rebuild copies rows into `__new_<table>`; that is not a data change. */
const REBUILD_COPY = /^\s*insert\s+into\s+[`"]?__new_[a-z0-9_]+[`"]?\s*\([^)]*\)\s*select\b/i;

/** Statements of one migration that change data rather than the schema, as sentences. */
export function dataStatements(statements: readonly string[]): string[] {
  return statements
    .filter((s) => DATA.test(s) && !REBUILD_COPY.test(s))
    .map((s) => {
      const verb = (DATA.exec(s)?.[1] ?? "").toUpperCase();
      return `statement ${verb} … changes data: a migration may only make the schema changes of migrations.md §2. Copy or fix data in app code or an admin route (the add-copy-drop pattern), not in a migration.`;
    });
}
