/**
 * One client, one connection (root cause
 * ai/implementation/root-causes/2026-10-25-pwd-ac-008-burst-split-over-egress-ips.md).
 *
 * Node's `fetch` spreads even strictly sequential requests to one origin over two sockets. Behind
 * the sandbox's egress proxy each socket leaves from its own IP address, so Cloudflare sees one
 * test client as two (`CF-Connecting-IP`), and a sign-in burst never fills one IP's bucket.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fetchOver, oneConnectionDispatcher } from "./one-connection.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((r) => (server === undefined ? r() : server.close(() => r())));
  server = undefined;
});

/** A local server that records which socket each request came on. */
async function socketRecorder(): Promise<{ origin: string; sockets: () => number[] }> {
  const ids = new Map<number, number>();
  const seq: number[] = [];
  server = createServer((req, res) => {
    const port = req.socket.remotePort ?? -1;
    if (!ids.has(port)) ids.set(port, ids.size);
    seq.push(ids.get(port) ?? -1);
    req.resume();
    req.on("end", () => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end('{"error":{"code":"AUTH.LOGIN_FAILED"}}');
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${String(port)}`, sockets: () => seq };
}

describe("oneConnectionDispatcher", () => {
  it("sends a burst of sequential requests to one origin over a single connection", async () => {
    const rec = await socketRecorder();
    const dispatcher = oneConnectionDispatcher({});
    const f = fetchOver(dispatcher);
    try {
      for (let i = 0; i < 6; i += 1) {
        const r = await f(`${rec.origin}/api/auth/password/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        await r.text();
      }
    } finally {
      await dispatcher.close();
    }
    expect(rec.sockets(), "the socket of each request").toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("goes through the environment's proxy when one is set", () => {
    const d = oneConnectionDispatcher({ HTTPS_PROXY: "http://127.0.0.1:9" });
    expect(d.constructor.name).toBe("EnvHttpProxyAgent");
    void d.close();
  });
});
