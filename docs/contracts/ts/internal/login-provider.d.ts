/**
 * Login provider interface: the framework-internal contract between AUTH and each
 * provider adapter (GOOGLE, the authentication mock, future providers).
 * Never exported to app code. Behavior: docs/components/auth.md, docs/components/google.md.
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

export interface LoginProvider {
  /** Short, stable provider name, e.g. "google". Part of the user ID derivation. */
  readonly id: string;
  beginLogin(ctx: ProviderContext): Promise<BeginLoginResult>;
  /**
   * Validates the callback and returns the identity, or throws AUTH.LOGIN_FAILED.
   * All protocol checks happen here.
   */
  completeLogin(ctx: ProviderContext, callbackQuery: URLSearchParams, transactionState: string): Promise<ProviderIdentity>;
}
