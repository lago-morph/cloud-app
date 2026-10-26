import { describe, expect, it } from "vitest";
import { isDeferred, parseWhere, readCatalogue, RELEASE_TARGETS, type CatalogueEntry } from "./catalogue.js";
import { CLAUSE_RULES, checkRules, expectedCriteria, GOOGLE_MOCKED, PHASE_RULES, UNIT_LEVEL, type ClauseRule, type NotRunRule } from "./expected.js";

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
      { id: "*", targets: ["aws"], mode: "automated", detail: "a target-wide rule" },
    ];
    expect(expectedCriteria(catalogue, "cloudflare", "automated", rules)).toEqual([
      { id: "B-AC-001", run: true, parts: [""], notRunParts: [{ part: "production part", detail: GOOGLE_MOCKED }] },
      { id: "D-AC-001", run: false, notRun: GOOGLE_MOCKED, parts: [""], notRunParts: [] },
    ]);
    expect(expectedCriteria(catalogue, "aws", "automated", rules).map((e) => [e.id, e.run, e.notRun])).toEqual([
      ["B-AC-001", false, "a target-wide rule"],
      ["D-AC-001", false, "a target-wide rule"],
    ]);
    expect(expectedCriteria(catalogue, "local", "automated", rules).every((e) => e.run && e.notRun === undefined)).toBe(true);
  });

  it("names the clauses a criterion must show by a test of their own, only on the clause's target and tier, and not for a part already not run", () => {
    const clauses: ClauseRule[] = [{ id: "B-AC-001", targets: ["local"], mode: "automated", part: "x clause", titlePattern: "x clause" }];
    const local = expectedCriteria(catalogue, "local", "automated", [], clauses);
    expect(local.find((e) => e.id === "B-AC-001")).toEqual({ id: "B-AC-001", run: true, parts: [""], notRunParts: [], clauses: [{ part: "x clause", titlePattern: "x clause" }] });
    expect(local.find((e) => e.id === "A-AC-001")).toEqual({ id: "A-AC-001", run: true, parts: [""], notRunParts: [] });
    expect(expectedCriteria(catalogue, "cloudflare", "automated", [], clauses).find((e) => e.id === "B-AC-001")?.clauses).toBeUndefined();
    const notRun: NotRunRule[] = [{ id: "B-AC-001", targets: ["local"], mode: "automated", part: "x clause", detail: "not yet" }];
    expect(expectedCriteria(catalogue, "local", "automated", notRun, clauses).find((e) => e.id === "B-AC-001")).toEqual({ id: "B-AC-001", run: true, parts: [""], notRunParts: [{ part: "x clause", detail: "not yet" }] });
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
    expect(checkRules(real, CLAUSE_RULES)).toEqual([]);
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

  // Root cause 2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test (Review, change 3): the contract part runs on
  // Cloudflare except the successful-callback response, which needs a real login provider (DEC-0171).
  it("runs AUTH-AC-005's contract part on Cloudflare with its successful-callback response not-run, and all of it on local", () => {
    const part = { part: "contract part: successful callback (needs a real login provider)", detail: "Google login mocked for this phase" };
    const cf = new Map(expectedCriteria(real, "cloudflare", "automated").map((e) => [e.id, e]));
    expect(cf.get("AUTH-AC-005")).toEqual({ id: "AUTH-AC-005", run: true, parts: [""], notRunParts: [part] });
    const local = new Map(expectedCriteria(real, "local", "automated").map((e) => [e.id, e]));
    expect(local.get("AUTH-AC-005")).toEqual({ id: "AUTH-AC-005", run: true, parts: [""], notRunParts: [] });
  });

  it("runs CHECK-AC-005 on local as a whole: its demo part has a tagged test, so no part is recorded not-run", () => {
    const local = new Map(expectedCriteria(real, "local", "automated").map((e) => [e.id, e]));
    expect(local.get("CHECK-AC-005")).toEqual({ id: "CHECK-AC-005", run: true, parts: [""], notRunParts: [] });
  });

  // DEC-0508: the AWS clauses of Local criteria (CORE-AC-006 AWS bundle, SQL-AC-006 Data API retry loop) are deferred
  // with the AWS target; release 1 neither requires them by name nor records them as not run.
  it("runs CORE-AC-006 and SQL-AC-006 on local without their deferred AWS clauses", () => {
    expect(CLAUSE_RULES).toEqual([]);
    expect(PHASE_RULES.filter((r) => r.id === "CORE-AC-006" || r.id === "SQL-AC-006")).toEqual([]);
    const local = new Map(expectedCriteria(real, "local", "automated").map((e) => [e.id, e]));
    expect(local.get("CORE-AC-006")).toEqual({ id: "CORE-AC-006", run: true, parts: [""], notRunParts: [] });
    expect(local.get("SQL-AC-006")).toEqual({ id: "SQL-AC-006", run: true, parts: [""], notRunParts: [] });
  });

  // DEC-0508: release 1 is local and Cloudflare. No rule names AWS, and no AWS criterion is demanded on a release target.
  it("never demands an AWS criterion: AWS-only criteria are deferred and expected on no release target", () => {
    expect(PHASE_RULES.filter((r) => r.targets.includes("aws"))).toEqual([]);
    const deferred = real.filter(isDeferred).map((e) => e.id);
    expect(deferred).toContain("AWS-AC-001");
    expect(deferred.every((id) => id.startsWith("AWS-AC-"))).toBe(true);
    for (const target of RELEASE_TARGETS) {
      for (const mode of ["automated", "milestone"] as const) {
        const ids = expectedCriteria(real, target, mode).map((e) => e.id);
        expect(ids.filter((id) => id.startsWith("AWS-AC-")), `${target} ${mode}`).toEqual([]);
      }
    }
    const local = expectedCriteria(real, "local", "automated");
    expect(local.every((e) => e.run)).toBe(true);
    expect(local.map((e) => e.id)).toContain("GOOGLE-AC-001");
    expect(local.map((e) => e.id)).not.toContain("HTTP-AC-004");
  });
});
