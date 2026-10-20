import { describe, expect, it } from "vitest";
import { parseWhere, readCatalogue, type CatalogueEntry } from "./catalogue.js";
import { AWS_NOT_STARTED, checkRules, expectedCriteria, GOOGLE_MOCKED, PHASE_RULES, type NotRunRule } from "./expected.js";

const docs = new URL("../../../docs/", import.meta.url).pathname;

function entry(id: string, where: string, source = "components/x.md"): CatalogueEntry {
  return { id, where, source, applies: parseWhere(where, source) };
}

const catalogue = [
  entry("A-AC-001", "Local"),
  entry("B-AC-001", "Local, cloud"),
  entry("C-AC-001", "Cloud (milestone)"),
  entry("D-AC-001", "Local, cloud; admin-list part: cloud (milestone)"),
  entry("E2E-007", "Local; cloud (milestone)", "acceptance/e2e-scenarios.md"),
];

describe("[COMPL-AC-001] per-target expected criteria", () => {
  it("lists the automated criteria applying to the target; milestone items only in milestone runs", () => {
    expect(expectedCriteria(catalogue, "local", "automated", []).map((e) => e.id)).toEqual(["A-AC-001", "B-AC-001", "D-AC-001", "E2E-007"]);
    expect(expectedCriteria(catalogue, "cloudflare", "automated", []).map((e) => e.id)).toEqual(["B-AC-001", "D-AC-001"]);
    expect(expectedCriteria(catalogue, "cloudflare", "milestone", [])).toEqual([
      { id: "C-AC-001", run: true, parts: [""], notRunParts: [] },
      { id: "D-AC-001", run: true, parts: ["admin-list part"], notRunParts: [] },
      { id: "E2E-007", run: true, parts: [""], notRunParts: [] },
    ]);
    expect(expectedCriteria(catalogue, "local", "milestone", [])).toEqual([]);
  });

  it("applies whole and part not-run rules with their detail, and the target-wide rule", () => {
    const rules: NotRunRule[] = [
      { id: "B-AC-001", targets: ["cloudflare"], mode: "automated", part: "production part", detail: GOOGLE_MOCKED },
      { id: "D-AC-001", targets: ["cloudflare"], mode: "automated", detail: GOOGLE_MOCKED },
      { id: "*", targets: ["aws"], mode: "automated", detail: AWS_NOT_STARTED },
    ];
    expect(expectedCriteria(catalogue, "cloudflare", "automated", rules)).toEqual([
      { id: "B-AC-001", run: true, parts: [""], notRunParts: [{ part: "production part", detail: GOOGLE_MOCKED }] },
      { id: "D-AC-001", run: false, notRun: GOOGLE_MOCKED, parts: [""], notRunParts: [] },
    ]);
    expect(expectedCriteria(catalogue, "aws", "automated", rules).map((e) => [e.id, e.run, e.notRun])).toEqual([
      ["B-AC-001", false, AWS_NOT_STARTED],
      ["D-AC-001", false, AWS_NOT_STARTED],
    ]);
    expect(expectedCriteria(catalogue, "local", "automated", rules).every((e) => e.run && e.notRun === undefined)).toBe(true);
  });

  it("names a rule that matches nothing in the catalogue", () => {
    expect(checkRules(catalogue, [{ id: "A-AC-001", targets: ["cloudflare"], mode: "automated", detail: "x" }])).toEqual([
      "not-run rule A-AC-001 (cloudflare, automated): the criterion does not apply there in that tier",
    ]);
    expect(checkRules(catalogue, [{ id: "Z-AC-001", targets: ["local"], mode: "automated", detail: "x" }])).toEqual(["not-run rule Z-AC-001: no such criterion or scenario"]);
  });
});

describe("[COMPL-AC-001] this phase's not-run rules (plan §8) against the documents", () => {
  const real = readCatalogue(docs);

  it("every rule matches a criterion applying on its target and tier", () => {
    expect(checkRules(real, PHASE_RULES)).toEqual([]);
  });

  it("records the Google-mocked items on Cloudflare as not-run with the prompt's detail", () => {
    const cf = new Map(expectedCriteria(real, "cloudflare", "automated").map((e) => [e.id, e]));
    for (const id of ["GOOGLE-AC-001", "AUTH-AC-011", "COMPL-AC-005", "E2E-006", "CLI-AC-001"]) {
      expect(cf.get(id)?.notRun, id).toBe("Google login mocked for this phase");
    }
    expect(cf.get("AUTH-AC-009")?.run).toBe(true);
    expect(cf.get("AUTH-AC-009")?.notRunParts).toEqual([{ part: "cloud production part", detail: "Google login mocked for this phase" }]);
    expect(cf.get("KV-AC-001")).toEqual({ id: "KV-AC-001", run: true, parts: [""], notRunParts: [] });
    const cfm = new Map(expectedCriteria(real, "cloudflare", "milestone").map((e) => [e.id, e]));
    for (const id of ["GOOGLE-AC-005", "SKILL-AC-006", "E2E-007", "E2E-008", "AUTH-AC-005"]) {
      expect(cfm.get(id)?.notRun, id).toBe("Google login mocked for this phase");
    }
    expect(cfm.get("PROV-AC-003")?.run).toBe(true);
  });

  it("records every AWS criterion as not-run 'AWS phase not started', and Local criteria run locally", () => {
    const aws = expectedCriteria(real, "aws", "automated");
    expect(aws.length).toBeGreaterThan(50);
    expect(aws.every((e) => !e.run && e.notRun === "AWS phase not started")).toBe(true);
    expect(aws.map((e) => e.id)).toContain("AWS-AC-001");
    expect(aws.map((e) => e.id)).not.toContain("CF-AC-001");
    const local = expectedCriteria(real, "local", "automated");
    expect(local.every((e) => e.run)).toBe(true);
    expect(local.map((e) => e.id)).toContain("GOOGLE-AC-001");
    expect(local.map((e) => e.id)).not.toContain("HTTP-AC-004");
  });
});
