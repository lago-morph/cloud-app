/**
 * The cross-process directory lock (lock.ts), offline: a fresh temporary directory per test, a
 * fake clock whose sleep advances it, and fake process tables where a case needs one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireDirLock, inspectLock, lockPath, OWNER_FILE, OWNERLESS_STALE_MS, parseProcStatStartTime, processStartTime, takeOverStale, type LockDeps, type LockOwner, type LockState } from "./lock.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeDeps(extra: Partial<LockDeps> = {}): LockDeps & { clock: { now: number } } {
  const dir = mkdtempSync(join(tmpdir(), "lock-unit-"));
  dirs.push(dir);
  const clock = { now: 1_000_000 };
  return {
    dir,
    clock,
    runId: "run-unit",
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
      await new Promise((r) => setImmediate(r));
    },
    ...extra,
  };
}

function writeLock(deps: LockDeps, name: string, owner: Partial<LockOwner> | null): string {
  const path = lockPath(deps.dir, name);
  mkdirSync(path);
  if (owner !== null) writeFileSync(join(path, OWNER_FILE), JSON.stringify(owner));
  return path;
}

function staleState(path: string, deps: LockDeps): Extract<LockState, { state: "stale" }> {
  const seen = inspectLock(path, deps);
  if (seen.state !== "stale") throw new Error(`expected a stale lock, got ${seen.state}`);
  return seen;
}

function ownerOf(path: string): LockOwner {
  return JSON.parse(readFileSync(join(path, OWNER_FILE), "utf8")) as LockOwner;
}

async function ticks(n = 10): Promise<void> {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
}

/** A pid that ran and has exited (its process is gone). */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(r.stdout);
}

describe("process start time", () => {
  it("reads field 22 of /proc/<pid>/stat, also when the command name holds spaces and parentheses", () => {
    const after = Array.from({ length: 30 }, (_, i) => String(i + 3)); // fields 3…32 hold their own numbers
    after[0] = "S";
    expect(parseProcStatStartTime(`4242 (a (b) c) ${after.join(" ")}`)).toBe("22");
    expect(parseProcStatStartTime("garbage")).toBeNull();
    expect(parseProcStatStartTime("1 (x) S 1 2")).toBeNull();
  });

  it("is known and stable for this process, and unknown for a pid that is gone", () => {
    const own = processStartTime(process.pid);
    expect(own).not.toBeNull();
    expect(processStartTime(process.pid)).toBe(own);
    expect(processStartTime(deadPid())).toBeNull();
  });
});

describe("acquireDirLock", () => {
  it("creates the lock with the owner's pid, start time and run id, and leaves no temp directory", async () => {
    const deps = fakeDeps();
    const release = await acquireDirLock("x", deps, 10_000);
    const path = lockPath(deps.dir, "x");
    const owner = ownerOf(path);
    expect(owner.pid).toBe(process.pid);
    expect(owner.start).toBe(processStartTime(process.pid));
    expect(owner.runId).toBe("run-unit");
    expect(readFileSync(join(path, "pid"), "utf8"), "the legacy pid file, for older harness copies").toBe(String(process.pid));
    expect(readdirSync(deps.dir)).toEqual(["c-t1-x.lock"]);
    await release();
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(deps.dir)).toEqual([]);
  });

  it("is exclusive until released, then free again; it times out while a live owner holds it", async () => {
    const deps = fakeDeps();
    const release = await acquireDirLock("x", deps, 10_000);
    await expect(acquireDirLock("x", deps, 5_000)).rejects.toThrow(/timed out after 5000 ms waiting for the x lock \(held by pid \d+, run run-unit/);
    let second = false;
    const waiting = acquireDirLock("x", deps, 60_000).then((r) => ((second = true), r));
    await ticks();
    expect(second).toBe(false);
    await release();
    const release2 = await waiting;
    expect(second).toBe(true);
    await release2();
  });

  it("takes over a lock whose owner pid is gone", async () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", { pid: deadPid(), start: "1", runId: "old", token: "t-old" });
    const release = await acquireDirLock("x", deps, 10_000);
    expect(ownerOf(path).pid).toBe(process.pid);
    await release();
  });

  it("takes over a lock whose pid was recycled (the pid runs, but its start time differs)", async () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", { pid: process.pid, start: "not-this-process", runId: "old", token: "t-old" });
    const release = await acquireDirLock("x", deps, 10_000);
    expect(ownerOf(path).token).not.toBe("t-old");
    await release();
  });

  it("waits on an owner-less lock younger than 30 s and takes it over once it is older", async () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", null);
    expect(OWNERLESS_STALE_MS).toBe(30_000);
    await expect(acquireDirLock("x", deps, 3_000)).rejects.toThrow(/timed out/);
    expect(existsSync(join(path, OWNER_FILE))).toBe(false);
    const old = (Date.now() - OWNERLESS_STALE_MS - 5_000) / 1000;
    utimesSync(path, old, old);
    const release = await acquireDirLock("x", deps, 3_000);
    expect(ownerOf(path).pid).toBe(process.pid);
    await release();
  });

  it("treats an unreadable owner file like a missing one", async () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", null);
    writeFileSync(join(path, OWNER_FILE), "{not json");
    expect(inspectLock(path, deps).state).toBe("live");
    const old = (Date.now() - OWNERLESS_STALE_MS - 5_000) / 1000;
    utimesSync(path, old, old);
    expect(inspectLock(path, deps).state).toBe("stale");
  });

  it("honours a legacy pid-only lock while that pid runs", async () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", null);
    writeFileSync(join(path, "pid"), String(process.pid));
    const old = (Date.now() - OWNERLESS_STALE_MS - 5_000) / 1000;
    utimesSync(path, old, old);
    expect(inspectLock(path, deps).state).toBe("live");
    writeFileSync(join(path, "pid"), String(deadPid()));
    expect(inspectLock(path, deps).state).toBe("stale");
  });

  it("is not blocked by a temp directory a crash left before its rename", async () => {
    const deps = fakeDeps();
    mkdirSync(join(deps.dir, "c-t1-x.lock.tmp-crashed"));
    const release = await acquireDirLock("x", deps, 3_000);
    await release();
  });

  it("gives a stale lock to one waiter at a time when several race to take it over", async () => {
    const deps = fakeDeps();
    writeLock(deps, "x", { pid: deadPid(), start: "1", runId: "old", token: "t-old" });
    let held = 0;
    let maxHeld = 0;
    const holder = async (): Promise<void> => {
      const release = await acquireDirLock("x", deps, 60_000);
      held += 1;
      maxHeld = Math.max(maxHeld, held);
      await ticks(5);
      held -= 1;
      await release();
    };
    await Promise.all([holder(), holder(), holder(), holder()]);
    expect(maxHeld).toBe(1);
    expect(readdirSync(deps.dir)).toEqual([]);
  });

  it("release removes only its own lock", async () => {
    const deps = fakeDeps();
    const release = await acquireDirLock("x", deps, 3_000);
    const path = lockPath(deps.dir, "x");
    rmSync(path, { recursive: true });
    writeLock(deps, "x", { pid: process.pid, start: processStartTime(process.pid), runId: "other", token: "t-other" });
    await release();
    expect(ownerOf(path).token).toBe("t-other");
  });
});

describe("takeOverStale", () => {
  it("moves the stale lock aside under a unique name, then deletes it", () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", { pid: deadPid(), start: "1", runId: "old", token: "t-old" });
    const seen = staleState(path, deps);
    takeOverStale(path, seen);
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(deps.dir)).toEqual([]);
  });

  it("puts back a live lock that replaced the stale one after it was inspected", () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", { pid: deadPid(), start: "1", runId: "old", token: "t-old" });
    const seen = staleState(path, deps);
    // Another waiter takes the stale lock over and a new owner creates its lock in between.
    renameSync(path, `${path}.gone`);
    rmSync(`${path}.gone`, { recursive: true });
    writeLock(deps, "x", { pid: process.pid, start: processStartTime(process.pid), runId: "new", token: "t-new" });
    takeOverStale(path, seen);
    expect(ownerOf(path).token).toBe("t-new");
    expect(readdirSync(deps.dir)).toEqual(["c-t1-x.lock"]);
  });

  it("does nothing when another waiter already moved the stale lock", () => {
    const deps = fakeDeps();
    const path = writeLock(deps, "x", { pid: deadPid(), start: "1", runId: "old", token: "t-old" });
    const seen = staleState(path, deps);
    rmSync(path, { recursive: true });
    expect(() => takeOverStale(path, seen)).not.toThrow();
    expect(readdirSync(deps.dir)).toEqual([]);
  });
});
