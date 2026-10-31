import { describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { assembleApp } from "../core/assemble.js";
import { createDeployment, type Target } from "../core/identity.js";
import { defineApp, type Services } from "../core/public.js";
import { createHttpParts } from "../http/runtime.js";
import type { Severity } from "../log/public.js";
import { FRAMEWORK_SECRETS } from "../secrets/names.js";
import { LOCAL_COOKIES } from "./local-cookies.js";
import type { AccountStatus, LoginProvider } from "./login-provider.js";
import { requireAdmin } from "./public.js";
import { ROLE_REFRESH_INTERVAL_SECONDS, ROLE_REFRESH_RETRIES, ROLE_REFRESH_RETRY_DELAY_MS } from "./role-refresh.js";
import { createAuthParts, type AuthOptions } from "./runtime.js";
import { issueSession } from "./session.js";
import { signToken } from "./signing.js";

// Generated dummy key for tests only.
const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const ORIGIN = "http://localhost:8787";

interface Written {
  component: string;
  severity: Severity;
  message: string;
}

/**
 * A real (non-mock) provider for level evaluation: `accounts` by subject, an Error to make the
 * read fail. Every `accountStatus` call is counted (AUTH-AC-015).
 */
function fakeProvider(accounts: Map<string, AccountStatus | Error> = new Map([["s-user", { verified: true, roles: [] }]])) {
  const reads: string[] = [];
  const provider: LoginProvider = {
    id: "fake",
    beginLogin: () => Promise.reject(new Error("not used")),
    completeLogin: () => Promise.reject(new Error("not used")),
    async accountStatus(subject) {
      reads.push(subject);
      const account = accounts.get(subject);
      if (account instanceof Error) throw account;
      return account ?? null;
    },
  };
  return { provider, accounts, reads };
}

/** A real-provider session of the fake provider. */
// Confirmed at time 0: every request is past PAR-425, so each one reads the account (DEC-0672).
const real = (id: string, displayName: string | null, subject = "s-user") => ({ id, displayName, provider: "fake", subject, role: { level: "user" as const, checkedAt: 0 } });

function harness(options: Partial<AuthOptions> = {}, target: Target = "local", stage = "dev") {
  const written: Written[] = [];
  const deployment = createDeployment({ app: "notes", stage, target });
  const auth = createAuthParts({
    deployment,
    publicOrigin: ORIGIN,
    secret: async (_c, name) => {
      if (name === FRAMEWORK_SECRETS.sessionKey) return KEY;
      throw new Error(`unexpected secret ${name}`);
    },
    // Retries wait no real time here (PAR-427 is tested in role-refresh.unit.test.ts).
    sleep: async () => undefined,
    // The local runtime passes the local settings (DEC-0195).
    ...(target === "local" ? { cookies: LOCAL_COOKIES } : {}),
    ...options,
  });
  const http = createHttpParts();
  const app = defineApp({
    name: "notes",
    config: {},
    secrets: [],
    tables: {},
    routes: (api) => {
      api.get("/whoami", (c) => c.json(c.var.user));
      api.get("/admin-only", requireAdmin(), (c) => c.json({ ok: true }));
      api.get("/twice", (c) => c.json({ first: c.var.user.level, second: c.var.user.level }));
      for (const method of ["post", "put", "patch", "delete"] as const) api[method]("/change", (c) => c.json({ changed: true }));
    },
  });
  const hono = assembleApp(app, {
    deployment,
    createLog: () => ({ write: (component, severity, message) => void written.push({ component, severity, message }) }),
    createServices: () => ({}) as unknown as Omit<Services, "log">,
    currentUser: auth.currentUser,
    forgeryCheck: auth.forgeryCheck,
    ...http.parts,
    frameworkRoutes: (api) => {
      http.parts.frameworkRoutes?.(api);
      auth.routes(api);
    },
  });
  http.attach(hono);
  return { request: (path: string, init?: RequestInit) => hono.request(path, init), written };
}

async function session(data: Parameters<typeof issueSession>[1], now = Date.now()): Promise<string> {
  return `session_local=${await issueSession(KEY, data, now)}`;
}

describe("current user", () => {
  it(tag("AUTH-AC-001", "no session: c.var.user is exactly { level: anonymous }"), async () => {
    const { request } = harness();
    expect(await (await request("/api/whoami")).json()).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-003", "a real-provider session is user for a verified account, admin when its roles hold admin, and a change shows on the next request"), async () => {
    const fake = fakeProvider(new Map([["s-user", { verified: true, roles: [] }], ["s-admin", { verified: true, roles: ["editor", "admin"] }]]));
    const { request } = harness({ provider: fake.provider });
    const userCookie = await session(real("u_USER", "U"));
    expect(await (await request("/api/whoami", { headers: { cookie: userCookie } })).json()).toStrictEqual({ level: "user", id: "u_USER", displayName: "U" });
    const asAdmin = await request("/api/whoami", { headers: { cookie: await session(real("u_ADMIN", null, "s-admin")) } });
    expect(await asAdmin.json()).toStrictEqual({ level: "admin", id: "u_ADMIN", displayName: null });
    // Grant on the account: the very next request with the same session is admin; revoke: user again.
    fake.accounts.set("s-user", { verified: true, roles: ["admin"] });
    expect(await (await request("/api/whoami", { headers: { cookie: userCookie } })).json()).toMatchObject({ level: "admin" });
    fake.accounts.set("s-user", { verified: true, roles: [] });
    expect(await (await request("/api/whoami", { headers: { cookie: userCookie } })).json()).toMatchObject({ level: "user" });
  });

  it("unknown role names are ignored; there is no user role", async () => {
    const fake = fakeProvider(new Map([["s-user", { verified: true, roles: ["user", "Admin", "superuser"] }]]));
    const { request } = harness({ provider: fake.provider });
    expect(await (await request("/api/whoami", { headers: { cookie: await session(real("u_USER", null)) } })).json()).toStrictEqual({ level: "user", id: "u_USER", displayName: null });
  });

  it(tag("AUTH-AC-012", "an unverified, unknown or failing account is anonymous, never user or admin; a failed read logs one warn entry"), async () => {
    const failure = Object.assign(new Error("no such table: __framework_auth_user"), { code: "SQLITE_ERROR" });
    const fake = fakeProvider(
      new Map<string, AccountStatus | Error>([
        ["s-unverified", { verified: false, roles: ["admin"] }],
        ["s-failing", failure],
        ["s-opaque", new Error("something with s-opaque in it")],
      ]),
    );
    const { request, written } = harness({ provider: fake.provider });
    for (const subject of ["s-unverified", "s-missing", "s-failing", "s-opaque"]) {
      const res = await request("/api/whoami", { headers: { cookie: await session(real("u_X", "X", subject)) } });
      expect(await res.json(), subject).toStrictEqual({ level: "anonymous" });
    }
    expect(written).toStrictEqual([
      { component: "AUTH", severity: "warn", message: "role refresh failed (SQLITE_ERROR); session ended" },
      { component: "AUTH", severity: "warn", message: "role refresh failed (unknown); session ended" },
    ]);
  });

  it("a session of a provider the stage does not install is anonymous with no read", async () => {
    const fake = fakeProvider();
    const { request } = harness({ provider: fake.provider });
    const other = await session({ id: "u_X", displayName: null, provider: "other", subject: "s-user", role: { level: "user", checkedAt: 0 } });
    expect(await (await request("/api/whoami", { headers: { cookie: other } })).json()).toStrictEqual({ level: "anonymous" });
    expect(fake.reads).toEqual([]);
  });

  it(tag("AUTH-AC-015", "no account read without a valid real-provider session; exactly one per request with one, however often c.var.user is read"), async () => {
    const fake = fakeProvider();
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ provider: fake.provider, mock: createAuthMock() });
    const valid = await session(real("u_USER", null));
    const tampered = `${valid.slice(0, -3)}${valid.at(-3) === "A" ? "B" : "A"}${valid.slice(-2)}`;
    const expired = await session(real("u_USER", null), Date.now() - 8 * 24 * 3600 * 1000);
    const mockSession = await session({ id: "m", displayName: null, mockLevel: "admin" });
    for (const headers of [{}, { cookie: tampered }, { cookie: expired }, { cookie: mockSession }, { cookie: "session_local=garbage" }]) {
      await request("/api/whoami", { headers });
      await request("/api/auth/me", { headers });
    }
    expect(fake.reads).toEqual([]);
    expect(await (await request("/api/twice", { headers: { cookie: valid } })).json()).toStrictEqual({ first: "user", second: "user" });
    expect(fake.reads).toEqual(["s-user"]);
  });

  it(tag("AUTH-AC-012", "a version 1 session cookie is anonymous, with no read"), async () => {
    const fake = fakeProvider();
    const { request } = harness({ provider: fake.provider });
    const iat = Math.floor(Date.now() / 1000);
    const v1 = await signToken(KEY, "session", { v: 1, id: "u_USER", name: null, iat, exp: iat + 3600 });
    expect(await (await request("/api/whoami", { headers: { cookie: `session_local=${v1}` } })).json()).toStrictEqual({ level: "anonymous" });
    expect(fake.reads).toEqual([]);
  });

  it(tag("AUTH-AC-006", "a tampered or expired session cookie is anonymous"), async () => {
    const { request } = harness({ provider: fakeProvider().provider });
    const cookie = await session(real("u_USER", null));
    const tampered = `${cookie.slice(0, -3)}${cookie.at(-3) === "A" ? "B" : "A"}${cookie.slice(-2)}`;
    expect(await (await request("/api/whoami", { headers: { cookie: tampered } })).json()).toStrictEqual({ level: "anonymous" });
    const old = await session(real("u_USER", null), Date.now() - 8 * 24 * 3600 * 1000);
    expect(await (await request("/api/whoami", { headers: { cookie: old } })).json()).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-009", "a mock session's level is used only where the mock is installed"), async () => {
    const cookie = await session({ id: "chosen", displayName: "C", mockLevel: "admin" });
    const without = harness();
    expect(await (await without.request("/api/whoami", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous" });
    const { createAuthMock } = await import("./mock.js");
    const withMock = harness({ mock: createAuthMock() });
    expect(await (await withMock.request("/api/whoami", { headers: { cookie } })).json()).toStrictEqual({ level: "admin", id: "chosen", displayName: "C" });
  });
});

describe("request forgery check", () => {
  const METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  it(tag("AUTH-AC-007", "state-changing requests with a session need Origin equal to the public origin"), async () => {
    const { request } = harness();
    const cookie = await session(real("u_USER", null));
    for (const method of METHODS) {
      for (const origin of [undefined, "https://evil.example", "null", "http://localhost:8788", `${ORIGIN}/`]) {
        const headers: Record<string, string> = { cookie, ...(origin === undefined ? {} : { origin }) };
        const res = await request("/api/change", { method, headers });
        expect(res.status, `${method} ${origin}`).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH.REQUEST_FORGERY");
      }
      const ok = await request("/api/change", { method, headers: { cookie, origin: ORIGIN } });
      expect(ok.status).toBe(200);
    }
  });

  it(tag("AUTH-AC-007", "an invalid session cookie still counts as carrying a session"), async () => {
    const { request } = harness();
    const res = await request("/api/change", { method: "POST", headers: { cookie: "session_local=garbage", origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("requests without a session, and safe methods, are not checked", async () => {
    const { request } = harness();
    expect((await request("/api/change", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(200);
    const cookie = await session(real("u_USER", null));
    expect((await request("/api/whoami", { headers: { cookie, origin: "https://evil.example" } })).status).toBe(200);
  });

  it(tag("AUTH-AC-007", "a mock fixed logged-in user counts as carrying a session"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ mock: createAuthMock({ fixedUser: () => ({ level: "user", id: "x", displayName: null }) }) });
    expect((await request("/api/change", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await request("/api/change", { method: "POST", headers: { origin: ORIGIN } })).status).toBe(200);
  });
});

function cookiesOf(res: Response): Map<string, string> {
  return new Map(
    res.headers.getSetCookie().map((line) => {
      const eq = line.indexOf("=");
      return [line.slice(0, eq), line.slice(eq + 1)];
    }),
  );
}

function valueOf(line: string | undefined): string {
  return (line ?? "").split(";")[0] ?? "";
}

async function stubHarness(options: Partial<AuthOptions> = {}) {
  const { createStubLoginProvider, stubCallbackUrl } = await import("./stub-provider.js");
  const h = harness({ provider: createStubLoginProvider(), ...options });
  async function begin(returnTo?: string, headers?: Record<string, string>) {
    const res = await h.request(`/api/auth/login${returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`}`, { headers: headers ?? {} });
    const location = new URL(res.headers.get("location") ?? "");
    const tx = cookiesOf(res).get("login_local");
    return { res, location, tx: `login_local=${valueOf(tx)}`, txLine: tx ?? "" };
  }
  async function callback(location: URL, cookie?: string, login?: Parameters<typeof stubCallbackUrl>[1]) {
    const url = new URL(login === undefined ? location.toString() : stubCallbackUrl(location.toString(), login));
    return h.request(`${url.pathname}${url.search}`, cookie === undefined ? {} : { headers: { cookie } });
  }
  return { ...h, begin, callback };
}

function expectFailedLogin(res: Response, written: Written[], reason: RegExp): void {
  expect(res.status).toBe(302);
  const location = res.headers.get("location") ?? "";
  expect(location).toMatch(/^\/\?authError=login_failed&requestId=[0-9a-f-]{36}$/);
  expect(cookiesOf(res).has("session_local")).toBe(false);
  expect(written.filter((w) => w.component === "AUTH")).toStrictEqual([
    { component: "AUTH", severity: "warn", message: expect.stringMatching(reason) },
  ]);
}

describe("login and callback", () => {
  it(tag(["AUTH-AC-006", "AUTH-AC-008"], "login redirects to the provider with a callback URL from the public origin and sets the transaction cookie"), async () => {
    const { begin } = await stubHarness();
    for (const headers of [{}, { host: "evil.example" }, { "x-forwarded-host": "evil.example", forwarded: "host=evil.example" }]) {
      const { res, location, txLine } = await begin("/notes", headers);
      expect(res.status).toBe(302);
      expect(`${location.origin}${location.pathname}`).toBe(`${ORIGIN}/api/auth/callback`);
      expect(txLine).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it(tag(["AUTH-AC-002", "AUTH-AC-006"], "a valid callback creates the session for the derived user ID, clears the transaction and returns"), async () => {
    const { begin, callback, request } = await stubHarness();
    const { location, tx } = await begin("/notes/42?tab=files");
    const res = await callback(location, tx, { subject: "alice", displayName: "Alice" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/notes/42?tab=files");
    const set = cookiesOf(res);
    expect(set.get("login_local")).toBe("; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    expect(set.get("session_local")).toMatch(/; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    const me = await request("/api/auth/me", { headers: { cookie: `session_local=${valueOf(set.get("session_local"))}` } });
    const { deriveUserId } = await import("./user-id.js");
    expect(await me.json()).toStrictEqual({ level: "user", id: await deriveUserId("stub", "alice"), displayName: "Alice" });
  });

  it(tag("AUTH-AC-010", "an unsafe returnTo returns to / after login"), async () => {
    const { begin, callback } = await stubHarness();
    for (const returnTo of ["//evil.example", "/\\evil.example", "https://evil.example", "/%2F%2Fevil.example", "javascript:"]) {
      const { location, tx } = await begin(returnTo);
      const res = await callback(location, tx, { subject: "s" });
      expect(res.headers.get("location")).toBe("/");
      expect(cookiesOf(res).has("session_local")).toBe(true);
    }
  });

  it(tag("AUTH-AC-010", "missing, tampered or expired transaction: failed-login redirect, no session, 'transaction missing or expired'"), async () => {
    const missing = await stubHarness();
    const a = await missing.begin("/x");
    expectFailedLogin(await missing.callback(a.location), missing.written, /^login failed: transaction missing or expired/);

    const tampered = await stubHarness();
    const b = await tampered.begin("/x");
    const forged = `${b.tx.slice(0, 20)}${b.tx[20] === "A" ? "B" : "A"}${b.tx.slice(21)}`;
    expectFailedLogin(await tampered.callback(b.location, forged), tampered.written, /^login failed: transaction missing or expired/);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const expired = await stubHarness();
      const c = await expired.begin("/x");
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      expectFailedLogin(await expired.callback(c.location, c.tx), expired.written, /^login failed: transaction missing or expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it(tag("AUTH-AC-010", "state mismatch and refused callbacks are failed logins naming the provider's reason"), async () => {
    const crossed = await stubHarness();
    const first = await crossed.begin("/a");
    const second = await crossed.begin("/b");
    expectFailedLogin(await crossed.callback(first.location, second.tx), crossed.written, /^login failed: state mismatch$/);

    const refused = await stubHarness();
    const c = await refused.begin("/a");
    const res = await refused.callback(c.location, c.tx, { subject: "s", failure: "refused" });
    expectFailedLogin(res, refused.written, /^login failed: provider refused$/);
    // The transaction is spent either way.
    expect(cookiesOf(res).get("login_local")).toBe("; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });

  it("an unexpected provider error is not a failed login: it surfaces as CORE.INTERNAL", async () => {
    const { createStubLoginProvider } = await import("./stub-provider.js");
    const stub = createStubLoginProvider();
    const h = harness({ provider: { ...stub, id: stub.id, beginLogin: stub.beginLogin, completeLogin: () => Promise.reject(new TypeError("bug")) } });
    const login = await h.request("/api/auth/login");
    const location = new URL(login.headers.get("location") ?? "");
    const tx = valueOf(cookiesOf(login).get("login_local"));
    const res = await h.request(`${location.pathname}${location.search}`, { headers: { cookie: `login_local=${tx}` } });
    expect(res.status).toBe(500);
  });

  it("login with neither a provider nor the mock is CORE.MISCONFIGURED", async () => {
    const { request } = harness();
    const res = await request("/api/auth/login");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
  });

  it(tag("AUTH-AC-009", "with only the mock, login sets the mock's default user session and returns"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ mock: createAuthMock() });
    const res = await request("/api/auth/login?returnTo=%2Fnotes");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/notes");
    const cookie = `session_local=${valueOf(cookiesOf(res).get("session_local"))}`;
    expect(await (await request("/api/auth/me", { headers: { cookie } })).json()).toStrictEqual({ level: "user", id: "mock-user", displayName: null });
  });
});

describe("authentication mock", () => {
  async function mockLogin(request: ReturnType<typeof harness>["request"], body: unknown, cookie?: string) {
    return request("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify(body),
    });
  }

  it(tag("AUTH-AC-009", "mock-login sets the chosen identity with the ID used as given; anonymous clears the session"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ mock: createAuthMock() });
    for (const identity of [
      { level: "user", id: "chosen-user", displayName: "Ada" },
      { level: "admin", id: "chosen-admin", displayName: null },
    ]) {
      const res = await mockLogin(request, identity);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      const line = cookiesOf(res).get("session_local") ?? "";
      expect(line).toMatch(/; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
      const me = await request("/api/auth/me", { headers: { cookie: `session_local=${valueOf(line)}` } });
      expect(await me.json()).toStrictEqual(identity);
    }
    const cleared = await mockLogin(request, { level: "anonymous" });
    expect(cleared.status).toBe(204);
    expect(cookiesOf(cleared).get("session_local")).toBe("; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });

  it(tag("AUTH-AC-009", "default IDs are fixed per level and display names default to null"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ mock: createAuthMock() });
    for (const level of ["user", "admin"] as const) {
      const res = await mockLogin(request, { level });
      const cookie = `session_local=${valueOf(cookiesOf(res).get("session_local"))}`;
      expect(await (await request("/api/auth/me", { headers: { cookie } })).json()).toStrictEqual({ level, id: `mock-${level}`, displayName: null });
    }
  });

  it(tag("AUTH-AC-005", "invalid mock-login bodies are 400 HTTP.INVALID_INPUT"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const { request } = harness({ mock: createAuthMock() });
    for (const body of [{ level: "boss" }, {}, { level: "user", extra: true }, { level: "user", id: 5 }, { level: "user", id: "" }, { level: "user", displayName: 3 }]) {
      const res = await mockLogin(request, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("HTTP.INVALID_INPUT");
    }
  });

  it(tag("AUTH-AC-009", "without the mock, mock-login is 404 HTTP.NOT_FOUND"), async () => {
    const { request } = harness({}, "cloudflare", "prod");
    const res = await mockLogin(request, { level: "admin" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("HTTP.NOT_FOUND");
  });

  it(tag("AUTH-AC-009", "installing the mock on a production deployment is CORE.MISCONFIGURED"), async () => {
    const { createAuthMock } = await import("./mock.js");
    const prod = harness({ mock: createAuthMock() }, "cloudflare", "prod");
    const res = await prod.request("/api/whoami");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
    const testStage = harness({ mock: createAuthMock() }, "cloudflare", "test-ci");
    expect((await testStage.request("/api/whoami")).status).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  it(tag("AUTH-AC-006", "clears the session cookie with 204"), async () => {
    const { request } = harness();
    const res = await request("/api/auth/logout", { method: "POST", headers: { cookie: await session(real("u_X", null)), origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(cookiesOf(res).get("session_local")).toBe("; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});

describe("GET /api/auth/me", () => {
  it(tag("AUTH-AC-005", "returns the current user with Cache-Control: no-store"), async () => {
    const { request } = harness({ provider: fakeProvider().provider });
    const res = await request("/api/auth/me", { headers: { cookie: await session(real("u_USER", null)) } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toStrictEqual({ level: "user", id: "u_USER", displayName: null });
  });

  it(tag("AUTH-AC-005", "methods the contract does not define get 405 HTTP.METHOD_NOT_ALLOWED"), async () => {
    const { request } = await stubHarness();
    for (const [method, path] of [["GET", "/api/auth/logout"], ["DELETE", "/api/auth/me"], ["POST", "/api/auth/login"]] as const) {
      // With the public origin: a POST under /api/auth/ without it is refused first (AUTH-REQ-007).
      const res = await request(path, { method, headers: { origin: ORIGIN } });
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("HTTP.METHOD_NOT_ALLOWED");
    }
  });

  it(tag("AUTH-AC-012", "/me never has an unlistedId: an unverified account is plain anonymous"), async () => {
    const fake = fakeProvider(new Map([["s-user", { verified: false, roles: [] }]]));
    const { request } = harness({ provider: fake.provider });
    const cookie = await session(real("u_OTHER", "O"));
    expect(await (await request("/api/auth/me", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous" });
  });
});

describe("sign-in through the auth app (plan §4.1 steps 1 and 4)", () => {
  const sub = "cf-sub-alice";
  const cookieOf = (res: Response): string => `session_local=${valueOf(cookiesOf(res).get("session_local"))}`;

  async function authAppHarness() {
    const { createFakeAuthAppBinding } = await import("./auth-app-binding.js");
    const { createAuthAppProvider } = await import("./auth-app-provider.js");
    // A fixed clock the test moves (whole seconds), and a sleep that only records its delays.
    const clock = { now: Date.parse("2026-10-31T12:00:00Z") };
    const delays: number[] = [];
    const binding = createFakeAuthAppBinding({ now: () => clock.now });
    const built: string[] = [];
    // A per-request provider, as the Worker builds it over `env.AUTH`.
    const h = harness({
      provider: (c) => {
        built.push(c.req.path);
        return createAuthAppProvider({ binding, app: "notes-dev", authAppOrigin: "https://auth.example.test" });
      },
      now: () => clock.now,
      sleep: async (ms) => void delays.push(ms),
    });
    async function begin() {
      const res = await h.request("/api/auth/login?returnTo=%2Fnotes");
      const start = new URL(res.headers.get("location") ?? "");
      return { start, state: start.searchParams.get("state") ?? "", tx: `login_local=${valueOf(cookiesOf(res).get("login_local"))}` };
    }
    async function signIn(identity: { sub: string; email: string; role: "admin" | "user" } = { sub, email: "alice@example.com", role: "user" }) {
      const { start, state, tx } = await begin();
      const code = binding.issueCode(identity, { app: "notes-dev", returnUrl: start.searchParams.get("return") ?? "" });
      return { start, res: await h.request(`/api/auth/callback?${new URLSearchParams({ code, state }).toString()}`, { headers: { cookie: tx } }) };
    }
    return { ...h, binding, built, begin, signIn, clock, delays };
  }

  it("login redirects to the auth app's /start with the app ID and the callback URL from the public origin", async () => {
    const { begin } = await authAppHarness();
    const { start } = await begin();
    expect(`${start.origin}${start.pathname}`).toBe("https://auth.example.test/start");
    expect(start.searchParams.get("app")).toBe("notes-dev");
    expect(start.searchParams.get("return")).toBe(`${ORIGIN}/api/auth/callback`);
  });

  it("a redeemed code creates a cf-account session whose user ID is derived from the Cloudflare sub", async () => {
    const { deriveUserId } = await import("./user-id.js");
    const { readSession } = await import("./session.js");
    const { request, signIn, clock } = await authAppHarness();
    const { res } = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/notes");
    const cookie = cookieOf(res);
    const id = await deriveUserId("cf-account", sub);
    expect(await readSession(KEY, cookie.slice("session_local=".length), clock.now)).toMatchObject({ id, provider: "cf-account", subject: sub });
    expect(await (await request("/api/whoami", { headers: { cookie } })).json()).toStrictEqual({ level: "user", id, displayName: null });
  });

  it("the level follows the auth app's role at its next refresh, and a removed user is anonymous", async () => {
    const { request, signIn, binding, clock } = await authAppHarness();
    const cookie = cookieOf((await signIn({ sub, email: "alice@example.com", role: "admin" })).res);
    expect(await (await request("/api/whoami", { headers: { cookie } })).json()).toMatchObject({ level: "admin" });
    binding.setRole(sub, null);
    clock.now += (ROLE_REFRESH_INTERVAL_SECONDS + 1) * 1000;
    expect(await (await request("/api/whoami", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous" });
  });

  describe("role refresh (plan §4.1 step 5)", () => {
    const due = (ROLE_REFRESH_INTERVAL_SECONDS + 1) * 1000;
    const sessionLines = (res: Response) => res.headers.getSetCookie().filter((line) => line.startsWith("session_local="));

    async function signedIn(role: "admin" | "user" = "user") {
      const h = await authAppHarness();
      const cookie = cookieOf((await h.signIn({ sub, email: "alice@example.com", role })).res);
      const whoami = (path = "/api/whoami") => h.request(path, { headers: { cookie } });
      return { ...h, cookie, whoami };
    }

    it("the session keeps the role confirmed at redemption, with no role call, up to and including exactly the interval", async () => {
      const { whoami, binding, clock } = await signedIn("admin");
      binding.setRole(sub, "user");
      expect(await (await whoami()).json()).toMatchObject({ level: "admin" });
      clock.now += ROLE_REFRESH_INTERVAL_SECONDS * 1000;
      const res = await whoami();
      expect(await res.json()).toMatchObject({ level: "admin" });
      expect(sessionLines(res)).toStrictEqual([]);
      expect(binding.calls.role).toBe(0);
    });

    it("one second past the interval, the role is read once and the session is re-issued with it, keeping its expiry", async () => {
      const { readSession } = await import("./session.js");
      const { whoami, binding, clock, cookie } = await signedIn("admin");
      const before = (await readSession(KEY, cookie.slice("session_local=".length), clock.now)) as { expiresAt?: number } | undefined;
      expect(before?.expiresAt).toBeTypeOf("number");
      binding.setRole(sub, "user");
      clock.now += due;
      const res = await whoami();
      expect(await res.json()).toMatchObject({ level: "user" });
      expect(binding.calls.role).toBe(1);
      const [line] = sessionLines(res);
      const after = await readSession(KEY, valueOf(line).slice("session_local=".length), clock.now);
      expect(after).toMatchObject({ role: { level: "user", checkedAt: clock.now / 1000 }, expiresAt: before?.expiresAt });
      expect(line).toContain(`Max-Age=${(before?.expiresAt ?? 0) - clock.now / 1000}`);
    });

    it("a refresh that fails is retried twice with the delay; success on a retry keeps the session", async () => {
      const { whoami, binding, clock, delays, written } = await signedIn("admin");
      binding.failNext(ROLE_REFRESH_RETRIES);
      clock.now += due;
      const res = await whoami();
      expect(await res.json()).toMatchObject({ level: "admin" });
      expect(binding.calls.role).toBe(1 + ROLE_REFRESH_RETRIES);
      expect(delays).toStrictEqual([ROLE_REFRESH_RETRY_DELAY_MS, ROLE_REFRESH_RETRY_DELAY_MS]);
      expect(sessionLines(res)).toHaveLength(1);
      expect(sessionLines(res)[0]).not.toContain("Max-Age=0");
      expect(written.filter((w) => w.component === "AUTH")).toStrictEqual([]);
    });

    it("when every retry fails, the session ends and the request is anonymous: a role-protected route refuses it", async () => {
      const { whoami, binding, clock, written } = await signedIn("admin");
      binding.failNext(1 + ROLE_REFRESH_RETRIES);
      clock.now += due;
      const res = await whoami("/api/admin-only");
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH.UNAUTHENTICATED");
      expect(binding.calls.role).toBe(1 + ROLE_REFRESH_RETRIES);
      expect(sessionLines(res)).toStrictEqual(["session_local=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
      expect(written.filter((w) => w.component === "AUTH")).toStrictEqual([{ component: "AUTH", severity: "warn", message: "role refresh failed (unknown); session ended" }]);
    });

    it("a removed user (null) ends the session at once, without retrying", async () => {
      const { whoami, binding, clock, delays } = await signedIn();
      binding.setRole(sub, null);
      clock.now += due;
      const res = await whoami();
      expect(await res.json()).toStrictEqual({ level: "anonymous" });
      expect(binding.calls.role).toBe(1);
      expect(delays).toStrictEqual([]);
      expect(sessionLines(res)).toStrictEqual(["session_local=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
    });

    it("a logout on a request that refreshes still ends with the session cleared", async () => {
      const { request, cookie, clock } = await signedIn();
      clock.now += due;
      const res = await request("/api/auth/logout", { method: "POST", headers: { cookie, origin: ORIGIN } });
      expect(res.status).toBe(204);
      const lines = sessionLines(res);
      expect(lines).toHaveLength(2);
      expect(lines[0]).not.toContain("Max-Age=0");
      expect(lines[1]).toBe("session_local=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    });

    it("a callback on a request whose old session refreshes ends with the new session's cookie", async () => {
      const { readSession } = await import("./session.js");
      const { cookie, clock, begin, binding, request } = await signedIn();
      clock.now += due;
      const { start, state, tx } = await begin();
      const code = binding.issueCode({ sub: "cf-sub-bob", email: "bob@example.com", role: "admin" }, { app: "notes-dev", returnUrl: start.searchParams.get("return") ?? "" });
      const res = await request(`/api/auth/callback?${new URLSearchParams({ code, state }).toString()}`, { headers: { cookie: `${cookie}; ${tx}` } });
      const lines = sessionLines(res);
      expect(lines).toHaveLength(2);
      expect(await readSession(KEY, valueOf(lines[1]).slice("session_local=".length), clock.now)).toMatchObject({ subject: "cf-sub-bob", role: { level: "admin" } });
    });

    it("an unverified account at refresh ends the session at once, with no log line", async () => {
      const fake = fakeProvider(new Map([["s-user", { verified: false, roles: [] }]]));
      const now = Date.parse("2026-10-31T12:00:00Z");
      const { request, written } = harness({ provider: fake.provider, now: () => now, sleep: async () => undefined });
      const stale = { ...real("u_USER", null), role: { level: "user" as const, checkedAt: now / 1000 - ROLE_REFRESH_INTERVAL_SECONDS - 1 } };
      const res = await request("/api/whoami", { headers: { cookie: await session(stale, now - 1000) } });
      expect(await res.json()).toStrictEqual({ level: "anonymous" });
      expect(fake.reads).toStrictEqual(["s-user"]);
      expect(sessionLines(res)).toStrictEqual(["session_local=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
      expect(written.filter((w) => w.component === "AUTH")).toStrictEqual([]);
    });
  });

  it("the auth app's error redirect is a failed login: no session, one warn naming the reason", async () => {
    const { request, written, binding, begin } = await authAppHarness();
    const { state, tx } = await begin();
    const res = await request(`/api/auth/callback?${new URLSearchParams({ error: "login_failed", state }).toString()}`, { headers: { cookie: tx } });
    expectFailedLogin(res, written, /^login failed: provider refused$/);
    expect(binding.calls.redeem).toBe(0);
  });

  it("the provider is built for the request that uses it", async () => {
    const { signIn, built } = await authAppHarness();
    await signIn();
    expect(built).toContain("/api/auth/login");
    expect(built).toContain("/api/auth/callback");
  });
});
