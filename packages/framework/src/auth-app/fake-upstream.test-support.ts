/**
 * Test support for the auth app's unit tests: a fake upstream (Cloudflare's OAuth endpoints and
 * the two API calls the auth app makes, plan §2.1) behind an injected `fetch`. It signs real
 * RS256 ID tokens with a key made here, so `verifyIdToken` runs its real crypto, and it records
 * every request, so tests can check that tokens were revoked. No network. Never in a bundle.
 */
import { base64urlEncode } from "../auth/signing.js";

export const FAKE_ISSUER = "https://dash.example.test";
export const FAKE_API = "https://api.example.test/client/v4";
export const FAKE_DISCOVERY = `${FAKE_ISSUER}/.well-known/openid-configuration`;
export const FAKE_CLIENT_ID = "signin-client";
export const FAKE_ACCOUNT = "acct-0123";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const b64json = (v: unknown): string => base64urlEncode(text(JSON.stringify(v)));

export interface SignedKey {
  readonly kid: string;
  readonly jwk: JsonWebKey & { kid: string; alg: string; use: string };
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function makeSigningKey(kid = "k1"): Promise<SignedKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    kid,
    jwk: { kty: pub.kty, n: pub.n, e: pub.e, kid, alg: "RS256", use: "sig" },
    async sign(claims, header = {}) {
      const input = `${b64json({ alg: "RS256", typ: "JWT", kid, ...header })}.${b64json(claims)}`;
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, text(input));
      return `${input}.${base64urlEncode(new Uint8Array(sig))}`;
    },
  };
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: URLSearchParams;
  readonly authorization: string | null;
}

export interface FakeUpstreamOptions {
  readonly key: SignedKey;
  /** Claims of the ID token the token endpoint returns (iss, aud, exp, … filled in unless given). */
  claims?: Record<string, unknown>;
  /** The `/user` result. */
  user?: Record<string, unknown>;
  /** `/memberships` result pages (each page one array). */
  membershipPages?: readonly (readonly Record<string, unknown>[])[];
  /** Status the token endpoint answers (200 by default). */
  tokenStatus?: number;
  /** Status the revoke endpoint answers (200 by default). */
  revokeStatus?: number;
  /** Status `/memberships` answers (200 by default). */
  membershipsStatus?: number;
  /** Overrides of the discovery document. */
  discovery?: Record<string, unknown>;
}

export interface FakeUpstream {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
  readonly options: FakeUpstreamOptions;
  /** Requests to the revocation endpoint, by revoked token. */
  revoked(): string[];
}

export const ACCESS_TOKEN = "opaque-access-token";
export const REFRESH_TOKEN = "opaque-refresh-token";

export function fakeUpstream(options: FakeUpstreamOptions): FakeUpstream {
  const requests: RecordedRequest[] = [];
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const body = new URLSearchParams(req.method === "POST" ? await req.text() : "");
    requests.push({ method: req.method, url: req.url, body, authorization: req.headers.get("authorization") });
    const route = `${req.method} ${url.origin}${url.pathname}`;
    switch (route) {
      case `GET ${FAKE_DISCOVERY}`:
        return json({
          issuer: FAKE_ISSUER,
          authorization_endpoint: `${FAKE_ISSUER}/oauth2/auth`,
          token_endpoint: `${FAKE_ISSUER}/oauth2/token`,
          revocation_endpoint: `${FAKE_ISSUER}/oauth2/revoke`,
          jwks_uri: `${FAKE_ISSUER}/.well-known/jwks.json`,
          code_challenge_methods_supported: ["plain", "S256"],
          ...options.discovery,
        });
      case `GET ${FAKE_ISSUER}/.well-known/jwks.json`:
        return json({ keys: [options.key.jwk] });
      case `POST ${FAKE_ISSUER}/oauth2/token`: {
        if ((options.tokenStatus ?? 200) !== 200) return json({ error: "invalid_grant" }, options.tokenStatus);
        const now = Math.floor(Date.now() / 1000);
        const idToken = await options.key.sign({ iss: FAKE_ISSUER, aud: FAKE_CLIENT_ID, iat: now, exp: now + 3600, sub: "sub-1", ...options.claims });
        return json({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, id_token: idToken, token_type: "bearer", expires_in: 3600 });
      }
      case `POST ${FAKE_ISSUER}/oauth2/revoke`:
        return new Response(null, { status: options.revokeStatus ?? 200 });
      case `GET ${FAKE_API}/user`:
        return json({ success: true, result: options.user ?? { id: "sub-1", email: "from-user@example.com" } });
      case `GET ${FAKE_API}/memberships`: {
        if ((options.membershipsStatus ?? 200) !== 200) return json({ success: false }, options.membershipsStatus);
        const pages = options.membershipPages ?? [[]];
        const page = Number(url.searchParams.get("page") ?? "1");
        return json({ success: true, result: pages[page - 1] ?? [], result_info: { page, total_pages: pages.length } });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  };
  return {
    fetch: handler as typeof fetch,
    requests,
    options,
    revoked: () => requests.filter((r) => r.url === `${FAKE_ISSUER}/oauth2/revoke`).map((r) => r.body.get("token") ?? ""),
  };
}
