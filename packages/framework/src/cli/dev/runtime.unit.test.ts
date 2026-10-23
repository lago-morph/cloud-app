import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientPortInUseError, type ClientServer } from "../commands/dev.js";

// Captures the configuration `dev` hands to Vite, without starting a server. `listenFailure`, when
// set, makes listen fail the way Vite's does: an "error" event on the http server, then a rejection.
const created: Array<Record<string, unknown>> = [];
let listenFailure: { event?: NodeJS.ErrnoException; rejection: Error } | undefined;
vi.mock("vite", () => ({
  createServer: vi.fn(async (config: Record<string, unknown>) => {
    created.push(config);
    const httpServer = Object.assign(new EventEmitter(), { address: () => ({ address: "127.0.0.1", family: "IPv4", port: 5199 }) });
    return {
      httpServer,
      listen: async () => {
        if (listenFailure === undefined) return undefined;
        if (listenFailure.event) httpServer.emit("error", listenFailure.event);
        throw listenFailure.rejection;
      },
      close: async () => undefined,
    };
  }),
}));

const { realDevDeps } = await import("./runtime.js");

interface ProxyOptions {
  target?: string;
  changeOrigin?: boolean;
  configure?: (proxy: unknown, options: ProxyOptions) => void;
}

interface ServerOptions {
  host?: string;
  port?: number;
  cors?: unknown;
  proxy?: Record<string, ProxyOptions>;
  watch?: { ignored?: unknown };
}

const startClient = (): Promise<ClientServer> => realDevDeps().startClient({ appDir: "/apps/one", root: "/apps/one/src/client", cacheDir: "/apps/one/.framework/vite" });

async function started(): Promise<{ client: ClientServer; server: ServerOptions }> {
  const client = await startClient();
  const config = created.at(-1);
  if (config === undefined) throw new Error("Vite createServer was not called");
  return { client, server: config.server as ServerOptions };
}

async function serverOptions(): Promise<ServerOptions> {
  return (await started()).server;
}

beforeEach(() => {
  created.length = 0;
  listenFailure = undefined;
});

describe("dev's Vite client port (MIG-AC-002 root cause)", () => {
  it("binds loopback port 0 and reports the port Vite bound", async () => {
    const { client, server } = await started();
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(0);
    expect(client.port).toBe(5199);
  });

  it("reports Vite's own structured EADDRINUSE as ClientPortInUseError, keeping Vite's error", async () => {
    const rejection = new Error("Port 41000 is already in use");
    listenFailure = { event: Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:41000"), { code: "EADDRINUSE", port: 41000 }), rejection };
    const error = await startClient().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ClientPortInUseError);
    expect((error as ClientPortInUseError).port).toBe(41000);
    expect((error as ClientPortInUseError).original).toBe(rejection);
  });

  it("passes any other listen failure through unchanged, even one whose text mentions a port in use", async () => {
    const rejection = new Error("Port 41000 is already in use");
    listenFailure = { event: Object.assign(new Error("listen EACCES"), { code: "EACCES" }), rejection };
    await expect(startClient()).rejects.toBe(rejection);
    listenFailure = { rejection };
    await expect(startClient()).rejects.toBe(rejection);
  });
});

describe("dev's Vite client server (local.md §2, files.md §2 Local, DEC-0006)", () => {
  it("[FILES-AC-004] adds no CORS headers, so a loopback page on another origin cannot use the app's routes", async () => {
    // Vite's default `cors` reflects any localhost / 127.0.0.1 / [::1] origin and answers preflights itself.
    expect((await serverOptions()).cors).toBe(false);
  });

  it("[AUTH-AC-007] proxies /api with the Worker's own Host, so wrangler does not rewrite the browser's Origin", async () => {
    // With the browser's Host, wrangler's ProxyWorker rewrites `https://localhost:<port>` to `http://…`.
    const { client, server } = await started();
    const proxy = Object.values(server.proxy ?? {});
    expect(proxy).toHaveLength(1);
    // Vite hands `configure` the options object its http-proxy reads on every request; the target
    // is set on it once Wrangler reports its port.
    const options: ProxyOptions = { ...proxy[0] };
    proxy[0]?.configure?.({}, options);
    client.proxyApiTo("http://127.0.0.1:8801");
    expect(options).toMatchObject({ target: "http://127.0.0.1:8801", changeOrigin: true });
  });

  it("[FILES-AC-003] does not watch the framework package's own files, as in an installed app where it is under node_modules", async () => {
    // In the monorepo the framework is a workspace link to packages/framework; a rebuild of its dist
    // (the scaffolder's `npm pack` → prepack) would otherwise make Vite reload, or buffer a reload for, the app's pages.
    const frameworkRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));
    const ignored = (await serverOptions()).watch?.ignored;
    const matchers = (Array.isArray(ignored) ? ignored : [ignored]).filter((m): m is (p: string) => boolean => typeof m === "function");
    const isIgnored = (p: string) => matchers.some((m) => m(p));
    expect(isIgnored(frameworkRoot)).toBe(true);
    expect(isIgnored(join(frameworkRoot, "dist", "client", "index.js"))).toBe(true);
    // The app's own files, and a sibling directory sharing the prefix, stay watched.
    expect(isIgnored("/apps/one/src/client/main.ts")).toBe(false);
    expect(isIgnored(`${frameworkRoot}-other/x.js`)).toBe(false);
  });
});
