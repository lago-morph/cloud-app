/**
 * The auth app's deploy by the admin app's account setup (v0.2.0 plan §5.2 page 1; DEC-0719): its
 * D1 database found or created, the Worker `prototype-auth` uploaded with the sign-in client's ID
 * and secret from Secrets Store, its D1 as `DB`, its account and origin, and its route on. Fake
 * Cloudflare (C's FakeCloud plus D1 database list/create), no network.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "./api.js";
import { AUTH_APP_BINDINGS, AUTH_APP_DATABASE, deployAuthApp, ensureAuthDatabase } from "./auth-app-deploy.js";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import { CLIENT_SECRET_NAMES } from "./oauth-clients.js";

const SUB = "pf-sub";
const SOURCE = 'export default { fetch() { return new Response("auth"); } };';
const UUID = "0000aaaa-bbbb-cccc-dddd-eeeeffff0001";
let cloud: FakeCloud;
let dbs: { uuid: string; name: string }[];
let api: CloudflareApi;

const ok = (result: unknown): ApiReply => ({ status: 200, body: { success: true, errors: [], result } });

beforeEach(() => {
  cloud = new FakeCloud();
  dbs = [];
  const store = cloud.secretStores.get("store1")!;
  store.secrets.set(CLIENT_SECRET_NAMES.signin.id, { id: "s1", value: "signin-client", comment: "signin-client" });
  store.secrets.set(CLIENT_SECRET_NAMES.signin.secret, { id: "s2", value: "signin-secret", comment: "signin-client" });
  api = (method, path, body) => {
    const p = path.split("?")[0];
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === "GET") return Promise.resolve(ok(dbs.filter((d) => path.includes(`name=${d.name}`))));
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === "POST") {
      const made = { uuid: UUID, name: (body as { name: string }).name };
      dbs.push(made);
      return Promise.resolve(ok(made));
    }
    return cloud.api(method, path, body);
  };
});

describe("ensureAuthDatabase", () => {
  it("creates prototype-auth when absent and finds it afterwards; never a second one", async () => {
    expect(await ensureAuthDatabase(api, ACCOUNT)).toEqual({ uuid: UUID, created: true });
    expect(await ensureAuthDatabase(api, ACCOUNT)).toEqual({ uuid: UUID, created: false });
    expect(dbs).toEqual([{ uuid: UUID, name: AUTH_APP_DATABASE }]);
  });

  it("a refused create names the database and Cloudflare's answer", async () => {
    const refusing: CloudflareApi = (m, p, b) => (m === "POST" ? Promise.resolve({ status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }] } }) : api(m, p, b));
    await expect(ensureAuthDatabase(refusing, ACCOUNT)).rejects.toThrow("creating the auth app's D1 database prototype-auth failed: HTTP 403: Unauthorized (code 9109)");
  });
});

describe("deployAuthApp", () => {
  it("uploads prototype-auth with its D1, the sign-in client from Secrets Store, its account and origin; route on, previews off; returns its origin", async () => {
    const out = await deployAuthApp(api, ACCOUNT, { source: SOURCE, storeId: "store1", subdomain: SUB });
    expect(out).toEqual({ origin: `https://prototype-auth.${SUB}.workers.dev`, databaseId: UUID, databaseCreated: true });
    const w = cloud.workers.get("prototype-auth")!;
    expect(w.bindings).toEqual([
      { type: "d1", name: "DB", id: UUID },
      { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_ID", store_id: "store1", secret_name: "PROTOTYPE_SIGNIN_CLIENT_ID" },
      { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_SECRET", store_id: "store1", secret_name: "PROTOTYPE_SIGNIN_CLIENT_SECRET" },
      { type: "plain_text", name: "AUTH_APP_ACCOUNT_ID", text: ACCOUNT },
      { type: "plain_text", name: "AUTH_APP_ORIGIN", text: `https://prototype-auth.${SUB}.workers.dev` },
    ]);
    expect(AUTH_APP_BINDINGS).toEqual({ db: "DB", clientId: "AUTH_APP_CLIENT_ID", clientSecret: "AUTH_APP_CLIENT_SECRET", accountId: "AUTH_APP_ACCOUNT_ID", origin: "AUTH_APP_ORIGIN" });
    expect(w.modules?.get("worker.js")).toBe(SOURCE);
    expect(w.enabled).toBe(true);
    expect(w.previews).toBe(false);
  });

  it("stops before any write when the sign-in client is not in Secrets Store (the bootstrap did not finish)", async () => {
    cloud.secretStores.get("store1")!.secrets.delete(CLIENT_SECRET_NAMES.signin.secret);
    await expect(deployAuthApp(api, ACCOUNT, { source: SOURCE, storeId: "store1", subdomain: SUB })).rejects.toThrow(
      "the sign-in client's PROTOTYPE_SIGNIN_CLIENT_SECRET is not in Secrets Store: run npm run cloudflare-setup with a bootstrap token first",
    );
    expect(cloud.requests.filter((r) => !r.startsWith("GET "))).toEqual([]);
    expect(dbs).toEqual([]);
  });

  it("a refused upload names the Worker and the answer", async () => {
    cloud.override.set(`PUT /accounts/${ACCOUNT}/workers/scripts/prototype-auth`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
    await expect(deployAuthApp(api, ACCOUNT, { source: SOURCE, storeId: "store1", subdomain: SUB })).rejects.toThrow("uploading the auth app (Worker prototype-auth) failed: HTTP 403: Authentication error (code 10000)");
  });
});
