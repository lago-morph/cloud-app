/**
 * PWD-AC-005 (docs/components/password.md §4, PWD-REQ-005): "Sign-up, forgot and resend for an
 * existing and an unknown address give byte-identical answers apart from the request ID, in both
 * the JSON and the 303 form; a wrong password and an unknown address give identical sign-in
 * answers. A sign-up for an existing address mails the 'someone tried to register' message. With
 * a mail sender that never completes, every response still arrives. No log entry or response of
 * the test run contains a test address."
 *
 * In-process. "Existing" is checked for a verified and for an unverified account. The answers
 * are compared on status, every header except the request ID (and the transport's `Date`), and
 * the body. App code's view (`/api/ref/me`, which returns `c.var.user`), `/api/auth/me` and the
 * session cookie are part of "responses" (SYS-REQ-017: no address reaches app code).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import {
  answerText,
  comparable,
  createVerifiedAccount,
  describeAnswer,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  found,
  hasLink,
  inProcessBrowser,
  logText,
  mailCountAfter,
  newAccount,
  openPasswordApp,
  resend,
  ROUTES,
  seeOther,
  sessionCookieNameFor,
  signIn,
  signUp,
  testAddress,
  testIp,
  testPassword,
  waitForMail,
  type Answer,
  type AuthBrowser,
} from "./support.js";

type Op = "sign-up" | "forgot" | "resend";

function send(b: AuthBrowser, op: Op, email: string, form: boolean, ip: string): Promise<Answer> {
  const o = { ip, form };
  if (op === "sign-up") return b.post(ROUTES.signUp, { email, password: "Same-password-for-both-1", displayName: "Same display name" }, o);
  if (op === "forgot") return forgot(b, email, o);
  return resend(b, email, o);
}

/** Text of every base64url segment of a cookie value, decoded, plus the raw value. */
function decodedCookie(value: string): string {
  const parts = value.split(/[.~|:]/);
  return [value, ...parts.map((p) => Buffer.from(p, "base64url").toString("latin1"))].join("\n");
}

if (isLocal()) {
  describe("PWD-AC-005 in-process", () => {
    afterEach(disposePasswordApps);

    it(
      tag("PWD-AC-005", "sign-up, forgot and resend answer byte-identically for an existing (verified or not) and an unknown address, in JSON and in the 303 form; a wrong password and an unknown address give identical sign-in answers"),
      async () => {
        const app = await openPasswordApp();
        const b = inProcessBrowser(app);
        const answers: Answer[] = [];
        const verified = newAccount("pwd-ac-005-verified");
        const unverified = newAccount("pwd-ac-005-unverified");
        await createVerifiedAccount(b, verified, testIp());
        expectResult(await signUp(b, unverified, { ip: testIp() }), "check-email");
        await waitForMail(b.mail, unverified.email, "verification", { accept: (m) => hasLink(m, "verify") });
        const unknowns: string[] = [];

        for (const op of ["sign-up", "forgot", "resend"] as const) {
          for (const form of [false, true]) {
            const ip = testIp(); // three requests per client, within PAR-259
            const unknown = testAddress("pwd-ac-005-unknown"); // fresh: a sign-up creates the account
            unknowns.push(unknown);
            const forUnknown = await send(b, op, unknown, form, ip);
            const forVerified = await send(b, op, verified.email, form, ip);
            const forUnverified = await send(b, op, unverified.email, form, ip);
            answers.push(forUnknown, forVerified, forUnverified);
            if (form) {
              const to = seeOther(forUnknown, b.publicOrigin);
              expect(to.pathname, describeAnswer(forUnknown)).toBe("/api/auth/sign-in");
              expect(to.searchParams.get("notice"), describeAnswer(forUnknown)).toBe("check_email");
            } else {
              expectResult(forUnknown, "check-email");
            }
            const what = `${op} (${form ? "303 form" : "JSON"})`;
            expect(comparable(forVerified), `${what}: existing verified address vs unknown address`).toStrictEqual(comparable(forUnknown));
            expect(comparable(forUnverified), `${what}: existing unverified address vs unknown address`).toStrictEqual(comparable(forUnknown));
          }
        }

        for (const form of [false, true]) {
          const ip = testIp();
          const wrongPassword = await signIn(b, verified.email, testPassword(20), { ip, form });
          const nobody = testAddress("pwd-ac-005-nobody");
          unknowns.push(nobody);
          const unknownAddress = await signIn(b, nobody, testPassword(20), { ip, form });
          answers.push(wrongPassword, unknownAddress);
          if (form) {
            const to = seeOther(unknownAddress, b.publicOrigin);
            expect(to.pathname).toBe("/api/auth/sign-in");
            expect(to.searchParams.get("error")).toBe("login_failed");
          } else {
            expectAnswer(unknownAddress, 400, "AUTH.LOGIN_FAILED");
          }
          expect(wrongPassword.setCookies, "a failed sign-in sets no cookie").toEqual([]);
          expect(comparable(wrongPassword), `sign-in (${form ? "303 form" : "JSON"}): wrong password vs unknown address`).toStrictEqual(comparable(unknownAddress));
        }

        const needles: Record<string, string> = { "verified test address": verified.email, "unverified test address": unverified.email };
        unknowns.forEach((u, i) => (needles[`unknown test address ${String(i + 1)}`] = u));
        expect(answers.flatMap((a) => found(answerText(a), needles).map((l) => `${describeAnswer(a)}: ${l}`)), "responses").toEqual([]);
        expect(logText(app.logs()).flatMap((line, i) => found(line, needles).map((l) => `log entry ${String(i)}: ${l}`)), "log entries").toEqual([]);
      },
      180_000,
    );

    it(tag("PWD-AC-005", "a sign-up for an existing address mails the \"someone tried to register\" message, not a verification link"), async () => {
      const b = inProcessBrowser(await openPasswordApp());
      const a = newAccount("pwd-ac-005-existing");
      await createVerifiedAccount(b, a, testIp());
      const before = (await b.mail.all(a.email)).length;
      expectResult(await signUp(b, { ...a, password: testPassword(22), displayName: "Someone else" }, { ip: testIp() }), "check-email");
      const notice = await waitForMail(b.mail, a.email, "\"someone tried to register\"", { after: before });
      expect(hasLink(notice, "verify"), `"${notice.subject}" carries no verification link`).toBe(false);
      expect(await mailCountAfter(b.mail, a.email), "exactly one message").toBe(before + 1);
    });

    it(tag("PWD-AC-005", "with a mail sender that never completes, sign-up, forgot and resend still answer"), async () => {
      const b = inProcessBrowser(await openPasswordApp({ mailSender: "never-completing" }));
      const a = newAccount("pwd-ac-005-stuck");
      const ip = testIp();
      const within = async (what: string, p: Promise<Answer>): Promise<Answer> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what}: no response within 15 s while the mail send never completes`)), 15_000)));
        try {
          return await Promise.race([p, timeout]);
        } finally {
          clearTimeout(timer);
        }
      };
      expectResult(await within("sign-up", signUp(b, a, { ip })), "check-email");
      expectResult(await within("sign-up of the existing address", signUp(b, a, { ip })), "check-email");
      expectResult(await within("forgot", forgot(b, a.email, { ip })), "check-email");
      expectResult(await within("resend", resend(b, a.email, { ip })), "check-email");
    });

    it(
      tag("PWD-AC-005", "no address reaches app code, /api/auth/me, the session cookie or a log entry after a sign-in"),
      async () => {
        const app = await openPasswordApp();
        const b = inProcessBrowser(app);
        const a = newAccount("pwd-ac-005-app-view");
        const ip = testIp();
        await createVerifiedAccount(b, a, ip);
        const signedIn = expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
        const appView = expectAnswer(await b.get("/api/ref/me"), 200);
        const user = appView.json<{ user?: Record<string, unknown> }>().user ?? {};
        expect(Object.keys(user).sort(), "c.var.user carries only level, id and displayName").toStrictEqual(["displayName", "id", "level"]);
        expect(user["level"]).toBe("user");
        const authMe = expectAnswer(await b.get("/api/auth/me"), 200);

        const session = b.cookies()[sessionCookieNameFor(b)] ?? "";
        expect(session, "the session cookie").not.toBe("");
        const needles = { "test address": a.email, "address local part": a.email.split("@")[0] ?? a.email };
        expect(found(answerText(signedIn), needles), "sign-in response").toEqual([]);
        expect(found(answerText(appView), needles), "app code's view of the user").toEqual([]);
        expect(found(answerText(authMe), needles), "/api/auth/me").toEqual([]);
        expect(found(decodedCookie(session), needles), "the session cookie, decoded").toEqual([]);
        expect(logText(app.logs()).flatMap((line, i) => found(line, needles).map((l) => `log entry ${String(i)}: ${l}`)), "log entries").toEqual([]);
      },
      120_000,
    );
  });
}
