/**
 * One OAuth grant through the admin client (v0.2.0 plan §5.2; D8, D10; DEC-0710), reusing the auth
 * app's OAuth core: discovery, PKCE S256, the ID-token check against the JWKS (`iss`, `aud`,
 * `nonce`, `exp`), `/memberships` with the membership pick and role mapping (PAR-413), and revoke.
 *
 * `startGrant` makes the authorization request for a page's scopes (scopes.ts) and the sealed grant
 * cookie that binds it to this browser. `useGrant` exchanges the code, checks the person, works
 * out which optional scopes were granted, hands the access token to `use` and **revokes the access
 * and refresh tokens when `use` ends, whatever happens**, so the admin app keeps no Cloudflare
 * token. Refusals are GrantErrors with one fixed reason; no code, token or secret is in a reason.
 */
import { SignInError } from "../auth-app/errors.js";
import { verifyIdToken } from "../auth-app/id-token.js";
import { createPkce, randomToken } from "../auth-app/pkce.js";
import { mapRole, pickMembership } from "../auth-app/roles.js";
import { fetchMemberships, fetchUserEmail, loadDiscovery, loadJwks, revokeTokens, type Discovery, type TokenKind } from "../auth-app/upstream.js";
import { ADMIN_GRANT_MS } from "./params.js";
import { open, seal } from "./seal.js";
import { grantScope, isPageId, PAGE_SCOPES, type AdminPageId } from "./scopes.js";

export interface AdminConfig {
  /** The admin OAuth client (the bootstrap creates it, plan §5.1). */
  readonly clientId: string;
  readonly clientSecret: string;
  /** The Cloudflare account this admin app belongs to. */
  readonly accountId: string;
  /** The admin app's public origin; the callback is `<origin>/callback`. */
  readonly origin: string;
  readonly discoveryUrl: string;
  readonly apiBase: string;
}

export interface GrantDeps {
  readonly fetch: typeof fetch;
  readonly config: AdminConfig;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

export class GrantError extends Error {
  readonly reason: string;
  /** "declined": the person said no at Cloudflare; "refused": anything else. */
  readonly kind: "declined" | "refused" | "not-admin";
  constructor(reason: string, kind: GrantError["kind"] = "refused") {
    super(`grant refused: ${reason}`);
    this.name = "GrantError";
    this.reason = reason;
    this.kind = kind;
  }
}

export const logLine = (level: "warn" | "error" | "info", message: string): string => JSON.stringify({ level, component: "ADMIN_APP", message });

const callbackUrl = (c: AdminConfig): string => `${c.origin}/callback`;

interface GrantState {
  readonly state: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly page: AdminPageId;
}

/** The authorization URL for `page` and the sealed grant cookie value. */
export async function startGrant(deps: GrantDeps, page: AdminPageId): Promise<{ location: string; cookie: string }> {
  const discovery = await loadDiscovery(deps.fetch, deps.config.discoveryUrl);
  const pkce = await createPkce();
  const g: GrantState = { state: randomToken(32), verifier: pkce.verifier, nonce: randomToken(32), page };
  const target = new URL(discovery.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: deps.config.clientId,
    redirect_uri: callbackUrl(deps.config),
    scope: grantScope(page),
    state: g.state,
    nonce: g.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  };
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return { location: target.toString(), cookie: await seal(deps.config.clientSecret, "grant", g, deps.now() + ADMIN_GRANT_MS) };
}

/** The page a sealed grant cookie is for, once its `state` matches; null when it does not. */
export async function openGrant(deps: GrantDeps, cookie: string | undefined, state: string): Promise<GrantState | null> {
  if (cookie === undefined || state === "") return null;
  const g = (await open(deps.config.clientSecret, "grant", cookie, deps.now())) as Partial<GrantState> | null;
  if (g === null || g.state !== state || typeof g.verifier !== "string" || typeof g.nonce !== "string" || !isPageId(g.page)) return null;
  return g as GrantState;
}

export interface Grant {
  readonly page: AdminPageId;
  readonly admin: { readonly sub: string; readonly email: string };
  /** The person's access token, valid only while `use` runs. Never logged, shown or stored. */
  readonly accessToken: string;
  /** Every scope Cloudflare granted. */
  readonly granted: readonly string[];
  /** The page's optional scopes the person unticked. */
  readonly missing: readonly string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The token exchange, keeping the granted `scope` (the auth app's `exchangeCode` drops it). */
async function exchange(deps: GrantDeps, d: Discovery, code: string, verifier: string): Promise<{ access: string | null; refresh: string | null; id: string | null; scope: string | null }> {
  const c = deps.config;
  let res: Response;
  try {
    res = await deps.fetch(d.tokenEndpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: callbackUrl(c), client_id: c.clientId, client_secret: c.clientSecret }).toString(),
    });
  } catch {
    throw new GrantError("token exchange: unreachable");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new GrantError(`token exchange rejected (${String(res.status)})`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object") throw new GrantError("token exchange: malformed response");
  return { access: str(body.access_token), refresh: str(body.refresh_token), id: str(body.id_token), scope: typeof body.scope === "string" ? body.scope : null };
}

/**
 * Completes the grant `g` with the callback's `code`, checks the person is an administrator of the
 * account, and runs `use`; the tokens are revoked when it ends.
 */
export async function useGrant<T>(deps: GrantDeps, g: GrantState, code: string, use: (grant: Grant) => Promise<T>): Promise<T> {
  const c = deps.config;
  const discovery = await loadDiscovery(deps.fetch, c.discoveryUrl).catch((e: unknown) => {
    throw new GrantError(e instanceof SignInError ? e.reason : "discovery failed");
  });
  const tokens = await exchange(deps, discovery, code, g.verifier);
  try {
    if (tokens.access === null) throw new GrantError("token exchange: no access token");
    if (tokens.id === null) throw new GrantError("token exchange: no id token");
    let admin: { sub: string; email: string };
    try {
      const keys = await loadJwks(deps.fetch, discovery);
      const id = await verifyIdToken(tokens.id, { keys, issuer: discovery.issuer, clientId: c.clientId, nonce: g.nonce, nowSeconds: Math.floor(deps.now() / 1000) });
      const email = id.email ?? (await fetchUserEmail(deps.fetch, c.apiBase, tokens.access));
      const membership = pickMembership(await fetchMemberships(deps.fetch, c.apiBase, tokens.access), c.accountId);
      if (membership === null) throw new GrantError("no accepted membership in this account", "not-admin");
      if (mapRole(membership.roles) !== "admin") throw new GrantError("not an administrator", "not-admin");
      admin = { sub: id.sub, email: email ?? "" };
    } catch (e) {
      if (e instanceof SignInError) throw new GrantError(e.reason);
      throw e;
    }
    // RFC 6749 §5.1: a token answer without `scope` granted the scopes as asked (DEC-0714).
    const granted = (tokens.scope ?? grantScope(g.page)).split(" ").filter((s) => s !== "");
    const missing = PAGE_SCOPES[g.page].filter((s) => !granted.includes(s));
    return await use({ page: g.page, admin, accessToken: tokens.access, granted, missing });
  } finally {
    const all: { token: string; hint: TokenKind }[] = [];
    if (tokens.access !== null) all.push({ token: tokens.access, hint: "access_token" });
    if (tokens.refresh !== null) all.push({ token: tokens.refresh, hint: "refresh_token" });
    const failed = await revokeTokens(deps.fetch, discovery, { clientId: c.clientId, clientSecret: c.clientSecret }, all);
    if (failed.length > 0) deps.log(logLine("warn", `token revocation failed (${failed.join(", ")})`));
  }
}
