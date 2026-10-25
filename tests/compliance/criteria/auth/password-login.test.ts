/**
 * AUTH-AC-013 (docs/components/auth.md §4; AUTH-REQ-002, -003, -008, -010 as amended): "With
 * `createTestApp` using `passwordLoginProvider`: after sign-up, verification through `app.mail`
 * and sign-in, the user ID equals the specified derivation from provider id `password` and the
 * provider's subject, a second sign-in yields the same ID, and the account's role decides the
 * level as in AUTH-AC-003. A failed sign-in creates no session, answers as the internal HTTP
 * contract specifies, and writes one log entry naming a fixed reason."
 *
 * Here, in-process: the ID's form and stability, and the failed sign-ins. The exact derivation
 * (the subject read from the test app's `__framework_auth_user`) and the role deciding the level
 * (`grantRole`, `revokeRole`) run on both dialects in the levels suite (roles.suite.ts, through
 * roles.d1.test.ts and roles.pglite.test.ts). There is no admin or users list any more
 * (DEC-0521, DEC-0522), so no clause here edits configuration.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { errorResponseViolations, isLocal } from "../core/support/repo.js";
import {
  createVerifiedAccount,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  FAILED_LOGIN_REASONS,
  hasLink,
  inProcessBrowser,
  me,
  newAccount,
  openPasswordApp,
  seeOther,
  signIn,
  signUp,
  testIp,
  testPassword,
  USER_ID,
  waitForMail,
  type Account,
  type AuthBrowser,
  type PasswordTestApp,
} from "../pwd/support.js";

async function signedInId(b: AuthBrowser, a: Account, ip: string): Promise<string> {
  b.clearCookies();
  expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
  const who = await me(b);
  expect(who.level, "a verified account with no role is level user").toBe("user");
  expect(who.id ?? "", "the user ID's form (auth.md §2)").toMatch(USER_ID);
  return who.id ?? "";
}

/** The log entries of one request that report a failed login. */
function failedLoginEntries(app: PasswordTestApp, requestId: string | undefined): ReturnType<PasswordTestApp["logs"]> {
  return app.logs().filter((e) => e.requestId === requestId && e.message.startsWith("login failed"));
}

if (isLocal()) {
  describe("AUTH-AC-013 in-process (createTestApp with passwordLoginProvider)", () => {
    afterEach(disposePasswordApps);

    it(tag("AUTH-AC-013", "after sign-up, verification through app.mail and sign-in the ID has the derived form, a second sign-in yields the same ID, and another account another ID"), async () => {
      const b = inProcessBrowser(await openPasswordApp());
      const ip = testIp();
      const a = newAccount("auth-ac-013-a");
      const other = newAccount("auth-ac-013-b");
      await createVerifiedAccount(b, a, ip);
      await createVerifiedAccount(b, other, ip);
      const first = await signedInId(b, a, ip);
      const second = await signedInId(b, a, ip);
      expect(second, "a second sign-in yields the same ID").toBe(first);
      expect(await signedInId(b, other, ip), "another account has another ID").not.toBe(first);
      expect(first.toLowerCase(), "the ID is opaque").not.toContain(a.email.split("@")[0]?.toLowerCase() ?? "");
    });

    it(tag("AUTH-AC-013", "a failed sign-in creates no session, answers as the internal HTTP contract specifies, and writes one log entry naming a fixed reason"), async () => {
      const app = await openPasswordApp();
      const b = inProcessBrowser(app);
      const ip = testIp();
      const a = newAccount("auth-ac-013-failed");
      await createVerifiedAccount(b, a, ip);
      const pending = newAccount("auth-ac-013-unverified");
      expectResult(await signUp(b, pending, { ip }), "check-email");
      await waitForMail(b.mail, pending.email, "verification", { accept: (m) => hasLink(m, "verify") });

      const cases = [
        { what: "wrong password", send: () => signIn(b, a.email, testPassword(20), { ip }), status: 400, code: "AUTH.LOGIN_FAILED", reason: "login failed: wrong credentials" },
        { what: "unknown address", send: () => signIn(b, newAccount("auth-ac-013-nobody").email, testPassword(20), { ip }), status: 400, code: "AUTH.LOGIN_FAILED", reason: "login failed: wrong credentials" },
        { what: "unverified account", send: () => signIn(b, pending.email, pending.password, { ip }), status: 403, code: "AUTH.NOT_VERIFIED", reason: "login failed: not verified" },
      ];
      for (const c of cases) {
        const r = await c.send();
        expectAnswer(r, c.status, c.code);
        expect(errorResponseViolations(r.json()), `${c.what}: the body is an ErrorResponse`).toEqual([]);
        expect(r.setCookies, `${c.what}: no cookie`).toEqual([]);
        expect(await me(b), `${c.what}: no session`).toStrictEqual({ level: "anonymous" });
        const entries = failedLoginEntries(app, r.requestId);
        expect(entries.length, `${c.what}: one failed-login entry for request ${r.requestId ?? "?"} (${JSON.stringify(app.logs().filter((e) => e.requestId === r.requestId))})`).toBe(1);
        const entry = entries[0];
        expect(entry?.component).toBe("AUTH");
        expect(entry?.severity).toBe("warn");
        expect(FAILED_LOGIN_REASONS.some((re) => re.test(entry?.message ?? "")), `${c.what}: "${entry?.message ?? ""}" names a fixed reason`).toBe(true);
        expect(entry?.message).toBe(c.reason);
      }

      // The form answer: a redirect to the sign-in page with a generic message, and no cookie.
      const form = await signIn(b, a.email, testPassword(20), { ip, form: true });
      const to = seeOther(form, b.publicOrigin);
      expect(to.pathname).toBe("/api/auth/sign-in");
      expect(to.searchParams.get("error")).toBe("login_failed");
      expect(form.setCookies).toEqual([]);
      expect(await me(b)).toStrictEqual({ level: "anonymous" });
    });
  });
}
