/**
 * AUTH-AC-006 (docs/components/auth.md AUTH-REQ-006, §2 "Session cookie", "Login", "Credential
 * login"): "On each target, session and transaction cookie attributes are as specified, a
 * tampered session cookie is treated as anonymous, and logout clears the cookie. Locally, expired
 * and future-dated session cookies are also treated as anonymous."
 *
 * On the run's target (`dev`, or the test stage): the session cookie from both ways a test logs
 * in there (`/api/auth/mock-login`, and a password sign-in through the provider's routes, with the
 * mail read from `.mail/` or the test-mail route), tampering, and logout. `GET /api/auth/login`
 * only redirects to the sign-in page (DEC-0516; DEC-0171's default-user login is retired), and a
 * credential login uses no transaction cookie, so login sets neither cookie. The transaction
 * cookie belongs to a redirect provider, which only the in-process stub is
 * (`createTestApp(…, { stubLoginProvider: true })`), so that part and the "Locally, …" clauses
 * (a moved clock) run in-process on the local target only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { client, tag, target } from "../../harness/index.js";
import { disposeReference, openReference } from "../files/in-process.js";
import { clears, cookieProblems, isCloud, LOGIN_LIFETIME_S, loginCookieName, parseSetCookie, SESSION_LIFETIME_S, sessionCookieName, setCookies, tamper } from "./support.js";

describe("AUTH-AC-006 sessions on the target", () => {
  it(tag("AUTH-AC-006", "the session cookie set by mock-login has the specified name and attributes"), async () => {
    const c = client();
    const res = c.expectStatus(await c.post("/api/auth/mock-login", { level: "user", id: "c-t3-ac006-attrs" }), 204);
    const sessions = setCookies(res.headers).filter((k) => k.name === sessionCookieName());
    expect(sessions.length, `Set-Cookie: ${res.headers.getSetCookie().join(" | ")}`).toBe(1);
    const [session] = sessions;
    if (session === undefined) throw new Error("no session cookie");
    expect(cookieProblems(session, { name: sessionCookieName(), lifetimeS: SESSION_LIFETIME_S, cloud: isCloud() })).toStrictEqual([]);
  });

  it(tag("AUTH-AC-006", "a tampered session cookie is treated as anonymous"), async () => {
    const c = client();
    const res = c.expectStatus(await c.post("/api/auth/mock-login", { level: "user", id: "c-t3-ac006-tamper" }), 204);
    const session = setCookies(res.headers).find((k) => k.name === sessionCookieName());
    if (session === undefined) throw new Error("mock-login set no session cookie");
    const name = session.name;
    const asCookie = (value: string): Record<string, string> => ({ cookie: `${name}=${value}` });
    // Control: the cookie as issued is a user.
    expect(c.expectStatus(await client().get("/api/auth/me", { headers: asCookie(session.value) }), 200).json()).toMatchObject({ level: "user", id: "c-t3-ac006-tamper" });
    const dot = session.value.indexOf(".");
    const variants = [tamper(session.value, 0), tamper(session.value, Math.max(1, dot - 2)), tamper(session.value, -1), `${session.value}x`, session.value.slice(0, -1), "not-a-session"];
    for (const value of variants) {
      const anon = client();
      expect(anon.expectStatus(await anon.get("/api/auth/me", { headers: asCookie(value) }), 200).json(), value).toStrictEqual({ level: "anonymous" });
      anon.expectError(await anon.get("/api/levels/user", { headers: asCookie(value) }), 401, "AUTH.UNAUTHENTICATED");
    }
  });

  it(tag("AUTH-AC-006", "logout clears the session cookie"), async () => {
    const user = await client().as("user", { id: "c-t3-ac006-logout" });
    expect(user.expectStatus(await user.get("/api/auth/me"), 200).json()).toMatchObject({ level: "user", id: "c-t3-ac006-logout" });
    const res = user.expectStatus(await user.post("/api/auth/logout"), 204);
    const cleared = setCookies(res.headers).filter((k) => k.name === sessionCookieName());
    expect(cleared.length, `Set-Cookie: ${res.headers.getSetCookie().join(" | ")}`).toBe(1);
    expect(cleared.every((k) => clears(k)), cleared.map((k) => k.raw).join(" | ")).toBe(true);
    // The clearing header must match the cookie's own scope, or the browser keeps the cookie.
    for (const k of cleared) {
      expect(k.attributes.get("path")).toBe("/");
      expect(k.attributes.has("domain")).toBe(false);
      if (isCloud()) expect(k.attributes.has("secure")).toBe(true);
    }
    expect(user.cookies()[sessionCookieName()]).toBeUndefined();
    expect(user.expectStatus(await user.get("/api/auth/me"), 200).json()).toStrictEqual({ level: "anonymous" });
  });
});

// "Locally, …" and the stub-provider transaction cookie: in-process, local target only.
if (target().target === "local") {
  describe("AUTH-AC-006 locally, in-process", () => {
    afterEach(async () => {
      vi.useRealTimers();
      await disposeReference();
    });

    async function mockLogin(app: Awaited<ReturnType<typeof openReference>>, id: string): Promise<string> {
      const res = await app.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "user", id }) });
      expect(res.status).toBe(204);
      const session = setCookies(res.headers).find((k) => k.name === sessionCookieName(false));
      if (session === undefined) throw new Error("mock-login set no session cookie");
      return `${session.name}=${session.value}`;
    }

    async function me(app: Awaited<ReturnType<typeof openReference>>, cookie: string): Promise<unknown> {
      const res = await app.request("/api/auth/me", { headers: { cookie } });
      expect(res.status).toBe(200);
      return res.json();
    }

    it(tag("AUTH-AC-006", "locally (in-process): an expired session cookie is anonymous, and one within PAR-250 is not"), async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = Date.parse("2026-06-01T12:00:00Z");
      vi.setSystemTime(start);
      const app = await openReference();
      const cookie = await mockLogin(app, "c-t3-ac006-expiry");
      vi.setSystemTime(start + (SESSION_LIFETIME_S - 300) * 1000);
      expect(await me(app, cookie)).toMatchObject({ level: "user", id: "c-t3-ac006-expiry" });
      vi.setSystemTime(start + (SESSION_LIFETIME_S + 300) * 1000);
      expect(await me(app, cookie)).toStrictEqual({ level: "anonymous" });
      expect((await app.request("/api/levels/user", { headers: { cookie } })).status).toBe(401);
    });

    it(tag("AUTH-AC-006", "locally (in-process): a future-dated session cookie is anonymous"), async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = Date.parse("2026-06-01T12:00:00Z");
      vi.setSystemTime(now + 24 * 60 * 60 * 1000);
      const app = await openReference();
      const cookie = await mockLogin(app, "c-t3-ac006-future");
      vi.setSystemTime(now);
      expect(await me(app, cookie)).toStrictEqual({ level: "anonymous" });
      expect((await app.request("/api/levels/user", { headers: { cookie } })).status).toBe(401);
    });

    it(tag("AUTH-AC-006", "locally (in-process, stub provider): the transaction cookie and the resulting session cookie have the specified names and attributes"), async () => {
      const app = await openReference({ stubLoginProvider: true });
      const start = await app.request("/api/auth/login?returnTo=%2F", { redirect: "manual" });
      expect([302, 303]).toContain(start.status);
      const login = setCookies(start.headers).find((k) => k.name === loginCookieName(false));
      if (login === undefined) throw new Error(`login set no transaction cookie: ${start.headers.getSetCookie().join(" | ")}`);
      expect(cookieProblems(login, { name: loginCookieName(false), lifetimeS: LOGIN_LIFETIME_S, cloud: false })).toStrictEqual([]);

      const location = start.headers.get("location");
      if (location === null) throw new Error("login did not redirect");
      const callback = new URL(location, "http://localhost");
      const done = await app.request(`${callback.pathname}${callback.search}`, { headers: { cookie: `${login.name}=${login.value}` }, redirect: "manual" });
      expect([302, 303]).toContain(done.status);
      const cookies = setCookies(done.headers);
      const session = cookies.find((k) => k.name === sessionCookieName(false) && !clears(k));
      if (session === undefined) throw new Error(`callback set no session cookie: ${done.headers.getSetCookie().join(" | ")}`);
      expect(cookieProblems(session, { name: sessionCookieName(false), lifetimeS: SESSION_LIFETIME_S, cloud: false })).toStrictEqual([]);
      expect(cookies.some((k) => k.name === loginCookieName(false) && clears(k)), "the callback clears the transaction cookie").toBe(true);
    });
  });
}
