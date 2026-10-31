/**
 * The auth app's calls upstream (plan §2.1, §4.1 steps 2–3). Endpoints come from the issuer's
 * discovery document (PAR-418), read on each sign-in with the JWKS (DEC-0653), so the same code
 * runs against Cloudflare and against mock-oauth2-server. The client authenticates with
 * `client_secret_post` (§2.1 lists it). Every refusal is a SignInError with a fixed reason; no
 * code, token or secret ever appears in a reason.
 */
import { SignInError } from "./errors.js";
import { SIGN_IN_SCOPES } from "./params.js";

export interface Discovery {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly jwksUri: string;
}

export interface UpstreamTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string;
}

export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** At most this many `/memberships` pages are read (50 per page). */
const MAX_MEMBERSHIP_PAGES = 20;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function getJson(f: typeof fetch, url: string, what: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, { ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch {
    throw new SignInError(`${what} unreachable`);
  }
  if (!res.ok) throw new SignInError(`${what} (${res.status})`);
  const body: unknown = await res.json().catch(() => undefined);
  if (!isRecord(body)) throw new SignInError(`${what}: malformed response`);
  return body;
}

function url(doc: Record<string, unknown>, field: string): string {
  const v = doc[field];
  if (typeof v !== "string" || !URL.canParse(v)) throw new SignInError(`discovery: missing ${field}`);
  return v;
}

export async function loadDiscovery(f: typeof fetch, discoveryUrl: string): Promise<Discovery> {
  const doc = await getJson(f, discoveryUrl, "discovery failed");
  const methods = doc.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) throw new SignInError("discovery: no S256");
  if (typeof doc.issuer !== "string" || doc.issuer === "") throw new SignInError("discovery: missing issuer");
  return {
    issuer: doc.issuer,
    authorizationEndpoint: url(doc, "authorization_endpoint"),
    tokenEndpoint: url(doc, "token_endpoint"),
    revocationEndpoint: url(doc, "revocation_endpoint"),
    jwksUri: url(doc, "jwks_uri"),
  };
}

export function authorizeUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const target = new URL(d.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: SIGN_IN_SCOPES,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  };
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return target.toString();
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

export async function exchangeCode(f: typeof fetch, d: Discovery, p: ClientCredentials & { code: string; verifier: string; redirectUri: string }): Promise<UpstreamTokens> {
  const body = await getJson(
    f,
    d.tokenEndpoint,
    "token exchange rejected",
    form({ grant_type: "authorization_code", code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri, client_id: p.clientId, client_secret: p.clientSecret }),
  );
  const { access_token: access, refresh_token: refresh, id_token: id } = body;
  if (typeof access !== "string" || typeof id !== "string") throw new SignInError("token exchange: no access or id token");
  return { accessToken: access, refreshToken: typeof refresh === "string" ? refresh : null, idToken: id };
}

export async function loadJwks(f: typeof fetch, d: Discovery): Promise<JsonWebKey[]> {
  const body = await getJson(f, d.jwksUri, "jwks failed");
  if (!Array.isArray(body.keys)) throw new SignInError("jwks failed: malformed response");
  return body.keys.filter(isRecord) as JsonWebKey[];
}

/**
 * Revokes each token (RFC 7009). Never throws: the auth app keeps no token whatever happens
 * (plan §4.1 step 3.6), so a failed revoke is reported (false) and logged, and sign-in goes on.
 */
export async function revokeTokens(f: typeof fetch, d: Discovery, c: ClientCredentials, tokens: readonly string[]): Promise<boolean> {
  let allOk = true;
  for (const token of tokens) {
    try {
      const res = await f(d.revocationEndpoint, form({ token, client_id: c.clientId, client_secret: c.clientSecret }));
      if (!res.ok) allOk = false;
      await res.body?.cancel();
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

/** The email of `GET /user` (the fallback when the ID token has none, plan §10), or null. */
export async function fetchUserEmail(f: typeof fetch, apiBase: string, accessToken: string): Promise<string | null> {
  const body = await getJson(f, `${apiBase}/user`, "user lookup failed", bearer(accessToken));
  const email = isRecord(body.result) ? body.result.email : undefined;
  return typeof email === "string" && email !== "" ? email : null;
}

/** Every entry of `GET /memberships`, across pages (plan §4.1 step 3.4). */
export async function fetchMemberships(f: typeof fetch, apiBase: string, accessToken: string): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_MEMBERSHIP_PAGES; page += 1) {
    const body = await getJson(f, `${apiBase}/memberships?page=${page}&per_page=50`, "memberships failed", bearer(accessToken));
    if (!Array.isArray(body.result)) throw new SignInError("memberships failed: malformed response");
    all.push(...body.result);
    const info = body.result_info;
    const total = isRecord(info) && typeof info.total_pages === "number" ? info.total_pages : 1;
    if (page >= total) break;
  }
  return all;
}
