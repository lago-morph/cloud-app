/**
 * The auth app end to end over plain HTTP, no browser (plan-v0.2.0 §7 "Integration"; progress §3 A
 * exit check): app `/start` redirect → mock-oauth2-server's authorize (its login form, posted as a
 * browser would) → the auth app's `/callback` → `return?code=…&state=…` → `env.AUTH.redeem` from
 * an app Worker over a real service binding. The auth app runs as its bundle under local workerd
 * with a local D1; mock-oauth2-server enforces PKCE and signs real RS256 ID tokens.
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authAppMiniflareWorkers, bundleAuthAppWorker } from "../../../src/auth-app/worker-bundle.test-support.js";
import { registerReturnUrl, type D1Like } from "../../../src/auth-app/store.js";
import { startMockOAuth2, type MockOAuth2 } from "../../../../../tests/support/mock-oauth2/launcher.js";
import { ACCOUNT_ID, cookieOf, startEdge, type Edge } from "./support.js";

const AUTH_ORIGIN = "http://localhost:8788";
const APP = "notes-local";
const RETURN = "http://localhost:8787/api/auth/callback";

let oauth: MockOAuth2;
let edge: Edge;
let mf: Miniflare;

beforeAll(async () => {
  oauth = await startMockOAuth2();
  edge = await startEdge(oauth.baseUrl);
  mf = new Miniflare({
    workers: authAppMiniflareWorkers(await bundleAuthAppWorker(), {
      AUTH_APP_CLIENT_ID: "signin-client",
      AUTH_APP_CLIENT_SECRET: "signin-secret",
      AUTH_APP_ACCOUNT_ID: ACCOUNT_ID,
      AUTH_APP_ORIGIN: AUTH_ORIGIN,
      AUTH_APP_DISCOVERY_URL: edge.discoveryUrl,
      AUTH_APP_API_BASE: edge.apiBase,
    }),
  });
  // The first request makes the Worker apply its schema; then deploy's registry write (F) is simulated.
  await (await authGet("/")).text();
  await registerReturnUrl((await mf.getD1Database("DB", "auth")) as unknown as D1Like, APP, RETURN);
}, 600_000);

afterAll(async () => {
  await mf?.dispose();
  await edge?.close();
  await oauth?.stop();
});

async function authGet(pathOrUrl: string, cookie?: string): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${AUTH_ORIGIN}${pathOrUrl}`;
  // Miniflare returns its own (undici) Response type; the shape is the same.
  return (await (await mf.getWorker("auth")).fetch(url, { redirect: "manual", headers: cookie === undefined ? {} : { cookie } })) as unknown as Response;
}

async function binding(path: "/redeem" | "/role", body: unknown): Promise<unknown> {
  const res = await (await mf.getWorker("app")).fetch(`https://app.example${path}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`binding ${path}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result?: unknown }).result;
}

interface Person {
  sub: string;
  claims: Record<string, unknown>;
}

/** Runs the browser's part: /start, the issuer's login form, /callback. Returns the final redirect. */
async function signIn(person: Person, appState = "app-state-1"): Promise<URL> {
  const start = await authGet(`/start?${new URLSearchParams({ app: APP, return: RETURN, state: appState })}`);
  expect(start.status).toBe(302);
  const cookie = cookieOf(start);
  const authorize = start.headers.get("location")!;
  expect(authorize.startsWith(`${oauth.baseUrl}/cf/authorize?`)).toBe(true);
  const login = await fetch(authorize, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: person.sub, claims: JSON.stringify({ sub: person.sub, ...person.claims }) }) });
  expect(login.status).toBe(302);
  const callback = login.headers.get("location")!;
  expect(callback.startsWith(`${AUTH_ORIGIN}/callback?`)).toBe(true);
  const done = await authGet(callback, cookie);
  expect(done.status).toBe(302);
  await done.text();
  return new URL(done.headers.get("location")!);
}

const revokedFor = (since: number) => edge.recorded.slice(since).filter((r) => r.path === "/pass/revoke");

describe("auth app sign-in flow against mock-oauth2-server", () => {
  it("signs a member in: redirect, code, redeem once over the binding; both tokens revoked", async () => {
    edge.members.set("sub-user", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: ["HTTP Applications Read"] }] });
    const mark = edge.recorded.length;
    const back = await signIn({ sub: "sub-user", claims: { email: "user@example.com", email_verified: true } });
    expect(`${back.origin}${back.pathname}`).toBe(RETURN);
    expect(back.searchParams.get("state")).toBe("app-state-1");
    const code = back.searchParams.get("code")!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(binding("/redeem", { code, app: APP })).resolves.toEqual({ sub: "sub-user", email: "user@example.com", role: "user" });
    await expect(binding("/redeem", { code, app: APP })).resolves.toBeNull();
    await expect(binding("/role", { sub: "sub-user" })).resolves.toBe("user");

    const exchange = edge.recorded.slice(mark).find((r) => r.path === "/pass/token")!;
    expect(exchange.status).toBe(200);
    expect(exchange.form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(revokedFor(mark).map((r) => [r.form.token_type_hint, r.status])).toEqual([["access_token", 200], ["refresh_token", 200]]);
  });

  it("maps the Super Administrator role to admin", async () => {
    edge.members.set("sub-admin", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: ["Super Administrator - All Privileges"] }] });
    const back = await signIn({ sub: "sub-admin", claims: { email: "admin@example.com", email_verified: true } });
    await expect(binding("/redeem", { code: back.searchParams.get("code"), app: APP })).resolves.toEqual({ sub: "sub-admin", email: "admin@example.com", role: "admin" });
    await expect(binding("/role", { sub: "sub-admin" })).resolves.toBe("admin");
  });

  it("reads /user when the ID token carries no email", async () => {
    edge.members.set("sub-noemail", { email: "from-user@example.com", memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: [] }] });
    const back = await signIn({ sub: "sub-noemail", claims: {} });
    await expect(binding("/redeem", { code: back.searchParams.get("code"), app: APP })).resolves.toMatchObject({ email: "from-user@example.com" });
  });

  it("refuses a person with no accepted membership of this account, and still revokes", async () => {
    edge.members.set("sub-outsider", { memberships: [{ account: { id: "another-account" }, status: "accepted", roles: ["Administrator"] }] });
    const mark = edge.recorded.length;
    const back = await signIn({ sub: "sub-outsider", claims: { email: "o@example.com", email_verified: true } });
    expect(back.toString()).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    expect(revokedFor(mark)).toHaveLength(2);
    await expect(binding("/role", { sub: "sub-outsider" })).resolves.toBeNull();
  });

  it("never redirects to an unregistered return URL", async () => {
    for (const ret of [`${RETURN}/`, "http://localhost:8787/api/auth/callback?x=1", "http://LOCALHOST:8787/api/auth/callback", "https://evil.example/api/auth/callback"]) {
      const res = await authGet(`/start?${new URLSearchParams({ app: APP, return: ret, state: "s" })}`);
      expect(res.status, ret).toBe(400);
      expect(res.headers.get("location"), ret).toBeNull();
      await res.text();
    }
  });

  /** /start and the issuer's login, without the callback: the callback URL and the state cookie. */
  async function upToCallback(sub: string, claims: Record<string, unknown>): Promise<{ callback: string; cookie: string }> {
    const start = await authGet(`/start?${new URLSearchParams({ app: APP, return: RETURN, state: `st-${sub}` })}`);
    await start.text();
    const login = await fetch(start.headers.get("location")!, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: sub, claims: JSON.stringify({ sub, ...claims }) }) });
    return { callback: login.headers.get("location")!, cookie: cookieOf(start) };
  }

  it("refuses a callback carrying sign-in A's cookie with sign-in B's state", async () => {
    const a = await upToCallback("sub-a", { email: "a@example.com", email_verified: true });
    const b = await upToCallback("sub-b", { email: "b@example.com", email_verified: true });
    const res = await authGet(b.callback, a.cookie);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    await res.text();
  });

  it("refuses a replayed callback with no redirect", async () => {
    edge.members.set("sub-replay", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: [] }] });
    const { callback, cookie } = await upToCallback("sub-replay", { email: "r@example.com", email_verified: true });
    const first = await authGet(callback, cookie);
    expect(first.status).toBe(302);
    await first.text();
    const again = await authGet(callback, cookie);
    expect(again.status).toBe(400);
    expect(again.headers.get("location")).toBeNull();
    await again.text();
  });

  it("refuses an email the ID token marks unverified (DEC-0659)", async () => {
    edge.members.set("sub-unverified", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: [] }] });
    const back = await signIn({ sub: "sub-unverified", claims: { email: "u@example.com", email_verified: false } });
    expect(back.toString()).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    await expect(binding("/role", { sub: "sub-unverified" })).resolves.toBeNull();
  });

  it("refuses a callback from a browser that did not start the sign-in", async () => {
    const start = await authGet(`/start?${new URLSearchParams({ app: APP, return: RETURN, state: "s" })}`);
    await start.text();
    const login = await fetch(start.headers.get("location")!, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: "sub-x", claims: JSON.stringify({ sub: "sub-x" }) }) });
    const res = await authGet(login.headers.get("location")!);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    await res.text();
  });

  it("refuses a code presented by another app, without using it up", async () => {
    edge.members.set("sub-two", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: [] }] });
    const back = await signIn({ sub: "sub-two", claims: { email: "two@example.com", email_verified: true } });
    const code = back.searchParams.get("code");
    await expect(binding("/redeem", { code, app: "other-app" })).resolves.toBeNull();
    await expect(binding("/redeem", { code, app: APP })).resolves.toMatchObject({ sub: "sub-two" });
  });

  it("lets exactly one of concurrent redemptions of one code succeed", async () => {
    edge.members.set("sub-race", { memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: [] }] });
    const back = await signIn({ sub: "sub-race", claims: { email: "race@example.com", email_verified: true } });
    const code = back.searchParams.get("code");
    const results = await Promise.all(Array.from({ length: 6 }, () => binding("/redeem", { code, app: APP })));
    expect(results.filter((r) => r !== null)).toEqual([{ sub: "sub-race", email: "race@example.com", role: "user" }]);
    expect(results.filter((r) => r === null)).toHaveLength(5);
  });
});
