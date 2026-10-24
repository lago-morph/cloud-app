import { describe, expect, it } from "vitest";
import { toJsNumber } from "./expressions.js";

describe("aggregate normalisation (sql.md §2.2)", () => {
  it("converts Postgres numeric and bigint strings to JS numbers", () => {
    expect(toJsNumber("22")).toBe(22);
    expect(toJsNumber("5.5000000000000000")).toBe(5.5);
    expect(toJsNumber(7n)).toBe(7);
    expect(toJsNumber(1.25)).toBe(1.25);
  });

  it("rejects an unsafe integer with SQL.INVALID_VALUE", () => {
    expect(() => toJsNumber("9007199254740993")).toThrow(expect.objectContaining({ code: "SQL.INVALID_VALUE" }));
    expect(() => toJsNumber(2n ** 60n)).toThrow(expect.objectContaining({ code: "SQL.INVALID_VALUE" }));
  });
});
