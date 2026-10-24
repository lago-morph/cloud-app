import { defineConfig } from "vitest/config";

/**
 * Runner limits shared with the root `vitest.config.ts`, which a bare `npx vitest run <paths>` loads.
 * Tests that open PGlite or D1/workerd, or run tsc, take 2–4 s here and 6–11 s when other agents load the
 * shared 4-CPU machine (load 15–28). Vitest's defaults (5 s per test, 10 s per hook) then fail them with no
 * defect. A hook pays the same costs: the first `DataApiFake.create` in a process runs initdb (≈2.2 s idle).
 * Tests that need more keep their own, larger timeouts. See ai/implementation/root-causes/
 * 2026-10-20-D-04-verify-unrelated-failures.md, 2026-10-20-global-unit-timeout-review.md and
 * 2026-10-24-data-api-fake-template-intermittent.md.
 */
export const UNIT_RUNNER = { pool: "forks", testTimeout: 30_000, hookTimeout: 30_000 } as const;

// Unit layer (plan §10.1): colocated framework unit tests and tool unit tests. No network.
export default defineConfig({
  test: {
    include: ["packages/framework/src/**/*.unit.test.ts", "tests/**/*.unit.test.ts", "skill/scripts/**/*.unit.test.ts"],
    ...UNIT_RUNNER,
  },
});
