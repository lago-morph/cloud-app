/**
 * The local target as the owner runs it: `npx <package> dev` and `reset-local` on a fixture
 * app (LOCAL-REQ-002, LOCAL-REQ-004). Fixture layer: `test/fixtures/local/app`.
 */
import { createServer, type AddressInfo, type Server } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
// The compiled package, as the CLI binary runs it (DEC-0111): the fixture app's build loads the
// framework from dist/, and a second copy of the framework from src/ would not share its config keys.
import { devCommand } from "../../../dist/cli/commands/dev.js";
import { realDevDeps } from "../../../dist/cli/dev/runtime.js";
import { captureIo } from "../../../dist/cli/io.test-support.js";
import { FixtureApp } from "../../fixtures/support/app.js";
import { canConnect, http, listeningSockets, startDev, type DevServer } from "../../fixtures/support/dev.js";

const TIMEOUT = 900_000;

describe("dev picks no port before binding it (MIG-AC-002 root cause, 2026-10-20-mig-ac-002-workerd-crash.md)", () => {
  let app: FixtureApp | undefined;
  const held: Server[] = [];

  afterAll(async () => {
    for (const s of held) await new Promise<void>((resolve) => s.close(() => resolve()));
    await app?.dispose();
  });

  it(
    "serves even when every port freePort returns is taken by another socket before dev binds it",
    async () => {
      app = await FixtureApp.create({ layers: ["apps/base", "local/app"] });
      // Three ports picked the way dev's former `freePort` picked them (listen on port 0, read the
      // port, close), each then held by another listening socket: the state when another process
      // takes a picked port before the server binds it (record F2). A dev that still picks its
      // client, Worker and inspector ports gets exactly these through `freePort`; a dev that lets
      // each server bind port 0 itself never gets a port that is in use.
      const heldPorts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const pick = createServer();
        await new Promise<void>((resolve) => pick.listen(0, "127.0.0.1", () => resolve()));
        const port = (pick.address() as AddressInfo).port;
        await new Promise<void>((resolve) => pick.close(() => resolve()));
        const holder = createServer((socket) => socket.destroy());
        await new Promise<void>((resolve, reject) => {
          holder.once("error", reject);
          holder.listen(port, "127.0.0.1", () => resolve());
        });
        held.push(holder);
        heldPorts.push(port);
      }
      let next = 0;
      const freePort = async (): Promise<number> => heldPorts[next++ % heldPorts.length] ?? 0;
      let stop!: () => void;
      const stopped = new Promise<void>((resolve) => (stop = resolve));
      const deps = { ...realDevDeps(), freePort, stopRequested: () => stopped };
      const io = captureIo(app.dir);
      let finished: number | Error | undefined;
      const running = devCommand(deps)([], io).then(
        (code) => (finished = code),
        (error: unknown) => (finished = error instanceof Error ? error : new Error(String(error))),
      );
      const deadline = Date.now() + 240_000;
      let port: number | undefined;
      while (port === undefined && finished === undefined && Date.now() < deadline) {
        const m = /http:\/\/localhost:(\d+)/.exec(io.out);
        if (m) port = Number(m[1]);
        else await new Promise((r) => setTimeout(r, 200));
      }
      try {
        expect(finished, `dev ended before serving:\n${String(finished)}\n${io.out}\n${io.err}`).toBeUndefined();
        expect(port, `dev printed no URL in time:\n${io.out}\n${io.err}`).toBeDefined();
        expect(heldPorts, "dev was served on a port another socket holds").not.toContain(port);
        const hello = await http(port ?? 0, "/api/hello");
        expect(hello.status, hello.body).toBe(200);
        expect(JSON.parse(hello.body)).toEqual({ greeting: "hello" });
      } finally {
        stop();
        await running;
      }
      expect(finished, io.err).toBe(0);
    },
    TIMEOUT,
  );
});

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

    // Non-loopback addresses of this machine: every non-internal IPv4 address, and IPv6 ones
    // other than link-local (which need a zone). B-T5 (flag F5): the probe must run at least
    // once, so a machine with no such address fails this test instead of passing vacuously.
    const external = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i !== undefined && !i.internal && (i.family === "IPv4" || !/^fe80:/i.test(i.address)))
      .map((i) => i?.address ?? "")
      .filter((a) => a !== "");
    expect(
      external,
      "no non-loopback address on this machine, so reachability on a non-loopback address cannot be checked; run this suite where a non-loopback interface exists (not inside `unshare -n`)",
    ).not.toEqual([]);

    // Positive control: a listener on all addresses is reachable on each probed address, so a
    // `false` below means "not reachable", not "the probe cannot connect at all".
    const control = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => control.listen(0, resolve));
    try {
      const controlPort = (control.address() as AddressInfo).port;
      for (const address of external) {
        expect(await canConnect(address, controlPort), `control: a wildcard listener is not reachable on ${address}`).toBe(true);
      }
    } finally {
      await new Promise<void>((resolve) => control.close(() => resolve()));
    }

    let probes = 0;
    for (const address of external) {
      for (const s of sockets) {
        expect(await canConnect(address, s.port), `${address}:${s.port} accepted a connection`).toBe(false);
        probes++;
      }
    }
    expect(probes, `probed ${external.join(", ")} on ports ${sockets.map((s) => s.port).join(", ")}`).toBe(external.length * sockets.length);
    expect(probes).toBeGreaterThan(0);
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
