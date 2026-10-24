/**
 * Prefix listing uses a key range (kv.md §2): `key >= prefix AND key < prefixEnd(prefix)`, in
 * code point order (UTF-8 byte order in both dialects' binary/C collation).
 */
import { describe, expect, it } from "vitest";
import { prefixEnd } from "./range.js";

describe("prefixEnd", () => {
  it("increments the last code point", () => {
    expect(prefixEnd("a")).toBe("b");
    expect(prefixEnd("page/")).toBe("page0");
    expect(prefixEnd("a%")).toBe("a&");
    expect(prefixEnd("k:é")).toBe("k:ê");
  });

  it("is null (no upper bound) for the empty prefix", () => {
    expect(prefixEnd("")).toBeNull();
  });

  it("drops trailing U+10FFFF code points, which have no successor", () => {
    expect(prefixEnd("s\u{10FFFF}")).toBe("t");
    expect(prefixEnd("s\u{10FFFF}\u{10FFFF}")).toBe("t");
    expect(prefixEnd("\u{10FFFF}")).toBeNull();
  });

  it("skips the surrogate range and crosses into the supplementary planes", () => {
    expect(prefixEnd("a퟿")).toBe("a");
    expect(prefixEnd("a￿")).toBe("a\u{10000}");
    expect(prefixEnd("a😀")).toBe("a😁");
  });

  it("every key starting with the prefix sorts below the bound in code point order", () => {
    const codePointLess = (x: string, y: string): boolean => {
      const a = Array.from(x, (c) => c.codePointAt(0) ?? 0);
      const b = Array.from(y, (c) => c.codePointAt(0) ?? 0);
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
      return a.length < b.length;
    };
    for (const [prefix, key] of [["q", "q\u{10FFFF}x"], ["a￿", "a￿\u{10FFFF}"], ["s\u{10FFFF}", "s\u{10FFFF}\u{10FFFF}"]] as const) {
      const end = prefixEnd(prefix);
      expect(end).not.toBeNull();
      expect(codePointLess(key, end ?? "")).toBe(true);
    }
  });
});
