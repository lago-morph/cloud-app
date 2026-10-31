/**
 * Login provider interface: the framework-internal contract between AUTH and each provider
 * adapter (the auth-app provider, the test-only stub, future providers). Every provider is a
 * redirect provider (`LoginProvider`): the credential interface and the password provider left in
 * v0.2.0 (DEC-0691). The authentication mock is not a provider; it sets sessions directly.
 * Never exported to app code. Behavior: docs/components/auth.md.
 */

export interface ProviderContext {
  /** Exact callback URL, built from the deployment's resolved public origin. */
  readonly callbackUrl: string;
  readonly getSecret: (name: string) => Promise<string>;
  readonly getConfig: (key: string) => unknown;
}

export interface BeginLoginResult {
  /** Where to send the browser. */
  readonly redirectUrl: string;
  /** Provider-private state, stored by AUTH in a signed, short-lived browser cookie. */
  readonly transactionState: string;
}

export interface ProviderIdentity {
  /** Provider's stable identifier for the person. Never exposed to app code. */
  readonly subject: string;
  /** `null` for the auth-app provider, whose only name for the person is an email address (AUTH-REQ-008). */
  readonly displayName: string | null;
  /**
   * The person's roles at sign-in, when the provider learns them with the login (the auth-app
   * provider: from `redeem`). AUTH records them in the session as confirmed now. When absent,
   * the session starts with no roles.
   */
  readonly roles?: readonly string[];
}

/**
 * Roles the framework acts on. `admin` is the only role defined (DEC-0521); there is no "user"
 * role, because "user" is an access level. Unknown names in a role list are ignored.
 */
export type Role = "admin";

/**
 * An account's current state, read by AUTH at a role refresh: once the role-refresh interval
 * has passed since the session's roles were last confirmed (AUTH-REQ-003 as amended by DEC-0690).
 * The level is `anonymous` unless `verified` is true; then it is `admin` when `roles` contains
 * "admin", and `user` otherwise.
 */
export interface AccountStatus {
  /** Always true for the auth-app provider: the auth app refuses a sign-in without a verified email address. */
  readonly verified: boolean;
  /** The account's roles; empty for a user. */
  readonly roles: readonly string[];
}

/**
 * A redirect provider. In v0.2.0: the auth-app provider (`id` "cf-account", plan-v0.2.0 §4.1),
 * built over the app Worker's `AUTH` service binding (internal/auth-app.d.ts) and the app's ID,
 * and the test-only stub (`id` "stub").
 */
export interface LoginProvider {
  /** Short, stable provider name, e.g. "cf-account". Part of the user ID derivation. */
  readonly id: string;
  /** The auth-app provider redirects to `<auth app>/start?app=<app id>&return=<callbackUrl>&state=<s>`. */
  beginLogin(ctx: ProviderContext): Promise<BeginLoginResult>;
  /**
   * Validates the callback and returns the identity, or throws AUTH.LOGIN_FAILED.
   * All protocol checks happen here; the auth-app provider checks the state and redeems the code
   * with `AUTH.redeem({ code, app })`, and a `null` answer is AUTH.LOGIN_FAILED.
   */
  completeLogin(ctx: ProviderContext, callbackQuery: URLSearchParams, transactionState: string): Promise<ProviderIdentity>;
  /**
   * The account's verification state and roles, or null when the provider has no account for
   * `subject` (AUTH then ends the session at once, with no retry). Throws when it cannot tell
   * (AUTH then retries, and after the last failed retry ends the session and treats the request
   * as anonymous). The auth-app provider answers from `AUTH.role(sub)`: `"admin"` is
   * `{ verified: true, roles: ["admin"] }`, `"user"` is `{ verified: true, roles: [] }`. The stub
   * answers from its in-memory accounts (DEC-0525).
   */
  accountStatus(subject: string): Promise<AccountStatus | null>;
}
