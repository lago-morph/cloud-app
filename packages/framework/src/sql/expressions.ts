/**
 * Portable expressions (sql.md §2.2, SQL-REQ-003): ordering with explicit NULL placement,
 * `containsText`, and `sum`/`avg` normalized to JS numbers.
 */
import { is, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { FrameworkError } from "../core/errors.js";
import type { Column } from "./types.js";

/** Ascending, NULLs first (SQL-REQ-003). */
export function asc(column: Column): SQL {
  return sql`${column} asc nulls first`;
}

/** Descending, NULLs last (SQL-REQ-003). */
export function desc(column: Column): SQL {
  return sql`${column} desc nulls last`;
}

/**
 * A numeric aggregate result as a JS number (sql.md §2.2): Postgres returns `numeric` and
 * `bigint` results as strings (or bigints); an unsafe integer is `SQL.INVALID_VALUE`.
 * Drizzle passes NULL through without calling this.
 */
export function toJsNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
    throw new FrameworkError("SQL.INVALID_VALUE", `an aggregate result (${String(value)}) is not representable as a safe JS number`);
  }
  return n;
}

/** Sum as a JS number; null on empty input (SQL-REQ-003). */
export function sum(expression: SQLWrapper): SQL<number | null> {
  return sql`sum(${expression})`.mapWith(toJsNumber) as SQL<number | null>;
}

/** Average as a JS number; null on empty input (SQL-REQ-003). */
export function avg(expression: SQLWrapper): SQL<number | null> {
  return sql`avg(${expression})`.mapWith(toJsNumber) as SQL<number | null>;
}

/**
 * Literal substring match, case-insensitive for ASCII A–Z only: `lower()` on the column (which
 * folds only ASCII on SQLite and on Postgres with C ctype, DEC-0106) and a substring-position
 * function, so `%`, `_` and `\` are literal. The needle is folded here, ASCII only. An empty
 * needle is found at position 1 of every non-NULL value; NULL never matches.
 */
export function containsText(column: Column<string>, needle: string): SQL {
  const folded = needle.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return is(column, SQLiteColumn)
    ? sql`instr(lower(${column}), ${folded}) > 0`
    : sql`strpos(lower(${column}), ${folded}) > 0`;
}
