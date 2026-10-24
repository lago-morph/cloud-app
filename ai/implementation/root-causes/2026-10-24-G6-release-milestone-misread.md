# Root cause: G6. The release report for `1b474c1` misreads E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006 on Cloudflare as `not-run` from milestone run `0reagqr1j01rqfv`, which did not select them. `releaseReport` treats a record that lists an ID as "not selected for this run (--only)" as one that contains that ID.

Author: diagnosing subagent. I did not write the code under diagnosis. This is a diagnosis only: no code or test was committed, and no Cloudflare call was made.

Base: `origin/claude/implement-local-cloudflare` `ad0e252` (D-EV merge). Evidence: `validation/release/2026-10-24-1b474c1.md`, `validation/cloudflare/{0reagqr1j01rqfv,6e5ya5y8z05u4ce,e22y1n7jn93xoz4,xxiuurmy40pnr33,sysad9rajoir4yt}.json`, `ai/implementation/evaluations/D-cloudflare.md` §3 (G6), `final.md` §8.

A different subagent must review this record.

## Symptom
`validation/release/2026-10-24-1b474c1.md:145,150,244,246,249`:
- `E2E-010 on cloudflare (milestone): not-run: not selected for this run (--only) (run 0reagqr1j01rqfv)`, and the same line for E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006.

Their own milestone records are passed (PROV-AC-004: blocked). No verdict changes, because the report is "not working" for other reasons (no automated record for `1b474c1`).

## Evidence
E1. **The Cloudflare milestone records, newest first** (`finishedAt`, commit, selection):

| Run | Finished | Commit | `--only` |
| --- | --- | --- | --- |
| `0reagqr1j01rqfv` | 2026-10-24T05:15:51Z | `6417611` | COMPL-AC-008 |
| `6e5ya5y8z05u4ce` | 05:08:10Z | `6417611` | PROV-AC-003, PROV-AC-006 |
| `e22y1n7jn93xoz4` | 04:59:17Z | `6417611` | E2E-012 |
| `xxiuurmy40pnr33` | 04:53:53Z | `6417611` | E2E-010 |
| `sysad9rajoir4yt` | 03:51:16Z | `93e6d7d` | PROV-AC-004 |

E2. **Every milestone record lists every expected milestone ID**, including those it did not select. `0reagqr1j01rqfv.json` holds `{"id":"COMPL-AC-008","status":"passed"}` and, for each of the five IDs, `{"status":"not-run","detail":"not selected for this run (--only)"}`. The driver writes these entries: `tests/compliance/harness/driver.ts:125` (`select`) maps each runnable entry outside `--only` to `run: false, notRun: "not selected for this run (--only)"`. The string is a literal there and is not exported.

E3. **The generator picks the newest milestone record that has any entry for the ID.** `tests/compliance/tools/release.ts:94`:
```ts
const record = milestone.find((r) => r.target === target && r.results.some((x) => x.id === entry.id));
```
`milestone` is sorted newest first (`:76,78`). A "not selected" entry satisfies `x.id === entry.id`, so `0reagqr1j01rqfv` wins for all five IDs. `summary()` (`:68-72`) then sees `not-run` and `:101` writes the problem line.

E4. **The automated branch has the same test.** `release.ts:86` uses the same `r.results.some((x) => x.id === entry.id)` for automated records of the commit. An automated `--only` run at the same commit would shadow an earlier full run in the same way. Nothing in the current report shows this, because no automated record exists for `1b474c1`, but the fix should cover both lines.

E5. **The rule as written.** DEC-0264 (`docs/decisions/decision-log.md:2040`): "For each target, the latest record that contains an ID decides that ID." The evaluator (D-cloudflare §3) reads an entry the run never selected as not containing the ID. That reading matches the driver's own intent: the entry records that the run did not try the ID; it says nothing about the ID.

E6. **With not-selected entries skipped, each ID resolves to its own record** (computed over the five records above): E2E-010 → `xxiuurmy40pnr33` passed; E2E-012 → `e22y1n7jn93xoz4` passed; PROV-AC-003 and PROV-AC-006 → `6e5ya5y8z05u4ce` passed; PROV-AC-004 → `sysad9rajoir4yt` blocked (fresh-account clause); COMPL-AC-008 → `0reagqr1j01rqfv` passed. This matches final.md §7 §8.3. The Google milestone IDs (GOOGLE-AC-005 and others) still resolve to `0reagqr1j01rqfv`, because their entries carry "Google login mocked for this phase", not the not-selected detail; that is correct.

## Causal chain
1. The COMPL-AC-008 milestone run (`--only COMPL-AC-008`) writes not-selected `not-run` entries for every other milestone ID (E2, `driver.ts:125`), and it is the newest milestone record (E1).
2. → `release.ts:94` accepts a record for an ID if it has any entry for it, including a not-selected one (E3).
3. → `0reagqr1j01rqfv` decides E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006, and `:101` reports them `not-run` instead of reading their own records (E6).

## Alternatives ruled out
- **Wrong sort order.** `newestFirst` (`release.ts:66`) is correct; `0reagqr1j01rqfv` is newest by `finishedAt`, and the defect would remain with any order that puts it first.
- **The records are wrong.** The driver records the not-selected entries on purpose, so that a record lists every expected ID (DEC-0264 and the record format). The report generator, not the record, misreads them.
- **Target mix-up.** All six records are `target: "cloudflare"`; the AWS lines (`no record`) are correct (§8.2).

## Proposed fix (minimal, red-green)
1. Export the reason from one place that both sides already import, e.g. `export const NOT_SELECTED = "not selected for this run (--only)";` in `tests/compliance/harness/catalogue.ts` (already imported by `release.ts:11`, so `release.ts` does not pull in the driver's dependencies). Use it at `driver.ts:125`.
2. In `release.ts`, add `const selects = (r: EvidenceRecord, id: string): boolean => r.results.some((x) => x.id === id && !(x.status === "not-run" && x.detail === NOT_SELECTED));` and use it at `:86` and `:94` in place of `r.results.some((x) => x.id === entry.id)`.
3. In `summary()` (`:68-72`), ignore not-selected entries as well, so a record that selected one part of an ID is judged on its selected entries only. (Today the driver writes one not-selected entry per ID, so this is defensive.)
4. Update the DEC-0264 wording, or add a short decision: "An entry `not-run: not selected for this run (--only)` does not count as containing the ID."

**Red test** (add to `tests/compliance/tools/release.unit.test.ts`, under `[COMPL-AC-006]`). I ran it as a scratch file at `ad0e252` and removed it; it fails today with `+ "GOOGLE-AC-005 on cloudflare (milestone): not-run: not selected for this run (--only) (run m2)"`:
```ts
it("a newer milestone record that did not select an ID does not decide it", () => {
  const records = [
    ...allPassed("c1"), // r4: GOOGLE-AC-005 passed, milestone, 2026-10-19T09:00:00Z
    rec("cloudflare", "c0", [{ id: "GOOGLE-AC-005", status: "not-run", detail: "not selected for this run (--only)" }], { milestone: true, finishedAt: "2026-10-19T10:00:00Z" }),
  ];
  const report = releaseReport({ commit: "c1", catalogue, records, invalidations: [], loginCommits: noLoginCommits });
  expect(report.problems).toEqual([]);
  expect(report.lastCertification?.runId).toBe("r4");
});
```
Add the automated twin (E4): a newer `local` record for `c1` with `KV-AC-001` not selected must not shadow the passed one.

## How the fix will be verified
- `npx vitest run tests/compliance/tools/release.unit.test.ts`: the new tests red, then green; existing tests unchanged.
- `node tests/compliance/tools/report.mjs release --commit 1b474c1` (offline, no Cloudflare call): lines `:145,150,244,246,249` of the current report disappear except PROV-AC-004, which reads `blocked: … (run sysad9rajoir4yt)`. The verdict stays "not working".

## Review
