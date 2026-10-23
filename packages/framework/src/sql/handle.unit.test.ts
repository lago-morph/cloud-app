import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { checkResultSize, MAX_RESULT_BYTES, normalizeResult, resultSize } from "./handle.js";

describe("result size (sql.md §2.3)", () => {
  it(tag("SQL-AC-006", "counts UTF-8 bytes of text and 8 bytes per other non-NULL value, through rows and join objects"), () => {
    expect(resultSize("abc")).toBe(3);
    expect(resultSize("é")).toBe(2);
    expect(resultSize("€")).toBe(3);
    expect(resultSize("😀")).toBe(4);
    expect(resultSize("\uD800")).toBe(3);
    expect(resultSize([{ a: 1, b: true, c: null, d: "xy" }, { j: { k: 2.5, l: null } }])).toBe(8 + 8 + 2 + 8);
    expect(resultSize(undefined)).toBe(0);
  });

  it(tag("SQL-AC-006", "PAR-215 is a strict maximum"), () => {
    const at = ["a".repeat(MAX_RESULT_BYTES)];
    expect(checkResultSize(at)).toBe(at);
    expect(() => checkResultSize(["a".repeat(MAX_RESULT_BYTES + 1)])).toThrow(expect.objectContaining({ code: "SQL.RESULT_TOO_LARGE" }));
  });

  it("a driver's write result without rows becomes undefined; rows stay rows", () => {
    expect(normalizeResult({ success: true, meta: {} })).toBeUndefined();
    expect(normalizeResult({ rows: [], affectedRows: 1 })).toBeUndefined();
    const rows = [{ id: "x" }];
    expect(normalizeResult(rows)).toBe(rows);
  });
});
