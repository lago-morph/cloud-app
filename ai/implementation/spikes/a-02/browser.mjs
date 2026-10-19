// Usage: node browser.mjs <url> — loads the URL in Playwright Chromium (headless shell), with and without the
// launch `proxy` option set from HTTPS_PROXY, and also does an in-page fetch() from a second path.
import { chromium } from "@playwright/test";

const url = process.argv[2];
const variants = [
  ["no proxy launch option", {}],
  ["proxy launch option = HTTPS_PROXY", { proxy: { server: process.env.HTTPS_PROXY } }],
];
for (const [name, opts] of variants) {
  console.log(`## ${name}`);
  const browser = await chromium.launch(opts);
  try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const res = await page.goto(url, { timeout: 30_000 });
    console.log(`goto status=${res.status()} ms=${Date.now() - t0} body=${(await page.textContent("body"))?.trim()}`);
    const sec = await res.securityDetails();
    console.log(`tls issuer=${sec?.issuer} protocol=${sec?.protocol}`);
    const inPage = await page.evaluate(async () => {
      const r = await fetch("/in-page-fetch");
      return `${r.status} ${await r.text()}`;
    });
    console.log(`in-page fetch: ${inPage}`);
  } catch (e) {
    console.log(`error: ${e.message.split("\n")[0]}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
console.log(`chromium version=${chromium.executablePath()}`);
