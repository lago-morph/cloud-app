/**
 * Value rules per portable column type (sql.md §2.1, SQL-REQ-004). A violation throws
 * `SQL.INVALID_VALUE` before anything reaches the database.
 */
import { FrameworkError } from "../core/errors.js";

export type ColumnKind = "id" | "text" | "integer" | "number" | "timestamp" | "boolean" | "ref";

function invalid(label: string, rule: string, value: unknown): never {
  throw new FrameworkError("SQL.INVALID_VALUE", `${label}: ${describe(value)} is not ${rule}`);
}

function describe(value: unknown): string {
  if (typeof value === "string") return `a string of length ${value.length}`;
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return `the bigint ${value}n`;
  if (value === null) return "null";
  return `a value of type ${typeof value}`;
}

/** Checks `value` against the rule of `kind`; returns the value to store. `label` names the column. */
export function checkValue(kind: ColumnKind, value: unknown, label: string): unknown {
  switch (kind) {
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        invalid(label, "a signed 32-bit integer", value);
      }
      return value === 0 ? 0 : value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) invalid(label, "a finite number", value);
      return value === 0 ? 0 : value;
    case "timestamp":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        invalid(label, "a timestamp (non-negative safe integer of epoch milliseconds)", value);
      }
      return value === 0 ? 0 : value;
    case "boolean":
      if (typeof value !== "boolean") invalid(label, "a boolean", value);
      return value;
    case "text":
      if (typeof value !== "string" || LONE_SURROGATE.test(value) || value.includes("\u0000")) {
        invalid(label, "well-formed Unicode text without NUL", value);
      }
      return value;
    case "id":
    case "ref":
      if (typeof value !== "string" || !UUID_V4.test(value)) invalid(label, "an ID made by newId() (lowercase UUID v4)", value);
      return value;
  }
}

/** New random ID for an `id()` column (UUID v4 text, lowercase). */
export function newId(): string {
  return crypto.randomUUID();
}

/** Current time as a `timestamp()` value (epoch milliseconds). */
export function now(): number {
  return Date.now();
}

// Code-unit regex (no `u` flag): a high surrogate not followed by a low one, or a low one not
// preceded by a high one. (`String.prototype.isWellFormed` is ES2024; the lib set is ES2023.)
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UUID_V4 =/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
