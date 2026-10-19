/**
 * Portable SQL (SQL). Behavior, supported subset, and per-type rules: docs/components/sql.md.
 *
 * The query builder is a restricted view of Drizzle ORM (PAR-102), typed with Drizzle's
 * own Postgres-flavoured types so app code gets full type checking. Only the members
 * declared or re-exported here are part of the contract, and only the features in
 * docs/components/sql.md §2.3 may be used; the portability rules (CHECK) reject the rest.
 * The exact generic parameters linking these column types to Drizzle's are settled during
 * implementation; the names, members, and semantics here are the contract.
 */
import type { PgDatabase } from "drizzle-orm/pg-core";

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

/**
 * Table handle: its columns are accessible by name (e.g. `notes.title`) for use in
 * queries and `ref`. Names: lowercase ASCII snake_case; `__framework_` prefix reserved.
 */
export type Table<Cols extends Record<string, Column<unknown, boolean>> = Record<string, Column<unknown, boolean>>> =
  { readonly [K in keyof Cols]: Cols[K] } & {
    readonly $inferSelect: { [K in keyof Cols]: Cols[K] extends Column<infer T, infer N> ? (N extends true ? T | null : T) : never };
  };

export declare function defineTable<Cols extends Record<string, Column<unknown, boolean>>>(
  name: string,
  columns: Cols,
  options?: TableOptions,
): Table<Cols>;

export type TableDefinitions = Record<string, Table>;

// ---- Values ------------------------------------------------------------------------

/** New random ID for an `id()` column (UUID v4 text). */
export declare function newId(): string;
/** Current time as a `timestamp()` value. */
export declare function now(): number;

// ---- Queries -----------------------------------------------------------------------

/** The database handle in `c.var.sql`. Supported features: docs/components/sql.md §2.3. */
export type PortableDb = Pick<PgDatabase<any>, "select" | "selectDistinct" | "insert" | "update" | "delete" | "$with">;

/** Write-only handle passed to `atomic` step factories (named context shape). */
export type WriteDb = Pick<PgDatabase<any>, "insert" | "update" | "delete">;

/** One step of an atomic unit: synchronously builds a single write on the handle it is given. */
export type WriteStep = (db: WriteDb) => { execute(): Promise<unknown> };

/**
 * Applies all steps as one all-or-nothing unit. Steps must be synchronous and must not
 * execute queries or perform other effects. Returns, per step, the RETURNING rows
 * (or undefined for steps without RETURNING). Empty input is a no-op.
 */
export declare function atomic(db: PortableDb, steps: readonly WriteStep[]): Promise<unknown[]>;

// Supported expressions: Drizzle's own, re-exported unchanged in signature.
export { eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between } from "drizzle-orm";
// Aggregates: Drizzle's signatures; results are normalized to JS numbers (sql.md §2.2).
export { count, countDistinct, min, max, sum, avg } from "drizzle-orm";

/** Ascending, NULLs first. Use instead of any other ordering helper. */
export declare function asc(column: Column<unknown, boolean>): import("drizzle-orm").SQL;
/** Descending, NULLs last. */
export declare function desc(column: Column<unknown, boolean>): import("drizzle-orm").SQL;
/**
 * Literal substring match, case-insensitive for ASCII A–Z only. `%`, `_` and `\` are
 * literal. An empty needle matches every non-NULL value; NULL never matches.
 */
export declare function containsText(column: Column<string, boolean>, needle: string): import("drizzle-orm").SQL;
