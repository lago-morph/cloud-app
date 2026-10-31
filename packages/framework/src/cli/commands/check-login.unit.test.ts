/**
 * `check-login` (CLI-REQ-001; plan-v0.2.0 §6.1 item 3, §7.1 E2E-008; DEC-0670): the automated
 * part of the real-login check. Offline: the production stage is the real AUTH runtime of a
 * production Cloudflare Worker (`createCloudflareWorker`) signing in through the in-memory fake
 * auth-app binding, and the auth app's `/start` is a fake that checks its registry exactly. Each
 * step's failure is injected and its message checked.
 */
import { Agent, EnvHttpProxyAgent } from "undici";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord, WriteEvidenceInput } from "../../evidence/writer.js";
import { createFakeAuthAppBinding } from "../../auth/auth-app-binding.js";
import { createDeployment } from "../../core/identity.js";
import { defineApp } from "../../index.js";
import { createCloudflareWorker } from "../../targets/cloudflare/public.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { oneConnectionDispatcher } from "../one-connection.js";
import { checkLoginCommand, FORGED_HOST, type CheckLoginDeps } from "./check-login.js";

const ORIGIN = "https://reference-prodcheck.owner-sub.workers.dev";
const AUTH_ORIGIN = "https://auth.owner-sub.workers.dev";
const RUN_ID = "abcdefghij12345";

type Fault =
  | "login-not-redirect"
  | "start-elsewhere"
  | "wrong-app"
  | "two-apps"
  | "no-state"
  | "relative-start"
  | "http-start"
  | "callback-on-forged-host"
  | "no-login-cookie"
  | "unreachable"
  | "bogus-code-signs-in"
  | "bogus-code-not-redirected"
  | "me-not-anonymous"
  | "unregistered"
  | "start-404"
  | "authorize-http"
  | "no-pkce"
  | "no-signin-cookie";

/** The production stage (the framework's own runtime) and the auth app's `/start`, with one fault injected. */
function world(fault?: Fault) {
  const app = defineApp({ name: "reference", config: {}, secrets: [], tables: {}, routes: () => undefined });
  const worker = createCloudflareWorker(app, { deployment: createDeployment({ app: "reference", stage: "prodcheck", target: "cloudflare" }), values: {}, secrets: [] });
  const env: Record<string, unknown> = {
    FRAMEWORK_PUBLIC_ORIGIN: ORIGIN,
    FRAMEWORK_AUTH_APP_ORIGIN: AUTH_ORIGIN,
    AUTH: createFakeAuthAppBinding(),
    SECRET_FRAMEWORK_SESSION_KEY: "k".repeat(43),
    DB: {},
    FILES: {},
  };
  const registered = new Set([`reference-prodcheck ${ORIGIN}/api/auth/callback`]);
  const seen: { url: string; headers: Headers; dispatcher: unknown }[] = [];

  async function stage(request: Request): Promise<Response> {
    if (fault === "login-not-redirect") return Response.json({ error: { code: "CORE.INTERNAL" } }, { status: 500 });
    // The Worker sees the forged host only through the forwarding headers, as on Cloudflare.
    const response = await worker.fetch(request, env, { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} });
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/callback" && fault === "bogus-code-not-redirected") return Response.json({ ok: true });
    if (path === "/api/auth/me" && fault === "me-not-anonymous") return Response.json({ level: "user", id: "u_forged" });
    if (path === "/api/auth/callback" && fault === "bogus-code-signs-in") {
      const headers = new Headers(response.headers);
      headers.append("set-cookie", "__Host-session=forged; Path=/; HttpOnly; Secure; SameSite=Lax");
      return new Response(null, { status: response.status, headers });
    }
    if (path !== "/api/auth/login") return response;
    const location = new URL(response.headers.get("location") ?? "");
    if (fault === "start-elsewhere") location.pathname = "/begin";
    if (fault === "wrong-app") location.searchParams.set("app", "reference-prod");
    if (fault === "two-apps") location.searchParams.append("app", "reference-prodcheck");
    if (fault === "no-state") location.searchParams.delete("state");
    if (fault === "http-start") location.protocol = "http:";
    if (fault === "callback-on-forged-host") location.searchParams.set("return", `https://${FORGED_HOST}/api/auth/callback`);
    const headers = new Headers({ location: fault === "relative-start" ? `${location.pathname}${location.search}` : location.toString() });
    if (fault !== "no-login-cookie") for (const line of response.headers.getSetCookie()) headers.append("set-cookie", line);
    return new Response(null, { status: response.status, headers });
  }

  function start(url: URL): Response {
    const key = `${url.searchParams.get("app") ?? ""} ${url.searchParams.get("return") ?? ""}`;
    if (fault === "unregistered" || !registered.has(key)) return new Response("not approved", { status: 400 });
    if (fault === "start-404") return new Response("not found", { status: 404 });
    const authorize = new URL(fault === "authorize-http" ? "http://dash.example.test/oauth2/auth" : "https://dash.example.test/oauth2/auth");
    authorize.searchParams.set("response_type", "code");
    if (fault !== "no-pkce") authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", "auth-app-state");
    const headers = new Headers({ location: authorize.toString() });
    if (fault !== "no-signin-cookie") headers.append("set-cookie", "__Host-auth-signin=s; Path=/; HttpOnly; Secure; SameSite=Lax");
    return new Response(null, { status: 302, headers });
  }

  const fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit & { dispatcher?: unknown }) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    seen.push({ url: url.toString(), headers: new Headers(init?.headers), dispatcher: init?.dispatcher });
    if (fault === "unreachable") throw new TypeError("fetch failed");
    if (url.origin === ORIGIN) return stage(new Request(url, init));
    if (url.origin === AUTH_ORIGIN && url.pathname === "/start") return start(url);
    return new Response("unexpected", { status: 599 });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

function harness(options: { readonly fault?: Fault; readonly origin?: string | null; readonly changed?: readonly string[]; readonly env?: Readonly<Record<string, string>> } = {}) {
  const w = world(options.fault);
  const records: WriteEvidenceInput[] = [];
  const dispatcher = oneConnectionDispatcher({});
  const deps: CheckLoginDeps = {
    env: options.env ?? {},
    deployedOrigin: () => (options.origin === null ? undefined : (options.origin ?? ORIGIN)),
    appName: async () => "reference",
    repo: () => ({ root: "/repo", git: { commit: () => "c0ffee", changedTrackedFiles: () => [...(options.changed ?? [])] } as never }),
    fetch: w.fetch,
    dispatcher,
    writeEvidence: (input) => {
      records.push(input);
      return { recordPath: `/repo/validation/${input.record.target}/${input.record.runId}.json`, rawDir: "" };
    },
    newRunId: () => RUN_ID,
    now: () => new Date("2026-10-31T12:00:00Z"),
    versions: () => ({ node: "v22" }),
  };
  const run = async (args = ["--target", "cloudflare", "--stage", "prodcheck"]) => {
    const io = captureIo();
    const status = await checkLoginCommand(deps)(args, io);
    return { status, io, out: io.out + io.err };
  };
  return { ...w, records, run, dispatcher, record: (): EvidenceRecord => records[0]!.record };
}

describe("check-login: refusals before any request", () => {
  it("refuses target local and a test stage as usage errors, an invalid stage name too", async () => {
    const h = harness();
    await expect(h.run(["--target", "local", "--stage", "local"])).rejects.toThrow(UsageError);
    await expect(h.run(["--target", "cloudflare", "--stage", "test-abc"])).rejects.toThrow(/needs a production stage; test-abc is a test stage, which signs in with the authentication mock only/);
    await expect(h.run(["--target", "cloudflare", "--stage", "Bad_Stage"])).rejects.toThrow(UsageError);
    expect(h.seen).toEqual([]);
  });

  it("an unreachable process, a dirty tree or no deploy output exit 1 with no request and no record", async () => {
    for (const [options, message] of [
      [{ env: { HTTPS_PROXY: "http://proxy.invalid:1" } }, /NODE_USE_ENV_PROXY=1/],
      [{ changed: ["src/app.ts"] }, /tracked files differ from it: src\/app\.ts/],
      [{ origin: null }, /no recorded deploy output for stage prodcheck/],
    ] as const) {
      const h = harness(options);
      const r = await h.run();
      expect(r.status, String(message)).toBe(1);
      expect(r.out).toMatch(message);
      expect(h.seen).toEqual([]);
      expect(h.records).toEqual([]);
    }
  });

  it("needs no Cloudflare credential", async () => {
    const r = await harness().run();
    expect(r.status, r.out).toBe(0);
  });
});

describe("check-login: the steps (E2E-008, automated part)", () => {
  it("passes against a working stage and auth app, and writes one record: E2E-008 and AUTH-AC-011 passed, PWD-AC-009 not run", async () => {
    const h = harness();
    const r = await h.run();
    expect(r.status, r.out).toBe(0);
    expect(r.io.out).toContain("step 1: /api/auth/login redirects to the auth app's /start");
    expect(r.io.out).toContain("step 2: a callback with that state and a bogus code is a failed login");
    expect(r.io.out).toContain("step 3: the auth app accepts the app ID and the return URL");
    expect(r.io.out).toMatch(/check-login passed: every step passed\. Evidence: \/repo\/validation\/cloudflare\/abcdefghij12345\.json/);
    expect(h.records).toHaveLength(1);
    expect(h.record()).toMatchObject({ runId: RUN_ID, commit: "c0ffee", target: "cloudflare", stage: "prodcheck", command: "check-login --target cloudflare --stage prodcheck", exitStatus: 0 });
    expect(h.record().results).toEqual([
      { id: "PWD-AC-009", status: "not-run", detail: "retired with the password provider (plan-v0.2.0 §6)" },
      { id: "AUTH-AC-011", status: "passed" },
      { id: "E2E-008", status: "passed" },
    ]);
    // The login request carried a forged host; the stage built the return URL from its own origin.
    expect(h.seen[0]?.headers.get("x-forwarded-host")).toBe(FORGED_HOST);
    expect(new URL(h.seen.find((s) => s.url.startsWith(`${AUTH_ORIGIN}/start?`))?.url ?? "https://x.test").searchParams.get("return")).toBe(`${ORIGIN}/api/auth/callback`);
    // Step 2 sent the bogus callback with the transaction cookie.
    expect(h.seen.find((s) => s.url.startsWith(`${ORIGIN}/api/auth/callback?`))?.headers.get("cookie")).toMatch(/^__Host-login=/);
    // Every request went over the one dispatcher, and the account's subdomain is redacted (DEC-0086).
    expect(h.seen.every((s) => s.dispatcher === h.dispatcher)).toBe(true);
    expect((h.records[0]!.redactions ?? []).map((x) => x.value)).toContain("owner-sub");
    // It prints and records no token (cli.md): not the transaction cookie, nor the app's or the auth app's state.
    const start = new URL(h.seen.find((s) => s.url.startsWith(`${AUTH_ORIGIN}/start?`))?.url ?? "https://x.test");
    const transaction = h.seen.find((s) => s.url.startsWith(`${ORIGIN}/api/auth/callback?`))?.headers.get("cookie")?.split("=")[1] ?? "";
    const secrets = [start.searchParams.get("state") ?? "", transaction, "auth-app-state"];
    for (const secret of secrets) expect(secret.length, "each secret was seen").toBeGreaterThan(8);
    for (const secret of secrets) expect(r.out + JSON.stringify(h.record())).not.toContain(secret);
  });

  it.each<[Fault, number, RegExp]>([
    ["login-not-redirect", 1, /login: expected a 302 redirect, got status 500/],
    ["start-elsewhere", 1, /login: the redirect goes to \/begin, not the auth app's \/start/],
    ["wrong-app", 1, /login: app is "reference-prod", expected "reference-prodcheck"/],
    ["callback-on-forged-host", 1, /login: return is "https:\/\/forged-host\.example\.test\/api\/auth\/callback", expected "https:\/\/reference-prodcheck\.owner-sub\.workers\.dev\/api\/auth\/callback"/],
    ["no-login-cookie", 1, /login: no __Host-login transaction cookie was set/],
    ["unreachable", 1, /GET https:\/\/reference-prodcheck\.owner-sub\.workers\.dev\/api\/auth\/login could not be sent/],
    ["two-apps", 1, /login: the redirect has no single app parameter/],
    ["no-state", 1, /login: the redirect has no single state parameter/],
    ["relative-start", 1, /login: the redirect is not an absolute URL/],
    ["http-start", 1, /login: the redirect is not https/],
    ["bogus-code-not-redirected", 2, /callback with a bogus code: expected a 302 to \/\?authError=login_failed&requestId=<id>, got status 200/],
    ["bogus-code-signs-in", 2, /callback with a bogus code: a session cookie was set/],
    ["me-not-anonymous", 2, /after the bogus callback: \/api\/auth\/me is not anonymous \(status 200\)/],
    ["unregistered", 3, /the auth app refused the sign-in \(400\): the return URL is not registered for this app ID/],
    ["start-404", 3, /auth app \/start: expected a 302 redirect, got status 404/],
    ["authorize-http", 3, /auth app \/start: the redirect is not https/],
    ["no-pkce", 3, /auth app \/start: the redirect has no single code_challenge_method parameter/],
    ["no-signin-cookie", 3, /auth app \/start: no sign-in cookie was set/],
  ])("with fault %s it fails at step %i with its message, exit 1, and one record", async (fault, step, message) => {
    const h = harness({ fault });
    const r = await h.run();
    expect(r.status, r.out).toBe(1);
    expect(r.io.err).toMatch(new RegExp(`check-login failed at step ${String(step)}: `));
    expect(r.io.err).toMatch(message);
    expect(r.io.err).toMatch(/Evidence: \/repo\/validation\/cloudflare\/abcdefghij12345\.json/);
    const byId = Object.fromEntries(h.record().results.map((x) => [x.id, x]));
    expect(h.record().exitStatus).toBe(1);
    expect(byId["E2E-008"]).toMatchObject({ status: "failed" });
    expect(byId["E2E-008"]?.detail).toMatch(new RegExp(`^step ${String(step)}: `));
    expect(byId["E2E-008"]?.detail).toMatch(message);
    expect(byId["AUTH-AC-011"]?.status).toBe(step <= 2 ? "failed" : "passed");
    expect(byId["PWD-AC-009"]?.status).toBe("not-run");
    expect(r.out + JSON.stringify(h.record())).not.toContain("auth-app-state");
    const appState = new URL(h.seen.find((x) => x.url.includes("/start?"))?.url ?? "https://x.test").searchParams.get("state");
    if (appState !== null) expect(r.out + JSON.stringify(h.record())).not.toContain(appState);
  });
});

describe("check-login: one connection (PAR-330)", () => {
  it("is one connection per origin, through the environment's proxy when one is set", () => {
    const direct = oneConnectionDispatcher({});
    expect(direct).toBeInstanceOf(Agent);
    expect(direct).not.toBeInstanceOf(EnvHttpProxyAgent);
    expect(oneConnectionDispatcher({ HTTPS_PROXY: "http://proxy.invalid:3128", NODE_USE_ENV_PROXY: "1" })).toBeInstanceOf(EnvHttpProxyAgent);
    expect(oneConnectionDispatcher({ http_proxy: "http://proxy.invalid:3128" })).toBeInstanceOf(EnvHttpProxyAgent);
  });
});
