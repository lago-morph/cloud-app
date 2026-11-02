// Test support for scripts/live-pass/run.unit.test.ts: a fake Cloudflare world behind the global
// fetch, loaded with `node --import`. It answers the API calls the runner and the fake framework
// make, and the workers.dev URLs, from one JSON file (FAKE_CF_WORLD) shared by every process
// of the run. No network. It models only what the live-pass runner reads and writes.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.FAKE_CF_WORLD;

export const GROUPS = {
  e086da7e2179491d91ee5f35b3ca210a: "Workers Scripts Write",
  bf7481a1826f439697cb59a20b22293e: "Workers R2 Storage Write",
  "09b2857d1c31407795e75e3fed8617a1": "D1 Write",
  "5e33b7d77788455c9fdf18cbd38ee5a0": "Secrets Store Read",
  adc8fa2bc6124928a8b3314dc63a1235: "Secrets Store Write",
  "5bc3f8b21c554832afc660159ab75fa4": "Account API Tokens Write",
  "50fc2f43318f40e4855a35d8de5bf643": "OAuth Client Write",
  c1fde68c7bcc44588cbb6ddbc16d6480: "Account Settings Read",
  aaaa0000000000000000000000000001: "Workers Observability Write",
};
export const idOf = (name) => Object.entries(GROUPS).find(([, n]) => n === name)[0];

export const load = () => JSON.parse(readFileSync(FILE, "utf8"));
export const save = (w) => writeFileSync(FILE, JSON.stringify(w, null, 1));

export function newWorld(accountId) {
  return { accountId, subdomain: null, now: 0, tokens: [], members: [], roles: [{ id: "r1", name: "Super Administrator - All Privileges" }, { id: "r2", name: "Administrator" }, { id: "r3", name: "HTTP Applications Read" }], oauthClients: [], workers: {}, d1: [], d1Rows: {}, buckets: {}, stores: [], events: [], stageSecrets: {} };
}

/** Adds an account token to the world and returns its value. */
export function addToken(w, { name, groups, expiresInS = null, value = randomBytes(30).toString("base64url").slice(0, 40) }) {
  const id = randomUUID().replace(/-/g, "");
  w.tokens.push({ id, value, name, status: "active", issued_on: new Date().toISOString(), modified_on: new Date().toISOString(), expires_on: expiresInS === null ? null : new Date(Date.now() + expiresInS * 1000).toISOString().replace(/\.\d+Z$/, "Z"), policies: [{ id: "p1", effect: "allow", resources: { [`com.cloudflare.api.account.${w.accountId}`]: "*" }, permission_groups: groups.map((g) => ({ id: idOf(g), name: g })) }] });
  return value;
}

export const addEvent = (w, script, message, status = 200) => w.events.push({ timestamp: Date.now(), $workers: { scriptName: script }, $metadata: { message, statusCode: status } });

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (result, extra = {}) => json(200, { success: true, errors: [], messages: [], result, ...extra });
const err = (status, code, message) => json(status, { success: false, errors: [{ code, message }], messages: [], result: null });
const tokenView = ({ value: _v, ...t }) => t;

function caller(w, req) {
  const auth = req.headers.get("authorization") ?? "";
  const value = auth.replace(/^Bearer /, "");
  return w.tokens.find((t) => t.value === value && t.status === "active");
}

async function api(w, req, path, url) {
  const method = req.method;
  const A = `/accounts/${w.accountId}`;
  const who = caller(w, req);
  if (path === `${A}/tokens/verify`) return who ? ok({ id: who.id, status: who.status, expires_on: who.expires_on }) : err(401, 1000, "Invalid API Token");
  if (path === "/user/tokens/verify") return err(401, 1000, "Invalid API Token");
  if (path === "/ips") return ok({ ipv4_cidrs: [] });
  if (!who) return err(401, 10000, "Authentication error");
  const groups = new Set(who.policies.flatMap((p) => p.permission_groups.map((g) => g.name)));
  const need = (g) => groups.has(g) || (g.endsWith(" Read") && groups.has(g.replace(/ Read$/, " Write")));
  const deny = () => err(403, 10000, "Authentication error");

  if (path === A && method === "GET") return ok({ id: w.accountId, name: "Live pass test account", type: "standard" });
  if (path === `${A}/members`) return need("Account Settings Read") ? ok(w.members, { result_info: { page: 1, total_pages: 1 } }) : deny();
  if (path === `${A}/roles`) return need("Account Settings Read") ? ok(w.roles) : deny();
  if (path === `${A}/tokens/permission_groups`) return ok(Object.entries(GROUPS).map(([id, name]) => ({ id, name })));
  if (path === `${A}/tokens` && method === "GET") return need("Account API Tokens Write") ? ok(w.tokens.map(tokenView), { result_info: { page: 1, total_pages: 1 } }) : deny();
  if (path === `${A}/tokens` && method === "POST") {
    if (!need("Account API Tokens Write")) return deny();
    const body = JSON.parse(await req.text());
    const names = body.policies.flatMap((p) => p.permission_groups.map((g) => GROUPS[g.id]));
    const value = addToken(w, { name: body.name, groups: names, expiresInS: body.expires_on ? 86_400 : null });
    const t = w.tokens.at(-1);
    return ok({ ...tokenView(t), value });
  }
  let m = path.match(new RegExp(`^${A}/tokens/([^/]+)$`));
  if (m) {
    const t = w.tokens.find((x) => x.id === m[1]);
    if (method === "GET") return t ? ok(tokenView(t)) : err(404, 1003, "not found");
    if (method === "DELETE") {
      if (!need("Account API Tokens Write") && who.id !== m[1]) return deny();
      w.tokens = w.tokens.filter((x) => x.id !== m[1]);
      return ok({ id: m[1] });
    }
  }
  if (path === `${A}/oauth_clients`) return ok(w.oauthClients, { result_info: { page: 1, total_pages: 1 } });
  if (path === `${A}/workers/subdomain`) return w.subdomain ? ok({ subdomain: w.subdomain }) : err(404, 10007, "no subdomain");
  if (path === `${A}/workers/scripts` && method === "GET") {
    if (!need("Workers Scripts Write")) return deny();
    return ok(Object.entries(w.workers).map(([id, x]) => ({ id, created_on: x.created_on, modified_on: x.modified_on })));
  }
  m = path.match(new RegExp(`^${A}/workers/scripts/([^/]+)(/[a-z-]+)?$`));
  if (m) {
    const [, name, sub] = m;
    const x = w.workers[name];
    if (!need("Workers Scripts Write")) return deny();
    if (sub === undefined && method === "PUT") {
      const form = await req.formData();
      const meta = JSON.parse(await form.get("metadata").text());
      const ssBinding = meta.bindings.some((b) => b.type === "secrets_store_secret");
      if (ssBinding && !need("Secrets Store Read")) return err(403, 10000, "secrets store binding needs Secrets Store Read");
      w.workers[name] = { created_on: new Date().toISOString(), modified_on: new Date().toISOString(), bindings: meta.bindings, compatibility_flags: [], observability: null, secrets: [] };
      return ok({ id: name });
    }
    if (sub === undefined && method === "DELETE") {
      if (!x) return err(404, 10007, "not found");
      delete w.workers[name];
      return ok(null);
    }
    if (!x) return err(404, 10007, "workers.api.error.script_not_found");
    if (sub === "/settings") return ok({ bindings: x.bindings, compatibility_flags: x.compatibility_flags, compatibility_date: "2026-10-01" });
    if (sub === "/script-settings" && method === "GET") return ok({ observability: x.observability });
    if (sub === "/script-settings" && method === "PATCH") {
      x.observability = JSON.parse(await req.text()).observability;
      return ok({ observability: x.observability });
    }
    if (sub === "/secrets") return ok(x.secrets.map((n) => ({ name: n, type: "secret_text" })));
  }
  if (path === `${A}/d1/database`) {
    const name = url.searchParams.get("name");
    return ok(w.d1.filter((d) => !name || d.name === name), { result_info: { page: 1, total_pages: 1 } });
  }
  m = path.match(new RegExp(`^${A}/d1/database/([^/]+)/query$`));
  if (m) {
    if (!need("D1 Write")) return deny();
    const { sql } = JSON.parse(await req.text());
    const table = sql.match(/FROM (\w+)/)[1];
    const rows = w.d1Rows[m[1]]?.[table] ?? [];
    return ok([{ results: rows, success: true, meta: {} }]);
  }
  if (path === `${A}/r2/buckets` && method === "GET") return need("Workers R2 Storage Write") ? ok({ buckets: Object.keys(w.buckets).map((name) => ({ name, creation_date: "2026-11-03" })) }) : deny();
  if (path === `${A}/r2/buckets` && method === "POST") {
    const { name } = JSON.parse(await req.text());
    if (w.buckets[name]) return err(409, 10004, "exists");
    w.buckets[name] = { objects: {}, lifecycle: null };
    return ok({ name });
  }
  m = path.match(new RegExp(`^${A}/r2/buckets/([^/]+)(?:/(objects|lifecycle|cors)(?:/(.+))?)?$`));
  if (m) {
    if (!need("Workers R2 Storage Write")) return deny();
    const [, bucket, part, rawKey] = m;
    const b = w.buckets[bucket];
    if (!b) return err(404, 10006, "bucket not found");
    if (part === undefined) return ok({ name: bucket });
    if (part === "lifecycle") return ok(b.lifecycle ?? { rules: [] });
    if (part === "cors") return err(404, 10059, "no cors");
    if (rawKey === undefined) {
      const prefix = url.searchParams.get("prefix") ?? "";
      return ok(Object.entries(b.objects).filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length, last_modified: "2026-11-03T00:00:00Z" })), { result_info: { is_truncated: false } });
    }
    const key = decodeURIComponent(rawKey);
    if (method === "PUT") {
      b.objects[key] = { body: await req.text(), type: req.headers.get("content-type") };
      return ok({ key });
    }
    if (method === "GET") return b.objects[key] ? new Response(b.objects[key].body, { status: 200 }) : err(404, 10007, "no such object");
    if (method === "DELETE") {
      delete b.objects[key];
      return ok(null);
    }
  }
  if (path === `${A}/secrets_store/stores`) {
    if (!need("Secrets Store Read")) return err(403, 10000, "Authentication error");
    return ok(w.stores.map(({ secrets: _s, ...s }) => s), { result_info: { page: 1, total_pages: 1 } });
  }
  m = path.match(new RegExp(`^${A}/secrets_store/stores/([^/]+)/secrets$`));
  if (m) return ok(w.stores.find((s) => s.id === m[1])?.secrets ?? [], { result_info: { page: 1, total_pages: 1 } });
  if (path === `${A}/workers/observability/telemetry/query`) return need("Workers Observability Write") ? ok({ events: { events: w.events } }) : deny();
  return err(404, 7003, `fake world has no route ${method} ${path}`);
}

function workersDev(w, req, url) {
  const host = url.host;
  const sub = w.subdomain;
  if (!sub || !host.endsWith(`.${sub}.workers.dev`)) return new Response("no such host", { status: 404 });
  const script = host.slice(0, -`.${sub}.workers.dev`.length);
  if (!w.workers[script]) return new Response("no worker", { status: 404 });
  if (script === "prototype-admin") return new Response("<p>Sign in with Cloudflare</p>", { status: 200 });
  if (script === "prototype-auth" && url.pathname === "/start") {
    const registered = (w.d1Rows[w.d1.find((d) => d.name === "prototype-auth")?.uuid]?.registry ?? []).some((r) => r.app === url.searchParams.get("app") && r.return_url === url.searchParams.get("return"));
    return registered ? new Response(null, { status: 302, headers: { location: "https://dash.cloudflare.com/oauth2/auth?client_id=x&state=s3cr3t" } }) : new Response("refused", { status: 400 });
  }
  const isTest = script.includes("-test-");
  if (url.pathname === "/api/__framework/health") return json(200, { ok: true });
  if (url.pathname === "/api/auth/mock-login") return isTest ? new Response(null, { status: 204, headers: { "set-cookie": "__Host-session=abc.def; Path=/; HttpOnly; Secure" } }) : json(404, { error: { code: "HTTP.NOT_FOUND" } });
  if (url.pathname === "/api/auth/me") return json(200, { level: (req.headers.get("cookie") ?? "").includes("__Host-session=") ? "user" : "anonymous" });
  if (url.pathname === "/api/auth/login") return new Response(null, { status: 302, headers: { location: `https://prototype-auth.${sub}.workers.dev/start?app=${script}&return=x&state=y` } });
  return new Response("ok", { status: 200 });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const w = load();
  let res;
  if (url.host === "api.cloudflare.com") res = await api(w, req, url.pathname.replace(/^\/client\/v4/, ""), url);
  else if (url.host.endsWith(".workers.dev")) res = workersDev(w, req, url);
  else if (url.host === "registry.npmjs.org") res = json(200, {});
  else if (url.host === "dash.cloudflare.com") res = json(200, { issuer: "https://dash.cloudflare.com" });
  else res = await realFetch(input, init);
  save(w);
  return res;
};
