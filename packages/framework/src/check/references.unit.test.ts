import { describe, expect, it } from "vitest";
import { RULE_NAMES } from "./rule-names.js";
import { REFERENCE_FILES, referenceFor } from "./references.js";

describe("[CHECK-AC-003] skill reference names (CHECK-REQ-003)", () => {
  it("every portability rule maps to one of the fixed reference files", () => {
    for (const rule of RULE_NAMES) {
      const ref = referenceFor(`prototype-framework/${rule}`);
      expect(REFERENCE_FILES.map((f) => `skill/reference/${f}`)).toContain(ref);
    }
  });

  it("covers the skill.md §2 topics, one file each", () => {
    expect(REFERENCE_FILES).toEqual([
      "http-and-validation.md",
      "sql-and-migrations.md",
      "kv.md",
      "files.md",
      "secrets.md",
      "configuration.md",
      "current-user.md",
      "log.md",
      "local-development.md",
      "deploying.md",
      "testing.md",
      "troubleshooting.md",
      "owner-tasks.md",
    ]);
  });

  it("SQL rules point to the SQL reference; type escapes and unknown rules to troubleshooting", () => {
    expect(referenceFor("prototype-framework/no-raw-sql")).toBe("skill/reference/sql-and-migrations.md");
    expect(referenceFor("@typescript-eslint/no-explicit-any")).toBe("skill/reference/troubleshooting.md");
    expect(referenceFor("something-else")).toBe("skill/reference/troubleshooting.md");
  });
});
