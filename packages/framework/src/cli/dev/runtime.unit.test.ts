import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  watch?: { ignored?: unknown };
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
