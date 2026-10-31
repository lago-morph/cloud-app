/** The bootstrap's OAuth clients and their secrets in Secrets Store (v0.2.0 plan §5.1 step 2, §2.1, §2.1a; DEC-0684, DEC-0685), on the fake Cloudflare API. */
import { describe, expect, it } from "vitest";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import { ADMIN_OPTIONAL_SCOPES, CLIENT_NAMES, CLIENT_SECRET_NAMES, clientBody, ensureOAuthClients, ensureSubdomain, REQUIRED_SCOPES } from "./oauth-clients.js";
import { ensureStore, putSecret, secretIds, STORE_NAME } from "./secrets-store.js";

const SUB = "pf-clientsub";

const writes = (cloud: FakeCloud) => cloud.requests.filter((r) => !r.startsWith("GET "));

describe("clientBody (plan §5.1 step 2)", () => {
  it("the admin client: private and confidential, code + id_token, the two required scopes, one optional scope per admin-page need", () => {
    expect(REQUIRED_SCOPES).toEqual(["user-details.read", "memberships.read"]);
    expect(ADMIN_OPTIONAL_SCOPES).toEqual(["account-api-tokens.write", "d1.write", "secrets-store.read", "secrets-store.write", "workers-r2.write", "workers-scripts.write"]);
    expect(clientBody("admin", SUB)).toEqual({
      name: "prototype-framework-admin",
      redirect_uris: [`https://prototype-admin.${SUB}.workers.dev/callback`],
      response_types: ["code", "id_token"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_post",
      scopes: ["user-details.read", "memberships.read"],
      optional_scopes: [...ADMIN_OPTIONAL_SCOPES],
    });
  });

  it("the sign-in client: the two required scopes only, no optional scope, the auth app's callback", () => {
    expect(clientBody("signin", SUB)).toEqual({
      name: "prototype-framework-sign-in",
      redirect_uris: [`https://prototype-auth.${SUB}.workers.dev/callback`],
      response_types: ["code", "id_token"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_post",
      scopes: ["user-details.read", "memberships.read"],
      optional_scopes: [],
    });
  });
});

describe("ensureSubdomain", () => {
  it("keeps the account's subdomain; registers one when it has none", async () => {
    const cloud = new FakeCloud();
    cloud.subdomain = "kept";
    expect(await ensureSubdomain(cloud.api, ACCOUNT, () => SUB)).toBe("kept");
    expect(writes(cloud)).toEqual([]);
    cloud.subdomain = undefined;
    expect(await ensureSubdomain(cloud.api, ACCOUNT, () => SUB)).toBe(SUB);
    expect(writes(cloud)).toEqual([`PUT /accounts/${ACCOUNT}/workers/subdomain`]);
  });
});

describe("the Secrets Store (create and put only)", () => {
  it("uses the account's store, or creates one named PAR-437 when there is none; puts a new secret, then replaces its value", async () => {
    const cloud = new FakeCloud();
    expect(await ensureStore(cloud.api, ACCOUNT)).toBe("store1");
    cloud.secretStores.clear();
    const id = await ensureStore(cloud.api, ACCOUNT);
    expect(cloud.secretStores.get(id)?.name).toBe(STORE_NAME);
    await putSecret(cloud.api, ACCOUNT, id, "ONE", "first");
    const ids = await secretIds(cloud.api, ACCOUNT, id);
    await putSecret(cloud.api, ACCOUNT, id, "ONE", "second", ids.get("ONE"));
    expect(cloud.secretStores.get(id)?.secrets.get("ONE")).toMatchObject({ value: "second", scopes: ["workers"] });
  });

  it("a refused put names the secret, never its value", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`POST /accounts/${ACCOUNT}/secrets_store/stores/store1/secrets`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null } });
    await expect(putSecret(cloud.api, ACCOUNT, "store1", "ONE", "the-value")).rejects.toThrow(/^putting the secret ONE into Secrets Store failed: HTTP 403/);
    await expect(putSecret(cloud.api, ACCOUNT, "store1", "ONE", "the-value")).rejects.not.toThrow(/the-value/);
  });
});

describe("ensureOAuthClients (plan §5.1 step 2)", () => {
  it("a fresh account: creates both clients and puts each one's ID and secret straight into Secrets Store; returns no secret", async () => {
    const cloud = new FakeCloud();
    const seen: string[] = [];
    const result = await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB, onSecret: (v) => seen.push(v) });
    expect(result).toEqual({ created: ["admin", "signin"], kept: [] });
    const clients = [...cloud.oauthClients.values()];
    expect(clients.map((c) => c.name)).toEqual([CLIENT_NAMES.admin, CLIENT_NAMES.signin]);
    const store = cloud.secretStores.get("store1")!.secrets;
    for (const [kind, client] of [["admin", clients[0]!], ["signin", clients[1]!]] as const) {
      expect(store.get(CLIENT_SECRET_NAMES[kind].id)?.value).toBe(client.id);
      expect(store.get(CLIENT_SECRET_NAMES[kind].secret)?.value).toBe(client.secret);
      expect(seen).toContain(client.secret);
    }
    expect(JSON.stringify(result)).not.toContain("secret-");
    // Each secret is put right after its client's create, before the next client.
    expect(writes(cloud).map((w) => w.replace(/\/accounts\/[^/]+/, ""))).toEqual([
      "POST /oauth_clients",
      "POST /secrets_store/stores/store1/secrets",
      "POST /secrets_store/stores/store1/secrets",
      "POST /oauth_clients",
      "POST /secrets_store/stores/store1/secrets",
      "POST /secrets_store/stores/store1/secrets",
    ]);
  });

  it("run again: both clients are kept (each found by name with its secrets in the store), nothing is written", async () => {
    const cloud = new FakeCloud();
    await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB });
    cloud.requests.length = 0;
    expect(await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).toEqual({ created: [], kept: ["admin", "signin"] });
    expect(writes(cloud)).toEqual([]);
  });

  it("a client whose secret is not in the store (its create answer was lost): replaced, and the new secret put over the old entries", async () => {
    const cloud = new FakeCloud();
    await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB });
    const store = cloud.secretStores.get("store1")!.secrets;
    store.delete(CLIENT_SECRET_NAMES.signin.secret);
    const oldId = store.get(CLIENT_SECRET_NAMES.signin.id)!.value;
    cloud.requests.length = 0;
    expect(await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).toEqual({ created: ["signin"], kept: ["admin"] });
    expect(cloud.oauthClients.has(oldId)).toBe(false);
    const fresh = [...cloud.oauthClients.values()].find((c) => c.name === CLIENT_NAMES.signin)!;
    expect(store.get(CLIENT_SECRET_NAMES.signin.id)?.value).toBe(fresh.id);
    expect(store.get(CLIENT_SECRET_NAMES.signin.secret)?.value).toBe(fresh.secret);
    expect(writes(cloud).map((w) => w.replace(/\/accounts\/[^/]+/, ""))).toEqual([
      `DELETE /oauth_clients/${oldId}`,
      "POST /oauth_clients",
      "POST /secrets_store/stores/store1/secrets",
      expect.stringMatching(/^PATCH \/secrets_store\/stores\/store1\/secrets\/sec\d+$/),
    ]);
  });

  it("each stored entry names its client (the secret's comment holds the client ID), so the entries are tied to one client", async () => {
    const cloud = new FakeCloud();
    await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB });
    const store = cloud.secretStores.get("store1")!.secrets;
    for (const kind of ["admin", "signin"] as const) {
      const id = store.get(CLIENT_SECRET_NAMES[kind].id)!.value;
      expect(store.get(CLIENT_SECRET_NAMES[kind].id)?.comment).toBe(id);
      expect(store.get(CLIENT_SECRET_NAMES[kind].secret)?.comment).toBe(id);
    }
  });

  it("review A: a replacement whose ID put failed leaves the secret of the new client and the ID of the deleted one; the next run replaces the client again", async () => {
    const cloud = new FakeCloud();
    await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB });
    const store = cloud.secretStores.get("store1")!.secrets;
    store.delete(CLIENT_SECRET_NAMES.admin.secret);
    const idEntry = store.get(CLIENT_SECRET_NAMES.admin.id)!.id;
    cloud.override.set(`PATCH /accounts/${ACCOUNT}/secrets_store/stores/store1/secrets/${idEntry}`, { status: 500, body: { success: false, errors: [{ code: 1, message: "Internal" }], result: null } });
    await expect(ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).rejects.toThrow(/the next setup run replaces the client/);
    cloud.override.clear();
    expect(await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).toEqual({ created: ["admin"], kept: ["signin"] });
    const admin = [...cloud.oauthClients.values()].filter((c) => c.name === CLIENT_NAMES.admin);
    expect(admin).toHaveLength(1);
    expect(store.get(CLIENT_SECRET_NAMES.admin.id)?.value).toBe(admin[0]!.id);
    expect(store.get(CLIENT_SECRET_NAMES.admin.secret)?.value).toBe(admin[0]!.secret);
  });

  it("review B: entries of a client deleted in the dashboard are not taken for the client found by name", async () => {
    const cloud = new FakeCloud();
    await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB });
    const old = [...cloud.oauthClients.values()].find((c) => c.name === CLIENT_NAMES.signin)!;
    cloud.oauthClients.delete(old.id);
    // Someone made a client of the same name by hand: its secret is not in the store.
    cloud.oauthClients.set("hand-made", { id: "hand-made", name: CLIENT_NAMES.signin, body: {}, secret: "unknown" });
    expect(await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).toEqual({ created: ["signin"], kept: ["admin"] });
    expect(cloud.oauthClients.has("hand-made")).toBe(false);
    const fresh = [...cloud.oauthClients.values()].find((c) => c.name === CLIENT_NAMES.signin)!;
    expect(cloud.secretStores.get("store1")!.secrets.get(CLIENT_SECRET_NAMES.signin.id)?.value).toBe(fresh.id);
  });

  it("a client list longer than one page is refused rather than read in part (a missed client would be duplicated)", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`GET /accounts/${ACCOUNT}/oauth_clients?per_page=100`, { status: 200, body: { success: true, errors: [], result: [], result_info: { page: 1, per_page: 100, count: 0, total_count: 101 } } });
    await expect(ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).rejects.toThrow("the account has 101 OAuth clients, more than one page of 100; setup reads one page only");
  });

  it("a create answer without a secret: fails naming the client; nothing is stored for it", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`POST /accounts/${ACCOUNT}/oauth_clients`, { status: 200, body: { success: true, errors: [], result: { client_id: "c-x", name: CLIENT_NAMES.admin } } });
    await expect(ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).rejects.toThrow(`creating the OAuth client ${CLIENT_NAMES.admin}: Cloudflare's answer held no client secret`);
    expect(cloud.secretStores.get("store1")!.secrets.size).toBe(0);
  });

  it("a refused create (no OAuth Client Write): fails naming the client and the answer", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`POST /accounts/${ACCOUNT}/oauth_clients`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null } });
    await expect(ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB })).rejects.toThrow(`creating the OAuth client ${CLIENT_NAMES.admin} failed: HTTP 403: Authentication error (code 10000)`);
  });

  it("a put that fails after the create: fails saying a later run replaces the client, and never shows the secret", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`POST /accounts/${ACCOUNT}/secrets_store/stores/store1/secrets`, { status: 500, body: { success: false, errors: [{ code: 1, message: "Internal" }], result: null } });
    const error = (await ensureOAuthClients(cloud.api, ACCOUNT, { subdomain: SUB }).then(() => undefined, (e: unknown) => e)) as Error;
    expect(error.message).toContain(`putting the secret ${CLIENT_SECRET_NAMES.admin.secret} into Secrets Store failed`);
    expect(error.message).toContain("the next setup run replaces the client");
    const client = [...cloud.oauthClients.values()][0]!;
    expect(error.message).not.toContain(client.secret);
  });
});
