/**
 * Admin page 3, status (v0.2.0 plan §5.2 page 3): read-only, with the page's own scopes; shows the
 * Workers, the setup version, the registered apps and recent sign-ins; a part that cannot be read
 * says so. Fake Cloudflare enforcing scopes, no network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "../provision/cloudflare/api.js";
import { AUTH_APP_DATABASE } from "../provision/cloudflare/auth-app-deploy.js";
import { APP_SCRIPTS as CLIENT_APP_SCRIPTS } from "../provision/cloudflare/oauth-clients.js";
import { ACCOUNT_SETUP_VERSION } from "../provision/cloudflare/permissions.js";
import { handleAdminRequest, type AdminDeps } from "./app.js";
import { ACCOUNT, API_BASE, CLIENT_ID, CLIENT_SECRET, DISCOVERY, fakeCloudflare, ORIGIN, type FakeCloudflare } from "./fake-cloudflare.test-support.js";
import { PAGE_SCOPES } from "./scopes.js";
import { APP_SCRIPTS, RECENT_SIGN_INS, statusPage } from "./status-page.js";

const DB = "11111111-2222-3333-4444-555555555555";
let cf: FakeCloudflare;
let calls: { method: string; path: string; body?: unknown }[];
let world: { scripts: string[]; record?: unknown; dbs: { uuid: string; name: string }[]; registry: unknown[]; users: unknown[] };
const jar = new Map<string, string>();

const ok = (result: unknown): ApiReply => ({ status: 200, body: { success: true, errors: [], result } });
const account: CloudflareApi = (method, path, body) => {
  calls.push({ method, path, ...(body === undefined ? {} : { body }) });
  const A = `/accounts/${ACCOUNT}`;
  if (method === "GET" && path === `${A}/workers/scripts`) return Promise.resolve(ok(world.scripts.map((id) => ({ id }))));
  if (method === "GET" && path === `${A}/r2/buckets/sst-state/objects/framework%2Faccount.json`) return Promise.resolve(world.record === undefined ? { status: 404, body: { success: false, errors: [{ code: 10007 }] } } : { status: 200, body: world.record });
  if (method === "GET" && path.startsWith(`${A}/d1/database?`)) return Promise.resolve(ok(world.dbs));
  if (method === "POST" && path === `${A}/d1/database/${DB}/query`) {
    const sql = (body as { sql: string }).sql;
    return Promise.resolve(ok([{ success: true, results: sql.includes("FROM registry") ? world.registry : world.users }]));
  }
  return Promise.resolve({ status: 404, body: { success: false, errors: [{ code: 7003, message: "No route" }] } });
};

const deps = (): AdminDeps => ({
  fetch: cf.fetch,
  now: Date.now,
  log: () => {},
  config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: ACCOUNT, origin: ORIGIN, discoveryUrl: DISCOVERY, apiBase: API_BASE },
  pages: [statusPage],
});

async function send(path: string, post = false): Promise<Response> {
  const headers = new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
  if (post) headers.set("origin", ORIGIN);
  const res = await handleAdminRequest(new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, { method: post ? "POST" : "GET", headers }), deps());
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const eq = pair.indexOf("=");
    if (/Max-Age=0/.test(c)) jar.delete(pair.slice(0, eq));
    else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return res;
}

async function status(untick: string[] = []): Promise<Response> {
  const s = await send("/signin", true);
  await send(cf.consent(s.headers.get("location")!, { sub: "owner" }));
  const start = await send("/status", true);
  return send(cf.consent(start.headers.get("location")!, { sub: "owner", untick }));
}

beforeEach(async () => {
  jar.clear();
  calls = [];
  world = {
    scripts: ["prototype-admin", "prototype-auth", "notes-prod"],
    record: { emailDomain: "", setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.2.0", appliedAt: "2026-10-31T08:00:00.000Z", completedSteps: [] },
    dbs: [{ uuid: DB, name: AUTH_APP_DATABASE }],
    registry: [{ app: "notes-prod", return_url: "https://notes-prod.sub.workers.dev/api/auth/callback" }],
    users: [{ email: "owner@example.com", role: "admin", updated_at: Date.parse("2026-10-31T09:00:00Z") }],
  };
  cf = await fakeCloudflare({ account });
  cf.members.set("owner", { sub: "owner", email: "owner@example.com", roles: ["Administrator"] });
});

describe("page 3: status", () => {
  it("keeps the Worker names equal to oauth-clients.ts (PAR-438)", () => {
    expect(APP_SCRIPTS).toEqual(CLIENT_APP_SCRIPTS);
  });

  it("asks for exactly the page's scopes and only reads: GETs and SELECT queries", async () => {
    const r = await status();
    expect(r.status).toBe(200);
    const asked = cf.issued.at(-1)!.scope.filter((s) => !["openid", "user-details.read", "memberships.read", "offline_access"].includes(s));
    expect(asked.sort()).toEqual([...PAGE_SCOPES.status].sort());
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    for (const c of calls) {
      if (c.method === "GET") continue;
      expect(c.method).toBe("POST");
      expect(c.path).toMatch(/\/d1\/database\/[^/]+\/query$/);
      expect((c.body as { sql: string }).sql).toMatch(/^SELECT /);
    }
  });

  it("shows the Workers, the setup version, the registered apps and recent sign-ins, escaped", async () => {
    world.registry = [{ app: "<b>x</b>", return_url: "https://x.example/cb" }];
    const html = await (await status()).text();
    expect(html).toContain("Admin app (<code>prototype-admin</code>): deployed");
    expect(html).toContain("Auth app (<code>prototype-auth</code>): deployed");
    expect(html).toContain(`Account setup version ${String(ACCOUNT_SETUP_VERSION)}`);
    expect(html).toContain("current");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("owner@example.com (admin), last signed in 2026-10-31T09:00:00.000Z");
    const q = calls.find((c) => (c.body as { sql?: string } | undefined)?.sql?.includes("FROM users"));
    expect((q!.body as { params: unknown[] }).params).toEqual([RECENT_SIGN_INS]);
  });

  it("says what is missing: no auth app, no record, an old setup version, no database", async () => {
    world.scripts = ["prototype-admin"];
    world.dbs = [];
    world.record = undefined;
    let html = await (await status()).text();
    expect(html).toContain("Auth app (<code>prototype-auth</code>): <strong>not deployed</strong>");
    expect(html).toContain("No account setup has been recorded yet");
    expect(html).toContain("The auth app has no database yet");
    world.record = { setupVersion: ACCOUNT_SETUP_VERSION - 1 };
    jar.clear();
    html = await (await status()).text();
    expect(html).toContain("out of date");
  });

  it("an unreadable part says so, the rest is still shown", async () => {
    cf.override.set(`GET /accounts/${ACCOUNT}/workers/scripts`, { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] } });
    const html = await (await status()).text();
    expect(html).toContain("listing the Workers failed: HTTP 403: Unauthorized to access requested resource (code 9109)");
    expect(html).toContain("notes-prod");
  });

  it("a part whose request throws, or a row with a bad time, still leaves the rest of the page", async () => {
    world.users = [{ email: "x@example.com", role: "user", updated_at: Number.NaN }];
    cf.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`, { status: 200, body: "not json" });
    const original = account;
    const throwing: CloudflareApi = (m, p, b) => (p.endsWith("/workers/scripts") ? Promise.reject(new Error("network down")) : original(m, p, b));
    cf = await fakeCloudflare({ account: throwing });
    cf.members.set("owner", { sub: "owner", email: "owner@example.com", roles: ["Administrator"] });
    const r = await status();
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("listing the Workers failed");
    expect(html).toContain("x@example.com (user), last signed in at an unknown time");
    expect(html).toContain("notes-prod");
  });

  it("an unticked scope runs nothing", async () => {
    const r = await status(["workers-r2.write"]);
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });
});
