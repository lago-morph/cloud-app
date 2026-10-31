/**
 * The auth app's service binding: the framework-internal contract between an app Worker and the
 * account-level auth app (plan-v0.2.0-testing-auth.md §3, §4.1 steps 4–5; DEC-0650, DEC-0651).
 * An app reaches the auth app only through this binding, `env.AUTH` (service binding to the auth
 * app's Worker with `entrypoint: "AuthApp"`, DEC-0661); the auth app has no public "who is this
 * user" API. Never exported to app code.
 *
 * Implementation: packages/framework/src/auth/auth-app-binding.ts (types and the in-memory fake
 * `createFakeAuthAppBinding`), packages/framework/src/auth-app/ (the auth app).
 */

/**
 * The two roles the auth app maps a Cloudflare membership to (plan §4.4, PAR-413). In the
 * framework's terms (auth.md: `admin` is the only role, "user" is a level), `"admin"` means the
 * role list `["admin"]` and `"user"` means an empty role list.
 */
export type AuthAppRole = "admin" | "user";

/** What a redeemed code yields. `sub` is the Cloudflare user's subject from the ID token. */
export interface AuthAppIdentity {
  readonly sub: string;
  readonly email: string;
  readonly role: AuthAppRole;
}

export interface RedeemInput {
  /** The one-time code from the auth app's redirect to `return?code=…&state=…`. */
  readonly code: string;
  /** The calling app's ID, exactly as it passed it to `/start?app=`. */
  readonly app: string;
}

export interface AuthAppBinding {
  /**
   * Turns a one-time code into the person's identity and uses the code up.
   *
   * A code is 32 random bytes written as 43 base64url characters; anything else is malformed.
   * It is stored only as its hash, single use, valid for PAR-414 (60 s; accepted at exactly 60 s,
   * refused 1 ms later), and bound to the app ID and the return URL it was issued for. Of several
   * concurrent redemptions of one code, exactly one succeeds. The identity is the auth app's user
   * record at redemption (so a role changed since sign-in shows).
   *
   * Resolves `null` when the code is malformed, unknown, used, expired, issued to another app,
   * issued for a return URL that is no longer registered for the app, or its user record is gone.
   * A redemption refused for naming the wrong app does not use the code up.
   *
   * Rejects only when the auth app cannot answer (its D1 is unavailable, the binding fails); the
   * code is then not used up.
   */
  redeem(input: RedeemInput): Promise<AuthAppIdentity | null>;

  /**
   * The role recorded for `sub` at its last sign-in, or `null` when the auth app has no such user.
   *
   * `null` is an answer, not a failure: the app ends the session at once, without retrying.
   * A rejection means the auth app cannot answer: the app retries and then fails closed (plan
   * §4.1 step 5). The retry count and delay are AUTH parameters, allocated by item B
   * (PAR-425–434), not by this contract.
   */
  role(sub: string): Promise<AuthAppRole | null>;
}
