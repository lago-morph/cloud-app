/**
 * The Cloudflare runtime's own parts (D-01), run in-process against local D1 and R2 bindings
 * from Wrangler's getPlatformProxy (DEC-0105), as workerd passes them in `env`: the R2 log
 * writer to the shared log bucket binding, Worker-secret reading per request, and the cloud
 * cookie attributes. No Cloudflare account is contacted.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../../tests/support/tags.js";
import { defineApp } from "../../index.js";
import { createDeployment } from "../../core/identity.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { isLogEntry } from "../../log/entry.js";
import { d1MigrationDatabase, migrateLocal, type D1Like } from "../../mig/apply.js";
import { createAuthMock, createCloudflareWorker } from "./public.js";
import { BINDINGS } from "./bindings.js";

const app = defineApp({
  name: "cfunit",
  config: {},
  secrets: ["apiKey"],
  tables: {},
  routes: (api) => {
    api.post("/log", async (c) => {
      c.var.log.write("APP", "warn", "from the route");
      return c.json({ requestId: c.var.requestId });
    });
    api.get("/secret", async (c) => c.json({ value: await c.var.secrets.get("apiKey") }));
  },
});

function resolved(stage: string): ResolvedConfig {
  return { deployment: createDeployment({ app: "cfunit", stage, target: "cloudflare" }), values: {}, admins: [], secrets: [{ name: "apiKey", location: "SECRET_API_KEY" }] };
}

interface R2Like {
  list(options?: { prefix?: string }): Promise<{ objects: { key: string; httpMetadata?: { contentType?: string } }[] }>;
  get(key: string): Promise<{ text(): Promise<string>; httpMetadata?: { contentType?: string } } | null>;
}

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Like; LOGS: R2Like }>>>;
let proxy: Proxy;
let bindings: Record<string, unknown>;
const ORIGIN = "https://cfunit-test-unit.example.workers.dev";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "d01-cf-"));
  const configPath = join(dir, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "cfunit",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: "cf", database_id: "00000000-0000-0000-0000-000000000000" }],
      r2_buckets: [
        { binding: "FILES", bucket_name: "cfunit-files" },
        { binding: BINDINGS.logs, bucket_name: "prototype-logs" },
      ],
    }),
  );
  proxy = await getPlatformProxy<{ DB: D1Like; LOGS: R2Like }>({ configPath, persist: false });
  await migrateLocal(d1MigrationDatabase(proxy.env.DB), join(dir, "migrations"));
  bindings = {
    ...proxy.env,
    FRAMEWORK_PUBLIC_ORIGIN: ORIGIN,
    SECRET_API_KEY: "api-value",
    SECRET_FRAMEWORK_SESSION_KEY: "s".repeat(43),
  };
}, 60_000);
afterAll(async () => {
  await proxy.dispose();
});

function context(): { ctx: { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void; props: object }; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return { pending, ctx: { waitUntil: (p) => void pending.push(p), passThroughOnException: () => undefined, props: {} } };
}

const worker = createCloudflareWorker(app, resolved("test-unit"), { mock: createAuthMock });

describe("Cloudflare runtime: R2 log writer", () => {
  it(tag(["LOG-AC-002", "LOG-AC-004"], "local R2: an entry written in a request is one schema-valid object under <app>/<stage>/<UTC date>/<time>-<severity>-<requestId>.json, written through waitUntil"), async () => {
    const { ctx, pending } = context();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/log`, { method: "POST" }), bindings, ctx);
    expect(res.status).toBe(200);
    const { requestId } = (await res.json()) as { requestId: string };
    expect(pending.length).toBeGreaterThan(0);
    await Promise.all(pending);
    const listed = await proxy.env.LOGS.list({ prefix: "cfunit/test-unit/" });
    const keys = listed.objects.map((o) => o.key).filter((k) => k.endsWith(`-warn-${requestId}.json`));
    expect(keys).toHaveLength(1);
    const key = keys[0] ?? "";
    const object = await proxy.env.LOGS.get(key);
    const entry = JSON.parse((await object?.text()) ?? "null") as Record<string, unknown>;
    expect(isLogEntry(entry)).toBe(true);
    expect(entry).toMatchObject({ app: "cfunit", stage: "test-unit", target: "cloudflare", component: "APP", severity: "warn", message: "from the route", requestId });
    const iso = new Date(String(entry.time)).toISOString();
    expect(key).toBe(`cfunit/test-unit/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.${iso.slice(20, 23)}-warn-${requestId}.json`);
    expect(object?.httpMetadata?.contentType).toBe("application/json");
  });

  it(tag("LOG-AC-005", "local R2: an uncaught plain Error leaves a framework error entry in the log bucket"), async () => {
    const failing = defineApp({
      name: "cfunit",
      config: {},
      secrets: [],
      tables: {},
      routes: (api) => {
        api.get("/boom", () => {
          throw new Error("plain failure");
        });
      },
    });
    const { ctx, pending } = context();
    const res = await createCloudflareWorker(failing, resolved("test-boom")).fetch(new Request(`${ORIGIN}/api/boom`), bindings, ctx);
    expect(res.status).toBe(500);
    const { error } = (await res.json()) as { error: { requestId: string } };
    await Promise.all(pending);
    const keys = (await proxy.env.LOGS.list({ prefix: "cfunit/test-boom/" })).objects.map((o) => o.key);
    expect(keys.filter((k) => k.endsWith(`-error-${error.requestId}.json`))).toHaveLength(1);
  });

  it(tag("LOG-AC-001", "unit (Cloudflare runtime): a log bucket whose writes fail does not fail the request"), async () => {
    const failingBucket = { put: () => Promise.reject(new Error("r2 down")) };
    const { ctx, pending } = context();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/log`, { method: "POST" }), { ...bindings, [BINDINGS.logs]: failingBucket }, ctx);
    expect(res.status).toBe(200);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});

describe("Cloudflare runtime: cloud cookie attributes", () => {
  const mockLogin = { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ level: "user", id: "m" }) };

  function attributes(cookie: string): string[] {
    return cookie.split(";").slice(1).map((part) => part.trim().split("=")[0]?.toLowerCase() ?? "");
  }

  it(tag("AUTH-AC-006", "unit (Cloudflare runtime): the session cookie is __Host-session, HttpOnly, SameSite=Lax, Secure, Path=/, host-only; logout clears it"), async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/auth/mock-login`, mockLogin), bindings, context().ctx);
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-session=[^;]+; /);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(attributes(cookie)).toEqual(expect.arrayContaining(["httponly", "secure", "max-age"]));
    expect(attributes(cookie)).not.toContain("domain");
    const session = cookie.split(";")[0] ?? "";

    const me = await worker.fetch(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: session } }), bindings, context().ctx);
    expect(((await me.json()) as { level: string }).level).toBe("user");

    const out = await worker.fetch(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie: session, origin: ORIGIN } }), bindings, context().ctx);
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^__Host-session=; /);
    expect(cleared).toMatch(/Max-Age=0/);
    expect(attributes(cleared)).toEqual(expect.arrayContaining(["httponly", "secure"]));
  });
});

describe("Cloudflare runtime: Worker secrets", () => {
  async function secret(env: Record<string, unknown>): Promise<{ status: number; body: { value?: string; error?: { code: string } } }> {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/secret`), env, context().ctx);
    return { status: res.status, body: (await res.json()) as { value?: string; error?: { code: string } } };
  }

  it(tag("SEC-AC-001", "unit (Cloudflare runtime): a declared secret is read from the Worker secret SECRET_<NAME>"), async () => {
    expect(await secret(bindings)).toEqual({ status: 200, body: { value: "api-value" } });
  });

  it(tag("SEC-AC-005", "unit (Cloudflare runtime): values are not cached across requests; the next request sees a new value, and a deleted secret is SEC.MISSING"), async () => {
    expect((await secret({ ...bindings, SECRET_API_KEY: "first" })).body.value).toBe("first");
    expect((await secret({ ...bindings, SECRET_API_KEY: "second" })).body.value).toBe("second");
    const { SECRET_API_KEY: _deleted, ...withoutSecret } = bindings;
    const missing = await secret(withoutSecret);
    expect(missing.status).toBe(500);
    expect(missing.body.error?.code).toBe("SEC.MISSING");
  });

  it("an empty Worker secret counts as missing", async () => {
    expect((await secret({ ...bindings, SECRET_API_KEY: "" })).body.error?.code).toBe("SEC.MISSING");
  });

  it(tag("SEC-AC-002", "unit (Cloudflare runtime): a secret value in an error message reaches neither the response nor the stored log entry"), async () => {
    const leaky = defineApp({
      name: "cfunit",
      config: {},
      secrets: ["apiKey"],
      tables: {},
      routes: (api) => {
        api.get("/leak", async (c) => {
          throw new Error(`leaking ${await c.var.secrets.get("apiKey")}`);
        });
      },
    });
    const { ctx, pending } = context();
    const res = await createCloudflareWorker(leaky, resolved("test-leak")).fetch(new Request(`${ORIGIN}/api/leak`), bindings, ctx);
    expect(await res.text()).not.toContain("api-value");
    await Promise.all(pending);
    const keys = (await proxy.env.LOGS.list({ prefix: "cfunit/test-leak/" })).objects.map((o) => o.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(await (await proxy.env.LOGS.get(key))?.text()).not.toContain("api-value");
  });
});
