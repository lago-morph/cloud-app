/**
 * The driver's test selection (compliance.md "Driver"; decision draft fix-c3): which runner
 * invocations a run on a target makes, and which IDs each may evidence. The driver adds the
 * `-t`/`--grep` tag pattern and its reporters; E2E-004's coverage part lists the same
 * invocations (tests/compliance/tools/listing.ts). Both read this one definition, so the
 * coverage check cannot drift from what the driver runs.
 */
import { parseTags } from "../../support/tags.js";
import type { Target } from "./catalogue.js";
import { UNIT_LEVEL } from "./expected.js";

export const SELF_TEST_CONFIG = "tests/compliance/harness/self-test/vitest.config.ts";

export interface RunnerSelection {
  readonly runner: "vitest" | "playwright";
  /** Name of the raw output files (`<label>.log`, `<label>.json`). */
  readonly label: string;
  /** The runner's arguments that select its tests, without the tag filter and reporters. */
  readonly args: readonly string[];
  /** The only IDs this invocation's outcomes may evidence; absent for every expected ID. */
  readonly onlyIds?: readonly string[];
}

export function runnerSelection(options: { readonly target: Target; readonly selfTest?: boolean }): RunnerSelection[] {
  if (options.selfTest === true) return [{ runner: "vitest", label: "vitest", args: ["vitest", "run", "--config", SELF_TEST_CONFIG] }];
  const isCloud = options.target !== "local";
  // Playwright's `--project` is variadic: a path after it is read as a project name, so test
  // paths come before the projects (decision D-06-3).
  return [
    { runner: "vitest", label: "vitest", args: ["vitest", "run", "--config", "vitest.integration.config.ts", ...(isCloud ? ["tests/compliance/criteria"] : [])] },
    ...(isCloud ? [] : [{ runner: "vitest" as const, label: "vitest-unit", args: ["vitest", "run", "--config", "vitest.unit.config.ts"], onlyIds: UNIT_LEVEL }]),
    { runner: "playwright", label: "playwright", args: ["playwright", "test", ...(isCloud ? ["tests/compliance/"] : []), "--project", "integration", "--project", "e2e"] },
  ];
}

/** The IDs `selection` runs among `ids`. */
export function idsFor(selection: RunnerSelection, ids: readonly string[]): string[] {
  const only = selection.onlyIds;
  return only === undefined ? [...ids] : ids.filter((id) => only.includes(id));
}

/**
 * Tests (outcomes or listed tests) of one invocation, each with the IDs it may evidence. An
 * invocation limited to `onlyIds` keeps only tests carrying one of them, and only those IDs.
 */
export function scopeTests<T extends { readonly title: string }>(selection: RunnerSelection, tests: readonly T[]): (T & { readonly ids?: readonly string[] })[] {
  const only = selection.onlyIds;
  if (only === undefined) return [...tests];
  return tests.flatMap((t) => {
    const ids = parseTags(t.title).filter((id) => only.includes(id));
    return ids.length === 0 ? [] : [{ ...t, ids }];
  });
}

/** The IDs among `expected` that no listed test evidences (E2E-004 coverage part). */
export function uncovered(expected: readonly string[], listed: readonly { readonly title: string; readonly ids?: readonly string[] }[]): string[] {
  const covered = new Set(listed.flatMap((t) => t.ids ?? parseTags(t.title)));
  return expected.filter((id) => !covered.has(id));
}
