/**
 * The shared stage runtime (core.md §2 "Runtime assembly"): one assembled Hono app over
 * per-request services, used by the local and Cloudflare Workers and by `createTestApp`.
 * These tests run it in-process with in-memory stand-ins for the bindings; the real local
 * D1/R2 path is covered by the `createTestApp` tests.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { defineApp, FrameworkError } from "../../index.js";
import { createDeployment } from "../../core/identity.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { openPostgres, postgresDb } from "../../sql/drivers.js";
import { applyMigrations, pgliteMigrationDatabase } from "../../mig/apply.js";
import { readHistory } from "../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/framework.js";
import { fakeStore } from "../../files/fake-store.test-support.js";
import type { LogEntry } from "../../log/entry.js";
import type { PGlite } from "@electric-sql/pglite";
import { assembleStage, type StageOptions } from "./stage.js";

const deployment = createDeployment({ app: "stageapp", stage: "local", target: "local" });

function resolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { deployment, values: {}, admins: [], secrets: [], ...overrides };
}

const opened: PGlite[] = [];
afterEach(async () => {
  for (const pg of opened.splice(0)) await pg.close();
});

async function database(): Promise<PGlite> {
  const pg = await openPostgres();
  opened.push(pg);
  await applyMigrations(pgliteMigrationDatabase(pg), { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, "postgres", "framework"), app: [] });
  return pg;
}

async function options(overrides: Partial<StageOptions> = {}): Promise<{ options: StageOptions; entries: LogEntry[] }> {
  const pg = await database();
  const entries: LogEntry[] = [];
  const secrets: Record<string, string> = { frameworkSessionKey: "k".repeat(43), apiKey: "very-secret-value" };
  return {
    entries,
    options: {
      resolved: resolved({ secrets: [{ name: "apiKey", location: "SECRET_API_KEY" }] }),
      sink: (e) => void entries.push(e),
      publicOrigin: () => "http://localhost:8787",
      sql: (_env, log) => ({ sql: postgresDb(pg, { log }), kv: postgresDb(pg) }),
      store: () => fakeStore(),
      tickets: () => ({ upload: async () => ({}), download: async () => ({}) }),
      readSecret: () => async (name) => secrets[name],
      readFrameworkSecret: () => async (name) => secrets[name],
      secretValues: () => Object.values(secrets),
      requiredFrameworkSecrets: ["frameworkSessionKey"],
      ...overrides,
    },
  };
}

describe("assembleStage", () => {
  it("serves app routes under /api with every service in c.var", async () => {
    const app = defineApp({
      name: "stageapp",
      config: {},
      secrets: ["apiKey"],
      tables: {},
      routes: (api) => {
        api.get("/kv", async (c) => {
          await c.var.kv.put("a", "1");
          return c.json({ value: await c.var.kv.get("a"), secret: (await c.var.secrets.get("apiKey")).length, user: c.var.user });
        });
      },
    });
    const { options: o } = await options();
    const hono = assembleStage(app, o);
    const res = await hono.request("http://localhost:8787/api/kv");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "1", secret: 17, user: { level: "anonymous" } });
  });

  it(tag("HTTP-AC-001", "unknown API paths are JSON 404s and a wrong method is 405 (HTTP parts attached)"), async () => {
    const app = defineApp({ name: "stageapp", config: {}, secrets: [], tables: {}, routes: (api) => void api.get("/only-get", (c) => c.json({})) });
    const { options: o } = await options();
    const hono = assembleStage(app, o);
    const missing = await hono.request("http://localhost:8787/api/nope");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("HTTP.NOT_FOUND");
    const wrong = await hono.request("http://localhost:8787/api/only-get", { method: "DELETE" });
    expect(wrong.status).toBe(405);
  });

  it("the health route answers 204 when the database reads and every required secret has a value", async () => {
    const app = defineApp({ name: "stageapp", config: {}, secrets: ["apiKey"], tables: {}, routes: () => undefined });
    const { options: o } = await options();
    const res = await assembleStage(app, o).request("http://localhost:8787/api/__framework/health");
    expect(res.status).toBe(204);
  });

  it("the health route fails with SEC.MISSING when a declared secret has no value", async () => {
    const app = defineApp({ name: "stageapp", config: {}, secrets: ["apiKey", "other"], tables: {}, routes: () => undefined });
    const { options: o } = await options();
    const res = await assembleStage(app, o).request("http://localhost:8787/api/__framework/health");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SEC.MISSING");
  });

  it(tag("HTTP-AC-002", "secret values are redacted from error responses"), async () => {
    const app = defineApp({
      name: "stageapp",
      config: {},
      secrets: ["apiKey"],
      tables: {},
      routes: (api) => {
        api.get("/leak", async (c) => {
          throw new FrameworkError("HTTP.CONFLICT", `with ${await c.var.secrets.get("apiKey")}`);
        });
      },
    });
    const { options: o, entries } = await options();
    const res = await assembleStage(app, o).request("http://localhost:8787/api/leak");
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain("very-secret-value");
    expect(JSON.stringify(entries)).not.toContain("very-secret-value");
  });

  it("registers extra framework routes and the auth routes", async () => {
    const app = defineApp({ name: "stageapp", config: {}, secrets: [], tables: {}, routes: () => undefined });
    const { options: o } = await options({ routes: (api) => void api.get("/__framework/extra", (c) => c.json({ extra: true })) });
    const hono = assembleStage(app, o);
    expect(await (await hono.request("http://localhost:8787/api/__framework/extra")).json()).toEqual({ extra: true });
    expect(await (await hono.request("http://localhost:8787/api/auth/me")).json()).toEqual({ level: "anonymous" });
  });
});
