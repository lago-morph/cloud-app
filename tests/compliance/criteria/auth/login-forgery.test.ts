/**
 * AUTH-AC-014 (docs/components/auth.md §4, AUTH-REQ-007 as amended by DEC-0516): "A POST without
 * any session to each of `/api/auth/password/sign-in`, `sign-up`, `resend`, `verify`, `forgot`
 * and `reset`, with `Origin` missing or naming another origin, gets 403 `AUTH.REQUEST_FORGERY`
 * and has no effect (no session, no mail, no account); with `Origin` equal to the public origin
 * it is accepted."
 *
 * Through the deployed router (`dev` locally, the test stage on a cloud) with `Origin` missing
 * and wrong, and in-process (whose requests always carry an `Origin`) with wrong ones. "No
 * effect" is observed through the documented routes only: a forged sign-up leaves sign-in at
 * `AUTH.LOGIN_FAILED` (no account; an unverified one answers `AUTH.NOT_VERIFIED`), a forged verify
 * leaves it at `AUTH.NOT_VERIFIED`, a forged reset leaves the old password working, a forged
 * sign-in leaves `/api/auth/me` anonymous, and forged sends add no mail.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import {
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  hasLink,
  httpBrowser,
  inProcessBrowser,
  latestMailKey,
  linkToken,
  me,
  newAccount,
  openPasswordApp,
  resend,
  reset,
  signIn,
  signUp,
  testIp,
  testPassword,
  verify,
  waitForMail,
  type Answer,
  type AuthBrowser,
  type SendOptions,
  withStageSignIns,
} from "../pwd/support.js";

function wrongOrigins(publicOrigin: string): string[] {
  const u = new URL(publicOrigin);
  return ["https://evil.example", "null", `${u.protocol}//${u.host}.evil.example`, `${u.protocol === "https:" ? "http:" : "https:"}//${u.host}`, `${publicOrigin}/`];
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 2_000));

async function loginForgeryFlow(b: AuthBrowser, forged: readonly (string | false)[]): Promise<void> {
  const a = newAccount("auth-ac-014");
  const ip = testIp();
  const refuse = async (what: string, send: (o: SendOptions) => Promise<Answer>): Promise<void> => {
    for (const origin of forged) {
      const r = await send({ ip, origin });
      expectAnswer(r, 403, "AUTH.REQUEST_FORGERY");
      expect(r.setCookies, `${what} with Origin ${String(origin)}: no cookie`).toEqual([]);
    }
  };
  const noNewMail = async (what: string, before: string): Promise<void> => {
    await settle();
    expect(await latestMailKey(b.mail, a.email), `${what}: no mail`).toBe(before);
  };

  // sign-up
  await refuse("sign-up", (o) => signUp(b, a, o));
  await noNewMail("forged sign-up", "");
  expectAnswer(await signIn(b, a.email, a.password, { ip }), 400, "AUTH.LOGIN_FAILED"); // no account
  expectResult(await signUp(b, a, { ip }), "check-email");
  const firstLink = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
  const token = linkToken(firstLink, "verify", b.publicOrigin);

  // resend
  const beforeResend = await latestMailKey(b.mail, a.email);
  await refuse("resend", (o) => resend(b, a.email, o));
  await noNewMail("forged resend", beforeResend);
  expectResult(await resend(b, a.email, { ip }), "check-email");
  await waitForMail(b.mail, a.email, "resent verification", { accept: (m) => hasLink(m, "verify") && JSON.stringify([m.sentAt, m.subject, m.text]) !== beforeResend });

  // verify
  await refuse("verify", (o) => verify(b, token, o));
  expectAnswer(await signIn(b, a.email, a.password, { ip }), 403, "AUTH.NOT_VERIFIED");
  expectResult(await verify(b, token, { ip }), "verified");

  // sign-in
  await refuse("sign-in", (o) => signIn(b, a.email, a.password, o));
  expect(await me(b), "a forged sign-in creates no session").toStrictEqual({ level: "anonymous" });
  expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
  expect((await me(b)).level).toBe("user");
  expectAnswer(await b.post("/api/auth/logout", {}, { ip }), 204);
  b.clearCookies();

  // forgot
  const beforeForgot = await latestMailKey(b.mail, a.email);
  await refuse("forgot", (o) => forgot(b, a.email, o));
  await noNewMail("forged forgot", beforeForgot);
  expectResult(await forgot(b, a.email, { ip }), "check-email");
  const resetMail = await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") });
  const resetToken = linkToken(resetMail, "reset", b.publicOrigin);

  // reset
  const newPassword = testPassword(24);
  await refuse("reset", (o) => reset(b, resetToken, newPassword, o));
  const ip2 = testIp(); // the remaining sign-ins count against a client of their own (PAR-258)
  expectAnswer(await signIn(b, a.email, a.password, { ip: ip2 }), 200); // the old password still works
  b.clearCookies();
  expectResult(await reset(b, resetToken, newPassword, { ip: ip2 }), "password-reset");
  expectAnswer(await signIn(b, a.email, newPassword, { ip: ip2 }), 200);
}

describe("AUTH-AC-014 through the deployed router", () => {
  it(
    tag("AUTH-AC-014", "through the deployed router: each password POST without a session and with Origin missing or wrong is 403 AUTH.REQUEST_FORGERY with no effect; with the public origin it is accepted"),
    async () => {
      const b = httpBrowser();
      // On a cloud stage its five sign-ins share this machine's client IP with the other tests' (withStageSignIns).
      await withStageSignIns(() => loginForgeryFlow(b, [false, ...wrongOrigins(b.publicOrigin)]));
    },
    // The lock may wait for another test's sign-ins and their PAR-258 window.
    target().target === "local" ? 300_000 : 45 * 60_000,
  );
});

if (target().target === "local") {
  describe("AUTH-AC-014 in-process", () => {
    afterEach(disposePasswordApps);

    it(
      tag("AUTH-AC-014", "in-process: each password POST without a session and with a wrong Origin is 403 AUTH.REQUEST_FORGERY with no effect; with the public origin it is accepted"),
      async () => {
        const b = inProcessBrowser(await openPasswordApp());
        await loginForgeryFlow(b, wrongOrigins(b.publicOrigin));
      },
      300_000,
    );
  });
}
