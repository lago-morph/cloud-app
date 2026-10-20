// B-RUN exercise script (runner-written input, not a test of the suite): drives the template app's
// pages in Chromium against a running `npm --workspace apps/template run dev` server and prints
// what each page shows. Usage: node exercise-pages.mjs http://localhost:<port>/ <out-dir>
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
// run-2 change (root cause 2026-10-19-template-download-popup.md, accepted): the "Download" button's
// file is observed through Playwright's `download` event on the opener page (or any popup page),
// and the downloaded bytes are compared with the uploaded bytes; the popup's content is not read.
import { join } from "node:path";

const base = process.argv[2];
const outDir = process.argv[3];
const steps = [];
function record(step, data) {
  const entry = { step, ...data };
  steps.push(entry);
  console.log(JSON.stringify(entry));
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
const apiResponses = [];
page.on("response", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/api")) apiResponses.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`);
});

try {
  // 1. Anonymous: greeting (config) and account page.
  await page.goto(base);
  await page.waitForSelector("h1");
  record("anonymous-load", { h1: await page.textContent("h1"), body: (await page.textContent("#app"))?.trim() });

  // 2. Log in through the page's "Log in" button (mock provider locally).
  await page.click("text=Log in");
  await page.waitForSelector("text=Logged in as", { timeout: 15000 });
  record("login-button", { url: page.url(), account: await page.textContent("section:has(h2:text('Account')) p") });
  await page.waitForSelector("section:has(h2:text('Notes'))");

  // 3. Notes (SQL + log write).
  const noteText = `b-run note ${Date.now()}`;
  await page.fill("section:has(h2:text('Notes')) input", noteText);
  await page.click("section:has(h2:text('Notes')) button:text('Add')");
  await page.waitForSelector(`section:has(h2:text('Notes')) li:has-text("${noteText}")`, { timeout: 15000 });
  record("notes-add", { items: await page.locator("section:has(h2:text('Notes')) li").allTextContents() });

  // 4. Status (KV): save, reload, read back.
  const statusText = `b-run status ${Date.now()}`;
  await page.fill("section:has(h2:text('Status')) input", statusText);
  await page.click("section:has(h2:text('Status')) button:text('Save')");
  await page.waitForSelector("section:has(h2:text('Status')) p:text('Saved.')", { timeout: 15000 });
  await page.reload();
  await page.waitForSelector("section:has(h2:text('Status'))");
  await page.waitForFunction(
    (v) => document.querySelector("section:nth-of-type(3) input")?.value === v || [...document.querySelectorAll("section input")].some((i) => i.value === v),
    statusText,
    { timeout: 15000 },
  );
  record("status-save-reload", { value: await page.inputValue("section:has(h2:text('Status')) input") });

  // 5. Files: upload through the page, then download via ticket.
  const fileBody = `b-run file content ${Date.now()}\n`;
  await page.setInputFiles("section:has(h2:text('Files')) input[type=file]", {
    name: "b-run.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fileBody),
  });
  await page.click("section:has(h2:text('Files')) button:text('Upload')");
  await page.waitForSelector("section:has(h2:text('Files')) p:text('Uploaded.')", { timeout: 20000 }).catch(() => {});
  record("files-upload", {
    message: await page.textContent("section:has(h2:text('Files')) p"),
    items: await page.locator("section:has(h2:text('Files')) li").allTextContents(),
  });
  // Arm the download listener on the opener and on every page the context opens, before the click.
  const downloadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no download event within 20000 ms")), 20000);
    const arm = (p, tag) => p.on("download", (d) => { clearTimeout(timer); resolve({ d, tag }); });
    arm(page, "opener");
    context.on("page", (p) => arm(p, "popup"));
  });
  const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await page.click("section:has(h2:text('Files')) li:has-text('b-run.txt') button:text('Download')");
  const { d: download, tag: downloadOn } = await downloadPromise;
  const failure = await download.failure();
  const savedPath = await download.path();
  const savedBytes = readFileSync(savedPath);
  const uploadedBytes = Buffer.from(fileBody);
  const dlUrl = download.url();
  record("files-download-button", {
    downloadEventOn: downloadOn,
    urlPath: dlUrl.startsWith("http") ? new URL(dlUrl).pathname.replace(/[^/]+$/, "<ticket>") : dlUrl,
    failure,
    savedLength: savedBytes.length,
    uploadedLength: uploadedBytes.length,
    bytesEqual: Buffer.compare(savedBytes, uploadedBytes) === 0,
  });
  const popup = await popupPromise;
  if (popup) await popup.close().catch(() => {});
  // Same download through a fresh ticket fetched from the page (the URL the Download button opens).
  const viaFetch = await page.evaluate(async () => {
    const t = await fetch("/api/files/download-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "b-run.txt" }),
    });
    const { ticket } = await t.json();
    const r = await fetch(ticket.url);
    return { ticketStatus: t.status, status: r.status, contentType: r.headers.get("content-type"), body: await r.text() };
  });
  record("files-download-fetch", { ticketStatus: viaFetch.ticketStatus, status: viaFetch.status, contentType: viaFetch.contentType, matches: viaFetch.body.trim() === fileBody.trim() });

  // 6. Admin page: user level has no Admin section.
  record("user-has-no-admin-section", { adminSections: await page.locator("section:has(h2:text('Admin'))").count() });
  const asUser = await page.evaluate(async () => {
    const r = await fetch("/api/admin/secret");
    return { status: r.status, body: await r.text() };
  });
  record("admin-secret-as-user", asUser);

  // 7. Become admin with the authentication mock (local only), then use the Admin page.
  const mock = await page.evaluate(async () => {
    const r = await fetch("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "admin", id: "b-run-admin", displayName: "B-RUN Admin" }),
    });
    return { status: r.status };
  });
  record("mock-login-admin", mock);
  await page.reload();
  await page.waitForSelector("section:has(h2:text('Admin'))", { timeout: 15000 });
  record("admin-account", { account: await page.textContent("section:has(h2:text('Account')) p") });
  await page.click("section:has(h2:text('Admin')) button:text('Check secret')");
  await page.waitForFunction(() => /apiKey|\w+\./.test(document.querySelector("section:last-of-type p")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  record("admin-check-secret", { message: await page.textContent("section:has(h2:text('Admin')) p") });

  // 8. Log out through the page.
  await page.click("section:has(h2:text('Account')) button:text('Log out')");
  await page.waitForSelector("text=You are not logged in.", { timeout: 15000 });
  record("logout-button", { body: (await page.textContent("#app"))?.trim() });

  // 9. SPA deep link fallback.
  const deep = await page.goto(new URL("/some/deep/link", base).toString());
  record("deep-link", { status: deep?.status(), hasAppRoot: (await page.locator("#app").count()) === 1 });
} catch (e) {
  record("error", { message: e.message });
  process.exitCode = 1;
} finally {
  await page.screenshot({ path: join(outDir, "final-page.png") }).catch(() => {});
  writeFileSync(join(outDir, "exercise-pages.steps.json"), JSON.stringify({ steps, apiResponses, console: consoleLines }, null, 2));
  await browser.close();
}
