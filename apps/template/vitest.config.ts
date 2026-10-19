import { defineConfig } from "vitest/config";

// App tests (PAR-116 glob). Opening the in-process Postgres for the first time in a test
// process takes several seconds, so tests and hooks get more than the default 5 s.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
