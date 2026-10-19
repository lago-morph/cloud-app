/**
 * The list cursor (KV-REQ-003, kv.md §2): opaque, encodes the prefix and the last key returned,
 * and is valid only for its prefix.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof FrameworkError ? error.code : `not a FrameworkError: ${String(error)}`;
  }
}

describe("cursor", () => {
  it("round-trips the last key for the same prefix, including non-ASCII and maximum-length keys", () => {
    for (const [prefix, last] of [["one/", "one/1"], ["", "anything"], ["k:", "k:😀é"], ["m", `m${"x".repeat(1023)}`]] as const) {
      const cursor = encodeCursor(prefix, last);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(cursor, prefix)).toBe(last);
    }
  });

  it(tag("KV-AC-003", "a cursor used with a different prefix is rejected with KV.INVALID_CURSOR"), () => {
    const cursor = encodeCursor("one/", "one/1");
    for (const prefix of ["two/", "one", "one/0", "", "One/"]) expect(codeOf(() => decodeCursor(cursor, prefix))).toBe("KV.INVALID_CURSOR");
  });

  it(tag("KV-AC-003", "a malformed or altered cursor is rejected with KV.INVALID_CURSOR"), () => {
    const cursor = encodeCursor("one/", "one/1");
    const bad = ["", "not-a-cursor", "not a cursor", `${cursor}x`, `${cursor}xy`, `${cursor}=`, cursor.slice(0, -1), "e30", 42 as unknown as string];
    for (const c of bad) expect(codeOf(() => decodeCursor(c, "one/"))).toBe("KV.INVALID_CURSOR");
  });

  it("a cursor whose last key is outside its prefix or not a valid key is rejected", () => {
    expect(codeOf(() => decodeCursor(encodeCursor("one/", "two/1"), "one/"))).toBe("KV.INVALID_CURSOR");
    expect(codeOf(() => decodeCursor(encodeCursor("", ""), ""))).toBe("KV.INVALID_CURSOR");
  });
});
