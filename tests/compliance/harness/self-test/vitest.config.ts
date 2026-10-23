import { defineConfig } from "vitest/config";

// Harness self-test (C-02 exit): `npm run compliance -- --self-test` runs only this sample, so
// the self-test never runs the real suites and its record is written outside validation/.
export default defineConfig({
  test: {
    include: ["tests/compliance/harness/self-test/*.selftest.ts"],
    pool: "forks",
  },
});
