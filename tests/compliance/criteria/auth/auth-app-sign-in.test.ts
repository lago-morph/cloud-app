/**
 * AUTH-AC-013, and AUTH-AC-005's auth-app sign-in responses (docs/components/auth.md §4,
 * rewritten for v0.2.0 by DEC-0694; AUTH-REQ-002, -003, -005, -008, -010). Where: Local.
 * In-process, with `createTestApp` using the auth-app provider over the fake binding: the fake
 * auth app's `/start` redirect, its codes, and failures a test controls (testing.d.ts).
 *
 * Readings recorded here: "a fixed reason" is one `warn` entry `login failed: <reason>` (auth.md
 * §2 "Failed login"); the four refused codes share one reason, which differs from the state
 * mismatch's and the outage's, and no reason holds the code or the state. "No response contains
 * the email address" covers headers and bodies, and the decoded payload of every cookie set.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { disposeReference, openReference } from "../files/in-process.js";
import { isCurrentUserResponse } from "../../../support/http-schemas.js";
import { clears, setCookies } from "./support.js";
import { APP_ID, authWarnings, beginLogin, Browser, CALLBACK_URL, callback, CODE_LIFETIME_MS, expectUserId, FAKE_AUTH_APP_ORIGIN, PUBLIC_ORIGIN, SESSION, signInWithAuthApp, type Identity } from "./auth-app-support.js";

async function everything(res: Response): Promise<string> {
  const cookies = setCookies(res.headers).flatMap((k) => k.value.split(".").map((part) => Buffer.from(part, "base64url").toString("utf8")));
  return [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n") + (await res.clone().text()) + cookies.join("\n");
}

if (target().target === "local") {
  describe("AUTH sign-in through the auth app (in-process)", () => {
    afterEach(disposeReference);

    it(tag("AUTH-AC-013", "user ID derived from cf-account and the code's sub, the same on a second sign-in; display name null; no response or c.var.user holds the email"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const alice: Identity = { sub: "t1-ac013-sub", email: "t1-ac013-alice@example.com", role: "user" };
      const one = await signInWithAuthApp(app, alice);
      const me = await one.browser.json("/api/auth/me");
      expectUserId(me.id, "cf-account", alice.sub);
      expect(me).toStrictEqual({ level: "user", id: me.id, displayName: null });
      expect((await one.browser.json("/api/ref/me")).user).toStrictEqual({ level: "user", id: me.id, displayName: null });

      const two = await signInWithAuthApp(app, alice);
      expect((await two.browser.json("/api/auth/me")).id, "a second sign-in").toBe(me.id);
      for (const res of [...one.browser.seen, ...two.browser.seen]) expect(await everything(res), res.url).not.toContain(alice.email);
    });

    it(tag("AUTH-AC-013", "/api/auth/login redirects to the fake auth app's /start with the app ID, the callback URL on the public origin despite a forged Host, and a state"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const { start } = await beginLogin(new Browser(app), { headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
      expect(`${start.origin}${start.pathname}`).toBe(`${FAKE_AUTH_APP_ORIGIN}/start`);
      expect(start.searchParams.get("app")).toBe(APP_ID);
      expect(start.searchParams.get("return")).toBe(CALLBACK_URL);
      expect(start.searchParams.get("state") ?? "").not.toBe("");
    });

    describe("failed sign-ins create no session, redirect to /?authError=login_failed&requestId=<id> and log one fixed reason", () => {
      const alice: Identity = { sub: "t1-ac013-fail", email: "t1-ac013-fail@example.com", role: "admin" };
      type Case = { name: string; reason: "refused" | "state" | "outage"; run: (app: Awaited<ReturnType<typeof openReference>>, b: Browser) => Promise<{ res: Response; secrets: string[] }> };
      const issue = (app: Awaited<ReturnType<typeof openReference>>, begun: Awaited<ReturnType<typeof beginLogin>>, appId = APP_ID) =>
        app.authApp.issueCode(alice, { app: appId, returnUrl: begun.start.searchParams.get("return") ?? "" });
      const state = (begun: Awaited<ReturnType<typeof beginLogin>>) => begun.start.searchParams.get("state") ?? "";
      const cases: Case[] = [
        { name: "unknown code", reason: "refused", run: async (_app, b) => { const begun = await beginLogin(b); const code = Buffer.alloc(32, 7).toString("base64url"); return { res: await callback(b, begun, { code, state: state(begun) }), secrets: [code, state(begun)] }; } },
        { name: "used code", reason: "refused", run: async (app, b) => {
          const first = await beginLogin(b);
          const code = issue(app, first);
          expect((await callback(new Browser(app), first, { code, state: state(first) })).headers.get("location"), "first use").not.toMatch(/authError/);
          const again = await beginLogin(b);
          return { res: await callback(b, again, { code, state: state(again) }), secrets: [code, state(again)] };
        } },
        { name: "expired code", reason: "refused", run: async (app, b) => { const begun = await beginLogin(b); const code = issue(app, begun); app.clock.advance(CODE_LIFETIME_MS + 1); return { res: await callback(b, begun, { code, state: state(begun) }), secrets: [code, state(begun)] }; } },
        { name: "code issued to another app", reason: "refused", run: async (app, b) => { const begun = await beginLogin(b); const code = issue(app, begun, "other-app-local"); return { res: await callback(b, begun, { code, state: state(begun) }), secrets: [code, state(begun)] }; } },
        { name: "state mismatch", reason: "state", run: async (app, b) => { const begun = await beginLogin(b); const code = issue(app, begun); return { res: await callback(b, begun, { code, state: "t1-wrong-state" }), secrets: [code, state(begun)] }; } },
        { name: "binding cannot answer", reason: "outage", run: async (app, b) => { const begun = await beginLogin(b); const code = issue(app, begun); app.authApp.setUnavailable(true); return { res: await callback(b, begun, { code, state: state(begun) }), secrets: [code, state(begun)] }; } },
      ];
      const reasons = new Map<string, Set<string>>();

      for (const c of cases) {
        it(tag("AUTH-AC-013", `${c.name}: no session, redirect as specified, one log entry naming a fixed reason`), async () => {
          const app = await openReference({ authAppLoginProvider: true });
          const b = new Browser(app);
          const logs = app.logs().length;
          const { res, secrets } = await c.run(app, b);
          expect(res.status).toBe(302);
          const location = new URL(res.headers.get("location") ?? "", PUBLIC_ORIGIN);
          expect(`${location.origin}${location.pathname}`).toBe(`${PUBLIC_ORIGIN}/`);
          expect([...location.searchParams.keys()].sort()).toStrictEqual(["authError", "requestId"]);
          expect(location.searchParams.get("authError")).toBe("login_failed");
          expect(setCookies(res.headers).filter((k) => k.name === SESSION && !clears(k, app.clock.now())), "no session cookie").toEqual([]);
          app.authApp.setUnavailable(false);
          expect(await new Browser(app).json("/api/auth/me")).toStrictEqual({ level: "anonymous" });

          const failed = authWarnings(app, logs).filter((e) => e.message.startsWith("login failed: "));
          expect(failed, "one login-failed entry for the failing callback").toHaveLength(1);
          expect(failed[0]?.requestId, "the redirect's requestId is the request's").toBe(location.searchParams.get("requestId"));
          const reason = failed[0]!.message.slice("login failed: ".length);
          for (const secret of secrets) expect(reason).not.toContain(secret);
          expect(reason).toMatch({ refused: /code refused/, state: /state mismatch/, outage: /auth app/ }[c.reason]);
          reasons.set(c.reason, new Set([...(reasons.get(c.reason) ?? []), reason]));
        });
      }

      it(tag("AUTH-AC-013", "the reasons are fixed: one for every refused code, distinct from the state mismatch's and the outage's"), () => {
        expect(reasons.size, "every case above ran").toBe(3);
        for (const [kind, set] of reasons) expect([...set], kind).toHaveLength(1);
        expect(new Set([...reasons.values()].map((s) => [...s][0])).size).toBe(3);
      });
    });

    it(tag("AUTH-AC-005", "auth-app provider: login and callback are 302 as the contract says; /api/auth/me is a CurrentUser with no unlistedId at each level, Cache-Control no-store"), async () => {
      const app = await openReference({ authAppLoginProvider: true });
      const anon = await new Browser(app).get("/api/auth/me");
      expect(anon.headers.get("cache-control")).toBe("no-store");
      expect(isCurrentUserResponse(await anon.json())).toBe(true);
      for (const role of ["user", "admin"] as const) {
        const { browser, callback: done } = await signInWithAuthApp(app, { sub: `t1-ac005-${role}`, email: `t1-ac005-${role}@example.com`, role });
        expect(done.status).toBe(302);
        expect(new URL(done.headers.get("location") ?? "", PUBLIC_ORIGIN).pathname, "redirects to returnTo").toBe("/api/ref/me");
        const res = await browser.get("/api/auth/me");
        expect(res.headers.get("cache-control")).toBe("no-store");
        const body = await res.json();
        expect(isCurrentUserResponse(body), JSON.stringify(body)).toBe(true);
        expect(body).toMatchObject({ level: role });
        expect(body).not.toHaveProperty("unlistedId");
      }
    });
  });
}
