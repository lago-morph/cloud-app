/**
 * SQL public names (contract: docs/contracts/ts/sql.d.ts; behavior: docs/components/sql.md).
 * Schema, column rules, values and drivers: B-05. Queries (`atomic`, ordering, `containsText`,
 * aggregate normalisation): B-06; those are still stubs.
 */
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { AtomicResults, Column, PortableDb, WriteStep } from "./types.js";

export type {
  AnyTable, AtomicResults, Column, ColumnBuilder, ColumnBuilders, PortableDb, PortableQueryResult, Table, TableDefinitions, TableOptions,
  WriteDb, WriteStep,
} from "./types.js";

// ---- Schema definition and values (B-05) -------------------------------------------
export { id, text, integer, number, timestamp, boolean, ref } from "./columns.js";
export { defineTable } from "./table.js";
export { newId, now } from "./values.js";

// ---- Queries (B-06) ----------------------------------------------------------------

function notImplemented(name: string): never {
  throw new Error(`not implemented: ${name}`);
}

/** Applies all steps as one all-or-nothing unit. */
export function atomic<const Steps extends readonly WriteStep[]>(
  db: PortableDb,
  steps: Steps,
): Promise<AtomicResults<Steps>> {
  return notImplemented("atomic");
}

// Supported expressions: Drizzle's own, re-exported unchanged in signature.
export { eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between } from "drizzle-orm";
// Aggregates: Drizzle's signatures; results are normalized as sql.md SQL-REQ-003 states.
export { count, countDistinct, min, max } from "drizzle-orm";

/** Sum as a JS number (SQL-REQ-003); null on empty input. */
export function sum(expression: SQLWrapper): SQL<number | null> {
  return notImplemented("sum");
}
/** Average as a JS number (SQL-REQ-003); null on empty input. */
export function avg(expression: SQLWrapper): SQL<number | null> {
  return notImplemented("avg");
}

/** Ascending, NULLs first. */
export function asc(column: Column): SQL {
  return notImplemented("asc");
}
/** Descending, NULLs last. */
export function desc(column: Column): SQL {
  return notImplemented("desc");
}
/** Literal substring match, case-insensitive for ASCII A–Z only. */
export function containsText(column: Column<string>, needle: string): SQL {
  return notImplemented("containsText");
}
