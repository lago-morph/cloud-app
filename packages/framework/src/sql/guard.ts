/**
 * Every database operation runs through a guard (SQL-REQ-006): driver errors never reach app
 * code. Uniqueness and reference violations become `SQL.CONFLICT`; other driver errors become
 * `CORE.INTERNAL`, whose message (logged, never returned) carries the driver's message.
 */
import { FrameworkError } from "../core/errors.js";

/** Runs one database operation. */
export type Guard = <T>(operation: () => Promise<T>) => Promise<T>;

export function createGuard(): Guard {
  return async (operation) => {
    try {
      return await operation();
    } catch (thrown) {
      throw normalizeError(thrown);
    }
  };
}

/** Postgres SQLSTATEs: unique_violation, foreign_key_violation. */
const PG_CONFLICT_CODES = new Set(["23505", "23503"]);
/** SQLite (D1) constraint messages for uniqueness (incl. primary key) and references. */
const SQLITE_CONFLICT = /\b(UNIQUE|PRIMARY KEY|FOREIGN KEY) constraint failed\b/;

/** The error chain of `thrown` (Drizzle wraps driver errors in `DrizzleQueryError` with `cause`). */
function chain(thrown: unknown): unknown[] {
  const errors: unknown[] = [];
  let current = thrown;
  while (current !== undefined && current !== null && errors.length < 8 && !errors.includes(current)) {
    errors.push(current);
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return errors;
}

function field(error: unknown, name: "code" | "message"): string {
  const value = typeof error === "object" && error !== null ? (error as Record<string, unknown>)[name] : undefined;
  return typeof value === "string" ? value : "";
}

/** A thrown value as app code may see it: a `FrameworkError`. */
export function normalizeError(thrown: unknown): FrameworkError {
  if (thrown instanceof FrameworkError) return thrown;
  const errors = chain(thrown);
  if (errors.some((e) => PG_CONFLICT_CODES.has(field(e, "code")) || SQLITE_CONFLICT.test(field(e, "message")))) {
    return new FrameworkError("SQL.CONFLICT", "a uniqueness or reference constraint was violated");
  }
  const driver = errors[errors.length - 1];
  const message = field(driver, "message") || String(driver);
  const failure = new FrameworkError("CORE.INTERNAL", `database error: ${message}`);
  (failure as { cause?: unknown }).cause = thrown;
  return failure;
}
