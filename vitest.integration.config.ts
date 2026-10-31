import { configDefaults, defineConfig } from "vitest/config";

// Integration layer (plan §10.1), Vitest part: in-process framework suites with real local
// dependencies, plus the compliance criteria. Browser criteria are Playwright `*.spec.ts` files
// (playwright.config.ts, project "integration"), so the globs never overlap (PAR-116).
// `*.unit.test.ts` files belong to the unit layer only (plan-v0.2.0 §7a.2.4 "No duplicates";
// DEC-0640): the include globs would also match those under tests/compliance/criteria and tests/skill.
export default defineConfig({
  test: {
    include: ["packages/framework/test/integration/**/*.test.ts", "tests/compliance/criteria/**/*.test.ts", "tests/skill/**/*.test.ts", "packages/create-prototype-app/test/**/*.offline.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.unit.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
  },
});
