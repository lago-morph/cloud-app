/**
 * `defineTable` (sql.md §2.1, §2.2, SQL-REQ-001). A definition is checked once, kept in a
 * dialect-neutral form, and built into the Drizzle table of the process's dialect; the other
 * dialect's table is built on demand (`tableFor`) for migration generation and tests.
 *
 * Built tables carry explicit snake_case SQL names for columns, indexes, unique constraints
 * and foreign keys, so no driver or drizzle-kit casing option is involved. Every column's
 * `mapToDriverValue` checks the column rule first, so a bound value that breaks it raises
 * `SQL.INVALID_VALUE` while the query is built, before the database sees it.
 */
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  doublePrecision as pgDouble,
  foreignKey as pgForeignKey,
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  text as pgText,
  unique as pgUnique,
} from "drizzle-orm/pg-core";
import {
  foreignKey as sqliteForeignKey,
  index as sqliteIndex,
  integer as sqliteInteger,
  real as sqliteReal,
  sqliteTable,
  text as sqliteText,
  unique as sqliteUnique,
} from "drizzle-orm/sqlite-core";
import { FrameworkError } from "../core/errors.js";
import { columnSpec, type ColumnSpec } from "./columns.js";
import { processDialect, type Dialect } from "./dialect.js";
import { checkColumnKey, checkTableName, MAX_NAME_BYTES, snakeCase } from "./names.js";
import type { ColumnBuilders, Table, TableOptions } from "./types.js";
import { checkValue } from "./values.js";

/** A checked, dialect-neutral table definition. */
export interface TableDefinition {
  readonly name: string;
  /** Column key → spec, in declaration order. */
  readonly columns: Readonly<Record<string, ColumnSpec>>;
  readonly indexes: readonly (readonly string[])[];
  readonly uniques: readonly (readonly string[])[];
  readonly framework: boolean;
}

interface Entry {
  readonly def: TableDefinition;
  readonly built: Partial<Record<Dialect, DrizzleTable>>;
}

/** `TableOptions` of any column set, as checked at runtime. */
interface LooseOptions {
  readonly indexes?: readonly (readonly string[])[] | undefined;
  readonly uniques?: readonly (readonly string[])[] | undefined;
}

/** A Drizzle table of either dialect, indexed by column key. */
type DrizzleTable = Record<string, unknown> & object;

const entries = new WeakMap<object, Entry>();
const columnOwners = new WeakMap<object, { entry: Entry; key: string }>();

function misconfigured(message: string): never {
  throw new FrameworkError("CORE.MISCONFIGURED", message);
}

export function defineTable<const Name extends string, const Cols extends ColumnBuilders>(
  name: Name,
  columns: Cols,
  options?: TableOptions<Cols>,
): Table<Cols, Name> {
  const entry: Entry = { def: checkDefinition(name, columns, options, false), built: {} };
  return build(entry, processDialect()) as unknown as Table<Cols, Name>;
}

/** Framework tables (`__framework_…`) use this: the reserved prefix is allowed. */
export function defineFrameworkTable<const Name extends string, const Cols extends ColumnBuilders>(
  name: Name,
  columns: Cols,
  options?: TableOptions<Cols>,
): Table<Cols, Name> {
  const entry: Entry = { def: checkDefinition(name, columns, options, true), built: {} };
  return build(entry, processDialect()) as unknown as Table<Cols, Name>;
}

/** The neutral definition of a table made by `defineTable`, in either dialect. */
export function tableDefinition(table: unknown): TableDefinition | undefined {
  return typeof table === "object" && table !== null ? entries.get(table)?.def : undefined;
}

/** The same defined table built for `dialect` (memoized; the process dialect's table is the one `defineTable` returned). */
export function tableFor(table: unknown, dialect: Dialect): DrizzleTable {
  const entry = typeof table === "object" && table !== null ? entries.get(table) : undefined;
  if (entry === undefined) misconfigured("tableFor: not a table made by defineTable");
  return build(entry, dialect);
}

function checkDefinition(name: string, columns: ColumnBuilders, options: LooseOptions | undefined, framework: boolean): TableDefinition {
  checkTableName(name, { framework });
  const quoted = JSON.stringify(name);
  if (typeof columns !== "object" || columns === null) misconfigured(`table ${quoted}: columns must be an object of column helpers`);

  const specs: Record<string, ColumnSpec> = {};
  for (const [key, value] of Object.entries(columns)) {
    checkColumnKey(name, key);
    const spec = columnSpec(value);
    if (spec === undefined) {
      misconfigured(`column ${JSON.stringify(key)} of table ${quoted} is not made by a framework column helper (id, text, integer, number, timestamp, boolean, ref)`);
    }
    if (spec.extraRefArguments) {
      misconfigured(`column ${JSON.stringify(key)} of table ${quoted}: ref() takes only its target column; reference actions (onDelete/onUpdate) are not supported: deleting a referenced row fails while references exist`);
    }
    specs[key] = spec;
  }
  const ids = Object.values(specs).filter((s) => s.kind === "id").length;
  if (ids !== 1) misconfigured(`table ${quoted} has ${ids} id() columns; it must have exactly one id() column, its primary key`);

  for (const option of Object.keys(options ?? {})) {
    if (option !== "indexes" && option !== "uniques") {
      misconfigured(`table ${quoted}: option ${JSON.stringify(option)} is not supported; only "indexes" and "uniques" are`);
    }
  }
  const lists = (kind: "indexes" | "uniques"): string[][] => {
    const raw = options?.[kind] ?? [];
    return raw.map((entry) => {
      if (!Array.isArray(entry) || entry.length === 0) misconfigured(`table ${quoted}: each ${kind} entry must list at least one column key`);
      const seen = new Set<string>();
      for (const key of entry as readonly string[]) {
        if (!(key in specs)) misconfigured(`table ${quoted}: ${kind} entry names unknown column key ${JSON.stringify(key)}`);
        if (seen.has(key)) misconfigured(`table ${quoted}: ${kind} entry lists column key ${JSON.stringify(key)} twice`);
        seen.add(key);
      }
      return [...(entry as readonly string[])];
    });
  };
  const indexes = lists("indexes");
  const uniques = lists("uniques");

  const uniqueSets = new Set<string>();
  const allUniques = [...Object.entries(specs).filter(([, s]) => s.unique).map(([k]) => [k]), ...uniques];
  for (const set of allUniques) {
    const canonical = [...set].sort().join(",");
    if (uniqueSets.has(canonical)) misconfigured(`table ${quoted}: the unique column set [${set.join(", ")}] is declared twice`);
    uniqueSets.add(canonical);
  }

  const names = [
    ...indexes.map((keys) => indexName(name, keys)),
    ...allUniques.map((keys) => uniqueName(name, keys)),
    ...Object.entries(specs).filter(([, s]) => s.kind === "ref").map(([k]) => foreignKeyName(name, k)),
  ];
  for (const generated of names) {
    if (generated.length > MAX_NAME_BYTES) {
      misconfigured(`table ${quoted}: the generated constraint or index name ${JSON.stringify(generated)} is longer than ${MAX_NAME_BYTES} characters; shorten the table name or column keys`);
    }
  }

  return { name, columns: specs, indexes, uniques, framework };
}

function indexName(table: string, keys: readonly string[]): string {
  return `${table}_${keys.map(snakeCase).join("_")}_idx`;
}
function uniqueName(table: string, keys: readonly string[]): string {
  return `${table}_${keys.map(snakeCase).join("_")}_unique`;
}
function foreignKeyName(table: string, key: string): string {
  return `${table}_${snakeCase(key)}_fk`;
}

// ---- Building ----------------------------------------------------------------------

/** Column builder methods shared by both dialects' Drizzle builders (structural). */
interface DrizzleColumnBuilder {
  notNull(): DrizzleColumnBuilder;
  primaryKey(): DrizzleColumnBuilder;
  unique(name?: string): DrizzleColumnBuilder;
  default(value: unknown): DrizzleColumnBuilder;
}

function dialectColumn(dialect: Dialect, sqlName: string, spec: ColumnSpec): DrizzleColumnBuilder {
  const b = (x: unknown) => x as DrizzleColumnBuilder;
  if (dialect === "sqlite") {
    switch (spec.kind) {
      case "id":
      case "text":
      case "ref":
        return b(sqliteText(sqlName));
      case "integer":
      case "timestamp":
        return b(sqliteInteger(sqlName, { mode: "number" }));
      case "number":
        return b(sqliteReal(sqlName));
      case "boolean":
        return b(sqliteInteger(sqlName, { mode: "boolean" }));
    }
  }
  switch (spec.kind) {
    case "id":
    case "text":
    case "ref":
      return b(pgText(sqlName));
    case "integer":
      return b(pgInteger(sqlName));
    case "number":
      return b(pgDouble(sqlName));
    case "timestamp":
      return b(pgBigint(sqlName, { mode: "number" }));
    case "boolean":
      return b(pgBoolean(sqlName));
  }
}

function build(entry: Entry, dialect: Dialect): DrizzleTable {
  const existing = entry.built[dialect];
  if (existing !== undefined) return existing;
  const { def } = entry;

  const columns: Record<string, DrizzleColumnBuilder> = {};
  for (const [key, spec] of Object.entries(def.columns)) {
    let col = dialectColumn(dialect, snakeCase(key), spec);
    if (spec.kind === "id") col = col.primaryKey();
    if (!spec.nullable) col = col.notNull();
    if (spec.unique) col = col.unique(uniqueName(def.name, [key]));
    if (spec.hasDefault) col = col.default(spec.defaultValue);
    columns[key] = col;
  }

  const extra = (self: Record<string, unknown>): unknown[] => {
    const cols = (keys: readonly string[]) => keys.map((k) => self[k]) as [never, ...never[]];
    const index = dialect === "sqlite" ? sqliteIndex : pgIndex;
    const unique = dialect === "sqlite" ? sqliteUnique : pgUnique;
    const foreignKey = (dialect === "sqlite" ? sqliteForeignKey : pgForeignKey) as (config: {
      name: string;
      columns: [never];
      foreignColumns: [never];
    }) => unknown;
    return [
      ...def.indexes.map((keys) => index(indexName(def.name, keys)).on(...cols(keys))),
      ...def.uniques.map((keys) => unique(uniqueName(def.name, keys)).on(...cols(keys))),
      ...Object.entries(def.columns)
        .filter(([, spec]) => spec.kind === "ref")
        .map(([key, spec]) =>
          foreignKey({
            name: foreignKeyName(def.name, key),
            columns: [self[key] as never],
            foreignColumns: [resolveRef(def.name, key, spec, dialect) as never],
          }),
        ),
    ];
  };

  const makeTable = (dialect === "sqlite" ? sqliteTable : pgTable) as unknown as (
    name: string,
    columns: Record<string, DrizzleColumnBuilder>,
    extra: (self: Record<string, unknown>) => unknown[],
  ) => DrizzleTable;
  const table = makeTable(def.name, columns, extra);

  for (const [key, spec] of Object.entries(def.columns)) {
    const column = table[key] as { mapToDriverValue(value: unknown): unknown };
    const original = column.mapToDriverValue.bind(column);
    const label = `${def.name}.${key}`;
    column.mapToDriverValue = (value: unknown) => original(checkValue(spec.kind, value, label));
    columnOwners.set(column, { entry, key });
  }
  entries.set(table, entry);
  entry.built[dialect] = table;
  return table;
}

// ---- Row checks (SQL-REQ-004) ---------------------------------------------------------

function invalidValue(message: string): never {
  throw new FrameworkError("SQL.INVALID_VALUE", message);
}

/**
 * Checks one row given to `insert(table).values(…)`: every column's value against its rule,
 * NULL only in nullable columns, and a value for every NOT NULL column without a default.
 * Tables not made by `defineTable` are left alone.
 */
export function checkInsertRow(table: unknown, row: unknown): void {
  const def = tableDefinition(table);
  if (def === undefined) return;
  if (typeof row !== "object" || row === null) invalidValue(`insert into ${def.name}: a row must be an object`);
  const values = row as Record<string, unknown>;
  for (const [key, spec] of Object.entries(def.columns)) {
    const value = values[key];
    const label = `${def.name}.${key}`;
    if (value === undefined) {
      if (!spec.nullable && !spec.hasDefault) invalidValue(`${label}: a value is required (NOT NULL, no default)`);
    } else if (value === null) {
      if (!spec.nullable) invalidValue(`${label}: null is not allowed (the column is NOT NULL)`);
    } else {
      checkValue(spec.kind, value, label);
    }
  }
}

/** Checks the values given to `update(table).set(…)` or an upsert's `set`; `id()` columns are immutable. */
export function checkUpdateSet(table: unknown, set: unknown): void {
  const def = tableDefinition(table);
  if (def === undefined) return;
  if (typeof set !== "object" || set === null) invalidValue(`update of ${def.name}: set must be an object`);
  for (const [key, value] of Object.entries(set)) {
    const spec = def.columns[key];
    if (spec === undefined || value === undefined) continue;
    const label = `${def.name}.${key}`;
    if (spec.kind === "id") invalidValue(`${label}: id() columns are immutable`);
    if (value === null) {
      if (!spec.nullable) invalidValue(`${label}: null is not allowed (the column is NOT NULL)`);
    } else {
      checkValue(spec.kind, value, label);
    }
  }
}

function resolveRef(table: string, key: string, spec: ColumnSpec, dialect: Dialect): unknown {
  const target = spec.target?.();
  const owner = typeof target === "object" && target !== null ? columnOwners.get(target) : undefined;
  if (owner === undefined || owner.entry.def.columns[owner.key]?.kind !== "id") {
    misconfigured(`column ${JSON.stringify(key)} of table ${JSON.stringify(table)}: ref() must return the id() column of a table made by defineTable`);
  }
  return build(owner.entry, dialect)[owner.key];
}
