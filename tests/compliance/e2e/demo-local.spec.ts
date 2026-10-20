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
 */
import { USER_AGENT, tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { copyApp, randomSuffix, removeDir, setSecret } from "./support/apps.js";
import { configKey, DEMO_DIR, expectShown, openSettled, randomSecrets, writeLocalValues } from "./support/demo.js";
import { startDev, type DevServer } from "./support/process.js";

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
