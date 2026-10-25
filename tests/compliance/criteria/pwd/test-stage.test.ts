/**
 * The password provider and its mail on the run's Cloudflare test stage (plan-auth.md item T2),
 * through `connectTestStage()` (docs/contracts/ts/testing.d.ts), whose `TestApp.mail` reads the
 * stage's capture through `GET /api/__framework/test-mail?to=` (mail.md §2).
 *
 * - MAIL-AC-006, test-stage part (mail.md §4): "On a Cloudflare test stage, after a sign-up,
 *   `GET /api/__framework/test-mail?to=<address>` returns the verification message". The
 *   `prodcheck` part (the route answers 404) is in compl/prodcheck.test.ts.
 * - PWD-AC-008 (password.md §4): "On a Cloudflare test stage, sign-up, verification through the
 *   stage's test-mail route, sign-in and `/api/auth/me` work as in PWD-AC-001, and a sign-in burst
 *   gets 429 `AUTH.RATE_LIMITED`." PWD-AC-001's steps: sign-up answers `check-email`; sign-in
 *   before verification gets 403 `AUTH.NOT_VERIFIED` and adds no mail; resend adds one
 *   verification mail; posting the mailed token to verify sets no cookie; sign-in then succeeds and
 *   `/api/auth/me` shows level `user` with the entered display name. The flow goes on through
 *   forgot and reset (PWD-REQ-004) on the same account, as plan-auth.md §3 lists for test stages.
 *
 * The tests of this file share one account and run in order. One sign-up only: PAR-259 counts
 * per client IP, and on Cloudflare every request of this machine has the same one. For the same
 * reason the file holds the sign-in lock of `withStageSignIns` throughout, so its burst never
 * rate-limits another test's sign-ins on the stage. Written from the criteria and the contracts
 * (auth-password.openapi.yaml, testing.d.ts), not from the implementation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MailMessage, TestApp } from "../../../../docs/contracts/ts/testing.js";
import { tag, target } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { isLocal } from "../core/support/repo.js";
import { connectRunStage } from "./connect.js";
import {
  connectedBrowser,
  describeAnswer,
  expectAnswer,
  expectResult,
  forgot,
  hasLink,
  holdStageSignIns,
  latestMailKey,
  linkToken,
  me,
  newAccount,
  par,
  resend,
  reset,
  sessionCookieNameFor,
  signIn,
  signUp,
  testPassword,
  USER_ID,
  verify,
  waitForMail,
  type AuthBrowser,
} from "./support.js";

/** Cloud mail is written by the request's background task into the stage's D1: allow for it. */
const MAIL_WAIT_MS = 90_000;
const settle = (ms = 5_000): Promise<void> => new Promise((r) => setTimeout(r, ms));
const mailKey = (m: MailMessage): string => JSON.stringify([m.sentAt, m.subject, m.text]);

if (!isLocal()) {
  describe("PWD-AC-008 and MAIL-AC-006 on the run's Cloudflare test stage, through connectTestStage", () => {
    const a = newAccount("pwd-ac-008");
    let app: TestApp | undefined;
    let b: AuthBrowser | undefined;
    let release: (() => Promise<void>) | undefined;
    let verificationMail: MailMessage | undefined;
    let password = a.password;

    const browser = (): AuthBrowser => {
      if (b === undefined) throw new Error("connectTestStage() did not connect to the run's test stage (see the suite's beforeAll error)");
      return b;
    };

    beforeAll(async () => {
      requireCloudD1(target().target);
      release = await holdStageSignIns();
      app = await connectRunStage();
      b = connectedBrowser(app, target().baseUrl);
    }, 50 * 60_000);

    afterAll(async () => {
      try {
        await app?.dispose();
      } finally {
        await release?.();
      }
    }, 5 * 60_000);

    it(
      tag("MAIL-AC-006", "test-stage part: after a sign-up, GET /api/__framework/test-mail?to=<address> returns the verification message (TestApp.mail of connectTestStage, and the route itself)"),
      async () => {
        const br = browser();
        const none = await br.get(`/api/__framework/test-mail?to=${encodeURIComponent(a.email)}`);
        expectAnswer(none, 404, "HTTP.NOT_FOUND");
        expectResult(await signUp(br, a), "check-email");
        verificationMail = await waitForMail(br.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify"), timeoutMs: MAIL_WAIT_MS });
        expect(verificationMail.to.toLowerCase(), "the message is to the signed-up address").toContain(a.email.toLowerCase());
        expect(verificationMail.from, "from is `<sender name> <no-reply@…>` (MAIL §2)").toMatch(/<no-reply@[^>\s]+>$/);
        linkToken(verificationMail, "verify", br.publicOrigin);

        // The same message through the route directly, as the internal contract defines it.
        const raw = await br.get(`/api/__framework/test-mail?to=${encodeURIComponent(a.email)}`);
        expectAnswer(raw, 200);
        expect(raw.json<MailMessage>(), describeAnswer(raw)).toMatchObject({ to: verificationMail.to, subject: verificationMail.subject, text: verificationMail.text });
      },
      10 * 60_000,
    );

    it(
      tag("PWD-AC-008", "sign-in before verification is 403 AUTH.NOT_VERIFIED with no mail; resend mails a new link; verify through the test-mail route sets no cookie; sign-in then works and /api/auth/me shows user with the entered display name"),
      async () => {
        const br = browser();
        if (verificationMail === undefined) {
          expectResult(await signUp(br, a), "check-email");
          verificationMail = await waitForMail(br.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify"), timeoutMs: MAIL_WAIT_MS });
        }
        const before = await latestMailKey(br.mail, a.email);
        const refused = expectAnswer(await signIn(br, a.email, password), 403, "AUTH.NOT_VERIFIED");
        expect(refused.setCookies, "a refused sign-in sets no cookie").toEqual([]);
        await settle();
        expect(await latestMailKey(br.mail, a.email), "a refused sign-in sends no mail").toBe(before);

        expectResult(await resend(br, a.email), "check-email");
        const resent = await waitForMail(br.mail, a.email, "resent verification", { accept: (m) => hasLink(m, "verify") && mailKey(m) !== before, timeoutMs: MAIL_WAIT_MS });
        const verified = expectResult(await verify(br, linkToken(resent, "verify", br.publicOrigin)), "verified");
        expect(verified.setCookies, "verification creates no session").toEqual([]);
        expect(await me(br), "still anonymous after verification").toStrictEqual({ level: "anonymous" });

        const signedIn = expectAnswer(await signIn(br, a.email, password), 200);
        expect(signedIn.json<{ result?: string }>().result, describeAnswer(signedIn)).toBe("signed-in");
        const cookie = sessionCookieNameFor(br);
        expect(signedIn.setCookies.some((c) => c.startsWith(`${cookie}=`)), `the sign-in sets ${cookie}`).toBe(true);
        const who = await me(br);
        expect(who.level, "/api/auth/me after sign-in").toBe("user");
        expect(who.displayName, "the entered display name").toBe(a.displayName);
        expect(who.id ?? "", "an opaque user ID").toMatch(USER_ID);
      },
      10 * 60_000,
    );

    it(
      tag("PWD-AC-008", "forgot mails a reset link through the test-mail route; reset works; the old password then fails and the new one works"),
      async () => {
        const br = browser();
        expectAnswer(await br.post("/api/auth/logout", {}), 204);
        br.clearCookies();
        const before = await latestMailKey(br.mail, a.email);
        expectResult(await forgot(br, a.email), "check-email");
        const resetMail = await waitForMail(br.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") && mailKey(m) !== before, timeoutMs: MAIL_WAIT_MS });
        const next = testPassword(24);
        expectResult(await reset(br, linkToken(resetMail, "reset", br.publicOrigin), next), "password-reset");
        expectAnswer(await signIn(br, a.email, password), 400, "AUTH.LOGIN_FAILED");
        password = next;
        expectAnswer(await signIn(br, a.email, password), 200);
        expect((await me(br)).level).toBe("user");
      },
      10 * 60_000,
    );

    it(
      tag("PWD-AC-008", "a sign-in burst from one client gets 429 AUTH.RATE_LIMITED within PAR-258"),
      async () => {
        const br = browser();
        const limit = par.signIn();
        const answers: string[] = [];
        let limited = false;
        // The flow's own sign-ins count too (DEC-0519), so the limit may be reached sooner.
        for (let i = 0; i <= limit.max && !limited; i += 1) {
          const r = await signIn(br, a.email, `${password}-wrong`);
          answers.push(`${String(r.status)} ${r.code ?? ""}`);
          if (r.status === 429) {
            expectAnswer(r, 429, "AUTH.RATE_LIMITED");
            expect(r.setCookies, "a rate-limited sign-in sets no cookie").toEqual([]);
            limited = true;
          } else expectAnswer(r, 400, "AUTH.LOGIN_FAILED");
        }
        expect(limited, `${String(limit.max + 1)} sign-ins within ${String(limit.windowS)} s reach the limit (answers: ${answers.join(", ")})`).toBe(true);
        const correct = await signIn(br, a.email, password);
        expectAnswer(correct, 429, "AUTH.RATE_LIMITED");
      },
      5 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PWD-AC-008 and MAIL-AC-006 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
