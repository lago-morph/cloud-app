import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { parseWhere, type CatalogueEntry } from "../harness/catalogue.js";
import { LOGIN_PROVIDER_PATHS, parseInvalidations, releaseReport, renderRelease } from "./release.js";

const entry = (id: string, where: string, source = "components/x.md"): CatalogueEntry => ({ id, where, source, applies: parseWhere(where, source) });
const catalogue = [entry("KV-AC-001", "Local, cloud", "components/kv.md"), entry("GOOGLE-AC-005", "Cloud (manual, milestone)", "components/cloudflare.md")];

let n = 0;
function rec(target: EvidenceRecord["target"], commit: string, results: EvidenceRecord["results"], options: { milestone?: boolean; finishedAt?: string } = {}): EvidenceRecord {
  n += 1;
  const at = options.finishedAt ?? `2026-10-20T10:00:${String(n).padStart(2, "0")}Z`;
  return { runId: `r${String(n)}`, commit, target, command: `npm run compliance -- --target ${target}${options.milestone === true ? " --milestone" : ""}`, startedAt: at, finishedAt: at, exitStatus: 0, results, versions: {} };
}

// GOOGLE-AC-005 here applies to cloudflare only (source cloudflare.md), to keep the fixture small.
const allPassed = (commit: string): EvidenceRecord[] => (
  (n = 0),
  [
  rec("local", commit, [{ id: "KV-AC-001", status: "passed" }]),
  rec("cloudflare", commit, [{ id: "KV-AC-001", status: "passed" }]),
  rec("aws", commit, [{ id: "KV-AC-001", status: "passed" }]),
  rec("cloudflare", "c0", [{ id: "GOOGLE-AC-005", status: "passed" }], { milestone: true, finishedAt: "2026-10-19T09:00:00Z" }),
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
    const records = allPassed("c1").map((r) => (r.target === "aws" ? { ...r, results: [{ id: "KV-AC-001", status: "not-run" as const, detail: "AWS phase not started" }] } : r));
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["KV-AC-001 on aws: not-run: AWS phase not started (run r3)"]);
    expect(renderRelease(report)).toMatch(/: not working$/m);
  });

  it("results of another commit do not count, and a missing record is a problem", () => {
    const records = allPassed("c1").filter((r) => r.target !== "local");
    records.push(rec("local", "c-old", [{ id: "KV-AC-001", status: "passed" }]));
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: no record for commit c1"]);
  });

  it("the latest record decides; milestone runs are not automated evidence", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "failed", detail: "boom" }])];
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: failed: boom (run r5)"]);
  });

  it("a newer milestone record that did not select an ID does not decide it", () => {
    const records = [
      ...allPassed("c1"),
      rec("cloudflare", "c0", [{ id: "GOOGLE-AC-005", status: "not-run", detail: "not selected for this run (--only)" }], { milestone: true, finishedAt: "2026-10-19T10:00:00Z" }),
    ];
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
    expect(report.lastCertification?.runId).toBe("r4");
  });

  it("a newer automated record that did not select an ID does not shadow the record that ran it", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only)" }])];
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.problems).toEqual([]);
    expect(report.works).toBe(true);
  });

  it("only the exact not-selected entry is skipped; any other not-run detail still decides", () => {
    const records = [...allPassed("c1"), rec("local", "c1", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only) extra" }])];
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["KV-AC-001 on local: not-run: not selected for this run (--only) extra (run r5)"]);
  });

  it("a certification invalidated by a recorded entry makes the commit not working", () => {
    const invalidations = parseInvalidations("# Invalidations\n\n- 2026-10-19 | GOOGLE-AC-005, E2E-008 | login-provider interface changed\n");
    const report = releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations, loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["GOOGLE-AC-005 on cloudflare (milestone): record r4 of 2026-10-19T09:00:00Z is invalidated: 2026-10-19 login-provider interface changed"]);
  });

  it("an invalidation dated before the record does not invalidate it; a missing milestone record does", () => {
    const old = parseInvalidations("- 2026-10-18T12:00:00Z | GOOGLE-AC-005 | earlier change\n");
    expect(releaseReport({ commit: "c1", catalogue, records: allPassed("c1"), invalidations: old, loginCommits: noLoginCommits }).works).toBe(true);
    const records = allPassed("c1").filter((r) => !r.command.includes("--milestone"));
    expect(releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits }).problems).toEqual(["GOOGLE-AC-005 on cloudflare (milestone): no record"]);
  });

  it("lists the commits touching GOOGLE or login-provider interface files since the last certification", () => {
    const asked: (string | undefined)[] = [];
    const report = releaseReport({
      commit: "c1",
      catalogue,
      records: allPassed("c1"),
      invalidations: [],
      loginCommits: (since) => (asked.push(since), ["abc1234 GOOGLE: change discovery"]),
    });
    expect(asked).toEqual(["c0"]);
    expect(report.loginCommits).toEqual(["abc1234 GOOGLE: change discovery"]);
    expect(renderRelease(report)).toContain("- abc1234 GOOGLE: change discovery");
    const none = releaseReport({ commit: "c1", catalogue, records: allPassed("c1").filter((r) => !r.command.includes("--milestone")), invalidations: [], loginCommits: (since) => (asked.push(since), []) });
    expect(asked.at(-1)).toBeUndefined();
    expect(renderRelease(none)).toContain("No certification recorded: all commits since the start");
    expect(LOGIN_PROVIDER_PATHS).toEqual(["packages/framework/src/google/", "packages/framework/src/auth/login-provider.ts", "docs/contracts/ts/internal/login-provider.d.ts"]);
  });

  // G-EV F3: a record marked as a dry run is never counted, even when it is the newest and all passed.
  it("never counts a record marked as a dry run", () => {
    const records = allPassed("c1").map((r) => (r.target === "aws" ? { ...r, dryRun: "fake stage operations (OperationsFactory)" } : r));
    const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
    expect(report.works).toBe(false);
    expect(report.problems).toEqual(["KV-AC-001 on aws: no record for commit c1"]);
    const certified = allPassed("c1").map((r) => (r.command.includes("--milestone") ? { ...r, dryRun: "not-run rules overridden (DriverDeps.notRunRules)" } : r));
    const milestone = releaseReport({ commit: "c1", catalogue, records: certified, invalidations: [], loginCommits: noLoginCommits });
    expect(milestone.problems).toEqual(["GOOGLE-AC-005 on cloudflare (milestone): no record"]);
    expect(milestone.lastCertification).toBeUndefined();
  });

  it("ignores list lines inside fenced code blocks (the format example)", () => {
    expect(parseInvalidations("```\n- <YYYY-MM-DD> | <ID> | <reason>\n```\n- 2026-10-19 | E2E-008 | r\n").map((i) => i.ids)).toEqual([["E2E-008"]]);
  });

  it("refuses malformed invalidation lines", () => {
    expect(() => parseInvalidations("- yesterday | GOOGLE-AC-005 | x\n")).toThrow(/invalidations/);
    expect(() => parseInvalidations("- 2026-10-19 | | x\n")).toThrow(/invalidations/);
    expect(parseInvalidations("Text and\n\n- 2026-10-19T08:00:00Z | E2E-008 | r\n")).toEqual([{ at: "2026-10-19T08:00:00Z", label: "2026-10-19T08:00:00Z", ids: ["E2E-008"], reason: "r" }]);
    expect(parseInvalidations("- 2026-10-19 | E2E-008 | r\n")[0]?.at).toBe("2026-10-19T23:59:59.999Z");
  });
});
