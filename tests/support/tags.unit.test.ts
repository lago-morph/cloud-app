import { describe, expect, it } from "vitest";
import { parseTags, tag, TAG_PATTERN } from "./tags.js";

describe("tag", () => {
  it("prefixes one ID in brackets", () => {
    expect(tag("KV-AC-001", "put, overwrite, get")).toBe("[KV-AC-001] put, overwrite, get");
  });

  it("prefixes several IDs in the order given", () => {
    expect(tag(["SQL-AC-003", "KV-AC-004"], "shared cases")).toBe("[SQL-AC-003][KV-AC-004] shared cases");
  });

  it("accepts scenario IDs", () => {
    expect(tag("E2E-011", "log lookup")).toBe("[E2E-011] log lookup");
  });

  it.each([["KV-001"], ["kv-AC-001"], ["KV-AC-1"], ["KV-AC-0001"], ["E2E-01"], ["[KV-AC-001]"], [""]])(
    "rejects the malformed ID %j",
    (bad) => {
      expect(() => tag(bad, "x")).toThrow(/test tag/);
    },
  );

  it("rejects an empty ID list", () => {
    expect(() => tag([], "x")).toThrow(/at least one/);
  });

  it("rejects an empty title", () => {
    expect(() => tag("KV-AC-001", "  ")).toThrow(/title/);
  });
});

describe("parseTags", () => {
  it("returns the IDs the traceability regex finds, in order", () => {
    expect(parseTags("[SQL-AC-003][KV-AC-004] shared cases")).toEqual(["SQL-AC-003", "KV-AC-004"]);
  });

  it("round-trips tag()", () => {
    expect(parseTags(tag(["CORE-AC-004", "E2E-016"], "scan"))).toEqual(["CORE-AC-004", "E2E-016"]);
  });

  it("finds nothing in an untagged title", () => {
    expect(parseTags("helper builds a key")).toEqual([]);
  });

  it("uses exactly the plan §10.3 regex", () => {
    expect(TAG_PATTERN.source).toBe(String.raw`\[((?:[A-Z]+-AC|E2E)-\d{3})\]`);
  });
});
