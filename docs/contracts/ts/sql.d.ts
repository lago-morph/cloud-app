/**
 * Portable SQL (SQL). Behavior, supported subset, and per-type rules: docs/components/sql.md.
 *
 * The query builder is a restricted view of Drizzle ORM. Only the members declared or
 * re-exported here are part of the contract; anything else reachable at runtime is not,
 * and the portability rules (CHECK) reject it in app code.
 */

// ---- Schema definition -------------------------------------------------------------

/** Opaque column builder. Columns are NOT NULL unless `.nullable()` is called. */
export interface Column<T, Nullable extends boolean = false> {
  nullable(): Column<T, true>;
  unique(): Column<T, Nullable>;
  /** A static value checked against the column type. No SQL expressions. */
  default(value: T): Column<T, Nullable>;
}

/** Text primary key holding a framework-generated ID (see newId). Immutable. */
export declare function id(): Column<string>;
/** Text compared by binary (code point) order. */
export declare function text(): Column<string>;
/** Signed 32-bit integer. */
export declare function integer(): Column<number>;
/** Finite double-precision number. */
export declare function number(): Column<number>;
/** Epoch milliseconds, non-negative safe integer. */
export declare function timestamp(): Column<number>;
export declare function boolean(): Column<boolean>;
/** Reference to another table's id column. Deleting a referenced row fails while references exist. */
export declare function ref(target: () => Column<string>): Column<string>;

export interface TableOptions {
  readonly indexes?: readonly (readonly string[])[];
  readonly uniques?: readonly (readonly string[])[];
}

/** Opaque table handle. Names: lowercase ASCII snake_case; `__framework_` prefix reserved. */
export interface Table<Row = Record<string, unknown>> {
  readonly $row: Row;
}

export declare function defineTable<Cols extends Record<string, Column<unknown, boolean>>>(
  name: string,
  columns: Cols,
  options?: TableOptions,
): Table<{ [K in keyof Cols]: Cols[K] extends Column<infer T, infer N> ? (N extends true ? T | null : T) : never }>;

export type TableDefinitions = Record<string, Table>;

// ---- Values ------------------------------------------------------------------------

/** New random ID for an `id()` column (UUID v4 text). */
export declare function newId(): string;
/** Current time as a `timestamp()` value. */
export declare function now(): number;

// ---- Queries -----------------------------------------------------------------------

/**
 * The database handle in `c.var.sql`. Supports select / insert / update / delete,
 * inner and left joins, subqueries, select-only common table expressions,
 * limit / offset, upsert against a declared unique constraint, and RETURNING.
 * Not supported: raw SQL, right and full outer joins, window functions, full-text
 * search, triggers, stored procedures, views, interactive transactions.
 */
export interface PortableDb {
  select: unknown;
  insert: unknown;
  update: unknown;
  delete: unknown;
  $with: unknown;
}

/** Write-only handle passed to `atomic` step factories (named context shape). */
export interface WriteDb {
  insert: unknown;
  update: unknown;
  delete: unknown;
}

/** One step of an atomic unit: synchronously builds a single write on the handle it is given. */
export type WriteStep = (db: WriteDb) => unknown;

/**
 * Applies all steps as one all-or-nothing unit. Steps must be synchronous and must not
 * execute queries or perform other effects. Returns, per step, the RETURNING rows
 * (or undefined for steps without RETURNING). Empty input is a no-op.
 */
export declare function atomic(db: PortableDb, steps: readonly WriteStep[]): Promise<unknown[]>;

// Supported expressions (re-exported from Drizzle with portable semantics).
export declare const eq: unknown, ne: unknown, gt: unknown, gte: unknown, lt: unknown, lte: unknown;
export declare const and: unknown, or: unknown, not: unknown;
export declare const isNull: unknown, isNotNull: unknown, inArray: unknown, notInArray: unknown, between: unknown;
export declare const count: unknown, countDistinct: unknown, min: unknown, max: unknown, sum: unknown, avg: unknown;

/** Ascending, NULLs first. Use instead of any other ordering helper. */
export declare function asc(column: Column<unknown, boolean>): unknown;
/** Descending, NULLs last. */
export declare function desc(column: Column<unknown, boolean>): unknown;
/**
 * Literal substring match, case-insensitive for ASCII A–Z only. `%`, `_` and `\` are
 * literal. An empty needle matches every non-NULL value; NULL never matches.
 */
export declare function containsText(column: Column<string, boolean>, needle: string): unknown;
