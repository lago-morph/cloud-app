/**
 * The auth app's Worker entry under local workerd (Miniflare): the bundled module serves the HTTP
 * routes, applies its schema itself (DEC-0656), and answers `redeem`/`role` over a real service
 * binding from another Worker (named entrypoint `AuthApp`, DEC-0661). No network: the upstream
 * is never reached in these cases.
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCode, registerReturnUrl, upsertUser, type D1Like } from "./store.js";
import { authAppMiniflareWorkers, bundleAuthAppWorker } from "./worker-bundle.test-support.js";

const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
const SETTINGS = {
  AUTH_APP_CLIENT_ID: "cid",
  AUTH_APP_CLIENT_SECRET: "csecret",
  AUTH_APP_ACCOUNT_ID: "acct",
  AUTH_APP_ORIGIN: "https://auth.acct.workers.dev",
  AUTH_APP_DISCOVERY_URL: "http://127.0.0.1:9/none",
};

interface Instance {
  mf: Miniflare;
  db: D1Like;
  authFetch(path: string): Promise<Response>;
  call(path: string, body: unknown): Promise<{ status: number; body: { result?: unknown; error?: string } }>;
}

let script: string;
async function instance(settings: Record<string, string>): Promise<Instance> {
  const mf = new Miniflare({ workers: authAppMiniflareWorkers(script, settings) });
  const db = (await mf.getD1Database("DB", "auth")) as unknown as D1Like;
  return {
    mf,
    db,
    authFetch: async (path) => (await (await mf.getWorker("auth")).fetch(`https://auth.acct.workers.dev${path}`, { redirect: "manual" })) as unknown as Response,
    call: async (path, body) => {
      const res = await (await mf.getWorker("app")).fetch(`https://app.example${path}`, { method: "POST", body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } };
    },
  };
}

let main: Instance;
beforeAll(async () => {
  script = await bundleAuthAppWorker();
  main = await instance(SETTINGS);
  // One request through the Worker, so its schema exists whatever test runs first.
  await (await main.authFetch("/")).text();
  await registerReturnUrl(main.db, APP, RETURN);
  await upsertUser(main.db, { sub: "sub-w", email: "w@example.com", role: "admin" }, Date.now());
}, 120_000);
afterAll(async () => {
  await main?.mf.dispose();
});

describe("auth app Worker", () => {
  it("created its own schema (the test never applies it)", async () => {
    const rows = await main.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(expect.arrayContaining(["codes", "registry", "sign_ins", "users"]));
  });

  it("refuses an unregistered return URL at /start, and answers 404 elsewhere", async () => {
    const res = await main.authFetch(`/start?${new URLSearchParams({ app: APP, return: `${RETURN}/`, state: "s" })}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    await res.text();
    const other = await main.authFetch("/");
    expect(other.status).toBe(404);
    await other.text();
  });

  it("redeems a code over the service binding exactly once", async () => {
    const code = await createCode(main.db, { sub: "sub-w", app: APP, returnUrl: RETURN }, Date.now());
    await expect(main.call("/redeem", { code, app: APP })).resolves.toEqual({ status: 200, body: { result: { sub: "sub-w", email: "w@example.com", role: "admin" } } });
    await expect(main.call("/redeem", { code, app: APP })).resolves.toEqual({ status: 200, body: { result: null } });
  });

  it("answers role(sub) over the service binding", async () => {
    await expect(main.call("/role", { sub: "sub-w" })).resolves.toEqual({ status: 200, body: { result: "admin" } });
    await expect(main.call("/role", { sub: "nobody" })).resolves.toEqual({ status: 200, body: { result: null } });
  });

  it("refuses wrong-shaped RPC input with null", async () => {
    for (const body of [{ code: 5 }, { code: "A".repeat(43) }, {}]) await expect(main.call("/redeem", body), JSON.stringify(body)).resolves.toEqual({ status: 200, body: { result: null } });
    for (const sub of ["", 5, null]) await expect(main.call("/role", { sub }), String(sub)).resolves.toEqual({ status: 200, body: { result: null } });
  });

  it("exposes only redeem and role over the binding", async () => {
    const res = await main.call("/call", { method: "service" });
    expect(res.status).toBe(502);
  });
});

describe("auth app Worker failures", () => {
  it("rejects redeem and role over the binding when D1 cannot answer, so the app retries", async () => {
    const broken = await instance(SETTINGS);
    try {
      await (await broken.authFetch("/")).text();
      await broken.db.prepare("DROP TABLE users").run();
      await broken.db.prepare("DROP TABLE codes").run();
      await expect(broken.call("/role", { sub: "sub-w" })).resolves.toEqual({ status: 502, body: { error: "auth app unavailable" } });
      await expect(broken.call("/redeem", { code: "A".repeat(43), app: APP })).resolves.toEqual({ status: 502, body: { error: "auth app unavailable" } });
    } finally {
      await broken.mf.dispose();
    }
  });

  it("answers 500 no-store at /start when a setting is missing, while the binding still answers", async () => {
    const { AUTH_APP_CLIENT_ID: _drop, ...rest } = SETTINGS;
    const misconfigured = await instance(rest);
    try {
      const res = await misconfigured.authFetch(`/start?${new URLSearchParams({ app: APP, return: RETURN, state: "s" })}`);
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      await res.text();
      await expect(misconfigured.call("/role", { sub: "nobody" })).resolves.toEqual({ status: 200, body: { result: null } });
    } finally {
      await misconfigured.mf.dispose();
    }
  });
});
