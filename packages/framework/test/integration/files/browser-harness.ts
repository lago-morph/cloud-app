/**
 * Browser harness for the FILES browser criteria (B-T3). Serves a `createTestApp` app to a real
 * browser (Playwright Chromium) without `dev`:
 * - an app-origin server at http://localhost:<port> that serves a page with the bundled
 *   `<package>/client` (window.fw) and forwards every `/api/*` request to `TestApp.request`;
 * - an unrelated-origin server at http://127.0.0.1:<port> whose page uses
 *   `<base href="<app origin>/">` so the same relative ticket URLs target the app origin
 *   cross-origin (B-T3 decision 6).
 * It can cut upload connections to `/api/__framework/files/*` mid-body to simulate an
 * interrupted transfer (FILES-AC-006).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { TestApp } from "../../../src/testing/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientEntry = path.resolve(here, "../../../src/client/index.ts");

export interface Harness {
  readonly appOrigin: string;
  readonly unrelatedOrigin: string;
  /** Upload bodies to the local transfer route are cut after `bytes` (paused, then the socket is destroyed). */
  interruptUploadsAfter(bytes: number | null): void;
  close(): Promise<void>;
}

async function bundleClient(): Promise<string> {
  const result = await build({
    entryPoints: [clientEntry],
    bundle: true,
    format: "iife",
    globalName: "fw",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("client bundle produced no output");
  return out.text;
}

function page(baseHref: string | null): string {
  const base = baseHref === null ? "" : `<base href="${baseHref}">`;
  return `<!doctype html><html><head><meta charset="utf-8">${base}<title>files</title></head><body><script src="/client.js"></script></body></html>`;
}

function listen(server: http.Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });
}

async function readBody(req: http.IncomingMessage, cutAfter: number | null): Promise<Uint8Array<ArrayBuffer> | "cut"> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    chunks.push(buf);
    received += buf.byteLength;
    if (cutAfter !== null && received >= cutAfter) {
      // Stop reading so the browser's progress reflects what was sent, then drop the connection.
      req.pause();
      await new Promise((r) => setTimeout(r, 750));
      req.socket.destroy();
      return "cut";
    }
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

export async function startHarness(app: TestApp): Promise<Harness> {
  const clientJs = await bundleClient();
  let cutAfter: number | null = null;

  const appServer = http.createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      if (url === "/" || url.startsWith("/?")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(null));
        return;
      }
      if (url === "/client.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(clientJs);
        return;
      }
      if (!url.startsWith("/api/")) {
        res.writeHead(404).end();
        return;
      }
      const isTransferUpload = req.method === "PUT" && url.startsWith("/api/__framework/files/");
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req, isTransferUpload ? cutAfter : null);
      if (body === "cut") return;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || key === "host" || key === "connection" || key === "content-length") continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const init: RequestInit = { method: req.method ?? "GET", headers };
      if (body !== undefined) init.body = body;
      const response = await app.request(url, init);
      const outHeaders: Record<string, string | string[]> = {};
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie" && key !== "content-length" && key !== "transfer-encoding") outHeaders[key] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) outHeaders["set-cookie"] = cookies;
      res.writeHead(response.status, outHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error));
    });
  });
  const appPort = await listen(appServer, "127.0.0.1");
  const appOrigin = `http://localhost:${appPort}`;

  const unrelatedServer = http.createServer((req, res) => {
    if ((req.url ?? "/") === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(`${appOrigin}/`));
      return;
    }
    res.writeHead(404).end();
  });
  const unrelatedPort = await listen(unrelatedServer, "127.0.0.1");

  return {
    appOrigin,
    unrelatedOrigin: `http://127.0.0.1:${unrelatedPort}`,
    interruptUploadsAfter(bytes) {
      cutAfter = bytes;
    },
    async close() {
      appServer.closeAllConnections();
      unrelatedServer.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => appServer.close(() => r())),
        new Promise<void>((r) => unrelatedServer.close(() => r())),
      ]);
    },
  };
}
