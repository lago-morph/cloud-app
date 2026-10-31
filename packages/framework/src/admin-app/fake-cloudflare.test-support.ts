/**
 * Test support for the admin app: a fake Cloudflare behind an injected `fetch`, no network.
 *
 * - **OAuth** (plan §2.1): discovery, JWKS, token and revoke endpoints. `consent(authorizeUrl)`
 *   plays the person at the consent screen: it reads the authorization request, can untick
 *   optional scopes, and returns the callback URL with a code. The token endpoint checks the
 *   client, its secret, PKCE S256 and the redirect URI, and answers the *granted* `scope`, an
 *   opaque access token, a refresh token and an RS256 ID token carrying the request's nonce.
 * - **The API, enforcing scopes** (plan §2.1, §2.1a): every API call needs a live access token.
 *   `/user` and `/memberships` need only the required scopes; any other call needs the scope
 *   `scopeFor` names. Without it the fake answers as §2.1's unticked sign-in recorded: the Workers
 *   list is 200 and empty (filtered, not refused), D1 and R2 never asked for are 401 / 403 code
 *   10000, and anything else is 403 code 9109. A token created through the grant
 *   (`POST /accounts/<a>/tokens`) may hold only groups its granted scopes cover, else 400 code
 *   1001 (§2.1a). Calls that pass are answered by `account` (C's in-memory FakeCloud), if given.
 * - **Revoke** ends a token: the API refuses it afterwards (403), as live.
 */
import type { ApiReply, CloudflareApi } from "../provision/cloudflare/api.js";
import { base64urlEncode } from "../auth/signing.js";
import { makeSigningKey, type SignedKey } from "../auth-app/fake-upstream.test-support.js";
import { s256Challenge } from "../auth-app/pkce.js";

export const ISSUER = "https://dash.example.test";
export const API_BASE = "https://api.example.test/client/v4";
export const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
export const CLIENT_ID = "admin-client";
export const CLIENT_SECRET = "admin-client-secret-0123456789abcdefghij";
export const ACCOUNT = "0123456789abcdef0123456789abcdef";
export const ORIGIN = "https://prototype-admin.example.workers.dev";

/** The scope an API call needs (live scope IDs, plan §2.1); undefined: any live token. */
export function scopeFor(method: string, path: string): string | undefined {
  const p = path.split("?")[0]!;
  if (p === "/user" || p === "/memberships") return undefined;
  const write = method !== "GET";
  if (/^\/accounts\/[^/]+\/tokens(\/|$)/.test(p)) return "account-api-tokens.write";
  if (/^\/accounts\/[^/]+\/workers\//.test(p)) return "workers-scripts.write";
  if (/^\/accounts\/[^/]+\/d1\//.test(p)) return "d1.write";
  if (/^\/accounts\/[^/]+\/r2\//.test(p)) return "workers-r2.write";
  if (/^\/accounts\/[^/]+\/secrets_store\//.test(p)) return write ? "secrets-store.write" : "secrets-store.read";
  return "account-settings.read";
}

/** Scopes that also allow a call needing the key (a write scope covers its read). */
const ALSO: Readonly<Record<string, string>> = { "secrets-store.read": "secrets-store.write" };

/** The scope that covers each permission group a grant-made token may hold (plan §5.2 page 2's table). */
export const GROUP_SCOPE: Readonly<Record<string, string>> = {
  "Workers Scripts Write": "workers-scripts.write",
  "Workers R2 Storage Write": "workers-r2.write",
  "D1 Write": "d1.write",
  "Secrets Store Read": "secrets-store.read",
  "Secrets Store Write": "secrets-store.write",
  "Account Settings Read": "account-settings.read",
};

export interface Member {
  readonly sub: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  /** Role names of the accepted membership of `ACCOUNT`; undefined: no membership. */
  readonly roles?: readonly string[];
}

interface Pending {
  readonly sub: string;
  readonly scope: string[];
  readonly requested: string[];
  readonly nonce: string;
  readonly challenge: string;
  readonly redirectUri: string;
}

export interface FakeCloudflare {
  readonly fetch: typeof fetch;
  readonly key: SignedKey;
  readonly members: Map<string, Member>;
  /** Every request: `<METHOD> <url>` (never a body). */
  readonly requests: string[];
  /** Each access and refresh token issued, with whether it was revoked. */
  readonly issued: { readonly access: string; readonly refresh: string; revokedAccess: boolean; revokedRefresh: boolean; readonly scope: string[]; readonly requested: string[] }[];
  /** Replies that replace the fake's for `<METHOD> <api path>`. */
  readonly override: Map<string, ApiReply>;
  /** Claims that replace the ID token's (a wrong `nonce`, `aud`, `exp`, …), for refusal tests. */
  idTokenClaims: Record<string, unknown>;
  /** The person at the consent screen approves (or declines) the request; the callback URL. */
  consent(authorizeUrl: string, as: { sub: string; untick?: readonly string[]; decline?: boolean }): string;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiErr = (status: number, code: number, message: string): ApiReply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

export async function fakeCloudflare(options: { account?: CloudflareApi; omitScope?: boolean } = {}): Promise<FakeCloudflare> {
  const key = await makeSigningKey();
  const members = new Map<string, Member>();
  const requests: string[] = [];
  const pending = new Map<string, Pending>();
  const issued: FakeCloudflare["issued"] = [];
  const override = new Map<string, ApiReply>();
  let next = 1;
  const random = () => base64urlEncode(crypto.getRandomValues(new Uint8Array(12)));

  const live = (token: string) => issued.find((t) => t.access === token && !t.revokedAccess);

  async function apiCall(method: string, path: string, bearer: string, body: unknown): Promise<ApiReply> {
    const t = live(bearer);
    if (t === undefined) return apiErr(403, 10000, "Authentication error");
    const o = override.get(`${method} ${path}`);
    if (o !== undefined) return o;
    const p = path.split("?")[0]!;
    if (p === "/user" || p === "/memberships") {
      const sub = issuedSub.get(bearer)!;
      const m = members.get(sub);
      if (p === "/user") return { status: 200, body: { success: true, result: { id: sub, ...(m?.email === undefined ? {} : { email: m.email }) } } };
      const result = m?.roles === undefined ? [] : [{ id: "mem1", account: { id: ACCOUNT, name: "Acct" }, status: "accepted", roles: [...m.roles] }];
      return { status: 200, body: { success: true, result, result_info: { page: 1, total_pages: 1 } } };
    }
    const needs = scopeFor(method, path)!;
    if (!t.scope.includes(needs) && !(ALSO[needs] !== undefined && t.scope.includes(ALSO[needs]))) {
      // §2.1, third sign-in: the Workers list without its scope is filtered, not refused; D1 and
      // R2 never asked for answer code 10000; anything else asked for but unticked, 9109.
      if (method === "GET" && /^\/accounts\/[^/]+\/workers\/scripts$/.test(p)) return { status: 200, body: { success: true, errors: [], messages: [], result: [] } };
      if (!t.requested.includes(needs) && needs === "d1.write") return apiErr(401, 10000, "Authentication error");
      if (!t.requested.includes(needs) && needs === "workers-r2.write") return apiErr(403, 10000, "Authentication error");
      return apiErr(403, 9109, "Unauthorized to access requested resource");
    }
    if (method === "POST" && /^\/accounts\/[^/]+\/tokens$/.test(p)) {
      const groups = ((body as { policies?: { permission_groups?: { id?: string; name?: string }[] }[] } | undefined)?.policies ?? []).flatMap((x) => x.permission_groups ?? []);
      const uncovered = groups.filter((g) => !t.scope.includes(GROUP_SCOPE[g.name ?? ""] ?? "-"));
      if (uncovered.length > 0) return apiErr(400, 1001, "The OAuth session does not include the scopes required for the requested permission groups");
    }
    if (options.account === undefined) return apiErr(404, 7003, "No route for that URI");
    return options.account(method as Parameters<CloudflareApi>[0], path, body);
  }
  const issuedSub = new Map<string, string>();

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    requests.push(`${req.method} ${url.origin}${url.pathname}`);
    if (req.method === "GET" && req.url === DISCOVERY) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/auth`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        revocation_endpoint: `${ISSUER}/oauth2/revoke`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        code_challenge_methods_supported: ["plain", "S256"],
      });
    }
    if (req.method === "GET" && req.url === `${ISSUER}/.well-known/jwks.json`) return json({ keys: [key.jwk] });
    if (req.method === "POST" && req.url === `${ISSUER}/oauth2/token`) {
      const form = new URLSearchParams(await req.text());
      const code = form.get("code") ?? "";
      const p = pending.get(code);
      pending.delete(code);
      const ok =
        p !== undefined &&
        form.get("grant_type") === "authorization_code" &&
        form.get("client_id") === CLIENT_ID &&
        form.get("client_secret") === CLIENT_SECRET &&
        form.get("redirect_uri") === p.redirectUri &&
        (await s256Challenge(form.get("code_verifier") ?? "")) === p.challenge;
      if (!ok) return json({ error: "invalid_grant" }, 400);
      const access = `at-${String(next++)}-${random()}`;
      const refresh = `rt-${String(next++)}-${random()}`;
      issued.push({ access, refresh, revokedAccess: false, revokedRefresh: false, scope: [...p.scope, "offline_access"], requested: p.requested });
      issuedSub.set(access, p.sub);
      const m = members.get(p.sub);
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = { iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 3600, sub: p.sub, nonce: p.nonce };
      if (m?.email !== undefined) Object.assign(claims, { email: m.email, email_verified: m.emailVerified ?? true });
      const idToken = await key.sign({ ...claims, ...self.idTokenClaims });
      return json({ access_token: access, refresh_token: refresh, id_token: idToken, token_type: "bearer", expires_in: 3600, ...(options.omitScope === true ? {} : { scope: [...p.scope, "offline_access"].join(" ") }) });
    }
    if (req.method === "POST" && req.url === `${ISSUER}/oauth2/revoke`) {
      const form = new URLSearchParams(await req.text());
      if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return json({ error: "invalid_client" }, 401);
      const token = form.get("token") ?? "";
      for (const t of issued) {
        if (t.access === token) t.revokedAccess = true;
        if (t.refresh === token) t.revokedRefresh = true;
      }
      return new Response(null, { status: 200 });
    }
    if (url.href.startsWith(`${API_BASE}/`)) {
      const path = url.href.slice(API_BASE.length);
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const text = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
      let body: unknown;
      if (text !== "") body = (req.headers.get("content-type") ?? "").startsWith("application/json") ? (JSON.parse(text) as unknown) : text;
      const r = await apiCall(req.method, path, bearer, body);
      return json(r.body, r.status);
    }
    return new Response("not found", { status: 404 });
  };

  const self: FakeCloudflare = {
    fetch: handler as typeof fetch,
    key,
    members,
    requests,
    issued,
    override,
    idTokenClaims: {},
    consent(authorizeUrl, as) {
      const u = new URL(authorizeUrl);
      const redirect = new URL(u.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("state", u.searchParams.get("state") ?? "");
      if (as.decline === true) {
        redirect.searchParams.set("error", "access_denied");
        return redirect.toString();
      }
      const scope = (u.searchParams.get("scope") ?? "").split(" ").filter((s) => s !== "" && !(as.untick ?? []).includes(s));
      const code = `code-${String(next++)}-${random()}`;
      const requested = (u.searchParams.get("scope") ?? "").split(" ").filter((s) => s !== "");
      pending.set(code, { sub: as.sub, scope, requested, nonce: u.searchParams.get("nonce") ?? "", challenge: u.searchParams.get("code_challenge") ?? "", redirectUri: redirect.origin + redirect.pathname });
      redirect.searchParams.set("code", code);
      return redirect.toString();
    },
  };
  return self;
}
