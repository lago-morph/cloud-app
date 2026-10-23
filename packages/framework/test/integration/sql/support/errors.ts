/**
 * Assertions on framework failures as app code sees them (errors.d.ts). Imports the
 * framework, so only suites (loaded after the dialect is selected) may import this module.
 */
import { expect } from "vitest";
import { ERROR_CATALOGUE, FrameworkError, type ErrorCode } from "../../../../src/index.js";
import type { Outcome } from "./probe.js";

/** The outcome is a thrown `FrameworkError` with exactly `code`. */
export function expectCode(outcome: Outcome<unknown>, code: ErrorCode): void {
  expect(outcome.ok, "expected the operation to fail").toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(FrameworkError);
  expect((outcome.error as FrameworkError).code).toBe(code);
}

/** The outcome is a thrown `FrameworkError` whose code is in the catalogue (any code). */
export function expectCatalogueError(outcome: Outcome<unknown>): void {
  expect(outcome.ok, "expected the operation to fail").toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(FrameworkError);
  expect(Object.keys(ERROR_CATALOGUE)).toContain((outcome.error as FrameworkError).code);
}

/** Runs `op` and expects it to reject with a `FrameworkError` with exactly `code`. */
export async function expectRejects(op: () => Promise<unknown>, code: ErrorCode): Promise<void> {
  let caught: unknown = undefined;
  let threw = false;
  try {
    await op();
  } catch (error) {
    threw = true;
    caught = error;
  }
  expect(threw, `expected ${code}`).toBe(true);
  expect(caught).toBeInstanceOf(FrameworkError);
  expect((caught as FrameworkError).code).toBe(code);
}

/** PAR-280: floating-point comparison tolerance in compliance tests. */
export function expectClose(actual: unknown, expected: number): void {
  expect(typeof actual).toBe("number");
  const a = actual as number;
  expect(Math.abs(a - expected) <= Math.max(1e-12, 1e-12 * Math.abs(expected)), `${a} ≈ ${expected} (PAR-280)`).toBe(true);
}
