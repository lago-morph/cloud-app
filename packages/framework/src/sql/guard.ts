/**
 * Every database operation runs through a guard (SQL-REQ-006): driver errors never reach app
 * code. Uniqueness and reference violations become `SQL.CONFLICT`; other driver errors become
 * `CORE.INTERNAL`, whose message (logged, never returned) carries the driver's message.
 */
import { FrameworkError } from "../core/errors.js";
import { logFailure } from "../log/failures.js";
import type { LogService } from "../log/public.js";

/** Runs one database operation. */
export type Guard = <T>(operation: () => Promise<T>) => Promise<T>;

/** PAR-210: time budget for reaching the database, in milliseconds. */
export const PAR_210_MS = 45_000;

export interface GuardOptions {
  /** Forced outage (`createTestApp`'s `unavailable: ["sql"]`): every operation is `SQL.UNAVAILABLE`. */
  readonly unavailable?: boolean;
  /** Budget per operation; default PAR-210. */
  readonly budgetMs?: number;
  /** The request's log, for the LOG-REQ-005 entry of an `SQL.UNAVAILABLE` failure. */
  readonly log?: LogService;
  /** The driver's own messages for an unreachable database, besides `UNREACHABLE` (the Postgres harness's, postgres.ts). */
  readonly unreachable?: readonly RegExp[];
}

export function createGuard(options: GuardOptions = {}): Guard {
  const budgetMs = options.budgetMs ?? PAR_210_MS;
  const unavailable = (why: string): FrameworkError => {
    const failure = plainUnavailable(why);
    if (options.log !== undefined) logFailure(options.log, failure);
    return failure;
  };
  return async (operation) => {
    if (options.unavailable === true) throw unavailable("it is unavailable (forced for this test app)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable(`no answer within ${budgetMs} ms (PAR-210)`)), budgetMs);
    });
    const running = operation();
    running.catch(() => undefined); // a late failure after the budget is not an unhandled rejection
    try {
      return await Promise.race([running, timeout]);
    } catch (thrown) {
      throw normalizeError(thrown, unavailable, options.unreachable);
    } finally {
      clearTimeout(timer);
    }
  };
}

function plainUnavailable(why: string): FrameworkError {
  return new FrameworkError("SQL.UNAVAILABLE", `the database could not be reached: ${why}`);
}

/** Postgres SQLSTATEs: unique_violation, foreign_key_violation. */
const PG_CONFLICT_CODES = new Set(["23505", "23503"]);
/** SQLite (D1) constraint messages for uniqueness (incl. primary key) and references. */
const SQLITE_CONFLICT = /\b(UNIQUE|PRIMARY KEY|FOREIGN KEY) constraint failed\b/;

/**
 * Driver errors meaning the database cannot be reached: a disposed Miniflare (local D1) binding
 * and connection-level failures of a Worker binding or socket. Driver-specific messages (a
 * closed PGlite instance) come from that driver's module through `unreachable`, so this module,
 * which every Worker bundle contains, names no Node-only driver (DEC-0196).
 */
const UNREACHABLE = /poisoned stub|Network connection lost|ECONNREFUSED|ECONNRESET|fetch failed/i;

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

/**
 * A thrown value as app code may see it: a `FrameworkError`. `unavailable` makes (and logs) the
 * `SQL.UNAVAILABLE` error for an unreachable database; `unreachable` adds the driver's own
 * patterns for one.
 */
export function normalizeError(
  thrown: unknown,
  unavailable: (why: string) => FrameworkError = plainUnavailable,
  unreachable: readonly RegExp[] = [],
): FrameworkError {
  if (thrown instanceof FrameworkError) return thrown;
  const errors = chain(thrown);
  if (errors.some((e) => PG_CONFLICT_CODES.has(field(e, "code")) || SQLITE_CONFLICT.test(field(e, "message")))) {
    return new FrameworkError("SQL.CONFLICT", "a uniqueness or reference constraint was violated");
  }
  const lost = errors.find((e) => [UNREACHABLE, ...unreachable].some((p) => p.test(field(e, "message"))));
  if (lost !== undefined) return unavailable(field(lost, "message"));
  const driver = errors[errors.length - 1];
  const message = field(driver, "message") || String(driver);
  const failure = new FrameworkError("CORE.INTERNAL", `database error: ${message}`);
  (failure as { cause?: unknown }).cause = thrown;
  return failure;
}
