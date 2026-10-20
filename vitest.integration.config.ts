import { defineConfig } from "vitest/config";

// Integration layer (plan §10.1), Vitest part: in-process framework suites with real local
// dependencies, plus the compliance criteria. Browser criteria are Playwright `*.spec.ts` files
// (playwright.config.ts, project "integration"), so the globs never overlap (PAR-116).
export default defineConfig({
  test: {
    include: ["packages/framework/test/integration/**/*.test.ts", "tests/compliance/criteria/**/*.test.ts", "tests/skill/**/*.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
  },
});
