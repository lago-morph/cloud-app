/**
 * Scratch app directories and the framework CLI, for suites that need committed migrations
 * or the local "deployment" (`dev`). Does not import the framework.
 *
 * - An app directory follows the CLI app layout (cli.md §2): `src/app.ts` holds the
 *   `defineApp` call, `config/local.json` the local values (stage-config.schema.json),
 *   `migrations/{sqlite,postgres}/` the generated migrations. Everything else is copied
 *   from `apps/template` when it is there (B-18), minus its sources, tests and state.
 * - Its `node_modules` is a symlink to the workspace's, so the app resolves the framework
 *   package (`@lago-morph/prototype-framework`) exactly as a workspace app does.
 * - Commands run as the package binary (`bin/prototype-framework.js`, CLI-REQ-001), with
 *   the app directory as the working directory.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECT_ENV } from "./dialect.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../../../../..");
export const FRAMEWORK_DIR = join(REPO_ROOT, "packages/framework");
export const FRAMEWORK_BIN = join(FRAMEWORK_DIR, "bin/prototype-framework.js");
export const TEMPLATE_DIR = join(REPO_ROOT, "apps/template");

const NOT_COPIED = new Set(["node_modules", "src", "tests", "migrations", ".wrangler", ".framework", ".logs", "dist", ".dev.vars"]);

/** Creates a scratch app directory. `files` maps app-relative paths to contents. */
export function createAppDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fw-b-t2-"));
  if (existsSync(TEMPLATE_DIR)) {
    for (const entry of readdirSync(TEMPLATE_DIR)) {
      if (NOT_COPIED.has(entry)) continue;
      cpSync(join(TEMPLATE_DIR, entry), join(dir, entry), { recursive: true });
    }
  }
  if (!existsSync(join(dir, "package.json"))) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratchapp", private: true, type: "module" }, null, 2));
  }
  if (!existsSync(join(dir, "config/local.json"))) {
    writeApp(dir, { "config/local.json": JSON.stringify({ values: {}, framework: {} }, null, 2) });
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  writeApp(dir, files);
  return dir;
}

/** Writes (or replaces) files in an app directory. */
export function writeApp(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export function removeAppDir(dir: string | undefined): void {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}

export interface CliResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

/** Runs one CLI command to completion. */
export function runCli(dir: string, args: readonly string[], timeoutMs = 300_000): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [FRAMEWORK_BIN, ...args], { cwd: dir, env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let output = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); output += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); output += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${args.join(" ")}\` did not finish within ${timeoutMs} ms\n${output}`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (status, signal) => { clearTimeout(timer); resolvePromise({ status, signal, stdout, stderr, output }); });
  });
}

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The scratch app chooses nothing per dialect; the CLI does (verify runs both).
  delete env[DIALECT_ENV];
  delete env["VITEST"];
  delete env["VITEST_POOL_ID"];
  delete env["VITEST_WORKER_ID"];
  delete env["NODE_ENV"];
  return env;
}

/** The generated migration files of one dialect, app-relative, sorted by name. */
export function migrationFiles(dir: string, dialect: "sqlite" | "postgres"): string[] {
  const root = join(dir, "migrations", dialect);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".sql") && statSync(join(root, f)).isFile())
    .sort()
    .map((f) => relative(dir, join(root, f)));
}

// ---- `dev` -------------------------------------------------------------------------

export interface DevServer {
  readonly baseUrl: string;
  readonly output: () => string;
  /** Stops `dev` (SIGINT to its process group) and waits for it to exit. */
  stop(): Promise<void>;
}

export interface DevExit {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
}

/**
 * Starts `dev` and waits until `/api/__framework/health` answers 204 on a
 * `http://localhost:<port>` URL it printed (LOCAL-REQ-004). Resolves `{ exited }` instead
 * if `dev` exits first (for example because a migration failed).
 */
export async function startDev(dir: string, timeoutMs = 180_000): Promise<{ server: DevServer } | { exited: DevExit }> {
  const child = spawn(process.execPath, [FRAMEWORK_BIN, "dev"], { cwd: dir, env: cliEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  const urls = new Set<string>();
  const collect = (d: Buffer): void => {
    output += d.toString();
    for (const m of d.toString().matchAll(/http:\/\/localhost:(\d+)/g)) urls.add(`http://localhost:${m[1]}`);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  let exit: DevExit | undefined;
  const exited = new Promise<DevExit>((r) => child.on("close", (status, signal) => { exit = { status, signal, output }; r(exit); }));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exit !== undefined) return { exited: exit };
    for (const url of urls) {
      try {
        const res = await fetch(`${url}/api/__framework/health`);
        if (res.status === 204) return { server: devServer(child, url, () => output, exited) };
      } catch {
        // not listening yet
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await stopProcess(child, exited);
  throw new Error(`dev did not become healthy within ${timeoutMs} ms\n${output}`);
}

function devServer(child: ChildProcess, baseUrl: string, output: () => string, exited: Promise<DevExit>): DevServer {
  return { baseUrl, output, stop: () => stopProcess(child, exited) };
}

async function stopProcess(child: ChildProcess, exited: Promise<DevExit>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const pid = child.pid;
  const signalGroup = (sig: NodeJS.Signals): void => { try { process.kill(-pid, sig); } catch { /* gone */ } };
  signalGroup("SIGINT");
  const done = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30_000))]);
  if (!done) {
    signalGroup("SIGKILL");
    await exited;
  }
  // `dev` stops Wrangler and Vite with it (local.md §2); make sure nothing of the group is left.
  signalGroup("SIGKILL");
}
