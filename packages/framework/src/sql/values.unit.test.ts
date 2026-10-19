import { describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { checkValue, newId, now } from "./values.js";

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected a FrameworkError");
}

function rejects(kind: Parameters<typeof checkValue>[0], value: unknown): void {
  const err = failure(() => checkValue(kind, value, "notes.x"));
  expect(err.code).toBe("SQL.INVALID_VALUE");
  expect(err.message).toContain("notes.x");
}

describe("integer(): signed 32-bit integral number", () => {
  it.each([0, 1, -1, 2147483647, -2147483648])(tag("SQL-AC-004", "accepts %d"), (v) => {
    expect(checkValue("integer", v, "notes.x")).toBe(v);
  });
  it.each([2147483648, -2147483649, 1.5, Number.NaN, Infinity, "1", 1n, true])(tag("SQL-AC-004", "rejects %s"), (v) => {
    rejects("integer", v);
  });
  it("stores negative zero as zero", () => {
    expect(Object.is(checkValue("integer", -0, "notes.x"), 0)).toBe(true);
  });
});

describe("number(): finite double, negative zero stored as zero", () => {
  it.each([0, 1.5, -1e308, Number.MAX_VALUE, Number.MIN_VALUE, 2 ** 60])(tag("SQL-AC-004", "accepts %d"), (v) => {
    expect(checkValue("number", v, "notes.x")).toBe(v);
  });
  it.each([Number.NaN, Infinity, -Infinity, "1.5", 1n, null])(tag("SQL-AC-004", "rejects %s"), (v) => {
    rejects("number", v);
  });
  it(tag("SQL-AC-004", "stores negative zero as zero"), () => {
    expect(Object.is(checkValue("number", -0, "notes.x"), 0)).toBe(true);
  });
});

describe("timestamp(): non-negative safe integer, epoch milliseconds", () => {
  it.each([0, 1_700_000_000_000, Number.MAX_SAFE_INTEGER])(tag("SQL-AC-004", "accepts %d"), (v) => {
    expect(checkValue("timestamp", v, "notes.x")).toBe(v);
  });
  it.each([-1, Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN, Infinity, "0", 0n])(tag("SQL-AC-004", "rejects %s"), (v) => {
    rejects("timestamp", v);
  });
  it("stores negative zero as zero", () => {
    expect(Object.is(checkValue("timestamp", -0, "notes.x"), 0)).toBe(true);
  });
});

describe("text(): well-formed Unicode, no NUL", () => {
  it.each(["", "plain", "Ünïcödé", "emoji 😀", "\u{10FFFF}", "tab\tnewline\n", "%_\\"])(tag("SQL-AC-004", "accepts %j"), (v) => {
    expect(checkValue("text", v, "notes.x")).toBe(v);
  });
  it.each([
    ["a lone high surrogate", "a\uD800b"],
    ["a lone low surrogate", "a\uDC00"],
    ["reversed surrogates", "\uDE00\uD83D"],
    ["NUL", "a\u0000b"],
    ["a number", 1],
    ["null", null],
  ])(tag("SQL-AC-004", "rejects %s"), (_what, v) => {
    rejects("text", v);
  });
});

describe("id() and ref(): UUID v4 text as newId() makes", () => {
  const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it.each(["id", "ref"] as const)(tag("SQL-AC-004", "%s accepts a lowercase UUID v4"), (kind) => {
    expect(checkValue(kind, uuid, "notes.x")).toBe(uuid);
  });
  it.each(["id", "ref"] as const)(tag("SQL-AC-004", "%s rejects other text"), (kind) => {
    rejects(kind, "abc");
    rejects(kind, uuid.toUpperCase());
    rejects(kind, "0f8fad5b-d9cb-169f-a165-70867728950e"); // version 1
    rejects(kind, "0f8fad5b-d9cb-469f-c165-70867728950e"); // wrong variant
    rejects(kind, 42);
  });
});

describe("newId() and now()", () => {
  it("newId returns distinct values that satisfy the id() rule", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(checkValue("id", a, "notes.id")).toBe(a);
  });
  it("now returns the current time in epoch milliseconds, governed by fake timers", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-02T03:04:05.678Z"));
      expect(now()).toBe(Date.parse("2030-01-02T03:04:05.678Z"));
      expect(checkValue("timestamp", now(), "notes.at")).toBe(now());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boolean(): actual boolean", () => {
  it.each([true, false])(tag("SQL-AC-004", "accepts %s"), (v) => {
    expect(checkValue("boolean", v, "notes.x")).toBe(v);
  });
  it.each([0, 1, "true", null, undefined])(tag("SQL-AC-004", "rejects %s"), (v) => {
    rejects("boolean", v);
  });
});
