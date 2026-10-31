/**
 * The auth app's Worker entry under local workerd (Miniflare): the bundled module serves the HTTP
 * routes, applies its schema itself (DEC-0656), and answers `redeem`/`role` over a real service
 * binding from another Worker (named entrypoint `AuthApp`, DEC-0660). No network: the upstream
 * is never reached in these cases.
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCode, registerReturnUrl, upsertUser, type D1Like } from "./store.js";
import { authAppMiniflareWorkers, bundleAuthAppWorker } from "./worker-bundle.test-support.js";

const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
let mf: Miniflare;
let db: D1Like;

beforeAll(async () => {
  mf = new Miniflare({
    workers: authAppMiniflareWorkers(await bundleAuthAppWorker(), {
      AUTH_APP_CLIENT_ID: "cid",
      AUTH_APP_CLIENT_SECRET: "csecret",
      AUTH_APP_ACCOUNT_ID: "acct",
      AUTH_APP_ORIGIN: "https://auth.acct.workers.dev",
      AUTH_APP_DISCOVERY_URL: "http://127.0.0.1:9/none",
    }),
  });
  db = (await mf.getD1Database("DB", "auth")) as unknown as D1Like;
}, 60_000);
afterAll(async () => {
  await mf?.dispose();
});

const authFetch = async (path: string) => (await mf.getWorker("auth")).fetch(`https://auth.acct.workers.dev${path}`, { redirect: "manual" });
const call = async (path: string, body: unknown) => {
  const res = await (await mf.getWorker("app")).fetch(`https://app.example${path}`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } };
};

describe("auth app Worker", () => {
  it("creates its own schema and refuses an unregistered return URL at /start", async () => {
    const res = await authFetch(`/start?${new URLSearchParams({ app: APP, return: RETURN, state: "s" })}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    await res.text();
  });

  it("answers 404 for other paths", async () => {
    const res = await authFetch("/");
    expect(res.status).toBe(404);
    await res.text();
  });

  it("redeems a code over the service binding exactly once", async () => {
    await registerReturnUrl(db, APP, RETURN);
    await upsertUser(db, { sub: "sub-w", email: "w@example.com", role: "admin" }, Date.now());
    const code = await createCode(db, { sub: "sub-w", app: APP, returnUrl: RETURN }, Date.now());
    await expect(call("/redeem", { code, app: APP })).resolves.toEqual({ status: 200, body: { result: { sub: "sub-w", email: "w@example.com", role: "admin" } } });
    await expect(call("/redeem", { code, app: APP })).resolves.toEqual({ status: 200, body: { result: null } });
  });

  it("answers role(sub) over the service binding", async () => {
    await expect(call("/role", { sub: "sub-w" })).resolves.toEqual({ status: 200, body: { result: "admin" } });
    await expect(call("/role", { sub: "nobody" })).resolves.toEqual({ status: 200, body: { result: null } });
  });

  it("refuses wrong-shaped RPC input with null", async () => {
    await expect(call("/redeem", { code: 5 })).resolves.toEqual({ status: 200, body: { result: null } });
  });
});
