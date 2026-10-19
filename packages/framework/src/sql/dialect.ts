/**
 * The SQL dialect is fixed per process (core.md "Testing", local.md LOCAL-REQ-003): Worker
 * bundles (local and Cloudflare targets) use SQLite/D1; `verify` runs the app tests once more
 * in a separate process with `PROTOTYPE_FRAMEWORK_DIALECT=postgres` for the PGlite harness.
 * `defineTable` builds each table for this dialect when the app's schema module is imported.
 */
import { FrameworkError } from "../core/errors.js";

export type Dialect = "sqlite" | "postgres";

export const DIALECT_ENV = "PROTOTYPE_FRAMEWORK_DIALECT";

export function resolveDialect(value: string | undefined): Dialect {
  if (value === undefined || value === "" || value === "sqlite") return "sqlite";
  if (value === "postgres") return "postgres";
  throw new FrameworkError(
    "CORE.MISCONFIGURED",
    `${DIALECT_ENV} is ${JSON.stringify(value)}; it must be "sqlite" (the default) or "postgres"`,
  );
}

let fixed: Dialect | undefined;

/** The dialect of this process, read from the environment on first use and fixed after. */
export function processDialect(): Dialect {
  if (fixed === undefined) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    fixed = resolveDialect(env?.[DIALECT_ENV]);
  }
  return fixed;
}
