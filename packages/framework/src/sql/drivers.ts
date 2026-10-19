/**
 * SQL drivers for the local dialects (sql.md §2.2 "Local"): local D1 through its Worker
 * binding (Wrangler/Miniflare) and the PGlite Postgres harness (PAR-107). Both give a Drizzle
 * database that enforces the column rules before anything reaches the database.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleD1, type AnyD1Database } from "drizzle-orm/d1";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { createGuard } from "./guard.js";
import { portableHandle, type DrizzleDb } from "./handle.js";
import type { PortableDb } from "./types.js";
import { withValueRules } from "./write-rules.js";

/** The app-facing handle over a D1 binding (local D1 under Wrangler, or Cloudflare D1). */
export function sqliteDb(binding: AnyD1Database): PortableDb {
  // The SQLite database has the same query-builder surface; app code sees the pg-typed contract.
  return portableHandle({ dialect: "sqlite", db: withValueRules(drizzleD1(binding)) as DrizzleDb, guard: createGuard() });
}

/** The app-facing handle over a PGlite harness instance (see openPostgres). */
export function postgresDb(client: PGlite): PortableDb {
  return portableHandle({ dialect: "postgres", db: withValueRules(drizzlePglite(client)) as DrizzleDb, guard: createGuard() });
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
