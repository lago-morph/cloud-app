import { describe, expect, it } from "vitest";
import { deferredCheck } from "./deferred.js";
import { FrameworkError } from "./errors.js";

describe("deferredCheck", () => {
  it("runs nothing when created, runs the check on first use and remembers a success", () => {
    let runs = 0;
    const check = deferredCheck(() => {
      runs += 1;
      return "bound";
    });
    expect(runs).toBe(0);
    expect(check()).toBe("bound");
    expect(check()).toBe("bound");
    expect(runs).toBe(1);
  });

  it("turns a failing check into CORE.MISCONFIGURED, keeping the message, and retries next time", () => {
    let runs = 0;
    const check = deferredCheck(() => {
      runs += 1;
      throw new Error("binding FILES is missing");
    });
    for (let i = 0; i < 2; i += 1) {
      const err = (() => {
        try {
          check();
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(FrameworkError);
      expect((err as FrameworkError).code).toBe("CORE.MISCONFIGURED");
      expect((err as FrameworkError).message).toBe("binding FILES is missing");
    }
    expect(runs).toBe(2);
  });

  it("passes a FrameworkError from the check through unchanged", () => {
    const original = new FrameworkError("SEC.MISSING", "x");
    const check = deferredCheck(() => {
      throw original;
    });
    expect(() => check()).toThrow(original);
  });
});
