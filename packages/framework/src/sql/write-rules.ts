/**
 * Row-level value rules on a Drizzle database (SQL-REQ-004). Column-level rules run in each
 * column's `mapToDriverValue` (table.ts), but Drizzle never calls that for NULL and fills
 * left-out columns itself, so NULL in a NOT NULL column, a missing required value, and a
 * change of an `id()` column are caught here, where the write is built: `insert(t).values`,
 * an upsert's `onConflictDoUpdate({ set })`, and `update(t).set`. Everything else passes
 * through unchanged.
 */
import { checkInsertRow, checkUpdateSet } from "./table.js";

type Fn = (...args: never[]) => unknown;
type Overrides = Readonly<Record<string, (original: Fn) => Fn>>;

/**
 * A proxy of `target` whose methods run bound to `target`; a method returning `target`
 * itself (Drizzle's chaining) returns the proxy, so later overrides still apply.
 */
function intercept<T extends object>(target: T, overrides: Overrides): T {
  const proxy: T = new Proxy(target, {
    get(t, property) {
      const value: unknown = Reflect.get(t, property, t);
      if (typeof value !== "function") return value;
      const bound = (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, t, args);
        return result === t ? proxy : result;
      };
      const override = typeof property === "string" ? overrides[property] : undefined;
      return override === undefined ? bound : override(bound as Fn);
    },
  });
  return proxy;
}

function upsert(table: unknown, query: object): object {
  return intercept(query, {
    onConflictDoUpdate: (original) => (config: unknown) => {
      checkUpdateSet(table, (config as { set?: unknown } | null)?.set ?? {});
      return (original as (c: unknown) => unknown)(config);
    },
  });
}

/** `db` with the row-level value rules applied to every insert, upsert and update it builds. */
export function withValueRules<D extends object>(db: D): D {
  return intercept(db, {
    insert: (original) => (table: unknown) =>
      intercept((original as (t: unknown) => object)(table), {
        values: (values) => (rows: unknown) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) checkInsertRow(table, row);
          return upsert(table, (values as (r: unknown) => object)(rows));
        },
      }),
    update: (original) => (table: unknown) =>
      intercept((original as (t: unknown) => object)(table), {
        set: (set) => (values: unknown) => {
          checkUpdateSet(table, values);
          return (set as (v: unknown) => unknown)(values);
        },
      }),
  });
}
