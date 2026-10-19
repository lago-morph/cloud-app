/**
 * SQL public names (contract: docs/contracts/ts/sql.d.ts; behavior: docs/components/sql.md).
 * Stub written by B-01; implemented by B-05 and B-06.
 */
import type { ColumnDataType, SQL, SQLWrapper } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT, PgTable, PgTableWithColumns } from "drizzle-orm/pg-core";

// ---- Schema definition -------------------------------------------------------------

/** What a column helper returns; consumed only by `defineTable`. Columns are NOT NULL unless `.nullable()`. */
export interface ColumnBuilder<T, Nullable extends boolean = false, HasDefault extends boolean = false> {
  /** Type-level only; not present at runtime. */
  readonly _: { readonly data: T; readonly nullable: Nullable; readonly hasDefault: HasDefault };
  nullable(): ColumnBuilder<T, true, HasDefault>;
  unique(): ColumnBuilder<T, Nullable, HasDefault>;
  /** A static value checked against the column type. No SQL expressions. */
  default(value: T): ColumnBuilder<T, Nullable, true>;
}

/** A column of a defined table (e.g. `notes.title`): Drizzle's `PgColumn`, restricted. */
export type Column<
  T = unknown,
  Nullable extends boolean = boolean,
  HasDefault extends boolean = boolean,
  TableName extends string = string,
> = PgColumn<{
  name: string;
  tableName: TableName;
  dataType: ColumnDataType;
  columnType: string;
  data: T;
  driverParam: unknown;
  notNull: Nullable extends true ? false : true;
  hasDefault: HasDefault;
  isPrimaryKey: boolean;
  isAutoincrement: false;
  hasRuntimeDefault: false;
  enumValues: undefined;
  identity: undefined;
  generated: undefined;
}>;

function notImplemented(name: string): never {
  throw new Error(`not implemented: ${name}`);
}

/** Text primary key holding a framework-generated ID (see newId). Immutable. */
export function id(): ColumnBuilder<string> {
  return notImplemented("id");
}
/** Text compared by binary (code point) order. */
export function text(): ColumnBuilder<string> {
  return notImplemented("text");
}
/** Signed 32-bit integer. */
export function integer(): ColumnBuilder<number> {
  return notImplemented("integer");
}
/** Finite double-precision number. */
export function number(): ColumnBuilder<number> {
  return notImplemented("number");
}
/** Epoch milliseconds, non-negative safe integer. */
export function timestamp(): ColumnBuilder<number> {
  return notImplemented("timestamp");
}
export function boolean(): ColumnBuilder<boolean> {
  return notImplemented("boolean");
}
/** Reference to another table's id column. */
export function ref(target: () => Column<string, false>): ColumnBuilder<string> {
  return notImplemented("ref");
}

export type ColumnBuilders = Record<string, ColumnBuilder<unknown, boolean, boolean>>;

/** Each entry lists column keys of the table being defined. */
export interface TableOptions<Cols extends ColumnBuilders = ColumnBuilders> {
  readonly indexes?: readonly (readonly (keyof Cols & string)[])[];
  readonly uniques?: readonly (readonly (keyof Cols & string)[])[];
}

/** Table handle: columns accessible by key; `$inferSelect` / `$inferInsert` give row types. */
export type Table<Cols extends ColumnBuilders = ColumnBuilders, Name extends string = string> = PgTableWithColumns<{
  name: Name;
  schema: undefined;
  dialect: "pg";
  columns: {
    [K in keyof Cols & string]: Cols[K] extends ColumnBuilder<infer T, infer N, infer D> ? Column<T, N, D, Name> : never;
  };
}>;

/** Any defined table, whatever its columns (e.g. for the `tables` record). */
export type AnyTable = PgTable;

export function defineTable<const Name extends string, const Cols extends ColumnBuilders>(
  name: Name,
  columns: Cols,
  options?: TableOptions<Cols>,
): Table<Cols, Name> {
  return notImplemented("defineTable");
}

/** The `tables` record. Its keys are informative only; SQL names come from `defineTable`. */
export type TableDefinitions = Record<string, AnyTable>;

// ---- Values ------------------------------------------------------------------------

/** New random ID for an `id()` column (UUID v4 text). */
export function newId(): string {
  return notImplemented("newId");
}
/** Current time as a `timestamp()` value. */
export function now(): number {
  return notImplemented("now");
}

// ---- Queries -----------------------------------------------------------------------

/** Writes without `returning()` resolve to `void` on every target. */
export interface PortableQueryResult extends PgQueryResultHKT {
  readonly type: void;
}

/** The database handle in `c.var.sql`. Supported features: docs/components/sql.md §2.3. */
export type PortableDb = Pick<
  PgDatabase<PortableQueryResult>,
  "select" | "selectDistinct" | "insert" | "update" | "delete" | "$with" | "with"
>;

/** Write-only handle passed to `atomic` step factories (named context shape). */
export type WriteDb = Pick<PgDatabase<PortableQueryResult>, "insert" | "update" | "delete">;

/** One step of an atomic unit: synchronously builds a single write on the handle it is given. */
export type WriteStep<R = unknown> = (db: WriteDb) => { execute(): Promise<R> };

/** Per step, the result type of that step's write. */
export type AtomicResults<Steps extends readonly WriteStep[]> = {
  -readonly [K in keyof Steps]: ReturnType<Steps[K]> extends { execute(): Promise<infer R> } ? R : never;
};

/** Applies all steps as one all-or-nothing unit. */
export function atomic<const Steps extends readonly WriteStep[]>(
  db: PortableDb,
  steps: Steps,
): Promise<AtomicResults<Steps>> {
  return notImplemented("atomic");
}

// Supported expressions: Drizzle's own, re-exported unchanged in signature.
export { eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between } from "drizzle-orm";
// Aggregates: Drizzle's signatures; results are normalized as sql.md SQL-REQ-003 states.
export { count, countDistinct, min, max } from "drizzle-orm";

/** Sum as a JS number (SQL-REQ-003); null on empty input. */
export function sum(expression: SQLWrapper): SQL<number | null> {
  return notImplemented("sum");
}
/** Average as a JS number (SQL-REQ-003); null on empty input. */
export function avg(expression: SQLWrapper): SQL<number | null> {
  return notImplemented("avg");
}

/** Ascending, NULLs first. */
export function asc(column: Column): SQL {
  return notImplemented("asc");
}
/** Descending, NULLs last. */
export function desc(column: Column): SQL {
  return notImplemented("desc");
}
/** Literal substring match, case-insensitive for ASCII A–Z only. */
export function containsText(column: Column<string>, needle: string): SQL {
  return notImplemented("containsText");
}
