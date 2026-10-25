/**
 * PWD-AC-001, PWD-AC-003, PWD-AC-004 (docs/components/password.md §4): sign-up, verification,
 * sign-in, the framework session only, and password reset, through the documented routes and
 * JSON answers of docs/contracts/http/internal/auth-password.openapi.yaml, with no browser.
 *
 * In-process: the reference app with `createTestApp(…, { passwordLoginProvider: true })` and its
 * outbox (`TestApp.mail`); the clock is moved with fake `Date` for the link validity clauses.
 * Under `dev` (local target): the same flow over HTTP, reading the mail from the reference app's
 * `.mail/` (MAIL §2), and the credential library's tables read from the local D1 database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import {
  createVerifiedAccount,
  describeAnswer,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  hasLink,
  httpBrowser,
  inProcessBrowser,
  linkToken,
  localRows,
  localSubjectOf,
  mailCountAfter,
  me,
  newAccount,
  openPasswordApp,
  par,
  resend,
  reset,
  rowsWith,
  sessionCookieNameFor,
  signIn,
  signUp,
  testIp,
  testPassword,
  USER_ID,
  verify,
  waitForMail,
  type AuthBrowser,
} from "./support.js";

/** Paths of the credential library itself (better-auth's endpoints under the bridge's basePath). */
const LIBRARY_PATHS = [
  "/api/auth/password/sign-in/email",
  "/api/auth/password/sign-up/email",
  "/api/auth/password/request-password-reset",
  "/api/auth/password/send-verification-email",
  "/api/auth/password/verify-email",
  "/api/auth/password/reset-password",
  "/api/auth/password/get-session",
  "/api/auth/password/list-sessions",
  "/api/auth/password/sign-out",
  "/api/auth/password/ok",
];

async function expectSignedIn(b: AuthBrowser, email: string, password: string, ip: string): Promise<void> {
  const r = await signIn(b, email, password, { ip });
  expectAnswer(r, 200);
  const body = r.json<{ result?: unknown; returnTo?: unknown }>();
  expect(body.result, describeAnswer(r)).toBe("signed-in");
  expect(typeof body.returnTo, describeAnswer(r)).toBe("string");
}

if (isLocal()) {
  describe("PWD in-process (createTestApp with passwordLoginProvider)", () => {
    afterEach(async () => {
      vi.useRealTimers();
      await disposePasswordApps();
    });

    it(
      tag("PWD-AC-001", "sign-up answers check-email; sign-in before verification is 403 AUTH.NOT_VERIFIED and mails nothing; resend mails one link; verify sets no cookie; sign-in then shows level user with the entered display name"),
      async () => {
        const b = inProcessBrowser(await openPasswordApp());
        const a = newAccount("pwd-ac-001");
        const ip = testIp();

        expectResult(await signUp(b, a, { ip }), "check-email");
        await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
        const afterSignUp = (await b.mail.all(a.email)).length;

        const refused = await signIn(b, a.email, a.password, { ip });
        expectAnswer(refused, 403, "AUTH.NOT_VERIFIED");
        expect(refused.setCookies, "a refused sign-in sets no cookie").toEqual([]);
        expect(await mailCountAfter(b.mail, a.email), "a refused sign-in adds no mail to the outbox").toBe(afterSignUp);

        expectResult(await resend(b, a.email, { ip }), "check-email");
        const fresh = await waitForMail(b.mail, a.email, "new verification", { after: afterSignUp, accept: (m) => hasLink(m, "verify") });
        expect(await mailCountAfter(b.mail, a.email), "resend adds exactly one mail").toBe(afterSignUp + 1);

        const verified = await verify(b, linkToken(fresh, "verify", b.publicOrigin), { ip });
        expectResult(verified, "verified");
        expect(verified.setCookies, "verification sets no cookie").toEqual([]);
        expect(await me(b), "verification creates no session").toStrictEqual({ level: "anonymous" });

        await expectSignedIn(b, a.email, a.password, ip);
        const who = await me(b);
        expect(who.level).toBe("user");
        expect(who.displayName, "the display name is the one entered at sign-up").toBe(a.displayName);
        expect(who.id ?? "").toMatch(USER_ID);
      },
      120_000,
    );

    it(
      tag("PWD-AC-003", "a successful sign-in sets only the framework session cookie, and the credential library's own paths answer 404 HTTP.NOT_FOUND"),
      async () => {
        const b = inProcessBrowser(await openPasswordApp());
        const a = newAccount("pwd-ac-003");
        const ip = testIp();
        await createVerifiedAccount(b, a, ip);

        const r = await signIn(b, a.email, a.password, { ip });
        expectAnswer(r, 200);
        const names = r.setCookies.map((c) => c.split("=")[0]?.trim() ?? "");
        expect(names, `Set-Cookie: ${r.setCookies.join(" | ")}`).toStrictEqual([sessionCookieNameFor(b)]);
        expect(r.setCookies.join("\n").toLowerCase(), "no cookie of the credential library").not.toContain("better-auth");

        for (const path of LIBRARY_PATHS) {
          expectAnswer(await b.get(path, { ip }), 404, "HTTP.NOT_FOUND");
          expectAnswer(await b.post(path, { email: a.email, password: a.password }, { ip }), 404, "HTTP.NOT_FOUND");
        }
      },
      120_000,
    );

    it(
      tag("PWD-AC-004", "forgot, the mailed link and reset work; the token used again is 400 AUTH.LOGIN_FAILED; the old password then fails and the new one works"),
      async () => {
        const b = inProcessBrowser(await openPasswordApp());
        const a = newAccount("pwd-ac-004");
        const ip = testIp();
        await createVerifiedAccount(b, a, ip);

        expectResult(await forgot(b, a.email, { ip }), "check-email");
        const mail = await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") });
        const token = linkToken(mail, "reset", b.publicOrigin);
        const newPassword = testPassword(24);

        const done = await reset(b, token, newPassword, { ip });
        expectResult(done, "password-reset");
        expect(done.setCookies, "a reset creates no session").toEqual([]);
        expectAnswer(await reset(b, token, testPassword(24), { ip }), 400, "AUTH.LOGIN_FAILED");

        expectAnswer(await signIn(b, a.email, a.password, { ip }), 400, "AUTH.LOGIN_FAILED");
        await expectSignedIn(b, a.email, newPassword, ip);
      },
      120_000,
    );

    it(
      tag("PWD-AC-004", "with the clock moved past PAR-257 a reset token is refused, and past PAR-256 a verification token is refused"),
      async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = Date.parse("2026-06-01T12:00:00Z");
        vi.setSystemTime(start);
        const b = inProcessBrowser(await openPasswordApp());
        const ip = testIp();

        // Reset link: valid for PAR-257.
        const a = newAccount("pwd-ac-004-reset-expiry");
        await createVerifiedAccount(b, a, ip);
        expectResult(await forgot(b, a.email, { ip }), "check-email");
        const resetMail = await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") });
        const resetToken = linkToken(resetMail, "reset", b.publicOrigin);
        vi.setSystemTime(start + par.resetValidityMs() + 5 * 60_000);
        expectAnswer(await reset(b, resetToken, testPassword(24), { ip }), 400, "AUTH.LOGIN_FAILED");
        await expectSignedIn(b, a.email, a.password, ip);

        // Verification link: valid for PAR-256.
        const t0 = Date.now();
        const u = newAccount("pwd-ac-004-verify-expiry");
        const ip2 = testIp();
        expectResult(await signUp(b, u, { ip: ip2 }), "check-email");
        const verifyMail = await waitForMail(b.mail, u.email, "verification", { accept: (m) => hasLink(m, "verify") });
        const verifyToken = linkToken(verifyMail, "verify", b.publicOrigin);
        vi.setSystemTime(t0 + par.verificationValidityMs() + 5 * 60_000);
        expectAnswer(await verify(b, verifyToken, { ip: ip2 }), 400, "AUTH.LOGIN_FAILED");
        expectAnswer(await signIn(b, u.email, u.password, { ip: ip2 }), 403, "AUTH.NOT_VERIFIED");
      },
      120_000,
    );
  });

  describe("PWD under dev (HTTP, mail from .mail/)", () => {
    it(
      tag(["PWD-AC-001", "PWD-AC-004"], "under dev: sign-up, the mailed link's page, verify, sign-in, forgot, the mailed reset page and reset, over the documented routes and JSON answers"),
      async () => {
        const b = httpBrowser();
        const a = newAccount("pwd-dev-flow");
        const ip = testIp();

        expectResult(await signUp(b, a, { ip }), "check-email");
        const verifyMail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
        const verifyToken = linkToken(verifyMail, "verify", b.publicOrigin);

        // The link opens a page that changes nothing (AUTH-REQ-007: no state-changing GET).
        const page = await b.get(`/api/auth/verify?token=${encodeURIComponent(verifyToken)}`, { ip });
        expectAnswer(page, 200);
        expect(page.headers.get("content-type") ?? "").toMatch(/^text\/html/);
        expect(page.headers.get("cache-control") ?? "").toContain("no-store");
        expect(page.text.toLowerCase(), "the page never echoes the address").not.toContain(a.email.toLowerCase());
        expectAnswer(await signIn(b, a.email, a.password, { ip }), 403, "AUTH.NOT_VERIFIED");

        const verified = await verify(b, verifyToken, { ip });
        expectResult(verified, "verified");
        expect(verified.setCookies).toEqual([]);
        await expectSignedIn(b, a.email, a.password, ip);
        expect(await me(b)).toMatchObject({ level: "user", displayName: a.displayName });
        expectAnswer(await b.post("/api/auth/logout", {}, { ip }), 204);
        b.clearCookies();

        expectResult(await forgot(b, a.email, { ip }), "check-email");
        const resetMail = await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") });
        const resetToken = linkToken(resetMail, "reset", b.publicOrigin);
        const resetPage = await b.get(`/api/auth/reset?token=${encodeURIComponent(resetToken)}`, { ip });
        expectAnswer(resetPage, 200);
        expect(resetPage.headers.get("content-type") ?? "").toMatch(/^text\/html/);
        await expectSignedIn(b, a.email, a.password, ip);
        b.clearCookies();

        const newPassword = testPassword(30);
        const ip2 = testIp(); // the sign-ins after the reset count against a client of their own (PAR-258)
        expectResult(await reset(b, resetToken, newPassword, { ip: ip2 }), "password-reset");
        expectAnswer(await reset(b, resetToken, testPassword(30), { ip: ip2 }), 400, "AUTH.LOGIN_FAILED");
        expectAnswer(await signIn(b, a.email, a.password, { ip: ip2 }), 400, "AUTH.LOGIN_FAILED");
        await expectSignedIn(b, a.email, newPassword, ip2);
      },
      180_000,
    );

    it(
      tag("PWD-AC-003", "under dev: after a sign-in the credential library's session table holds no row for the account, and only the framework session cookie was set"),
      async () => {
        const b = httpBrowser();
        const a = newAccount("pwd-ac-003-dev");
        const ip = testIp();
        await createVerifiedAccount(b, a, ip);
        const r = await signIn(b, a.email, a.password, { ip });
        expectAnswer(r, 200);
        expect(r.setCookies.map((c) => c.split("=")[0]?.trim()), `Set-Cookie: ${r.setCookies.join(" | ")}`).toStrictEqual([sessionCookieNameFor(b)]);

        const subject = localSubjectOf(a.email);
        const sessions = localRows("__framework_auth_session");
        expect(rowsWith(sessions, subject), "__framework_auth_session rows of the account").toEqual([]);
        expect(rowsWith(sessions, ip), "__framework_auth_session rows from the test client").toEqual([]);
      },
      180_000,
    );
  });
}
