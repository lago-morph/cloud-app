/**
 * SQL public types, transcribed from docs/contracts/ts/sql.d.ts (revised per DEC-0103).
 * `Table` and `Column` are restricted Drizzle pg-core types; at runtime a table is the
 * Drizzle table of the process's dialect (sql.md §2.2).
 */
import type { ColumnDataType } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT, PgTable, PgTableWithColumns } from "drizzle-orm/pg-core";

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

/** The `tables` record. Its keys are informative only; SQL names come from `defineTable`. */
export type TableDefinitions = Record<string, AnyTable>;

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
