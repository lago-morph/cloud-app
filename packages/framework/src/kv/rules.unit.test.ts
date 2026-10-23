/**
 * KV key, prefix and value rules (KV-REQ-002): PAR-220 key bytes, PAR-223 value bytes,
 * well-formed Unicode text. Unit evidence only; the integration suite is the criterion's evidence.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { checkKey, checkPrefix, checkValue, MAX_KEY_BYTES, MAX_VALUE_BYTES } from "./rules.js";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof FrameworkError ? error.code : `not a FrameworkError: ${String(error)}`;
  }
}

describe("keys", () => {
  it(tag("KV-AC-002", "an empty key is rejected with KV.INVALID_KEY"), () => {
    expect(codeOf(() => checkKey(""))).toBe("KV.INVALID_KEY");
  });

  it(tag("KV-AC-002", "a key of exactly PAR-220 UTF-8 bytes is accepted, one byte more is rejected"), () => {
    expect(MAX_KEY_BYTES).toBe(1024);
    for (const key of ["k".repeat(1024), "é".repeat(512), "😀".repeat(256)]) expect(codeOf(() => checkKey(key))).toBeUndefined();
    for (const key of ["k".repeat(1025), `${"é".repeat(512)}k`, `${"😀".repeat(256)}k`]) expect(codeOf(() => checkKey(key))).toBe("KV.INVALID_KEY");
  });

  it(tag("KV-AC-002", "a key that is not well-formed Unicode is rejected with KV.INVALID_KEY"), () => {
    for (const key of ["\uD800", "a\uDC00", "\uDE00\uD83D", "x\uD83Dy"]) expect(codeOf(() => checkKey(key))).toBe("KV.INVALID_KEY");
  });

  it("a key that is not a string is rejected with KV.INVALID_KEY", () => {
    expect(codeOf(() => checkKey(42 as unknown as string))).toBe("KV.INVALID_KEY");
  });
});

describe("prefixes", () => {
  it(tag("KV-AC-002", "a malformed or over-long prefix is rejected with KV.INVALID_KEY"), () => {
    for (const prefix of ["\uD800", "a\uDC00", "k".repeat(1025)]) expect(codeOf(() => checkPrefix(prefix))).toBe("KV.INVALID_KEY");
    expect(codeOf(() => checkPrefix(undefined as unknown as string))).toBe("KV.INVALID_KEY");
  });

  it("the empty prefix (every key) and a prefix of PAR-220 bytes are accepted", () => {
    expect(codeOf(() => checkPrefix(""))).toBeUndefined();
    expect(codeOf(() => checkPrefix("k".repeat(1024)))).toBeUndefined();
  });
});

describe("values", () => {
  it(tag("KV-AC-002", "a value of exactly PAR-223 UTF-8 bytes is accepted, one byte more is KV.VALUE_TOO_LARGE"), () => {
    expect(MAX_VALUE_BYTES).toBe(4096);
    for (const value of ["v".repeat(4096), "é".repeat(2048), "😀".repeat(1024)]) expect(codeOf(() => checkValue(value))).toBeUndefined();
    for (const value of ["v".repeat(4097), `${"é".repeat(2048)}v`, `${"😀".repeat(1024)}v`]) expect(codeOf(() => checkValue(value))).toBe("KV.VALUE_TOO_LARGE");
  });

  it(tag("KV-AC-002", "a value that is not well-formed Unicode is rejected with KV.INVALID_KEY"), () => {
    for (const value of ["\uD800", "x\uDC00", "\uDE00\uD83D"]) expect(codeOf(() => checkValue(value))).toBe("KV.INVALID_KEY");
    expect(codeOf(() => checkValue(null as unknown as string))).toBe("KV.INVALID_KEY");
  });

  it("an empty value is accepted (KV-REQ-002 rejects only empty keys; KV-AC-002's 'empty values' conflicts)", () => {
    expect(codeOf(() => checkValue(""))).toBeUndefined();
  });
});
