import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createGoogleLoginProvider, GOOGLE_DISCOVERY_URL } from "./provider.js";
import type { ProviderContext } from "./provider.js";

// Obviously fake values; nothing here contacts Google (prompt §4).
const CLIENT_ID = "fake-client-id.test.invalid";
const CLIENT_SECRET = "fake-client-secret";
const CALLBACK = "https://app.test.invalid/api/auth/callback";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

const discovery = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: AUTH_ENDPOINT,
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: JWKS_URI,
};

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A stubbed fetch answering by URL; records every call. */
function stubFetch(routes: Record<string, () => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError(`stub fetch: no route for ${url}`);
    return route();
  };
  return { fetch: f as typeof fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function context(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    callbackUrl: CALLBACK,
    getSecret: async (name) => {
      if (name === "frameworkGoogleClientSecret") return CLIENT_SECRET;
      throw new Error(`unexpected secret ${name}`);
    },
    getConfig: (key) => (key === "framework.google.clientId" ? CLIENT_ID : undefined),
    ...overrides,
  };
}

describe("Google login provider: beginLogin", () => {
  it(tag("GOOGLE-AC-003", "the authorization request's scope is exactly `openid profile`"), async () => {
    const { fetch } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json(discovery) });
    const provider = createGoogleLoginProvider({ fetch });
    const { redirectUrl } = await provider.beginLogin(context());
    const url = new URL(redirectUrl);
    expect(url.searchParams.getAll("scope")).toEqual(["openid profile"]);
  });
});

describe("Google login provider: authorization request", () => {
  it(tag("GOOGLE-AC-001", "redirects to Google's authorization endpoint with client ID, callback URL, code flow, state, nonce and an S256 PKCE challenge"), async () => {
    const { fetch } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json(discovery) });
    const provider = createGoogleLoginProvider({ fetch });
    const { redirectUrl } = await provider.beginLogin(context());
    const url = new URL(redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(AUTH_ENDPOINT);
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(CALLBACK);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("uses fresh random state, nonce and PKCE verifier for every login", async () => {
    const { fetch } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json(discovery) });
    const provider = createGoogleLoginProvider({ fetch });
    const a = new URL((await provider.beginLogin(context())).redirectUrl).searchParams;
    const b = new URL((await provider.beginLogin(context())).redirectUrl).searchParams;
    for (const name of ["state", "nonce", "code_challenge"]) expect(a.get(name)).not.toBe(b.get(name));
  });
});

describe("Google login provider: discovery and configuration", () => {
  it("fetches the discovery document once per provider instance, from the fixed well-known URL", async () => {
    const { fetch, calls } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json(discovery) });
    const provider = createGoogleLoginProvider({ fetch });
    await provider.beginLogin(context());
    await provider.beginLogin(context());
    expect(calls.map((c) => c.url)).toEqual([GOOGLE_DISCOVERY_URL]);
  });

  it("a failed discovery fetch is AUTH.LOGIN_FAILED 'provider discovery failed' and is retried next time", async () => {
    let status = 500;
    const { fetch, calls } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => (status === 200 ? json(discovery) : json({}, status)) });
    const provider = createGoogleLoginProvider({ fetch });
    const err = await failure(provider.beginLogin(context()));
    expect([err.code, err.message]).toEqual(["AUTH.LOGIN_FAILED", "provider discovery failed (HTTP 500)"]);
    status = 200;
    await provider.beginLogin(context());
    expect(calls).toHaveLength(2);
  });

  it("a discovery document whose endpoints are not https URLs is refused", async () => {
    const { fetch } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json({ ...discovery, token_endpoint: "http://oauth2.googleapis.com/token" }) });
    const err = await failure(createGoogleLoginProvider({ fetch }).beginLogin(context()));
    expect(err.message).toBe("provider discovery failed (invalid document)");
  });

  it("without framework.google.clientId, login is CORE.MISCONFIGURED naming the key", async () => {
    const { fetch } = stubFetch({ [GOOGLE_DISCOVERY_URL]: () => json(discovery) });
    const err = await failure(createGoogleLoginProvider({ fetch }).beginLogin(context({ getConfig: () => undefined })));
    expect([err.code, err.message]).toEqual(["CORE.MISCONFIGURED", "framework.google.clientId is not set"]);
  });
});

// ---- Hand-built ID tokens -------------------------------------------------------------------

const keys = await generateKeyPair("RS256", { extractable: true });
const otherKeys = await generateKeyPair("RS256", { extractable: true });
const KID = "test-key-1";
const jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: "RS256", use: "sig" }] };

interface TokenOverrides {
  readonly iss?: string;
  readonly aud?: string;
  readonly sub?: string;
  readonly nonce?: string | undefined;
  readonly name?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly signWith?: CryptoKey;
}

async function idToken(nonce: string, o: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { nonce: "nonce" in o ? o.nonce : nonce };
  if (o.name !== undefined) claims["name"] = o.name;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(o.iss ?? "https://accounts.google.com")
    .setAudience(o.aud ?? CLIENT_ID)
    .setSubject(o.sub ?? "1234567890")
    .setIssuedAt(o.iat ?? now)
    .setExpirationTime(o.exp ?? now + 3600)
    .sign(o.signWith ?? keys.privateKey);
}

/** Begins a login and answers the token request with the token `makeToken` builds from the nonce. */
async function loginWith(makeToken: (nonce: string) => Promise<string>, tokenStatus = 200) {
  let nonce = "";
  const stub = stubFetch({
    [GOOGLE_DISCOVERY_URL]: () => json(discovery),
    [JWKS_URI]: () => json(jwks),
  });
  let token: string | undefined;
  const fetchWithToken = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === TOKEN_ENDPOINT) {
      stub.calls.push({ url, init });
      token ??= await makeToken(nonce);
      return tokenStatus === 200 ? json({ id_token: token, access_token: "x", token_type: "Bearer" }) : json({ error: "invalid_grant" }, tokenStatus);
    }
    return stub.fetch(input, init);
  }) as typeof fetch;
  const provider = createGoogleLoginProvider({ fetch: fetchWithToken });
  const begin = await provider.beginLogin(context());
  const auth = new URL(begin.redirectUrl).searchParams;
  nonce = auth.get("nonce") ?? "";
  const query = new URLSearchParams({ code: "fake-auth-code", state: auth.get("state") ?? "" });
  return { provider, begin, auth, query, calls: stub.calls };
}

async function failure(p: Promise<unknown>): Promise<FrameworkError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FrameworkError);
  return err as FrameworkError;
}

describe("Google login provider: token exchange", () => {
  it(tag("GOOGLE-AC-001", "the token request is made from the server with the client secret and the PKCE verifier"), async () => {
    const { provider, begin, auth, query, calls } = await loginWith((n) => idToken(n));
    await provider.completeLogin(context(), query, begin.transactionState);
    const tokenCalls = calls.filter((c) => c.url === TOKEN_ENDPOINT);
    expect(tokenCalls).toHaveLength(1);
    const init = tokenCalls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("fake-auth-code");
    expect(form.get("redirect_uri")).toBe(CALLBACK);
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    const verifier = form.get("code_verifier") ?? "";
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(Buffer.from(digest).toString("base64url")).toBe(auth.get("code_challenge"));
  });

  it("returns the token's subject and name as the identity", async () => {
    const { provider, begin, query } = await loginWith((n) => idToken(n, { sub: "sub-42", name: "Test Person" }));
    await expect(provider.completeLogin(context(), query, begin.transactionState)).resolves.toEqual({
      subject: "sub-42",
      displayName: "Test Person",
    });
  });
});

describe("Google login provider: callback failures", () => {
  const reason = async (q: (query: URLSearchParams) => URLSearchParams, opts: { tx?: (tx: string) => string; tokenStatus?: number } = {}) => {
    const { provider, begin, query, calls } = await loginWith((n) => idToken(n), opts.tokenStatus);
    const tx = opts.tx ? opts.tx(begin.transactionState) : begin.transactionState;
    const err = await failure(provider.completeLogin(context(), q(query), tx));
    expect(err.code).toBe("AUTH.LOGIN_FAILED");
    return { message: err.message, tokenCalls: calls.filter((c) => c.url === TOKEN_ENDPOINT).length };
  };

  it("a callback carrying Google's error parameter is 'provider refused', with no token request", async () => {
    const r = await reason((q) => new URLSearchParams({ error: "access_denied", state: q.get("state") ?? "" }));
    expect(r).toEqual({ message: "provider refused", tokenCalls: 0 });
  });

  it("a callback without a code is 'provider refused'", async () => {
    const r = await reason((q) => new URLSearchParams({ state: q.get("state") ?? "" }));
    expect(r).toEqual({ message: "provider refused", tokenCalls: 0 });
  });

  it("a state different from the transaction's is 'state mismatch', with no token request", async () => {
    const r = await reason((q) => new URLSearchParams({ code: q.get("code") ?? "", state: "forged-state" }));
    expect(r).toEqual({ message: "state mismatch", tokenCalls: 0 });
  });

  it("an unreadable transaction state is 'transaction missing or expired'", async () => {
    const r = await reason((q) => q, { tx: () => "not json" });
    expect(r).toEqual({ message: "transaction missing or expired", tokenCalls: 0 });
  });

  it("a token endpoint error is 'token exchange rejected' with its HTTP status", async () => {
    const r = await reason((q) => q, { tokenStatus: 400 });
    expect(r).toEqual({ message: "token exchange rejected (HTTP 400)", tokenCalls: 1 });
  });
});

describe("Google login provider: ID-token validation", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const rejected: ReadonlyArray<readonly [string, (nonce: string) => Promise<string>, string]> = [
    ["a wrong signature", (n) => idToken(n, { signWith: otherKeys.privateKey }), "token check failed: signature"],
    ["a wrong issuer", (n) => idToken(n, { iss: "https://evil.example" }), "token check failed: issuer"],
    ["a wrong audience", (n) => idToken(n, { aud: "other-client.test.invalid" }), "token check failed: audience"],
    ["an expired token (beyond PAR-252)", (n) => idToken(n, { iat: now() - 7200, exp: now() - 61 }), "token check failed: expiry"],
    ["an issued-at time in the future beyond PAR-252", (n) => idToken(n, { iat: now() + 120 }), "token check failed: issued-at"],
    ["a wrong nonce", () => idToken("", { nonce: "some-other-nonce" }), "token check failed: nonce"],
    ["a missing nonce", () => idToken("", { nonce: undefined }), "token check failed: nonce"],
  ];
  for (const [what, make, reason] of rejected) {
    it(tag("GOOGLE-AC-002", `rejects ${what} with AUTH.LOGIN_FAILED naming the check`), async () => {
      const { provider, begin, query } = await loginWith(make);
      const err = await failure(provider.completeLogin(context(), query, begin.transactionState));
      expect(err.code).toBe("AUTH.LOGIN_FAILED");
      expect(err.message).toBe(reason);
    });
  }

  const accepted: ReadonlyArray<readonly [string, (nonce: string) => Promise<string>]> = [
    ["the issuer without scheme, accounts.google.com", (n) => idToken(n, { iss: "accounts.google.com" })],
    ["an issued-at time 30 s in the future (within PAR-252)", (n) => idToken(n, { iat: now() + 30 })],
    ["an expiry 30 s in the past (within PAR-252)", (n) => idToken(n, { iat: now() - 3600, exp: now() - 30 })],
  ];
  it(tag("GOOGLE-AC-002", "never fetches a URL taken from the token (jku and x5u headers are ignored)"), async () => {
    const make = async (n: string) => {
      const t = Math.floor(Date.now() / 1000);
      return new SignJWT({ nonce: n })
        .setProtectedHeader({ alg: "RS256", kid: KID, jku: "https://evil.example/jwks", x5u: "https://evil.example/cert" })
        .setIssuer("https://accounts.google.com")
        .setAudience(CLIENT_ID)
        .setSubject("1234567890")
        .setIssuedAt(t)
        .setExpirationTime(t + 3600)
        .sign(otherKeys.privateKey);
    };
    const { provider, begin, query, calls } = await loginWith(make);
    const err = await failure(provider.completeLogin(context(), query, begin.transactionState));
    expect(err.message).toBe("token check failed: signature");
    expect(calls.map((c) => c.url).filter((u) => u.includes("evil.example"))).toEqual([]);
  });

  for (const [what, make] of accepted) {
    it(`accepts ${what}`, async () => {
      const { provider, begin, query } = await loginWith(make);
      await expect(provider.completeLogin(context(), query, begin.transactionState)).resolves.toMatchObject({ subject: "1234567890" });
    });
  }
});
