import { describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { assembleApp } from "../core/assemble.js";
import { createDeployment, type Target } from "../core/identity.js";
import { defineApp, type Services } from "../core/public.js";
import { createHttpParts } from "../http/runtime.js";
import type { Severity } from "../log/public.js";
import { FRAMEWORK_SECRETS } from "../secrets/names.js";
import { LOCAL_COOKIES } from "./local-cookies.js";
import { createAuthParts, type AuthOptions } from "./runtime.js";
import { issueSession } from "./session.js";

// Generated dummy key for tests only.
const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const ORIGIN = "http://localhost:8787";

interface Written {
  component: string;
  severity: Severity;
  message: string;
}

function harness(options: Partial<AuthOptions> = {}, target: Target = "local", stage = "dev") {
  const written: Written[] = [];
  const deployment = createDeployment({ app: "notes", stage, target });
  const auth = createAuthParts({
    deployment,
    publicOrigin: ORIGIN,
    framework: { admins: [] },
    secret: async (_c, name) => {
      if (name === FRAMEWORK_SECRETS.sessionKey) return KEY;
      throw new Error(`unexpected secret ${name}`);
    },
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

  it(tag("AUTH-AC-003", "a real-provider session is user, or admin when its ID is in framework.admins"), async () => {
    const { request } = harness({ framework: { admins: ["u_ADMIN"] } });
    const asUser = await request("/api/whoami", { headers: { cookie: await session({ id: "u_USER", displayName: "U" }) } });
    expect(await asUser.json()).toStrictEqual({ level: "user", id: "u_USER", displayName: "U" });
    const asAdmin = await request("/api/whoami", { headers: { cookie: await session({ id: "u_ADMIN", displayName: null }) } });
    expect(await asAdmin.json()).toStrictEqual({ level: "admin", id: "u_ADMIN", displayName: null });
  });

  it(tag("AUTH-AC-006", "a tampered or expired session cookie is anonymous"), async () => {
    const { request } = harness();
    const cookie = await session({ id: "u_USER", displayName: null });
    const tampered = `${cookie.slice(0, -3)}${cookie.at(-3) === "A" ? "B" : "A"}${cookie.slice(-2)}`;
    expect(await (await request("/api/whoami", { headers: { cookie: tampered } })).json()).toStrictEqual({ level: "anonymous" });
    const old = await session({ id: "u_USER", displayName: null }, Date.now() - 8 * 24 * 3600 * 1000);
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
    const cookie = await session({ id: "u_USER", displayName: null });
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
    const cookie = await session({ id: "u_USER", displayName: null });
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
    const { request } = harness({ mock: createAuthMock(), framework: { admins: [], users: [] } });
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
    const res = await request("/api/auth/logout", { method: "POST", headers: { cookie: await session({ id: "u_X", displayName: null }), origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(cookiesOf(res).get("session_local")).toBe("; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});

describe("GET /api/auth/me", () => {
  it(tag("AUTH-AC-005", "returns the current user with Cache-Control: no-store"), async () => {
    const { request } = harness();
    const res = await request("/api/auth/me", { headers: { cookie: await session({ id: "u_USER", displayName: null }) } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toStrictEqual({ level: "user", id: "u_USER", displayName: null });
  });

  it(tag("AUTH-AC-005", "methods the contract does not define get 405 HTTP.METHOD_NOT_ALLOWED"), async () => {
    const { request } = await stubHarness();
    for (const [method, path] of [["GET", "/api/auth/logout"], ["DELETE", "/api/auth/me"], ["POST", "/api/auth/login"]] as const) {
      const res = await request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("HTTP.METHOD_NOT_ALLOWED");
    }
  });

  it(tag("AUTH-AC-012", "an unlisted login is anonymous to app code; /me alone adds unlistedId"), async () => {
    const { request } = harness({ framework: { admins: [], users: ["u_LISTED"] } });
    const cookie = await session({ id: "u_OTHER", displayName: "O" });
    expect(await (await request("/api/whoami", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous" });
    expect(await (await request("/api/auth/me", { headers: { cookie } })).json()).toStrictEqual({ level: "anonymous", unlistedId: "u_OTHER" });
  });
});
