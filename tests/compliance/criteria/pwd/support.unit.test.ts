/**
 * How the password test browsers reach a cloud stage. Root causes:
 * - ai/implementation/root-causes/2026-10-25-cf-error-1000-client-cf-connecting-ip.md: Cloudflare's
 *   edge refuses any request that already carries `CF-Connecting-IP` with
 *   `403 Error 1000: DNS points to prohibited IP`, before the Worker runs. A per-client IP can
 *   therefore only be chosen where no Cloudflare edge is in between: in-process and under `dev`.
 * - ai/implementation/root-causes/2026-10-25-pwd-ac-008-burst-split-over-egress-ips.md: one
 *   browser must be one connection, so that Cloudflare sees it as one client IP.
 */
import { describe, expect, it } from "vitest";
import type { MailMessage, TestMail } from "../../../../docs/contracts/ts/testing.js";
import { connectedBrowser, inProcessBrowser, sendsClientIp, signUp, type PasswordTestApp } from "./support.js";

function recordingApp(): { app: PasswordTestApp; seen: Headers[]; inits: RequestInit[] } {
  const seen: Headers[] = [];
  const inits: RequestInit[] = [];
  const mail: TestMail = {
    all: () => Promise.resolve([] as MailMessage[]),
    lastTo: () => Promise.resolve(undefined),
  };
  const app: PasswordTestApp = {
    request: (_path, init) => {
      seen.push(new Headers(init?.headers));
      inits.push(init ?? {});
      return Promise.resolve(new Response('{"result":"check-email"}', { status: 200, headers: { "content-type": "application/json" } }));
    },
    mail,
    logs: () => [],
    dispose: () => Promise.resolve(),
  };
  return { app, seen, inits };
}

const account = { email: "a@example.test", password: "Pw0123456789abcdef", displayName: "A" };
const CLOUD_ORIGIN = "https://reference-test-x.example.workers.dev";
const dispatcherOf = (init: RequestInit | undefined): unknown => (init as { dispatcher?: unknown } | undefined)?.dispatcher;

describe("the client-IP header of the password test browsers", () => {
  it("is never sent through a Cloudflare edge (connected test stage): the edge answers Error 1000 to it", async () => {
    const { app, seen } = recordingApp();
    await signUp(connectedBrowser(app, CLOUD_ORIGIN), account, { ip: "10.1.2.3" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.has("cf-connecting-ip")).toBe(false);
  });

  it("is sent in-process, where it separates the test clients' rate limits", async () => {
    const { app, seen } = recordingApp();
    await signUp(inProcessBrowser(app), account, { ip: "10.1.2.3" });
    expect(seen[0]?.get("cf-connecting-ip")).toBe("10.1.2.3");
  });

  it("is allowed only for local origins", () => {
    expect(sendsClientIp("http://localhost:8787")).toBe(true);
    expect(sendsClientIp("http://127.0.0.1:43123")).toBe(true);
    expect(sendsClientIp("http://[::1]:8787")).toBe(true);
    expect(sendsClientIp(CLOUD_ORIGIN)).toBe(false);
    expect(sendsClientIp("https://app.t.example.com")).toBe(false);
  });
});

describe("the connection of the password test browsers", () => {
  it("off a local origin, every request of one browser goes over the browser's own one-connection dispatcher", async () => {
    const { app, inits } = recordingApp();
    const b = connectedBrowser(app, CLOUD_ORIGIN);
    await signUp(b, account);
    await signUp(b, account);
    expect(dispatcherOf(inits[0]), "a dispatcher is passed to TestApp.request").toBeDefined();
    expect(dispatcherOf(inits[1]), "the same one for every request of the browser").toBe(dispatcherOf(inits[0]));
  });

  it("in-process, requests carry no dispatcher", async () => {
    const { app, inits } = recordingApp();
    await signUp(inProcessBrowser(app), account);
    expect(dispatcherOf(inits[0])).toBeUndefined();
  });
});
