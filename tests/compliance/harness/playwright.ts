/**
 * Playwright setup for compliance specs (`*.spec.ts`, projects "integration", "e2e-api" and "e2e-ui"):
 * import `test` and `expect` from here instead of `@playwright/test`. Pages and the `request`
 * fixture then use the reference app's base URL on the target the driver chose, and the
 * harness's explicit User-Agent (DEC-0089).
 *
 *   import { expect, test } from "../../harness/playwright.js";
 *   test(tag("FILES-AC-004", "browser download"), async ({ page }) => { await page.goto("/"); … });
 */
import { test as base } from "@playwright/test";
import { browserOptions } from "./env.js";

const options = browserOptions();

export const test = base.extend({
  baseURL: async ({}, use) => {
    await use(options.baseURL);
  },
  userAgent: async ({}, use) => {
    await use(options.userAgent);
  },
});

export { expect } from "@playwright/test";
