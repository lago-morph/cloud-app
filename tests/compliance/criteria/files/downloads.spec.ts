/**
 * FILES-AC-003 in a real browser (Playwright Chromium) against the reference app on the run's
 * target (docs/components/files.md FILES-REQ-003, FILES-REQ-006, §2 "Download names and inline
 * images" and "Local"; client.d.ts; DEC-0535, DEC-0536):
 *
 * - "A download of a PNG, JPEG, GIF or WebP file is served `inline` with exactly that content
 *   type; any other type, SVG and HTML included, is served as an `attachment`; both name the
 *   file." The browser opens `downloadUrl(ticket)` in a frame of the app's page, and the test
 *   reads the response the browser received. Locally the transfer route's responses also carry
 *   `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` (files.md §2
 *   "Local"). On Cloudflare the framework cannot set `X-Content-Type-Options` on R2's response
 *   (DEC-0535 point 4); the spec states nothing about it there, so nothing is asserted about it;
 *   instead the download must come from storage's origin, not the app's (files.md §2).
 * - The "rejected before sending" failure class (FILES-REQ-006, DEC-0536) for its reasons
 *   `not an upload ticket` and `not a download ticket`; `ticket expired` is in
 *   expired-ticket.spec.ts.
 */
import type { Page } from "@playwright/test";
import { client, tag, target, type ComplianceClient } from "../../harness/index.js";
import { expect, test } from "../../harness/playwright.js";
import { downloadTicket, openAppPage, ticketClient, uploadInPage, uploadTicket } from "./browser.js";
import { head, put, removeAll, uniquePrefix } from "./support.js";

const prefixes: string[] = [];
let cleaner: ComplianceClient | undefined;

function prefix(label: string): string {
  const p = uniquePrefix(label);
  prefixes.push(p);
  return p;
}

test.afterAll(async () => {
  cleaner ??= await client().as("user", { id: "c-t3-files-downloads" });
  for (const p of prefixes) await removeAll(cleaner, p);
});

async function user(): Promise<ComplianceClient> {
  cleaner ??= await ticketClient("c-t3-files-downloads");
  return cleaner;
}

/**
 * The `filename*` value files.md §2 specifies: RFC 8187 `UTF-8''` and the whole name's UTF-8
 * bytes, every byte outside `attr-char` (RFC 8187 §3.2.1) percent-encoded, `/` included.
 */
function rfc8187(name: string): string {
  const attrChar = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;
  let out = "";
  for (const byte of Buffer.from(name, "utf8")) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && attrChar.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `UTF-8''${out}`;
}

interface OpenedDownload {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** Opens `fw.downloadUrl(ticket)` in a frame of the app's page; resolves to the response the browser got. */
async function openDownloadInFrame(page: Page, ticket: unknown): Promise<OpenedDownload> {
  const url = await page.evaluate((t) => new URL((globalThis as unknown as { fw: { downloadUrl: (x: unknown) => string } }).fw.downloadUrl(t), location.href).toString(), ticket);
  const response = page.waitForResponse((r) => r.url() === url && r.request().method() === "GET");
  await page.evaluate((u) => {
    const frame = document.createElement("iframe");
    frame.src = u;
    document.body.append(frame);
  }, url);
  const res = await response;
  return { url, status: res.status(), headers: await res.allHeaders() };
}

test(tag("FILES-AC-003", "a download of a PNG, JPEG, GIF or WebP file is served inline with exactly that content type; SVG, HTML and every other type are served as an attachment; both name the file"), async ({ page }) => {
  test.setTimeout(120_000);
  const u = await user();
  const p = prefix("ac003-disposition");
  const local = target().target === "local";
  const appOrigin = new URL(target().baseUrl).origin;
  // The stored type, and the type an inline download must be served with (the stored type's
  // essence, compared case-insensitively; files.md §2), or null for an attachment.
  const cases: readonly { readonly file: string; readonly stored: string; readonly inline: string | null }[] = [
    { file: "photo é 1.png", stored: "image/png", inline: "image/png" },
    { file: "photo.jpg", stored: "image/jpeg", inline: "image/jpeg" },
    { file: "anim.gif", stored: "image/gif", inline: "image/gif" },
    { file: "pic.webp", stored: "image/webp", inline: "image/webp" },
    { file: "upper.jpeg", stored: "IMAGE/JPEG", inline: "image/jpeg" },
    { file: "drawing.svg", stored: "image/svg+xml", inline: null },
    { file: "page.html", stored: "text/html", inline: null },
    { file: "page.xhtml", stored: "application/xhtml+xml", inline: null },
    { file: "old.bmp", stored: "image/bmp", inline: null },
    { file: "notes.txt", stored: "text/plain", inline: null },
    { file: "blob.bin", stored: "application/octet-stream", inline: null },
  ];
  await openAppPage(page);
  const seen: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const [i, c] of cases.entries()) {
    const name = `${p}${c.file}`;
    await put(u, name, new Uint8Array([0x89, 0x50, 0x4e, 0x47, i]), c.stored);
    const opened = await openDownloadInFrame(page, await downloadTicket(u, name));
    seen[c.file] = {
      status: opened.status,
      disposition: opened.headers["content-disposition"] ?? null,
      ...(c.inline === null ? {} : { contentType: opened.headers["content-type"] ?? null }),
      ...(local ? { nosniff: opened.headers["x-content-type-options"] ?? null, csp: opened.headers["content-security-policy"] ?? null } : { fromAppOrigin: new URL(opened.url).origin === appOrigin }),
    };
    expected[c.file] = {
      status: 200,
      disposition: `${c.inline === null ? "attachment" : "inline"}; filename*=${rfc8187(name)}`,
      ...(c.inline === null ? {} : { contentType: c.inline }),
      ...(local ? { nosniff: "nosniff", csp: "sandbox" } : { fromAppOrigin: false }),
    };
  }
  expect(seen).toStrictEqual(expected);
});

test(tag("FILES-AC-003", "rejected before sending class (FILES-REQ-006): uploadFile with a download ticket and downloadUrl with an upload ticket fail with FILES.TRANSFER_FAILED, status null, without contacting storage"), async ({ page }) => {
  const u = await user();
  const p = prefix("ac003-wrongkind");
  const name = `${p}kind.txt`;
  const other = `${p}other.txt`;
  await put(u, name, new Uint8Array([1, 2, 3]), "text/plain");
  await openAppPage(page);
  const down = await downloadTicket(u, name);
  const up = await uploadTicket(u, other, "text/plain");
  const paths = [new URL(down.url, page.url()).pathname, new URL(up.url, page.url()).pathname];
  const sent: string[] = [];
  page.on("request", (r) => {
    if (paths.includes(new URL(r.url()).pathname)) sent.push(`${r.method()} ${r.url()}`);
  });

  const asUpload = await uploadInPage(page, down, { size: 8, seed: 7, type: "text/plain" });
  expect(asUpload).toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED", status: null });
  expect(asUpload.message).toContain("rejected before sending: not an upload ticket");
  expect(asUpload.maxLoaded).toBe(0);

  const asDownload = await page.evaluate((t) => {
    type ApiErrorLike = Error & { code: string; status: number | null };
    const fw = (globalThis as unknown as { fw: { downloadUrl: (x: unknown) => string; ApiError: new (...a: never[]) => ApiErrorLike } }).fw;
    try {
      return { returned: fw.downloadUrl(t) };
    } catch (error) {
      const e = error as ApiErrorLike;
      return { isApiError: error instanceof fw.ApiError, code: e.code, status: e.status, message: e.message };
    }
  }, up);
  expect(asDownload).toMatchObject({ isApiError: true, code: "FILES.TRANSFER_FAILED", status: null });
  expect("message" in asDownload ? asDownload.message : undefined).toContain("rejected before sending: not a download ticket");

  expect(sent, "a request reached storage").toStrictEqual([]);
  expect(await head(u, other)).toBeNull();
  expect(await head(u, name)).toStrictEqual({ name, size: 3, contentType: "text/plain" });
});
