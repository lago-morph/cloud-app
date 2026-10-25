/**
 * SEC-AC-002, the password provider's clause (docs/components/secrets.md §4, amended with
 * DEC-0509): "locally, [the stored log entries] also contain no … test password, verification
 * token or reset token of the password provider."
 *
 * The test drives every path that handles those values — sign-up, a refused and a successful
 * sign-in, a wrong password, a bogus and a real verification, forgot, reset, and the used reset
 * token again — then scans the stored log entries: the reference app's `.logs/` under `dev`, and
 * the entries of an in-process reference app with `passwordLoginProvider`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import { storedEntries, waitForEntries } from "../core/support/stores.js";
import {
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  found,
  hasLink,
  httpBrowser,
  inProcessBrowser,
  linkToken,
  logText,
  newAccount,
  openPasswordApp,
  reset,
  signIn,
  signUp,
  testIp,
  testPassword,
  verify,
  waitForMail,
  type AuthBrowser,
} from "../pwd/support.js";

interface Exercised {
  readonly needles: Record<string, string>;
  /** Request IDs of refused requests, whose log entries are awaited before scanning. */
  readonly requestIds: string[];
}

async function exercise(b: AuthBrowser): Promise<Exercised> {
  const a = newAccount("sec-ac-002-pwd");
  const ip = testIp();
  const ip2 = testIp();
  const requestIds: string[] = [];
  const keepId = (id: string | undefined): void => {
    if (id !== undefined) requestIds.push(id);
  };
  expectResult(await signUp(b, a, { ip }), "check-email");
  const verifyMail = await waitForMail(b.mail, a.email, "verification", { accept: (m) => hasLink(m, "verify") });
  const verifyToken = linkToken(verifyMail, "verify", b.publicOrigin);
  keepId(expectAnswer(await signIn(b, a.email, a.password, { ip }), 403, "AUTH.NOT_VERIFIED").requestId);
  keepId(expectAnswer(await verify(b, `${verifyToken}x`, { ip }), 400, "AUTH.LOGIN_FAILED").requestId);
  expectResult(await verify(b, verifyToken, { ip }), "verified");
  const wrong = testPassword(19);
  keepId(expectAnswer(await signIn(b, a.email, wrong, { ip }), 400, "AUTH.LOGIN_FAILED").requestId);
  expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
  b.clearCookies();
  expectResult(await forgot(b, a.email, { ip }), "check-email");
  const resetMail = await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") });
  const resetToken = linkToken(resetMail, "reset", b.publicOrigin);
  const renewed = testPassword(26);
  expectResult(await reset(b, resetToken, renewed, { ip: ip2 }), "password-reset");
  keepId(expectAnswer(await reset(b, resetToken, testPassword(26), { ip: ip2 }), 400, "AUTH.LOGIN_FAILED").requestId);
  expectAnswer(await signIn(b, a.email, renewed, { ip: ip2 }), 200);
  return {
    needles: { "test password": a.password, "wrong test password": wrong, "new test password": renewed, "verification token": verifyToken, "reset token": resetToken },
    requestIds,
  };
}

if (isLocal()) {
  describe("SEC-AC-002 password provider values", () => {
    afterEach(disposePasswordApps);

    it(
      tag("SEC-AC-002", "locally, the stored log entries contain no test password, verification token or reset token of the password provider"),
      async () => {
        const { needles, requestIds } = await exercise(httpBrowser());
        for (const id of requestIds) await waitForEntries(id, "SEC-AC-002");
        const entries = await storedEntries({ what: "SEC-AC-002" });
        expect(entries.length).toBeGreaterThan(0);
        expect(entries.flatMap((e) => found(e.raw, needles).map((l) => `${e.where}: ${l}`)), "stored log entries").toEqual([]);
      },
      300_000,
    );

    it(
      tag("SEC-AC-002", "locally (in-process with passwordLoginProvider), the log entries contain no test password, verification token or reset token"),
      async () => {
        const app = await openPasswordApp();
        const { needles } = await exercise(inProcessBrowser(app));
        const lines = logText(app.logs());
        expect(lines.length, "the refused requests wrote entries").toBeGreaterThan(0);
        expect(lines.flatMap((line, i) => found(line, needles).map((l) => `entry ${String(i)}: ${l}`)), "log entries").toEqual([]);
      },
      300_000,
    );
  });
}
