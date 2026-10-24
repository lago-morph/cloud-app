import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, waitFor } from "./wait.js";

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; elapsed: () => number } {
  let t = 0;
  return { now: () => t, sleep: (ms) => ((t += ms), Promise.resolve()), elapsed: () => t };
}

describe("bounded waits", () => {
  it("derive their bounds from the platform behaviour they wait for", () => {
    expect(CLOUD_WAITS.databaseResumeMs).toBe(45_000); // PAR-210
    expect(CLOUD_WAITS.routeToggleMs).toBe(30_000); // DEC-0090
    expect(CLOUD_WAITS.requestMs).toBe(55_000); // PAR-270
    expect(CLOUD_WAITS.secretRolloutMs).toBe(60_000); // DEC-0092
  });

  it("returns the first defined probe result", async () => {
    const clock = fakeClock();
    let calls = 0;
    const value = await waitFor(() => Promise.resolve(++calls === 3 ? "ready" : undefined), { what: "x", timeoutMs: 10_000, intervalMs: 1000, ...clock });
    expect(value).toBe("ready");
    expect(clock.elapsed()).toBe(2000);
  });

  it("gives up at the bound, naming what it waited for and the last probe error", async () => {
    const clock = fakeClock();
    await expect(waitFor(() => Promise.reject(new Error("503 from stage")), { what: "the stage to answer", timeoutMs: 5000, intervalMs: 1000, ...clock })).rejects.toThrow(
      "timed out after 5 s waiting for the stage to answer; last probe: 503 from stage",
    );
    expect(clock.elapsed()).toBeLessThanOrEqual(5000);
  });

  it("refuses an unbounded wait", async () => {
    await expect(waitFor(() => Promise.resolve(1), { what: "x", timeoutMs: Number.POSITIVE_INFINITY })).rejects.toThrow(/bounded/);
  });
});
