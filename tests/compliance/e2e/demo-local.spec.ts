/**
 * DEMO-AC-006 (docs/demo/demo-spec.md §2; Where: Local): "Changing the site title in
 * configuration and rebuilding changes the displayed title."
 *
 * A copy of `apps/demo` in the git-ignored `.framework/e2e/` runs under `dev` (each `dev` start
 * is a build). The site title's configuration key is the one key the app declares whose name
 * says "title" (DEMO-REQ-006 says the site title comes from configuration but does not name the
 * key; support/demo.ts `configKey`). The test sets a new title in the copy's values file
 * (`config/local.json`, stage-config.schema.json), starts `dev` again, and checks the page shows
 * the new title, which it did not show before. The repository's own files are never changed.
 *
 * CHECK-AC-005, demo part (docs/components/check.md; Where: Local): "The template and demo pass
 * all rules." CHECK-REQ-005: "the template and demo code MUST pass." The rules run the way an
 * app runs them, `<package> verify` (CLI-REQ-001, CLI-REQ-002), on a fresh copy of `apps/demo`
 * in the git-ignored `.framework/e2e/` (no local state, build output or secrets copied), as the
 * template part's test "verify passes on the template" does with the template. `verify` is local
 * and needs no network or cloud (CLI-REQ-002).
 */
import { USER_AGENT, tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { copyApp, randomSuffix, removeDir, setSecret } from "./support/apps.js";
import { configKey, DEMO_DIR, expectShown, openSettled, randomSecrets, writeLocalValues } from "./support/demo.js";
import { frameworkCli, startDev, tail, type DevServer } from "./support/process.js";

if (target().target === "local") {
  test(tag("CHECK-AC-005", "demo part: verify passes on a fresh copy of apps/demo (portability rules, migration checker, type checking and the app's tests)"), async () => {
    test.setTimeout(20 * 60_000);
    const dir = copyApp(DEMO_DIR, "check-ac-005-demo");
    try {
      const result = await frameworkCli(dir, ["verify"], { timeoutMs: 18 * 60_000 });
      expect(result.status, `verify on the demo copy exited ${String(result.status)}:\n${tail(result.output, 20_000)}`).toBe(0);
    } finally {
      removeDir(dir);
    }
  });
}

if (target().target === "local") {
  test(tag("DEMO-AC-006", "changing the site title in the values file and rebuilding (restarting dev) changes the title the page displays"), async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const key = await configKey(/title/i, "the site title");
    const title = `Board ${randomSuffix(4)}`;
    const dir = copyApp(DEMO_DIR, "demo-ac-006");
    let dev: DevServer | undefined;
    try {
      for (const [name, value] of Object.entries(await randomSecrets())) await setSecret(dir, "local", "local", name, value);

      const shown = async (origin: string): Promise<{ text: string }> => {
        const context = await browser.newContext({ baseURL: origin, userAgent: USER_AGENT });
        try {
          const page = await context.newPage();
          await openSettled(page, "/");
          return { text: await page.locator("body").innerText() };
        } finally {
          await context.close();
        }
      };

      // Before: the committed configuration; the new title is not displayed.
      dev = await startDev(dir);
      const before = await shown(dev.origin);
      expect(before.text, "the page renders").not.toBe("");
      expect(before.text, "the new title is not displayed before the change").not.toContain(title);
      await dev.stop();
      dev = undefined;

      // Change the site title in configuration and rebuild.
      writeLocalValues(dir, { [key]: title });
      dev = await startDev(dir);
      const context = await browser.newContext({ baseURL: dev.origin, userAgent: USER_AGENT });
      try {
        const page = await context.newPage();
        await openSettled(page, "/");
        await expectShown(page, title, "the page displays the configured site title");
      } finally {
        await context.close();
      }
    } finally {
      if (dev !== undefined) await dev.stop();
      removeDir(dir);
    }
  });
}
