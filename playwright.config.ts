import { defineConfig } from "@playwright/test";

// Playwright layers (plan §10.1, PAR-114, PAR-116): `*.spec.ts` only.
// - "integration": browser criteria of the framework suites and the compliance criteria.
// - "e2e": the E2E scenarios (browser and API-only; API-only specs use the `request` fixture).
// Web servers and base URLs are added by the items that write the first specs (C-02).
export default defineConfig({
  outputDir: "test-results",
  projects: [
    {
      name: "integration",
      testDir: ".",
      testMatch: ["packages/framework/test/integration/**/*.spec.ts", "tests/compliance/criteria/**/*.spec.ts"],
      use: { browserName: "chromium" },
    },
    {
      name: "e2e",
      testDir: "tests/compliance/e2e",
      testMatch: "**/*.spec.ts",
      use: { browserName: "chromium" },
    },
  ],
});
