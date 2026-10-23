/**
 * E2E-009 — Large photos (docs/acceptance/e2e-scenarios.md; Where: Local, cloud).
 * "On each target, upload a 20 MB and a 100 MB photo through the reference app from a real
 * browser, view them, and download them. Pass: the downloads are byte-identical to the
 * originals. App browser code made requests only to the app's API and through framework
 * helpers. No app code or app configuration contains storage or CORS settings."
 *
 * Driven through the reference app's own page (ROUTES.md "Client"): log in through the
 * authentication mock, choose the photo in `file-input`, press `upload`, wait for
 * `upload-status` "Uploaded.", view it in the item's `preview` image, and download it with the
 * item's `download` link, observed through Playwright's `download` event. The photos are
 * uncompressed 24-bit BMP images (a raster type a browser displays) generated on disk for the
 * run and removed afterwards; the sizes are the ones the scenario names (Cloud usage limits:
 * one item per named size, nothing more).
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "@playwright/test";
import { tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceRoot = path.resolve(here, "../../../apps/reference");
const MB = 1000 * 1000;

interface Photo {
  readonly file: string;
  readonly name: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

/** An uncompressed 24-bit BMP of at least `minBytes`, `width` pixels wide, with a varying pattern. */
function writeBmp(dir: string, name: string, width: number, minBytes: number, seed: number): Photo {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const height = Math.ceil((minBytes - 54) / rowBytes);
  const pixelBytes = rowBytes * height;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);
  // One pattern row per 256 rows, shifted per row, so every row differs.
  const pattern = Buffer.alloc(rowBytes + 256 * 3);
  for (let i = 0; i < pattern.length; i += 1) pattern[i] = (i * 7 + seed) & 0xff;
  for (let y = 0; y < height; y += 1) pattern.copy(buf, 54 + y * rowBytes, (y % 256) * 3, (y % 256) * 3 + rowBytes);
  const file = path.join(dir, name);
  writeFileSync(file, buf);
  return { file, name, size: buf.length, width, height, sha256: createHash("sha256").update(buf).digest("hex") };
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/** Files of the reference app that are app code or app configuration (not tests, docs, generated migrations). */
function appSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(referenceRoot, full);
    if (entry.isDirectory()) {
      if (["node_modules", "tests", "migrations", ".wrangler", ".framework", "dist"].includes(entry.name) || rel === "versions") continue;
      out.push(...appSources(full));
    } else if (/\.(ts|tsx|js|mjs|cjs|json|jsonc|toml|html|ya?ml)$/.test(entry.name) || entry.name.startsWith(".env")) {
      out.push(full);
    }
  }
  return out;
}

/** Storage-service and cross-origin configuration vocabulary. */
const STORAGE_OR_CORS = /\b(cors|access-control-[a-z-]+|allowedorigins|allowed_origins|r2|s3|bucket|buckets|cloudflarestorage|amz|aws4?|sigv4|presign\w*|r2_\w+|wrangler)\b/i;

test(tag("E2E-009", "upload a 20 MB and a 100 MB photo from a real browser, view and download them byte-identical; app browser code used only the app's API and framework helpers; no storage or CORS settings in the app"), async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const appOrigin = new URL(target().baseUrl).origin;
  const userId = `c-t3-e2e009-${randomBytes(4).toString("hex")}`;
  const folder = `photos/${userId}/`;
  const dir = mkdtempSync(path.join(tmpdir(), "c-t3-e2e009-"));
  const uploaded: string[] = [];

  // Every request the page makes, and every ticket URL the app's API handed out.
  const requests: Request[] = [];
  const ticketUrls = new Set<string>();
  const uploadTicketUrls = new Set<string>();
  const pendingTickets: Promise<void>[] = [];
  page.on("request", (r) => requests.push(r));
  page.on("response", (res) => {
    const u = new URL(res.url());
    if (u.origin !== appOrigin || (u.pathname !== "/api/files/upload-ticket" && u.pathname !== "/api/files/download-ticket")) return;
    pendingTickets.push(
      res
        .json()
        .then((body: { ticket?: { url?: string } }) => {
          if (typeof body.ticket?.url !== "string") return;
          const abs = new URL(body.ticket.url, res.url()).toString();
          ticketUrls.add(abs);
          if (u.pathname === "/api/files/upload-ticket") uploadTicketUrls.add(abs);
        })
        .catch(() => undefined),
    );
  });

  try {
    const photos = [writeBmp(dir, "photo-20mb.bmp", 2048, 20 * MB, 20), writeBmp(dir, "photo-100mb.bmp", 4096, 100 * MB, 100)];

    // Log in through the authentication mock, then use the app's page.
    const login = await page.request.post("/api/auth/mock-login", { data: { level: "user", id: userId } });
    expect(login.status()).toBe(204);
    await page.goto("/");
    await expect(page.getByTestId("files")).toBeVisible();

    for (const photo of photos) {
      await page.getByTestId("file-input").setInputFiles(photo.file);
      await page.getByTestId("upload").click();
      await expect(page.getByTestId("upload-status")).toHaveText("Uploaded.", { timeout: 10 * 60_000 });
      uploaded.push(folder + photo.name);

      // View: the item's preview shows the image at its real dimensions.
      const item = page.getByTestId("file").filter({ hasText: photo.name });
      await expect(item).toHaveCount(1);
      const preview = item.getByTestId("preview");
      await expect
        .poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? `${String(img.naturalWidth)}x${String(img.naturalHeight)}` : "loading")), { timeout: 5 * 60_000 })
        .toBe(`${String(photo.width)}x${String(photo.height)}`);

      // Download through the item's link.
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5 * 60_000 }), item.getByTestId("download").click()]);
      const saved = path.join(dir, `downloaded-${photo.name}`);
      await download.saveAs(saved);
      expect(await download.failure()).toBeNull();
      expect(statSync(saved).size).toBe(photo.size);
      expect(await sha256File(saved), `${photo.name} downloaded byte-identical`).toBe(photo.sha256);
      rmSync(saved);
    }

    // App browser code made requests only to the app's API and through framework helpers.
    await Promise.all(pendingTickets);
    const offending: string[] = [];
    const puts: string[] = [];
    for (const r of requests) {
      const url = new URL(r.url());
      const isTicket = ticketUrls.has(url.toString());
      if (r.method() === "PUT" && isTicket) puts.push(url.toString());
      if (isTicket) continue; // a framework helper's transfer (uploadFile, downloadUrl)
      if (url.origin === appOrigin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/__framework/")) continue; // the app's API
      // Loading the app itself (its page and client code), not a request by app code.
      if (url.origin === appOrigin && r.method() === "GET" && ["document", "script", "stylesheet", "font", "manifest"].includes(r.resourceType())) continue;
      offending.push(`${r.method()} ${url.origin === appOrigin ? url.pathname : url.origin} (${r.resourceType()})`);
    }
    expect(offending).toStrictEqual([]);
    // Each photo went to storage once, through its upload ticket, not through an app route.
    expect(puts.length).toBe(photos.length);
    for (const put of puts) expect(uploadTicketUrls.has(put)).toBe(true);
    expect(requests.some((r) => new URL(r.url()).pathname === "/api/files/content")).toBe(false);

    // No app code or app configuration contains storage or CORS settings.
    const findings: string[] = [];
    for (const file of appSources(referenceRoot)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (STORAGE_OR_CORS.test(line)) findings.push(`${path.relative(referenceRoot, file)}:${String(i + 1)}: ${line.trim()}`);
      });
    }
    expect(findings).toStrictEqual([]);
  } finally {
    for (const name of uploaded) {
      await page.request.delete(`/api/files/content?name=${encodeURIComponent(name)}`, { headers: { origin: appOrigin } }).catch(() => undefined);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
