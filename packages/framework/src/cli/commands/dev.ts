/**
 * `dev` (CLI-REQ-001, local.md §2, LOCAL-REQ-001…004): runs the app locally.
 * 1. build for target `local`, stage `local` (`.framework/local/`); a values-file change takes
 *    effect at the next `dev` start, never while running (CFG-AC-003);
 * 2. generate missing development-only framework secrets into `.dev.vars`;
 * 3. apply pending migrations to the persisted local D1 database; a failing migration ends
 *    `dev` with status 1 before anything is served (MIG-REQ-003 local reading);
 * 4. start Wrangler on a loopback port with the local bundle, the persisted state, `.dev.vars`
 *    and `FRAMEWORK_PUBLIC_ORIGIN`, capturing its log lines into `.logs/`;
 * 5. start Vite on `localhost` (loopback) with `/api` proxied to Wrangler and a `Host` check,
 *    and print `http://localhost:<port>`, the one origin of the client and `/api`;
 * 6. on Ctrl-C (SIGINT/SIGTERM) stop both and exit 0; if Wrangler stops on its own, exit 1.
 */
import { MigrationFailedError } from "../../mig/apply.js";
import { describeFailure } from "../failure.js";
import { parseOptions } from "../args.js";
import { EXIT, type CliIo, type Command } from "../io.js";
import { clientRoot, devPaths, LOOPBACK, wranglerDevArgs } from "../dev/plan.js";

export interface WorkerProcess {
  /** Resolves with Wrangler's exit status when it ends. */
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

export interface ClientServer {
  close(): Promise<void>;
}

export interface DevDeps {
  build(appDir: string): Promise<{ readonly app: string }>;
  ensureDevSecrets(appDir: string): Promise<readonly string[]>;
  /** Applies pending migrations to the persisted local D1; resolves to the IDs applied. */
  migrate(appDir: string): Promise<readonly string[]>;
  freePort(): Promise<number>;
  /** Starts Wrangler and resolves once it accepts requests. */
  startWorker(options: { readonly appDir: string; readonly args: readonly string[]; readonly port: number; readonly io: CliIo }): Promise<WorkerProcess>;
  startClient(options: { readonly appDir: string; readonly root: string; readonly port: number; readonly apiTarget: string; readonly cacheDir: string }): Promise<ClientServer>;
  /** Resolves when the owner asks `dev` to stop (Ctrl-C). */
  stopRequested(): Promise<void>;
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

    const clientPort = await deps.freePort();
    const workerPort = await deps.freePort();
    const inspectorPort = await deps.freePort();
    const origin = `http://localhost:${String(clientPort)}`;
    const worker = await deps.startWorker({ appDir, port: workerPort, io, args: wranglerDevArgs({ appDir, port: workerPort, inspectorPort, publicOrigin: origin }) });
    let client: ClientServer;
    try {
      client = await deps.startClient({ appDir, root: clientRoot(appDir), port: clientPort, apiTarget: `http://${LOOPBACK}:${String(workerPort)}`, cacheDir: devPaths(appDir).viteCache });
    } catch (error) {
      await worker.stop();
      throw error;
    }
    io.stdout(`\n  ${app} is running at ${origin}/  (client and /api; Ctrl-C stops)\n\n`);

    const outcome = await Promise.race([deps.stopRequested().then(() => ({ kind: "stop" as const })), worker.exited.then((status) => ({ kind: "exited" as const, status }))]);
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
