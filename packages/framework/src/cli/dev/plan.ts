/**
 * The fixed parts of `dev` (local.md §2; DEC-0190): where local state and secrets
 * live, how Wrangler is started, which `Host` is accepted, where the client entry page is.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DevPaths {
  /** Written by the local build. */
  readonly wranglerConfig: string;
  /** Wrangler's `--persist-to`: local D1 (SQL, KV) and R2 persist here between runs. */
  readonly persistTo: string;
  /** The same state as `getPlatformProxy` addresses it (Wrangler adds `v3/` itself). */
  readonly platformProxyPersist: string;
  readonly devVars: string;
  readonly viteCache: string;
}

export function devPaths(appDir: string): DevPaths {
  return {
    wranglerConfig: join(appDir, ".framework", "local", "wrangler.jsonc"),
    persistTo: join(appDir, ".wrangler", "state"),
    platformProxyPersist: join(appDir, ".wrangler", "state", "v3"),
    devVars: join(appDir, ".dev.vars"),
    viteCache: join(appDir, ".framework", "vite"),
  };
}

/** Loopback only (LOCAL-REQ-004). */
export const LOOPBACK = "127.0.0.1";

/**
 * Wrangler's arguments. The Worker and inspector ports are 0: workerd binds a free loopback port
 * itself, so no port is picked and released before the bind, which another socket could take in
 * between (2026-10-20-mig-ac-002-workerd-crash.md). `dev` reads the Worker's port from wrangler's
 * IPC `DEV_SERVER_READY` message (`devServerReadyPort`), else from its `Ready on` line.
 */
export function wranglerDevArgs(options: { readonly appDir: string; readonly publicOrigin: string }): string[] {
  const paths = devPaths(options.appDir);
  return [
    "dev",
    "--config", paths.wranglerConfig,
    "--persist-to", paths.persistTo,
    "--env-file", paths.devVars,
    "--ip", LOOPBACK,
    "--port", "0",
    "--inspector-ip", LOOPBACK,
    "--inspector-port", "0",
    "--var", `FRAMEWORK_PUBLIC_ORIGIN:${options.publicOrigin}`,
    "--show-interactive-dev-session=false",
    "--local",
  ];
}

function validPort(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

/**
 * The Worker's bound port from wrangler's IPC message `{"event":"DEV_SERVER_READY","ip","port"}`
 * (wrangler 4.149.0 sends it as a JSON string when started with an `ipc` channel); otherwise undefined.
 */
export function devServerReadyPort(message: unknown): number | undefined {
  let value: unknown = message;
  if (typeof message === "string") {
    try {
      value = JSON.parse(message);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { event?: unknown; port?: unknown };
  return record.event === "DEV_SERVER_READY" ? validPort(record.port) : undefined;
}

/** The port in wrangler's `Ready on http://127.0.0.1:<port>` line (the fallback to the IPC message). */
export function readyLinePort(line: string): number | undefined {
  const m = /\bReady on http:\/\/127\.0\.0\.1:(\d+)\b/.exec(line);
  return m?.[1] === undefined ? undefined : validPort(Number(m[1]));
}

/** LOCAL-REQ-004: a request is served only when its `Host` is exactly `localhost:<port>`. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `localhost:${String(port)}`;
}

/** The directory whose `index.html` is the client entry page: the app root, else `src/client/`. */
export function clientRoot(appDir: string): string {
  if (existsSync(join(appDir, "index.html"))) return appDir;
  const client = join(appDir, "src", "client");
  return existsSync(join(client, "index.html")) ? client : appDir;
}
