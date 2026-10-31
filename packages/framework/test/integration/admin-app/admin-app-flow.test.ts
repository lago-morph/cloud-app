/**
 * The admin app end to end over plain HTTP, no browser (plan-v0.2.0 §5.2, §7 "Integration"; progress
 * §3 E exit check). The admin app runs as the bundle the bootstrap uploads, under local workerd with
 * `nodejs_compat`; mock-oauth2-server is the issuer (its login form posted as a browser would; real
 * PKCE and RS256 ID tokens); the edge (support.ts) is the Cloudflare API, enforcing the granted
 * scopes.
 *
 * Covers: anonymous and non-admin refused; an admin's sign-in; each page's grant asks for its own
 * scopes only; the everyday token created with exactly the four groups and shown once; a 0.1.x
 * token updated in place without its email and zone groups; an unticked optional scope named on
 * the page; every token revoked; no token value in any response.
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundleAdminApp } from "../../../src/admin-app/bundle.js";
import { ADMIN_APP_COMPATIBILITY_DATE, ADMIN_APP_COMPATIBILITY_FLAGS } from "../../../src/provision/cloudflare/admin-app-deploy.js";
import { TOKEN_NAMES } from "../../../src/provision/cloudflare/permissions.js";
import { startMockOAuth2, type MockOAuth2 } from "../../../../../tests/support/mock-oauth2/launcher.js";
import { ACCOUNT_ID, startEdge, type Edge } from "./support.js";

const ORIGIN = "http://localhost:8790";
const CLIENT_ID = "admin-client";
const CLIENT_SECRET = "admin-client-secret-for-integration-0123456789";

/**
 * Plan §5.2's expectations, written out here rather than imported from the code under test: the
 * everyday set's four groups (Workers Scripts Write, Workers R2 Storage Write, D1 Write, Secrets
 * Store Read) and each page's optional scopes (PAR-447).
 */
const FOUR_GROUPS = ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "5e33b7d77788455c9fdf18cbd38ee5a0"];
const SCOPES = {
  setup: ["workers-scripts.write", "d1.write", "workers-r2.write", "secrets-store.write", "account-api-tokens.write"],
  everyday: ["account-api-tokens.write", "workers-scripts.write", "workers-r2.write", "d1.write", "secrets-store.read"],
  status: ["workers-scripts.write", "workers-r2.write", "d1.write"],
  cleanup: ["workers-scripts.write", "workers-r2.write"],
} as const;

let oauth: MockOAuth2;
let edge: Edge;
let mf: Miniflare;
/** Every response body and header the browser saw, and the Worker's console output, for the no-leak check. */
const seen: string[] = [];
/** The everyday token value page 2 created and showed. */
let createdValue = "";
/** How many Worker log lines were captured (the admin app logs each sign-in). */
let workerLogs = 0;

beforeAll(async () => {
  oauth = await startMockOAuth2();
  edge = await startEdge(oauth.baseUrl);
  const text = (value: string) => ({ type: "text" as const, value });
  mf = new Miniflare({
    handleStructuredLogs: (log) => {
      seen.push(JSON.stringify(log));
      workerLogs += 1;
    },
    workers: [
      {
        config: {
          name: "admin",
          compatibilityDate: ADMIN_APP_COMPATIBILITY_DATE,
          compatibilityFlags: [...ADMIN_APP_COMPATIBILITY_FLAGS],
          manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: await bundleAdminApp() } } },
          env: {
            ADMIN_CLIENT_ID: text(CLIENT_ID),
            ADMIN_CLIENT_SECRET: text(CLIENT_SECRET),
            ADMIN_ACCOUNT_ID: text(ACCOUNT_ID),
            ADMIN_APP_ORIGIN: text(ORIGIN),
            ADMIN_DISCOVERY_URL: text(edge.discoveryUrl),
            ADMIN_API_BASE: text(edge.apiBase),
          },
        },
      },
    ],
  });
}, 600_000);

afterAll(async () => {
  await mf?.dispose();
  await edge?.close();
  await oauth?.stop();
});

/** A browser: a cookie jar, Origin on POSTs, no redirects followed. */
class Browser {
  readonly jar = new Map<string, string>();
  async go(pathOrUrl: string, method: "GET" | "POST" = "GET", form?: Record<string, string>): Promise<{ status: number; location: string | null; text: string }> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${ORIGIN}${pathOrUrl}`;
    const headers: Record<string, string> = { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (method === "POST") headers.origin = ORIGIN;
    if (form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
    const res = await (await mf.getWorker("admin")).fetch(url, { method, headers, redirect: "manual", ...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }) });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (/Max-Age=0/.test(c)) this.jar.delete(pair.slice(0, eq));
      else this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const text = await res.text();
    seen.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, location: res.headers.get("location"), text };
  }

  /** Starts a grant (`/signin` or a page), plays the person at the issuer, and follows the callback. */
  async grant(path: string, sub: string, form?: Record<string, string>): Promise<{ status: number; location: string | null; text: string; scope: string }> {
    const start = await this.go(path, "POST", form);
    expect(start.status, start.text).toBe(302);
    const authorize = start.location!;
    expect(authorize.startsWith(`${oauth.baseUrl}/cf/authorize?`)).toBe(true);
    edge.noteAuthorize(authorize);
    const login = await fetch(authorize, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: sub, claims: JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true }) }) });
    expect(login.status).toBe(302);
    const callback = login.headers.get("location")!;
    expect(callback.startsWith(`${ORIGIN}/callback?`)).toBe(true);
    return { ...(await this.go(callback)), scope: new URL(authorize).searchParams.get("scope") ?? "" };
  }
}

const optional = (scope: string) => scope.split(" ").filter((s) => !["openid", "user-details.read", "memberships.read"].includes(s));

beforeEach(() => {
  edge.untick.clear();
  edge.members.set("owner", { roles: ["Super Administrator - All Privileges"] });
  edge.members.set("member", { roles: ["HTTP Applications Read"] });
});

describe("the admin app against mock-oauth2-server", () => {
  it("anonymous: only the sign-in page; a page redirects to it, a page action is refused", async () => {
    const b = new Browser();
    const home = await b.go("/");
    expect(home.status).toBe(200);
    expect(home.text).toContain('action="/signin"');
    expect(home.text).not.toContain('href="/everyday"');
    const page = await b.go("/everyday");
    expect(page.status).toBe(303);
    expect(page.location).toBe("/");
    const post = await b.go("/everyday", "POST");
    expect(post.status).toBe(401);
    expect(post.location).toBeNull();
  });

  it("a member who is not an administrator is refused and gets no session; the tokens are revoked", async () => {
    const b = new Browser();
    const r = await b.grant("/signin", "member");
    expect(r.status).toBe(403);
    expect(r.text).toContain("Only an administrator of this Cloudflare account");
    expect(b.jar.has("__Host-admin-session")).toBe(false);
    const last = edge.issued.at(-1)!;
    expect(last.revoked.has(last.access) && last.revoked.has(last.refresh)).toBe(true);
  });

  it("someone with no membership of the account is refused", async () => {
    const b = new Browser();
    expect((await b.grant("/signin", "stranger")).status).toBe(403);
    expect(b.jar.has("__Host-admin-session")).toBe(false);
  });

  it("an administrator signs in asking for identity and membership only, and sees the pages", async () => {
    const b = new Browser();
    const r = await b.grant("/signin", "owner");
    expect(r.status).toBe(303);
    expect(optional(r.scope)).toEqual([]);
    const home = await b.go("/");
    for (const page of ["setup", "everyday", "status", "cleanup"]) expect(home.text).toContain(`href="/${page}"`);
  });

  it("page 2 asks for its own scopes only, creates the everyday token with exactly the four groups, and shows the value once", async () => {
    const b = new Browser();
    await b.grant("/signin", "owner");
    const r = await b.grant("/everyday", "owner");
    expect(r.status, r.text).toBe(200);
    expect(optional(r.scope)).toEqual(SCOPES.everyday);
    const created = [...edge.tokens.tokens.values()].find((t) => t.name === TOKEN_NAMES.everyday)!;
    const groups = created.policies.flatMap((p) => p.permission_groups.map((g) => g.id));
    expect(groups).toHaveLength(4);
    expect(groups).toEqual(FOUR_GROUPS);
    createdValue = created.value;
    expect(r.text.split(created.value)).toHaveLength(2);
    for (const t of edge.issued) expect(t.revoked.has(t.access)).toBe(true);
  });

  it("page 2 updates a 0.1.x everyday token in place: its email and zone groups go, its value stays and is not shown", async () => {
    edge.tokens.tokens.clear();
    const old = edge.tokens.add({
      id: "a".repeat(32),
      name: TOKEN_NAMES.everyday,
      value: "old-everyday-value",
      policies: [
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: "*" }, permission_groups: ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "2d5b4b1f6c89487bb7184c2c1dcd3bf1"].map((id) => ({ id })) },
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: ["c8fed203ed3043cba015a93ad1616f1f", "9c88f9c5bce24ce7af9a958ba9c504db", "1b600d9d8062443e986a973f097e728a"].map((id) => ({ id })) },
      ],
    });
    const b = new Browser();
    await b.grant("/signin", "owner");
    const r = await b.grant("/everyday", "owner");
    expect(r.status, r.text).toBe(200);
    expect(r.text).toContain("updated in place");
    const t = edge.tokens.tokens.get(old.id)!;
    expect(t.policies.flatMap((p) => p.permission_groups.map((g) => g.id))).toEqual(FOUR_GROUPS);
    expect(edge.tokens.tokens.size).toBe(1);
    expect(JSON.stringify(t.policies)).not.toContain("zone");
    expect(t.value).toBe("old-everyday-value");
    expect(r.text).not.toContain("old-everyday-value");
  });

  it("an unticked optional scope: the page names it and nothing is created", async () => {
    edge.tokens.tokens.clear();
    const b = new Browser();
    await b.grant("/signin", "owner");
    edge.untick.add("secrets-store.read");
    const r = await b.grant("/everyday", "owner");
    expect(r.status).toBe(403);
    expect(r.text).toContain("secrets-store.read");
    expect(r.text).toContain("keep every permission");
    expect(edge.tokens.tokens.size).toBe(0);
    const refused = edge.issued.at(-1)!;
    expect(refused.revoked.has(refused.access) && refused.revoked.has(refused.refresh)).toBe(true);
  });

  it("each page's grant asks for that page's scopes only", async () => {
    const b = new Browser();
    await b.grant("/signin", "owner");
    for (const page of ["setup", "status", "cleanup"] as const) {
      const start = await b.go(`/${page}`, "POST");
      expect(start.status).toBe(302);
      expect(optional(new URL(start.location!).searchParams.get("scope")!)).toEqual(SCOPES[page]);
    }
  });

  it("no access or refresh token or client secret appears in any response or Worker log; the everyday value only on its own page", () => {
    const all = seen.join("\n");
    expect(createdValue).not.toBe("");
    expect(workerLogs).toBeGreaterThan(0);
    expect(all.split(createdValue)).toHaveLength(2);
    expect(edge.issued.length).toBeGreaterThan(0);
    for (const t of edge.issued) {
      expect(all).not.toContain(t.access);
      expect(all).not.toContain(t.refresh);
    }
    expect(all).not.toContain(CLIENT_SECRET);
  });
});
