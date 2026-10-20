import { defineConfig } from "vitest/config";

// Scaffolder unit tests. Run: npx vitest run --config skill/scripts/vitest.config.ts
// The root `npm run test:unit` also runs them (vitest.unit.config.ts).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.unit.test.ts"],
  },
});
