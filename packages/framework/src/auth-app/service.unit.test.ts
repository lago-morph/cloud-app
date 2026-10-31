/**
 * The auth app's side of the service binding (contract docs/contracts/ts/internal/auth-app.d.ts,
 * DEC-0650) over a real local D1, and its configuration from the Worker's env.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_APP_CODE_LIFETIME_MS } from "../auth/auth-app-binding.js";
import { readConfig } from "./config.js";
import { localD1, type LocalD1 } from "./d1.test-support.js";
import { CLOUDFLARE_API_BASE, CLOUDFLARE_DISCOVERY_URL } from "./params.js";
import { createAuthAppService } from "./service.js";
import { createCode, ensureSchema, registerReturnUrl, upsertUser, type D1Like } from "./store.js";

const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
let d1: LocalD1;
let t = 1_800_000_000_000;
beforeAll(async () => {
  d1 = await localD1();
  await ensureSchema(d1.db);
  await registerReturnUrl(d1.db, APP, RETURN);
  await upsertUser(d1.db, { sub: "sub-a", email: "a@example.com", role: "admin" }, t);
}, 60_000);
afterAll(async () => {
  await d1.dispose();
});

describe("createAuthAppService", () => {
  const service = () => createAuthAppService({ db: d1.db, now: () => t });

  it("redeems a code once", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, t);
    await expect(service().redeem({ code, app: APP })).resolves.toEqual({ sub: "sub-a", email: "a@example.com", role: "admin" });
    await expect(service().redeem({ code, app: APP })).resolves.toBeNull();
  });

  it("uses its clock for the 60 s lifetime", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, t);
    t += AUTH_APP_CODE_LIFETIME_MS + 1;
    await expect(service().redeem({ code, app: APP })).resolves.toBeNull();
  });

  it("answers null for input of the wrong shape (values arrive over RPC unchecked)", async () => {
    const s = service() as unknown as { redeem(v: unknown): Promise<unknown>; role(v: unknown): Promise<unknown> };
    for (const bad of [undefined, null, "x", { code: 1, app: APP }, { code: "c" }, { app: APP }]) await expect(s.redeem(bad), JSON.stringify(bad)).resolves.toBeNull();
    for (const bad of [undefined, 3, "", {}]) await expect(s.role(bad), JSON.stringify(bad)).resolves.toBeNull();
  });

  it("answers the stored role, or null", async () => {
    await expect(service().role("sub-a")).resolves.toBe("admin");
    await expect(service().role("nobody")).resolves.toBeNull();
  });

  it("rejects when D1 cannot answer, so the app retries (never a silent null)", async () => {
    const broken: D1Like = {
      prepare: () => {
        throw new Error("D1_ERROR: database unavailable");
      },
      batch: () => Promise.reject(new Error("D1_ERROR")),
    };
    const seen: unknown[] = [];
    const s = createAuthAppService({ db: broken, now: () => t, onError: (e) => seen.push(e) });
    await expect(s.role("sub-a")).rejects.toThrow(/^auth app unavailable$/);
    await expect(s.redeem({ code: "A".repeat(43), app: APP })).rejects.toThrow(/^auth app unavailable$/);
    expect(seen.map((e) => (e as Error).message)).toEqual(["D1_ERROR: database unavailable", "D1_ERROR: database unavailable"]);
  });
});

describe("readConfig", () => {
  const env = { DB: {}, AUTH_APP_CLIENT_ID: "cid", AUTH_APP_CLIENT_SECRET: "csecret", AUTH_APP_ACCOUNT_ID: "acct", AUTH_APP_ORIGIN: "https://auth.acct.workers.dev" };

  it("reads the client, account and origin, with Cloudflare's upstream by default", async () => {
    await expect(readConfig(env)).resolves.toEqual({
      clientId: "cid",
      clientSecret: "csecret",
      accountId: "acct",
      discoveryUrl: CLOUDFLARE_DISCOVERY_URL,
      apiBase: CLOUDFLARE_API_BASE,
      callbackUrl: "https://auth.acct.workers.dev/callback",
    });
  });

  it("reads the client secret from a Secrets Store binding", async () => {
    await expect(readConfig({ ...env, AUTH_APP_CLIENT_SECRET: { get: async () => "from-store" } })).resolves.toMatchObject({ clientSecret: "from-store" });
  });

  it("takes upstream overrides (tests point them at mock-oauth2-server)", async () => {
    await expect(readConfig({ ...env, AUTH_APP_DISCOVERY_URL: "http://127.0.0.1:1/cf/.well-known/openid-configuration", AUTH_APP_API_BASE: "http://127.0.0.1:2/client/v4" })).resolves.toMatchObject({
      discoveryUrl: "http://127.0.0.1:1/cf/.well-known/openid-configuration",
      apiBase: "http://127.0.0.1:2/client/v4",
    });
  });

  it("allows http only for a localhost origin (no cleartext callback elsewhere)", async () => {
    await expect(readConfig({ ...env, AUTH_APP_ORIGIN: "http://localhost:8788" })).resolves.toMatchObject({ callbackUrl: "http://localhost:8788/callback" });
    await expect(readConfig({ ...env, AUTH_APP_ORIGIN: "http://127.0.0.1:8788" })).resolves.toMatchObject({ callbackUrl: "http://127.0.0.1:8788/callback" });
    await expect(readConfig({ ...env, AUTH_APP_ORIGIN: "http://auth.example" })).rejects.toThrow(/^auth app misconfigured: AUTH_APP_ORIGIN is not an origin$/);
  });

  it("names the secret, not Cloudflare's error, when the Secrets Store read fails or is empty", async () => {
    const failing = { get: async () => Promise.reject(new Error("store error with detail")) };
    await expect(readConfig({ ...env, AUTH_APP_CLIENT_SECRET: failing })).rejects.toThrow(/^auth app misconfigured: AUTH_APP_CLIENT_SECRET could not be read$/);
    await expect(readConfig({ ...env, AUTH_APP_CLIENT_SECRET: { get: async () => "" } })).rejects.toThrow(/^auth app misconfigured: AUTH_APP_CLIENT_SECRET is not set$/);
  });

  it("names a missing or empty setting, never a value", async () => {
    for (const name of ["AUTH_APP_CLIENT_ID", "AUTH_APP_CLIENT_SECRET", "AUTH_APP_ACCOUNT_ID", "AUTH_APP_ORIGIN"]) {
      const err = (await readConfig({ ...env, [name]: "" }).catch((e: unknown) => e)) as Error;
      expect(err.message, name).toBe(`auth app misconfigured: ${name} is not set`);
    }
  });

  it("refuses an origin that is not a bare origin", async () => {
    for (const origin of ["https://auth.example/path", "notaurl", "ftp://auth.example"]) {
      await expect(readConfig({ ...env, AUTH_APP_ORIGIN: origin }), origin).rejects.toThrow("auth app misconfigured: AUTH_APP_ORIGIN is not an origin");
    }
  });
});
