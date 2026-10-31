/** The admin app's fake Cloudflare enforces granted scopes as the live API did (plan §2.1, §2.1a). */
import { describe, expect, it } from "vitest";
import { s256Challenge } from "../auth-app/pkce.js";
import { ACCOUNT, API_BASE, CLIENT_ID, CLIENT_SECRET, fakeCloudflare, ISSUER, ORIGIN, scopeFor } from "./fake-cloudflare.test-support.js";

const VERIFIER = "v".repeat(43);

async function tokenFor(untick: string[] = [], scope = "openid user-details.read memberships.read workers-scripts.write account-api-tokens.write") {
  const cf = await fakeCloudflare({ account: async () => ({ status: 200, body: { success: true, result: [] } }) });
  cf.members.set("s", { sub: "s", roles: ["Administrator"] });
  const auth = new URL(`${ISSUER}/oauth2/auth`);
  for (const [k, v] of Object.entries({ redirect_uri: `${ORIGIN}/callback`, scope, state: "st", nonce: "n", code_challenge: await s256Challenge(VERIFIER) })) auth.searchParams.set(k, v);
  const code = new URL(cf.consent(auth.toString(), { sub: "s", untick })).searchParams.get("code")!;
  const form = { grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: `${ORIGIN}/callback`, client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
  const res = await cf.fetch(`${ISSUER}/oauth2/token`, { method: "POST", body: new URLSearchParams(form) });
  const body = (await res.json()) as { access_token: string; scope: string };
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await cf.fetch(`${API_BASE}${path}`, { method, headers: { authorization: `Bearer ${body.access_token}`, ...(json === undefined ? {} : { "content-type": "application/json" }) }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
    return { status: r.status, body: (await r.json()) as { errors?: { code: number }[] } };
  };
  return { cf, body, call };
}

describe("fake Cloudflare", () => {
  it("answers the granted scope, without the unticked ones", async () => {
    const { body } = await tokenFor(["account-api-tokens.write"]);
    expect(body.scope.split(" ")).toEqual(["openid", "user-details.read", "memberships.read", "workers-scripts.write", "offline_access"]);
  });

  it("refuses a call whose scope was not granted with 403 code 9109, and allows it when granted", async () => {
    const without = await tokenFor(["workers-scripts.write"]);
    const r = await without.call("GET", `/accounts/${ACCOUNT}/workers/scripts`);
    expect(r.status).toBe(403);
    expect(r.body.errors?.[0]?.code).toBe(9109);
    expect((await (await tokenFor()).call("GET", `/accounts/${ACCOUNT}/workers/scripts`)).status).toBe(200);
  });

  it("refuses a grant-made token holding a group no granted scope covers with 400 code 1001 (§2.1a)", async () => {
    const { call } = await tokenFor();
    const r = await call("POST", `/accounts/${ACCOUNT}/tokens`, { name: "t", policies: [{ effect: "allow", resources: {}, permission_groups: [{ id: "x", name: "D1 Write" }] }] });
    expect(r.status).toBe(400);
    expect(r.body.errors?.[0]?.code).toBe(1001);
    const ok = await call("POST", `/accounts/${ACCOUNT}/tokens`, { name: "t", policies: [{ effect: "allow", resources: {}, permission_groups: [{ id: "y", name: "Workers Scripts Write" }] }] });
    expect(ok.status).toBe(200);
  });

  it("refuses a revoked token", async () => {
    const { cf, body, call } = await tokenFor();
    await cf.fetch(`${ISSUER}/oauth2/revoke`, { method: "POST", body: new URLSearchParams({ token: body.access_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }) });
    expect((await call("GET", "/memberships")).status).toBe(403);
  });

  it("maps API paths to the live scope IDs", () => {
    expect(scopeFor("GET", "/memberships")).toBeUndefined();
    expect(scopeFor("PUT", `/accounts/${ACCOUNT}/tokens/abc`)).toBe("account-api-tokens.write");
    expect(scopeFor("POST", `/accounts/${ACCOUNT}/d1/database/x/query`)).toBe("d1.write");
    expect(scopeFor("GET", `/accounts/${ACCOUNT}/r2/buckets`)).toBe("workers-r2.write");
    expect(scopeFor("GET", `/accounts/${ACCOUNT}/secrets_store/stores`)).toBe("secrets-store.read");
    expect(scopeFor("POST", `/accounts/${ACCOUNT}/secrets_store/stores/s/secrets`)).toBe("secrets-store.write");
  });
});
