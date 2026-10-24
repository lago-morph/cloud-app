/**
 * The invocation's pending log writes (log.md §2 "AWS"): `settle()` waits for every write, but
 * never longer than PAR-260, and never rejects (LOG-REQ-001).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createPendingWrites, LOG_WRITE_WAIT_MS } from "./pending.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Resolves `p`'s state without waiting for it: "pending", "resolved" or "rejected". */
async function state(p: Promise<unknown>): Promise<string> {
  let result = "pending";
  p.then(
    () => (result = "resolved"),
    () => (result = "rejected"),
  );
  await vi.advanceTimersByTimeAsync(0);
  return result;
}

const delay = (ms: number, fail = false): Promise<void> =>
  new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error("denied")) : resolve()), ms));

describe("createPendingWrites", () => {
  it("PAR-260 is 2 seconds", () => {
    expect(LOG_WRITE_WAIT_MS).toBe(2000);
  });

  it("settles at once when nothing is pending", async () => {
    expect(await state(createPendingWrites().settle())).toBe("resolved");
  });

  it("waits for every tracked write, failed ones included, and no longer", async () => {
    const pending = createPendingWrites();
    pending.track(delay(100));
    pending.track(delay(300, true));
    expect(pending.size).toBe(2);
    const settled = pending.settle();
    await vi.advanceTimersByTimeAsync(299);
    expect(await state(settled)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await state(settled)).toBe("resolved");
    expect(pending.size).toBe(0);
  });

  it(tag("LOG-AC-001", "unit (AWS): a write that never completes delays settle() by exactly PAR-260, then it resolves"), async () => {
    const pending = createPendingWrites();
    pending.track(new Promise(() => {}));
    const start = Date.now();
    let doneAt: number | undefined;
    void pending.settle().then(() => (doneAt = Date.now()));
    await vi.advanceTimersByTimeAsync(LOG_WRITE_WAIT_MS - 1);
    expect(doneAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(doneAt! - start).toBe(LOG_WRITE_WAIT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also waits for writes started while it waits, within the same bound", async () => {
    const pending = createPendingWrites();
    pending.track(delay(500).then(() => pending.track(delay(800))));
    const start = Date.now();
    let doneAt: number | undefined;
    void pending.settle().then(() => (doneAt = Date.now()));
    await vi.advanceTimersByTimeAsync(1300);
    expect(doneAt! - start).toBe(1300);
  });

  it("a late write cannot push the wait past the bound measured from the call", async () => {
    const pending = createPendingWrites();
    pending.track(delay(1500).then(() => pending.track(delay(5000))));
    const start = Date.now();
    let doneAt: number | undefined;
    void pending.settle().then(() => (doneAt = Date.now()));
    await vi.advanceTimersByTimeAsync(LOG_WRITE_WAIT_MS);
    expect(doneAt! - start).toBe(LOG_WRITE_WAIT_MS);
  });

  it("ignores a thenable whose then throws, and a custom bound applies", async () => {
    const pending = createPendingWrites({ boundMs: 50 });
    pending.track({
      then() {
        throw new Error("broken");
      },
    });
    pending.track(new Promise(() => {}));
    const settled = pending.settle();
    await vi.advanceTimersByTimeAsync(50);
    expect(await state(settled)).toBe("resolved");
  });
});
