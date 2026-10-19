/**
 * The local target as the owner runs it: `npx <package> dev` and `reset-local` on a fixture
 * app (LOCAL-REQ-002, LOCAL-REQ-004). Fixture layer: `test/fixtures/local/app`.
 */
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { FixtureApp } from "../../fixtures/support/app.js";
import { canConnect, http, listeningSockets, startDev, type DevServer } from "../../fixtures/support/dev.js";

const TIMEOUT = 900_000;

describe("local state (LOCAL-REQ-002)", () => {
  let app: FixtureApp | undefined;

  afterAll(async () => {
    await app?.dispose();
  });

  it(
    tag("LOCAL-AC-002", "persistence clause: SQL, KV and file data survive a restart of dev, and reset-local clears them"),
    async () => {
      app = await FixtureApp.create({ layers: ["apps/base", "local/app"] });
      const read = async (dev: DevServer): Promise<unknown> => {
        const res = await http(dev.port, "/api/state");
        expect(res.status, res.body).toBe(200);
        return JSON.parse(res.body);
      };

      let dev = await startDev(app);
      try {
        const write = await http(dev.port, "/api/state", { method: "POST", headers: { origin: dev.origin } });
        expect(write.status, write.body).toBe(204);
        expect(await read(dev)).toEqual({ rows: 1, kv: "kept", file: "kept" });
      } finally {
        await dev.process.stop();
      }

      dev = await startDev(app);
      try {
        expect(await read(dev), "data did not survive a restart of dev").toEqual({ rows: 1, kv: "kept", file: "kept" });
      } finally {
        await dev.process.stop();
      }

      const reset = await app.cli(["reset-local"]);
      expect(reset.code, reset.output).toBe(0);

      dev = await startDev(app);
      try {
        expect(await read(dev), "reset-local did not clear local data").toEqual({ rows: 0, kv: null, file: null });
      } finally {
        await dev.process.stop();
      }
    },
    TIMEOUT,
  );
});

describe("consistent local origin (LOCAL-REQ-004)", () => {
  let app: FixtureApp | undefined;
  let dev: DevServer | undefined;

  beforeAll(async () => {
    app = await FixtureApp.create({ layers: ["apps/base", "local/app"] });
    dev = await startDev(app);
  }, TIMEOUT);

  afterAll(async () => {
    await dev?.process.stop();
    await app?.dispose();
  });

  it(tag("LOCAL-AC-004", "login and API calls work at http://localhost:<port>"), async () => {
    expect(dev).toBeDefined();
    if (dev === undefined) return;
    expect(dev.origin).toMatch(/^http:\/\/localhost:\d+$/);

    const hello = await http(dev.port, "/api/hello");
    expect(hello.status).toBe(200);
    expect(JSON.parse(hello.body)).toEqual({ greeting: "hello" });

    const login = await http(dev.port, "/api/auth/mock-login", {
      method: "POST",
      headers: { origin: dev.origin, "content-type": "application/json" },
      body: JSON.stringify({ level: "user", id: "u_localorigintest", displayName: "Local Tester" }),
    });
    expect(login.status, login.body).toBe(204);
    const setCookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
    const session = setCookie.find((c) => c.startsWith("session_local="));
    expect(session, `no session_local cookie in ${JSON.stringify(setCookie)}`).toBeDefined();
    expect(session ?? "", "a Secure cookie would not be sent back over http://localhost").not.toMatch(/;\s*Secure/i);
    const cookie = (session ?? "").split(";")[0] ?? "";

    const whoami = await http(dev.port, "/api/whoami", { headers: { cookie } });
    expect(whoami.status, whoami.body).toBe(200);
    expect(JSON.parse(whoami.body)).toEqual({ level: "user", id: "u_localorigintest", displayName: "Local Tester" });

    const me = await http(dev.port, "/api/auth/me", { headers: { cookie } });
    expect(me.status, me.body).toBe(200);
    expect(JSON.parse(me.body)).toMatchObject({ level: "user", id: "u_localorigintest" });

    const created = await http(dev.port, "/api/items", {
      method: "POST",
      headers: { cookie, origin: dev.origin, "content-type": "application/json" },
      body: JSON.stringify({ title: "from a logged-in browser" }),
    });
    expect(created.status, created.body).toBe(201);
  });

  it(tag("LOCAL-AC-004", "the dev servers listen on loopback only and are not reachable on a non-loopback address"), async () => {
    expect(dev).toBeDefined();
    if (dev === undefined) return;
    const sockets = listeningSockets(dev.process.pid);
    expect(sockets.some((s) => s.port === dev?.port), `the printed port is not among the dev listeners: ${JSON.stringify(sockets)}`).toBe(true);
    expect(sockets.filter((s) => !s.loopback), "listeners bound to a non-loopback address").toEqual([]);

    const external = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i !== undefined && !i.internal && i.family === "IPv4")
      .map((i) => i?.address ?? "");
    for (const address of external) {
      for (const s of sockets) expect(await canConnect(address, s.port), `${address}:${s.port} accepted a connection`).toBe(false);
    }
  });

  it(tag("LOCAL-AC-004", "a request with Host: evil.example is rejected"), async () => {
    expect(dev).toBeDefined();
    if (dev === undefined) return;
    const control = await http(dev.port, "/api/hello", { headers: { host: `localhost:${dev.port}` } });
    expect(control.status).toBe(200);

    for (const path of ["/api/hello", "/"]) {
      let status: number;
      let body = "";
      try {
        const res = await http(dev.port, path, { headers: { host: "evil.example" } });
        status = res.status;
        body = res.body;
      } catch {
        status = -1; // connection closed without a response: also a rejection
      }
      expect(status === -1 || status >= 400, `${path} with Host: evil.example answered ${status}`).toBe(true);
      expect(body).not.toContain('"greeting"');
    }
  });
});
