/**
 * PWD-AC-006 (docs/components/password.md §4, PWD-REQ-006): "From one client IP, sign-in
 * requests beyond PAR-258 within its window get 429 `AUTH.RATE_LIMITED`, while another IP is
 * unaffected; likewise sign-up beyond PAR-259. The same holds with `NODE_ENV` set to `test` and
 * to `production`."
 *
 * In-process, the client IP is `CF-Connecting-IP` (127.0.0.1 when absent, testing.d.ts); each
 * case uses addresses of its own. Under `dev` the same burst runs over HTTP (DEC-0516: `dev`
 * also takes the client IP from `CF-Connecting-IP`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../harness/index.js";
import { isLocal } from "../core/support/repo.js";
import {
  describeAnswer,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  httpBrowser,
  inProcessBrowser,
  newAccount,
  openPasswordApp,
  par,
  signIn,
  signUp,
  testAddress,
  testIp,
  testPassword,
  type AuthBrowser,
} from "./support.js";

async function signInBurst(b: AuthBrowser): Promise<void> {
  const { max } = par.signIn();
  const ip = testIp();
  for (let i = 1; i <= max; i++) {
    const r = await signIn(b, testAddress("pwd-ac-006-in"), testPassword(16), { ip });
    expect(r.status, `sign-in ${String(i)} of PAR-258's ${String(max)}: ${describeAnswer(r)}`).not.toBe(429);
    expectAnswer(r, 400, "AUTH.LOGIN_FAILED");
  }
  expectAnswer(await signIn(b, testAddress("pwd-ac-006-in"), testPassword(16), { ip }), 429, "AUTH.RATE_LIMITED");
  expectAnswer(await signIn(b, testAddress("pwd-ac-006-in"), testPassword(16), { ip: testIp() }), 400, "AUTH.LOGIN_FAILED");
}

async function signUpBurst(b: AuthBrowser): Promise<void> {
  const { max } = par.emailSending();
  const ip = testIp();
  for (let i = 1; i <= max; i++) {
    const r = await signUp(b, newAccount("pwd-ac-006-up"), { ip });
    expect(r.status, `sign-up ${String(i)} of PAR-259's ${String(max)}: ${describeAnswer(r)}`).not.toBe(429);
    expectResult(r, "check-email");
  }
  expectAnswer(await signUp(b, newAccount("pwd-ac-006-up"), { ip }), 429, "AUTH.RATE_LIMITED");
  expectResult(await signUp(b, newAccount("pwd-ac-006-up"), { ip: testIp() }), "check-email");
}

if (isLocal()) {
  describe("PWD-AC-006 in-process", () => {
    afterEach(async () => {
      vi.unstubAllEnvs();
      await disposePasswordApps();
    });

    for (const nodeEnv of ["test", "production"] as const) {
      it(tag("PWD-AC-006", `NODE_ENV=${nodeEnv}: sign-in beyond PAR-258 from one IP is 429 AUTH.RATE_LIMITED, another IP is unaffected`), async () => {
        vi.stubEnv("NODE_ENV", nodeEnv);
        await signInBurst(inProcessBrowser(await openPasswordApp()));
      });

      it(tag("PWD-AC-006", `NODE_ENV=${nodeEnv}: sign-up beyond PAR-259 from one IP is 429 AUTH.RATE_LIMITED, another IP is unaffected`), async () => {
        vi.stubEnv("NODE_ENV", nodeEnv);
        await signUpBurst(inProcessBrowser(await openPasswordApp()));
      });
    }
  });

  describe("PWD-AC-006 under dev", () => {
    it(tag("PWD-AC-006", "under dev: sign-in beyond PAR-258 and sign-up beyond PAR-259 from one IP are 429 AUTH.RATE_LIMITED, another IP is unaffected"), async () => {
      const b = httpBrowser();
      await signInBurst(b);
      await signUpBurst(b);
    });
  });
}
