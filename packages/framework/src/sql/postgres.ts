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

/** The app-facing handle over a PGlite harness instance (see openPostgres). */
export function postgresDb(client: PGlite, options: SqlAdapterOptions = {}): PortableDb {
  const guard = createGuard({ ...options, unreachable: PGLITE_UNREACHABLE });
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
