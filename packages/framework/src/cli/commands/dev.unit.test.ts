import { describe, expect, it } from "vitest";
import { MigrationFailedError } from "../../mig/apply.js";
import { captureIo } from "../io.test-support.js";
import { devCommand, type DevDeps } from "./dev.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function deps(calls: string[], overrides: Partial<DevDeps> = {}) {
  const stop = deferred<void>();
  const workerExit = deferred<number | null>();
  let ports = 5100;
  const d: DevDeps = {
    build: async (dir) => (calls.push(`build ${dir}`), { app: "one" }),
    ensureDevSecrets: async () => (calls.push("secrets"), ["frameworkSessionKey"]),
    migrate: async () => (calls.push("migrate"), ["app:0000_schema"]),
    freePort: async () => ports++,
    startWorker: async (options) => {
      calls.push(`worker ${options.args.join(" ")}`);
      return { exited: workerExit.promise, stop: async () => void calls.push("worker stopped") };
    },
    startClient: async (options) => {
      calls.push(`client ${String(options.port)} -> ${options.apiTarget}`);
      return { close: async () => void calls.push("client closed") };
    },
    stopRequested: () => stop.promise,
    ...overrides,
  };
  return { d, stop, workerExit };
}

describe("dev (local.md §2)", () => {
  it("builds, generates missing dev secrets, migrates, starts Wrangler and Vite, prints the localhost URL, and stops both on Ctrl-C", async () => {
    const calls: string[] = [];
    const { d, stop } = deps(calls);
    const io = captureIo("/apps/one");
    const running = devCommand(d)([], io);
    await new Promise((r) => setTimeout(r, 10));
    expect(io.out).toContain("http://localhost:5100");
    expect(io.out).toContain("frameworkSessionKey");
    stop.resolve();
    expect(await running).toBe(0);
    expect(calls[0]).toBe("build /apps/one");
    expect(calls.slice(1, 3)).toEqual(["secrets", "migrate"]);
    expect(calls[3]).toMatch(/^worker dev .*--port 5101 .*FRAMEWORK_PUBLIC_ORIGIN:http:\/\/localhost:5100/);
    expect(calls[4]).toBe("client 5100 -> http://127.0.0.1:5101");
    expect(calls.slice(5).sort()).toEqual(["client closed", "worker stopped"]);
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
    const io = captureIo();
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
});
