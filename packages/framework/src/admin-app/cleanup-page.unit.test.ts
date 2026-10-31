/**
 * The optional cleanup of v0.1.x's email resources (v0.2.0 plan §8). It is never automatic: viewing
 * the page deletes nothing. It deletes only the mail-sink Worker and bucket, with the page's own
 * scopes; a second run is harmless. Fake Cloudflare enforcing scopes, no network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "../provision/cloudflare/api.js";
import { handleAdminRequest, type AdminDeps } from "./app.js";
import { CLEANUP_MAX_PAGES, cleanupPage } from "./cleanup-page.js";
import { ACCOUNT, API_BASE, CLIENT_ID, CLIENT_SECRET, DISCOVERY, fakeCloudflare, ORIGIN, type FakeCloudflare } from "./fake-cloudflare.test-support.js";
import { PAGE_SCOPES } from "./scopes.js";

const A = `/accounts/${ACCOUNT}`;
let cf: FakeCloudflare;
let world: { worker: boolean; bucket: string[] | null; domain?: string };
let calls: string[];
const jar = new Map<string, string>();

const ok = (result: unknown = null): ApiReply => ({ status: 200, body: { success: true, errors: [], result } });
const missing: ApiReply = { status: 404, body: { success: false, errors: [{ code: 10007, message: "not found" }] } };
const account: CloudflareApi = (method, path) => {
  calls.push(`${method} ${path}`);
  if (path === `${A}/r2/buckets/sst-state/objects/framework%2Faccount.json`) return Promise.resolve(world.domain === undefined ? missing : { status: 200, body: { emailDomain: world.domain } });
  if (path === `${A}/workers/scripts/prototype-mailsink` && method === "DELETE") {
    const had = world.worker;
    world.worker = false;
    return Promise.resolve(had ? ok() : missing);
  }
  const base = `${A}/r2/buckets/prototype-mailsink`;
  if (world.bucket === null && path.startsWith(base)) return Promise.resolve(missing);
  if (method === "GET" && path === `${base}/objects?per_page=1000`) return Promise.resolve(ok(world.bucket!.slice(0, 1000).map((key) => ({ key }))));
  if (method === "DELETE" && path.startsWith(`${base}/objects/`)) {
    const key = decodeURIComponent(path.slice(`${base}/objects/`.length));
    world.bucket = world.bucket!.filter((k) => k !== key);
    return Promise.resolve(ok());
  }
  if (method === "DELETE" && path === base) {
    if (world.bucket!.length > 0) return Promise.resolve({ status: 409, body: { success: false, errors: [{ code: 10008, message: "The bucket you tried to delete is not empty" }] } });
    world.bucket = null;
    return Promise.resolve(ok());
  }
  return Promise.resolve({ status: 500, body: { success: false, errors: [{ code: 1, message: `unexpected ${method} ${path}` }] } });
};

const deps = (): AdminDeps => ({
  fetch: cf.fetch,
  now: Date.now,
  log: () => {},
  config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: ACCOUNT, origin: ORIGIN, discoveryUrl: DISCOVERY, apiBase: API_BASE },
  pages: [cleanupPage],
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

async function signIn(): Promise<void> {
  const s = await send("/signin", true);
  await send(cf.consent(s.headers.get("location")!, { sub: "owner" }));
}

async function cleanup(untick: string[] = []): Promise<Response> {
  const start = await send("/cleanup", true);
  return send(cf.consent(start.headers.get("location")!, { sub: "owner", untick }));
}

beforeEach(async () => {
  jar.clear();
  calls = [];
  world = { worker: true, bucket: ["sink@t.example.com/20261020T101010000Z-1.eml", "sink+a@t.example.com/20261020T101011000Z-2.eml"], domain: "example.com" };
  cf = await fakeCloudflare({ account });
  cf.members.set("owner", { sub: "owner", email: "owner@example.com", roles: ["Administrator"] });
  await signIn();
});

describe("cleanup of v0.1.x email resources", () => {
  it("asks for only the Workers and R2 scopes", () => {
    expect([...PAGE_SCOPES.cleanup].sort()).toEqual(["workers-r2.write", "workers-scripts.write"]);
  });

  it("is never automatic: viewing the page deletes nothing and starts no grant", async () => {
    const r = await send("/cleanup");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("optional");
    expect(calls).toEqual([]);
    expect(cf.issued).toHaveLength(1);
  });

  it("on approval deletes the mail-sink Worker, empties and deletes its bucket, and lists the dashboard steps for the domain", async () => {
    const r = await cleanup();
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(world).toMatchObject({ worker: false, bucket: null });
    expect(html).toContain("Deleted the Worker <code>prototype-mailsink</code>.");
    expect(html).toContain("Deleted the R2 bucket <code>prototype-mailsink</code> and its 2 stored test messages.");
    expect(html).toContain("<code>t.example.com</code>");
    expect(calls.filter((c) => c.startsWith("DELETE")).every((c) => c.includes("/prototype-mailsink"))).toBe(true);
  });

  it("a second run finds everything gone and says so", async () => {
    await cleanup();
    calls = [];
    const html = await (await cleanup()).text();
    expect(html).toContain("was already gone");
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([`DELETE ${A}/workers/scripts/prototype-mailsink`]);
  });

  it("stops after PAR-449 pages of a very full bucket and says to run again", async () => {
    world.bucket = Array.from({ length: CLEANUP_MAX_PAGES * 1000 + 5 }, (_, i) => `k${String(i)}`);
    const html = await (await cleanup()).text();
    expect(html).toContain("Run the cleanup again to finish");
    expect(world.bucket).toHaveLength(5);
  });

  it("exactly PAR-449 full pages: the bucket ends empty and is deleted, not reported as having more", async () => {
    world.bucket = Array.from({ length: CLEANUP_MAX_PAGES * 1000 }, (_, i) => `k${String(i)}`);
    const html = await (await cleanup()).text();
    expect(world.bucket).toBeNull();
    expect(html).toContain(`and its ${String(CLEANUP_MAX_PAGES * 1000)} stored test messages`);
  });

  it("a listing entry without a key is an error, not an endless re-list", async () => {
    cf.override.set(`GET ${A}/r2/buckets/prototype-mailsink/objects?per_page=1000`, { status: 200, body: { success: true, errors: [], result: [{ size: 1 }] } });
    const r = await cleanup();
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("prototype-mailsink");
    expect(calls.filter((c) => c.startsWith("GET ") && c.includes("/objects?"))).toHaveLength(0);
  });

  it("a failed Worker delete names it and touches nothing else; a refused bucket delete names the bucket", async () => {
    cf.override.set(`DELETE ${A}/workers/scripts/prototype-mailsink`, { status: 500, body: { success: false, errors: [{ code: 10013, message: "Internal" }] } });
    let r = await cleanup();
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("deleting the Worker prototype-mailsink failed: HTTP 500: Internal (code 10013)");
    expect(world.bucket).toHaveLength(2);
    cf.override.clear();
    cf.override.set(`DELETE ${A}/r2/buckets/prototype-mailsink`, { status: 409, body: { success: false, errors: [{ code: 10008, message: "The bucket you tried to delete is not empty" }] } });
    r = await cleanup();
    expect(r.status).toBe(502);
    expect(await r.text()).toContain("deleting the R2 bucket prototype-mailsink failed: HTTP 409");
  });

  it("without a v0.1.x record the dashboard steps name no domain", async () => {
    delete world.domain;
    const html = await (await cleanup()).text();
    expect(html).toContain("your email domain");
  });

  it("an unticked scope deletes nothing", async () => {
    const r = await cleanup(["workers-r2.write"]);
    expect(r.status).toBe(403);
    expect(world.worker).toBe(true);
    expect(calls).toEqual([]);
  });
});
