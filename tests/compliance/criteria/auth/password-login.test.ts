/**
 * AUTH-AC-013 (docs/components/auth.md §4; AUTH-REQ-002, -003, -008, -010 as amended): "With
 * `createTestApp` using `passwordLoginProvider`: after sign-up, verification through `app.mail`
 * and sign-in, the user ID equals the specified derivation from provider id `password` and the
 * provider's subject, a second sign-in yields the same ID, and the ID's presence in
 * `framework.admins` or `framework.users` decides the level as with the stub provider. A failed
 * sign-in creates no session, answers as the internal HTTP contract specifies, and writes one log
 * entry naming a fixed reason."
 *
 * In-process: the ID's form and stability, `framework.users` and `framework.admins` without the
 * ID, and the failed sign-ins. The provider's subject (the credential library's user ID) is not
 * visible in-process, and each `createTestApp` call is a fresh database, so the exact derivation
 * and the admin-list clause with the account's own ID run under a scratch `dev` of the reference
 * app: its local D1 database gives the subject, and a rebuild with the ID in `framework.admins`
 * keeps the account.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { startDev, scratchCopy } from "../core/support/processes.js";
import { errorResponseViolations, isLocal, REFERENCE_DIR } from "../core/support/repo.js";
import {
  createVerifiedAccount,
  deriveUserId,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  FAILED_LOGIN_REASONS,
  hasLink,
  httpBrowser,
  inProcessBrowser,
  localSubjectOf,
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
  expect(who.level, "a validated sign-in without lists is level user").toBe("user");
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

    it(tag("AUTH-AC-013", "framework.users without the ID makes the signed-in account anonymous with its ID as unlistedId; framework.admins without the ID leaves it user"), async () => {
      const outsider = deriveUserId("password", "auth-ac-013-someone-else");
      const listed = inProcessBrowser(await openPasswordApp({ config: { framework: { users: [outsider] } } }));
      const a = newAccount("auth-ac-013-users");
      const ip = testIp();
      await createVerifiedAccount(listed, a, ip);
      expectAnswer(await signIn(listed, a.email, a.password, { ip }), 200);
      const who = await me(listed);
      expect(who.level).toBe("anonymous");
      expect(who.unlistedId ?? "", "/api/auth/me shows the login's ID as unlistedId").toMatch(USER_ID);
      expectAnswer(await listed.get("/api/levels/user"), 401, "AUTH.UNAUTHENTICATED");

      const admins = inProcessBrowser(await openPasswordApp({ config: { framework: { admins: [outsider] } } }));
      const u = newAccount("auth-ac-013-admins");
      await createVerifiedAccount(admins, u, ip);
      expectAnswer(await signIn(admins, u.email, u.password, { ip }), 200);
      expect((await me(admins)).level).toBe("user");
      expectAnswer(await admins.get("/api/levels/admin"), 403, "AUTH.FORBIDDEN");
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

  describe("AUTH-AC-013 under a scratch dev (subject from the local D1 database)", () => {
    it(
      tag("AUTH-AC-013", "under dev: the ID equals the derivation from provider id password and the provider's subject, and with that ID in framework.admins the account is admin after the rebuild"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "auth-ac-013");
        try {
          const a = newAccount("auth-ac-013-dev");
          const ip = testIp();
          let id = "";
          const first = await startDev(copy.dir);
          try {
            const b = httpBrowser({ baseUrl: first.baseUrl, appDir: copy.dir });
            await createVerifiedAccount(b, a, ip);
            id = await signedInId(b, a, ip);
            const subject = localSubjectOf(a.email, copy.dir);
            expect(id.toUpperCase(), "u_ + base32(SHA-256(\"password:\" + subject))[0..26]").toBe(deriveUserId("password", subject).toUpperCase());
          } finally {
            await first.stop();
          }

          const values = JSON.parse(await copy.read("config/local.json")) as { framework?: Record<string, unknown> };
          await copy.write("config/local.json", JSON.stringify({ ...values, framework: { ...(values.framework ?? {}), admins: [id] } }, null, 2));
          const second = await startDev(copy.dir);
          try {
            const b = httpBrowser({ baseUrl: second.baseUrl, appDir: copy.dir });
            expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
            expect(await me(b), "with the ID in framework.admins").toMatchObject({ level: "admin", id });
            expectAnswer(await b.get("/api/levels/admin"), 200);
          } finally {
            await second.stop();
          }
        } finally {
          await copy.remove();
        }
      },
      900_000,
    );
  });
}
