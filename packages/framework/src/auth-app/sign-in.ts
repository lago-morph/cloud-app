/**
 * The auth app's callback steps 3.1–3.6 (plan §4.1): exchange the code, check the ID token,
 * take `sub`/`email` (reading `/user` when the token has no email, §10), pick this account's
 * accepted membership and map its roles (§4.4), and revoke the access and refresh tokens on every
 * path once they exist, so the auth app keeps no Cloudflare token (step 3.6). The caller upserts
 * `users` and issues the one-time code (steps 3.5, 3.7). Refusals are SignInErrors.
 */
import type { AuthAppIdentity } from "../auth/auth-app-binding.js";
import { SignInError } from "./errors.js";
import { verifyIdToken } from "./id-token.js";
import { mapRole, pickMembership } from "./roles.js";
import { exchangeCode, fetchMemberships, fetchUserEmail, loadDiscovery, loadJwks, revokeTokens } from "./upstream.js";

export interface AuthAppConfig {
  /** The sign-in OAuth client (plan §5.1 creates it). */
  readonly clientId: string;
  readonly clientSecret: string;
  /** The Cloudflare account whose members may sign in. */
  readonly accountId: string;
  /** PAR-418. */
  readonly discoveryUrl: string;
  readonly apiBase: string;
  /** The auth app's own callback URL, built from its configured public origin. */
  readonly callbackUrl: string;
}

export interface SignInDeps {
  readonly fetch: typeof fetch;
  readonly config: AuthAppConfig;
  /** One JSON log line. */
  readonly log: (line: string) => void;
  readonly nowSeconds?: () => number;
}

export const logLine = (level: "warn" | "error" | "info", message: string): string => JSON.stringify({ level, component: "AUTH_APP", message });

export async function completeSignIn(deps: SignInDeps, input: { code: string; verifier: string; nonce: string }): Promise<AuthAppIdentity> {
  const { config, fetch: f } = deps;
  const discovery = await loadDiscovery(f, config.discoveryUrl);
  const client = { clientId: config.clientId, clientSecret: config.clientSecret };
  const tokens = await exchangeCode(f, discovery, { ...client, code: input.code, verifier: input.verifier, redirectUri: config.callbackUrl });
  try {
    const keys = await loadJwks(f, discovery);
    const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const id = await verifyIdToken(tokens.idToken, { keys, issuer: discovery.issuer, clientId: config.clientId, nonce: input.nonce, nowSeconds: now });
    if (id.email !== null && id.emailVerified === false) throw new SignInError("email not verified");
    const email = id.email ?? (await fetchUserEmail(f, config.apiBase, tokens.accessToken));
    if (email === null) throw new SignInError("no email");
    const membership = pickMembership(await fetchMemberships(f, config.apiBase, tokens.accessToken), config.accountId);
    if (membership === null) throw new SignInError("no accepted membership in this account");
    return { sub: id.sub, email, role: mapRole(membership.roles) };
  } finally {
    const all = [{ token: tokens.accessToken, hint: "access_token" as const }, ...(tokens.refreshToken === null ? [] : [{ token: tokens.refreshToken, hint: "refresh_token" as const }])];
    const failed = await revokeTokens(f, discovery, client, all);
    if (failed.length > 0) deps.log(logLine("warn", `token revocation failed (${failed.join(", ")})`));
  }
}
