import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { sanitizeReturnTo } from "./return-to.js";

describe("returnTo sanitising", () => {
  it(tag("AUTH-AC-010", "keeps same-origin paths with query and fragment"), () => {
    for (const path of ["/", "/notes", "/notes/42?tab=files", "/a/b#c", "/x?next=//y", "/%E2%9C%93", "/a%09b", "/search?q=a%20b"]) {
      expect(sanitizeReturnTo(path)).toBe(path);
    }
  });

  it(tag("AUTH-AC-010", "replaces anything else with /"), () => {
    const unsafe = [
      undefined,
      "",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/%2F%2Fevil.example",
      "/%2f%5Cevil.example",
      "/%5C%5Cevil.example",
      "javascript:",
      "javascript:alert(1)",
      "notes",
      "\\\\evil.example",
      "/\tevil",
      "/a\nb",
      "/ok\\evil",
      "/%",
      " /notes",
    ];
    for (const value of unsafe) expect(sanitizeReturnTo(value), String(value)).toBe("/");
  });

  it(tag("AUTH-AC-010", "replaces a path whose decoded form leaves the origin once tab, LF or CR is stripped (fuzz F1)"), () => {
    // Root cause 2026-10-31-T4-return-to-decoded-tab-newline; "/%0a/" is F1's shrunk counterexample.
    for (const value of ["/%0a/", "/%09/evil.example", "/%0A/evil.example", "/%0D/evil.example", "/%09%2Fevil.example", "/%09%5Cevil.example"]) {
      expect(sanitizeReturnTo(value), value).toBe("/");
    }
  });
});
