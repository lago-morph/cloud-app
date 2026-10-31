/**
 * Admin page 3, status (v0.2.0 plan §5.2 page 3; DEC-0717): what is set up, at which version, the
 * apps registered with the auth app, and recent sign-ins. **Read-only**: every call is a GET or a
 * read-only D1 query (`SELECT`), with the person's grant (PAR-447 `status`). A part that cannot be
 * read says so and the rest is still shown.
 */
import { ACCOUNT_SETTINGS_KEY } from "../provision/cloudflare/account-settings.js";
import { succeeded, describeFailure, type CloudflareApi } from "../provision/cloudflare/api.js";
import { AUTH_APP_DATABASE } from "../provision/cloudflare/auth-app-deploy.js";
import { STATE_BUCKET } from "../provision/cloudflare/names.js";
import { ACCOUNT_SETUP_VERSION } from "../provision/cloudflare/permissions.js";
import type { AdminPage, GrantContext } from "./app.js";
import { esc } from "./html.js";

/**
 * The account-level Workers, as `APP_SCRIPTS` in oauth-clients.ts (PAR-438; a unit test keeps them
 * equal). Not imported from there: that module pulls in Node's crypto, and this one is bundled.
 */
export const APP_SCRIPTS = Object.freeze({ admin: "prototype-admin", signin: "prototype-auth" });

/** PAR-448: how many recent sign-ins the page lists. */
export const RECENT_SIGN_INS = 20;

type Part = { ok: true; html: string } | { ok: false; why: string };

const fail = (what: string, r: { status: number; body: unknown }): Part => ({ ok: false, why: `${what} failed: ${describeFailure(r)}` });

async function workers(api: CloudflareApi, a: string): Promise<Part> {
  const r = await api("GET", `/accounts/${a}/workers/scripts`);
  const list = (r.body as { result?: { id?: unknown }[] } | null)?.result;
  if (!succeeded(r) || !Array.isArray(list)) return fail("listing the Workers", r);
  const ids = new Set(list.map((w) => w.id));
  const row = (name: string, what: string) => `<li>${esc(what)} (<code>${esc(name)}</code>): ${ids.has(name) ? "deployed" : "<strong>not deployed</strong>"}</li>`;
  return { ok: true, html: `<ul>${row(APP_SCRIPTS.admin, "Admin app")}${row(APP_SCRIPTS.signin, "Auth app")}</ul>` };
}

async function setupRecord(api: CloudflareApi, a: string): Promise<Part> {
  const r = await api("GET", `/accounts/${a}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`);
  if (r.status === 404) return { ok: true, html: "<p>No account setup has been recorded yet: run <a href=\"/setup\">Account setup</a>.</p>" };
  if (r.status < 200 || r.status >= 300) return fail("reading the setup record", r);
  const b = (typeof r.body === "object" && r.body !== null ? r.body : {}) as Record<string, unknown>;
  const v = typeof b.setupVersion === "number" ? b.setupVersion : undefined;
  const current = v !== undefined && v >= ACCOUNT_SETUP_VERSION;
  const field = (k: string) => (typeof b[k] === "string" ? esc(b[k]) : "unknown");
  return {
    ok: true,
    html: `<p>Account setup version ${v === undefined ? "unknown" : String(v)} (this framework needs ${String(ACCOUNT_SETUP_VERSION)}): ${current ? "current" : '<strong>out of date: run <a href="/setup">Account setup</a></strong>'}. Applied by framework ${field("frameworkVersion")} at ${field("appliedAt")}.</p>`,
  };
}

/** One read-only query on the auth app's D1; its rows. */
async function query(api: CloudflareApi, a: string, db: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[] | { status: number; body: unknown }> {
  const r = await api("POST", `/accounts/${a}/d1/database/${db}/query`, { sql, params });
  const res = (r.body as { result?: { results?: unknown; success?: unknown }[] } | null)?.result;
  if (!succeeded(r) || !Array.isArray(res) || !Array.isArray(res[0]?.results)) return r;
  return res[0].results as Record<string, unknown>[];
}

async function authData(api: CloudflareApi, a: string): Promise<{ apps: Part; signIns: Part }> {
  const r = await api("GET", `/accounts/${a}/d1/database?name=${encodeURIComponent(AUTH_APP_DATABASE)}&per_page=10`);
  const list = (r.body as { result?: { uuid?: unknown; name?: unknown }[] } | null)?.result;
  if (!succeeded(r) || !Array.isArray(list)) {
    const p = fail("finding the auth app's database", r);
    return { apps: p, signIns: p };
  }
  const db = list.find((d) => d.name === AUTH_APP_DATABASE)?.uuid;
  if (typeof db !== "string" || !/^[0-9a-f-]{36}$/.test(db)) {
    const none: Part = { ok: true, html: '<p>The auth app has no database yet: run <a href="/setup">Account setup</a>.</p>' };
    return { apps: none, signIns: none };
  }
  const apps = await query(api, a, db, "SELECT app, return_url FROM registry ORDER BY app, return_url");
  const users = await query(api, a, db, "SELECT email, role, updated_at FROM users ORDER BY updated_at DESC LIMIT ?", [RECENT_SIGN_INS]);
  const appsPart: Part = Array.isArray(apps)
    ? { ok: true, html: apps.length === 0 ? "<p>No app is registered yet: an app registers on its first <code>deploy</code>.</p>" : `<ul>${apps.map((x) => `<li><code>${esc(String(x.app))}</code>: ${esc(String(x.return_url))}</li>`).join("")}</ul>` }
    : fail("reading the registered apps", apps);
  const usersPart: Part = Array.isArray(users)
    ? {
        ok: true,
        html:
          users.length === 0
            ? "<p>Nobody has signed in through the auth app yet.</p>"
            : `<ul>${users.map((u) => `<li>${esc(String(u.email))} (${esc(String(u.role))}), last signed in ${typeof u.updated_at === "number" ? esc(new Date(u.updated_at).toISOString()) : "at an unknown time"}</li>`).join("")}</ul>`,
      }
    : fail("reading recent sign-ins", users);
  return { apps: appsPart, signIns: usersPart };
}

const section = (title: string, p: Part): string => `<h2>${esc(title)}</h2>${p.ok ? p.html : `<p class="warn">${esc(p.why)}</p>`}`;

async function run(ctx: GrantContext): Promise<string> {
  const a = ctx.accountId;
  const [w, s, d] = await Promise.all([workers(ctx.api, a), setupRecord(ctx.api, a), authData(ctx.api, a)]);
  return [section("Workers", w), section("Account setup", s), section("Registered apps", d.apps), section("Recent sign-ins", d.signIns)].join("\n");
}

export const statusPage: AdminPage = {
  id: "status",
  title: "Status",
  view: () => "<p>Shows what is set up, at which version, the apps registered with the auth app, and recent sign-ins. It only reads; Cloudflare asks you to approve read access through the permissions this needs.</p>",
  run,
};
