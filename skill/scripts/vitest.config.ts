import { defineConfig } from "vitest/config";

// Scaffolder unit tests. Run: npx vitest run --config skill/scripts/vitest.config.ts
// (until the root unit config includes skill/scripts/**/*.unit.test.ts; see C-05 decision draft).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.unit.test.ts"],
  },
});
