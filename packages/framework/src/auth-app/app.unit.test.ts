/**
 * The auth app's HTTP routes (plan §4.1 steps 2–3): `/start` checks `return` exactly against the
 * registry and starts PKCE S256; `/callback` checks state, signs in, revokes, issues the one-time
 * code and redirects to `return?code=…&state=…`. Real local D1, fake upstream, no network.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleAuthAppRequest, SIGN_IN_COOKIE, type AuthAppDeps } from "./app.js";
import { localD1, type LocalD1 } from "./d1.test-support.js";
import { ACCESS_TOKEN, FAKE_ACCOUNT, FAKE_API, FAKE_CLIENT_ID, FAKE_DISCOVERY, FAKE_ISSUER, REFRESH_TOKEN, fakeUpstream, makeSigningKey, type FakeUpstream, type SignedKey } from "./fake-upstream.test-support.js";
import { SIGN_IN_TRANSACTION_MS } from "./params.js";
import { createAuthAppService } from "./service.js";
import { ensureSchema, registerReturnUrl, unregisterApp, type D1Like } from "./store.js";

const ORIGIN = "https://auth.acct.workers.dev";
const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
let d1: LocalD1;
let key: SignedKey;
let up: FakeUpstream;
let logs: string[];
let now: number;
let db: D1Like;

beforeAll(async () => {
  d1 = await localD1();
  key = await makeSigningKey();
  await ensureSchema(d1.db);
  await registerReturnUrl(d1.db, APP, RETURN);
}, 60_000);
afterAll(async () => {
  await d1.dispose();
});
beforeEach(() => {
  now = 1_800_000_000_000;
  db = d1.db;
  logs = [];
  up = fakeUpstream({ key, claims: { sub: "sub-1", email: "a@example.com", email_verified: true }, membershipPages: [[{ account: { id: FAKE_ACCOUNT }, status: "accepted", roles: ["Administrator"] }]] });
});

const deps = (): AuthAppDeps => ({
  db,
  fetch: up.fetch,
  now: () => now,
  log: (l) => logs.push(l),
  config: { clientId: FAKE_CLIENT_ID, clientSecret: "client-secret", accountId: FAKE_ACCOUNT, discoveryUrl: FAKE_DISCOVERY, apiBase: FAKE_API, callbackUrl: `${ORIGIN}/callback` },
});
const get = (path: string, headers: Record<string, string> = {}) => handleAuthAppRequest(new Request(`${ORIGIN}${path}`, { headers }), deps());
const startPath = (over: Record<string, string> = {}) => `/start?${new URLSearchParams({ app: APP, return: RETURN, state: "app-state-1", ...over })}`;

async function start(): Promise<{ authorize: URL; cookie: string }> {
  const res = await get(startPath());
  expect(res.status).toBe(302);
  const authorize = new URL(res.headers.get("location")!);
  const cookie = /^([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
  up.options.claims = { ...up.options.claims, nonce: authorize.searchParams.get("nonce") };
  up.options.expect = { challenge: authorize.searchParams.get("code_challenge")!, redirectUri: `${ORIGIN}/callback`, code: "upstream-code" };
  return { authorize, cookie };
}

const callback = (authorize: URL, cookie: string | null, extra: Record<string, string> = { code: "upstream-code" }) =>
  get(`/callback?${new URLSearchParams({ state: authorize.searchParams.get("state")!, ...extra })}`, cookie === null ? {} : { cookie });

describe("/start", () => {
  it("redirects to the authorize endpoint with PKCE S256, a fresh state and nonce, and sets the state cookie", async () => {
    const res = await get(startPath());
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(`${url.origin}${url.pathname}`).toBe(`${FAKE_ISSUER}/oauth2/auth`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).not.toBe("app-state-1");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toBe(`${SIGN_IN_COOKIE}=${url.searchParams.get("state")}; Path=/; Max-Age=${SIGN_IN_TRANSACTION_MS / 1000}; HttpOnly; Secure; SameSite=Lax`);
  });

  it("refuses a return URL that is not registered for the app, with no redirect and no cookie", async () => {
    for (const over of [{ return: `${RETURN}/` }, { return: "https://evil.example/cb" }, { app: "other-app" }]) {
      const res = await get(startPath(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("refuses missing parameters and an over-long state", async () => {
    for (const path of ["/start", `/start?app=${APP}&return=${encodeURIComponent(RETURN)}`, `/start?return=${encodeURIComponent(RETURN)}&state=s`, startPath({ state: "s".repeat(513) })]) {
      expect((await get(path)).status, path).toBe(400);
    }
  });

  it("answers 405 to a POST and 404 elsewhere", async () => {
    expect((await handleAuthAppRequest(new Request(`${ORIGIN}${startPath()}`, { method: "POST" }), deps())).status).toBe(405);
    expect((await get("/")).status).toBe(404);
    expect((await get("/user")).status).toBe(404);
  });
});

describe("/callback", () => {
  it("signs in, revokes both tokens and redirects to return with a one-time code and the app's state", async () => {
    const { authorize, cookie } = await start();
    const res = await callback(authorize, cookie);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(RETURN);
    expect(to.searchParams.get("state")).toBe("app-state-1");
    expect(to.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBe(`${SIGN_IN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    expect(up.revoked().sort()).toEqual([ACCESS_TOKEN, REFRESH_TOKEN].sort());
    const service = createAuthAppService({ db: d1.db, now: () => now });
    await expect(service.redeem({ code: to.searchParams.get("code")!, app: APP })).resolves.toEqual({ sub: "sub-1", email: "a@example.com", role: "admin" });
  });

  it("sends the verifier whose S256 is the challenge it sent to /start", async () => {
    const { authorize, cookie } = await start();
    await callback(authorize, cookie);
    const verifier = up.requests.find((r) => r.url.endsWith("/oauth2/token"))!.body.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(authorize.searchParams.get("code_challenge"));
  });

  it("refuses a callback without the state cookie, or with another one, and makes no exchange", async () => {
    for (const cookie of [null, `${SIGN_IN_COOKIE}=other-state`, "unrelated=1"]) {
      const { authorize } = await start();
      const res = await callback(authorize, cookie);
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
    expect(up.requests.some((r) => r.url.endsWith("/oauth2/token"))).toBe(false);
    expect(logs.map((l) => JSON.parse(l).message)).toEqual(Array(3).fill("sign-in refused: state mismatch"));
  });

  it("refuses a replayed callback", async () => {
    const { authorize, cookie } = await start();
    expect((await callback(authorize, cookie)).status).toBe(302);
    const again = await callback(authorize, cookie);
    expect(again.status).toBe(400);
    expect(JSON.parse(logs.at(-1)!).message).toBe("sign-in refused: unknown or expired sign-in");
  });

  it("refuses a sign-in older than PAR-416", async () => {
    const { authorize, cookie } = await start();
    now += SIGN_IN_TRANSACTION_MS + 1;
    expect((await callback(authorize, cookie)).status).toBe(400);
  });

  it("sends the person back to the app with error=login_failed when they decline consent", async () => {
    const { authorize, cookie } = await start();
    const res = await callback(authorize, cookie, { error: "access_denied" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    expect(JSON.parse(logs[0]!).message).toBe("sign-in refused: provider refused (access_denied)");
  });

  it("sends the person back with error=login_failed when the sign-in is refused, logging only the reason", async () => {
    const count = async () => (await d1.db.prepare("SELECT COUNT(*) AS n FROM codes").first<{ n: number }>())?.n;
    const { authorize, cookie } = await start();
    up.options.claims = { ...up.options.claims, nonce: "wrong" };
    const before = await count();
    const res = await callback(authorize, cookie);
    expect(res.headers.get("location")).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    expect(logs).toEqual([JSON.stringify({ level: "warn", component: "AUTH_APP", message: "sign-in refused: id token: wrong nonce" })]);
    expect(up.revoked()).toHaveLength(2);
    expect(await count()).toBe(before);
  });

  it("refuses a callback with neither code nor error", async () => {
    const { authorize, cookie } = await start();
    const res = await callback(authorize, cookie, {});
    expect(res.headers.get("location")).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
  });

  it("logs no code, state, token or secret on any path", async () => {
    const { authorize, cookie } = await start();
    up.options.claims = { ...up.options.claims, nonce: "wrong" };
    await callback(authorize, cookie);
    const all = logs.join("\n");
    for (const s of ["upstream-code", authorize.searchParams.get("state")!, ACCESS_TOKEN, REFRESH_TOKEN, "client-secret", "app-state-1"]) expect(all).not.toContain(s);
  });
});

describe("review cases (independent review of PR 27)", () => {
  it("refuses open-redirect return values at /start, with no redirect and no cookie", async () => {
    for (const ret of [
      "https://evil.acct.workers.dev/api/auth/callback",
      RETURN.toUpperCase(),
      RETURN.replace("/api/", "/API/"),
      RETURN.replace("/api/", "/%61pi/"),
      `${RETURN}?next=https://evil.example`,
      RETURN.slice(0, -1),
      "//evil.example/cb",
    ]) {
      const res = await get(startPath({ return: ret }));
      expect(res.status, ret).toBe(400);
      expect(res.headers.get("location"), ret).toBeNull();
      expect(res.headers.get("set-cookie"), ret).toBeNull();
    }
  });

  it("accepts an app state of exactly 512 characters", async () => {
    expect((await get(startPath({ state: "s".repeat(512) }))).status).toBe(302);
  });

  it("accepts a callback at exactly PAR-416", async () => {
    const { authorize, cookie } = await start();
    now += SIGN_IN_TRANSACTION_MS;
    expect((await callback(authorize, cookie)).status).toBe(302);
  });

  it("does not redirect to a return URL unregistered while the sign-in was in flight", async () => {
    const { authorize, cookie } = await start();
    await unregisterApp(d1.db, APP);
    try {
      const res = await callback(authorize, cookie);
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(up.requests.some((r) => r.url.endsWith("/oauth2/token"))).toBe(false);
    } finally {
      await registerReturnUrl(d1.db, APP, RETURN);
    }
  });

  it("does not clear the state cookie on a mismatched or unknown callback (a cross-site GET cannot cancel a sign-in)", async () => {
    const { authorize } = await start();
    const mismatch = await callback(authorize, `${SIGN_IN_COOKIE}=other`);
    expect(mismatch.headers.get("set-cookie")).toBeNull();
    const unknown = await get(`/callback?state=nope&code=c`, { cookie: `${SIGN_IN_COOKIE}=nope` });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("answers 503 at /start when discovery fails, with no cookie, no redirect and no saved sign-in", async () => {
    const count = async () => (await d1.db.prepare("SELECT COUNT(*) AS n FROM sign_ins").first<{ n: number }>())?.n;
    const before = await count();
    up.options.discovery = { issuer: "" };
    const res = await get(startPath());
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(await count()).toBe(before);
  });

  it("sends the person back with login_failed when issuing the code fails, logging an internal error", async () => {
    const { authorize, cookie } = await start();
    db = { prepare: (q: string) => (q.startsWith("INSERT INTO codes") ? (() => { throw new Error("D1 down"); })() : d1.db.prepare(q)), batch: (s) => d1.db.batch(s) };
    const res = await callback(authorize, cookie);
    expect(res.headers.get("location")).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    expect(logs.map((l) => JSON.parse(l).message)).toContain("sign-in failed: internal error");
  });

  it("logs 'other' for a provider error outside the expected shape, and prefers error over code", async () => {
    const { authorize, cookie } = await start();
    const res = await callback(authorize, cookie, { error: "<script>x</script>", code: "upstream-code" });
    expect(res.headers.get("location")).toBe(`${RETURN}?error=login_failed&state=app-state-1`);
    expect(JSON.parse(logs.at(-1)!).message).toBe("sign-in refused: provider refused (other)");
    expect(up.requests.some((r) => r.url.endsWith("/oauth2/token"))).toBe(false);
  });

  it("marks the success redirect no-store and logs nothing secret on success, decline, mismatch and replay", async () => {
    const a = await start();
    const ok = await callback(a.authorize, a.cookie);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    await callback(a.authorize, a.cookie); // replay
    const b = await start();
    await callback(b.authorize, b.cookie, { error: "access_denied" });
    const c = await start();
    await callback(c.authorize, `${SIGN_IN_COOKIE}=x`);
    const all = logs.join("\n");
    const code = new URL(ok.headers.get("location")!).searchParams.get("code")!;
    for (const s of [code, "upstream-code", a.authorize.searchParams.get("state")!, b.authorize.searchParams.get("state")!, c.authorize.searchParams.get("state")!, ACCESS_TOKEN, REFRESH_TOKEN, "client-secret", "app-state-1"]) {
      expect(all).not.toContain(s);
    }
  });
});
