import { describe, expect, it } from "vitest";
import { isDeferred, parseWhere, readCatalogue, RELEASE_TARGETS, type CatalogueEntry } from "./catalogue.js";
import { CLAUSE_RULES, checkRules, E2E_TESTS_PENDING, expectedCriteria, PASSWORD_PENDING, NO_REDIRECT_PROVIDER, PHASE_RULES, type ClauseRule, type NotRunRule } from "./expected.js";

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
      { id: "B-AC-001", targets: ["cloudflare"], mode: "automated", part: "production part", detail: PASSWORD_PENDING },
      { id: "D-AC-001", targets: ["cloudflare"], mode: "automated", detail: PASSWORD_PENDING },
      { id: "*", targets: ["aws"], mode: "automated", detail: "a target-wide rule" },
    ];
    expect(expectedCriteria(catalogue, "cloudflare", "automated", rules)).toEqual([
      { id: "B-AC-001", run: true, parts: [""], notRunParts: [{ part: "production part", detail: PASSWORD_PENDING }] },
      { id: "D-AC-001", run: false, notRun: PASSWORD_PENDING, parts: [""], notRunParts: [] },
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

  // DEC-0513, DEC-0520: Google is retired; the cloud items that need the password provider were not-run until it landed.
  it("runs the password and mail criteria on Cloudflare now that their cloud tests exist (T2, T3); the rest stay not-run with their detail, and no retired Google criterion", () => {
    const cf = new Map(expectedCriteria(real, "cloudflare", "automated").map((e) => [e.id, e]));
    // plan-auth.md T2/T3: tagged cloud tests exist for these, so they run with no not-run rule.
    // PWD-AC-008 and MAIL-AC-006 are retired with PWD and MAIL (v0.2.0, DEC-0696) and are expected nowhere.
    // CLI-AC-007 is retired with `admins` (v0.2.0, DEC-0698) and is expected nowhere.
    expect(cf.has("CLI-AC-007")).toBe(false);
    for (const id of ["AUTH-AC-009", "AUTH-AC-014", "COMPL-AC-005", "E2E-006"]) {
      expect(cf.get(id), id).toEqual({ id, run: true, parts: [""], notRunParts: [] });
    }
    // Plan-v0.2.0 §7.1 (DEC-0753): E2E-007's automated part is local only; on a cloud it has only its live sign-in part.
    expect(cf.has("E2E-007")).toBe(false);
    // CLI-AC-001's cloud part (the whole command table from the template on a cloud) has no cloud test yet.
    expect(cf.get("CLI-AC-001")?.notRun).toBe("password login provider not implemented yet (DEC-0509)");
    // Item I-G: check-login runs on prodcheck in every cloud run (the driver, prodcheck.ts), so its criteria run.
    for (const id of ["AUTH-AC-011", "E2E-008"]) expect(cf.get(id), id).toEqual({ id, run: true, parts: [""], notRunParts: [] });
    for (const id of ["PWD-AC-008", "PWD-AC-009", "MAIL-AC-006"]) expect(cf.has(id), id).toBe(false);
    expect(cf.get("KV-AC-001")).toEqual({ id: "KV-AC-001", run: true, parts: [""], notRunParts: [] });
    const cfm = new Map(expectedCriteria(real, "cloudflare", "milestone").map((e) => [e.id, e]));
    expect(cfm.get("SKILL-AC-006")?.notRun).toBe("password login provider not implemented yet (DEC-0509)");
    // MAIL-AC-007 is retired with MAIL and left the milestone list (DEC-0693, DEC-0696).
    expect(cfm.has("MAIL-AC-007")).toBe(false);
    expect(cfm.get("PROV-AC-003")?.run).toBe(true);
    // DEC-0532: the fresh-account clause needs a second Cloudflare account; the owner deferred it. The rest of PROV-AC-004 runs.
    expect(cfm.get("PROV-AC-004")).toEqual({
      id: "PROV-AC-004",
      run: true,
      parts: [""],
      notRunParts: [{ part: "fresh-account clause: deploying without setup-account fails with a clear message", detail: "deferred: needs a second Cloudflare account (owner, 2026-10-25)" }],
    });
    // DEC-0526: AUTH-AC-005's admin part left the milestone list. DEC-0692, DEC-0755: the live sign-in parts of E2E-007 and E2E-008 joined it.
    expect(cfm.has("AUTH-AC-005")).toBe(false);
    for (const id of ["E2E-007", "E2E-008"]) expect(cfm.get(id), id).toEqual({ id, run: true, parts: ["live sign-in"], notRunParts: [] });
    for (const target of ["local", "cloudflare"] as const) {
      for (const mode of ["automated", "milestone"] as const) {
        expect(expectedCriteria(real, target, mode).filter((e) => e.id.startsWith("GOOGLE-AC-")), `${target} ${mode}`).toEqual([]);
      }
    }
  });

  // Root cause 2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test (Review, change 3): the contract part runs on
  // Cloudflare except the successful-callback response, which needs a real login provider (DEC-0171).
  // DEC-0526: its admin-role part is automated on prodcheck, and runs since its test exists (auth/admin-role.test.ts).
  it("runs AUTH-AC-005 on Cloudflare with only its successful-callback response not-run, and all of it on local", () => {
    const part = { part: "contract part: successful callback (needs a redirect login provider)", detail: NO_REDIRECT_PROVIDER };
    const cf = new Map(expectedCriteria(real, "cloudflare", "automated").map((e) => [e.id, e]));
    expect(cf.get("AUTH-AC-005")).toEqual({ id: "AUTH-AC-005", run: true, parts: [""], notRunParts: [part] });
    const local = new Map(expectedCriteria(real, "local", "automated").map((e) => [e.id, e]));
    expect(local.get("AUTH-AC-005")).toEqual({ id: "AUTH-AC-005", run: true, parts: [""], notRunParts: [] });
  });

  // Plan-v0.2.0 §7.1, §7a.2.3 (DEC-0758): PR 78 rewrote these local parts ahead of their tests, which land in PR 80.
  it("records E2E-005's and E2E-007's local auth-app parts not-run until their tests land, and runs the rest of each", () => {
    const local = new Map(expectedCriteria(real, "local", "automated").map((e) => [e.id, e]));
    for (const id of ["E2E-005", "E2E-007"]) {
      const entry = local.get(id);
      expect(entry?.run, id).toBe(true);
      expect(entry?.notRunParts.map((p) => p.detail), id).toEqual([E2E_TESTS_PENDING]);
    }
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
    // PWD-AC-001 is retired (DEC-0696); AUTH-AC-001 is a local automated criterion that stays.
    expect(local.map((e) => e.id)).toContain("AUTH-AC-001");
    expect(local.map((e) => e.id)).not.toContain("HTTP-AC-004");
  });
});
