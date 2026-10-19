/**
 * `createTestApp` (testing.d.ts; core.md §2 "Testing"): the app in the test process over fresh
 * local D1 and R2 (Wrangler's getPlatformProxy, DEC-0105) — this process runs the SQLite
 * dialect — with migrations applied, the authentication mock or the stub provider, the
 * `unavailable` option, `logs()`, `as`, `loginWithStub` and `dispose`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { configString, defineApp, defineTable, FrameworkError, id, newId, text } from "../index.js";
import { generateAppMigrations } from "../mig/generate.js";
import { mockUsers } from "../auth/testing.js";
import { createTestApp, type TestApp } from "./test-app.js";

const notes = defineTable("notes", { id: id(), title: text() });

const app = defineApp({
  name: "testappunit",
  config: { greeting: configString({ default: "hello" }), title: configString() },
  secrets: ["apiKey"],
  tables: { notes },
  routes: (api) => {
    api.get("/hello", (c) => c.json({ greeting: c.var.config.get("greeting"), title: c.var.config.get("title") }));
    api.post("/notes", async (c) => {
      await c.var.sql.insert(notes).values({ id: newId(), title: "n" });
      return c.json({ count: (await c.var.sql.select().from(notes)).length });
    });
    api.get("/kv", async (c) => c.json({ value: await c.var.kv.get("k") }));
    api.get("/files", async (c) => c.json(await c.var.files.head("x")));
    api.get("/secret", async (c) => c.json({ value: await c.var.secrets.get("apiKey") }));
    api.get("/me", (c) => c.json(c.var.user));
    api.get("/log", (c) => {
      c.var.log.write("unit", "info", "hello entry");
      return c.json({ ok: true });
    });
    api.get("/boom", () => {
      throw new Error("unit boom");
    });
    api.get("/origin", (c) => c.json({ origin: c.req.header("origin") ?? null }));
    api.post("/origin", (c) => c.json({ origin: c.req.header("origin") ?? null }));
  },
});

const base = { config: { title: "t" } };
let apps: TestApp[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.dispose();
});
async function open(options: Parameters<typeof createTestApp>[1] = base): Promise<TestApp> {
  const t = await createTestApp(app, options);
  apps.push(t);
  return t;
}
async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

// Each test app starts workerd (and, on Postgres, loads PGlite; the first one per process also
// creates its template database, DEC-PENDING-B-05-4), so tests get the integration layer's timeout.
describe("createTestApp", { timeout: 60_000 }, () => {
  it("runs app routes over fresh local storage with the app's tables created", async () => {
    const t = await open();
    const first = await t.request("/api/notes", { method: "POST" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ count: 1 });
    const fresh = await open();
    expect(await (await fresh.request("/api/notes", { method: "POST" })).json()).toEqual({ count: 1 });
  });

  it("applies the app's generated migrations from the working directory when it has them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "b16-testapp-"));
    const previous = process.cwd();
    try {
      await generateAppMigrations(dir, { notes });
      process.chdir(dir);
      const t = await open();
      expect(await (await t.request("/api/notes", { method: "POST" })).json()).toEqual({ count: 1 });
    } finally {
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies config overrides and defaults; an undeclared key makes it throw", async () => {
    const t = await open({ config: { title: "custom" } });
    expect(await (await t.request("/api/hello")).json()).toEqual({ greeting: "hello", title: "custom" });
    await expect(createTestApp(app, { config: { title: "t", nope: 1 } })).rejects.toThrow(/nope/);
  });

  it("gives secrets from the secrets option and reports a missing one as SEC.MISSING", async () => {
    const t = await open({ ...base, secrets: { apiKey: "abc" } });
    expect(await (await t.request("/api/secret")).json()).toEqual({ value: "abc" });
    const without = await open();
    expect(await code(await without.request("/api/secret"))).toBe("SEC.MISSING");
  });

  it("returns log entries in order, with the request ID", async () => {
    const t = await open();
    await t.request("/api/log");
    const entries = t.logs().filter((e) => e.message === "hello entry");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ app: "testappunit", target: "local", component: "unit", severity: "info" });
    expect(typeof entries[0]?.requestId).toBe("string");
  });

  it(tag("CORE-AC-004", "a plain Error is 500 CORE.INTERNAL and logged once"), async () => {
    const t = await open();
    const res = await t.request("/api/boom");
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("CORE.INTERNAL");
    expect(t.logs().filter((e) => e.severity === "error")).toHaveLength(1);
  });

  for (const [capability, path, expected] of [
    ["sql", "/api/notes", "SQL.UNAVAILABLE"],
    ["kv", "/api/kv", "KV.UNAVAILABLE"],
    ["files", "/api/files", "FILES.UNAVAILABLE"],
    ["secrets", "/api/secret", "SEC.UNAVAILABLE"],
  ] as const) {
    it(`unavailable: ["${capability}"] makes it fail with ${expected}`, async () => {
      const t = await open({ ...base, secrets: { apiKey: "abc" }, unavailable: [capability] });
      const res = await t.request(path, { method: capability === "sql" ? "POST" : "GET" });
      expect(await code(res)).toBe(expected);
    });
  }

  it("unavailable: [\"sql\"] also makes KV unavailable", async () => {
    const t = await open({ ...base, unavailable: ["sql"] });
    expect(await code(await t.request("/api/kv"))).toBe("KV.UNAVAILABLE");
  });

  it("sends the user option's identity, and as() returns an app sending another identity over the same storage", async () => {
    const t = await open({ ...base, user: mockUsers.user("u1") });
    expect(await (await t.request("/api/me")).json()).toEqual({ level: "user", id: "u1", displayName: null });
    const admin = t.as(mockUsers.admin("a1"));
    expect(await (await admin.request("/api/me")).json()).toEqual({ level: "admin", id: "a1", displayName: null });
    await admin.request("/api/notes", { method: "POST" });
    expect(await (await t.request("/api/notes", { method: "POST" })).json()).toEqual({ count: 2 });
    const plain = await open();
    expect(await (await plain.request("/api/me")).json()).toEqual({ level: "anonymous" });
  });

  it("adds the deployment's origin to state-changing requests unless init sets one", async () => {
    const t = await open({ ...base, user: mockUsers.user("u1") });
    expect(await (await t.request("/api/origin")).json()).toEqual({ origin: null });
    const posted = (await (await t.request("/api/origin", { method: "POST" })).json()) as { origin: string };
    expect(posted.origin).toMatch(/^http:\/\/localhost(:\d+)?$/);
    const forged = await t.request("/api/origin", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(await code(forged)).toBe("AUTH.REQUEST_FORGERY");
  });

  it(tag("LOG-AC-001", "with a failing or never-completing log writer, requests still succeed"), async () => {
    for (const logWriter of ["failing", "never-completing"] as const) {
      const t = await open({ ...base, logWriter });
      const res = await t.request("/api/log");
      expect(res.status).toBe(200);
    }
  });

  it("loginWithStub completes a stub login and keeps the session; framework.admins comes from config", async () => {
    const t = await open({ stubLoginProvider: true, config: { title: "t", framework: { admins: [] } } });
    await t.loginWithStub("person-1", { displayName: "P" });
    const me = (await (await t.request("/api/auth/me")).json()) as { level: string; id: string; displayName: string };
    expect(me.level).toBe("user");
    expect(me.id).toMatch(/^u_[A-Z2-7]{26}$/i);
    expect(me.displayName).toBe("P");
    const admin = await open({ stubLoginProvider: true, config: { title: "t", framework: { admins: [me.id] } } });
    await admin.loginWithStub("person-1");
    expect(((await (await admin.request("/api/auth/me")).json()) as { level: string }).level).toBe("admin");
  });

  it("loginWithStub with a stub failure leaves no session", async () => {
    const t = await open({ ...base, stubLoginProvider: true });
    await t.loginWithStub("person-2", { stubFailure: "refused" }).catch(() => undefined);
    expect(await (await t.request("/api/auth/me")).json()).toEqual({ level: "anonymous" });
  });

  it("without the stub, the mock-login route is installed; with the stub it is not", async () => {
    const mock = await open();
    const res = await mock.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "user" }) });
    expect(res.status).toBe(204);
    const stub = await open({ ...base, stubLoginProvider: true });
    const none = await stub.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(none.status).toBe(404);
  });

  it("rejects an app whose name breaks the app-name rule", async () => {
    const bad = defineApp({ name: "bad-name", config: {}, secrets: [], tables: {}, routes: () => undefined });
    await expect(createTestApp(bad)).rejects.toThrow(FrameworkError);
  });

  it("dispose discards the storage; requests afterwards fail", async () => {
    const t = await createTestApp(app, base);
    await t.request("/api/notes", { method: "POST" });
    await t.dispose();
    await expect(t.request("/api/notes", { method: "POST" })).rejects.toThrow(/disposed/);
  });
});
