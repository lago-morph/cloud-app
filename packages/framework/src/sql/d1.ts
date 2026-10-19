/**
 * The SQLite dialect's driver (sql.md §2.2): D1 through its Worker binding, local D1 under
 * Wrangler/Miniflare and Cloudflare D1 alike. Gives a Drizzle database that enforces the column
 * rules before anything reaches the database. Workers-compatible: the only driver module Worker
 * runtimes import; the Postgres harness is `postgres.ts` (DEC-PENDING-B-16a-3).
 */
import { drizzle as drizzleD1, type AnyD1Database } from "drizzle-orm/d1";
import { createGuard, type GuardOptions } from "./guard.js";
import { portableHandle, type DrizzleDb } from "./handle.js";
import type { PortableDb } from "./types.js";
import { withValueRules } from "./write-rules.js";

/** Options of a handle: forced outage, PAR-210 budget, and the log for `SQL.UNAVAILABLE` (guard.ts). */
export type SqlAdapterOptions = Omit<GuardOptions, "unreachable">;

/** The app-facing handle over a D1 binding (local D1 under Wrangler, or Cloudflare D1). */
export function sqliteDb(binding: AnyD1Database, options: SqlAdapterOptions = {}): PortableDb {
  // The SQLite database has the same query-builder surface; app code sees the pg-typed contract.
  return portableHandle({ dialect: "sqlite", db: withValueRules(drizzleD1(binding)) as unknown as DrizzleDb, guard: createGuard(options) });
}
