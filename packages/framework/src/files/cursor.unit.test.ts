import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("[FILES-AC-001] list cursors (FILES-REQ-001, like KV-REQ-003)", () => {
  it.each([["p/", "p/😀 x"], ["", "a"], ["文件/", "文件/照片.jpg"]])("a cursor for prefix %j decodes to the last name returned", (prefix, last) => {
    const cursor = encodeCursor(prefix, last);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(prefix, cursor)).toBe(last);
  });

  it("a cursor issued for another prefix is rejected with FILES.INVALID_CURSOR", () => {
    const cursor = encodeCursor("c/", "c/1");
    expect(codeOf(() => decodeCursor("d/", cursor))).toBe("FILES.INVALID_CURSOR");
    expect(codeOf(() => decodeCursor("", cursor))).toBe("FILES.INVALID_CURSOR");
  });

  it.each([
    ["not base64url", "%%%not-a-cursor%%%"],
    ["empty", ""],
    ["base64url of non-JSON", "bm90IGpzb24"],
    ["JSON of the wrong shape", btoa(JSON.stringify({ x: 1 })).replace(/=+$/, "")],
    ["a last name outside its prefix", btoa(JSON.stringify({ p: "c/", a: "d/1" })).replace(/=+$/, "")],
  ])("a cursor that is %s is rejected with FILES.INVALID_CURSOR", (_label, cursor) => {
    expect(codeOf(() => decodeCursor("c/", cursor))).toBe("FILES.INVALID_CURSOR");
  });

  it("only the issued spelling of a cursor decodes: not a re-spelled last character, not a byte order mark in front (fuzz F6)", () => {
    // Root cause 2026-10-31-T4-files-base64url-noncanonical; F6's shrunk counterexamples.
    expect(decodeCursor("a/", "eyJwIjoiYS8iLCJhIjoiYS8ifQ")).toBe("a/");
    expect(codeOf(() => decodeCursor("a/", "eyJwIjoiYS8iLCJhIjoiYS8ifR"))).toBe("FILES.INVALID_CURSOR");
    expect(codeOf(() => decodeCursor("", "77u_eyJwIjoiIiwiYSI6IiJ9"))).toBe("FILES.INVALID_CURSOR");
    expect(codeOf(() => decodeCursor("a/", "77u_eyJwIjoiYS8iLCJhIjoiYS94In0"))).toBe("FILES.INVALID_CURSOR");
  });
});
