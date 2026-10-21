import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MigrationFailedError } from "../../mig/apply.js";
import { captureIo } from "../io.test-support.js";
import { runCommand } from "../main.js";
import { CLIENT_START_ATTEMPTS, ClientPortInUseError, devCommand, type DevDeps } from "./dev.js";
import { devServerRecordPath } from "./smoke.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function deps(calls: string[], overrides: Partial<DevDeps> = {}) {
  const stop = deferred<void>();
  const workerExit = deferred<number | null>();
  const d: DevDeps = {
    build: async (dir) => (calls.push(`build ${dir}`), { app: "one" }),
    ensureDevSecrets: async () => (calls.push("secrets"), ["frameworkSessionKey"]),
    migrate: async () => (calls.push("migrate"), ["app:0000_schema"]),
    startWorker: async (options) => {
      calls.push(`worker ${options.args.join(" ")}`);
      return { port: 5101, exited: workerExit.promise, stop: async () => void calls.push("worker stopped") };
    },
    startClient: async (options) => {
      calls.push(`client ${options.root}`);
      return {
        port: 5100,
        proxyApiTo: (target) => void calls.push(`client /api -> ${target}`),
        close: async () => void calls.push("client closed"),
      };
    },
    stopRequested: () => stop.promise,
    ...overrides,
  };
  return { d, stop, workerExit };
}

/** `dev` writes `.framework/local/dev-server.json` into the app directory while it runs. */
const tempAppDir = () => mkdtempSync(join(tmpdir(), "dev-record-"));

describe("dev (local.md §2)", () => {
  it("builds, generates missing dev secrets, migrates, starts Wrangler and Vite, prints the localhost URL, and stops both on Ctrl-C", async () => {
    const calls: string[] = [];
    const { d, stop } = deps(calls);
    const appDir = tempAppDir();
    const io = captureIo(appDir);
    const running = devCommand(d)([], io);
    await new Promise((r) => setTimeout(r, 10));
    expect(io.out).toContain("http://localhost:5100");
    expect(io.out).toContain("frameworkSessionKey");
    stop.resolve();
    expect(await running).toBe(0);
    expect(calls[0]).toBe(`build ${appDir}`);
    expect(calls.slice(1, 3)).toEqual(["secrets", "migrate"]);
    // Vite binds first, so its port is the public origin Wrangler gets; Wrangler binds port 0 and
    // reports its port, which the /api proxy then targets.
    expect(calls[3]).toBe(`client ${appDir}`);
    expect(calls[4]).toMatch(/^worker dev .*--port 0 .*--inspector-port 0 .*FRAMEWORK_PUBLIC_ORIGIN:http:\/\/localhost:5100/);
    expect(calls[5]).toBe("client /api -> http://127.0.0.1:5101");
    expect(calls.slice(6).sort()).toEqual(["client closed", "worker stopped"]);
  });

  it("passes no pre-picked port to Wrangler (MIG-AC-002 root cause)", async () => {
    const calls: string[] = [];
    const { d, stop } = deps(calls);
    const running = devCommand(d)([], captureIo(tempAppDir()));
    await new Promise((r) => setTimeout(r, 10));
    stop.resolve();
    expect(await running).toBe(0);
    const args = (calls.find((c) => c.startsWith("worker ")) ?? "").split(" ");
    expect(args[args.indexOf("--port") + 1]).toBe("0");
    expect(args[args.indexOf("--inspector-port") + 1]).toBe("0");
  });

  describe("client port taken before Vite binds it", () => {
    // What the real startClient throws when Vite's bind fails with EADDRINUSE: Vite's own error as `original`.
    const inUse = (port: number) => new ClientPortInUseError(port, new Error(`Port ${String(port)} is already in use`));

    it("retries only the client start, printing each retry, and serves on the fresh port", async () => {
      const calls: string[] = [];
      let attempts = 0;
      const { d: base, stop } = deps(calls);
      const d: DevDeps = {
        ...base,
        startClient: async (options) => {
          attempts++;
          if (attempts < 3) throw inUse(6000 + attempts);
          return base.startClient(options);
        },
      };
      const io = captureIo(tempAppDir());
      const running = devCommand(d)([], io);
      await new Promise((r) => setTimeout(r, 10));
      expect(io.out).toContain("http://localhost:5100");
      stop.resolve();
      expect(await running).toBe(0);
      expect(attempts).toBe(3);
      expect(io.err).toContain("client port 6001 was taken before Vite could bind it (EADDRINUSE); retrying on a fresh port (attempt 2 of 3)");
      expect(io.err).toContain("client port 6002 was taken before Vite could bind it (EADDRINUSE); retrying on a fresh port (attempt 3 of 3)");
      // Nothing else is re-run, and Wrangler starts once, after the client is up.
      expect(calls.filter((c) => c.startsWith("build") || c === "secrets" || c === "migrate")).toHaveLength(3);
      expect(calls.filter((c) => c.startsWith("worker dev"))).toHaveLength(1);
    });

    it(`fails with the original error and exit 1 after ${String(CLIENT_START_ATTEMPTS)} attempts`, async () => {
      const calls: string[] = [];
      let attempts = 0;
      const { d: base } = deps(calls);
      const d: DevDeps = { ...base, startClient: async () => Promise.reject(inUse(7000 + ++attempts)) };
      const io = captureIo(tempAppDir());
      expect(await runCommand(["dev"], io, { dev: { summary: "dev", run: devCommand(d) } })).toBe(1);
      expect(attempts).toBe(3);
      expect(io.err.match(/retrying on a fresh port/g)).toHaveLength(2);
      expect(io.err).toContain("dev failed: Port 7003 is already in use");
      expect(calls.some((c) => c.startsWith("worker"))).toBe(false);
    });

    it("does not retry any other client failure", async () => {
      const calls: string[] = [];
      let attempts = 0;
      const { d: base } = deps(calls);
      const d: DevDeps = { ...base, startClient: async () => (attempts++, Promise.reject(new Error("vite exploded"))) };
      const io = captureIo(tempAppDir());
      await expect(devCommand(d)([], io)).rejects.toThrow("vite exploded");
      expect(attempts).toBe(1);
      expect(io.err).not.toContain("retrying");
      expect(calls.some((c) => c.startsWith("worker"))).toBe(false);
    });
  });

  it("closes the client and fails when Wrangler exits before serving", async () => {
    const calls: string[] = [];
    const { d } = deps(calls, { startWorker: async () => Promise.reject(new Error("wrangler exited with status 1 before serving")) });
    await expect(devCommand(d)([], captureIo(tempAppDir()))).rejects.toThrow("wrangler exited with status 1 before serving");
    expect(calls).toContain("client closed");
  });

  it("[MIG-AC-003] a failing migration exits 1 naming it and serves nothing", async () => {
    const calls: string[] = [];
    const { d } = deps(calls, {
      migrate: async () => Promise.reject(new MigrationFailedError("app:0002_unique", "migrations/sqlite/0002_unique.sql", new Error("UNIQUE constraint failed"), [])),
    });
    const io = captureIo();
    expect(await devCommand(d)([], io)).toBe(1);
    expect(io.err).toContain("0002_unique");
    expect(io.err).toContain("UNIQUE constraint failed");
    expect(calls.some((c) => c.startsWith("worker") || c.startsWith("client"))).toBe(false);
  });

  it("exits 1 when Wrangler stops on its own, closing the client server", async () => {
    const calls: string[] = [];
    const { d, workerExit } = deps(calls);
    const io = captureIo(tempAppDir());
    const running = devCommand(d)([], io);
    await new Promise((r) => setTimeout(r, 10));
    workerExit.resolve(7);
    expect(await running).toBe(1);
    expect(calls).toContain("client closed");
    expect(io.err).toMatch(/wrangler.*exited/i);
  });

  it("takes no arguments", async () => {
    const { d } = deps([]);
    await expect(devCommand(d)(["--port", "3000"], captureIo())).rejects.toThrow();
  });

  it("[CLI-AC-005] records its origin for smoke while it runs and removes the record when it stops", async () => {
    const appDir = tempAppDir();
    const { d, stop } = deps([]);
    const running = devCommand(d)([], captureIo(appDir));
    await new Promise((r) => setTimeout(r, 10));
    expect(JSON.parse(readFileSync(devServerRecordPath(appDir), "utf8"))).toEqual({ origin: "http://localhost:5100", pid: process.pid });
    stop.resolve();
    expect(await running).toBe(0);
    expect(existsSync(devServerRecordPath(appDir))).toBe(false);
  });

  it("[CLI-AC-005] removes the record when Wrangler stops on its own", async () => {
    const appDir = tempAppDir();
    const { d, workerExit } = deps([]);
    const running = devCommand(d)([], captureIo(appDir));
    await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(devServerRecordPath(appDir))).toBe(true);
    workerExit.resolve(7);
    expect(await running).toBe(1);
    expect(existsSync(devServerRecordPath(appDir))).toBe(false);
  });
});
