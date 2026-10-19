import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { createDeployment } from "../core/identity.js";
import type { LogEntry } from "./entry.js";
import { failingSink, neverCompletingSink } from "./test-sinks.js";
import { createLogWriter } from "./writer.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });
const now = () => new Date("2026-10-19T08:09:10.123Z");

describe("createLogWriter", () => {
  it("passes each built entry to the sink, in order", () => {
    const seen: LogEntry[] = [];
    const log = createLogWriter({ deployment, requestId: "r-1", now }, (entry) => void seen.push(entry));
    log.write("notes", "info", "one");
    log.write("SQL", "error", "two");
    expect(seen.map((e) => [e.component, e.severity, e.message, e.requestId])).toEqual([
      ["notes", "info", "one", "r-1"],
      ["SQL", "error", "two", "r-1"],
    ]);
  });

  it(tag("LOG-AC-001", "never throws when the sink throws"), () => {
    const log = createLogWriter({ deployment, now }, failingSink());
    expect(() => log.write("notes", "info", "x")).not.toThrow();
  });

  it(tag("LOG-AC-001", "never throws, and leaves no unhandled rejection, when the sink rejects"), async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const log = createLogWriter({ deployment, now }, failingSink("reject"));
      expect(() => log.write("notes", "info", "x")).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("never throws when building the entry fails", () => {
    const log = createLogWriter({ deployment, now: () => new Date(Number.NaN) }, () => undefined);
    expect(() => log.write("notes", "info", "x")).not.toThrow();
  });

  it(tag("LOG-AC-001", "returns at once when the sink never completes"), () => {
    const log = createLogWriter({ deployment, now }, neverCompletingSink());
    const started = performance.now();
    for (let i = 0; i < 100; i += 1) log.write("notes", "info", `entry ${i}`);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("test sinks", () => {
  it("failingSink throws, or rejects, every time", async () => {
    const entry = { time: "", app: "", stage: "", target: "local", component: "", severity: "info", message: "" } as const;
    expect(() => failingSink()(entry)).toThrow(/injected log writer failure/);
    await expect(Promise.resolve(failingSink("reject")(entry))).rejects.toThrow(/injected log writer failure/);
  });

  it("neverCompletingSink returns a promise that never settles", async () => {
    const entry = { time: "", app: "", stage: "", target: "local", component: "", severity: "info", message: "" } as const;
    const settled = await Promise.race([Promise.resolve(neverCompletingSink()(entry)).then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
    expect(settled).toBe("pending");
  });
});
