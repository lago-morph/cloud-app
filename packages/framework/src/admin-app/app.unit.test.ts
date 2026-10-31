/**
 * The admin app's sign-in and page grants (v0.2.0 plan §3, §5.2; DEC-0710): sign-in through the
 * admin client reusing the auth app's OAuth core (PKCE S256, ID token against the JWKS, membership
 * and role mapping), admin-only, a short session; each page's action is its own grant with its own
 * scopes, run with the person's token, which is revoked at once. Fake Cloudflare, no network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleAdminRequest, type AdminDeps, type AdminPage } from "./app.js";
import { ACCOUNT, API_BASE, CLIENT_ID, CLIENT_SECRET, DISCOVERY, fakeCloudflare, ORIGIN, type FakeCloudflare } from "./fake-cloudflare.test-support.js";
import { ADMIN_GRANT_MS, ADMIN_SESSION_MS, GRANT_COOKIE, SESSION_COOKIE } from "./params.js";
import { PAGE_SCOPES } from "./scopes.js";

let cf: FakeCloudflare;
let now: number;
let logs: string[];
let ran: { granted: readonly string[]; sub: string }[];

const statusPage: AdminPage = {
  id: "status",
  title: "Status",
  view: () => "<p>Shows what is set up.</p>",
  run: async (ctx) => {
    ran.push({ granted: ctx.granted, sub: ctx.admin.sub });
    const r = await ctx.api("GET", `/accounts/${ctx.accountId}/workers/scripts`);
    return `<p>scripts answered ${String(r.status)}</p>`;
  },
};

const deps = (over: Partial<AdminDeps> = {}): AdminDeps => ({
  fetch: cf.fetch,
  now: () => now,
  log: (l) => logs.push(l),
  config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: ACCOUNT, origin: ORIGIN, discoveryUrl: DISCOVERY, apiBase: API_BASE },
  pages: [statusPage],
  ...over,
});

/** A browser with a cookie jar, talking to the admin app. */
function browser(d: () => AdminDeps = deps) {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const eq = pair.indexOf("=");
      const v = pair.slice(eq + 1);
      if (v === "" || /Max-Age=0/.test(c)) jar.delete(pair.slice(0, eq));
      else jar.set(pair.slice(0, eq), v);
    }
    return res;
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    jar,
    get: async (path: string) => keep(await handleAdminRequest(new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, { headers: { cookie: cookie() } }), d())),
    post: async (path: string, origin: string | null = ORIGIN) =>
      keep(await handleAdminRequest(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { cookie: cookie(), ...(origin === null ? {} : { origin }) } }), d())),
  };
}
type Browser = ReturnType<typeof browser>;

async function signIn(b: Browser, sub = "admin-1", consent: { untick?: string[]; decline?: boolean } = {}): Promise<Response> {
  const start = await b.post("/signin");
  expect(start.status).toBe(302);
  return b.get(cf.consent(start.headers.get("location")!, { sub, ...consent }));
}

beforeEach(async () => {
  cf = await fakeCloudflare();
  cf.members.set("admin-1", { sub: "admin-1", email: "owner@example.com", roles: ["Super Administrator - All Privileges"] });
  cf.members.set("admin-2", { sub: "admin-2", email: "second@example.com", roles: ["Administrator"] });
  cf.members.set("user-1", { sub: "user-1", email: "member@example.com", roles: ["HTTP Applications Read"] });
  cf.members.set("outsider", { sub: "outsider", email: "x@example.com" });
  now = Date.now();
  logs = [];
  ran = [];
});

describe("anonymous", () => {
  it("the home page offers sign-in only, and is never cached", async () => {
    const r = await browser().get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain('action="/signin"');
    expect(html).not.toContain("/status");
  });

  it("a page is refused: GET goes back to sign-in, POST is 401 and starts no grant", async () => {
    const b = browser();
    const g = await b.get("/status");
    expect(g.status).toBe(303);
    expect(g.headers.get("location")).toBe("/");
    const p = await b.post("/status");
    expect(p.status).toBe(401);
    expect(p.headers.get("location")).toBeNull();
    expect(b.jar.has(GRANT_COOKIE)).toBe(false);
  });

  it("unknown paths are 404 and other methods 405", async () => {
    expect((await browser().get("/nope")).status).toBe(404);
    const r = await handleAdminRequest(new Request(`${ORIGIN}/`, { method: "DELETE" }), deps());
    expect(r.status).toBe(405);
  });
});

describe("sign-in", () => {
  it("starts PKCE S256 with state and nonce, asking only for identity and membership", async () => {
    const r = await browser().post("/signin");
    const to = new URL(r.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://dash.example.test/oauth2/auth");
    expect(to.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(to.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(to.searchParams.get("scope")).toBe("openid user-details.read memberships.read");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(to.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const set = r.headers.getSetCookie().find((c) => c.startsWith(`${GRANT_COOKIE}=`))!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain(`Max-Age=${String(ADMIN_GRANT_MS / 1000)}`);
  });

  it("an administrator gets a short session, and both tokens are revoked", async () => {
    const b = browser();
    const r = await signIn(b);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
    const set = r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(set).toContain(`Max-Age=${String(ADMIN_SESSION_MS / 1000)}`);
    expect(set).toContain("HttpOnly");
    expect(b.jar.has(GRANT_COOKIE)).toBe(false);
    expect(cf.issued).toHaveLength(1);
    expect(cf.issued[0]).toMatchObject({ revokedAccess: true, revokedRefresh: true });
    const home = await (await b.get("/")).text();
    expect(home).toContain("owner@example.com");
    expect(home).toContain('href="/status"');
  });

  it('the plain "Administrator" role is an administrator too', async () => {
    expect((await signIn(browser(), "admin-2")).headers.get("location")).toBe("/");
  });

  it("a member who is not an administrator is refused, gets no session, and the tokens are revoked", async () => {
    const b = browser();
    const r = await signIn(b, "user-1");
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("Only an administrator of this Cloudflare account");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(cf.issued[0]).toMatchObject({ revokedAccess: true, revokedRefresh: true });
    expect((await b.get("/status")).status).toBe(303);
  });

  it("someone with no accepted membership of this account is refused", async () => {
    const b = browser();
    expect((await signIn(b, "outsider")).status).toBe(403);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("an ID token with a wrong nonce, audience or expiry is refused: no session, both tokens revoked (plan §7)", async () => {
    for (const bad of [{ nonce: "other-nonce" }, { aud: "another-client" }, { exp: Math.floor(Date.now() / 1000) - 3600 }]) {
      cf.idTokenClaims = bad;
      const b = browser();
      const r = await signIn(b);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(b.jar.has(SESSION_COOKIE)).toBe(false);
      expect(cf.issued.at(-1)).toMatchObject({ revokedAccess: true, revokedRefresh: true });
    }
  });

  it("a declined consent shows a clear page and no session", async () => {
    const b = browser();
    const r = await signIn(b, "admin-1", { decline: true });
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("not approved");
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(cf.issued).toHaveLength(0);
  });

  it("a callback whose state differs from the grant cookie, or without the cookie, is refused before any exchange", async () => {
    const b = browser();
    const start = await b.post("/signin");
    const back = new URL(cf.consent(start.headers.get("location")!, { sub: "admin-1" }));
    back.searchParams.set("state", "x".repeat(43));
    expect((await b.get(back.toString())).status).toBe(400);
    expect((await browser().get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }))).status).toBe(400);
    expect(cf.requests.filter((r) => r.endsWith("/oauth2/token"))).toHaveLength(0);
  });

  it("a grant past its lifetime is refused", async () => {
    const b = browser();
    const start = await b.post("/signin");
    now += ADMIN_GRANT_MS;
    expect((await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }))).status).toBe(400);
  });

  it("a forged or replayed session cookie is not a session", async () => {
    const b = browser();
    await signIn(b);
    const value = b.jar.get(SESSION_COOKIE)!;
    b.jar.set(SESSION_COOKIE, `${value.slice(0, 10)}A${value.slice(11)}`);
    expect((await b.get("/status")).status).toBe(303);
  });

  it("the session ends after PAR-445 and is not renewed by use", async () => {
    const b = browser();
    await signIn(b);
    now += ADMIN_SESSION_MS - 1;
    expect((await b.get("/status")).status).toBe(200);
    now += 1;
    expect((await b.get("/status")).status).toBe(303);
  });

  it("sign-out clears the session (same-origin POST only)", async () => {
    const b = browser();
    await signIn(b);
    expect((await b.post("/signout", "https://evil.example")).status).toBe(403);
    expect(b.jar.has(SESSION_COOKIE)).toBe(true);
    const r = await b.post("/signout");
    expect(r.status).toBe(303);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("a cross-site or Origin-less POST starts nothing", async () => {
    const b = browser();
    expect((await b.post("/signin", "https://evil.example")).status).toBe(403);
    expect((await b.post("/signin", null)).status).toBe(403);
    expect(b.jar.has(GRANT_COOKIE)).toBe(false);
  });
});

describe("a page's grant", () => {
  it("asks for exactly that page's scopes, runs with the person's token and revokes it", async () => {
    const b = browser();
    await signIn(b);
    const view = await (await b.get("/status")).text();
    expect(view).toContain("Shows what is set up.");
    const start = await b.post("/status");
    const scope = new URL(start.headers.get("location")!).searchParams.get("scope")!;
    expect(scope).toBe(["openid", "user-details.read", "memberships.read", ...PAGE_SCOPES.status].join(" "));
    const r = await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("scripts answered 404");
    expect(ran).toEqual([{ granted: expect.arrayContaining([...PAGE_SCOPES.status]) as unknown as string[], sub: "admin-1" }]);
    expect(cf.issued.every((t) => t.revokedAccess && t.revokedRefresh)).toBe(true);
  });

  it("an unticked optional scope shows which scopes are missing, runs nothing, and revokes the token", async () => {
    const b = browser();
    await signIn(b);
    const start = await b.post("/status");
    const r = await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1", untick: ["d1.write"] }));
    expect(r.status).toBe(403);
    const html = await r.text();
    expect(html).toContain("d1.write");
    expect(html).toContain("keep every permission");
    expect(ran).toHaveLength(0);
    expect(cf.issued.at(-1)).toMatchObject({ revokedAccess: true, revokedRefresh: true });
  });

  it("a token answer without `scope` means the scopes as asked (RFC 6749 §5.1), and the API still enforces them", async () => {
    cf = await fakeCloudflare({ omitScope: true });
    cf.members.set("admin-1", { sub: "admin-1", email: "owner@example.com", roles: ["Administrator"] });
    const b = browser();
    await signIn(b);
    const start = await b.post("/status");
    expect((await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }))).status).toBe(200);
  });

  it("a grant by another Cloudflare user than the session's is refused and ends the session", async () => {
    const b = browser();
    await signIn(b);
    const start = await b.post("/status");
    const r = await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-2" }));
    expect(r.status).toBe(403);
    expect(ran).toHaveLength(0);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("an administrator demoted since sign-in is refused at the page's grant", async () => {
    const b = browser();
    await signIn(b);
    cf.members.set("admin-1", { sub: "admin-1", email: "owner@example.com", roles: ["HTTP Applications Read"] });
    const start = await b.post("/status");
    expect((await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }))).status).toBe(403);
    expect(ran).toHaveLength(0);
  });

  it("the session ending while the person is at Cloudflare runs nothing", async () => {
    const b = browser();
    await signIn(b);
    now += ADMIN_SESSION_MS - 1000;
    const start = await b.post("/status");
    now += 1000;
    const r = await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }));
    expect(r.status).toBe(401);
    expect(ran).toHaveLength(0);
    // Refused before the exchange: only the sign-in's tokens were ever issued.
    expect(cf.issued).toHaveLength(1);
    expect(b.jar.has(GRANT_COOKIE)).toBe(false);
  });

  it("a page whose action throws shows a generic error page, and both tokens are still revoked", async () => {
    const failing: AdminPage = { ...statusPage, run: () => Promise.reject(new Error("boom")) };
    const b = browser(() => deps({ pages: [failing] }));
    await signIn(b);
    const start = await b.post("/status");
    const r = await b.get(cf.consent(start.headers.get("location")!, { sub: "admin-1" }));
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("That step failed");
    expect(cf.issued.every((t) => t.revokedAccess && t.revokedRefresh)).toBe(true);
  });

  it("no output, header or log line holds a token, an authorization code or the client secret", async () => {
    const b = browser();
    const bodies: string[] = [];
    const headers: string[] = [];
    const record = async (r: Response) => {
      headers.push(JSON.stringify([...r.headers]));
      bodies.push(await r.clone().text());
      return r;
    };
    const codes: string[] = [];
    const consent = (location: string, as: { sub: string; untick?: string[] }) => {
      const back = cf.consent(location, as);
      codes.push(new URL(back).searchParams.get("code")!);
      return back;
    };
    const s = await record(await b.post("/signin"));
    await record(await b.get(consent(s.headers.get("location")!, { sub: "admin-1" })));
    const start = await record(await b.post("/status"));
    await record(await b.get(consent(start.headers.get("location")!, { sub: "admin-1", untick: ["d1.write"] })));
    const again = await record(await b.post("/status"));
    await record(await b.get(consent(again.headers.get("location")!, { sub: "admin-1" })));
    const all = [...bodies, ...headers, ...logs].join("\n");
    for (const c of codes) expect(all).not.toContain(c);
    for (const t of cf.issued) {
      expect(all).not.toContain(t.access);
      expect(all).not.toContain(t.refresh);
    }
    expect(all).not.toContain(CLIENT_SECRET);
    for (const c of b.jar.values()) expect(Buffer.from(c.split(".")[0]!, "base64url").toString()).not.toMatch(/at-\d|rt-\d/);
  });
});
