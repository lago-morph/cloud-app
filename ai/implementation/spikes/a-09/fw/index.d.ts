/**
 * Portable SQL (SQL). Behavior, supported subset, and per-type rules: docs/components/sql.md.
 *
 * The query builder is a restricted view of Drizzle ORM (PAR-102), typed with Drizzle's
 * own Postgres-flavoured types so app code gets full type checking. Only the members
 * declared or re-exported here are part of the contract, and only the features in
 * docs/components/sql.md §2.3 may be used; the portability rules (CHECK) reject the rest.
 *
 * `Table` and `Column` are framework-named aliases of restricted Drizzle pg-core table and
 * column types (`PgTableWithColumns`, `PgColumn`). They are accepted wherever the
 * `PortableDb` and `WriteDb` methods and the re-exported expressions take a table or a
 * column. App-facing code names the framework types, never Drizzle's.
 */
import type { ColumnDataType, SQL } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT, PgTableWithColumns } from "drizzle-orm/pg-core";

// ---- Schema definition -------------------------------------------------------------

/**
 * What a column helper returns; consumed only by `defineTable`. Columns are NOT NULL
 * unless `.nullable()` is called.
 */
export interface ColumnBuilder<T, Nullable extends boolean = false, HasDefault extends boolean = false> {
  /** Type-level only; not present at runtime. */
  readonly _: { readonly data: T; readonly nullable: Nullable; readonly hasDefault: HasDefault };
  nullable(): ColumnBuilder<T, true, HasDefault>;
  unique(): ColumnBuilder<T, Nullable, HasDefault>;
  /** A static value checked against the column type. No SQL expressions. */
  default(value: T): ColumnBuilder<T, Nullable, true>;
}

/** A column of a defined table (e.g. `notes.title`): Drizzle's `PgColumn`, restricted. */
export type Column<T = unknown, Nullable extends boolean = boolean, HasDefault extends boolean = boolean> = PgColumn<{
  name: string;
  tableName: string;
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

/** Text primary key holding a framework-generated ID (see newId). Immutable. */
export declare function id(): ColumnBuilder<string>;
/** Text compared by binary (code point) order. */
export declare function text(): ColumnBuilder<string>;
/** Signed 32-bit integer. */
export declare function integer(): ColumnBuilder<number>;
/** Finite double-precision number. */
export declare function number(): ColumnBuilder<number>;
/** Epoch milliseconds, non-negative safe integer. */
export declare function timestamp(): ColumnBuilder<number>;
export declare function boolean(): ColumnBuilder<boolean>;
/** Reference to another table's id column. Deleting a referenced row fails while references exist. */
export declare function ref(target: () => Column<string, false>): ColumnBuilder<string>;

export type ColumnBuilders = Record<string, ColumnBuilder<unknown, boolean, boolean>>;

/** Each entry lists column keys of the table being defined. */
export interface TableOptions<Cols extends ColumnBuilders = ColumnBuilders> {
  readonly indexes?: readonly (readonly (keyof Cols & string)[])[];
  readonly uniques?: readonly (readonly (keyof Cols & string)[])[];
}

/**
 * Table handle: its columns are accessible by key (e.g. `notes.title`) for use in
 * queries and `ref`. Column keys are lowerCamelCase and map to snake_case SQL names
 * (sql.md SQL-REQ-001). `typeof t.$inferSelect` is the row type (nullable columns
 * `T | null`); `typeof t.$inferInsert` is the insert type, in which nullable and
 * defaulted columns are optional.
 */
export type Table<Cols extends ColumnBuilders = ColumnBuilders> = PgTableWithColumns<{
  name: string;
  schema: undefined;
  dialect: "pg";
  columns: {
    [K in keyof Cols & string]: Cols[K] extends ColumnBuilder<infer T, infer N, infer D> ? Column<T, N, D> : never;
  };
}>;

export declare function defineTable<const Cols extends ColumnBuilders>(
  name: string,
  columns: Cols,
  options?: TableOptions<Cols>,
): Table<Cols>;

/** The `tables` record. Its keys are informative only; SQL names come from `defineTable`. */
export type TableDefinitions = Record<string, Table>;

// ---- Values ------------------------------------------------------------------------

/** New random ID for an `id()` column (UUID v4 text). */
export declare function newId(): string;
/** Current time as a `timestamp()` value. */
export declare function now(): number;

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

/**
 * One step of an atomic unit: synchronously builds a single write on the handle it is
 * given. `R` is the write's result: its RETURNING rows, or `void` without `returning()`.
 */
export type WriteStep<R = unknown> = (db: WriteDb) => { execute(): Promise<R> };

/** Per step, the result type of that step's write. */
export type AtomicResults<Steps extends readonly WriteStep[]> = {
  -readonly [K in keyof Steps]: ReturnType<Steps[K]> extends { execute(): Promise<infer R> } ? R : never;
};

/**
 * Applies all steps as one all-or-nothing unit. Steps must be synchronous and must not
 * execute queries or perform other effects. Before executing anything, on every target,
 * rejects with a catalogue error any step whose write was not built on the handle passed
 * to it. Resolves to a tuple holding, per step, its RETURNING rows (or undefined for
 * steps without RETURNING). Empty input is a no-op.
 */
export declare function atomic<const Steps extends readonly WriteStep[]>(
  db: PortableDb,
  steps: Steps,
): Promise<AtomicResults<Steps>>;

// Supported expressions: Drizzle's own, re-exported unchanged in signature.
export { eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between } from "drizzle-orm";
// Aggregates: Drizzle's signatures; results are normalized as sql.md SQL-REQ-003 states.
export { count, countDistinct, min, max, sum, avg } from "drizzle-orm";

/** Ascending, NULLs first. Use instead of any other ordering helper. */
export declare function asc(column: Column): SQL;
/** Descending, NULLs last. */
export declare function desc(column: Column): SQL;
/**
 * Literal substring match, case-insensitive for ASCII A–Z only. `%`, `_` and `\` are
 * literal. An empty needle matches every non-NULL value; NULL never matches.
 */
export declare function containsText(column: Column<string>, needle: string): SQL;
