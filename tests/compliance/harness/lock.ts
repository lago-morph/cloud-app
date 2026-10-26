/**
 * A cross-process lock: a directory `c-t1-<name>.lock` under `deps.dir` holding `owner.json`
 * (the owner's pid, process start time, run id and a unique token).
 *
 * - Created atomically: a temp directory with the owner file inside is renamed into place, so a
 *   lock never exists without its owner (a crash leaves at most a temp directory, which blocks
 *   nobody).
 * - Stale when the owner's pid is gone, or runs with a different start time (the pid was
 *   recycled), or when the pid's process started after the lock's mtime (also the pid was
 *   recycled; this covers a legacy `pid`-only lock and an owner whose start was not recorded).
 *   A lock with no readable owner (an older harness copy's, or a crashed one) is stale
 *   once its mtime is older than `OWNERLESS_STALE_MS`; an older copy's `pid` file is honoured
 *   while that pid runs.
 * - Taken over by renaming the stale lock to a unique name first, then deleting it: of several
 *   waiters only one rename succeeds. If what was moved is not the lock judged stale (a new owner
 *   created its lock in between), it is put back; if that fails too (a third waiter created one
 *   meanwhile), it is left aside and logged, never deleted.
 * - Released only by its owner (the token must still match).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OWNER_FILE = "owner.json";
/** The file an older copy of the harness writes (and reads) in its lock directory. */
const LEGACY_PID_FILE = "pid";
/** How old a lock with no readable owner must be before it is stale. */
export const OWNERLESS_STALE_MS = 30_000;
const POLL_MS = 500;
/**
 * How much later than the lock's mtime its pid's process may seem to have started before the pid
 * counts as reused: the boot time in /proc/stat has one-second resolution and `ps -o lstart` too.
 */
export const STARTED_AFTER_SLACK_MS = 2_000;

export interface LockOwner {
  readonly pid: number;
  /** The owner process's start time (`processStartTime`), or null when it could not be read. */
  readonly start: string | null;
  readonly runId: string | null;
  readonly token: string;
}

export interface LockDeps {
  /** Where the lock directories live. */
  readonly dir: string;
  /** The run id recorded in the owner file. */
  readonly runId?: string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Whether a pid runs (default: `process.kill(pid, 0)`). */
  isAlive?(pid: number): boolean;
  /** A pid's start time (default: `processStartTime`). */
  startTime?(pid: number): string | null;
  /** A pid's start as wall-clock ms (default: `processStartedAtMs`). */
  startedAtMs?(pid: number): number | null;
  /** The real clock that lock mtimes are compared with (default: `Date.now`). */
  wallNow?(): number;
}

export type LockState =
  | { readonly state: "absent" }
  | { readonly state: "live"; readonly holder: string }
  | { readonly state: "stale"; readonly reason: string; readonly key: string };

export function lockPath(dir: string, name: string): string {
  return join(dir, `c-t1-${name}.lock`);
}

/** Field 22 (`starttime`) of a `/proc/<pid>/stat` line; the command name (field 2) may hold spaces and parentheses. */
export function parseProcStatStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat.slice(close + 1).trim().split(/\s+/); // fields[0] is field 3
  const value = fields[22 - 3];
  return value !== undefined && /^\d+$/.test(value) ? value : null;
}

/** A pid's start time: `/proc/<pid>/stat` field 22 where /proc exists, else `ps -o lstart=`; null when unknown or gone. */
export function processStartTime(pid: number): string | null {
  if (existsSync("/proc/self/stat")) {
    try {
      return parseProcStatStartTime(readFileSync(`/proc/${String(pid)}/stat`, "utf8"));
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

let clockTicks: number | undefined;
let bootMs: number | null | undefined;

/** A pid's start as wall-clock ms: /proc boot time plus field 22 in clock ticks, else `ps -o lstart=`; null when unknown or gone. */
export function processStartedAtMs(pid: number): number | null {
  if (existsSync("/proc/self/stat")) {
    if (bootMs === undefined) {
      const btime = /^btime\s+(\d+)$/m.exec(readFileSyncOr("/proc/stat"))?.[1];
      bootMs = btime === undefined ? null : Number(btime) * 1000;
    }
    if (clockTicks === undefined) {
      try {
        clockTicks = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim()) || 100;
      } catch {
        clockTicks = 100;
      }
    }
    const ticks = processStartTime(pid);
    return ticks === null || bootMs === null ? null : bootMs + (Number(ticks) * 1000) / clockTicks;
  }
  const started = processStartTime(pid);
  const ms = started === null ? Number.NaN : Date.parse(started);
  return Number.isNaN(ms) ? null : ms;
}

function readFileSyncOr(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const v = JSON.parse(readFileSync(join(path, OWNER_FILE), "utf8")) as Partial<LockOwner>;
    if (typeof v.pid !== "number" || !Number.isInteger(v.pid) || v.pid <= 0 || typeof v.token !== "string") return null;
    return { pid: v.pid, start: typeof v.start === "string" ? v.start : null, runId: typeof v.runId === "string" ? v.runId : null, token: v.token };
  } catch {
    return null;
  }
}

function readLegacyPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(join(path, LEGACY_PID_FILE), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Whether the lock at `path` is absent, held by a live owner, or stale (and why). */
export function inspectLock(path: string, deps: Pick<LockDeps, "isAlive" | "startTime" | "startedAtMs" | "wallNow">): LockState {
  const alive = deps.isAlive ?? pidAlive;
  const startOf = deps.startTime ?? processStartTime;
  const startedAt = deps.startedAtMs ?? processStartedAtMs;
  /** Why `pid` is not the lock's writer: its process started after the lock was written. */
  const reusedSince = (pid: number): string | null => {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return null;
    }
    const started = startedAt(pid);
    return started !== null && started > mtimeMs + STARTED_AFTER_SLACK_MS ? `pid ${String(pid)} started after the lock was written (${new Date(started).toISOString()} > ${new Date(mtimeMs).toISOString()})` : null;
  };
  const owner = readOwner(path);
  if (owner !== null) {
    const holder = `held by pid ${String(owner.pid)}, run ${owner.runId ?? "?"}`;
    if (!alive(owner.pid)) return { state: "stale", reason: `pid ${String(owner.pid)} is gone`, key: owner.token };
    if (owner.start !== null) {
      const now = startOf(owner.pid);
      if (now !== null && now !== owner.start) return { state: "stale", reason: `pid ${String(owner.pid)} was recycled (start ${owner.start}, now ${now})`, key: owner.token };
    }
    const reused = reusedSince(owner.pid);
    if (reused !== null) return { state: "stale", reason: reused, key: owner.token };
    return { state: "live", holder };
  }
  const legacy = readLegacyPid(path);
  if (legacy !== null) {
    if (!alive(legacy)) return { state: "stale", reason: `pid ${String(legacy)} is gone`, key: `legacy:${String(legacy)}` };
    const reused = reusedSince(legacy);
    return reused === null ? { state: "live", holder: `held by pid ${String(legacy)} (older harness)` } : { state: "stale", reason: reused, key: `legacy:${String(legacy)}` };
  }
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { state: "absent" };
    throw error;
  }
  const age = (deps.wallNow ?? Date.now)() - mtimeMs;
  return age > OWNERLESS_STALE_MS ? { state: "stale", reason: `no owner for ${String(Math.round(age / 1000))} s`, key: "ownerless" } : { state: "live", holder: "no owner yet" };
}

function lockKey(path: string): string | null {
  const owner = readOwner(path);
  if (owner !== null) return owner.token;
  const legacy = readLegacyPid(path);
  return legacy !== null ? `legacy:${String(legacy)}` : "ownerless";
}

/**
 * Takes over the stale lock `seen` describes: renames it to a unique name, then deletes it. When
 * the rename finds nothing, another waiter took it over; when what it moved is a different lock
 * (created after `seen` was read), it puts that lock back.
 */
export interface TakeOverOptions {
  /** Told when a moved lock could not be put back and is left aside (default: console.warn). */
  readonly log?: (line: string) => void;
  /** Test hook: runs right after the lock was moved aside. */
  readonly afterMoveAside?: () => void;
}

export function takeOverStale(path: string, seen: Extract<LockState, { state: "stale" }>, options: TakeOverOptions = {}): void {
  const aside = `${path}.stale-${String(process.pid)}-${randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  options.afterMoveAside?.();
  if (lockKey(aside) === seen.key) {
    rmSync(aside, { recursive: true, force: true });
    return;
  }
  try {
    renameSync(aside, path);
  } catch (error) {
    // Yet another lock is in place now. The moved one is not the stale lock: keep it, so nothing
    // its owner holds is deleted, and say where it is.
    (options.log ?? ((line: string) => console.warn(line)))(`c-t1 lock: ${path} was replaced by a live lock while being taken over and could not be put back (${errorCode(error) ?? String(error)}); left aside at ${aside}`);
  }
}

/** Creates the lock atomically (temp directory with the owner file, renamed into place); false when it is held. */
function tryCreate(path: string, owner: LockOwner): boolean {
  if (existsSync(path)) return false;
  const tmp = mkdtempSync(`${path}.tmp-`);
  try {
    writeFileSync(join(tmp, OWNER_FILE), JSON.stringify(owner));
    writeFileSync(join(tmp, LEGACY_PID_FILE), String(owner.pid));
    renameSync(tmp, path);
    return true;
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    const code = errorCode(error);
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EISDIR" || code === "EPERM") return false;
    throw error;
  }
}

let ownStart: string | null | undefined;

function ownStartTime(deps: LockDeps): string | null {
  if (deps.startTime !== undefined) return deps.startTime(process.pid);
  ownStart ??= processStartTime(process.pid);
  return ownStart;
}

/** Waits up to `timeoutMs` for the lock `name`; resolves to its release. */
export async function acquireDirLock(name: string, deps: LockDeps, timeoutMs: number): Promise<() => Promise<void>> {
  const path = lockPath(deps.dir, name);
  const owner: LockOwner = { pid: process.pid, start: ownStartTime(deps), runId: deps.runId ?? null, token: randomUUID() };
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (tryCreate(path, owner)) {
      let released = false;
      return () => {
        if (!released && readOwner(path)?.token === owner.token) {
          const aside = `${path}.released-${owner.token}`;
          try {
            renameSync(path, aside);
            rmSync(aside, { recursive: true, force: true });
          } catch {
            // already gone
          }
        }
        released = true;
        return Promise.resolve();
      };
    }
    const seen = inspectLock(path, deps);
    if (seen.state === "absent") continue;
    if (seen.state === "stale") {
      takeOverStale(path, seen);
      continue;
    }
    if (deps.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for the ${name} lock (${seen.holder})`);
    await deps.sleep(POLL_MS);
  }
}
