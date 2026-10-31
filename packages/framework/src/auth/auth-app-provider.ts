/**
 * The auth-app login provider (plan-v0.2.0 §3, §4.1 steps 1 and 4; DEC-0665, DEC-0666): the
 * redirect `LoginProvider` for sign-in with Cloudflare through the account's shared auth app.
 *
 * - `beginLogin` sends the browser to `<auth app>/start?app=<app ID>&return=<callback>&state=<s>`;
 *   AUTH keeps `s` in the `__Host-login` transaction cookie.
 * - `completeLogin` checks the state, then redeems the auth app's one-time code over the service
 *   binding (`AuthAppBinding.redeem`). The subject is the Cloudflare `sub`; the user ID is derived
 *   from it with this provider's id, `cf-account`.
 * - `accountStatus` answers from the binding's `role(sub)`: `admin` is the role list `["admin"]`,
 *   `user` an empty list, an unknown user `null` (contract: internal/auth-app.d.ts).
 *
 * Built per request (the binding is a Worker binding). Holds no Cloudflare credential.
 * Workers-compatible.
 */
import { FrameworkError } from "../core/errors.js";
import type { AuthAppBinding, AuthAppRole } from "./auth-app-binding.js";
import type { AccountStatus, LoginProvider, ProviderIdentity } from "./login-provider.js";
import { base64urlEncode } from "./signing.js";

/** The session's provider field for sign-in with Cloudflare (plan §4.1 step 4). Part of the user-ID derivation. */
export const AUTH_APP_PROVIDER_ID = "cf-account";

export interface AuthAppProviderOptions {
  /** The service binding to the auth app (`env.AUTH`). */
  readonly binding: AuthAppBinding;
  /** This app's ID at the auth app (its registry key): the Worker name `<app>-<stage>` (DEC-0667). */
  readonly app: string;
  /** The auth app's public origin; only its origin part is used. */
  readonly authAppOrigin: string;
}

const failed = (reason: string): FrameworkError => new FrameworkError("AUTH.LOGIN_FAILED", reason);

/** The framework's role list for an auth-app role (internal/auth-app.d.ts `AuthAppRole`). */
export function rolesOf(role: AuthAppRole): string[] {
  return role === "admin" ? ["admin"] : [];
}

function startUrl(authAppOrigin: string): URL {
  let origin: string;
  try {
    origin = new URL(authAppOrigin).origin;
  } catch {
    throw new FrameworkError("CORE.MISCONFIGURED", "the auth app's origin is not a valid URL");
  }
  return new URL("/start", origin);
}

export function createAuthAppProvider(options: AuthAppProviderOptions): LoginProvider {
  const { binding, app } = options;
  return Object.freeze({
    id: AUTH_APP_PROVIDER_ID,
    async beginLogin(ctx) {
      const url = startUrl(options.authAppOrigin);
      const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
      url.searchParams.set("app", app);
      url.searchParams.set("return", ctx.callbackUrl);
      url.searchParams.set("state", state);
      return { redirectUrl: url.toString(), transactionState: state };
    },
    async completeLogin(_ctx, query, transactionState): Promise<ProviderIdentity> {
      if (query.get("state") !== transactionState) throw failed("state mismatch");
      const code = query.get("code");
      // The auth app redirects back with `error=login_failed` for a declined or refused sign-in (DEC-0660).
      if (query.has("error") || code === null || code === "") throw failed("provider refused");
      let identity;
      try {
        identity = await binding.redeem({ code, app });
      } catch (thrown) {
        // A missing binding is the deployment's fault, not the auth app's: a server error.
        if (thrown instanceof FrameworkError && thrown.code === "CORE.MISCONFIGURED") throw thrown;
        // An outage at sign-in is a failed login, not a server error (DEC-0666); the code is not used up.
        throw failed("auth app unavailable");
      }
      if (identity === null) throw failed("code refused");
      // The role at redemption is the session's until its first refresh (plan §4.1 step 5).
      return { subject: identity.sub, displayName: null, roles: rolesOf(identity.role) };
    },
    async accountStatus(subject): Promise<AccountStatus | null> {
      const role = await binding.role(subject);
      return role === null ? null : { verified: true, roles: rolesOf(role) };
    },
  } satisfies LoginProvider);
}
