/**
 * `createTestApp` (testing.d.ts; core.md §2 "Testing"): the app in the test process over fresh
 * local D1 and R2 (Wrangler's getPlatformProxy, DEC-0105) — this process runs the SQLite
 * dialect — with migrations applied, the authentication mock or the stub provider, the
 * `unavailable` option, `setUnavailable`, `logs()`, `as`, `loginWithStub` and `dispose`.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { configString, defineApp, defineTable, FrameworkError, id, newId, text } from "../index.js";
import { generateAppMigrations } from "../mig/generate.js";
import { mockUsers } from "../auth/testing.js";
import { createTestApp, type TestApp } from "./test-app.js";
import { deriveUserId } from "../auth/user-id.js";
import { ROLE_REFRESH_INTERVAL_SECONDS } from "../auth/role-refresh.js";

/** Moves the test clock just past PAR-425. */
const REFRESH_DUE_MS = (ROLE_REFRESH_INTERVAL_SECONDS + 1) * 1000;

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
    api.put("/files", async (c) => {
      await c.var.files.put("x", new Uint8Array([1, 2, 3]));
      return c.json({ ok: true });
    });
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
const apps: TestApp[] = [];
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
// creates its template database, DEC-0135), so tests get the integration layer's timeout.
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

  it("setUnavailable flips a capability mid-test: a stored file, then a failing files operation, then back (DEC-0537)", async () => {
    const t = await open();
    expect((await t.request("/api/files", { method: "PUT" })).status).toBe(200);
    expect(await (await t.request("/api/files")).json()).toMatchObject({ name: "x", size: 3 });
    t.setUnavailable(["files"]);
    expect(await code(await t.request("/api/files"))).toBe("FILES.UNAVAILABLE");
    // Shared with apps made by as(); other capabilities still work.
    expect(await code(await t.as(mockUsers.user("u2")).request("/api/files"))).toBe("FILES.UNAVAILABLE");
    expect((await t.request("/api/notes", { method: "POST" })).status).toBe(200);
    t.setUnavailable([]);
    expect(await (await t.request("/api/files")).json()).toMatchObject({ name: "x", size: 3 });
  });

  for (const [capability, path, expected] of [
    ["sql", "/api/notes", "SQL.UNAVAILABLE"],
    ["kv", "/api/kv", "KV.UNAVAILABLE"],
    ["secrets", "/api/secret", "SEC.UNAVAILABLE"],
  ] as const) {
    it(`setUnavailable(["${capability}"]) makes it fail with ${expected} from the next request, and replaces the option's set`, async () => {
      const t = await open({ ...base, secrets: { apiKey: "abc" }, unavailable: ["files"] });
      t.setUnavailable([capability]);
      expect(await code(await t.request(path, { method: capability === "sql" ? "POST" : "GET" }))).toBe(expected);
      expect((await t.request("/api/files")).status).toBe(200);
    });
  }

  it("setUnavailable rejects an unknown capability and a disposed app", async () => {
    const t = await open();
    expect(() => t.setUnavailable(["mail" as "files"])).toThrow(/unknown capability "mail"/);
    await t.dispose();
    expect(() => t.setUnavailable([])).toThrow(/disposed/);
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

  it(tag("AUTH-AC-003", "loginWithStub keeps the session; grantRole and revokeRole change the level at the next role refresh"), async () => {
    const t = await open({ ...base, stubLoginProvider: true });
    await t.loginWithStub("person-1", { displayName: "P" });
    const level = async () => ((await (await t.request("/api/auth/me")).json()) as { level: string }).level;
    const me = (await (await t.request("/api/auth/me")).json()) as { level: string; id: string; displayName: string };
    expect(me.level).toBe("user");
    expect(me.id).toMatch(/^u_[A-Z2-7]{26}$/i);
    expect(me.displayName).toBe("P");
    await t.grantRole(me.id, "admin");
    expect(await level(), "within PAR-425 the session keeps its level").toBe("user");
    t.clock.advance(REFRESH_DUE_MS);
    expect(await level()).toBe("admin");
    await t.grantRole(me.id, "admin"); // already held: no change
    t.clock.advance(REFRESH_DUE_MS);
    expect(await level()).toBe("admin");
    await t.revokeRole(me.id, "admin");
    t.clock.advance(REFRESH_DUE_MS);
    expect(await level()).toBe("user");
    await t.revokeRole(me.id, "admin"); // not held: no change
    await expect(t.grantRole("u_NOBODY", "admin")).rejects.toThrow(/no account has the user ID/);
  });

  describe("authAppLoginProvider (plan-v0.2.0 §4.1, the fake auth-app binding)", () => {
    const alice = { sub: "cf-sub-alice", email: "alice@example.test", role: "user" } as const;
    const me = async (t: TestApp) => (await (await t.request("/api/auth/me")).json()) as { level: string; id?: string; displayName?: string | null };

    it(tag("AUTH-AC-013", "loginWithAuthApp signs in through /start and the callback as a cf-account user, with no display name and no email"), async () => {
      const t = await open({ ...base, authAppLoginProvider: true });
      const login = await t.request("/api/auth/login");
      const start = new URL(login.headers.get("location") ?? "");
      expect(`${start.origin}${start.pathname}`).toBe("https://auth-app.test/start");
      expect(start.searchParams.get("app")).toBe(`${app.definition.name}-local`);
      expect(start.searchParams.get("return")).toBe("http://localhost:8787/api/auth/callback");
      await t.loginWithAuthApp(alice);
      const body = await (await t.request("/api/auth/me")).text();
      expect(JSON.parse(body)).toStrictEqual({ level: "user", id: await deriveUserId("cf-account", alice.sub), displayName: null });
      expect(body).not.toContain(alice.email);
      expect(t.authApp.calls.redeem).toBe(1);
    });

    it(tag("AUTH-AC-015", "within PAR-425 no role call; after it exactly one; grantRole, revokeRole and the fake's setRole show at the refresh"), async () => {
      const t = await open({ ...base, authAppLoginProvider: true });
      await t.loginWithAuthApp(alice);
      const { id } = await me(t);
      await t.grantRole(id ?? "", "admin");
      expect((await me(t)).level).toBe("user");
      expect(t.authApp.calls.role).toBe(0);
      t.clock.advance(REFRESH_DUE_MS);
      expect((await me(t)).level).toBe("admin");
      expect(t.authApp.calls.role).toBe(1);
      expect((await me(t)).level).toBe("admin");
      expect(t.authApp.calls.role, "the refreshed session is kept").toBe(1);
      await t.revokeRole(id ?? "", "admin");
      t.authApp.setRole(alice.sub, null);
      t.clock.advance(REFRESH_DUE_MS);
      expect(await me(t)).toStrictEqual({ level: "anonymous" });
    });

    it(tag("AUTH-AC-012", "when every try fails the session ends; the retry delays elapse on the test's clock"), async () => {
      const t = await open({ ...base, authAppLoginProvider: true });
      await t.loginWithAuthApp({ ...alice, role: "admin" });
      t.clock.advance(REFRESH_DUE_MS);
      t.authApp.setUnavailable(true);
      const before = t.clock.now();
      expect(await me(t)).toStrictEqual({ level: "anonymous" });
      expect(t.authApp.calls.role).toBe(3);
      expect(t.clock.now() - before).toBeGreaterThanOrEqual(400);
      t.authApp.setUnavailable(false);
      expect(await me(t), "the cleared session stays ended").toStrictEqual({ level: "anonymous" });
      expect(t.logs().filter((e) => e.component === "AUTH").map((e) => e.message)).toStrictEqual(["role refresh failed (unknown); session ended"]);
    });

    it("cannot be combined with the stub or the user option, and has no mock", async () => {
      await expect(createTestApp(app, { ...base, authAppLoginProvider: true, stubLoginProvider: true })).rejects.toThrow(/cannot be combined/);
      await expect(createTestApp(app, { ...base, authAppLoginProvider: true, user: mockUsers.user() })).rejects.toThrow(/cannot be combined/);
      const t = await open({ ...base, authAppLoginProvider: true });
      expect(() => t.as(mockUsers.user())).toThrow(/auth-app login provider/);
      const mock = await open();
      expect(() => mock.authApp).toThrow(/authAppLoginProvider/);
      await expect(mock.loginWithAuthApp(alice)).rejects.toThrow(/authAppLoginProvider/);
    });
  });

  it("grantRole and revokeRole throw with the authentication mock", async () => {
    const t = await open();
    await expect(t.grantRole("mock-user", "admin")).rejects.toThrow(/needs a real login provider/);
    await expect(t.revokeRole("mock-user", "admin")).rejects.toThrow(/needs a real login provider/);
  });

  it("a framework section with admins or users makes createTestApp throw, as the build does (DEC-0525)", async () => {
    for (const framework of [{ admins: [] }, { users: ["u_X"] }]) {
      await expect(createTestApp(app, { config: { title: "t", framework } })).rejects.toThrow(/unknown field "framework\.(admins|users)"/);
    }
  });

  it(tag("AUTH-AC-003", "with the password provider, grantRole and revokeRole change the signed-in account's level on its next request"), async () => {
    const t = await open({ ...base, passwordLoginProvider: true, secrets: { apiKey: "k" } });
    const post = (path: string, body: unknown) =>
      t.request(`/api/auth/password/${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const email = "role@example.test";
    const password = "correct horse battery staple";
    expect((await post("sign-up", { email, password, displayName: "Role" })).status).toBeLessThan(300);
    let message = await t.mail.lastTo(email);
    for (let i = 0; message === undefined && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      message = await t.mail.lastTo(email);
    }
    const token = /[?&]token=([^&\s"<]+)/.exec(message?.text ?? "")?.[1] ?? "";
    expect(token).not.toBe("");
    expect((await post("verify", { token: decodeURIComponent(token) })).status).toBeLessThan(300);
    const signIn = await post("sign-in", { email, password });
    expect(signIn.status).toBeLessThan(300);
    const pair = signIn.headers.getSetCookie().map((line) => line.split(";")[0] ?? "").find((p) => p.startsWith("session_local=") && p !== "session_local=");
    expect(pair).toBeDefined();
    const cookie = { headers: { cookie: pair ?? "" } };
    const level = async () => ((await (await t.request("/api/auth/me", cookie)).json()) as { level: string; id: string });
    const me = await level();
    expect(me.level).toBe("user");
    await t.grantRole(me.id, "admin");
    expect((await level()).level).toBe("admin");
    await t.revokeRole(me.id, "admin");
    expect((await level()).level).toBe("user");
  });

  it("keeps only the loginWithStub session (local.md, DEC-0193): a password sign-in's cookie is not sent on later requests", async () => {
    const t = await open({ ...base, passwordLoginProvider: true, secrets: { apiKey: "k" } });
    const post = (path: string, body: unknown) =>
      t.request(`/api/auth/password/${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const email = "kept@example.test";
    const password = "correct horse battery staple";
    await post("sign-up", { email, password, displayName: "Kept" });
    let message = await t.mail.lastTo(email);
    for (let i = 0; message === undefined && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      message = await t.mail.lastTo(email);
    }
    const token = /[?&]token=([^&\s"<]+)/.exec(message?.text ?? "")?.[1] ?? "";
    await post("verify", { token: decodeURIComponent(token) });
    const signIn = await post("sign-in", { email, password });
    expect(signIn.status).toBeLessThan(300);
    expect(signIn.headers.getSetCookie().some((line) => line.startsWith("session_local=") && !line.startsWith("session_local=;"))).toBe(true);
    expect(await (await t.request("/api/auth/me")).json()).toEqual({ level: "anonymous" });
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

  it("passwordLoginProvider installs the password provider instead of the mock, with an empty outbox and its secret", async () => {
    const t = await open({ ...base, passwordLoginProvider: true, secrets: { apiKey: "k" } });
    expect(() => t.as(mockUsers.user())).toThrow(/password login provider/);
    const none = await t.request("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(none.status).toBe(404);
    expect(await t.mail.all()).toEqual([]);
    expect(await t.mail.lastTo("nobody@example.test")).toBeUndefined();
    // The health check finds frameworkAuthSecret.
    expect((await t.request("/api/__framework/health")).status).toBe(204);
    await expect(createTestApp(app, { ...base, passwordLoginProvider: true, stubLoginProvider: true })).rejects.toThrow(/cannot be combined/);
    await expect(createTestApp(app, { ...base, passwordLoginProvider: true, user: mockUsers.user() })).rejects.toThrow(/cannot be combined/);
  });

  it("refuses URLs on any other origin or protocol before the app sees them (root cause F-02 entry 2 revised)", async () => {
    const t = await open({ ...base, user: mockUsers.admin("a1") });
    const refused = /is not the app's origin \(http:\/\/localhost:8787\); the test app sends requests only to the app\. Send requests to other hosts, such as a cloud upload or download ticket's url, with fetch\./;
    const admin = t.as(mockUsers.admin("a1"));
    for (const target of [
      "https://acct.r2.cloudflarestorage.com/api/me",
      "//other.example/api/me",
      "/\\other.example/api/me",
      "https://localhost:8787/api/me",
      "blob:http://localhost:8787/api/me",
    ]) {
      await expect(admin.request(target), target).rejects.toThrow(refused);
    }
    const posted = admin.request("//other.example/api/notes", { method: "POST" });
    await expect(posted).rejects.toThrow(refused);
    expect(await (await admin.request("/api/notes", { method: "POST" })).json()).toEqual({ count: 1 });
    expect(await (await admin.request("http://localhost:8787/api/me")).json()).toEqual({ level: "admin", id: "a1", displayName: null });
    expect(await (await admin.request("HTTP://LOCALHOST:8787/api/me")).json()).toEqual({ level: "admin", id: "a1", displayName: null });
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

// Root cause 2026-10-20-testing-dev-registry.md: a test app never joins Miniflare's dev registry.
// Each test points WRANGLER_REGISTRY_PATH at a scratch registry (never the host's) holding live
// foreign entries; a test app must neither write there, nor loop on a foreign entry under a past
// clock, nor delete foreign entries under a future clock. These tests are also the guard for the
// fix's dependence on Wrangler reading WRANGLER_REGISTRY_PATH before its first await.
describe("createTestApp and the dev registry", { timeout: 60_000 }, () => {
  let registry: string;
  let warnings: number;
  const onWarning = (warning: Error): void => {
    if (warning.name === "TimeoutOverflowWarning") warnings += 1;
  };

  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), "testapp-registry-"));
    vi.stubEnv("WRANGLER_REGISTRY_PATH", registry);
    warnings = 0;
    process.on("warning", onWarning);
  });

  afterEach(() => {
    process.off("warning", onWarning);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(registry, { recursive: true, force: true });
  });

  function plant(...names: string[]): void {
    for (const name of names) writeFileSync(join(registry, name), JSON.stringify({ instanceId: "foreign-process" }));
  }

  function snapshot(): Record<string, { mtimeMs: number; content: string }> {
    const entries: Record<string, { mtimeMs: number; content: string }> = {};
    for (const name of readdirSync(registry).sort()) {
      const file = join(registry, name);
      entries[name] = { mtimeMs: statSync(file).mtimeMs, content: readFileSync(file, "utf8") };
    }
    return entries;
  }

  /** Creates a test app, checks the variable is restored, makes one request, and returns the registry while the app is live. */
  async function liveRegistry(): Promise<ReturnType<typeof snapshot>> {
    const t = await createTestApp(app, base);
    try {
      expect(process.env.WRANGLER_REGISTRY_PATH).toBe(registry);
      expect((await t.request("/api/hello")).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return snapshot();
    } finally {
      await t.dispose();
    }
  }

  it("with the real clock, writes no entry of its own to the registry", async () => {
    plant("someone-elses-worker");
    const planted = snapshot();
    expect(await liveRegistry()).toEqual(planted);
    expect(snapshot()).toEqual(planted);
  });

  it("with Date faked into the past, does not loop on a live foreign entry of the same name", async () => {
    plant("test-app", "someone-elses-worker");
    const planted = snapshot();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    const live = await liveRegistry();
    expect(warnings).toBe(0);
    expect(live).toEqual(planted);
    expect(snapshot()).toEqual(planted);
  });

  it("with Date faked into the future, does not delete other processes' live entries", async () => {
    plant("test-app", "someone-elses-worker");
    const planted = snapshot();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(await liveRegistry()).toEqual(planted);
    expect(snapshot()).toEqual(planted);
  });
});
