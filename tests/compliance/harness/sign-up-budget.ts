/**
 * The sign-up budget of a cloud stage, shared by every process of a compliance run (the Vitest
 * worker processes and the driver).
 *
 * PWD-REQ-006 limits sign-ups to PAR-259 (`<max> per <window> s`) per client IP and stage. On a
 * Cloudflare stage the client IP is set by Cloudflare, not by the test (a request that carries
 * `CF-Connecting-IP` itself gets Error 1000), so every sign-up a run sends to one stage counts
 * against one budget. `withSignUpSlot` takes one slot of that budget per sign-up: under a
 * cross-process lock it reads the stage's ledger of earlier sign-ups, waits until PAR-259's
 * window (plus a margin) has passed since the oldest one when the budget is used up, runs the
 * sign-up, and records its time once the answer is in (the server counted it no later than that).
 * The ledger lives in the OS temp directory, keyed by target and stage, so it also spans runs
 * (`prodcheck` is long-lived; a test stage is the run's own).
 *
 * `sharedOnce` creates a value once per key across processes (a lock-guarded cache file): the
 * run's one shared verified account on its test stage (criteria/pwd/support.ts).
 *
 * Everything here takes its clock, sleep and directory from `BudgetDeps`, so the unit tests run
 * offline with fakes.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RateLimit {
  readonly max: number;
  readonly windowS: number;
}

export interface BudgetDeps {
  /** Where the locks, ledgers and caches live (default: the OS temp directory). */
  readonly dir: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Whether a lock owner's process still runs (default: `process.kill(pid, 0)`). */
  isAlive?(pid: number): boolean;
  /** Told when a sign-up waits for the budget. */
  log?(line: string): void;
}

/** After the oldest sign-up's window, a margin for clock skew between this machine and the edge. */
export const SIGN_UP_SLOT_MARGIN_MS = 5_000;

/** How long a caller may wait for a lock (another test's sign-up and a full PAR-259 window fit easily). */
export const BUDGET_LOCK_TIMEOUT_MS = 45 * 60_000;

const POLL_MS = 500;

export function defaultBudgetDeps(): BudgetDeps {
  return { dir: tmpdir(), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A file-name-safe form of a key such as `cloudflare/test-abc`. */
export function budgetFileKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * A cross-process lock: a directory holding the owner's pid (mkdir is atomic). A lock whose
 * owner no longer runs is taken over. Resolves to its release.
 */
export async function fileLock(name: string, deps: BudgetDeps, timeoutMs = BUDGET_LOCK_TIMEOUT_MS): Promise<() => Promise<void>> {
  const path = join(deps.dir, `c-t1-${budgetFileKey(name)}.lock`);
  const alive = deps.isAlive ?? processAlive;
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(path);
      writeFileSync(join(path, "pid"), String(process.pid));
      let released = false;
      return () => {
        if (!released) rmSync(path, { recursive: true, force: true });
        released = true;
        return Promise.resolve();
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner = Number.NaN;
      try {
        owner = Number(readFileSync(join(path, "pid"), "utf8"));
      } catch {
        // being created
      }
      if (Number.isInteger(owner) && owner > 0 && !alive(owner)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      if (deps.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for the ${name} lock`);
      await deps.sleep(POLL_MS);
    }
  }
}

function ledgerPath(key: string, deps: BudgetDeps): string {
  return join(deps.dir, `c-t1-sign-ups-${budgetFileKey(key)}.json`);
}

/** The recorded sign-up times (ms) of `key`, oldest first; [] when there are none. */
export function signUpLedger(key: string, deps: BudgetDeps = defaultBudgetDeps()): number[] {
  try {
    const value = JSON.parse(readFileSync(ledgerPath(key, deps), "utf8")) as unknown;
    return Array.isArray(value) ? value.filter((t): t is number => typeof t === "number").sort((a, b) => a - b) : [];
  } catch {
    return [];
  }
}

function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Runs `body`, which sends one sign-up to the stage `key` names, within the stage's sign-up
 * budget `limit` (PAR-259), alone among the run's processes. Waits first while `limit.max`
 * sign-ups are recorded within the window, until the oldest one's window (plus
 * `SIGN_UP_SLOT_MARGIN_MS`) has passed. Records the sign-up whether or not `body` succeeds: a
 * request that reached the stage counts there.
 */
export async function withSignUpSlot<T>(key: string, limit: RateLimit, body: () => Promise<T>, deps: BudgetDeps = defaultBudgetDeps()): Promise<T> {
  if (!Number.isInteger(limit.max) || limit.max < 1) throw new Error(`a sign-up budget of ${String(limit.max)} has no slot`);
  const windowMs = limit.windowS * 1000 + SIGN_UP_SLOT_MARGIN_MS;
  const release = await fileLock(`sign-ups-${key}`, deps);
  try {
    for (;;) {
      const now = deps.now();
      const recent = signUpLedger(key, deps).filter((t) => t > now - windowMs);
      if (recent.length < limit.max) break;
      const oldest = recent[0] ?? now;
      const waitMs = oldest + windowMs - now;
      deps.log?.(`sign-up budget of ${key}: ${String(recent.length)} of ${String(limit.max)} used within ${String(limit.windowS)} s; waiting ${String(Math.ceil(waitMs / 1000))} s`);
      await deps.sleep(waitMs);
    }
    try {
      return await body();
    } finally {
      const now = deps.now();
      const kept = signUpLedger(key, deps).filter((t) => t > now - windowMs);
      writeAtomically(ledgerPath(key, deps), JSON.stringify([...kept, now]));
    }
  } finally {
    await release();
  }
}

/**
 * The value cached under `key`, created by `create` once across the run's processes: the first
 * caller creates it under the key's lock and writes it (JSON, mode 0600); the others wait for the
 * lock and read it. A failed `create` writes nothing, so the next caller tries again.
 */
export async function sharedOnce<T>(key: string, create: () => Promise<T>, deps: BudgetDeps = defaultBudgetDeps()): Promise<T> {
  const path = join(deps.dir, `c-t1-shared-${budgetFileKey(key)}.json`);
  const release = await fileLock(`shared-${key}`, deps);
  try {
    try {
      return (JSON.parse(readFileSync(path, "utf8")) as { value: T }).value;
    } catch {
      // not created yet
    }
    const value = await create();
    writeAtomically(path, JSON.stringify({ value }));
    return value;
  } finally {
    await release();
  }
}

/** A rate-limit parameter row's value (`<max> per <window> s per IP`) in docs/parameters/parameters.md text. */
export function rateLimitIn(parametersMd: string, id: string): RateLimit {
  const row = parametersMd.split("\n").find((line) => line.startsWith(`| ${id} |`));
  const m = /(\d+)\s+per\s+(\d+)\s*s\b/.exec(row?.split("|")[3] ?? "");
  if (m === null) throw new Error(`parameter ${id} is not of the form "<max> per <window> s" in docs/parameters/parameters.md`);
  return { max: Number(m[1]), windowS: Number(m[2]) };
}
