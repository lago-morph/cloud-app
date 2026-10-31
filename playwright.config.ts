import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Playwright layers (plan §10.1, PAR-114, PAR-116; plan-v0.2.0 §7a.2.4): `*.spec.ts` only.
// - "integration": browser criteria of the framework suites and the compliance criteria.
// - "e2e-api": the E2E scenarios that use no browser (the `request` fixture, processes, files).
// - "e2e-ui": the E2E scenarios that drive a browser, directly or through a child process
//   (tests/compliance/e2e/support/template-pages.ts). The list is `e2e.ui` in
//   scripts/ci/path-map.json, so CI installs Chromium only when an e2e-ui spec is selected;
//   tests/ci-classify.unit.test.ts fails when a spec that uses a browser is missing from it.
// Each spec belongs to exactly one project. Run them through `npm run compliance` (they need its environment).
// This file therefore reads the path map: a malformed scripts/ci/path-map.json fails every Playwright run
// (the classifier unit tests parse it first).
const E2E_UI: string[] = (JSON.parse(readFileSync(new URL("./scripts/ci/path-map.json", import.meta.url), "utf8")) as { e2e: { ui: string[] } }).e2e.ui.map((p) => p.replace(/^tests\/compliance\/e2e\//, ""));

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
      name: "e2e-api",
      testDir: "tests/compliance/e2e",
      testMatch: "**/*.spec.ts",
      testIgnore: E2E_UI,
    },
    {
      name: "e2e-ui",
      testDir: "tests/compliance/e2e",
      testMatch: E2E_UI,
      use: { browserName: "chromium" },
    },
  ],
});
