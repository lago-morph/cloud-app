/**
 * The restricted database handles app code sees (sql.md §2.2, §2.3): `PortableDb` in `c.var.sql`
 * and the `WriteDb` given to `atomic` steps. Each is a plain object exposing only the contract's
 * members; every query builder made through it is wrapped so that awaiting or executing it
 * - runs through the adapter's guard (PAR-210 budget, driver errors normalized, SQL-REQ-006),
 * - resolves writes without `returning` to `undefined` (SQL-REQ-004),
 * - refuses results larger than PAR-215 (`SQL.RESULT_TOO_LARGE`).
 */
import { FrameworkError } from "../core/errors.js";
import type { Dialect } from "./dialect.js";
import type { Guard } from "./guard.js";
import type { PortableDb, WriteDb } from "./types.js";

/** PAR-215: portable maximum query result size, in bytes (measured as sql.md §2.3). */
export const MAX_RESULT_BYTES = 256 * 1024;

/** A Drizzle database (either dialect) with the row-level value rules applied. */
export type DrizzleDb = Record<string, unknown> & object;

/** What the handle runs on. */
export interface Adapter {
  readonly dialect: Dialect;
  readonly db: DrizzleDb;
  readonly guard: Guard;
}

const PORTABLE_MEMBERS = ["select", "selectDistinct", "insert", "update", "delete", "$with", "with"] as const;
const WRITE_MEMBERS = ["insert", "update", "delete"] as const;
/** Methods whose result is a builder even though it cannot execute yet (select/insert/update builders, `with`). */
const BUILDER_METHODS: ReadonlySet<string | symbol> = new Set(PORTABLE_MEMBERS);

const adapters = new WeakMap<object, Adapter>();
const targets = new WeakMap<object, object>();

/** The adapter behind a handle made by `portableHandle`, if it is one. */
export function adapterOf(db: unknown): Adapter | undefined {
  return typeof db === "object" && db !== null ? adapters.get(db) : undefined;
}

/** The Drizzle builder behind a wrapped builder. */
export function targetOf(builder: object): object {
  return targets.get(builder) ?? builder;
}

/** The app-facing handle over `adapter`. */
export function portableHandle(adapter: Adapter): PortableDb {
  const handle = restricted(adapter.db, PORTABLE_MEMBERS, (b) => wrapBuilder(b, adapter, undefined));
  adapters.set(handle, adapter);
  return handle as unknown as PortableDb;
}

/**
 * A write-only handle over `db` (the database or, on Postgres, a transaction) whose builders
 * are recorded in `marks`, so `atomic` can check that a step's write was built on it. Its
 * builders are never executed by app code: `atomic` executes them.
 */
export function writeHandle(db: DrizzleDb, adapter: Adapter, marks: WeakSet<object>): WriteDb {
  return restricted(db, WRITE_MEMBERS, (b) => wrapBuilder(b, adapter, marks)) as unknown as WriteDb;
}

function restricted(db: DrizzleDb, members: readonly string[], wrap: (builder: object) => object): object {
  const handle: Record<string, unknown> = {};
  for (const name of members) {
    handle[name] = (...args: unknown[]): unknown => {
      const method = db[name] as (...a: unknown[]) => unknown;
      return wrap(Reflect.apply(method, db, args) as object);
    };
  }
  return Object.freeze(handle);
}

function wrapBuilder(target: object, adapter: Adapter, marks: WeakSet<object> | undefined): object {
  const execute = (): Promise<unknown> =>
    adapter.guard(async () => {
      const result = await (target as { execute(): Promise<unknown> }).execute();
      return checkResultSize(normalizeResult(result));
    });
  const proxy: object = new Proxy(target, {
    get(t, property) {
      switch (property) {
        case "execute":
          return execute;
        case "then":
          return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => execute().then(onFulfilled, onRejected);
        case "catch":
          return (onRejected?: (e: unknown) => unknown) => execute().catch(onRejected);
        case "finally":
          return (onFinally?: () => void) => execute().finally(onFinally);
      }
      const value: unknown = Reflect.get(t, property, t);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, t, args);
        if (result === t) return proxy;
        if (isBuilder(property, result)) return wrapBuilder(result, adapter, marks);
        return result;
      };
    },
  });
  targets.set(proxy, target);
  marks?.add(proxy);
  return proxy;
}

function isBuilder(property: string | symbol, value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  return BUILDER_METHODS.has(property) || typeof (value as { execute?: unknown }).execute === "function";
}

/** A write without `returning` resolves to `undefined` on every target; rows stay rows. */
export function normalizeResult(result: unknown): unknown {
  return Array.isArray(result) ? result : undefined;
}

/**
 * The size of a result as sql.md §2.3 defines it: UTF-8 bytes of every text value plus 8 bytes
 * for every other non-NULL value (rows and nested join objects are walked).
 */
export function resultSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return utf8Length(value);
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + resultSize(v), 0);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).reduce((sum: number, v) => sum + resultSize(v), 0);
  }
  return 8;
}

/** Throws `SQL.RESULT_TOO_LARGE` when `result` is larger than PAR-215; returns it otherwise. */
export function checkResultSize<R>(result: R): R {
  const size = resultSize(result);
  if (size > MAX_RESULT_BYTES) {
    throw new FrameworkError(
      "SQL.RESULT_TOO_LARGE",
      `the query result is ${size} bytes, more than the portable limit of ${MAX_RESULT_BYTES} bytes (PAR-215); paginate with limit/offset or select fewer columns`,
    );
  }
  return result;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
