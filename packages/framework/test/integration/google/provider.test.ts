/**
 * GOOGLE login provider, offline (governing prompt §4: hand-built tokens, `fetch` stubbed,
 * nothing contacts Google). docs/components/google.md:
 * GOOGLE-AC-001 local part (GOOGLE-REQ-001: authorization-code flow with PKCE, state, nonce;
 *   token exchange on the server with the client secret and the PKCE verifier),
 * GOOGLE-AC-002 (GOOGLE-REQ-002: ID token validation; PAR-252 = 60 s clock skew),
 * GOOGLE-AC-003 (GOOGLE-REQ-003: scope exactly `openid profile`).
 * The certification step-1 check against a production deployment (GOOGLE-AC-001 cloud part)
 * is not-run in this phase ("Google login mocked for this phase").
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FrameworkError } from "../../../src/index.js";
import { tag } from "../../../../../tests/support/tags.js";
import type { BeginLoginResult, LoginProvider } from "../../../../../docs/contracts/ts/internal/login-provider.js";
import {
  AUTHORIZATION_ENDPOINT,
  CALLBACK_URL,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  TOKEN_ENDPOINT,
  googleProvider,
  idToken,
  makeKeys,
  providerContext,
  s256,
  stubGoogleFetch,
  tokenJson,
  type Claims,
  type Keys,
  type RecordedRequest,
} from "./support.js";

let keys: Keys;
beforeAll(async () => {
  keys = await makeKeys();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUTH_CODE = "fake-authorization-code-4/0Ab";

interface Begun {
  readonly provider: LoginProvider;
  readonly ctx: ReturnType<typeof providerContext>;
  readonly begin: BeginLoginResult;
  readonly redirect: URL;
  readonly fetchState: ReturnType<typeof stubGoogleFetch>;
}

async function begin(): Promise<Begun> {
  const fetchState = stubGoogleFetch(keys);
  const provider = await googleProvider();
  const ctx = providerContext();
  const result = await provider.beginLogin(ctx);
  return { provider, ctx, begin: result, redirect: new URL(result.redirectUrl), fetchState };
}

/** Completes the login with the token endpoint answering an ID token built from `claims`. */
async function completeWith(b: Begun, claims: (nonce: string) => Claims, signWith?: CryptoKey, extraHeader?: Record<string, string>) {
  const nonce = b.redirect.searchParams.get("nonce") ?? "";
  b.fetchState.tokenResponse = async () => tokenJson(await idToken(signWith ?? keys.privateKey, claims(nonce), extraHeader));
  const state = b.redirect.searchParams.get("state") ?? "";
  return b.provider.completeLogin(b.ctx, new URLSearchParams({ code: AUTH_CODE, state, scope: "openid profile" }), b.begin.transactionState);
}

async function expectLoginFailed(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "completeLogin must reject").toBeInstanceOf(FrameworkError);
  expect((error as FrameworkError).code).toBe("AUTH.LOGIN_FAILED");
}

function tokenRequests(b: Begun): RecordedRequest[] {
  return b.fetchState.requests.filter((r) => r.url === TOKEN_ENDPOINT);
}

describe("GOOGLE authorization request", () => {
  it(tag("GOOGLE-AC-001", "local part: the login redirect carries an S256 PKCE challenge, a state and a nonce, for the configured client and callback"), async () => {
    const b = await begin();
    expect(`${b.redirect.origin}${b.redirect.pathname}`).toBe(AUTHORIZATION_ENDPOINT);
    const q = b.redirect.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(FAKE_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge") ?? "").toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((q.get("state") ?? "").length).toBeGreaterThanOrEqual(16);
    expect((q.get("nonce") ?? "").length).toBeGreaterThanOrEqual(16);
    // Random per login.
    const again = await (await googleProvider()).beginLogin(providerContext());
    const q2 = new URL(again.redirectUrl).searchParams;
    expect(q2.get("state")).not.toBe(q.get("state"));
    expect(q2.get("nonce")).not.toBe(q.get("nonce"));
    expect(q2.get("code_challenge")).not.toBe(q.get("code_challenge"));
    // The browser never sees the verifier or the client secret.
    expect(b.begin.redirectUrl).not.toContain(FAKE_CLIENT_SECRET);
    expect(b.fetchState.unexpected).toStrictEqual([]);
  });

  it(tag("GOOGLE-AC-001", "local part, fetch stubbed: the token request is made from the server with the client secret and the PKCE verifier"), async () => {
    const b = await begin();
    // Nothing is exchanged before the callback.
    expect(tokenRequests(b)).toStrictEqual([]);
    const identity = await completeWith(b, (nonce) => ({ nonce, sub: "subject-42", name: "Test Person" }));
    expect(identity).toStrictEqual({ subject: "subject-42", displayName: "Test Person" });

    const requests = tokenRequests(b);
    expect(requests).toHaveLength(1);
    const req = requests[0] as RecordedRequest;
    expect(req.method).toBe("POST");
    expect(req.headers.get("content-type") ?? "").toMatch(/^application\/x-www-form-urlencoded/);
    const form = new URLSearchParams(req.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe(AUTH_CODE);
    expect(form.get("redirect_uri")).toBe(CALLBACK_URL);
    const verifier = form.get("code_verifier") ?? "";
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(s256(verifier)).toBe(b.redirect.searchParams.get("code_challenge"));
    // Client authentication with the client secret: in the body or as HTTP Basic.
    const basic = req.headers.get("authorization");
    if (basic !== null) {
      expect(basic).toBe(`Basic ${Buffer.from(`${encodeURIComponent(FAKE_CLIENT_ID)}:${encodeURIComponent(FAKE_CLIENT_SECRET)}`).toString("base64")}`);
    } else {
      expect(form.get("client_id")).toBe(FAKE_CLIENT_ID);
      expect(form.get("client_secret")).toBe(FAKE_CLIENT_SECRET);
    }
    expect(b.ctx.secretsRead.some((n) => /google/i.test(n))).toBe(true);
    expect(b.fetchState.unexpected).toStrictEqual([]);
  });
});

describe("GOOGLE scope", () => {
  it(tag("GOOGLE-AC-003", "the authorization request's scope is exactly openid profile"), async () => {
    const b = await begin();
    const scopes = b.redirect.searchParams.getAll("scope");
    expect(scopes).toHaveLength(1);
    expect((scopes[0] ?? "").split(" ").sort()).toStrictEqual(["openid", "profile"]);
    expect(scopes[0]).toBe("openid profile");
  });
});

describe("GOOGLE ID token validation", () => {
  const now = (): number => Math.floor(Date.now() / 1000);

  it(tag("GOOGLE-AC-002", "a valid token is accepted (control); tokens within the PAR-252 skew are accepted"), async () => {
    expect(await completeWith(await begin(), (nonce) => ({ nonce, sub: "s-valid" }))).toStrictEqual({ subject: "s-valid", displayName: null });
    expect((await completeWith(await begin(), (nonce) => ({ nonce, sub: "s-skew-exp", exp: now() - 30, iat: now() - 3600 }))).subject).toBe("s-skew-exp");
    expect((await completeWith(await begin(), (nonce) => ({ nonce, sub: "s-skew-iat", iat: now() + 30 }))).subject).toBe("s-skew-iat");
    // The other documented Google issuer value is accepted too.
    expect((await completeWith(await begin(), (nonce) => ({ nonce, sub: "s-iss2", iss: "accounts.google.com" }))).subject).toBe("s-iss2");
  });

  it(tag("GOOGLE-AC-002", "rejects a token with a wrong signature"), async () => {
    const b = await begin();
    await expectLoginFailed(completeWith(b, (nonce) => ({ nonce }), keys.otherPrivateKey));
    expect(b.fetchState.unexpected).toStrictEqual([]);
  });

  it(tag("GOOGLE-AC-002", "rejects a token with a wrong issuer"), async () => {
    for (const iss of ["https://evil.example", "https://accounts.google.com.evil.example", "http://accounts.google.com"]) {
      await expectLoginFailed(completeWith(await begin(), (nonce) => ({ nonce, iss })));
    }
  });

  it(tag("GOOGLE-AC-002", "rejects a token with a wrong audience"), async () => {
    await expectLoginFailed(completeWith(await begin(), (nonce) => ({ nonce, aud: "another-fake-client-id.invalid" })));
  });

  it(tag("GOOGLE-AC-002", "rejects an expired token (beyond PAR-252)"), async () => {
    await expectLoginFailed(completeWith(await begin(), (nonce) => ({ nonce, iat: now() - 7200, exp: now() - 120 })));
  });

  it(tag("GOOGLE-AC-002", "rejects a token whose issued-at time is in the future beyond PAR-252"), async () => {
    await expectLoginFailed(completeWith(await begin(), (nonce) => ({ nonce, iat: now() + 120, exp: now() + 3720 })));
  });

  it(tag("GOOGLE-AC-002", "rejects a token with a wrong or missing nonce"), async () => {
    await expectLoginFailed(completeWith(await begin(), () => ({ nonce: "not-the-transaction-nonce" })));
    await expectLoginFailed(completeWith(await begin(), () => ({})));
    // A nonce from another login transaction.
    const other = await begin();
    const otherNonce = other.redirect.searchParams.get("nonce") ?? "";
    await expectLoginFailed(completeWith(await begin(), () => ({ nonce: otherNonce })));
  });

  it(tag("GOOGLE-AC-002", "never fetches URLs taken from the token itself"), async () => {
    const b = await begin();
    await completeWith(b, (nonce) => ({ nonce, sub: "s-jku" }), undefined, {
      jku: "https://evil.example/jwks.json",
      x5u: "https://evil.example/cert.pem",
    }).then(
      () => undefined,
      () => undefined,
    );
    expect(b.fetchState.unexpected).toStrictEqual([]);
    expect(b.fetchState.requests.map((r) => r.url).filter((u) => u.includes("evil.example"))).toStrictEqual([]);
  });
});
