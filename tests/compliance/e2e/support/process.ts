/**
 * Processes for the E2E scenarios: the framework CLI, `dev` servers of app copies, and plain
 * commands. Output is captured, never echoed with secret values (CLI-REQ-004: the CLI prints
 * none; values reach commands only on standard input).
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../../harness/index.js";
import { devOrigin } from "../../harness/node-deps.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const REFERENCE_DIR = join(REPO_ROOT, "apps", "reference");
export const TEMPLATE_DIR = join(REPO_ROOT, "apps", "template");
/** The framework CLI of this repository, run with `node` (never `npx`, which may fetch a package). */
export const FRAMEWORK_CLI = join(REPO_ROOT, "packages", "framework", "bin", "prototype-framework.js");

export interface RunResult {
  readonly status: number;
  readonly output: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Written to standard input, then closed (secret values go only here). */
  readonly input?: string;
  /** Bound for the whole command; it is killed after this. */
  readonly timeoutMs: number;
}

export function run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: { ...(options.env ?? process.env) }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      output += `\n[e2e] ${command} killed after ${String(options.timeoutMs)} ms\n`;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ status: 127, output: `${output}${error.message}\n` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ status: code ?? 1, output });
    });
    child.stdin.end(options.input ?? "");
  });
}

/** Runs the framework CLI in `appDir`. */
export function frameworkCli(appDir: string, args: readonly string[], options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly input?: string; readonly timeoutMs: number }): Promise<RunResult> {
  return run(process.execPath, [FRAMEWORK_CLI, ...args], { cwd: appDir, ...options });
}

/** The tail of a command's output for an assertion message (never contains secret values: see above). */
export function tail(output: string, chars = 3000): string {
  return output.length > chars ? `…${output.slice(-chars)}` : output;
}

export interface DevServer {
  readonly origin: string;
  output(): string;
  /** Stops `dev` (Ctrl-C, then SIGKILL after a bound) and resolves to its output. */
  stop(): Promise<string>;
}

const DEV_START_MS = 180_000;
const DEV_STOP_MS = 20_000;

/** Starts `dev` in `appDir` and resolves once it prints its origin (cli.md `dev`). */
export async function startDev(appDir: string, options: { readonly command?: readonly string[]; readonly env?: Readonly<Record<string, string | undefined>> } = {}): Promise<DevServer> {
  const [command = process.execPath, ...args] = options.command ?? [process.execPath, FRAMEWORK_CLI, "dev"];
  const child = spawn(command, args, { cwd: appDir, env: { ...(options.env ?? process.env) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  let exited: number | null | undefined;
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  const closed = new Promise<void>((r) => child.on("close", (code) => ((exited = code), r())));
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name);
    } catch {
      // already gone
    }
  };
  const stop = async (): Promise<string> => {
    if (exited === undefined) {
      signal("SIGINT");
      const timer = setTimeout(() => signal("SIGKILL"), DEV_STOP_MS);
      await closed;
      clearTimeout(timer);
    }
    return output;
  };
  try {
    const origin = await waitFor(
      () => {
        if (exited !== undefined) return Promise.reject(new Error(`dev exited with status ${String(exited)} before serving:\n${tail(output, 2000)}`));
        return Promise.resolve(devOrigin(output));
      },
      { what: `dev in ${appDir}`, timeoutMs: DEV_START_MS, intervalMs: 500 },
    );
    return { origin, output: () => output, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
