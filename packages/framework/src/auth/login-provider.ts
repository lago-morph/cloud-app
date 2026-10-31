/**
 * Login provider interfaces (contract: docs/contracts/ts/internal/login-provider.d.ts; owner AUTH).
 * The framework-internal contract between AUTH and each provider adapter: `LoginProvider`
 * (redirect: the auth-app provider and the test-only stub). Never exported to app code.
 * Behavior: docs/components/auth.md.
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
  /**
   * The roles the provider confirmed at sign-in, when it has them (the auth-app provider:
   * the role at redemption). Then AUTH keeps the level in the session and asks
   * `accountStatus` again only every PAR-425, failing closed (plan-v0.2.0 §4.1 step 5,
   * DEC-0668). Absent: the level is read on every request.
   */
  readonly roles?: readonly string[];
}

/**
 * Roles the framework acts on. `admin` is the only role defined (DEC-0521); there is no "user"
 * role, because "user" is an access level. Unknown names in a role list are ignored.
 */
export type { Role } from "./roles.js";

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
