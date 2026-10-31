/**
 * The auth-app service binding (contract: docs/contracts/ts/internal/auth-app.d.ts; plan-v0.2.0
 * §3, §4.1 steps 4–5). An app Worker reaches the account-level auth app only through this binding
 * (`env.AUTH`): `redeem` turns a one-time sign-in code into the person's identity, and `role`
 * answers the role recorded at the person's last sign-in. Never exported to app code.
 *
 * `createFakeAuthAppBinding` is the in-memory fake behind the same interface, for unit and
 * integration tests of the app side (plan §4.3, §7): it keeps the real auth app's code rules
 * (bound to one app, AUTH_APP_CODE_LIFETIME_MS, single use) and can be made to fail.
 */

/** The two roles the auth app maps a Cloudflare membership to (plan §4.4). */
export type AuthAppRole = "admin" | "user";

/** What a redeemed code yields: the Cloudflare user's subject and email, and their role. */
export interface AuthAppIdentity {
  readonly sub: string;
  readonly email: string;
  readonly role: AuthAppRole;
}

export interface RedeemInput {
  /** The one-time code from the auth app's redirect (`return?code=…&state=…`). */
  readonly code: string;
  /** The calling app's ID, as it passed to `/start?app=`. */
  readonly app: string;
}

export interface AuthAppBinding {
  /**
   * The identity for a valid code, using the code up. `null` when the code is unknown,
   * malformed, already used, expired, or was issued to another app (or to a return URL no longer
   * registered for it). Throws only when the auth app cannot answer (an outage), and then the
   * code is not used up.
   */
  redeem(input: RedeemInput): Promise<AuthAppIdentity | null>;
  /**
   * The role recorded for `sub` at its last sign-in, or `null` when the auth app has no such
   * user. Throws when the auth app cannot answer; the app's role refresh retries (plan §4.1 step 5).
   */
  role(sub: string): Promise<AuthAppRole | null>;
}

/** A code's lifetime (PAR-414): accepted up to and including this many ms after it was issued. */
export const AUTH_APP_CODE_LIFETIME_MS = 60_000;

export interface FakeAuthAppBinding extends AuthAppBinding {
  /** Records the user (as a sign-in would) and returns a fresh one-time code for `app`. */
  issueCode(identity: AuthAppIdentity, options: { readonly app: string }): string;
  /** Sets the stored role for `sub`; `null` removes the user. */
  setRole(sub: string, role: AuthAppRole | null): void;
  /** The next `n` calls (redeem or role) throw, as an unavailable auth app would. */
  failNext(n: number): void;
  /** While true, every call throws. */
  setUnavailable(unavailable: boolean): void;
  /** Calls made so far, failed ones included. */
  readonly calls: { readonly redeem: number; readonly role: number };
}

interface FakeCode {
  readonly identity: AuthAppIdentity;
  readonly app: string;
  readonly issuedAt: number;
}

/** The fake keeps codes in memory, never hashed: it is test-only and holds no real identity. */
export function createFakeAuthAppBinding(options: { readonly now?: () => number } = {}): FakeAuthAppBinding {
  const now = options.now ?? Date.now;
  const codes = new Map<string, FakeCode>();
  const roles = new Map<string, AuthAppRole>();
  const calls = { redeem: 0, role: 0 };
  let failures = 0;
  let unavailable = false;

  const checkAvailable = (): void => {
    if (unavailable) throw new Error("auth app unavailable (fake: setUnavailable)");
    if (failures > 0) {
      failures -= 1;
      throw new Error("auth app unavailable (fake: failNext)");
    }
  };

  return {
    get calls() {
      return { ...calls };
    },
    issueCode(identity, { app }) {
      roles.set(identity.sub, identity.role);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      codes.set(code, { identity: Object.freeze({ ...identity }), app, issuedAt: now() });
      return code;
    },
    setRole(sub, role) {
      if (role === null) roles.delete(sub);
      else roles.set(sub, role);
    },
    failNext(n) {
      failures = n;
    },
    setUnavailable(value) {
      unavailable = value;
    },
    async redeem({ code, app }) {
      calls.redeem += 1;
      checkAvailable();
      const entry = codes.get(code);
      if (entry === undefined || entry.app !== app) return null;
      // Checked and deleted with no await in between, so concurrent redemptions see it once.
      codes.delete(code);
      if (now() - entry.issuedAt > AUTH_APP_CODE_LIFETIME_MS) return null;
      return entry.identity;
    },
    async role(sub) {
      calls.role += 1;
      checkAvailable();
      return roles.get(sub) ?? null;
    },
  };
}
