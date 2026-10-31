/** The admin app's deploy by the bootstrap (v0.2.0 plan §5.1 steps 3 and 5; DEC-0686, DEC-0711, DEC-0712), on the fake Cloudflare API, and the Worker it uploads. */
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { ADMIN_APP_NODE_IMPORTS, bundleAdminApp } from "../../admin-app/bundle.js";
import { ADMIN_APP_BINDINGS, ADMIN_APP_COMPATIBILITY_DATE, ADMIN_APP_COMPATIBILITY_FLAGS, ADMIN_APP_MODULE, ADMIN_APP_SETTINGS, deployAdminApp } from "./admin-app-deploy.js";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";

const SUB = "pf-adminsub";

type Loaded = { default: { fetch(request: Request, env: Record<string, unknown>): Promise<Response> } };

describe("the uploaded admin app (E replaced C's stub)", () => {
  it("compiles in the auth app that account setup uploads (DEC-0720)", async () => {
    const source = await bundleAdminApp();
    // The auth app's own module, kept as a string: its import of cloudflare:workers is text, not an import of the admin app.
    expect(source).toContain("cloudflare:workers");
    expect(source).toContain("AuthApp");
  });

  it("is one ES module whose only import is node:crypto (DEC-0720)", async () => {
    const source = await bundleAdminApp();
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(new Set(imports)).toEqual(new Set(ADMIN_APP_NODE_IMPORTS));
    expect(source).not.toMatch(/\bnode:(?!crypto\b)/);
    // Loaded in Node below, so Node-only globals must be ruled out here (workerd: the test after next).
    expect(source).not.toMatch(/\bBuffer\b|\bprocess\.|\brequire\(|import\.meta/);
    expect(source).not.toMatch(/__PF_AUTH_APP_SOURCE__|__PF_FRAMEWORK_VERSION__/);
  });

  it("runs under local workerd with nodejs_compat, as uploaded: the sign-in page", async () => {
    const text = (value: string) => ({ type: "text" as const, value });
    const mf = new Miniflare({
      workers: [
        {
          config: {
            name: "admin",
            compatibilityDate: ADMIN_APP_COMPATIBILITY_DATE,
            compatibilityFlags: [...ADMIN_APP_COMPATIBILITY_FLAGS],
            manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: await bundleAdminApp() } } },
            env: { ADMIN_CLIENT_ID: text("cid"), ADMIN_CLIENT_SECRET: text("csecret-value"), ADMIN_ACCOUNT_ID: text("acct"), ADMIN_APP_ORIGIN: text(`https://prototype-admin.${SUB}.workers.dev`) },
          },
        },
      ],
    });
    try {
      const r = await mf.dispatchFetch(`https://prototype-admin.${SUB}.workers.dev/`);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('action="/signin"');
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("serves the sign-in page when its settings are bound, and a generic 500 page without them", async () => {
    const loaded = (await import(`data:text/javascript,${encodeURIComponent(await bundleAdminApp())}`)) as Loaded;
    const env = { ADMIN_CLIENT_ID: { get: () => Promise.resolve("cid") }, ADMIN_CLIENT_SECRET: { get: () => Promise.resolve("csecret-value") }, ADMIN_ACCOUNT_ID: "acct", ADMIN_APP_ORIGIN: `https://prototype-admin.${SUB}.workers.dev` };
    const ok = await loaded.default.fetch(new Request(`https://prototype-admin.${SUB}.workers.dev/`), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.text()).toContain('action="/signin"');
    const broken = await loaded.default.fetch(new Request(`https://prototype-admin.${SUB}.workers.dev/`), { ...env, ADMIN_ACCOUNT_ID: undefined });
    expect(broken.status).toBe(500);
    const text = await broken.text();
    expect(text).toContain("not set up correctly");
    expect(text).not.toContain("csecret-value");
  });
});

describe("deployAdminApp", () => {
  it("uploads the admin app as prototype-admin with its two Secrets Store bindings and its account and origin, turns its workers.dev route on, and returns its URL", async () => {
    const cloud = new FakeCloud();
    const url = await deployAdminApp(cloud.api, ACCOUNT, { storeId: "store1", subdomain: SUB });
    expect(url).toBe(`https://prototype-admin.${SUB}.workers.dev`);
    const w = cloud.workers.get("prototype-admin")!;
    expect(w.bindings).toEqual([
      { type: "secrets_store_secret", name: "ADMIN_CLIENT_ID", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_ID" },
      { type: "secrets_store_secret", name: "ADMIN_CLIENT_SECRET", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_SECRET" },
      { type: "plain_text", name: "ADMIN_ACCOUNT_ID", text: ACCOUNT },
      { type: "plain_text", name: "ADMIN_APP_ORIGIN", text: `https://prototype-admin.${SUB}.workers.dev` },
    ]);
    expect(ADMIN_APP_SETTINGS).toEqual({ accountId: "ADMIN_ACCOUNT_ID", origin: "ADMIN_APP_ORIGIN" });
    expect(ADMIN_APP_BINDINGS).toEqual({ clientId: "ADMIN_CLIENT_ID", clientSecret: "ADMIN_CLIENT_SECRET" });
    expect(w.modules?.get(ADMIN_APP_MODULE)).toBe(await bundleAdminApp());
    expect(w.enabled).toBe(true);
    expect(w.previews).toBe(false);
    expect(cloud.requests.filter((r) => !r.startsWith("GET "))).toEqual([`PUT /accounts/${ACCOUNT}/workers/scripts/prototype-admin`, `POST /accounts/${ACCOUNT}/workers/scripts/prototype-admin/subdomain`]);
  });

  it("uploads with nodejs_compat and the compatibility date (DEC-0720)", async () => {
    const cloud = new FakeCloud();
    const metas: unknown[] = [];
    const api: typeof cloud.api = async (method, path, body) => {
      if (body instanceof FormData) metas.push(JSON.parse(await (body.get("metadata") as Blob).text()));
      return cloud.api(method, path, body);
    };
    await deployAdminApp(api, ACCOUNT, { storeId: "store1", subdomain: SUB });
    expect(metas).toEqual([expect.objectContaining({ main_module: "worker.js", compatibility_date: ADMIN_APP_COMPATIBILITY_DATE, compatibility_flags: ["nodejs_compat"] })]);
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
    expect(again.bindings).toHaveLength(4);
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
