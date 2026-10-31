/** The admin app's deploy by the bootstrap (v0.2.0 plan §5.1 steps 3 and 5; DEC-0686), on the fake Cloudflare API, and the stub Worker it uploads. */
import { describe, expect, it } from "vitest";
import adminApp, { ADMIN_APP_SOURCE } from "../../admin-app/worker.js";
import { ADMIN_APP_BINDINGS, ADMIN_APP_MODULE, deployAdminApp } from "./admin-app-deploy.js";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";

const SUB = "pf-adminsub";

describe("the admin app stub (E replaces it)", () => {
  it("answers every request with the sign-in placeholder page", async () => {
    const r = await adminApp.fetch();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const page = await r.text();
    expect(page).toContain("<title>Prototype admin</title>");
    expect(page).toContain("Sign in with Cloudflare");
    expect(page).toContain("not ready yet");
  });

  it("the uploaded module source is that same Worker", async () => {
    const loaded = (await import(`data:text/javascript,${encodeURIComponent(ADMIN_APP_SOURCE)}`)) as { default: typeof adminApp };
    const [a, b] = [await loaded.default.fetch(), await adminApp.fetch()];
    expect(await a.text()).toBe(await b.text());
    expect(a.status).toBe(b.status);
    expect([...a.headers]).toEqual([...b.headers]);
  });
});

describe("deployAdminApp", () => {
  it("uploads the stub as prototype-admin with its two Secrets Store bindings, turns its workers.dev route on, and returns its URL", async () => {
    const cloud = new FakeCloud();
    const url = await deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB });
    expect(url).toBe(`https://prototype-admin.${SUB}.workers.dev`);
    const w = cloud.workers.get("prototype-admin")!;
    expect(w.bindings).toEqual([
      { type: "secrets_store_secret", name: "ADMIN_CLIENT_ID", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_ID" },
      { type: "secrets_store_secret", name: "ADMIN_CLIENT_SECRET", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_SECRET" },
    ]);
    expect(ADMIN_APP_BINDINGS).toEqual({ clientId: "ADMIN_CLIENT_ID", clientSecret: "ADMIN_CLIENT_SECRET" });
    expect(w.modules?.get(ADMIN_APP_MODULE)).toBe(ADMIN_APP_SOURCE);
    expect(w.enabled).toBe(true);
    expect(w.previews).toBe(false);
    expect(cloud.requests.filter((r) => !r.startsWith("GET "))).toEqual([`PUT /accounts/${ACCOUNT}/workers/scripts/prototype-admin`, `POST /accounts/${ACCOUNT}/workers/scripts/prototype-admin/subdomain`]);
  });

  it("run again: uploads again (the framework's current admin app), the same bindings, and the route is set again (on, previews off)", async () => {
    const cloud = new FakeCloud();
    await deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB });
    const w = cloud.workers.get("prototype-admin")!;
    // Turned off by hand in between: only the route request turns it back on (an upload keeps the route as it was).
    w.enabled = false;
    w.previews = true;
    await deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB });
    const again = cloud.workers.get("prototype-admin")!;
    expect(again.bindings).toHaveLength(2);
    expect(again.enabled).toBe(true);
    expect(again.previews).toBe(false);
  });

  it("a refused upload or route names the Worker and the answer", async () => {
    const cloud = new FakeCloud();
    cloud.override.set(`PUT /accounts/${ACCOUNT}/workers/scripts/prototype-admin`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null } });
    await expect(deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB })).rejects.toThrow("uploading the admin app (Worker prototype-admin) failed: HTTP 403: Authentication error (code 10000)");
    cloud.override.clear();
    cloud.override.set(`POST /accounts/${ACCOUNT}/workers/scripts/prototype-admin/subdomain`, { status: 500, body: { success: false, errors: [{ code: 1, message: "Internal" }], result: null } });
    await expect(deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB })).rejects.toThrow("turning on the workers.dev route of the admin app (Worker prototype-admin) failed: HTTP 500");
  });
});
