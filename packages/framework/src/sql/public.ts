/**
 * SQL public names (contract: docs/contracts/ts/sql.d.ts; behavior: docs/components/sql.md).
 * Schema, column rules, values and drivers: B-05. Queries (`atomic`, ordering, `containsText`,
 * aggregate normalisation, the restricted handle): B-06.
 */

export type {
  AnyTable, AtomicResults, Column, ColumnBuilder, ColumnBuilders, PortableDb, PortableQueryResult, Table, TableDefinitions, TableOptions,
  WriteDb, WriteStep,
} from "./types.js";

// ---- Schema definition and values (B-05) -------------------------------------------
export { id, text, integer, number, timestamp, boolean, ref } from "./columns.js";
export { defineTable } from "./table.js";
export { newId, now } from "./values.js";

// ---- Queries (B-06) ----------------------------------------------------------------
export { atomic } from "./atomic.js";

// Supported expressions: Drizzle's own, re-exported unchanged in signature.
export { eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between } from "drizzle-orm";
// Aggregates: Drizzle's signatures; results are normalized as sql.md SQL-REQ-003 states.
export { count, countDistinct, min, max } from "drizzle-orm";
// Framework expressions: `sum`/`avg` as JS numbers, ordering with explicit NULL placement, `containsText`.
export { sum, avg, asc, desc, containsText } from "./expressions.js";
