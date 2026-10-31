/**
 * The callback's sign-in steps (plan §4.1 step 3.1–3.6): exchange, ID-token check, email (with the
 * `/user` fallback), membership and role, and revocation of both tokens on every path once they
 * exist (§7 "the tokens being revoked in the callback"). Against the fake upstream; no network.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SignInError } from "./errors.js";
import { ACCESS_TOKEN, FAKE_ACCOUNT, FAKE_API, FAKE_CLIENT_ID, FAKE_DISCOVERY, REFRESH_TOKEN, fakeUpstream, makeSigningKey, type FakeUpstreamOptions, type SignedKey } from "./fake-upstream.test-support.js";
import { completeSignIn, type SignInDeps } from "./sign-in.js";

let key: SignedKey;
beforeAll(async () => {
  key = await makeSigningKey();
});

const NONCE = "nonce-xyz";
const VERIFIER = "verifier-abc";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const member = (roles: string[], account = FAKE_ACCOUNT, status = "accepted") => ({ account: { id: account }, status, roles });

function setup(over: Partial<FakeUpstreamOptions> = {}) {
  const expect_ = { clientSecret: "client-secret-value", code: "upstream-code-123", redirectUri: "https://auth.example.test/callback", challenge: CHALLENGE };
  const up = fakeUpstream({ key, expect: expect_, claims: { sub: "sub-1", nonce: NONCE, email: "a@example.com", email_verified: true }, membershipPages: [[member(["HTTP Applications Read"])]], ...over });
  const logs: string[] = [];
  const deps: SignInDeps = {
    fetch: up.fetch,
    log: (line) => logs.push(line),
    config: { clientId: FAKE_CLIENT_ID, clientSecret: "client-secret-value", accountId: FAKE_ACCOUNT, discoveryUrl: FAKE_DISCOVERY, apiBase: FAKE_API, callbackUrl: "https://auth.example.test/callback" },
  };
  const run = (verifier = VERIFIER) => completeSignIn(deps, { code: "upstream-code-123", verifier, nonce: NONCE });
  return { up, logs, run, deps };
}

async function refused(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => undefined, (err: unknown) => err);
  expect(e).toBeInstanceOf(SignInError);
  return (e as SignInError).reason;
}

describe("completeSignIn", () => {
  it("returns sub, email and role, and revokes both tokens", async () => {
    const { up, run } = setup();
    await expect(run()).resolves.toEqual({ sub: "sub-1", email: "a@example.com", role: "user" });
    expect(up.revoked().sort()).toEqual([ACCESS_TOKEN, REFRESH_TOKEN].sort());
  });

  it("maps an admin membership to admin", async () => {
    const { run } = setup({ membershipPages: [[member(["Super Administrator - All Privileges"])]] });
    await expect(run()).resolves.toMatchObject({ role: "admin" });
  });

  it("sends the exact callback URL and the PKCE verifier in the exchange", async () => {
    const { up, run } = setup();
    await run();
    const ex = up.requests.find((r) => r.url.endsWith("/oauth2/token"))!;
    expect(ex.body.get("redirect_uri")).toBe("https://auth.example.test/callback");
    expect(ex.body.get("code_verifier")).toBe("verifier-abc");
  });

  it("is refused by the issuer when the PKCE verifier does not match the challenge", async () => {
    const { up, run } = setup();
    expect(await refused(run("not-the-verifier"))).toBe("token exchange rejected (400)");
    expect(up.revoked()).toHaveLength(0);
  });

  it("reads /user when the ID token has no email (plan §10)", async () => {
    const { up, run } = setup({ claims: { sub: "sub-1", nonce: NONCE }, user: { id: "sub-1", email: "user@example.com" } });
    await expect(run()).resolves.toMatchObject({ email: "user@example.com" });
    expect(up.requests.some((r) => r.url.endsWith("/user"))).toBe(true);
  });

  it("does not call /user when the ID token has the email", async () => {
    const { up, run } = setup();
    await run();
    expect(up.requests.some((r) => r.url.endsWith("/user"))).toBe(false);
  });

  it("refuses when no email can be found, and revokes", async () => {
    const { up, run } = setup({ claims: { sub: "sub-1", nonce: NONCE }, user: { id: "sub-1" } });
    expect(await refused(run())).toBe("no email");
    expect(up.revoked()).toHaveLength(2);
  });

  it("refuses an email the ID token marks unverified, and revokes", async () => {
    const { up, run } = setup({ claims: { sub: "sub-1", nonce: NONCE, email: "a@example.com", email_verified: false } });
    expect(await refused(run())).toBe("email not verified");
    expect(up.revoked()).toHaveLength(2);
  });

  it("refuses a wrong nonce, and revokes", async () => {
    const { up, run } = setup({ claims: { sub: "sub-1", nonce: "other" } });
    expect(await refused(run())).toBe("id token: wrong nonce");
    expect(up.revoked()).toHaveLength(2);
  });

  it("refuses without an accepted membership of this account, and revokes", async () => {
    for (const pages of [[[member(["Administrator"], "other-account")]], [[member(["Administrator"], FAKE_ACCOUNT, "pending")]], [[]]]) {
      const { up, run } = setup({ membershipPages: pages });
      expect(await refused(run())).toBe("no accepted membership in this account");
      expect(up.revoked()).toHaveLength(2);
    }
  });

  it("refuses when /memberships is refused, and revokes", async () => {
    const { up, run } = setup({ membershipsStatus: 403 });
    expect(await refused(run())).toBe("memberships failed (403)");
    expect(up.revoked()).toHaveLength(2);
  });

  it("refuses a rejected exchange; there is nothing to revoke", async () => {
    const { up, run } = setup({ tokenStatus: 400 });
    expect(await refused(run())).toBe("token exchange rejected (400)");
    expect(up.revoked()).toHaveLength(0);
  });

  it("still signs in when revocation fails, and logs one warn without any token", async () => {
    const { logs, run } = setup({ revokeStatus: 503 });
    await expect(run()).resolves.toMatchObject({ sub: "sub-1" });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toEqual({ level: "warn", component: "AUTH_APP", message: "token revocation failed (access_token, refresh_token)" });
  });

  it("refuses a 200 without an id_token and still revokes the tokens it did get (plan §2.1)", async () => {
    const { up, run, deps } = setup();
    const inner = deps.fetch;
    (deps as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (!String(input).endsWith("/oauth2/token") || res.status !== 200) return res;
      const { id_token: _drop, ...rest } = (await res.json()) as Record<string, unknown>;
      return Response.json(rest);
    }) as typeof fetch;
    expect(await refused(run())).toBe("token exchange: no id token");
    expect(up.revoked().sort()).toEqual([ACCESS_TOKEN, REFRESH_TOKEN].sort());
  });

  it("revokes on every later failure: JWKS, expired token, /user, /memberships unreachable", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases: [Partial<FakeUpstreamOptions>, string, ((u: string) => boolean)?][] = [
      [{}, "jwks failed: unreachable", (u) => u.endsWith("/jwks.json")],
      [{ claims: { sub: "sub-1", nonce: NONCE, email: "a@example.com", exp: now - 3600 } }, "id token: expired"],
      [{ claims: { sub: "sub-1", nonce: NONCE } }, "user lookup failed: unreachable", (u) => u.endsWith("/user")],
      [{}, "memberships failed: unreachable", (u) => u.includes("/memberships")],
    ];
    for (const [over, why, down] of cases) {
      const { up, run, deps } = setup(over);
      if (down !== undefined) {
        const inner = deps.fetch;
        (deps as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => (down(String(input)) ? Promise.reject(new TypeError("fetch failed")) : inner(input, init))) as typeof fetch;
      }
      expect(await refused(run()), why).toBe(why);
      expect(up.revoked(), why).toHaveLength(2);
    }
  });

  it("logs the failed kinds, and no token, when the revoke request itself throws", async () => {
    const { run, deps, logs } = setup();
    const inner = deps.fetch;
    (deps as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith("/revoke") ? Promise.reject(new TypeError("fetch failed")) : inner(input, init))) as typeof fetch;
    await expect(run()).resolves.toMatchObject({ sub: "sub-1" });
    expect(logs).toEqual([JSON.stringify({ level: "warn", component: "AUTH_APP", message: "token revocation failed (access_token, refresh_token)" })]);
  });

  it("never puts the code, verifier, tokens or client secret in a refusal", async () => {
    const { run } = setup({ claims: { sub: "sub-1", nonce: "other" } });
    const e = (await run().catch((err: unknown) => err)) as Error;
    for (const secret of ["upstream-code-123", "verifier-abc", ACCESS_TOKEN, REFRESH_TOKEN, "client-secret-value"]) expect(String(e.message)).not.toContain(secret);
  });
});
