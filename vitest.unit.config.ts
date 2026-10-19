import { defineConfig } from "vitest/config";

// Unit layer (plan §10.1): colocated framework unit tests and tool unit tests. No network.
export default defineConfig({
  test: {
    include: ["packages/framework/src/**/*.unit.test.ts", "tests/**/*.unit.test.ts"],
    pool: "forks",
  },
});
