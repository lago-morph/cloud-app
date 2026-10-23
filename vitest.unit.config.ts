import { defineConfig } from "vitest/config";

// Unit layer (plan §10.1): colocated framework unit tests and tool unit tests. No network.
export default defineConfig({
  test: {
    include: ["packages/framework/src/**/*.unit.test.ts", "tests/**/*.unit.test.ts", "skill/scripts/**/*.unit.test.ts"],
    pool: "forks",
    // Tests that open PGlite or D1/workerd, or run tsc, take 2–4 s here and 6–11 s when other agents load the
    // shared 4-CPU machine (load 15–28). The 5 s default then fails them with no defect. Tests that need more
    // keep their own, larger timeouts. See ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md
    // and 2026-10-20-global-unit-timeout-review.md.
    testTimeout: 30_000,
  },
});
