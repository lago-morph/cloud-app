import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { DIALECT_ENV, processDialect, resolveDialect } from "./dialect.js";

describe("dialect chosen per process", () => {
  it("defaults to sqlite (Worker bundles and the local D1 test run)", () => {
    expect(resolveDialect(undefined)).toBe("sqlite");
    expect(resolveDialect("")).toBe("sqlite");
  });

  it("selects each supported dialect by name", () => {
    expect(resolveDialect("sqlite")).toBe("sqlite");
    expect(resolveDialect("postgres")).toBe("postgres");
  });

  it("rejects any other value with CORE.MISCONFIGURED naming the variable", () => {
    let err: unknown;
    try {
      resolveDialect("mysql");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FrameworkError);
    expect((err as FrameworkError).code).toBe("CORE.MISCONFIGURED");
    expect((err as FrameworkError).message).toContain(DIALECT_ENV);
    expect((err as FrameworkError).message).toContain('"mysql"');
  });

  it("processDialect reads the environment variable and stays fixed for the process", () => {
    const expected = resolveDialect(process.env[DIALECT_ENV]);
    expect(processDialect()).toBe(expected);
    const saved = process.env[DIALECT_ENV];
    process.env[DIALECT_ENV] = expected === "sqlite" ? "postgres" : "sqlite";
    try {
      expect(processDialect()).toBe(expected);
    } finally {
      if (saved === undefined) delete process.env[DIALECT_ENV];
      else process.env[DIALECT_ENV] = saved;
    }
  });
});
