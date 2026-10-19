/**
 * The fixed parts of `dev` (local.md §2; DEC-PENDING-B-16-3): where local state and secrets
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

export function wranglerDevArgs(options: { readonly appDir: string; readonly port: number; readonly inspectorPort: number; readonly publicOrigin: string }): string[] {
  const paths = devPaths(options.appDir);
  return [
    "dev",
    "--config", paths.wranglerConfig,
    "--persist-to", paths.persistTo,
    "--env-file", paths.devVars,
    "--ip", LOOPBACK,
    "--port", String(options.port),
    "--inspector-ip", LOOPBACK,
    "--inspector-port", String(options.inspectorPort),
    "--var", `FRAMEWORK_PUBLIC_ORIGIN:${options.publicOrigin}`,
    "--show-interactive-dev-session=false",
    "--local",
  ];
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
