/**
 * Release report (COMPL-REQ-006). A commit "works" only when
 * - every automated criterion and scenario passed on every applicable target, in the latest
 *   automated record for that commit (any other result, or no record, is a problem); and
 * - every milestone item's latest milestone record exists, passed, and is not invalidated by an
 *   entry in `validation/invalidations.md` dated at or after it (never by elapsed time).
 * It also lists the commits that touched GOOGLE or login-provider interface files since the
 * last GOOGLE certification (GOOGLE-AC-005). It records; the evaluator judges.
 *
 * Release 1 judges local and Cloudflare only (DEC-0508; SYS-REQ-026 as amended): the AWS target,
 * and every criterion that applies only there, is deferred to a later release (branch `aws`), so
 * no AWS line is ever a problem.
 */
import type { EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { DEFERRED, RELEASE_TARGETS, selectedEntries, type CatalogueEntry } from "../harness/catalogue.js";
import { isDryRun } from "./records.js";

/** GOOGLE and the login-provider interface (auth.md, internal/login-provider.d.ts). */
export const LOGIN_PROVIDER_PATHS = ["packages/framework/src/google/", "packages/framework/src/auth/login-provider.ts", "docs/contracts/ts/internal/login-provider.d.ts"];
const CERTIFICATION = "GOOGLE-AC-005";

export interface Invalidation {
  /** ISO time from which earlier records are invalid (a date alone means the end of that day). */
  readonly at: string;
  /** The date or time as written. */
  readonly label: string;
  readonly ids: readonly string[];
  readonly reason: string;
}

const ID = /^(?:[A-Z]+-AC|E2E)-\d{3}$/;

/** Reads the list lines `- <YYYY-MM-DD | ISO time> | <ID>, <ID> | <reason>`; other lines, and fenced code blocks, are prose. */
export function parseInvalidations(text: string): Invalidation[] {
  const out: Invalidation[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || !line.startsWith("- ")) continue;
    const [when = "", idText = "", ...rest] = line.slice(2).split("|").map((s) => s.trim());
    const ids = idText.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const reason = rest.join("|").trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(when);
    const at = dateOnly ? `${when}T23:59:59.999Z` : when;
    if (Number.isNaN(Date.parse(at)) || !/^\d{4}-\d{2}-\d{2}/.test(when) || ids.length === 0 || !ids.every((id) => ID.test(id)) || reason === "") {
      throw new Error(`validation/invalidations.md: cannot read ${JSON.stringify(line)}; use "- <YYYY-MM-DD> | <ID>, <ID> | <reason>"`);
    }
    out.push({ at, label: when, ids, reason });
  }
  return out;
}

export interface ReleaseInput {
  readonly commit: string;
  readonly catalogue: readonly CatalogueEntry[];
  readonly records: readonly EvidenceRecord[];
  readonly invalidations: readonly Invalidation[];
  /** Commits (one line each) touching LOGIN_PROVIDER_PATHS after `since` (exclusive) up to the commit; all of history when undefined. */
  loginCommits(since: string | undefined): readonly string[];
}

export interface ReleaseReport {
  readonly commit: string;
  readonly works: boolean;
  readonly problems: readonly string[];
  readonly lastCertification?: { readonly runId: string; readonly commit: string; readonly finishedAt: string };
  readonly loginCommits: readonly string[];
}

const isMilestone = (r: EvidenceRecord): boolean => /(?:^|\s)--milestone(?:\s|$)/.test(r.command);
const newestFirst = (records: readonly EvidenceRecord[]): EvidenceRecord[] => [...records].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));

/** A record contains an ID when it has an entry for it other than the not-selected one (DEC-0264). */
const selects = (r: EvidenceRecord, id: string): boolean => selectedEntries(r, id).length > 0;

function summary(record: EvidenceRecord, id: string): { passed: boolean; text: string } {
  const entries = selectedEntries(record, id);
  const bad = entries.filter((r) => r.status !== "passed");
  return { passed: bad.length === 0, text: bad.map((r) => (r.detail === undefined ? r.status : `${r.status}: ${r.detail}`)).join("; ") };
}

export function releaseReport(input: ReleaseInput): ReleaseReport {
  const problems: string[] = [];
  // A dry run's record (G-EV F3) is never evidence, even when it is the newest.
  const sorted = newestFirst(input.records.filter((r) => !isDryRun(r)));
  const automated = sorted.filter((r) => !isMilestone(r) && r.commit === input.commit);
  const milestone = sorted.filter(isMilestone);
  let lastCertification: ReleaseReport["lastCertification"];

  for (const entry of input.catalogue) {
    for (const target of RELEASE_TARGETS) {
      const applies = entry.applies[target];
      if (applies === undefined) continue;
      if (applies.automated) {
        const record = automated.find((r) => r.target === target && selects(r, entry.id));
        if (record === undefined) problems.push(`${entry.id} on ${target}: no record for commit ${input.commit}`);
        else {
          const s = summary(record, entry.id);
          if (!s.passed) problems.push(`${entry.id} on ${target}: ${s.text} (run ${record.runId})`);
        }
      }
      if (applies.milestone.length > 0) {
        const record = milestone.find((r) => r.target === target && selects(r, entry.id));
        if (record === undefined) {
          problems.push(`${entry.id} on ${target} (milestone): no record`);
          continue;
        }
        const s = summary(record, entry.id);
        const invalidation = input.invalidations.find((i) => i.ids.includes(entry.id) && Date.parse(i.at) >= Date.parse(record.finishedAt));
        if (!s.passed) problems.push(`${entry.id} on ${target} (milestone): ${s.text} (run ${record.runId})`);
        else if (invalidation !== undefined) problems.push(`${entry.id} on ${target} (milestone): record ${record.runId} of ${record.finishedAt} is invalidated: ${invalidation.label} ${invalidation.reason}`);
        else if (entry.id === CERTIFICATION && (lastCertification === undefined || record.finishedAt > lastCertification.finishedAt)) {
          lastCertification = { runId: record.runId, commit: record.commit, finishedAt: record.finishedAt };
        }
      }
    }
  }
  const loginCommits = input.loginCommits(lastCertification?.commit);
  return { commit: input.commit, works: problems.length === 0, problems, ...(lastCertification === undefined ? {} : { lastCertification }), loginCommits };
}

export function renderRelease(report: ReleaseReport): string {
  const lines = [
    `# Release report for commit ${report.commit}: ${report.works ? "works" : "not working"}`,
    "",
    "Generated by `tests/compliance/tools/release.ts` (COMPL-REQ-006) from the evidence records under `validation/` and `validation/invalidations.md`.",
    "",
    `Targets judged: ${RELEASE_TARGETS.join(", ")}. The AWS target is ${DEFERRED}.`,
    "",
    "## Why not working",
    "",
    ...(report.problems.length === 0 ? ["Nothing outstanding."] : report.problems.map((p) => `- ${p}`)),
    "",
    "## Commits touching GOOGLE or login-provider interface files since the last certification",
    "",
    report.lastCertification === undefined
      ? "No certification recorded: all commits since the start of history are listed."
      : `Last certification: ${CERTIFICATION} run ${report.lastCertification.runId} at commit ${report.lastCertification.commit} (${report.lastCertification.finishedAt}).`,
    "",
    ...(report.loginCommits.length === 0 ? ["None."] : report.loginCommits.map((c) => `- ${c}`)),
  ];
  return `${lines.join("\n")}\n`;
}
