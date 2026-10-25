/**
 * The stage sign-up budget and the shared cache (sign-up-budget.ts), offline: a fake clock and
 * sleep, a fresh temporary directory per test, and fake lock owners.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { budgetFileKey, fileLock, rateLimitIn, sharedOnce, SIGN_UP_SLOT_MARGIN_MS, signUpLedger, withSignUpSlot, type BudgetDeps } from "./sign-up-budget.js";

const PAR_259 = { max: 3, windowS: 300 };
const WINDOW_MS = PAR_259.windowS * 1000 + SIGN_UP_SLOT_MARGIN_MS;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake clock whose sleep advances it (and yields, so concurrent callers interleave). */
function fakeDeps(start = 1_000_000): BudgetDeps & { clock: { now: number }; slept: number[]; logs: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "sign-up-budget-unit-"));
  dirs.push(dir);
  const clock = { now: start };
  const slept: number[] = [];
  const logs: string[] = [];
  return {
    dir,
    clock,
    slept,
    logs,
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
      await new Promise((r) => setImmediate(r));
    },
    log: (line) => logs.push(line),
  };
}

describe("fileLock", () => {
  it("is exclusive until released, then free again", async () => {
    const deps = fakeDeps();
    const release = await fileLock("x", deps);
    let second = false;
    const waiting = fileLock("x", deps).then((r) => ((second = true), r));
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    expect(second, "a second caller waits while the lock is held").toBe(false);
    await release();
    const release2 = await waiting;
    expect(second).toBe(true);
    await release2();
    await (await fileLock("x", deps))();
  });

  it("takes over a lock whose owner process no longer runs", async () => {
    const deps = { ...fakeDeps(), isAlive: (pid: number) => pid === process.pid };
    const path = join(deps.dir, "c-t1-x.lock");
    mkdirSync(path);
    writeFileSync(join(path, "pid"), "4194999");
    const release = await fileLock("x", deps);
    expect(readFileSync(join(path, "pid"), "utf8")).toBe(String(process.pid));
    await release();
  });

  it("times out while a live owner holds it", async () => {
    const deps = fakeDeps();
    const release = await fileLock("x", deps);
    await expect(fileLock("x", deps, 10_000)).rejects.toThrow(/timed out after 10000 ms waiting for the x lock/);
    await release();
  });

  it("names its files after the key, safely", () => {
    expect(budgetFileKey("cloudflare/test-abc")).toBe("cloudflare_test-abc");
    expect(budgetFileKey("a b/../c")).toBe("a_b_.._c");
  });
});

describe("withSignUpSlot (PAR-259 per stage)", () => {
  it("runs the first PAR-259 sign-ups at once and records each once its answer is in", async () => {
    const deps = fakeDeps();
    for (let i = 0; i < PAR_259.max; i += 1) {
      const sent = deps.clock.now;
      await withSignUpSlot("cloudflare/test-a", PAR_259, () => ((deps.clock.now += 700), Promise.resolve("ok")), deps);
      expect(signUpLedger("cloudflare/test-a", deps).at(-1), "recorded after the answer").toBe(sent + 700);
    }
    expect(deps.slept).toEqual([]);
    expect(signUpLedger("cloudflare/test-a", deps)).toHaveLength(PAR_259.max);
  });

  it("makes the next sign-up wait until PAR-259's window (plus the margin) has passed since the oldest", async () => {
    const deps = fakeDeps();
    const times: number[] = [];
    const signUp = (): Promise<void> => (times.push(deps.clock.now), Promise.resolve());
    for (let i = 0; i < PAR_259.max; i += 1) {
      await withSignUpSlot("cloudflare/test-a", PAR_259, signUp, deps);
      deps.clock.now += 10_000;
    }
    const oldest = signUpLedger("cloudflare/test-a", deps)[0] ?? 0;
    await withSignUpSlot("cloudflare/test-a", PAR_259, signUp, deps);
    expect(times.at(-1), "the 4th is sent once the oldest's window has passed").toBe(oldest + WINDOW_MS);
    // Within any window, never more than PAR-259 sign-ups.
    for (const t of times) expect(times.filter((u) => u >= t && u < t + PAR_259.windowS * 1000).length).toBeLessThanOrEqual(PAR_259.max);
    expect(deps.logs.join("\n")).toMatch(/sign-up budget of cloudflare\/test-a: 3 of 3 used within 300 s; waiting \d+ s/);
  });

  it("serialises concurrent callers (the run's processes) and keeps every window within the budget", async () => {
    const deps = fakeDeps();
    const sentAt: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const signUp = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sentAt.push(deps.clock.now);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
    };
    await Promise.all(Array.from({ length: 7 }, () => withSignUpSlot("cloudflare/test-a", PAR_259, signUp, deps)));
    expect(maxInFlight, "one sign-up at a time").toBe(1);
    expect(sentAt).toHaveLength(7);
    for (const t of sentAt) expect(sentAt.filter((u) => u >= t && u < t + PAR_259.windowS * 1000).length).toBeLessThanOrEqual(PAR_259.max);
  });

  it("counts a sign-up that failed (it may have reached the stage), and passes the failure on", async () => {
    const deps = fakeDeps();
    await expect(withSignUpSlot("cloudflare/test-a", PAR_259, () => Promise.reject(new Error("socket hang up")), deps)).rejects.toThrow("socket hang up");
    expect(signUpLedger("cloudflare/test-a", deps)).toEqual([deps.clock.now]);
    await (await fileLock("sign-ups-cloudflare/test-a", deps))(); // and released the lock
  });

  it("keeps one budget per stage, and forgets sign-ups older than the window", async () => {
    const deps = fakeDeps();
    for (let i = 0; i < PAR_259.max; i += 1) await withSignUpSlot("cloudflare/test-a", PAR_259, () => Promise.resolve(), deps);
    await withSignUpSlot("cloudflare/prodcheck", PAR_259, () => Promise.resolve(), deps);
    expect(deps.slept, "another stage's budget is not used up").toEqual([]);
    deps.clock.now += WINDOW_MS + 1;
    await withSignUpSlot("cloudflare/test-a", PAR_259, () => Promise.resolve(), deps);
    expect(deps.slept, "the old sign-ups have left the window").toEqual([]);
    expect(signUpLedger("cloudflare/test-a", deps)).toEqual([deps.clock.now]);
  });

  it("writes its ledger readable by the owner only, and refuses a budget with no slot", async () => {
    const deps = fakeDeps();
    await withSignUpSlot("cloudflare/test-a", PAR_259, () => Promise.resolve(), deps);
    expect(statSync(join(deps.dir, "c-t1-sign-ups-cloudflare_test-a.json")).mode & 0o077).toBe(0);
    await expect(withSignUpSlot("cloudflare/test-a", { max: 0, windowS: 300 }, () => Promise.resolve(), deps)).rejects.toThrow(/no slot/);
  });
});

describe("sharedOnce (the run's one shared verified account)", () => {
  it("creates the value once for concurrent callers, and later callers read the cached copy", async () => {
    const deps = fakeDeps();
    let created = 0;
    const create = async (): Promise<{ email: string; verifyToken: string }> => {
      created += 1;
      await new Promise((r) => setImmediate(r));
      return { email: `a${String(created)}@example.test`, verifyToken: "t" };
    };
    const values = await Promise.all(Array.from({ length: 4 }, () => sharedOnce("verified-account-cloudflare/test-a/run1", create, deps)));
    expect(created).toBe(1);
    expect(new Set(values.map((v) => v.email))).toEqual(new Set(["a1@example.test"]));
    // Another process: same directory, its own create, which never runs.
    expect(await sharedOnce("verified-account-cloudflare/test-a/run1", () => Promise.reject(new Error("must not create again")), deps)).toEqual({ email: "a1@example.test", verifyToken: "t" });
    expect(statSync(join(deps.dir, "c-t1-shared-verified-account-cloudflare_test-a_run1.json")).mode & 0o077).toBe(0);
  });

  it("caches nothing when creating fails, so the next caller tries again", async () => {
    const deps = fakeDeps();
    await expect(sharedOnce("k", () => Promise.reject(new Error("verification mail never came")), deps)).rejects.toThrow("verification mail never came");
    expect(await sharedOnce("k", () => Promise.resolve(42), deps)).toBe(42);
  });

  it("keys the value: another run or stage gets its own", async () => {
    const deps = fakeDeps();
    expect(await sharedOnce("verified-account-cloudflare/test-a/run1", () => Promise.resolve("one"), deps)).toBe("one");
    expect(await sharedOnce("verified-account-cloudflare/test-a/run2", () => Promise.resolve("two"), deps)).toBe("two");
  });
});

describe("rateLimitIn", () => {
  it("reads PAR-259 and PAR-258 from docs/parameters/parameters.md", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "docs", "parameters", "parameters.md"), "utf8");
    expect(rateLimitIn(text, "PAR-259")).toEqual({ max: 3, windowS: 300 });
    expect(rateLimitIn(text, "PAR-258")).toEqual({ max: 5, windowS: 60 });
    expect(() => rateLimitIn(text, "PAR-122")).toThrow(/not of the form/);
  });
});
