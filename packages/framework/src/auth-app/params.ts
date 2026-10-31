/**
 * The auth app's parameters (PAR-413, PAR-415…PAR-418; plan §4.1, §4.4). Behaviour parameters live
 * here so they can change in one place; each is a PAR in the register (integrated by I1).
 * PAR-414, the code lifetime, is part of the binding contract (src/auth/auth-app-binding.ts).
 */

/**
 * PAR-413: membership role names that make a person `admin` (plan §4.4). Whole, case-sensitive
 * names. "Super Administrator - All Privileges" is verified (§2.1); "Administrator" is the plan's
 * name for the plain administrator role, its exact API string *unverified* (live-pass runbook L).
 */
export const ADMIN_ROLE_NAMES: readonly string[] = Object.freeze(["Super Administrator - All Privileges", "Administrator"]);

/** PAR-415: scopes the sign-in client requests (plan §4.1 step 2). `offline_access` is added by Cloudflare. */
export const SIGN_IN_SCOPES = "openid user-details.read memberships.read";

/** PAR-416: how long a started sign-in (`/start` to `/callback`) stays valid, in ms. */
export const SIGN_IN_TRANSACTION_MS = 600_000;

/** PAR-417: clock leeway for the ID token's `exp`, in seconds. */
export const ID_TOKEN_LEEWAY_S = 30;

/** PAR-418: Cloudflare's OpenID discovery document and API base (§2.1); tests point them elsewhere. */
export const CLOUDFLARE_DISCOVERY_URL = "https://dash.cloudflare.com/.well-known/openid-configuration";
export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
