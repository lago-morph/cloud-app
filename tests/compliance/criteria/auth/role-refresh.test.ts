/**
 * AUTH-AC-003, AUTH-AC-012 and AUTH-AC-015 (docs/components/auth.md §4, rewritten for v0.2.0 by
 * DEC-0694; AUTH-REQ-003 as amended by DEC-0690). Where: Local. In-process, with `createTestApp`
 * using the auth-app provider over the fake binding (and the stub provider where AUTH-AC-003 says
 * "the same holds"). Date is frozen, so the only clock that moves is `TestApp.clock`.
 *
 * Readings recorded here: "has passed" means more than PAR-425 (300 s exactly is still inside);
 * "the retry delay elapses before each retry" is shown by the clock moving exactly one delay for
 * one retry and two delays for two; "a session cookie in the format before v0.2.0" is the current
 * payload re-signed with version 1 or 2 and without the v0.2.0 fields `rol`/`rat` (no real 0.1.x
 * cookie is at hand), so it shows the version gate, not every older layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tag, target } from "../../harness/index.js";
import { disposeReference, openReference } from "../files/in-process.js";
import { signToken } from "../../../../packages/framework/src/auth/signing.js";
import { tamper, SESSION_LIFETIME_S } from "./support.js";
import { authWarnings, Browser, errorCode, expectUserId, expiryOf, REFRESH_MS, RETRIES, RETRY_DELAY_MS, SESSION, signInWithAuthApp, signInWithStub } from "./auth-app-support.js";

const KEY = "t1-criteria-session-key-0123456789abcdef";
const decode = (value: string): Record<string, unknown> => JSON.parse(Buffer.from(value.split(".")[0] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;

if (target().target === "local") {
  describe("AUTH role refresh (in-process)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse("2026-06-01T12:00:00Z"));
    });
    afterEach(async () => {
      vi.useRealTimers();
      await disposeReference();
    });

    it(tag("AUTH-AC-003", "auth-app provider: user until PAR-425 has passed, then admin with requireAdmin passing and the cookie's expiry kept; back to user after the next interval, requireAdmin 403"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const sub = "t1-ac003-sub";
      const { browser, session } = await signInWithAuthApp(app, { sub, email: "t1-ac003@example.com", role: "user" });
      const expiry = expiryOf(session, app.clock.now());
      const me = await browser.json("/api/auth/me");
      expect(me.level).toBe("user");
      expectUserId(me.id, "cf-account", sub);
      expect((await browser.json("/api/ref/me")).user).toMatchObject({ level: "user", id: me.id });

      app.authApp.setRole(sub, "admin");
      app.clock.advance(REFRESH_MS);
      expect((await browser.json("/api/auth/me")).level, "inside the interval").toBe("user");
      expect(((await browser.json("/api/ref/me")).user as { level: string }).level).toBe("user");

      app.clock.advance(1000);
      const first = await browser.get("/api/levels/admin");
      expect(first.status, "first request after the interval passes requireAdmin").toBe(200);
      expect(await first.json()).toStrictEqual({ level: "admin", id: me.id });
      const reissued = browser.sessionCookies(first);
      expect(reissued).toHaveLength(1);
      expect(expiryOf(reissued[0]!, app.clock.now()), "the re-issued cookie keeps the original expiry").toBe(expiry);
      expect((await browser.json("/api/auth/me")).level).toBe("admin");

      app.authApp.setRole(sub, "user");
      app.clock.advance(REFRESH_MS + 1000);
      const back = await browser.get("/api/levels/admin");
      expect(back.status).toBe(403);
      expect(await errorCode(back)).toBe("AUTH.FORBIDDEN");
      expect((await browser.json("/api/auth/me")).level).toBe("user");
    });

    it(tag("AUTH-AC-003", "the same holds with stubLoginProvider, loginWithStub, grantRole and revokeRole (levels on /api/auth/me and the c.var.user route; the re-issued cookie keeps its expiry)"), async () => {
      const app = await openReference({ stubLoginProvider: true });
      // Through the testing interface itself: loginWithStub keeps the session for app.request.
      const level = async (path: string): Promise<string> => {
        const body = (await (await app.request(path)).json()) as { level?: string; user?: { level: string } };
        return body.user?.level ?? body.level ?? "";
      };
      await app.loginWithStub("t1-ac003-kept");
      const kept = (await (await app.request("/api/auth/me")).json()) as { level: string; id: string };
      expect(kept.level).toBe("user");
      await app.grantRole(kept.id, "admin");
      app.clock.advance(REFRESH_MS);
      expect(await level("/api/ref/me"), "inside the interval").toBe("user");
      app.clock.advance(1000);
      expect((await app.request("/api/levels/admin")).status).toBe(200);
      expect(await level("/api/auth/me")).toBe("admin");
      await app.revokeRole(kept.id, "admin");
      app.clock.advance(REFRESH_MS + 1000);
      expect((await app.request("/api/levels/admin")).status).toBe(403);
      expect(await level("/api/ref/me")).toBe("user");

      // The same flow driven by hand, so the re-issued Set-Cookie's expiry is visible.
      const { browser, session } = await signInWithStub(app, "t1-ac003-stub");
      const expiry = expiryOf(session, app.clock.now());
      const me = await browser.json("/api/auth/me");
      expect(me.level).toBe("user");
      expectUserId(me.id, "stub", "t1-ac003-stub");
      expect((await browser.json("/api/ref/me")).user).toMatchObject({ level: "user", id: me.id });

      await app.grantRole(String(me.id), "admin");
      app.clock.advance(REFRESH_MS);
      expect((await browser.json("/api/auth/me")).level).toBe("user");
      app.clock.advance(1000);
      const first = await browser.get("/api/levels/admin");
      expect(first.status).toBe(200);
      expect(expiryOf(browser.sessionCookies(first)[0]!, app.clock.now())).toBe(expiry);
      expect((await browser.json("/api/auth/me")).level).toBe("admin");

      await app.revokeRole(String(me.id), "admin");
      app.clock.advance(REFRESH_MS + 1000);
      const back = await browser.get("/api/levels/admin");
      expect(back.status).toBe(403);
      expect(await errorCode(back)).toBe("AUTH.FORBIDDEN");
      expect((await browser.json("/api/auth/me")).level).toBe("user");
    });

    it(tag("AUTH-AC-012", "a binding that fails once (or twice) is retried within the request and shows admin; one retry delay before each retry"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const { browser } = await signInWithAuthApp(app, { sub: "t1-ac012-retry", email: "t1-ac012@example.com", role: "admin" });
      for (const failures of [1, 2]) {
        app.clock.advance(REFRESH_MS + 1000);
        app.authApp.failNext(failures);
        const calls = app.authApp.calls.role;
        const before = app.clock.now();
        const res = await browser.get("/api/levels/admin");
        expect(res.status, `${failures} failure(s)`).toBe(200);
        expect(app.authApp.calls.role - calls).toBe(failures + 1);
        expect(app.clock.now() - before).toBe(failures * RETRY_DELAY_MS);
      }
      expect(authWarnings(app, 0).filter((e) => e.message.startsWith("role refresh failed"))).toEqual([]);
    });

    it(tag("AUTH-AC-012", "every try fails: 1 + PAR-426 calls, PAR-427 before each retry, cookie cleared, requireUser 401, /api/auth/me anonymous, one warn 'role refresh failed (<code>)'"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const sub = "t1-ac012-down";
      const { browser } = await signInWithAuthApp(app, { sub, email: "t1-ac012-down@example.com", role: "admin" });
      const stale = browser.session ?? "";
      app.clock.advance(REFRESH_MS + 1000);
      app.authApp.setUnavailable(true);
      const calls = app.authApp.calls.role;
      const logs = app.logs().length;
      const before = app.clock.now();
      const res = await browser.get("/api/levels/user");
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
      expect(app.authApp.calls.role - calls).toBe(1 + RETRIES);
      expect(app.clock.now() - before).toBe(RETRIES * RETRY_DELAY_MS);
      expect(browser.session, "the session cookie is cleared").toBeUndefined();
      const warnings = authWarnings(app, logs);
      expect(warnings.map((e) => e.message)).toHaveLength(1);
      expect(warnings[0]?.message).toMatch(/^role refresh failed \([A-Za-z0-9_.]+\)/);
      expect(warnings[0]?.message).not.toContain(sub);
      expect(await browser.json("/api/auth/me"), "after the cookie was cleared").toStrictEqual({ level: "anonymous" });
      // The pre-failure cookie replayed while the auth app is still down: anonymous, never the old admin role.
      const replay = await new Browser(app).get("/api/auth/me", { headers: { cookie: stale } });
      expect(await replay.json(), "the replayed pre-failure cookie").toStrictEqual({ level: "anonymous" });
    });

    it(tag("AUTH-AC-012", "no record for the sub: the session ends at the first refresh with one call and no retry"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const sub = "t1-ac012-gone";
      const { browser } = await signInWithAuthApp(app, { sub, email: "t1-ac012-gone@example.com", role: "admin" });
      app.authApp.setRole(sub, null);
      app.clock.advance(REFRESH_MS + 1000);
      const calls = app.authApp.calls.role;
      const before = app.clock.now();
      expect(await browser.json("/api/auth/me")).toStrictEqual({ level: "anonymous" });
      expect(app.authApp.calls.role - calls).toBe(1);
      expect(app.clock.now() - before, "no retry delay").toBe(0);
      expect(browser.session).toBeUndefined();
    });

    it(tag("AUTH-AC-012", "the stub's account marked unverified ends the session at the first refresh"), (ctx) => {
      // DEC-0749: createTestApp's stub keeps every account verified and testing.d.ts has no way to mark one unverified.
      ctx.skip("not testable through createTestApp: the stub provider has no way to mark an account unverified (testing.d.ts); open item for B (DEC-0749)");
    });

    it(tag("AUTH-AC-012", "a session cookie in the format before v0.2.0 (versions 1 and 2), or with provider password, is anonymous"), async () => {
      const app = await openReference({ authAppLoginProvider: true, secrets: { frameworkSessionKey: KEY } });
      const { browser, session } = await signInWithAuthApp(app, { sub: "t1-ac012-format", email: "t1-ac012-format@example.com", role: "user" });
      const payload = decode(session.value);
      const as = async (p: Record<string, unknown>) => new Browser(app).get("/api/auth/me", { headers: { cookie: `${SESSION}=${await signToken(KEY, "session", p)}` } });
      // Self-check of the fixture: the same payload re-signed with the stage's key is the user's session.
      expect(await (await as(payload)).json()).toMatchObject({ level: "user" });
      const { rol: _rol, rat: _rat, ...older } = payload;
      for (const variant of [{ ...older, v: 1 }, { ...older, v: 2 }, { ...payload, prv: "password" }]) {
        expect(await (await as(variant)).json(), JSON.stringify(variant)).toStrictEqual({ level: "anonymous" });
      }
      expect((await browser.json("/api/auth/me")).level).toBe("user");
    });

    it(tag("AUTH-AC-015", "no call for no cookie, a tampered or expired cookie, or a mock session; none inside the interval; exactly one after it, even on a route reading c.var.user several times; none on the next request"), async () => {
      const mockApp = await openReference({ secrets: { frameworkSessionKey: KEY } });
      const minted = await new Browser(mockApp).get("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "admin", id: "t1-ac015-mock" }) });
      expect(minted.status).toBe(204);
      const mock = new Browser(mockApp).sessionCookies(minted)[0];
      if (mock === undefined) throw new Error("mock-login set no session cookie");

      const app = await openReference({ authAppLoginProvider: true, secrets: { frameworkSessionKey: KEY } });
      const { browser, session } = await signInWithAuthApp(app, { sub: "t1-ac015", email: "t1-ac015@example.com", role: "user" });
      const calls = () => app.authApp.calls.role;
      expect(calls()).toBe(0);
      app.clock.advance(REFRESH_MS);
      expect((await browser.json("/api/levels/user")).level).toBe("user");
      expect(calls(), "a valid session inside the interval").toBe(0);

      app.clock.advance(1000);
      const anon = (cookie?: string) => new Browser(app).get("/api/ref/me", cookie === undefined ? {} : { headers: { cookie } });
      for (const [what, cookie] of [["no cookie", undefined], ["tampered", `${SESSION}=${tamper(session.value, -3)}`], ["mock session", `${SESSION}=${mock.value}`]] as const) {
        expect(await (await anon(cookie)).json(), what).toStrictEqual({ user: { level: "anonymous" } });
        expect(calls(), what).toBe(0);
      }
      // /api/levels/user reads c.var.user in requireUser() and twice in its handler (apps/reference/src/server/routes/levels.ts).
      const first = await browser.get("/api/levels/user");
      expect(first.status).toBe(200);
      expect(calls(), "the first request after the interval, on a route reading c.var.user several times").toBe(1);
      expect((await browser.json("/api/ref/me")).user).toMatchObject({ level: "user" });
      expect(calls(), "the next request").toBe(1);

      const stale = browser.session ?? "";
      app.clock.advance(SESSION_LIFETIME_S * 1000 + 1000);
      expect(await (await anon(stale)).json(), "expired").toStrictEqual({ user: { level: "anonymous" } });
      expect(calls(), "an expired cookie").toBe(1);
    });
  });
}
