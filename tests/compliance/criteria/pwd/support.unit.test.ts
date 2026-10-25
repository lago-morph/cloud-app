/**
 * How the password test browsers reach a cloud stage. Root causes:
 * - ai/implementation/root-causes/2026-10-25-cf-error-1000-client-cf-connecting-ip.md: Cloudflare's
 *   edge refuses any request that already carries `CF-Connecting-IP` with
 *   `403 Error 1000: DNS points to prohibited IP`, before the Worker runs. A per-client IP can
 *   therefore only be chosen where no Cloudflare edge is in between: in-process and under `dev`.
 * - ai/implementation/root-causes/2026-10-25-pwd-ac-008-burst-split-over-egress-ips.md: one
 *   browser must be one connection, so that Cloudflare sees it as one client IP.
 */
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage, TestMail } from "../../../../docs/contracts/ts/testing.js";
import { budgetFileKey, signUpLedger } from "../../harness/sign-up-budget.js";
import { connectedBrowser, inProcessBrowser, ROUTES, sendsClientIp, signIn, signUp, signUpBudgetKey, type PasswordTestApp } from "./support.js";

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

/**
 * The stage budgets (harness/sign-up-budget.ts) as the browsers apply them on a cloud run: every
 * sign-up to a cloud stage takes a slot of its PAR-259 budget, and a sign-in to the run's test
 * stage outside `withStageSignIns` is refused before it is sent. The run's target is faked with
 * the driver's variables (a fresh stage name, so the ledger in the OS temp directory is this test's own).
 */
describe("the stage budgets of the password test browsers on a cloud run", () => {
  const stage = `test-unit${randomBytes(5).toString("hex")}`;
  const key = `cloudflare/${stage}`;
  beforeEach(() => {
    vi.stubEnv("COMPLIANCE_TARGET", "cloudflare");
    vi.stubEnv("COMPLIANCE_STAGE", stage);
    vi.stubEnv("COMPLIANCE_BASE_URL", CLOUD_ORIGIN);
    vi.stubEnv("COMPLIANCE_RUN_ID", "unitrun0000000x");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(join(tmpdir(), `c-t1-sign-ups-${budgetFileKey(key)}.json`), { force: true });
  });

  it("names the budget of the run's test stage, of another cloud origin, and none for a local origin or run", () => {
    expect(signUpBudgetKey(CLOUD_ORIGIN)).toBe(key);
    expect(signUpBudgetKey(`${CLOUD_ORIGIN}/`)).toBe(key);
    expect(signUpBudgetKey("https://other.example.workers.dev")).toBe("cloudflare/other.example.workers.dev");
    expect(signUpBudgetKey("http://localhost:8787")).toBeUndefined();
    vi.stubEnv("COMPLIANCE_TARGET", "local");
    expect(signUpBudgetKey(CLOUD_ORIGIN), "a local run has no cloud budget").toBeUndefined();
  });

  it("records every sign-up to the stage in its budget, whichever helper sends it, and nothing else", async () => {
    const { app, seen } = recordingApp();
    const b = connectedBrowser(app, CLOUD_ORIGIN);
    await signUp(b, account);
    await b.post(ROUTES.signUp, { email: account.email, password: account.password, displayName: account.displayName, role: "admin" });
    await b.post(ROUTES.forgot, { email: account.email });
    expect(seen).toHaveLength(3);
    expect(signUpLedger(key), "two sign-ups in the stage's ledger").toHaveLength(2);
  });

  it("refuses a sign-in to the run's test stage outside withStageSignIns before sending it", async () => {
    const { app, seen } = recordingApp();
    await expect(signIn(connectedBrowser(app, CLOUD_ORIGIN), account.email, account.password)).rejects.toThrow(/must hold withStageSignIns/);
    expect(seen, "nothing was sent").toHaveLength(0);
    // Another stage (prodcheck's own D1 and limiter) is not the test stage's sign-in budget.
    await signIn(connectedBrowser(app, "https://other.example.workers.dev"), account.email, account.password);
    expect(seen).toHaveLength(1);
  });
});
