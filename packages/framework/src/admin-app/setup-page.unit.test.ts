/**
 * Admin page 1, account setup (v0.2.0 plan §5.2 page 1; DEC-0719): with the page's own scopes,
 * deploys the auth app and its D1 database, creates the shared resources without anything
 * email-related, puts the signing credential in Secrets Store (F's function), and writes the setup
 * record at `ACCOUNT_SETUP_VERSION`. Fake Cloudflare enforcing scopes in front of C's FakeCloud.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "../provision/cloudflare/api.js";
import { ACCOUNT as CLOUD_ACCOUNT, FakeCloud } from "../provision/cloudflare/fake-cloud.test-support.js";
import { CLIENT_SECRET_NAMES } from "../provision/cloudflare/oauth-clients.js";
import { ACCOUNT_SETUP_VERSION } from "../provision/cloudflare/permissions.js";
import { SIGNING_SECRET_NAMES } from "../provision/cloudflare/r2-token.js";
import { handleAdminRequest, type AdminDeps } from "./app.js";
import { API_BASE, CLIENT_ID, CLIENT_SECRET, DISCOVERY, fakeCloudflare, ORIGIN, type FakeCloudflare } from "./fake-cloudflare.test-support.js";
import { PAGE_SCOPES } from "./scopes.js";
import { createSetupPage } from "./setup-page.js";

const ACCOUNT = CLOUD_ACCOUNT;
const AUTH_SOURCE = 'export default { fetch() { return new Response("auth app"); } };';
const UUID = "0000aaaa-bbbb-cccc-dddd-eeeeffff0002";
let cf: FakeCloudflare;
let cloud: FakeCloud;
let dbs: { uuid: string; name: string }[];
let logs: string[];
const jar = new Map<string, string>();

const ok = (result: unknown): ApiReply => ({ status: 200, body: { success: true, errors: [], result } });
const account: CloudflareApi = (method, path, body) => {
  const p = path.split("?")[0];
  if (p === `/accounts/${ACCOUNT}/d1/database` && method === "GET") return Promise.resolve(ok(dbs));
  if (p === `/accounts/${ACCOUNT}/d1/database` && method === "POST") {
    const made = { uuid: UUID, name: (body as { name: string }).name };
    dbs.push(made);
    return Promise.resolve(ok(made));
  }
  return cloud.api(method, path, body);
};

const setupPage = createSetupPage({ authAppSource: () => AUTH_SOURCE, frameworkVersion: "0.2.0-test" });
const deps = (): AdminDeps => ({
  fetch: cf.fetch,
  now: Date.now,
  log: (l) => logs.push(l),
  config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: ACCOUNT, origin: ORIGIN, discoveryUrl: DISCOVERY, apiBase: API_BASE },
  pages: [setupPage],
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

async function setup(untick: string[] = []): Promise<Response> {
  if (!jar.has("__Host-admin-session")) {
    const s = await send("/signin", true);
    await send(cf.consent(s.headers.get("location")!, { sub: "owner" }));
  }
  const start = await send("/setup", true);
  return send(cf.consent(start.headers.get("location")!, { sub: "owner", untick }));
}

/** The account as the bootstrap leaves it: a workers.dev subdomain and the sign-in client in Secrets Store. */
function afterBootstrap(): void {
  cloud.subdomain = "pf-sub";
  const store = cloud.secretStores.get("store1")!;
  store.secrets.set(CLIENT_SECRET_NAMES.signin.id, { id: "s1", value: "signin-client", comment: "signin-client" });
  store.secrets.set(CLIENT_SECRET_NAMES.signin.secret, { id: "s2", value: "signin-secret-value", comment: "signin-client" });
}

beforeEach(async () => {
  jar.clear();
  logs = [];
  dbs = [];
  cloud = new FakeCloud();
  afterBootstrap();
  cf = await fakeCloudflare({ account });
  cf.members.set("owner", { sub: "owner", email: "owner@example.com", roles: ["Super Administrator - All Privileges"] });
});

describe("page 1: account setup", () => {
  it("asks Cloudflare for exactly the page's scopes", async () => {
    await setup();
    const asked = cf.issued.at(-1)!.scope.filter((s) => !["openid", "user-details.read", "memberships.read", "offline_access"].includes(s));
    expect(asked.sort()).toEqual([...PAGE_SCOPES.setup].sort());
  });

  it("deploys the auth app with its D1, creates the shared resources, puts the signing credential in Secrets Store and writes the setup record", async () => {
    const r = await setup();
    const html = await r.text();
    expect(r.status, html).toBe(200);
    const auth = cloud.workers.get("prototype-auth")!;
    expect(auth.modules?.get("worker.js")).toBe(AUTH_SOURCE);
    expect(auth.bindings).toContainEqual({ type: "d1", name: "DB", id: UUID });
    expect(dbs).toEqual([{ uuid: UUID, name: "prototype-auth" }]);
    for (const b of ["prototype-logs", "sst-state", "prototype-backups"]) expect(cloud.buckets.has(b), b).toBe(true);
    expect(cloud.buckets.has("prototype-mailsink")).toBe(false);
    expect(cloud.lifecycles.get("prototype-backups")?.length).toBeGreaterThan(0);
    const store = cloud.secretStores.get("store1")!;
    for (const name of Object.values(SIGNING_SECRET_NAMES)) expect(store.secrets.has(name), name).toBe(true);
    const record = cloud.objectBodies.get("sst-state/framework/account.json") as Record<string, unknown>;
    expect(record).toMatchObject({ setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.2.0-test" });
    expect(record.completedSteps).toEqual(["log-bucket", "state-bucket", "backup-bucket", "backup-lifecycle", "subdomain", "signing-record"]);
    expect(html).toContain("https://prototype-auth.pf-sub.workers.dev");
    expect(html).toContain(`setup version ${String(ACCOUNT_SETUP_VERSION)}`);
  });

  it("ACCOUNT_SETUP_VERSION is raised to 2 for v0.2.0's account setup (PAR-332)", () => {
    expect(ACCOUNT_SETUP_VERSION).toBe(2);
  });

  it("run again: creates nothing new, uploads the auth app again, the record stays current", async () => {
    await setup();
    const tokensBefore = cloud.tokens.size;
    const r = await setup();
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("already there");
    expect(cloud.tokens.size).toBe(tokensBefore);
    expect(dbs).toHaveLength(1);
  });

  it("keeps the record's other fields and a newer setup version", async () => {
    cloud.buckets.set("sst-state", new Set(["framework/account.json"]));
    cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: "old.example", setupVersion: 9, other: "kept" });
    await setup();
    expect(cloud.objectBodies.get("sst-state/framework/account.json")).toMatchObject({ emailDomain: "old.example", setupVersion: 9, other: "kept" });
  });

  it("without the sign-in client (the bootstrap did not finish): says so, writes nothing", async () => {
    cloud.secretStores.get("store1")!.secrets.clear();
    const r = await setup();
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("run npm run cloudflare-setup with a bootstrap token first");
    expect(cloud.workers.has("prototype-auth")).toBe(false);
    expect(cloud.buckets.size).toBe(0);
  });

  it("an unticked scope runs nothing", async () => {
    const r = await setup(["account-api-tokens.write"]);
    expect(r.status).toBe(403);
    expect(cloud.buckets.size).toBe(0);
    expect(cloud.workers.size).toBe(0);
  });

  it("no secret value reaches the page or the logs", async () => {
    const html = await (await setup()).text();
    const all = [html, ...logs].join("\n");
    for (const s of cloud.secretStores.get("store1")!.secrets.values()) expect(all).not.toContain(s.value);
    for (const t of cf.issued) expect(all).not.toContain(t.access);
  });
});
