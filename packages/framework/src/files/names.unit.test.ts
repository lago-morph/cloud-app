import { describe, expect, it } from "vitest";
import { checkName, checkPrefix } from "./names.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("[FILES-AC-002] file names (FILES-REQ-002)", () => {
  it.each(["a", "with space.txt", "100%.bin", "a/b/c", "notes..txt", "..x", "x..", "a/..b/c", "a/.../b", "./x", "a/.", "a/./b", ".hidden", "a/.b", ".x", "x.", "...", ".a.", "naïve.pdf", "文件/照片.jpg", "emoji-😀", "é".repeat(512)])(
    "accepts %# unchanged",
    (name) => {
      expect(checkName(name)).toBe(name);
    },
  );

  it.each([
    ["empty", ""],
    ["1,025 ASCII bytes", "a".repeat(1025)],
    ["1,026 UTF-8 bytes", "é".repeat(513)],
    ["CR", "a\rb"],
    ["LF", "a\nb"],
    ["NUL", "a\u0000b"],
    ["U+001F", "a\u001fb"],
    ["DEL", "a\u007fb"],
    ["a lone high surrogate", "a\ud800b"],
    ["a lone low surrogate", "\udc00"],
    ["exactly . (owner decision, DEC-0505)", "."],
    ["exactly .. (owner decision, DEC-0505)", ".."],
    ["a/../b (a .. segment, DEC-0533)", "a/../b"],
    ["a/.. (ends with /.., DEC-0533)", "a/.."],
    ["../x (starts with ../, DEC-0533)", "../x"],
    ["../../etc/passwd (DEC-0533)", "../../etc/passwd"],
    ["a//../b (DEC-0533)", "a//../b"],
    ["../ (DEC-0533)", "../"],
  ])("rejects a name that is %s with FILES.INVALID_NAME", (_label, name) => {
    expect(codeOf(() => checkName(name))).toBe("FILES.INVALID_NAME");
  });
});

describe("[FILES-AC-002] list prefixes", () => {
  it.each([["empty", ""], ["p/", "p/"], ["..", ".."], ["1,024 UTF-8 bytes", "é".repeat(512)]])("accepts a prefix that is %s", (_label, prefix) => {
    expect(checkPrefix(prefix)).toBe(prefix);
  });

  it.each([["oversized", "a".repeat(1025)], ["LF", "p\n"], ["NUL", "\u0000"], ["a lone surrogate", "\ud800"]])(
    "rejects a prefix that is %s with FILES.INVALID_NAME",
    (_label, prefix) => {
      expect(codeOf(() => checkPrefix(prefix))).toBe("FILES.INVALID_NAME");
    },
  );
});
