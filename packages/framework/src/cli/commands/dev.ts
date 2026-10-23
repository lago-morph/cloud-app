/**
 * `dev` (CLI-REQ-001, local.md §2, LOCAL-REQ-001…004): runs the app locally.
 * 1. build for target `local`, stage `local` (`.framework/local/`); a values-file change takes
 *    effect at the next `dev` start, never while running (CFG-AC-003);
 * 2. generate missing development-only framework secrets into `.dev.vars`;
 * 3. apply pending migrations to the persisted local D1 database; a failing migration ends
 *    `dev` with status 1 before anything is served (MIG-REQ-003 local reading);
 * 4. start Vite on a free loopback port with a `Host` check (a bind lost to another socket is
 *    retried at most 3 times, on Vite's own `EADDRINUSE` only);
 * 5. start Wrangler on loopback port 0 (Worker and inspector) with the local bundle, the persisted
 *    state, `.dev.vars` and `FRAMEWORK_PUBLIC_ORIGIN`, capturing its log lines into `.logs/`; point
 *    Vite's `/api` proxy at the port Wrangler reports, and print `http://localhost:<port>`, the one
 *    origin of the client and `/api`, recording it in `.framework/local/dev-server.json` for
 *    `smoke --target local` (DEC-0272);
 * 6. on Ctrl-C (SIGINT/SIGTERM) remove the record, stop both and exit 0; if Wrangler stops on
 *    its own, remove the record and exit 1.
 */
import { MigrationFailedError } from "../../mig/apply.js";
import { describeFailure } from "../failure.js";
import { parseOptions } from "../args.js";
import { EXIT, type CliIo, type Command } from "../io.js";
import { clearDevServer, recordDevServer } from "./smoke.js";
import { clientRoot, devPaths, LOOPBACK, wranglerDevArgs } from "../dev/plan.js";

export interface WorkerProcess {
  /** The loopback port Wrangler's Worker is bound to (it binds port 0 itself). */
  readonly port: number;
  /** Resolves with Wrangler's exit status when it ends. */
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

export interface ClientServer {
  /** The loopback port the client server is bound to. */
  readonly port: number;
  /** Points the `/api` proxy at the Worker; until then `/api` answers 503. */
  proxyApiTo(target: string): void;
  close(): Promise<void>;
}

/**
 * The client server's bind failed with Vite's own structured `EADDRINUSE`: the port Vite picked
 * for port 0 was taken before Vite bound it. `original` is the error Vite failed with.
 */
export class ClientPortInUseError extends Error {
  constructor(
    readonly port: number | undefined,
    readonly original: Error,
  ) {
    super(original.message);
    this.name = "ClientPortInUseError";
  }
}

/** Attempts at starting the client server when its port is taken (MIG-AC-002 root cause review, reason 4). */
export const CLIENT_START_ATTEMPTS = 3;

export interface DevDeps {
  build(appDir: string): Promise<{ readonly app: string }>;
  ensureDevSecrets(appDir: string): Promise<readonly string[]>;
  /** Applies pending migrations to the persisted local D1; resolves to the IDs applied. */
  migrate(appDir: string): Promise<readonly string[]>;
  /** Starts Wrangler on port 0 and resolves once it accepts requests on the port it reports. */
  startWorker(options: { readonly appDir: string; readonly args: readonly string[]; readonly io: CliIo }): Promise<WorkerProcess>;
  /** Starts Vite on a free loopback port; rejects with `ClientPortInUseError` when that port was taken. */
  startClient(options: { readonly appDir: string; readonly root: string; readonly cacheDir: string }): Promise<ClientServer>;
  /** Resolves when the owner asks `dev` to stop (Ctrl-C). */
  stopRequested(): Promise<void>;
}

/** Starts the client server, retrying only on its own structured port-in-use failure, at most `CLIENT_START_ATTEMPTS` times. */
async function startClientServer(deps: DevDeps, appDir: string, io: CliIo): Promise<ClientServer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deps.startClient({ appDir, root: clientRoot(appDir), cacheDir: devPaths(appDir).viteCache });
    } catch (error) {
      if (!(error instanceof ClientPortInUseError)) throw error;
      if (attempt >= CLIENT_START_ATTEMPTS) throw error.original;
      io.stderr(
        `dev: client port ${error.port === undefined ? "(unknown)" : String(error.port)} was taken before Vite could bind it (EADDRINUSE); ` +
          `retrying on a fresh port (attempt ${String(attempt + 1)} of ${String(CLIENT_START_ATTEMPTS)})\n`,
      );
    }
  }
}

export function devCommand(deps: DevDeps): Command {
  return async (args, io) => {
    parseOptions(args, []);
    const appDir = io.cwd;
    const { app } = await deps.build(appDir);
    io.stdout(`dev: built ${app} for the local target\n`);
    const generated = await deps.ensureDevSecrets(appDir);
    if (generated.length > 0) io.stdout(`dev: generated development secrets in .dev.vars: ${generated.join(", ")}\n`);
    try {
      const applied = await deps.migrate(appDir);
      io.stdout(applied.length === 0 ? "dev: migrations up to date\n" : `dev: applied migrations: ${applied.join(", ")}\n`);
    } catch (error) {
      if (!(error instanceof MigrationFailedError)) throw error;
      io.stderr(`dev: ${error.message}\nThe local database is unchanged by this migration; nothing was served.\n`);
      return EXIT.failed;
    }

    // No port is picked and released before its bind (2026-10-20-mig-ac-002-workerd-crash.md): Vite
    // binds first, so its port is known for FRAMEWORK_PUBLIC_ORIGIN; Wrangler then binds port 0 for
    // the Worker and the inspector and reports the Worker's port.
    const client = await startClientServer(deps, appDir, io);
    const origin = `http://localhost:${String(client.port)}`;
    let worker: WorkerProcess;
    try {
      worker = await deps.startWorker({ appDir, io, args: wranglerDevArgs({ appDir, publicOrigin: origin }) });
    } catch (error) {
      await client.close();
      throw error;
    }
    client.proxyApiTo(`http://${LOOPBACK}:${String(worker.port)}`);
    io.stdout(`\n  ${app} is running at ${origin}/  (client and /api; Ctrl-C stops)\n\n`);
    recordDevServer(appDir, origin);

    const outcome = await Promise.race([deps.stopRequested().then(() => ({ kind: "stop" as const })), worker.exited.then((status) => ({ kind: "exited" as const, status }))]);
    clearDevServer(appDir);
    let cleanupError: unknown;
    for (const step of [() => client.close(), () => worker.stop()]) {
      try {
        await step();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (outcome.kind === "exited") {
      io.stderr(`dev: wrangler exited on its own (status ${String(outcome.status)}); dev stopped\n`);
      return EXIT.failed;
    }
    if (cleanupError !== undefined) {
      io.stderr(`dev: stopping failed: ${describeFailure(cleanupError)}\n`);
      return EXIT.failed;
    }
    io.stdout("dev: stopped\n");
    return EXIT.ok;
  };
}

/** `dev` bound to the real build, secrets, migrations, Wrangler and Vite. */
export async function devBinding(): Promise<Command> {
  const { realDevDeps } = await import("../dev/runtime.js");
  return devCommand(realDevDeps());
}
