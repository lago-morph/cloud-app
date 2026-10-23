import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { logFailure, wasLogged } from "./failures.js";
import { createMemorySink } from "./memory.js";
import type { LogService } from "./public.js";
import { createLogWriter } from "./writer.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });

function requestLog() {
  const memory = createMemorySink(() => undefined);
  const log = createLogWriter({ deployment, requestId: "r-1", request: { method: "GET", path: "/api/notes" } }, memory.sink);
  return { log, memory };
}

describe("logFailure (LOG-REQ-005 hook)", () => {
  it("writes one error entry with the failing component, method, path, code, and the error's name, message and stack", () => {
    const { log, memory } = requestLog();
    const error = new FrameworkError("SQL.UNAVAILABLE", "the database did not answer within 45 s");
    logFailure(log, error);
    const [entry, ...rest] = memory.entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ component: "SQL", severity: "error", requestId: "r-1" });
    const lines = entry?.message.split("\n") ?? [];
    expect(lines[0]).toBe("GET /api/notes failed with SQL.UNAVAILABLE");
    expect(lines[1]).toBe("FrameworkError: the database did not answer within 45 s");
    expect(lines.slice(2).join("\n")).toContain("failures.unit.test.ts");
  });

  it("treats a non-FrameworkError as CORE.INTERNAL", () => {
    const { log, memory } = requestLog();
    logFailure(log, new TypeError("boom"));
    expect(memory.entries()[0]).toMatchObject({ component: "CORE" });
    expect(memory.entries()[0]?.message).toMatch(/^GET \/api\/notes failed with CORE.INTERNAL\nTypeError: boom\n/);
  });

  it(tag("LOG-AC-005", "logs each failure once, however many layers report it"), () => {
    const { log, memory } = requestLog();
    const error = new FrameworkError("KV.UNAVAILABLE", "down");
    expect(wasLogged(error)).toBe(false);
    logFailure(log, error);
    logFailure(log, error);
    expect(wasLogged(error)).toBe(true);
    logFailure(log, new FrameworkError("KV.UNAVAILABLE", "down again"));
    expect(memory.entries()).toHaveLength(2);
  });

  it("outside a request, or on another LogService, names only the code", () => {
    const written: string[] = [];
    const plain: LogService = { write: (component, severity, message) => void written.push(`${component}|${severity}|${message}`) };
    logFailure(plain, new FrameworkError("FILES.UNAVAILABLE", "r2 down"));
    expect(written[0]).toMatch(/^FILES\|error\|failed with FILES.UNAVAILABLE\nFrameworkError: r2 down\n/);
  });

  it("never throws", () => {
    const broken: LogService = {
      write: () => {
        throw new Error("x");
      },
    };
    expect(() => logFailure(broken, new Error("y"))).not.toThrow();
    expect(() => logFailure(requestLog().log, "a thrown string")).not.toThrow();
  });
});
