/**
 * Processes for the C-T1 criteria: the framework CLI (package binary, `npx <package>`, npm
 * scripts), scratch copies of the apps, `dev` sessions, and cross-process locks.
 *
 * Scratch copies live outside the repository (the OS temp directory), so a criterion that edits
 * an app's committed files never changes the working tree the run's evidence is recorded from
 * (COMPL-REQ-003). Their `node_modules` links to the workspace's, so the package resolves to this
 * checkout.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV } from "../../../harness/env.js";
import { acquireDirLock } from "../../../harness/lock.js";
import { BIN, FRAMEWORK_DIR, PACKAGE_NAME, REPO_ROOT } from "./repo.js";

export interface CommandResult {
  readonly command: string;
  readonly status: number | null;
  readonly output: string;
}

export interface CommandOptions {
  readonly cwd: string;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

function baseEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, CI: "1", NO_COLOR: "1", BROWSER: "none", ...extra };
}

/** Runs one process to completion (bounded); output is stdout and stderr interleaved. */
export function runCommand(file: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(file, [...args], { cwd: options.cwd, env: baseEnv(options.env), stdio: ["pipe", "pipe", "pipe"], detached: true });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
    const timer = setTimeout(() => {
      output += `\n[c-t1] timed out after ${String(options.timeoutMs ?? 300_000)} ms\n`;
      killGroup(child, "SIGKILL");
    }, options.timeoutMs ?? 300_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ command: [file, ...args].join(" "), status: 127, output: `${output}${e.message}\n` });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ command: [file, ...args].join(" "), status, output });
    });
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

export function requireBuiltFramework(): void {
  if (!existsSync(join(FRAMEWORK_DIR, "dist", "index.js"))) {
    throw new Error("packages/framework/dist is missing: build the framework first (the compliance driver does this before the tests)");
  }
}

/** The package binary run directly with Node (the form the other criteria use). */
export function cli(args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  requireBuiltFramework();
  return runCommand(process.execPath, [BIN, ...args], options);
}

/** `npx <package> <command> …` (CLI-REQ-001), resolved from the app's installed dependencies. */
export function npxCli(args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  requireBuiltFramework();
  return runCommand("npx", ["--no", PACKAGE_NAME, ...args], options);
}

/** `npm run <command> -- …`: the app's npm script of the same name (CLI-REQ-001). */
export function npmScript(script: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  requireBuiltFramework();
  return runCommand("npm", ["run", "--silent", script, ...(args.length > 0 ? ["--", ...args] : [])], options);
}

// ---------------------------------------------------------------------------------------------
// Scratch copies
// ---------------------------------------------------------------------------------------------

export interface ScratchApp {
  readonly dir: string;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(): Promise<void>;
}

/** Generated, local-state and dependency directories that a copy never takes over. */
const NOT_COPIED = new Set(["node_modules", ".framework", ".wrangler", ".logs", ".dev.vars", "test-results", "validation"]);

/**
 * Copies an app directory (committed content only: no local state, build output or `.dev.vars`)
 * into a new directory under the OS temp directory. With `git: true` the copy is also made a git
 * repository with one commit, for commands that record evidence from a clean tree (`smoke`).
 */
export async function scratchCopy(appDir: string, label: string, options: { readonly git?: boolean } = {}): Promise<ScratchApp> {
  const dir = await mkdtemp(join(tmpdir(), `c-t1-${label}-`));
  cpSync(appDir, dir, { recursive: true, filter: (src) => !NOT_COPIED.has(src.slice(appDir.length + 1).split("/")[0] ?? "") });
  await symlink(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const app: ScratchApp = {
    dir,
    read: (path) => readFile(join(dir, path), "utf8"),
    async write(path, content) {
      await writeFile(join(dir, path), content);
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
  if (options.git === true) {
    await writeFile(join(dir, ".gitignore"), ["node_modules", ".framework/", ".wrangler/", ".logs/", ".dev.vars", "test-results/", ""].join("\n"));
    const git = (args: string[]): Promise<CommandResult> => runCommand("git", args, { cwd: dir, timeoutMs: 60_000 });
    for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.name=compliance", "-c", "user.email=compliance@example.invalid", "commit", "-q", "-m", "scratch copy"]]) {
      const r = await git(args);
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in the scratch copy: ${r.output}`);
    }
  }
  return app;
}

/** Every regular file under `dir`, recursively, skipping `node_modules`. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

/** Files under `dir` whose bytes contain any of `needles`, as `path: needle label`. */
export async function filesContaining(dir: string, needles: Readonly<Record<string, string>>): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await listFiles(dir)) {
    if ((await stat(f)).size > 100_000_000) continue;
    const bytes = await readFile(f);
    for (const [label, needle] of Object.entries(needles)) if (bytes.includes(needle)) hits.push(`${f}: ${label}`);
  }
  return hits;
}

/**
 * Parses `.dev.vars` assignments (dotenv form: `NAME=value`, optionally quoted with `'`, `"` or
 * `` ` ``; `\$` reads as `$`, SEC §2 "Local").
 */
export function parseDevVars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null) continue;
    let value = m[2] ?? "";
    const q = value[0];
    if ((q === "'" || q === '"' || q === "`") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    if (q !== "'") value = value.replace(/\\\$/g, "$");
    out.set(m[1] ?? "", value);
  }
  return out;
}

export function readDevVars(appDir: string): Map<string, string> {
  try {
    return parseDevVars(readFileSync(join(appDir, ".dev.vars"), "utf8"));
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------------------------
// Locks and `dev`
// ---------------------------------------------------------------------------------------------

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A cross-process lock under the OS temp directory (harness/lock.ts: owner pid, start time and
 * run id; atomic creation; stale-lock takeover by rename). Vitest runs files in parallel
 * processes; scratch `dev` sessions and further cloud stages are serialised through it so a run
 * holds at most one of each at a time (plan "Cloud usage limits": at most two D1 databases at
 * once).
 */
export function acquireLock(name: string, timeoutMs: number): Promise<() => Promise<void>> {
  return acquireDirLock(name, { dir: tmpdir(), runId: process.env[ENV.runId] ?? null, now: () => Date.now(), sleep: delay }, timeoutMs);
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // gone
    }
  }
}

export interface DevSession {
  /** `http://localhost:<port>`, printed by `dev` (cli.md `dev`). */
  readonly baseUrl: string;
  output(): string;
  /** Stops `dev` with Ctrl-C (SIGINT); resolves to its exit status. */
  stop(): Promise<number | null>;
}

/**
 * Starts `dev` in `appDir` with the given command (default: the package binary) and resolves
 * once it prints its origin and serves the client entry page there. Holds the `dev` lock for its
 * lifetime.
 */
export async function startDev(appDir: string, command: { readonly file: string; readonly args: readonly string[] } = { file: process.execPath, args: [BIN, "dev"] }, timeoutMs = 180_000): Promise<DevSession> {
  requireBuiltFramework();
  const release = await acquireLock("dev", 15 * 60_000);
  let out = "";
  const child = spawn(command.file, [...command.args], { cwd: appDir, env: baseEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => (out += d.toString("utf8")));
  let exited: number | null | undefined;
  const closed = new Promise<void>((r) => child.on("close", (code) => ((exited = code), r())));
  const stop = async (): Promise<number | null> => {
    if (exited === undefined) {
      killGroup(child, "SIGINT");
      const timer = setTimeout(() => killGroup(child, "SIGKILL"), 20_000);
      await closed;
      clearTimeout(timer);
    }
    await release();
    return exited ?? null;
  };
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (exited !== undefined) throw new Error(`dev exited with status ${String(exited)} before serving:\n${out.slice(-3000)}`);
      if (Date.now() > deadline) throw new Error(`dev did not serve within ${String(timeoutMs)} ms:\n${out.slice(-3000)}`);
      const origin = /is running at (http:\/\/localhost:\d+)\//.exec(out)?.[1];
      if (origin !== undefined) {
        try {
          const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5_000) });
          if (page.status === 200) return { baseUrl: origin, output: () => out, stop };
        } catch {
          // not yet
        }
      }
      await delay(500);
    }
  } catch (error) {
    await stop();
    throw error;
  }
}
