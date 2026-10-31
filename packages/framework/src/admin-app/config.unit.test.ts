/** The admin app's settings from its Worker env (DEC-0711): errors name the setting, never its value. */
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_API_BASE, CLOUDFLARE_DISCOVERY_URL } from "../auth-app/params.js";
import { readAdminConfig } from "./config.js";

const store = (value: string) => ({ get: () => Promise.resolve(value) });
const ENV = {
  ADMIN_CLIENT_ID: store("cid"),
  ADMIN_CLIENT_SECRET: store("very-secret-value"),
  ADMIN_ACCOUNT_ID: "acct",
  ADMIN_APP_ORIGIN: "https://prototype-admin.sub.workers.dev",
};

describe("readAdminConfig", () => {
  it("reads the client from Secrets Store bindings and the plain settings; Cloudflare's endpoints by default", async () => {
    expect(await readAdminConfig(ENV)).toEqual({
      clientId: "cid",
      clientSecret: "very-secret-value",
      accountId: "acct",
      origin: "https://prototype-admin.sub.workers.dev",
      discoveryUrl: CLOUDFLARE_DISCOVERY_URL,
      apiBase: CLOUDFLARE_API_BASE,
    });
  });

  it("accepts plain-string secrets (the Worker-secret fallback) and test endpoint overrides", async () => {
    const c = await readAdminConfig({ ...ENV, ADMIN_CLIENT_ID: "cid2", ADMIN_CLIENT_SECRET: "s2", ADMIN_DISCOVERY_URL: "http://127.0.0.1:1/d", ADMIN_API_BASE: "http://127.0.0.1:1/api" });
    expect(c).toMatchObject({ clientId: "cid2", clientSecret: "s2", discoveryUrl: "http://127.0.0.1:1/d", apiBase: "http://127.0.0.1:1/api" });
  });

  it("names a missing or unreadable setting, never a value", async () => {
    for (const name of ["ADMIN_CLIENT_ID", "ADMIN_CLIENT_SECRET", "ADMIN_ACCOUNT_ID", "ADMIN_APP_ORIGIN"]) {
      await expect(readAdminConfig({ ...ENV, [name]: undefined })).rejects.toThrow(`admin app misconfigured: ${name} is not set`);
    }
    const failing = { get: () => Promise.reject(new Error("very-secret-value")) };
    await expect(readAdminConfig({ ...ENV, ADMIN_CLIENT_SECRET: failing })).rejects.toThrow(/^admin app misconfigured: ADMIN_CLIENT_SECRET could not be read$/);
  });

  it("the origin must be an https origin, or http on localhost", async () => {
    for (const bad of ["prototype-admin.sub.workers.dev", "http://prototype-admin.sub.workers.dev", "https://a.example/path", "https://a.example/"]) {
      await expect(readAdminConfig({ ...ENV, ADMIN_APP_ORIGIN: bad })).rejects.toThrow("ADMIN_APP_ORIGIN is not an origin");
    }
    expect((await readAdminConfig({ ...ENV, ADMIN_APP_ORIGIN: "http://localhost:8790" })).origin).toBe("http://localhost:8790");
  });
});
