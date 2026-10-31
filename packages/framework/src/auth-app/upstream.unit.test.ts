/**
 * The auth app's calls upstream (plan §2.1, §4.1 steps 2–3): discovery, the authorize URL with
 * PKCE S256 and state/nonce, the code exchange, the JWKS, revocation, `/user` and `/memberships`.
 * Against the fake upstream (injected fetch, no network).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { SignInError } from "./errors.js";
import { ACCESS_TOKEN, FAKE_API, FAKE_CLIENT_ID, FAKE_DISCOVERY, FAKE_ISSUER, REFRESH_TOKEN, fakeUpstream, makeSigningKey, type SignedKey } from "./fake-upstream.test-support.js";
import { SIGN_IN_SCOPES } from "./params.js";
import { authorizeUrl, exchangeCode, fetchMemberships, fetchUserEmail, loadDiscovery, loadJwks, revokeTokens } from "./upstream.js";

let key: SignedKey;
beforeAll(async () => {
  key = await makeSigningKey();
});
const client = { clientId: FAKE_CLIENT_ID, clientSecret: "secret-1" };
const CALLBACK = "https://auth.example.test/callback";

async function reason(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => undefined, (err: unknown) => err);
  expect(e).toBeInstanceOf(SignInError);
  return (e as SignInError).reason;
}

describe("discovery", () => {
  it("reads the endpoints from the discovery document", async () => {
    const up = fakeUpstream({ key });
    await expect(loadDiscovery(up.fetch, FAKE_DISCOVERY)).resolves.toEqual({
      issuer: FAKE_ISSUER,
      authorizationEndpoint: `${FAKE_ISSUER}/oauth2/auth`,
      tokenEndpoint: `${FAKE_ISSUER}/oauth2/token`,
      revocationEndpoint: `${FAKE_ISSUER}/oauth2/revoke`,
      jwksUri: `${FAKE_ISSUER}/.well-known/jwks.json`,
    });
  });

  it("refuses a document without a required endpoint, or without S256", async () => {
    expect(await reason(loadDiscovery(fakeUpstream({ key, discovery: { revocation_endpoint: undefined } }).fetch, FAKE_DISCOVERY))).toBe("discovery: missing revocation_endpoint");
    expect(await reason(loadDiscovery(fakeUpstream({ key, discovery: { token_endpoint: "not a url" } }).fetch, FAKE_DISCOVERY))).toBe("discovery: missing token_endpoint");
    expect(await reason(loadDiscovery(fakeUpstream({ key, discovery: { code_challenge_methods_supported: ["plain"] } }).fetch, FAKE_DISCOVERY))).toBe("discovery: no S256");
  });

  it("refuses an unreachable document", async () => {
    expect(await reason(loadDiscovery(fakeUpstream({ key }).fetch, "https://nowhere.example.test/x"))).toBe("discovery failed (404)");
  });
});

describe("authorizeUrl", () => {
  it("asks for code with PKCE S256, state, nonce, the exact callback and the PAR-415 scopes", async () => {
    const d = await loadDiscovery(fakeUpstream({ key }).fetch, FAKE_DISCOVERY);
    const url = new URL(authorizeUrl(d, { clientId: FAKE_CLIENT_ID, redirectUri: CALLBACK, state: "st", nonce: "no", challenge: "ch" }));
    expect(`${url.origin}${url.pathname}`).toBe(`${FAKE_ISSUER}/oauth2/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: FAKE_CLIENT_ID,
      redirect_uri: CALLBACK,
      scope: SIGN_IN_SCOPES,
      state: "st",
      nonce: "no",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("exchangeCode", () => {
  it("posts the code, verifier and client credentials, and returns the tokens", async () => {
    const up = fakeUpstream({ key, expect: { clientSecret: "secret-1", code: "c1", redirectUri: CALLBACK } });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    const tokens = await exchangeCode(up.fetch, d, { ...client, code: "c1", verifier: "v1", redirectUri: CALLBACK });
    expect(tokens.accessToken).toBe(ACCESS_TOKEN);
    expect(tokens.refreshToken).toBe(REFRESH_TOKEN);
    expect(tokens.idToken!.split(".")).toHaveLength(3);
    const sent = up.requests.find((r) => r.url === `${FAKE_ISSUER}/oauth2/token`)!;
    expect(Object.fromEntries(sent.body)).toEqual({ grant_type: "authorization_code", code: "c1", code_verifier: "v1", redirect_uri: CALLBACK, client_id: FAKE_CLIENT_ID, client_secret: "secret-1" });
  });

  it("names the status when the exchange is rejected", async () => {
    const up = fakeUpstream({ key, tokenStatus: 400 });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    expect(await reason(exchangeCode(up.fetch, d, { ...client, code: "c", verifier: "v", redirectUri: CALLBACK }))).toBe("token exchange rejected (400)");
  });
});

describe("loadJwks", () => {
  it("returns the keys", async () => {
    const up = fakeUpstream({ key });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await expect(loadJwks(up.fetch, d)).resolves.toEqual([key.jwk]);
  });
});

describe("revokeTokens", () => {
  const both = [
    { token: ACCESS_TOKEN, hint: "access_token" as const },
    { token: REFRESH_TOKEN, hint: "refresh_token" as const },
  ];

  it("revokes each token with its type hint and the client credentials, and reports no failure", async () => {
    const up = fakeUpstream({ key });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await expect(revokeTokens(up.fetch, d, client, both)).resolves.toEqual([]);
    expect(up.revoked()).toEqual([ACCESS_TOKEN, REFRESH_TOKEN]);
    const sent = up.requests.filter((r) => r.url.endsWith("/revoke")).map((r) => [r.body.get("token_type_hint"), r.body.get("client_secret")]);
    expect(sent).toEqual([["access_token", "secret-1"], ["refresh_token", "secret-1"]]);
  });

  it("tries every token even when one fails, names the failed kinds (never a value), and never throws", async () => {
    const up = fakeUpstream({ key, revokeStatus: 503 });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await expect(revokeTokens(up.fetch, d, client, both)).resolves.toEqual(["access_token", "refresh_token"]);
    expect(up.revoked()).toHaveLength(2);
    const throwing = (() => Promise.reject(new Error("network"))) as typeof fetch;
    await expect(revokeTokens(throwing, d, client, both.slice(1))).resolves.toEqual(["refresh_token"]);
  });
});

describe("upstream failures (no redirects followed, fixed reasons, no secrets)", () => {
  const SECRET = "client-secret-SENTINEL";
  const raw = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;

  it("sends every upstream request with redirect: error, so a 3xx never re-posts the secret", async () => {
    const up = fakeUpstream({ key, expect: { clientSecret: SECRET } });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await exchangeCode(up.fetch, d, { clientId: FAKE_CLIENT_ID, clientSecret: SECRET, code: "c", verifier: "v", redirectUri: CALLBACK });
    await loadJwks(up.fetch, d);
    await revokeTokens(up.fetch, d, { clientId: FAKE_CLIENT_ID, clientSecret: SECRET }, [{ token: ACCESS_TOKEN, hint: "access_token" }]);
    await fetchUserEmail(up.fetch, FAKE_API, ACCESS_TOKEN);
    await fetchMemberships(up.fetch, FAKE_API, ACCESS_TOKEN);
    expect(up.requests.map((r) => r.redirect)).toEqual(Array(up.requests.length).fill("error"));
  });

  it("names an unreachable endpoint", async () => {
    const down = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    expect(await reason(loadDiscovery(down, FAKE_DISCOVERY))).toBe("discovery failed: unreachable");
  });

  it("refuses a non-JSON or array body", async () => {
    expect(await reason(loadDiscovery(raw(200, "<html>"), FAKE_DISCOVERY))).toBe("discovery failed: malformed response");
    expect(await reason(loadDiscovery(raw(200, "[]"), FAKE_DISCOVERY))).toBe("discovery failed: malformed response");
  });

  it("refuses a discovery document with no issuer or no PKCE methods listed", async () => {
    expect(await reason(loadDiscovery(fakeUpstream({ key, discovery: { issuer: "" } }).fetch, FAKE_DISCOVERY))).toBe("discovery: missing issuer");
    expect(await reason(loadDiscovery(fakeUpstream({ key, discovery: { code_challenge_methods_supported: undefined } }).fetch, FAKE_DISCOVERY))).toBe("discovery: no S256");
  });

  it("returns whatever tokens a 200 holds, so the caller can revoke them even without an id_token", async () => {
    const d = await loadDiscovery(fakeUpstream({ key }).fetch, FAKE_DISCOVERY);
    const tokenOnly = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
    const params = { ...client, code: "c", verifier: "v", redirectUri: CALLBACK };
    await expect(exchangeCode(tokenOnly({ access_token: "a", refresh_token: "r" }), d, params)).resolves.toEqual({ accessToken: "a", refreshToken: "r", idToken: null });
    await expect(exchangeCode(tokenOnly({ access_token: "a", id_token: "i" }), d, params)).resolves.toEqual({ accessToken: "a", refreshToken: null, idToken: "i" });
    await expect(exchangeCode(tokenOnly({ id_token: "i", access_token: 5 }), d, params)).resolves.toEqual({ accessToken: null, refreshToken: null, idToken: "i" });
  });

  it("refuses a JWKS without keys, a refused /user, and /memberships without a result list or success", async () => {
    const d = await loadDiscovery(fakeUpstream({ key }).fetch, FAKE_DISCOVERY);
    expect(await reason(loadJwks(raw(200, "{}"), d))).toBe("jwks failed: malformed response");
    expect(await reason(fetchUserEmail(raw(403, "{}"), FAKE_API, ACCESS_TOKEN))).toBe("user lookup failed (403)");
    expect(await reason(fetchMemberships(raw(200, JSON.stringify({ success: true, result: {} })), FAKE_API, ACCESS_TOKEN))).toBe("memberships failed: malformed response");
    expect(await reason(fetchMemberships(raw(200, JSON.stringify({ success: false, result: [] })), FAKE_API, ACCESS_TOKEN))).toBe("memberships failed: not successful");
  });

  it("stops after 20 pages of /memberships", async () => {
    const pages = Array.from({ length: 25 }, (_, i) => [{ account: { id: `a${i}` }, status: "accepted", roles: [] }]);
    const up = fakeUpstream({ key, membershipPages: pages });
    await expect(fetchMemberships(up.fetch, FAKE_API, ACCESS_TOKEN)).resolves.toHaveLength(20);
  });

  it("never puts the code, verifier, client secret or a token in a refusal", async () => {
    const d = await loadDiscovery(fakeUpstream({ key }).fetch, FAKE_DISCOVERY);
    const echo = (async (_i: unknown, init?: RequestInit) => new Response(String(init?.body ?? ""), { status: 400 })) as unknown as typeof fetch;
    const errors = await Promise.all([
      exchangeCode(echo, d, { clientId: FAKE_CLIENT_ID, clientSecret: SECRET, code: "CODE-SENTINEL", verifier: "VERIFIER-SENTINEL", redirectUri: CALLBACK }).catch((e: unknown) => e),
      fetchUserEmail(echo, FAKE_API, "TOKEN-SENTINEL").catch((e: unknown) => e),
      fetchMemberships(echo, FAKE_API, "TOKEN-SENTINEL").catch((e: unknown) => e),
    ]);
    for (const e of errors) {
      expect(e).toBeInstanceOf(SignInError);
      expect(`${(e as SignInError).reason} ${(e as Error).message}`).not.toMatch(/SENTINEL/);
    }
  });
});

describe("Cloudflare API", () => {
  it("reads the email from /user with the bearer token", async () => {
    const up = fakeUpstream({ key, user: { id: "sub-1", email: "u@example.com" } });
    await expect(fetchUserEmail(up.fetch, FAKE_API, ACCESS_TOKEN)).resolves.toBe("u@example.com");
    expect(up.requests[0]!.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("answers null when /user has no email", async () => {
    const up = fakeUpstream({ key, user: { id: "sub-1" } });
    await expect(fetchUserEmail(up.fetch, FAKE_API, ACCESS_TOKEN)).resolves.toBeNull();
  });

  it("reads every page of /memberships", async () => {
    const a = { account: { id: "a" }, status: "accepted", roles: [] };
    const b = { account: { id: "b" }, status: "accepted", roles: [] };
    const up = fakeUpstream({ key, membershipPages: [[a], [b]] });
    await expect(fetchMemberships(up.fetch, FAKE_API, ACCESS_TOKEN)).resolves.toEqual([a, b]);
    expect(up.requests.every((r) => r.authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true);
  });

  it("names the status when /memberships is refused", async () => {
    const up = fakeUpstream({ key, membershipsStatus: 403 });
    expect(await reason(fetchMemberships(up.fetch, FAKE_API, ACCESS_TOKEN))).toBe("memberships failed (403)");
  });
});
