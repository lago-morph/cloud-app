// Criterion production stages (DEC-0560): reserved names, the account listing, what cleanup may remove. No network.
import { describe, expect, it } from "vitest";
import { classifyCriterionStages, CRITERION_PRODUCTION_PREFIXES, criterionStagesIn, isCleanableStage, isCriterionProductionStage, markerIsStale, markerKey, markerText, newCriterionProductionStage, stageOfMarkerKey } from "./criterion-stages.js";

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

  it("markers: key, text, staleness after PAR-286, and which stages are swept", () => {
    const now = new Date("2026-10-25T18:00:00Z");
    const six = 6 * 3_600_000;
    expect(markerKey("p003abcdefghij")).toBe("compliance/criterion-stages/p003abcdefghij.json");
    expect(() => markerKey("prodcheck")).toThrow();
    expect(stageOfMarkerKey("compliance/criterion-stages/p004klmnopqrst.json")).toBe("p004klmnopqrst");
    expect(stageOfMarkerKey("compliance/criterion-stages/prodcheck.json")).toBeUndefined();
    const fresh = markerText("p003abcdefghij", "run1", new Date("2026-10-25T13:00:00Z"));
    expect(JSON.parse(fresh)).toEqual({ stage: "p003abcdefghij", runId: "run1", createdAt: "2026-10-25T13:00:00.000Z" });
    expect(markerIsStale(fresh, now, six)).toBe(false);
    expect(markerIsStale(markerText("p003abcdefghij", "run1", new Date("2026-10-25T11:59:00Z")), now, six)).toBe(true);
    expect(markerIsStale("not json", now, six)).toBe(true);
    const markers = new Map([
      ["p003abcdefghij", markerText("p003abcdefghij", "old", new Date("2026-10-25T01:00:00Z"))],
      ["p004klmnopqrst", fresh],
    ]);
    expect(classifyCriterionStages({ deployed: ["p003abcdefghij", "p004klmnopqrst", "p003ownerstage"], markers, now, maxAgeMs: six })).toEqual({ stale: ["p003abcdefghij"], unmarked: ["p003ownerstage"] });
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
