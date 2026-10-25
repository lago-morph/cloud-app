# Root cause: G6. The release report for `1b474c1` misreads E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006 on Cloudflare as `not-run` from milestone run `0reagqr1j01rqfv`, which did not select them. `releaseReport` treats a record that lists an ID as "not selected for this run (--only)" as one that contains that ID.

**Archived 2026-10-25** to branch `archive/implement-local-cloudflare` (same paths; `ai/ARCHIVE.md`, then `ARCHIVE-INDEX.md` there): the record `sysad9rajoir4yt` (`validation/cloudflare/sysad9rajoir4yt.json` and `raw/`) cited below.

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

**Red test** (add to `tests/compliance/tools/release.unit.test.ts`, under `[COMPL-AC-006]`). I ran it as a scratch file at `ad0e252` and removed it; it fails today with `+ "GOOGLE-AC-005 on cloudflare (milestone): not-run: not selected for this run (--only) (run r5)"` (the fixture's `rec()` numbers runs, so the extra record is `r5`; corrected per the Review):
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
- `npx vitest run tests/compliance/tools/traceability.unit.test.ts`: the new `[COMPL-AC-002]` test red, then green.
- `node tests/compliance/tools/report.mjs traceability` (offline, no Cloudflare call): the Cloudflare cells for E2E-010, E2E-012, PROV-AC-003 and PROV-AC-006 show `passed` from their own records, PROV-AC-004 shows `blocked` from `sysad9rajoir4yt`, and the GOOGLE "Google login mocked for this phase" cells are unchanged.

## Review
Reviewer: independent root-cause reviewer (§8). I did not write this diagnosis or the code under it. Base: `origin/claude/implement-local-cloudflare` `6ef43dc`. No Cloudflare call; the only file changed is this record. The red tests below ran from a scratch test file in `tests/compliance/tools/`, which I deleted afterwards (nothing else in the tree changed).

**Verdict: cause confirmed. Fix accepted only with the required changes below.** As proposed it is not complete.

**Cause: confirmed.** `driver.ts:125` (`select`) turns every runnable entry outside `--only` into `run: false, notRun: "not selected for this run (--only)"`. `results.ts:56` writes that as one `{status: "not-run", detail: <that string>}` entry. `release.ts:86` and `:94` accept a record for an ID when it has any entry with that ID. `summary()` (`:68-72`) then reports the `not-run`. E1 to E6 match the code. The sort order (`:66`) and the target filter are correct, as the record says.

**Red test: confirmed red at `6ef43dc`, for the reason given.** Both proposed tests fail today:
- milestone: `+ "GOOGLE-AC-005 on cloudflare (milestone): not-run: not selected for this run (--only) (run r5)"`;
- automated twin (a newer `local` `c1` record with `KV-AC-001` not selected): `+ "KV-AC-001 on local: not-run: not selected for this run (--only) (run r5)"`.

The record quotes the failure as `(run m2)`. The fixture's `rec()` numbers runs, so the extra record is `r5`. Correct the quote.

**Cannot hide a genuine result: confirmed**, as long as the match is exact (`status === "not-run" && detail === NOT_SELECTED`, never a prefix or `includes`). Why:
- `criterionResults` writes that detail only from `entry.notRun`, and only `select` sets it to that string.
- Every other `not-run` detail is different: the expected-rules reasons such as "Google login mocked…", "no test tagged…", "N tagged tests skipped…", `<part>: <detail>` and the setup-failure reason.
- The setup-failure rewrite (`driver.ts:290`) and `--blocked` touch only `run: true` entries, so they never carry or overwrite the not-selected detail.
- Skipping a not-selected entry never makes an ID pass. With no other record, the line becomes "no record" (still a problem). Otherwise the record that actually ran the ID decides it.
- `summary()`, step 3, can only drop entries from a record that `selects()` already accepted for a run entry, so it cannot turn a failure into a pass.

**Required changes before implementation:**
1. **Traceability has the same defect, and the fix must cover it.** `tests/compliance/tools/traceability.ts:51-56` (`describeResults`) and the loop at `:68-80` take the newest record per target that has any entry for the ID. That is DEC-0265's "latest result per target". The traceability report therefore shows E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006 on Cloudflare as `not-run: not selected for this run (--only)`. A scratch test confirmed it: `buildTraceability` output contains the string when a newer record did not select the ID. Use the same exported predicate in `describeResults`: return `undefined` when no selected entry exists. Add a red test under `[COMPL-AC-002]` in `traceability.unit.test.ts`.
2. **Use a single predicate.** Put `NOT_SELECTED` and a `selectedEntries(record, id)` (or `isNotSelected(result)`) helper in `harness/catalogue.ts`, or in a small evidence module that release.ts, traceability.ts and driver.ts all import. Use it at `release.ts:86`, `:94`, in `summary()` and in `traceability.ts`. `driver.ts:125` and `driver.unit.test.ts:148-149` should use the constant, so that rewording the string cannot silently bring the bug back. Records already on disk use the exact current literal (unchanged since `adcd016`), so keep the value byte-identical.
3. **Write the rule down in the decisions, not only in the code.** Amend DEC-0264 to say "contains an ID" means "has an entry for the ID other than `not-run: not selected for this run (--only)`". Say the same in DEC-0265 ("latest result per target"). Cross-reference DEC-0261 (`decision-log.md:2022`), where the entry is defined. Amend these decisions instead of adding a new one.
4. **Verification:** add `node tests/compliance/tools/report.mjs traceability` (offline). The Cloudflare cells for the five IDs must show their own records: passed, and blocked for PROV-AC-004. The GOOGLE "mocked" cells must stay unchanged.

Not required: changing the driver or the records. The not-selected entries are correct evidence of what the run did not try.
