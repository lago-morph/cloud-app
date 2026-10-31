/**
 * `connectTestStage()` against a real local `dev` server (S4 coverage list §1.1 item 2;
 * testing.d.ts; cli.md §2 "smoke"): the connection `smoke --target local` passes in
 * `PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION` (the name is CLI's, cli.md), the base URL from it,
 * logins through mock-login with `as()`, `Origin` on state-changing requests, `dispose`, the
 * in-process-only members refused, and a non-test stage refused before anything is sent.
 * Untagged: CLI-AC-005 is evidenced by `smoke` itself. Matchers such as /connected stage/ pin
 * today's messages, which testing.d.ts does not word.
 */
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectTestStage, mockUsers, type TestApp } from "../../../src/testing/index.js";
import { devFixtureFiles, makeTempApp, requireBuiltFramework, startDev, type DevServer, type TempApp } from "../core/harness/harness.js";

const CONNECTION_ENV = "PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION";

let app: TempApp | undefined;
let devStart: Promise<DevServer> | undefined;
/** Starts `dev` on first use, so a failing start fails each test rather than skipping them. */
function server(): Promise<DevServer> {
  requireBuiltFramework();
  devStart ??= makeTempApp(devFixtureFiles({ name: "connectsuite" })).then((a) => {
    app = a;
    return startDev(a.dir);
  });
  return devStart;
}
let before: string | undefined;
beforeAll(() => {
  before = process.env[CONNECTION_ENV];
});
afterEach(() => {
  if (before === undefined) delete process.env[CONNECTION_ENV];
  else process.env[CONNECTION_ENV] = before;
});
afterAll(async () => {
  await devStart?.then((d) => d.stop(), () => undefined);
  await app?.remove();
}, 60_000);

const connect = async (target: string, stage: string, baseUrl: string): Promise<TestApp> => {
  process.env[CONNECTION_ENV] = JSON.stringify({ target, stage, baseUrl });
  return connectTestStage();
};
const json = async (a: TestApp, path: string) => (await (await a.request(path)).json()) as Record<string, unknown>;

/** A local port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe("connectTestStage against the local dev server", { timeout: 300_000 }, () => {
  it("connects anonymously to the recorded origin; as() logs in through mock-login; a state-changing request carries Origin; dispose logs out", async () => {
    const dev = await server();
    const stage = await connect("local", "local", dev.baseUrl);
    expect(await json(stage, "/api/whoami")).toEqual({ level: "anonymous" });

    const user = stage.as(mockUsers.user("u_connected"));
    expect(await json(user, "/api/whoami")).toEqual({ level: "user", id: "u_connected", displayName: null });
    expect(await json(stage.as(mockUsers.admin("u_boss")), "/api/auth/me")).toMatchObject({ level: "admin", id: "u_boss" });
    expect(await json(stage, "/api/whoami"), "the original stays anonymous").toEqual({ level: "anonymous" });

    // A POST with no Origin of the test's own passes the forgery check (AUTH-REQ-007): the app adds it.
    const logout = await user.request("/api/auth/logout", { method: "POST" });
    expect(logout.status).toBeLessThan(400);
    expect(await json(user, "/api/whoami")).toEqual({ level: "anonymous" });

    // dispose on a connected stage only logs that test app out; the stage and its other apps stay usable.
    const other = stage.as(mockUsers.user("u_disposed"));
    expect((await json(other, "/api/whoami")).id).toBe("u_disposed");
    await other.dispose();
    // Its session is over: a later request through it is refused or anonymous (testing.d.ts words neither).
    const after = await other.request("/api/whoami").then(async (r) => (await r.json()) as Record<string, unknown>, (e: unknown) => e);
    expect(after instanceof Error || (after as { level?: string }).level === "anonymous", String(JSON.stringify(after))).toBe(true);
    expect(await json(stage, "/api/whoami")).toEqual({ level: "anonymous" });
    expect((await json(stage.as(mockUsers.user("u_disposed")), "/api/whoami")).id, "the same user logs in again").toBe("u_disposed");
  });

  it("refuses the in-process-only members on a connected stage, and a path on another origin before sending", async () => {
    const dev = await server();
    const stage = await connect("local", "local", dev.baseUrl);
    expect(() => stage.logs()).toThrow(/connected stage/);
    expect(() => stage.setUnavailable(["files"])).toThrow(/connected stage/);
    expect(() => stage.clock).toThrow(/connected stage/);
    expect(() => stage.authApp).toThrow(/connected stage/);
    await expect(stage.grantRole("u_x", "admin")).rejects.toThrow(/connected stage/);
    await expect(stage.loginWithStub("alice")).rejects.toThrow(/connected stage/);
    await expect(stage.request("//evil.example/api/whoami")).rejects.toThrow(/evil\.example|origin/);
    await expect(stage.request("https://evil.example/api/whoami")).rejects.toThrow(/evil\.example|origin/);
  });

  it("rejects a stage that is not a test stage before any request, and names method and path when nothing answers", async () => {
    const port = await closedPort();
    // Nothing listens there: had a request been sent, the error would be "no response".
    await expect(connect("cloudflare", "prod", `http://127.0.0.1:${port}`)).rejects.toThrow(/not a test stage/);
    await expect(connect("local", "local", `http://127.0.0.1:${port}`)).rejects.toThrow(/GET .*\/api\/auth\/me/);
    process.env[CONNECTION_ENV] = "{not json";
    await expect(connectTestStage(), "a malformed connection").rejects.toThrow(/malformed/);
    delete process.env[CONNECTION_ENV];
    await expect(connectTestStage(), "outside a smoke run it says how to start one").rejects.toThrow(/smoke/);
  });

  it("an unexpected answer is named by method, path, status, error code and requestId", async () => {
    const stub = createHttpServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "CORE.INTERNAL", message: "boom", requestId: "req-t3-500" } }));
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (stub.address() as { port: number }).port;
      const error = await connect("local", "local", `http://127.0.0.1:${port}`).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      for (const part of ["GET", "/api/auth/me", "500", "CORE.INTERNAL", "req-t3-500"]) expect(message).toContain(part);
    } finally {
      await new Promise<void>((r) => stub.close(() => r()));
    }
  });
});
