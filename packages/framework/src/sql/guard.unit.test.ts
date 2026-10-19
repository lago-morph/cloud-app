import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { createGuard, normalizeError } from "./guard.js";

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

  it("any other driver error is a CORE.INTERNAL FrameworkError, never the driver's own error", async () => {
    const driver = new Error("near \"selec\": syntax error");
    const e = normalizeError(wrapped(driver));
    expect(e).toBeInstanceOf(FrameworkError);
    expect(e.code).toBe("CORE.INTERNAL");
    expect(e.message).toContain("syntax error");
    await expect(createGuard()(() => Promise.reject(driver))).rejects.toMatchObject({ code: "CORE.INTERNAL" });
  });
});
