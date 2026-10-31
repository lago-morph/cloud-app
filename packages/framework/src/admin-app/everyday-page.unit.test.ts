/**
 * Admin page 2 end to end in-process (v0.2.0 plan §5.2 page 2, §7): the grant asks for exactly the
 * page's scopes; the fake API enforces them (a grant-made token may hold only groups its scopes
 * cover, §2.1a); the created token holds exactly the four groups; a 0.1.x token is updated in
 * place without its email and zone groups; the value is shown once and nowhere else.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN_NAMES } from "../provision/cloudflare/permissions.js";
import { handleAdminRequest, type AdminDeps } from "./app.js";
import { everydayPage } from "./everyday-page.js";
import { ACCOUNT, API_BASE, CLIENT_ID, CLIENT_SECRET, DISCOVERY, fakeCloudflare, ORIGIN, type FakeCloudflare } from "./fake-cloudflare.test-support.js";
import { fakeTokens, type FakeTokens } from "./fake-tokens.test-support.js";
import { PAGE_SCOPES } from "./scopes.js";

const FOUR = ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "5e33b7d77788455c9fdf18cbd38ee5a0"];
let cf: FakeCloudflare;
let store: FakeTokens;
let logs: string[];
const jar = new Map<string, string>();

const deps = (): AdminDeps => ({
  fetch: cf.fetch,
  now: Date.now,
  log: (l) => logs.push(l),
  config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, accountId: ACCOUNT, origin: ORIGIN, discoveryUrl: DISCOVERY, apiBase: API_BASE },
  pages: [everydayPage],
});

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  if (init.method === "POST") headers.set("origin", ORIGIN);
  const res = await handleAdminRequest(new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, { ...init, headers }), deps());
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const eq = pair.indexOf("=");
    if (/Max-Age=0/.test(c)) jar.delete(pair.slice(0, eq));
    else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return res;
}

/** Sign in, then run page 2's action through a grant; the result page. */
async function runPage(untick: string[] = [], form?: Record<string, string>): Promise<Response> {
  if (!jar.has("__Host-admin-session")) {
    const s = await send("/signin", { method: "POST" });
    await send(cf.consent(s.headers.get("location")!, { sub: "owner" }));
  }
  const start = await send("/everyday", { method: "POST", ...(form === undefined ? {} : { body: new URLSearchParams(form) }) });
  expect(start.status).toBe(302);
  return send(cf.consent(start.headers.get("location")!, { sub: "owner", untick }));
}

const groupIds = (t: { readonly policies: readonly { readonly permission_groups: readonly { readonly id: string }[] }[] }) => t.policies.flatMap((p) => p.permission_groups.map((g) => g.id));

beforeEach(async () => {
  jar.clear();
  logs = [];
  store = fakeTokens(ACCOUNT);
  cf = await fakeCloudflare({ account: store.api });
  cf.members.set("owner", { sub: "owner", email: "owner@example.com", roles: ["Super Administrator - All Privileges"] });
});

describe("page 2: the everyday token", () => {
  it("asks Cloudflare for exactly the page's scopes", async () => {
    await runPage();
    const asked = cf.issued.at(-1)!.scope.filter((s) => !["openid", "user-details.read", "memberships.read", "offline_access"].includes(s));
    expect(asked.sort()).toEqual([...PAGE_SCOPES.everyday].sort());
  });

  it("creates the token with exactly the four groups and shows its value once, with a copy button, and the tokens are revoked", async () => {
    const r = await runPage();
    expect(r.status).toBe(200);
    const [t] = [...store.tokens.values()];
    expect(t!.name).toBe(TOKEN_NAMES.everyday);
    expect(groupIds(t!)).toEqual(FOUR);
    const html = await r.text();
    expect(html.split(t!.value)).toHaveLength(2);
    expect(html).toContain('id="copy"');
    expect(html).toContain("CLOUDFLARE_API_TOKEN=");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[0-9a-f]+'/);
    expect(logs.join("\n")).not.toContain(t!.value);
    expect(cf.issued.every((x) => x.revokedAccess && x.revokedRefresh)).toBe(true);
  });

  it("updates a 0.1.x token in place: email and zone groups removed, value kept and not shown", async () => {
    const old = store.add({
      id: "a".repeat(32),
      name: TOKEN_NAMES.everyday,
      value: "old-value-1234",
      policies: [
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: [{ id: FOUR[0]! }, { id: FOUR[1]! }, { id: FOUR[2]! }, { id: "2d5b4b1f6c89487bb7184c2c1dcd3bf1" }] },
        { effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: [{ id: "c8fed203ed3043cba015a93ad1616f1f" }, { id: "9c88f9c5bce24ce7af9a958ba9c504db" }, { id: "1b600d9d8062443e986a973f097e728a" }] },
      ],
    });
    const r = await runPage();
    const html = await r.text();
    expect(html).toContain("updated in place");
    expect(html).toContain("Email Routing Rules Read");
    expect(html).not.toContain("old-value-1234");
    expect(groupIds(store.tokens.get(old.id)!)).toEqual(FOUR);
    expect(JSON.stringify(store.tokens.get(old.id)!.policies)).not.toContain("zone");
    expect(store.tokens.get(old.id)!.value).toBe("old-value-1234");
  });

  it("an unticked scope: the page names it, nothing is created", async () => {
    const r = await runPage(["secrets-store.read"]);
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("secrets-store.read");
    expect(store.tokens.size).toBe(0);
    expect(store.writes).toEqual([]);
  });

  it("when the grant may not update the old token: a new value is shown, and the old token goes only after the person confirms", async () => {
    const old = store.add({ id: "b".repeat(32), name: TOKEN_NAMES.everyday, value: "old-v", policies: [] });
    store.refuseUpdate.add(old.id);
    const r = await runPage();
    const html = await r.text();
    const created = [...store.tokens.values()].find((t) => t.id !== old.id)!;
    expect(html).toContain(created.value);
    expect(html).toContain(`value="delete:${old.id}"`);
    expect(store.tokens.has(old.id)).toBe(true);
    const done = await runPage([], { action: `delete:${old.id}` });
    expect(await done.text()).toContain("Deleted 1 old everyday token");
    expect(store.tokens.has(old.id)).toBe(false);
    expect(store.tokens.has(created.id)).toBe(true);
  });

  it("a refusal from Cloudflare shows the step and the answer, and the scope advice for code 9109", async () => {
    cf.override.set(`GET /accounts/${ACCOUNT}/tokens?per_page=50&page=1`, { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] } });
    const r = await runPage();
    expect(r.status).toBe(502);
    const html = await r.text();
    expect(html).toContain("listing the account&#39;s API tokens failed: HTTP 403");
    expect(html).toContain("keep every permission");
  });
});
