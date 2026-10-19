/**
 * FILES browser criteria in Playwright Chromium, locally (B-T3).
 * FILES-AC-004 browser part: a transfer attempted from an unrelated origin is rejected by the
 * browser (docs/components/files.md FILES-REQ-004: no cross-origin access except the stage's own).
 * FILES-AC-006 browser part: an upload interrupted mid-way fails with FILES.TRANSFER_FAILED and an
 * `interrupted after n bytes` message (FILES-REQ-006).
 *
 * The app runs in-process (`createTestApp`) behind browser-harness.ts; tickets come from app
 * routes, as an app's server code would hand them to the browser.
 */
import { expect, test } from "@playwright/test";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import { startHarness, type Harness } from "./browser-harness.js";
import { disposeAll, newFilesApp } from "./support.js";

interface TransferOutcome {
  readonly ok: boolean;
  readonly isApiError?: boolean | undefined;
  readonly code?: string | undefined;
  readonly status?: number | null | undefined;
  readonly message?: string | undefined;
}

let app: TestApp;
let harness: Harness | undefined;
const h = (): Harness => {
  if (harness === undefined) throw new Error("harness not started");
  return harness;
};

test.beforeEach(async () => {
  app = await newFilesApp();
  harness = await startHarness(app);
});

test.afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await disposeAll();
});

async function ticket(kind: "upload" | "download", name: string, contentType?: string): Promise<unknown> {
  const res = await app.request(`/api/tickets/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(contentType === undefined ? { name } : { name, contentType }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function head(name: string): Promise<unknown> {
  const res = await app.request(`/api/head?name=${encodeURIComponent(name)}`);
  expect(res.status).toBe(200);
  return res.json();
}

test(tag("FILES-AC-004", "browser part: an upload and a download attempted from an unrelated origin are rejected by the browser"), async ({ page }) => {
  // Control: from the app's own origin, the same kind of ticket works.
  await page.goto(`${h().appOrigin}/`);
  await page.waitForFunction(() => typeof (globalThis as { fw?: unknown }).fw === "object");
  const ownTicket = await ticket("upload", "own-origin.png", "image/png");
  const own = await page.evaluate(async (t) => {
    const fw = (globalThis as unknown as { fw: { uploadFile: (t: unknown, b: Blob) => Promise<void> } }).fw;
    await fw.uploadFile(t, new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" }));
    return true;
  }, ownTicket);
  expect(own).toBe(true);
  expect(await head("own-origin.png")).toStrictEqual({ name: "own-origin.png", size: 7, contentType: "image/png" });
  const ownDownload = await ticket("download", "own-origin.png");
  const ownBytes = await page.evaluate(async (t) => {
    const fw = (globalThis as unknown as { fw: { downloadUrl: (t: unknown) => string } }).fw;
    const res = await fetch(fw.downloadUrl(t));
    return Array.from(new Uint8Array(await res.arrayBuffer()));
  }, ownDownload);
  expect(ownBytes).toStrictEqual([137, 80, 78, 71, 1, 2, 3]);

  // From an unrelated origin, with valid tickets for the app's storage.
  await page.goto(`${h().unrelatedOrigin}/`);
  await page.waitForFunction(() => typeof (globalThis as { fw?: unknown }).fw === "object");
  const foreignUpload = await ticket("upload", "foreign.png", "image/png");
  const upload = await page.evaluate(async (t): Promise<TransferOutcome> => {
    const fw = (globalThis as unknown as { fw: { uploadFile: (t: unknown, b: Blob) => Promise<void>; ApiError: new () => Error } }).fw;
    try {
      await fw.uploadFile(t, new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }));
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; status?: number | null; message?: string };
      return { ok: false, isApiError: e instanceof fw.ApiError, code: err.code, status: err.status ?? null, message: err.message };
    }
  }, foreignUpload);
  expect(upload.ok).toBe(false);
  expect(upload.isApiError).toBe(true);
  expect(upload.code).toBe("FILES.TRANSFER_FAILED");
  expect(upload.status).toBeNull();
  expect(upload.message).toContain("no response: network or cross-origin blocked");
  expect(await head("foreign.png")).toBeNull();

  const foreignDownload = await ticket("download", "own-origin.png");
  const download = await page.evaluate(async (t) => {
    const fw = (globalThis as unknown as { fw: { downloadUrl: (t: unknown) => string } }).fw;
    try {
      const res = await fetch(fw.downloadUrl(t));
      await res.arrayBuffer();
      return { read: true, error: null as string | null };
    } catch (e) {
      return { read: false, error: (e as Error).name };
    }
  }, foreignDownload);
  expect(download.read).toBe(false);
  expect(download.error).toBe("TypeError");
});

test(tag("FILES-AC-006", "browser part: an upload interrupted mid-way fails with FILES.TRANSFER_FAILED and an 'interrupted after n bytes' message"), async ({ page }) => {
  const size = 16 * 1024 * 1024;
  h().interruptUploadsAfter(2 * 1024 * 1024);
  await page.goto(`${h().appOrigin}/`);
  await page.waitForFunction(() => typeof (globalThis as { fw?: unknown }).fw === "object");
  const uploadTicket = await ticket("upload", "big.bin", "application/octet-stream");
  const outcome = await page.evaluate(
    async ({ t, size }): Promise<TransferOutcome> => {
      const fw = (globalThis as unknown as { fw: { uploadFile: (t: unknown, b: Blob) => Promise<void>; ApiError: new () => Error } }).fw;
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
      try {
        await fw.uploadFile(t, new Blob([bytes], { type: "application/octet-stream" }));
        return { ok: true };
      } catch (e) {
        const err = e as { code?: string; status?: number | null; message?: string };
        return { ok: false, isApiError: e instanceof fw.ApiError, code: err.code, status: err.status ?? null, message: err.message };
      }
    },
    { t: uploadTicket, size },
  );
  expect(outcome.ok).toBe(false);
  expect(outcome.isApiError).toBe(true);
  expect(outcome.code).toBe("FILES.TRANSFER_FAILED");
  expect(outcome.status).toBeNull();
  const match = /interrupted after (\d+) bytes/.exec(outcome.message ?? "");
  expect(match, outcome.message).not.toBeNull();
  const n = Number(match?.[1]);
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(size);
});
