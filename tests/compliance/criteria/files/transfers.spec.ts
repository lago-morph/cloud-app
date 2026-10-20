/**
 * FILES browser criteria in a real browser (Playwright Chromium) against the reference app on
 * the run's target: `dev` locally (B-EV flag F6: not a test harness), the test stage on a cloud.
 * docs/components/files.md FILES-REQ-003, FILES-REQ-004, FILES-REQ-006; client.d.ts.
 *
 * - FILES-AC-003, except its expired-ticket clause (expired-ticket.spec.ts, which waits PAR-233);
 * - FILES-AC-004, browser part (an unrelated origin);
 * - FILES-AC-006, browser part (an interrupted transfer; Where: Local).
 *
 * Transfers go through the framework's `uploadFile` / `downloadUrl` (browser.ts explains how).
 */
import { client, tag, target, type ComplianceClient } from "../../harness/index.js";
import { expect, test } from "../../harness/playwright.js";
import {
  downloadInPage,
  downloadTicket,
  installHelpers,
  nameRewrites,
  openAppPage,
  rawFetchInPage,
  startCuttingProxy,
  startUnrelatedOrigin,
  ticketClient,
  uploadInPage,
  uploadTicket,
} from "./browser.js";
import { getFile, head, removeAll, uniquePrefix } from "./support.js";

const MiB = 1024 * 1024;
const prefixes: string[] = [];
let cleaner: ComplianceClient | undefined;

function prefix(label: string): string {
  const p = uniquePrefix(label);
  prefixes.push(p);
  return p;
}

test.afterAll(async () => {
  cleaner ??= await client().as("user", { id: "c-t3-files-browser" });
  for (const p of prefixes) await removeAll(cleaner, p);
});

async function user(): Promise<ComplianceClient> {
  cleaner ??= await ticketClient("c-t3-files-browser");
  return cleaner;
}

test(tag("FILES-AC-003", "a 20 MB file uploads through uploadFile and downloads through downloadUrl byte-exact"), async ({ page }) => {
  test.setTimeout(240_000);
  const u = await user();
  const name = `${prefix("ac003-20mb")}twenty.bin`;
  await openAppPage(page);
  const size = 20 * MiB;
  const up = await uploadInPage(page, await uploadTicket(u, name, "application/octet-stream"), { size, seed: 20, type: "application/octet-stream" });
  expect(up).toMatchObject({ ok: true, size });
  expect(up.maxLoaded).toBe(size);
  expect(await head(u, name)).toStrictEqual({ name, size, contentType: "application/octet-stream" });
  const down = await downloadInPage(page, await downloadTicket(u, name));
  expect(down).toStrictEqual({ ok: true, status: 200, size, sha256: up.sha256 });
});

test(tag("FILES-AC-003", "a ticket for one name cannot write another"), async ({ page }) => {
  const u = await user();
  const p = prefix("ac003-scope");
  const one = `${p}one.txt`;
  const two = `${p}two.txt`;
  await openAppPage(page);
  const ticket = await uploadTicket(u, one, "text/plain");

  // Used as issued, the ticket writes its own name and nothing else.
  const first = await uploadInPage(page, ticket, { size: 64, seed: 1, type: "text/plain" });
  expect(first).toMatchObject({ ok: true, size: 64 });
  expect(await head(u, one)).toStrictEqual({ name: one, size: 64, contentType: "text/plain" });
  expect(await head(u, two)).toBeNull();
  const original = await getFile(u, one);

  // Edited to name another file, wherever the URL carries the name, it is refused.
  const rewrites = nameRewrites(new URL(ticket.url, page.url()).toString(), one, two);
  expect(rewrites.length, "the ticket URL carries the name in a form the test can rewrite").toBeGreaterThan(0);
  for (const url of rewrites) {
    const res = await rawFetchInPage(page, url, { method: ticket.method, headers: { ...ticket.headers }, body: "written through another name's ticket" });
    expect(res.ok, `rewritten ticket URL was accepted (status ${String(res.status)})`).toBe(false);
  }
  expect(await head(u, two)).toBeNull();
  expect(Array.from((await getFile(u, one))?.bytes ?? [])).toStrictEqual(Array.from(original?.bytes ?? []));
  expect(await head(u, one)).toStrictEqual({ name: one, size: 64, contentType: "text/plain" });
});

test(tag("FILES-AC-003", "an upload with a content type other than the ticket's is rejected and stores nothing"), async ({ page }) => {
  const u = await user();
  const name = `${prefix("ac003-type")}typed.txt`;
  await openAppPage(page);
  const ticket = await uploadTicket(u, name, "text/plain");
  expect(ticket.headers["Content-Type"] ?? ticket.headers["content-type"]).toBe("text/plain");
  // A request no framework helper would send: the ticket's URL and method with another type.
  const res = await rawFetchInPage(page, new URL(ticket.url, page.url()).toString(), { method: ticket.method, headers: { "Content-Type": "image/png" }, body: "not the declared type" });
  expect(res.ok, `upload with another content type was accepted (status ${String(res.status)})`).toBe(false);
  expect(await head(u, name)).toBeNull();
  // Control: the same ticket with its own content type works.
  expect(await uploadInPage(page, ticket, { size: 16, seed: 3, type: "text/plain" })).toMatchObject({ ok: true });
  expect(await head(u, name)).toStrictEqual({ name, size: 16, contentType: "text/plain" });
});

test(tag("FILES-AC-003", "uploadFile rejects a Blob whose non-empty type differs from the ticket's before sending: FILES.TRANSFER_FAILED, status null, content type does not match ticket"), async ({ page }) => {
  const u = await user();
  const name = `${prefix("ac003-blobtype")}photo.png`;
  await openAppPage(page);
  const ticket = await uploadTicket(u, name, "image/png");
  const ticketPath = new URL(ticket.url, page.url()).pathname;
  const sent: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === ticketPath) sent.push(`${r.method()} ${r.url()}`);
  });
  const out = await uploadInPage(page, ticket, { size: 32, seed: 4, type: "image/jpeg" });
  expect(out).toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED", status: null });
  expect(out.message).toContain("content type does not match ticket");
  expect(out.maxLoaded).toBe(0);
  expect(sent, "a request reached the ticket URL").toStrictEqual([]);
  expect(await head(u, name)).toBeNull();
});

test(tag("FILES-AC-004", "browser part: an upload and a download attempted from an unrelated origin are rejected by the browser"), async ({ page }) => {
  const u = await user();
  const p = prefix("ac004-origin");
  const appOrigin = new URL(target().baseUrl).origin;

  // Control, from the app's own origin: the same kinds of ticket work.
  await openAppPage(page);
  const own = `${p}own.png`;
  expect(await uploadInPage(page, await uploadTicket(u, own, "image/png"), { size: 128, seed: 5, type: "image/png" })).toMatchObject({ ok: true });
  expect(await downloadInPage(page, await downloadTicket(u, own))).toMatchObject({ ok: true, status: 200, size: 128 });

  const unrelated = await startUnrelatedOrigin(appOrigin);
  try {
    await page.goto(`${unrelated.origin}/`);
    await page.waitForFunction(() => typeof (globalThis as { fw?: { uploadFile?: unknown } }).fw?.uploadFile === "function");
    expect(new URL(page.url()).origin).not.toBe(appOrigin);

    const foreign = `${p}foreign.png`;
    const up = await uploadInPage(page, await uploadTicket(u, foreign, "image/png"), { size: 128, seed: 6, type: "image/png" });
    const stored = await head(u, foreign);
    const down = await downloadInPage(page, await downloadTicket(u, own));
    // Soft, so the evidence shows the upload and the download outcome together.
    expect.soft(up, "upload from the unrelated origin").toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED", status: null });
    expect.soft(up.message, "upload failure class").toContain("no response: network or cross-origin blocked");
    expect.soft(stored, "the unrelated origin's upload stored a file").toBeNull();
    expect.soft(down, "download from the unrelated origin").toMatchObject({ ok: false, status: null });
    expect.soft(down.message, "download failure").toMatch(/^TypeError/);
  } finally {
    await unrelated.close();
  }
});

test(tag("FILES-AC-006", "browser part: an upload interrupted mid-way fails with FILES.TRANSFER_FAILED and an interrupted after n bytes message"), async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const u = await user();
  const name = `${prefix("ac006-interrupt")}cut.bin`;
  const ticket = await uploadTicket(u, name, "application/octet-stream");
  const size = 16 * MiB;
  const proxy = await startCuttingProxy(new URL(ticket.url, target().baseUrl).pathname, 2 * MiB);
  const context = await browser.newContext({ ...(baseURL === undefined ? {} : { baseURL }), proxy: { server: proxy.server, bypass: "<-loopback>" } });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await installHelpers(page);
    // Slow the upload so the cut lands while the body is still being sent, not after the
    // whole body has gone into socket buffers.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 4 * MiB });
    const out = await uploadInPage(page, ticket, { size, seed: 9, type: "application/octet-stream" });
    expect(proxy.cuts()).toBeGreaterThan(0);
    expect(out).toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED", status: null });
    expect(out.message).toMatch(/interrupted after \d+ bytes/);
    const n = Number(/interrupted after (\d+) bytes/.exec(out.message ?? "")?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(size);
    expect(await head(u, name)).toBeNull();
  } finally {
    await context.close();
    await proxy.close();
  }
});
