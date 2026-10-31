import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { parseWhere, readCatalogue, type CatalogueEntry } from "../harness/catalogue.js";
import { CHECK_LOGIN_IDS as COMMAND_CHECK_LOGIN_IDS } from "../../../packages/framework/src/cli/commands/check-login.js";
import { CHECK_LOGIN_IDS } from "../harness/prodcheck.js";
import { LOGIN_PROVIDER_PATHS, REAL_SIGN_IN, parseInvalidations, releaseReport, renderRelease } from "./release.js";

const entry = (id: string, where: string, source = "components/x.md"): CatalogueEntry => ({ id, where, source, applies: parseWhere(where, source) });
const catalogue = [entry("KV-AC-001", "Local, cloud", "components/kv.md"), entry("PROV-AC-003", "Cloud (milestone)", "components/cloudflare.md")];

let n = 0;
function rec(target: EvidenceRecord["target"], commit: string, results: EvidenceRecord["results"], options: { milestone?: boolean; finishedAt?: string } = {}): EvidenceRecord {
  n += 1;
  const at = options.finishedAt ?? `2026-10-20T10:00:${String(n).padStart(2, "0")}Z`;
  return { runId: `r${String(n)}`, commit, target, command: `npm run compliance -- --target ${target}${options.milestone === true ? " --milestone" : ""}`, startedAt: at, finishedAt: at, exitStatus: 0, results, versions: {} };
}

// PROV-AC-003 (a milestone item) here applies to cloudflare only (source cloudflare.md), to keep the fixture small.
const allPassed = (commit: string): EvidenceRecord[] => (
  (n = 0),
  [
  rec("local", commit, [{ id: "KV-AC-001", status: "passed" }]),
  rec("cloudflare", commit, [{ id: "KV-AC-001", status: "passed" }]),
  rec("cloudflare", "c0", [{ id: "PROV-AC-003", status: "passed" }], { milestone: true, finishedAt: "2026-10-19T09:00:00Z" }),
  ]
);

const noLoginCommits = (): string[] => [];

describe("[COMPL-AC-006] release report", () => {
  it("says works only when every automated criterion passed on every applicable target for the commit and every milestone record is valid", () => {
    const report = releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
    expect(report.works).toBe(true);
    expect(renderRelease(report)).toMatch(/^# Release report for commit c1: works$/m);
  });

  it("a commit with one not-run automated criterion is not working", () => {
    const records = allPassed("c1").map((r) => (r.target === "cloudflare" && !r.command.includes("--milestone") ? { ...r, results: [{ id: "KV-AC-001", status: "not-run" as const, detail: "D1 unavailable" }] } : r));
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["KV-AC-001 on cloudflare: not-run: D1 unavailable (run r2)"]);
    expect(renderRelease(report)).toMatch(/: not working$/m);
  });

  it("results of another commit do not count, and a missing record is a problem", () => {
    const records = allPassed("c1").filter((r) => r.target !== "local");
    records.push(rec("local", "c-old", [{ id: "KV-AC-001", status: "passed" }]));
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: no record for commit c1"]);
  });

  it("the latest record decides; milestone runs are not automated evidence", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "failed", detail: "boom" }])];
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: failed: boom (run r4)"]);
  });

  it("a newer milestone record that did not select an ID does not decide it", () => {
    const records = [
      ...allPassed("c1"),
      rec("cloudflare", "c0", [{ id: "PROV-AC-003", status: "not-run", detail: "not selected for this run (--only)" }], { milestone: true, finishedAt: "2026-10-19T10:00:00Z" }),
    ];
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
  });

  it("a newer automated record that did not select an ID does not shadow the record that ran it", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only)" }])];
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
    expect(report.works).toBe(true);
  });

  it("only the exact not-selected entry is skipped; any other not-run detail still decides", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only) extra" }])];
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: not-run: not selected for this run (--only) extra (run r4)"]);
  });

  it("a milestone record invalidated by a recorded entry makes the commit not working", () => {
    const invalidations = parseInvalidations("# Invalidations\n\n- 2026-10-19 | PROV-AC-003, E2E-010 | provisioning changed\n");
    const report = releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations, loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["PROV-AC-003 on cloudflare (milestone): record r3 of 2026-10-19T09:00:00Z is invalidated: 2026-10-19 provisioning changed"]);
  });

  it("an invalidation dated before the record does not invalidate it; a missing milestone record does", () => {
    const old = parseInvalidations("- 2026-10-18T12:00:00Z | PROV-AC-003 | earlier change\n");
    expect(releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations: old, loginCommits: noLoginCommits }).works).toBe(true);
    const records = allPassed("c1").filter((r) => !r.command.includes("--milestone"));
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["PROV-AC-003 on cloudflare (milestone): no record"]);
  });

  // COMPL-AC-006 as amended (DEC-0692; DEC-0780). Root cause 2026-10-31-T7-release-login-check: the tool kept
  // DEC-0512's PWD-AC-009 rule, and its fixtures a PWD-AC-009 `passed` record no command writes any more.
  it("lists the commits touching AUTH, auth-app or login-provider interface files since the latest passing real sign-in records (live parts of E2E-007 and E2E-008)", () => {
    const live = (commit: string, status: "passed" | "failed", finishedAt: string, ids: readonly string[] = REAL_SIGN_IN): EvidenceRecord =>
      rec("cloudflare", commit, ids.map((id) => ({ id, status })), { milestone: true, finishedAt });
    // The record check-login writes since B's #115 (DEC-0670): the automated sign-in path check, not a real sign-in.
    const checkLogin: EvidenceRecord = {
      ...rec("cloudflare", "c-auto", [{ id: "PWD-AC-009", status: "not-run", detail: "retired with the password provider (plan-v0.2.0 §6)" }, { id: "AUTH-AC-011", status: "passed" }, { id: "E2E-008", status: "passed" }], { finishedAt: "2026-10-22T08:00:00Z" }),
      command: "check-login --target cloudflare --stage prodcheck",
    };
    const asked: (string | undefined)[] = [];
    const records = [...allPassed("c1"), live("c-pass", "passed", "2026-10-21T08:00:00Z"), live("c-fail", "failed", "2026-10-21T09:00:00Z"), checkLogin];
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: (since) => (asked.push(since), ["abc1234 AUTH: change the role refresh"]) });
    // The newest passing live record decides: not the newer failing one, nor check-login's automated record.
    expect(asked).toEqual(["c-pass"]);
    expect(report.lastRealSignIn).toMatchObject({ commit: "c-pass", command: "npm run compliance -- --target cloudflare --milestone" });
    expect(report.loginCommits).toEqual(["abc1234 AUTH: change the role refresh"]);
    const text = renderRelease(report);
    expect(text).toContain("## Commits touching AUTH, auth-app or login-provider interface files since the latest passing real sign-in records");
    expect(text).toContain("- abc1234 AUTH: change the role refresh");
    // Separate records: the older of the two latest is the reference point; a dry run never counts.
    const split = [...records, live("c-007", "passed", "2026-10-23T08:00:00Z", ["E2E-007"]), live("c-008", "passed", "2026-10-23T09:00:00Z", ["E2E-008"])];
    expect(releaseReport({ commit: "c1", catalogue, records: split, invalidations: [], loginCommits: () => [] }).lastRealSignIn?.commit).toBe("c-007");
    const dry = [...records, { ...live("c-dry", "passed", "2026-10-24T08:00:00Z"), dryRun: "fake" }];
    expect(releaseReport({ commit: "c1", catalogue, records: dry, invalidations: [], loginCommits: () => [] }).lastRealSignIn?.commit).toBe("c-pass");
    // Only check-login's records, or a live record of one of the two: no reference point, all of history.
    for (const only of [[checkLogin], [live("c-008", "passed", "2026-10-23T09:00:00Z", ["E2E-008"])]]) {
      const none = releaseReport({ commit: "c1", catalogue, records: [...allPassed("c1"), ...only], invalidations: [], loginCommits: (since) => (asked.push(since), []) });
      expect(none.lastRealSignIn).toBeUndefined();
      expect(asked.at(-1)).toBeUndefined();
      expect(renderRelease(none)).toContain("No passing real sign-in records (live parts of E2E-007 and E2E-008, milestone): all commits since the start");
    }
    expect(LOGIN_PROVIDER_PATHS).toEqual([
      "packages/framework/src/auth/",
      "packages/framework/src/auth-app/",
      "packages/framework/src/targets/cloudflare/auth-app.ts",
      "packages/framework/src/provision/cloudflare/auth-app-deploy.ts",
      "docs/contracts/ts/auth.d.ts",
      "docs/contracts/ts/internal/auth-app.d.ts",
      "docs/contracts/ts/internal/login-provider.d.ts",
    ]);
  });

  // Root cause 2026-10-31-T7-release-login-check: IDs and paths drifted from the command and the tree with no failing test.
  it("the harness folds every ID check-login records that the documents' catalogue has, and the release tool names only paths that exist", () => {
    const ids = new Set(readCatalogue(fileURLToPath(new URL("../../../docs", import.meta.url))).map((e) => e.id));
    expect(CHECK_LOGIN_IDS).toEqual(COMMAND_CHECK_LOGIN_IDS.filter((id) => ids.has(id)));
    for (const id of REAL_SIGN_IN) expect(ids, id).toContain(id);
    for (const path of LOGIN_PROVIDER_PATHS) expect(existsSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url))), path).toBe(true);
  });

  // plan-auth.md T3, with the documents' own catalogue: the provider check's automated part (AUTH-AC-011, E2E-008)
  // is automated on Cloudflare, so a commit is working only when its cloud run recorded its results.
  // PWD-AC-009 is retired with PWD (v0.2.0, DEC-0696); AUTH-AC-011 is the automated `/start` check that stays (DEC-0692).
  it("with the documents' catalogue, a commit whose cloud run lacks the provider check's AUTH-AC-011 result is not working, and no GOOGLE or PWD criterion or milestone item is demanded", () => {
    const real = readCatalogue(fileURLToPath(new URL("../../../docs", import.meta.url)));
    const ids = (target: "local" | "cloudflare", mode: "automated" | "milestone"): string[] =>
      real.filter((e) => (mode === "automated" ? e.applies[target]?.automated === true : (e.applies[target]?.milestone.length ?? 0) > 0)).map((e) => e.id);
    for (const id of ["AUTH-AC-011", "E2E-008"]) expect(ids("cloudflare", "automated"), id).toContain(id);
    expect(ids("cloudflare", "milestone"), "AUTH-AC-011 is not a milestone item").not.toContain("AUTH-AC-011");
    // DEC-0692, DEC-0755: E2E-008's live sign-in is a milestone part beside its automated part.
    expect(ids("cloudflare", "milestone"), "E2E-008's live sign-in part").toContain("E2E-008");
    expect(real.filter((e) => e.id.startsWith("GOOGLE-")), "the retired GOOGLE criteria are not in the catalogue").toEqual([]);
    expect(real.filter((e) => e.id.startsWith("PWD-") || e.id.startsWith("MAIL-")), "the retired PWD and MAIL criteria are not in the catalogue").toEqual([]);
    const passed = (list: string[]): EvidenceRecord["results"] => list.map((id) => ({ id, status: "passed" as const }));
    const records = (cloud: string[]): EvidenceRecord[] => [
      rec("local", "c1", passed(ids("local", "automated"))),
      rec("cloudflare", "c1", passed(cloud)),
      rec("local", "c0", passed(ids("local", "milestone")), { milestone: true, finishedAt: "2026-10-19T09:00:00Z" }),
      rec("cloudflare", "c0", passed(ids("cloudflare", "milestone")), { milestone: true, finishedAt: "2026-10-19T09:00:01Z" }),
    ];
    const works = releaseReport({ commit: "c1", catalogue: real, records: records(ids("cloudflare", "automated")), invalidations: [], loginCommits: () => [] });
    expect(works.problems).toEqual([]);
    expect(works.works).toBe(true);
    const without = releaseReport({ commit: "c1", catalogue: real, records: records(ids("cloudflare", "automated").filter((id) => id !== "AUTH-AC-011")), invalidations: [], loginCommits: () => [] });
    expect(without.works).toBe(false);
    expect(without.problems).toEqual(["AUTH-AC-011 on cloudflare: no record for commit c1"]);
    expect(renderRelease(without)).not.toContain("GOOGLE");
  });

  it("never demands GOOGLE-AC-005 (retired, DEC-0513): it is not in the catalogue, and no line names it", () => {
    const text = renderRelease(releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations: [], loginCommits: () => [] }));
    expect(text).not.toContain("GOOGLE");
  });

  // G-EV F3: a record marked as a dry run is never counted, even when it is the newest and all passed.
  it("never counts a record marked as a dry run", () => {
    const records = allPassed("c1").map((r) => (r.target === "cloudflare" && !r.command.includes("--milestone") ? { ...r, dryRun: "fake stage operations (OperationsFactory)" } : r));
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["KV-AC-001 on cloudflare: no record for commit c1"]);
    const certified = allPassed("c1").map((r) => (r.command.includes("--milestone") ? { ...r, dryRun: "not-run rules overridden (DriverDeps.notRunRules)" } : r));
    const milestone = releaseReport({ commit: "c1", catalogue, records: certified, invalidations: [], loginCommits: noLoginCommits });
    expect(milestone.problems).toEqual(["PROV-AC-003 on cloudflare (milestone): no record"]);
  });

  // DEC-0508: release 1 judges local and Cloudflare; the AWS target and AWS-only criteria are deferred.
  it("never demands an AWS criterion or an AWS record: no AWS line appears, and the commit works without them", () => {
    const withAws = [...catalogue, entry("AWS-AC-001", "Cloud", "components/aws.md"), entry("AWS-AC-007", "Cloud (milestone)", "components/aws.md")];
    const report = releaseReport({ commit: "c1", catalogue: withAws, records: allPassed("c1"), invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
    expect(report.works).toBe(true);
    const text = renderRelease(report);
    expect(text).not.toMatch(/AWS-AC-|on aws/);
    expect(text).toContain("Targets judged: local, cloudflare. The AWS target is deferred to a later release (DEC-0508, branch `aws`).");
    // An AWS record, even a failing one, decides nothing.
    const failingAws = [...allPassed("c1"), rec("aws", "c1", [{ id: "KV-AC-001", status: "failed", detail: "boom" }, { id: "AWS-AC-001", status: "failed", detail: "boom" }])];
    expect(releaseReport({ commit: "c1", catalogue: withAws, records: failingAws, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual([]);
  });

  it("ignores list lines inside fenced code blocks (the format example)", () => {
    expect(parseInvalidations("```\n- <YYYY-MM-DD> | <ID> | <reason>\n```\n- 2026-10-19 | E2E-008 | r\n").map((i) => i.ids)).toEqual([["E2E-008"]]);
  });

  it("refuses malformed invalidation lines", () => {
    expect(() => parseInvalidations("- yesterday | PROV-AC-003 | x\n")).toThrow(/invalidations/);
    expect(() => parseInvalidations("- 2026-10-19 | | x\n")).toThrow(/invalidations/);
    expect(parseInvalidations("Text and\n\n- 2026-10-19T08:00:00Z | E2E-008 | r\n")).toEqual([{ at: "2026-10-19T08:00:00Z", label: "2026-10-19T08:00:00Z", ids: ["E2E-008"], reason: "r" }]);
    expect(parseInvalidations("- 2026-10-19 | E2E-008 | r\n")[0]?.at).toBe("2026-10-19T23:59:59.999Z");
  });
});
