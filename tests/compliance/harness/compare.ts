/**
 * Result comparisons (compliance.md "Comparisons"): query results without a total ordering are
 * compared as multisets; floating-point values use PAR-280:
 * `abs(actual − expected) ≤ max(1e-12, 1e-12 × abs(expected))`.
 */

/** PAR-280. */
export function floatsClose(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1e-12, 1e-12 * Math.abs(expected));
}

/** Deep equality where numbers compare with PAR-280 and everything else exactly. */
export function approxEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") return actual === expected || floatsClose(actual, expected);
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object") return Object.is(actual, expected);
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((value, i) => approxEqual(value, expected[i]));
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(e).length) return false;
  return keys.every((key) => Object.hasOwn(e, key) && approxEqual(a[key], e[key]));
}

export interface MultisetDiff<T> {
  /** Expected rows the actual result lacks (one entry per missing occurrence). */
  readonly missing: T[];
  /** Actual rows the expectation lacks. */
  readonly unexpected: T[];
}

export function multisetDiff<T>(actual: readonly T[], expected: readonly T[]): MultisetDiff<T> {
  const remaining = [...actual];
  const missing: T[] = [];
  for (const row of expected) {
    const index = remaining.findIndex((candidate) => approxEqual(candidate, row));
    if (index === -1) missing.push(row);
    else remaining.splice(index, 1);
  }
  return { missing, unexpected: remaining };
}

/** Throws, naming the missing and unexpected rows, unless the two are equal as multisets. */
export function expectMultisetEqual<T>(actual: readonly T[], expected: readonly T[]): void {
  const diff = multisetDiff(actual, expected);
  if (diff.missing.length > 0 || diff.unexpected.length > 0) {
    throw new Error(`results differ as multisets: missing: ${JSON.stringify(diff.missing)}; unexpected: ${JSON.stringify(diff.unexpected)}`);
  }
}
