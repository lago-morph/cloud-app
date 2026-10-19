import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { wasLogged } from "../log/failures.js";
import type { LogService } from "../log/public.js";
import { createGuard, normalizeError, PAR_210_MS } from "./guard.js";

const wrapped = (cause: unknown): Error => Object.assign(new Error("Failed query: insert into x values (?)\nparams: secret"), { cause });

describe("driver error normalisation (SQL-REQ-006)", () => {
  it("a FrameworkError passes through unchanged", () => {
    const e = new FrameworkError("SQL.INVALID_VALUE", "bad");
    expect(normalizeError(e)).toBe(e);
  });

  it("SQLite and Postgres constraint violations anywhere in the cause chain are SQL.CONFLICT", () => {
    for (const cause of [
      new Error("D1_ERROR: UNIQUE constraint failed: t.name: SQLITE_CONSTRAINT"),
      new Error("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"),
      Object.assign(new Error("duplicate key value"), { code: "23505" }),
      Object.assign(new Error("violates foreign key constraint"), { code: "23503" }),
    ]) {
      const e = normalizeError(wrapped(cause));
      expect(e.code).toBe("SQL.CONFLICT");
      expect(e.message).not.toContain("secret");
    }
  });

  it("a forced outage fails every operation with SQL.UNAVAILABLE without running it", async () => {
    let ran = false;
    const guard = createGuard({ unavailable: true });
    await expect(guard(async () => { ran = true; })).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    expect(ran).toBe(false);
  });

  it("an operation that does not settle within the budget (PAR-210) is SQL.UNAVAILABLE", async () => {
    const guard = createGuard({ budgetMs: 20 });
    await expect(guard(() => new Promise(() => {}))).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    await expect(guard(() => new Promise((r) => setTimeout(() => r("late"), 200)))).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    await expect(guard(async () => "quick")).resolves.toBe("quick");
    expect(PAR_210_MS).toBe(45_000);
  });

  it("SQL.UNAVAILABLE is logged once through logFailure (LOG-REQ-005)", async () => {
    const writes: [string, string, string][] = [];
    const log: LogService = { write: (component, severity, message) => void writes.push([component, severity, message]) };
    const guard = createGuard({ unavailable: true, log });
    const error = await guard(async () => 1).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "SQL.UNAVAILABLE" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.slice(0, 2)).toEqual(["SQL", "error"]);
    expect(wasLogged(error)).toBe(true);
  });

  it("errors of an unreachable database are SQL.UNAVAILABLE", () => {
    for (const message of ["PGlite is closed", "Attempted to use poisoned stub.", "Network connection lost.", "connect ECONNREFUSED 127.0.0.1:1"]) {
      expect(normalizeError(wrapped(new Error(message))).code, message).toBe("SQL.UNAVAILABLE");
    }
  });

  it("any other driver error is a CORE.INTERNAL FrameworkError, never the driver's own error", async () => {
    const driver = new Error("near \"selec\": syntax error");
    const e = normalizeError(wrapped(driver));
    expect(e).toBeInstanceOf(FrameworkError);
    expect(e.code).toBe("CORE.INTERNAL");
    expect(e.message).toContain("syntax error");
    await expect(createGuard()(() => Promise.reject(driver))).rejects.toMatchObject({ code: "CORE.INTERNAL" });
  });
});
