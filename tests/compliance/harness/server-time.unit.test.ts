import { describe, expect, it } from "vitest";
import { inWindow, serverWindow, timed } from "./server-time.js";

describe("serverWindow", () => {
  it("spans D − duration − 1 s to D + 1 s on the server's clock, whatever this machine's clock says", () => {
    const w = serverWindow("Sun, 25 Oct 2026 12:00:10 GMT", 2_500, Date.parse("2026-10-25T13:30:00Z"));
    expect(w.from.toISOString()).toBe("2026-10-25T12:00:06.500Z");
    expect(w.to.toISOString()).toBe("2026-10-25T12:00:11.000Z");
  });

  it("covers an entry written in the second the Date header truncates", () => {
    const w = serverWindow("Sun, 25 Oct 2026 12:00:10 GMT", 40, 0);
    expect(inWindow("2026-10-25T12:00:10.999Z", w)).toBe(true);
    expect(inWindow("2026-10-25T12:00:08.900Z", w)).toBe(false);
    expect(inWindow("2026-10-25T12:00:11.001Z", w)).toBe(false);
    expect(inWindow("not a time", w)).toBe(false);
  });

  it("falls back to the arrival time when there is no usable Date header", () => {
    const at = Date.parse("2026-10-25T12:00:00Z");
    for (const date of [undefined, null, "garbage"]) {
      const w = serverWindow(date, 1_000, at);
      expect([w.from.toISOString(), w.to.toISOString()]).toEqual(["2026-10-25T11:59:58.000Z", "2026-10-25T12:00:01.000Z"]);
    }
  });
});

describe("timed", () => {
  it("returns the response with the window from its Date header and measured duration", async () => {
    const { response, window } = await timed(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { headers: new Headers({ date: "Sun, 25 Oct 2026 12:00:10 GMT" }), ok: true };
    });
    expect(response.ok).toBe(true);
    expect(window.to.toISOString()).toBe("2026-10-25T12:00:11.000Z");
    const span = window.to.getTime() - window.from.getTime();
    expect(span).toBeGreaterThanOrEqual(2_040);
    expect(span).toBeLessThan(3_000);
  });
});
