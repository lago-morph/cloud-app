/**
 * The Worker runtimes the generated entry points call: `createLocalWorker` (`dev`) and
 * `createCloudflareWorker`, run here against local D1 and R2 bindings from Wrangler's
 * getPlatformProxy (DEC-0105), as workerd would pass them in `env`.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../tests/support/tags.js";
import { defineApp } from "../index.js";
import { createDeployment, type Target } from "../core/identity.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { d1MigrationDatabase, migrateLocal, type D1Like } from "../mig/apply.js";
import { createCloudflareWorker, createAuthMock } from "./cloudflare/public.js";
import { createLocalWorker } from "./local/public.js";

const app = defineApp({
  name: "workerunit",
  config: {},
  secrets: ["apiKey"],
  tables: {},
  routes: (api) => {
    api.get("/upload-ticket", async (c) => c.json(await c.var.files.createUploadTicket("a.txt", { contentType: "text/plain" })));
    api.get("/me", (c) => c.json(c.var.user));
  },
});

function resolved(target: Target, stage: string): ResolvedConfig {
  return { deployment: createDeployment({ app: "workerunit", stage, target }), values: {}, secrets: [{ name: "apiKey", location: "SECRET_API_KEY" }] };
}

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Like }>>>;
let proxy: Proxy;
let bindings: Record<string, unknown>;
const ORIGIN = "http://localhost:5173";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "b16-workers-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "workerunit",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: "w", database_id: "00000000-0000-0000-0000-000000000000" }],
      r2_buckets: [{ binding: "FILES", bucket_name: "workerunit" }],
    }),
  );
  proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath, persist: false });
  await migrateLocal(d1MigrationDatabase(proxy.env.DB), join(dir, "migrations"));
  bindings = {
    ...proxy.env,
    FRAMEWORK_PUBLIC_ORIGIN: ORIGIN,
    SECRET_API_KEY: "api-value",
    SECRET_FRAMEWORK_SESSION_KEY: "s".repeat(43),
    SECRET_FRAMEWORK_LOCAL_TICKET_KEY: "t".repeat(43),
    SECRET_FRAMEWORK_AUTH_SECRET: "a".repeat(43),
  };
}, 60_000);
afterAll(async () => {
  await proxy.dispose();
});

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} };

async function call(worker: { fetch(r: Request, env: unknown, ctx: unknown): Response | Promise<Response> }, path: string, init?: RequestInit, env = bindings): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
}

// Every POST under /api/auth/ carries the public origin (AUTH-REQ-007, DEC-0516).
const mockLogin = { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ level: "user", id: "m" }) };

describe("createLocalWorker", () => {
  const worker = createLocalWorker(app, resolved("local", "local"));

  it("answers the health check over the local bindings", async () => {
    expect((await call(worker, "/api/__framework/health")).status).toBe(204);
  });

  it(tag("LOCAL-AC-004", "local cookie settings: mock-login sets session_local without Secure"), async () => {
    const res = await call(worker, "/api/auth/mock-login", mockLogin);
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^session_local=/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("issues same-origin local tickets that the local transfer route accepts", async () => {
    const ticket = (await (await call(worker, "/api/upload-ticket")).json()) as { url: string; headers: Record<string, string> };
    expect(ticket.url).toMatch(/^\/api\/__framework\/files\//);
    const put = await call(worker, ticket.url, { method: "PUT", headers: ticket.headers, body: "hello" });
    expect(put.status).toBe(200);
  });

  it("fails with CORE.MISCONFIGURED when the public origin variable is not set", async () => {
    const { FRAMEWORK_PUBLIC_ORIGIN: _unused, ...withoutOrigin } = bindings;
    const res = await call(worker, "/api/auth/logout", { method: "POST", headers: { cookie: "session_local=x", origin: ORIGIN } }, withoutOrigin);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
  });
});

describe("createCloudflareWorker", () => {
  it(tag("PROV-AC-005", "runtime part: a test stage with the mock serves mock-login with __Host-session"), async () => {
    const worker = createCloudflareWorker(app, resolved("cloudflare", "test-unit"), { mock: createAuthMock });
    const res = await call(worker, "/api/auth/mock-login", mockLogin);
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/^__Host-session=.*Secure/);
  });

  it(tag("AUTH-AC-009", "production stage: no mock-login route (404)"), async () => {
    const worker = createCloudflareWorker(app, resolved("cloudflare", "prod"));
    const res = await call(worker, "/api/auth/mock-login", mockLogin);
    expect(res.status).toBe(404);
  });

  it("a production stage given the mock fails with CORE.MISCONFIGURED", async () => {
    const worker = createCloudflareWorker(app, resolved("cloudflare", "prod"), { mock: createAuthMock });
    const res = await call(worker, "/api/me");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
  });

  it("has no local transfer route; tickets need the Cloudflare signer (CORE.MISCONFIGURED until D-02)", async () => {
    const worker = createCloudflareWorker(app, resolved("cloudflare", "test-unit"), { mock: createAuthMock });
    expect((await call(worker, "/api/__framework/files/x", { method: "PUT", body: "x" })).status).toBe(404);
    const res = await call(worker, "/api/upload-ticket");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
  });

  it("answers the health check when the stage's secrets are set", async () => {
    const worker = createCloudflareWorker(app, resolved("cloudflare", "prod"));
    expect((await call(worker, "/api/__framework/health")).status).toBe(204);
  });

  it("the health check also requires frameworkAuthSecret, on production and test stages (PROV-REQ-002 step 7)", async () => {
    const { SECRET_FRAMEWORK_AUTH_SECRET: _omitted, ...withoutAuthSecret } = bindings;
    for (const stage of ["prod", "test-x"]) {
      const worker = createCloudflareWorker(app, resolved("cloudflare", stage));
      const res = await call(worker, "/api/__framework/health", undefined, withoutAuthSecret);
      expect(res.status, stage).not.toBe(204);
      expect(((await res.json()) as { error: { code: string } }).error.code, stage).toBe("SEC.MISSING");
    }
  });

  it("the local health check requires frameworkAuthSecret too", async () => {
    const { SECRET_FRAMEWORK_AUTH_SECRET: _omitted, ...withoutAuthSecret } = bindings;
    const res = await call(createLocalWorker(app, resolved("local", "local")), "/api/__framework/health", undefined, withoutAuthSecret);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SEC.MISSING");
  });
});
