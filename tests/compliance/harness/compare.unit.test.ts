import { describe, expect, it } from "vitest";
import { approxEqual, expectMultisetEqual, floatsClose, multisetDiff } from "./compare.js";

describe("PAR-280 float tolerance", () => {
  it("accepts |a − e| ≤ max(1e-12, 1e-12 × |e|) and refuses more", () => {
    expect(floatsClose(0.1 + 0.2, 0.3)).toBe(true);
    expect(floatsClose(1e-13, 0)).toBe(true);
    expect(floatsClose(2e-12, 0)).toBe(false);
    expect(floatsClose(1e6 + 1e-7, 1e6)).toBe(true); // 1e-7 ≤ 1e-6
    expect(floatsClose(1e6 + 1e-5, 1e6)).toBe(false);
    expect(floatsClose(Number.NaN, Number.NaN)).toBe(false);
  });

  it("compares nested values with the tolerance for numbers and exact equality otherwise", () => {
    expect(approxEqual({ a: 0.30000000000000004, b: ["x", null] }, { a: 0.3, b: ["x", null] })).toBe(true);
    expect(approxEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(approxEqual([1, 2], [2, 1])).toBe(false);
    expect(approxEqual("1", 1)).toBe(false);
  });
});

describe("multiset comparison of unordered results", () => {
  it("ignores order but not multiplicity", () => {
    expect(multisetDiff([{ id: 1 }, { id: 2 }, { id: 2 }], [{ id: 2 }, { id: 1 }, { id: 2 }])).toEqual({ missing: [], unexpected: [] });
    expect(multisetDiff([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }, { id: 2 }])).toEqual({ missing: [{ id: 2 }], unexpected: [] });
    expect(multisetDiff([{ id: 1 }, { id: 3 }], [{ id: 1 }])).toEqual({ missing: [], unexpected: [{ id: 3 }] });
  });

  it("uses the float tolerance inside rows", () => {
    expect(multisetDiff([{ avg: 0.1 + 0.2 }], [{ avg: 0.3 }])).toEqual({ missing: [], unexpected: [] });
  });

  it("expectMultisetEqual throws naming missing and unexpected rows", () => {
    expect(() => expectMultisetEqual([{ id: 1 }], [{ id: 1 }])).not.toThrow();
    expect(() => expectMultisetEqual([{ id: 3 }], [{ id: 1 }])).toThrow(/missing: \[\{"id":1\}\]; unexpected: \[\{"id":3\}\]/);
  });
});
