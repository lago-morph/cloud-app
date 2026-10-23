/**
 * Browser helpers for the FILES transfer criteria (C-T3), in Playwright Chromium against the
 * reference app on the run's target (`dev` locally, the test stage on a cloud).
 *
 * The transfers use the framework's own browser helpers, `uploadFile` and `downloadUrl` from
 * `<package>/client`, exactly as an app's browser code would import them: the published
 * entry point is bundled (esbuild) and added to a page of the app's origin as `window.fw`.
 * Tickets come from the reference app's ticket routes (ROUTES.md "Files"), requested by a
 * logged-in Node client, as an app's server code would hand them to its browser code; the
 * test then passes them into the page unchanged. Ticket contents are read only where a
 * criterion is about what a ticket permits, and only through the shape files.md §2 documents
 * ("Shared runtime shape": `url`, `expiresAt`, upload `method` and `headers`).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { build } from "esbuild";
import type { Page } from "@playwright/test";
import { client, type ComplianceClient } from "../../harness/index.js";

export interface UploadTicketJson {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: number;
}

export interface DownloadTicketJson {
  readonly url: string;
  readonly expiresAt: number;
}

/** What a browser transfer ended with, as the page saw it. */
export interface TransferOutcome {
  readonly ok: boolean;
  readonly isApiError?: boolean;
  readonly code?: string;
  readonly status?: number | null;
  readonly message?: string;
  readonly requestId?: string | null;
  readonly maxLoaded?: number;
  readonly sha256?: string;
  readonly size?: number;
}

let bundle: Promise<string> | undefined;

/** `<package>/client`, as published, bundled for a page (global `fw`). */
export function clientBundle(): Promise<string> {
  bundle ??= (async () => {
    const entry = createRequire(import.meta.url).resolve("@lago-morph/prototype-framework/client");
    const result = await build({ entryPoints: [entry], bundle: true, format: "iife", globalName: "fw", platform: "browser", target: "es2022", write: false, logLevel: "silent" });
    const out = result.outputFiles[0];
    if (out === undefined) throw new Error("bundling <package>/client produced no output");
    return out.text;
  })();
  return bundle;
}

/** Adds the framework's browser helpers to the page as `window.fw`. */
export async function installHelpers(page: Page): Promise<void> {
  await page.addScriptTag({ content: await clientBundle() });
  await page.waitForFunction(() => typeof (globalThis as { fw?: { uploadFile?: unknown } }).fw?.uploadFile === "function");
}

/** Opens the reference app's own page (its origin) with the helpers installed. */
export async function openAppPage(page: Page): Promise<void> {
  await page.goto("/");
  await installHelpers(page);
}

/** A Node client of the reference app logged in as a user: it requests tickets as app server code would. */
export async function ticketClient(id: string): Promise<ComplianceClient> {
  return client().as("user", { id });
}

export async function uploadTicket(u: ComplianceClient, name: string, contentType?: string): Promise<UploadTicketJson> {
  const res = await u.post("/api/files/upload-ticket", contentType === undefined ? { name } : { name, contentType });
  return u.expectStatus(res, 200).json<{ ticket: UploadTicketJson }>().ticket;
}

export async function downloadTicket(u: ComplianceClient, name: string): Promise<DownloadTicketJson> {
  return u.expectStatus(await u.post("/api/files/download-ticket", { name }), 200).json<{ ticket: DownloadTicketJson }>().ticket;
}

export interface BlobSpec {
  readonly size: number;
  readonly seed: number;
  readonly type: string;
}

/**
 * Builds a deterministic Blob in the page (xorshift32 bytes from `seed`), hashes it, and uploads
 * it with `fw.uploadFile`. Resolves to the outcome, the largest `loaded` reported by
 * `onProgress`, and the Blob's SHA-256.
 */
export function uploadInPage(page: Page, ticket: unknown, spec: BlobSpec): Promise<TransferOutcome> {
  return page.evaluate(
    async ({ ticket, spec }) => {
      type ApiErrorLike = Error & { code: string; status: number | null; requestId: string | null };
      const fw = (globalThis as unknown as { fw: { uploadFile: (t: unknown, b: Blob, o?: { onProgress?: (p: { loaded: number; total: number }) => void }) => Promise<void>; ApiError: new (...a: never[]) => ApiErrorLike } }).fw;
      const bytes = new Uint8Array(spec.size);
      let x = spec.seed >>> 0 || 1;
      for (let i = 0; i < bytes.length; i += 1) {
        x ^= x << 13;
        x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        bytes[i] = x & 0xff;
      }
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      const blob = new Blob([bytes], { type: spec.type });
      let maxLoaded = 0;
      (globalThis as { __uploadLoaded?: number }).__uploadLoaded = 0;
      try {
        await fw.uploadFile(ticket, blob, {
          onProgress: (p) => {
            maxLoaded = Math.max(maxLoaded, p.loaded);
            (globalThis as { __uploadLoaded?: number }).__uploadLoaded = maxLoaded;
          },
        });
        return { ok: true, maxLoaded, sha256, size: blob.size };
      } catch (error) {
        const e = error as ApiErrorLike;
        return { ok: false, isApiError: error instanceof fw.ApiError, code: e.code, status: e.status, message: e.message, requestId: e.requestId, maxLoaded, sha256, size: blob.size };
      }
    },
    { ticket, spec },
  );
}

/** Fetches `fw.downloadUrl(ticket)` in the page and hashes the body. */
export function downloadInPage(page: Page, ticket: unknown): Promise<TransferOutcome> {
  return page.evaluate(async (ticket) => {
    const fw = (globalThis as unknown as { fw: { downloadUrl: (t: unknown) => string } }).fw;
    try {
      const res = await fetch(fw.downloadUrl(ticket));
      const buf = new Uint8Array(await res.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
      return { ok: res.ok, status: res.status, size: buf.byteLength, sha256 };
    } catch (error) {
      return { ok: false, status: null, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
  }, ticket);
}

/** A raw `fetch` from the page (not a framework helper), for requests a helper would never send. */
export function rawFetchInPage(page: Page, url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number | null; error?: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      try {
        const res = await fetch(url, init);
        await res.arrayBuffer();
        return { ok: res.ok, status: res.status };
      } catch (error) {
        return { ok: false, status: null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }
    },
    { url, init },
  );
}

/** An unrelated origin: `http://127.0.0.1:<port>`, serving one page whose `<base>` is the app's origin. */
export interface UnrelatedOrigin {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startUnrelatedOrigin(appOrigin: string): Promise<UnrelatedOrigin> {
  const js = await clientBundle();
  const server = http.createServer((req, res) => {
    if (req.url === "/client.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    // `<base>` makes relative ticket URLs (if a target issues them) resolve against the app's
    // origin, so the same ticket targets the app's storage from this other origin.
    res.end(`<!doctype html><html><head><meta charset="utf-8"><base href="${appOrigin}/"><title>unrelated</title></head><body><script src="http://127.0.0.1:${String((server.address() as AddressInfo).port)}/client.js"></script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  if (new URL(origin).origin === new URL(appOrigin).origin) throw new Error("the unrelated origin equals the app's origin");
  return {
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * A forwarding HTTP proxy between the browser and a local (`http:`) target that cuts every
 * upload `PUT` to `uploadPath` once more than `cutAfter` body bytes have passed: it stops
 * reading and drops both connections, so the transfer is interrupted mid-way by the network,
 * not refused by the app or storage. Chromium is pointed at it with `bypass: "<-loopback>"`
 * (Chromium otherwise never proxies loopback). Only for FILES-AC-006 (Where: Local).
 */
export interface CuttingProxy {
  readonly server: string;
  /** How many upload attempts were cut (Chromium retries a reset request on a fresh connection). */
  cuts(): number;
  close(): Promise<void>;
}

export async function startCuttingProxy(uploadPath: string, cutAfter: number): Promise<CuttingProxy> {
  let cuts = 0;
  const proxy = http.createServer((req, res) => {
    const target = new URL(req.url ?? "/");
    if (target.protocol !== "http:") {
      res.writeHead(501).end();
      return;
    }
    const upstream = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    if (req.method !== "PUT" || target.pathname !== uploadPath) {
      req.pipe(upstream);
      return;
    }
    let received = 0;
    let cut = false;
    req.on("data", (chunk: Buffer) => {
      if (cut) return;
      received += chunk.byteLength;
      if (received > cutAfter) {
        cut = true;
        cuts += 1;
        req.pause();
        req.socket.destroy();
        upstream.destroy();
        return;
      }
      upstream.write(chunk);
    });
    req.on("end", () => {
      if (!cut) upstream.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    server: `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`,
    cuts: () => cuts,
    close: () =>
      new Promise<void>((resolve) => {
        proxy.closeAllConnections();
        proxy.close(() => resolve());
      }),
  };
}

/**
 * The ways a ticket URL could carry the name `from` (plainly, percent-encoded, or inside a
 * base64url JSON segment such as a signed token); each yields the same URL naming `to`.
 */
export function nameRewrites(url: string, from: string, to: string): string[] {
  const out = new Set<string>();
  const forms: [string, string][] = [
    [from, to],
    [encodeURIComponent(from), encodeURIComponent(to)],
    [from.split("/").map(encodeURIComponent).join("/"), to.split("/").map(encodeURIComponent).join("/")],
  ];
  for (const [a, b] of forms) if (url.includes(a)) out.add(url.split(a).join(b));
  const a = JSON.stringify(from).slice(1, -1);
  const b = JSON.stringify(to).slice(1, -1);
  for (const segment of url.split(/[/?&=.#]/)) {
    if (segment.length < 8 || !/^[A-Za-z0-9_-]+$/.test(segment)) continue;
    let decoded: string;
    try {
      decoded = Buffer.from(segment, "base64url").toString("utf8");
      JSON.parse(decoded);
    } catch {
      continue;
    }
    if (!decoded.includes(a)) continue;
    out.add(url.split(segment).join(Buffer.from(decoded.split(a).join(b), "utf8").toString("base64url")));
  }
  out.delete(url);
  return [...out];
}
