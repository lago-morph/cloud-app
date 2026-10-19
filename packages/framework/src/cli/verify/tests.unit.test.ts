import { describe, expect, it } from "vitest";
import { summarizeFiles, TEST_GLOB, testRunnerOptions } from "./tests.js";

describe("verify's app test runs (CLI-REQ-002 step 4, LOCAL-REQ-003, PAR-116)", () => {
  it("summarizes the runner's task tree: suite paths, states, error messages; file-level errors separately", () => {
    const files = [
      {
        type: "suite",
        name: "tests/items.test.ts",
        filepath: "/apps/one/tests/items.test.ts",
        result: { state: "fail" },
        tasks: [
          { type: "test", name: "lists", mode: "run", result: { state: "pass" } },
          {
            type: "suite",
            name: "items",
            mode: "run",
            tasks: [{ type: "test", name: "negative limit", mode: "run", result: { state: "fail", errors: [{ message: "LIMIT must not be negative" }] } }],
          },
          { type: "test", name: "later", mode: "skip" },
        ],
      },
      { type: "suite", name: "tests/broken.test.ts", filepath: "/apps/one/tests/broken.test.ts", result: { state: "fail", errors: [{ message: "Cannot find module './nope'" }] }, tasks: [] },
    ];
    expect(summarizeFiles("/apps/one", files)).toEqual({
      tests: [
        { file: "tests/items.test.ts", name: "lists", state: "passed", errors: [] },
        { file: "tests/items.test.ts", name: "items > negative limit", state: "failed", errors: ["LIMIT must not be negative"] },
        { file: "tests/items.test.ts", name: "later", state: "skipped", errors: [] },
      ],
      fileErrors: [{ file: "tests/broken.test.ts", message: "Cannot find module './nope'" }],
    });
  });

  it("runs only tests/**/*.test.ts from the app root, ignores app test configuration, keeps no cache, and allows a slow first Postgres open", () => {
    expect(TEST_GLOB).toBe("tests/**/*.test.ts");
    const options = testRunnerOptions("/apps/one");
    expect(options).toMatchObject({ root: "/apps/one", config: false, include: ["tests/**/*.test.ts"], watch: false, passWithNoTests: true });
    expect(options.testTimeout).toBeGreaterThanOrEqual(60_000);
    expect(options.hookTimeout).toBeGreaterThanOrEqual(60_000);
  });
});
