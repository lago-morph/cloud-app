/**
 * `dev`'s real dependencies: the local build (B-16), SEC's `ensureDevSecrets`, MIG's
 * `migrateLocal` over the persisted local D1 (through Wrangler's `getPlatformProxy`, the same
 * configuration and state as `wrangler dev`), Wrangler (PAR-101) as a child process, and Vite
 * (PAR-113) in this process. Node only.
 */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer as createNetServer } from "node:net";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../build/build.js";
import { d1MigrationDatabase, migrateLocal, type D1Like } from "../../mig/apply.js";
import { ensureDevSecrets } from "../../secrets/local.js";
import type { ClientServer, DevDeps, WorkerProcess } from "../commands/dev.js";
import { createDevLogCapture } from "./logs.js";
import { devPaths, isAllowedHost, LOOPBACK } from "./plan.js";

const require = createRequire(import.meta.url);

function wranglerBin(): string {
  return join(dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
}

/** A free TCP port on loopback. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: LOOPBACK, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function migrate(appDir: string): Promise<readonly string[]> {
  const { getPlatformProxy } = await import("wrangler");
  const paths = devPaths(appDir);
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: paths.wranglerConfig, persist: { path: paths.platformProxyPersist } });
  try {
    return (await migrateLocal(d1MigrationDatabase(proxy.env.DB), join(appDir, "migrations"))).applied;
  } finally {
    await proxy.dispose();
  }
}

const startWorker: DevDeps["startWorker"] = async ({ appDir, args, port, io }) => {
  const child = spawn(process.execPath, [wranglerBin(), ...args], {
    cwd: appDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (line: string) => {
    if (line.trim() !== "") io.stderr(`[wrangler] ${line}\n`);
  };
  const out = createDevLogCapture(appDir, forward);
  const err = createDevLogCapture(appDir, forward);
  child.stdout.setEncoding("utf8").on("data", (d: string) => out.push(d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => err.push(d));
  let status: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => {
      out.end();
      err.end();
      status = code;
      resolve(code);
    });
  });
  const stop = async (): Promise<void> => {
    if (status !== undefined) return;
    child.kill("SIGINT");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(timer);
  };
  const deadline = Date.now() + 120_000;
  while (!(await accepts(port))) {
    if (status !== undefined) throw new Error(`wrangler exited with status ${String(status)} before serving`);
    if (Date.now() > deadline) {
      await stop();
      throw new Error("wrangler did not start serving within 120 s");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const worker: WorkerProcess = { exited, stop };
  return worker;
};

/** The real path of this framework package's root: the nearest directory above this module with a package.json. */
function frameworkRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("prototype-framework: package root not found");
    dir = parent;
  }
  return realpathSync(dir);
}

const startClient: DevDeps["startClient"] = async ({ root, port, apiTarget, cacheDir }) => {
  const { createServer } = await import("vite");
  const pkgRoot = frameworkRoot();
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    appType: "spa",
    clearScreen: false,
    logLevel: "warn",
    plugins: [
      {
        name: "prototype-framework:host-check",
        configureServer(vite) {
          // Runs before Vite's own middlewares, so it also guards the /api proxy (LOCAL-REQ-004).
          vite.middlewares.use((req, res, next) => {
            if (isAllowedHost(req.headers.host, port)) return next();
            res.statusCode = 403;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end(`Forbidden: this dev server only answers requests for localhost:${String(port)}\n`);
          });
        },
      },
    ],
    server: {
      host: LOOPBACK,
      port,
      strictPort: true,
      allowedHosts: [],
      // No CORS headers: Vite's default reflects any loopback origin and answers preflights itself,
      // letting other local pages use the app's routes (files.md §2 Local, DEC-0006).
      cors: false,
      // The Worker's own Host, so wrangler's dev proxy does not rewrite header URLs naming the browser's
      // host (it turns `Origin: https://localhost:<port>` into `http://…`, defeating AUTH-REQ-007).
      // Vite's host check above still runs on the browser's Host before the proxy (LOCAL-REQ-004).
      proxy: { "^/api(/|$|\\?)": { target: apiTarget, changeOrigin: true } },
      // Do not watch the framework's own files. An installed app has it under node_modules, which Vite
      // ignores; in this monorepo it is a workspace link Vite resolves to packages/framework, and a rebuild
      // of its dist (the scaffolder's `npm pack` → prepack) would reload every page, or buffer a reload for
      // the next one. A function, not a glob, so glob characters in the checkout path cannot break it.
      // Vite appends this to its defaults (.git, node_modules, the cache dir).
      watch: { ignored: [(p: string) => p === pkgRoot || p.startsWith(pkgRoot + sep)] },
    },
  });
  await server.listen();
  const client: ClientServer = { close: () => server.close() };
  return client;
};

function stopRequested(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

export function realDevDeps(): DevDeps {
  return {
    build: async (appDir) => ({ app: (await buildApp({ appDir, target: "local", stage: "local" })).deployment.app }),
    ensureDevSecrets,
    migrate,
    freePort,
    startWorker,
    startClient,
    stopRequested,
  };
}
