/**
 * The Postgres harness (sql.md §2.2 "Local"; PAR-107): PGlite in-process, with a Drizzle
 * database that enforces the column rules before anything reaches the database. Node only:
 * used by `createTestApp`, the migration checker and the framework's tests, never imported by a
 * Worker runtime, so no Worker bundle contains it (CORE-REQ-006, DEC-0196).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { SqlAdapterOptions } from "./d1.js";
import { createGuard } from "./guard.js";
import { portableHandle, type DrizzleDb } from "./handle.js";
import type { PortableDb } from "./types.js";
import { withValueRules } from "./write-rules.js";

export type { SqlAdapterOptions } from "./d1.js";

/** PGlite's error for a closed instance: the database cannot be reached (`SQL.UNAVAILABLE`). */
const PGLITE_UNREACHABLE: readonly RegExp[] = [/PGlite is closed/i];

/**
 * PGlite has one connection, which it takes in turn, and must start first. Every handle's
 * operations over one client take it in turn here (one queue per client: a test app's SQL and KV
 * handles share it), so the guard can bound the wait for it (and for the start) by PAR-210:
 * getting it is the handoff to the driver (DEC-0557). Released when the operation settles.
 */
const TURNS = new WeakMap<PGlite, () => Promise<() => void>>();

function connectionTurns(client: PGlite): () => Promise<() => void> {
  let turns = TURNS.get(client);
  if (turns === undefined) {
    turns = newTurns(client);
    TURNS.set(client, turns);
  }
  return turns;
}

function newTurns(client: PGlite): () => Promise<() => void> {
  let tail: Promise<void> = Promise.resolve();
  return async () => {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await client.waitReady;
    } catch (error) {
      release();
      throw error;
    }
    return release;
  };
}

/**
 * `client` for another user of the same PGlite instance (the test app's auth database): its
 * `query`, `exec` and `transaction` take the same connection turns as every handle's operations,
 * so a guarded operation waiting behind them is bounded by PAR-210 (DEC-0557). Their own wait is
 * not timed.
 */
export function queuedClient(client: PGlite): PGlite {
  const turns = connectionTurns(client);
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "query" || property === "exec" || property === "transaction") {
        return async (...args: unknown[]) => {
          const release = await turns();
          try {
            return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          } finally {
            release();
          }
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** The app-facing handle over a PGlite harness instance (see openPostgres). */
export function postgresDb(client: PGlite, options: SqlAdapterOptions = {}): PortableDb {
  const guard = createGuard({ ...options, unreachable: PGLITE_UNREACHABLE, connection: connectionTurns(client) });
  return portableHandle({ dialect: "postgres", db: withValueRules(drizzlePglite(client)) as unknown as DrizzleDb, guard });
}

/** Name of the harness database: created from template0 with C collation and C ctype (DEC-0106). */
export const POSTGRES_DATABASE = "app";

let template: Promise<Blob> | undefined;

/**
 * A data directory holding an empty `app` database with `LC_COLLATE 'C'` and `LC_CTYPE 'C'`.
 * PGlite cannot switch databases within one instance, so the directory is made once per
 * process and every harness instance is loaded from it.
 */
function postgresTemplate(): Promise<Blob> {
  template ??= (async () => {
    const init = await PGlite.create();
    try {
      await init.exec(`CREATE DATABASE ${POSTGRES_DATABASE} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
      return await init.dumpDataDir("none");
    } finally {
      await init.close();
    }
  })();
  template.catch(() => {
    template = undefined;
  });
  return template;
}

/** Opens a fresh, empty in-memory Postgres harness database (PGlite). Close it after use. */
export async function openPostgres(): Promise<PGlite> {
  return PGlite.create({ loadDataDir: await postgresTemplate(), database: POSTGRES_DATABASE });
}
