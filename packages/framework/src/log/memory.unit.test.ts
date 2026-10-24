import { describe, expect, it, vi } from "vitest";
import { createDeployment } from "../core/identity.js";
import { createMemorySink } from "./memory.js";
import { createLogWriter } from "./writer.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });

describe("createMemorySink", () => {
  it("keeps entries in order and echoes only error entries", () => {
    const echoed: string[] = [];
    const memory = createMemorySink((line) => void echoed.push(line));
    const log = createLogWriter({ deployment, requestId: "r-1" }, memory.sink);
    log.write("notes", "info", "one");
    log.write("CORE", "error", "two");
    expect(memory.entries().map((e) => e.message)).toEqual(["one", "two"]);
    expect(echoed).toHaveLength(1);
    expect(JSON.parse(echoed[0] ?? "")).toEqual(memory.entries()[1]);
  });

  it("returns a snapshot that later writes do not change", () => {
    const memory = createMemorySink(() => undefined);
    const log = createLogWriter({ deployment }, memory.sink);
    log.write("notes", "info", "one");
    const before = memory.entries();
    log.write("notes", "info", "two");
    expect(before).toHaveLength(1);
    expect(Object.isFrozen(before)).toBe(true);
  });

  it("echoes to stderr by default", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const memory = createMemorySink();
      createLogWriter({ deployment }, memory.sink).write("SQL", "error", "down");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toMatch(/"severity":"error".*\n$/);
    } finally {
      spy.mockRestore();
    }
  });
});
