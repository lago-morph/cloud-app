import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures the configuration `dev` hands to Vite, without starting a server.
const created: Array<Record<string, unknown>> = [];
vi.mock("vite", () => ({
  createServer: vi.fn(async (config: Record<string, unknown>) => {
    created.push(config);
    return { listen: async () => undefined, close: async () => undefined };
  }),
}));

const { realDevDeps } = await import("./runtime.js");

interface ServerOptions {
  cors?: unknown;
  proxy?: Record<string, { target?: string; changeOrigin?: boolean }>;
}

async function serverOptions(): Promise<ServerOptions> {
  await realDevDeps().startClient({ appDir: "/apps/one", root: "/apps/one/src/client", port: 5199, apiTarget: "http://127.0.0.1:8801", cacheDir: "/apps/one/.framework/vite" });
  const config = created.at(-1);
  if (config === undefined) throw new Error("Vite createServer was not called");
  return config.server as ServerOptions;
}

beforeEach(() => {
  created.length = 0;
});

describe("dev's Vite client server (local.md §2, files.md §2 Local, DEC-0006)", () => {
  it("[FILES-AC-004] adds no CORS headers, so a loopback page on another origin cannot use the app's routes", async () => {
    // Vite's default `cors` reflects any localhost / 127.0.0.1 / [::1] origin and answers preflights itself.
    expect((await serverOptions()).cors).toBe(false);
  });

  it("[AUTH-AC-007] proxies /api with the Worker's own Host, so wrangler does not rewrite the browser's Origin", async () => {
    // With the browser's Host, wrangler's ProxyWorker rewrites `https://localhost:<port>` to `http://…`.
    const proxy = Object.values((await serverOptions()).proxy ?? {});
    expect(proxy).toHaveLength(1);
    expect(proxy[0]).toMatchObject({ target: "http://127.0.0.1:8801", changeOrigin: true });
  });
});
