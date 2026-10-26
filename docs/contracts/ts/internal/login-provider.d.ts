/**
 * Login provider interfaces: the framework-internal contracts between AUTH and each
 * provider adapter (the password provider PWD, the test-only stub, the authentication mock,
 * future providers). A provider implements either `LoginProvider` (redirect to a third party
 * and back) or `CredentialProvider` (validates credentials itself).
 * Never exported to app code. Behavior: docs/components/auth.md, docs/components/password.md.
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
  readonly displayName: string | null;
}

/**
 * Roles the framework acts on. `admin` is the only role defined (DEC-0521); there is no "user"
 * role, because "user" is an access level. Unknown names in a role list are ignored.
 */
export type Role = "admin";

/**
 * An account's current state, read by AUTH once per request that carries a valid session from
 * this provider (AUTH-REQ-003, DEC-0524). The level is `anonymous` unless `verified` is true;
 * then it is `admin` when `roles` contains "admin", and `user` otherwise.
 */
export interface AccountStatus {
  readonly verified: boolean;
  /** The account's roles, parsed from its comma-separated role list; empty for a new account. */
  readonly roles: readonly string[];
}

/** A redirect provider (release 1: only the test-only stub). */
export interface LoginProvider {
  /** Short, stable provider name, e.g. "stub". Part of the user ID derivation. */
  readonly id: string;
  beginLogin(ctx: ProviderContext): Promise<BeginLoginResult>;
  /**
   * Validates the callback and returns the identity, or throws AUTH.LOGIN_FAILED.
   * All protocol checks happen here.
   */
  completeLogin(ctx: ProviderContext, callbackQuery: URLSearchParams, transactionState: string): Promise<ProviderIdentity>;
  /**
   * The account's verification state and roles, or null when the provider has no account for
   * `subject`. Throws when it cannot tell (AUTH then treats the request as anonymous). The stub
   * answers from its in-memory accounts (DEC-0525). Every provider has it (the retired Google
   * adapter, which had none, left in item I-G).
   */
  accountStatus(subject: string): Promise<AccountStatus | null>;
}

/** Per-request context for a credential provider. Built by AUTH; never visible to app code. */
export interface CredentialContext {
  /** The deployment's resolved public origin. Links in mail are built from it, never from request headers. */
  readonly publicOrigin: string;
  /** The request's `Origin` header, already checked by AUTH (AUTH-REQ-007) and passed on to the provider's own check. */
  readonly origin: string;
  /** The client IP used for rate limiting: `CF-Connecting-IP`, or "127.0.0.1" locally and in createTestApp when absent. */
  readonly clientIp: string;
  readonly userAgent: string | null;
  /** Schedules work to run after the response (mail sends), so the response and its timing do not depend on it. */
  readonly waitUntil: (work: Promise<unknown>) => void;
  readonly getSecret: (name: string) => Promise<string>;
  readonly getConfig: (key: string) => unknown;
}

/**
 * A provider that validates credentials itself (release 1: email and password, `id`
 * "password"; docs/components/password.md, DEC-0510). It is created per request over the
 * request's SQL database. It never creates a browser session: AUTH derives the user ID from
 * `id` and `ProviderIdentity.subject` and issues the framework session. Every operation that
 * takes an address resolves identically whether or not an account exists (PWD-REQ-005);
 * only `signIn` returns an identity.
 *
 * Failures are FrameworkErrors with these codes: `AUTH.LOGIN_FAILED` (wrong credentials, or an
 * invalid, used or expired token), `AUTH.NOT_VERIFIED` (sign-in before verification),
 * `AUTH.RATE_LIMITED` (over a PWD-REQ-006 limit), `HTTP.INVALID_INPUT` (password length,
 * missing display name). `AUTH.NOT_VERIFIED` and `AUTH.RATE_LIMITED` join errors.d.ts together
 * with the error catalogue (DEC-0520).
 */
export interface CredentialProvider {
  /** Short, stable provider name, e.g. "password". Part of the user ID derivation. */
  readonly id: string;
  /** Creates an unverified account and mails a verification link; for an existing address, mails a notice instead. */
  signUp(ctx: CredentialContext, input: { readonly email: string; readonly password: string; readonly displayName: string }): Promise<void>;
  /** Validates the credentials of a verified account and returns its identity. Sends no mail. */
  signIn(ctx: CredentialContext, input: { readonly email: string; readonly password: string }): Promise<ProviderIdentity>;
  /** Mails a new verification link if the address has an unverified account; otherwise does nothing. */
  sendVerification(ctx: CredentialContext, input: { readonly email: string }): Promise<void>;
  /** Marks the account of a valid verification token as verified. Creates no session. */
  verify(ctx: CredentialContext, input: { readonly token: string }): Promise<void>;
  /** Mails a single-use reset link if the address has an account; otherwise does nothing. */
  requestReset(ctx: CredentialContext, input: { readonly email: string }): Promise<void>;
  /** Sets a new password with a valid reset token and uses the token up. */
  reset(ctx: CredentialContext, input: { readonly token: string; readonly newPassword: string }): Promise<void>;
  /**
   * The account's verification state and roles, or null when no account has this subject.
   * One primary-key read of `__framework_auth_user` (`email_verified`, `role`; PWD-REQ-008).
   * Throws when the read fails (AUTH then treats the request as anonymous).
   */
  accountStatus(subject: string): Promise<AccountStatus | null>;
}
