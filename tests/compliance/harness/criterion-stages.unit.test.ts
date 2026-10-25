// Criterion production stages (DEC-0560): reserved names, the account listing, what cleanup may remove. No network.
import { describe, expect, it } from "vitest";
import { CRITERION_PRODUCTION_PREFIXES, criterionStagesIn, isCleanableStage, isCriterionProductionStage, newCriterionProductionStage } from "./criterion-stages.js";

describe("criterion production stages (DEC-0560)", () => {
  it("reserves p003 and p004 with 10 random lowercase letters and digits", () => {
    expect(CRITERION_PRODUCTION_PREFIXES).toEqual(["p003", "p004"]);
    for (const prefix of CRITERION_PRODUCTION_PREFIXES) {
      const a = newCriterionProductionStage(prefix);
      expect(a).toMatch(new RegExp(`^${prefix}[a-z0-9]{10}$`));
      expect(isCriterionProductionStage(a)).toBe(true);
      expect(a.length).toBeLessThanOrEqual(20);
    }
    expect(newCriterionProductionStage("p003")).not.toBe(newCriterionProductionStage("p003"));
    expect(() => newCriterionProductionStage("p999")).toThrow("not a reserved criterion production stage prefix");
    // Bytes from 252 up are rejected, so each character is equally likely.
    expect(newCriterionProductionStage("p004", (n) => new Uint8Array(n).fill(255).map((v, i) => (i % 2 === 0 ? v : 1)))).toBe("p004bbbbbbbbbb");
  });

  it("only test- and reserved-prefix stages are cleanable; prodcheck and other production names never", () => {
    expect(isCleanableStage("test-abc")).toBe(true);
    expect(isCleanableStage("p003abcdefghij")).toBe(true);
    expect(isCleanableStage("prodcheck")).toBe(false);
    expect(isCleanableStage("p003short")).toBe(false);
    expect(isCleanableStage("p005abcdefghij")).toBe(false);
    expect(isCleanableStage("prod")).toBe(false);
  });

  it("finds criterion stages of the app from Worker, bucket and database names", () => {
    expect(
      criterionStagesIn(
        ["reference-p003abcdefghij", "reference-p003abcdefghij-files", "reference-p004klmnopqrst-db-1", "reference-prodcheck", "reference-test-x", "template-p003zzzzzzzzzz", "prototype-mailsink", "reference-p003abc"],
        "reference",
      ),
    ).toEqual(["p003abcdefghij", "p004klmnopqrst"]);
  });
});
