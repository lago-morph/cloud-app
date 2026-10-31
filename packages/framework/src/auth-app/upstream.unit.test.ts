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
    const up = fakeUpstream({ key });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    const tokens = await exchangeCode(up.fetch, d, { ...client, code: "c1", verifier: "v1", redirectUri: CALLBACK });
    expect(tokens.accessToken).toBe(ACCESS_TOKEN);
    expect(tokens.refreshToken).toBe(REFRESH_TOKEN);
    expect(tokens.idToken.split(".")).toHaveLength(3);
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
  it("revokes each token with the client credentials and reports success", async () => {
    const up = fakeUpstream({ key });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await expect(revokeTokens(up.fetch, d, client, [ACCESS_TOKEN, REFRESH_TOKEN])).resolves.toBe(true);
    expect(up.revoked()).toEqual([ACCESS_TOKEN, REFRESH_TOKEN]);
    const sent = up.requests.filter((r) => r.url.endsWith("/revoke")).map((r) => r.body.get("client_secret"));
    expect(sent).toEqual(["secret-1", "secret-1"]);
  });

  it("tries every token even when one fails, reports false, and never throws", async () => {
    const up = fakeUpstream({ key, revokeStatus: 503 });
    const d = await loadDiscovery(up.fetch, FAKE_DISCOVERY);
    await expect(revokeTokens(up.fetch, d, client, [ACCESS_TOKEN, REFRESH_TOKEN])).resolves.toBe(false);
    expect(up.revoked()).toHaveLength(2);
    const throwing = (() => Promise.reject(new Error("network"))) as typeof fetch;
    await expect(revokeTokens(throwing, d, client, [ACCESS_TOKEN])).resolves.toBe(false);
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
