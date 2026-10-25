/**
 * The in-process test app's own database, as the AUTH and PWD criteria that name it need it:
 * AUTH-AC-015 ("with the statements sent to the stage's database recorded, in `createTestApp`
 * on both dialects"), AUTH-AC-012 (a test marks the account unverified, deletes its row, makes
 * the role read fail) and PWD-AC-010 (the account's `role` column).
 *
 * No contract gives a test the database of a `createTestApp` app, so this module observes it
 * where the specification says it is (docs/components/local.md "Test apps", sql.md "Local
 * drivers"): local D1 through Wrangler's `getPlatformProxy`, which creates a Miniflare instance
 * and takes its bindings (`Miniflare#getBindings`), and on the Postgres dialect an in-process
 * PGlite database. It wraps those two library entry points, before the framework loads, so that
 * every statement sent to a database is recorded with the database it went to:
 * - D1: `prepare(sql)` → `bind(…)` → `all` / `first` / `run` / `raw`, `batch([…])` and `exec(sql)`;
 * - PGlite: `query`, `exec`, and both inside `transaction`.
 * A statement counts when it is executed, not when it is prepared. The test's own reads and
 * writes through `TestDatabase` are not recorded.
 *
 * When the database of a new test app cannot be found this way, the test reports a missing
 * prerequisite (recorded `blocked`, never passed): the observation point, not the framework,
 * would be at fault.
 *
 * Import this module before the first `createTestApp` of the process (the dialect entry files
 * do), since the wrapping must be in place when the framework opens its database.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { prerequisiteMissing } from "../../harness/index.js";
import { REPO_ROOT } from "../core/support/repo.js";

export type Dialect = "sqlite" | "postgres";

export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface D1StatementLike {
  bind(...params: unknown[]): D1StatementLike;
  all(): Promise<{ results?: readonly unknown[] }>;
  first(...args: unknown[]): Promise<unknown>;
  run(): Promise<unknown>;
  raw(...args: unknown[]): Promise<unknown>;
}

interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: readonly unknown[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
}

interface PgLike {
  query(sql: string, params?: readonly unknown[], options?: unknown): Promise<{ rows: readonly unknown[] }>;
  exec(sql: string, options?: unknown): Promise<unknown>;
}

interface Captured {
  readonly dialect: Dialect;
  readonly d1?: D1Like;
  readonly pg?: PgLike;
  readonly log: Statement[];
}

interface RecorderState {
  readonly captured: Captured[];
  quiet: number;
  readonly problems: string[];
}

const STATE_KEY = Symbol.for("compliance.auth.database-recorder");
const g = globalThis as unknown as Record<symbol, RecorderState | undefined>;
const state: RecorderState = g[STATE_KEY] ?? { captured: [], quiet: 0, problems: [] };
g[STATE_KEY] = state;

function record(c: Captured, sql: string, params: readonly unknown[]): void {
  if (state.quiet === 0) c.log.push({ sql, params: [...params] });
}

// ---------------------------------------------------------------------------------------------
// D1 through getPlatformProxy (Miniflare#getBindings)
// ---------------------------------------------------------------------------------------------

const EXECUTE = new Set(["all", "first", "run", "raw"]);

function isD1(value: unknown): value is D1Like {
  if (value === null || typeof value !== "object") return false;
  try {
    const v = value as Record<string, unknown>;
    return typeof v.prepare === "function" && typeof v.batch === "function" && typeof v.exec === "function";
  } catch {
    return false;
  }
}

function recordingD1(binding: D1Like, c: Captured): D1Like {
  const info = new WeakMap<object, { readonly original: D1StatementLike; readonly sql: string; readonly params: readonly unknown[] }>();
  const wrapStatement = (original: D1StatementLike, sql: string, params: readonly unknown[]): D1StatementLike => {
    const proxy = new Proxy(original, {
      get(target, prop) {
        if (prop === "bind") return (...p: unknown[]) => wrapStatement(target.bind(...p), sql, p);
        if (typeof prop === "string" && EXECUTE.has(prop)) {
          return (...args: unknown[]) => {
            record(c, sql, params);
            return (target as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]?.(...args);
          };
        }
        const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    info.set(proxy, { original, sql, params });
    return proxy;
  };
  return new Proxy(binding, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrapStatement(target.prepare(sql), sql, []);
      if (prop === "batch") {
        return (statements: readonly unknown[]) => {
          const originals = statements.map((s) => {
            const i = typeof s === "object" && s !== null ? info.get(s) : undefined;
            if (i === undefined) return s;
            record(c, i.sql, i.params);
            return i.original;
          });
          return target.batch(originals);
        };
      }
      if (prop === "exec") {
        return (sql: string) => {
          record(c, sql, []);
          return target.exec(sql);
        };
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

function wrapMiniflare(): void {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  let mod: { Miniflare?: { prototype: Record<string, unknown> } };
  try {
    mod = require("miniflare") as typeof mod;
  } catch (error) {
    state.problems.push(`miniflare could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const proto = mod.Miniflare?.prototype;
  const original = proto?.getBindings;
  if (proto === undefined || typeof original !== "function") {
    state.problems.push("miniflare has no Miniflare#getBindings");
    return;
  }
  proto.getBindings = async function getBindings(this: unknown, ...args: unknown[]): Promise<unknown> {
    const env = (await (original as (...a: unknown[]) => Promise<unknown>).apply(this, args)) as Record<string, unknown>;
    if (env === null || typeof env !== "object") return env;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(env)) {
      const value = env[key];
      if (isD1(value)) {
        const c: Captured = { dialect: "sqlite", d1: value, log: [] };
        state.captured.push(c);
        out[key] = recordingD1(value, c);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// PGlite
// ---------------------------------------------------------------------------------------------

const pgCaptured = new WeakMap<object, Captured>();

function capturePg(instance: PgLike): Captured {
  let c = pgCaptured.get(instance);
  if (c === undefined) {
    c = { dialect: "postgres", pg: instance, log: [] };
    pgCaptured.set(instance, c);
    state.captured.push(c);
  }
  return c;
}

function recordingTransaction(tx: PgLike, c: Captured): PgLike {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === "query") {
        return (sql: string, params?: readonly unknown[], options?: unknown) => {
          record(c, sql, params ?? []);
          return target.query(sql, params, options);
        };
      }
      if (prop === "exec") {
        return (sql: string, options?: unknown) => {
          record(c, sql, []);
          return target.exec(sql, options);
        };
      }
      const v = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

function wrapPgliteClass(PGlite: { prototype: Record<string, unknown> } | undefined, label: string): void {
  if (PGlite === undefined) {
    state.problems.push(`PGlite (${label}) has no PGlite export`);
    return;
  }
  const proto = PGlite.prototype;
  const query = proto.query as PgLike["query"] | undefined;
  const exec = proto.exec as PgLike["exec"] | undefined;
  const transaction = proto.transaction as ((cb: (tx: PgLike) => Promise<unknown>) => Promise<unknown>) | undefined;
  if (typeof query !== "function" || typeof exec !== "function") {
    state.problems.push(`PGlite (${label}) has no query/exec methods`);
    return;
  }
  proto.query = function (this: PgLike, sql: string, params?: readonly unknown[], options?: unknown) {
    record(capturePg(this), sql, params ?? []);
    return query.call(this, sql, params, options);
  };
  proto.exec = function (this: PgLike, sql: string, options?: unknown) {
    record(capturePg(this), sql, []);
    return exec.call(this, sql, options);
  };
  if (typeof transaction === "function") {
    proto.transaction = function (this: PgLike, cb: (tx: PgLike) => Promise<unknown>) {
      const c = capturePg(this);
      return transaction.call(this, (tx: PgLike) => cb(recordingTransaction(tx, c)));
    };
  }
}

async function wrapPglite(): Promise<void> {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  try {
    // Both builds: the framework may load either.
    const esm = (await import(pathToFileURL(require.resolve("@electric-sql/pglite").replace(/index\.cjs$/, "index.js")).href)) as { PGlite?: { prototype: Record<string, unknown> } };
    wrapPgliteClass(esm.PGlite, "ESM");
    const cjs = require("@electric-sql/pglite") as { PGlite?: { prototype: Record<string, unknown> } };
    if (cjs.PGlite !== esm.PGlite) wrapPgliteClass(cjs.PGlite, "CommonJS");
  } catch (error) {
    state.problems.push(`PGlite could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const INSTALLED = Symbol.for("compliance.auth.database-recorder.installed");
const flags = globalThis as unknown as Record<symbol, boolean | undefined>;
if (flags[INSTALLED] !== true) {
  flags[INSTALLED] = true;
  wrapMiniflare();
  await wrapPglite();
}

// ---------------------------------------------------------------------------------------------
// The test's view of one test app's database
// ---------------------------------------------------------------------------------------------

/** The process's dialect (DEC-0134): `PROTOTYPE_FRAMEWORK_DIALECT`, sqlite by default. */
export function processDialect(): Dialect {
  return process.env.PROTOTYPE_FRAMEWORK_DIALECT === "postgres" ? "postgres" : "sqlite";
}

export const AUTH_USER = "__framework_auth_user";
const AUTH_USER_NAME = /\b__framework_auth_user\b/i;
const READ = /^\s*(select|with)\b/i;

export interface TestDatabase {
  readonly dialect: Dialect;
  /** Starts a new recording window. */
  mark(): void;
  /** The statements executed since the last `mark()`. */
  statements(): readonly Statement[];
  /** The reads (SELECT) of `__framework_auth_user` since the last `mark()`. */
  accountReads(): readonly Statement[];
  /** Rows of a query of the test's own (not recorded). Placeholders: `?` (rewritten for Postgres). */
  rows(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /** A statement of the test's own (not recorded). */
  run(sql: string, params?: readonly unknown[]): Promise<void>;
  /** The SQL literal for a boolean column value in this dialect. */
  bool(value: boolean): string;
}

function postgresPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${String((i += 1))}`);
}

function viewOf(c: Captured): TestDatabase {
  let start = c.log.length;
  const rows = async (sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> => {
    state.quiet += 1;
    try {
      if (c.d1 !== undefined) {
        const r = await c.d1.prepare(sql).bind(...params).all();
        return (r.results ?? []).map((x) => ({ ...(x as Record<string, unknown>) }));
      }
      if (c.pg !== undefined) {
        const r = await c.pg.query(postgresPlaceholders(sql), params);
        return r.rows.map((x) => ({ ...(x as Record<string, unknown>) }));
      }
      throw new Error("no database handle");
    } finally {
      state.quiet -= 1;
    }
  };
  return {
    dialect: c.dialect,
    mark() {
      start = c.log.length;
    },
    statements: () => c.log.slice(start),
    accountReads: () => c.log.slice(start).filter((s) => READ.test(s.sql) && AUTH_USER_NAME.test(s.sql)),
    rows,
    async run(sql, params = []) {
      await rows(sql, params);
    },
    bool: (value) => (c.dialect === "sqlite" ? (value ? "1" : "0") : value ? "true" : "false"),
  };
}

/**
 * Opens a test app with `open` and returns it with its database: the database of the process's
 * dialect that the app opened (and migrated) while it was created, and that has
 * `__framework_auth_user`.
 */
export async function withDatabase<T>(open: () => Promise<T>): Promise<{ readonly app: T; readonly db: TestDatabase }> {
  const before = state.captured.length;
  const app = await open();
  const dialect = processDialect();
  const fresh = state.captured.slice(before).filter((c) => c.dialect === dialect);
  const candidates = [...fresh].sort((a, b) => b.log.length - a.log.length);
  for (const c of candidates) {
    const db = viewOf(c);
    try {
      const listed =
        dialect === "sqlite"
          ? await db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [AUTH_USER])
          : await db.rows("SELECT table_name AS name FROM information_schema.tables WHERE table_name = ?", [AUTH_USER]);
      if (listed.length > 0) return { app, db };
    } catch {
      // not this one
    }
  }
  return prerequisiteMissing(
    `the ${dialect} database of the new createTestApp app could not be observed through ${dialect === "sqlite" ? "Miniflare#getBindings (getPlatformProxy)" : "PGlite"} ` +
      `(${String(fresh.length)} candidate(s)${state.problems.length > 0 ? `; ${state.problems.join("; ")}` : ""}); AUTH-AC-012/015 and PWD-AC-010 need the statements and rows of that database`,
  );
}

/** The `__framework_auth_user` row holding `email` (any column, case-insensitive). */
export async function accountRow(db: TestDatabase, email: string): Promise<Record<string, unknown> | undefined> {
  const all = await db.rows(`SELECT * FROM ${AUTH_USER}`);
  const matching = all.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase() === email.toLowerCase()));
  if (matching.length > 1) throw new Error(`${String(matching.length)} ${AUTH_USER} rows hold the test address`);
  return matching[0];
}

/** The account's `role` column (`undefined` when there is no such account). */
export async function roleOf(db: TestDatabase, email: string): Promise<unknown> {
  const row = await accountRow(db, email);
  if (row === undefined) return undefined;
  expect(Object.keys(row), `${AUTH_USER} has a role column (PWD-REQ-008)`).toContain("role");
  return row.role;
}

/** The provider's subject (`__framework_auth_user.id`) of the account holding `email`. */
export async function subjectOf(db: TestDatabase, email: string): Promise<string> {
  const row = await accountRow(db, email);
  expect(row, `a ${AUTH_USER} row holds the test address`).toBeDefined();
  const id = row?.id;
  expect(typeof id, `${AUTH_USER}.id`).toBe("string");
  return String(id);
}

/**
 * Deletes the account's `__framework_auth_user` row, first deleting the rows of the other
 * `__framework_auth_*` tables that hold its subject (references to it).
 */
export async function deleteAccount(db: TestDatabase, subject: string): Promise<void> {
  const tables =
    db.dialect === "sqlite"
      ? (await db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_\\_framework\\_auth\\_%' ESCAPE '\\'")).map((r) => String(r.name))
      : (await db.rows("SELECT table_name AS name FROM information_schema.tables WHERE table_name LIKE '\\_\\_framework\\_auth\\_%'")).map((r) => String(r.name));
  for (const table of tables) {
    if (table === AUTH_USER) continue;
    const columns =
      db.dialect === "sqlite"
        ? (await db.rows(`SELECT name FROM pragma_table_info('${table}')`)).map((r) => String(r.name))
        : (await db.rows("SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?", [table])).map((r) => String(r.name));
    for (const column of columns) {
      try {
        await db.run(`DELETE FROM ${table} WHERE CAST("${column}" AS TEXT) = ?`, [subject]);
      } catch {
        // a column that cannot hold the subject
      }
    }
  }
  await db.run(`DELETE FROM ${AUTH_USER} WHERE id = ?`, [subject]);
  expect(await db.rows(`SELECT id FROM ${AUTH_USER} WHERE id = ?`, [subject]), "the account row is gone").toEqual([]);
}

