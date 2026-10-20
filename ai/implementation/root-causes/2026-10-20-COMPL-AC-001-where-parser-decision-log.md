# Root cause: COMPL-AC-001 — the test's Where reader treats a two-column table in the decision log (DEC-0319) as a criteria row

Author: diagnosing subagent (prompt §8 step 1). I did not write the driver, the C-T5 tests or the decision-log entry. This is a diagnosis only: no code, test or doc was changed. It needs independent review (§8 step 2) before any fix.

## Symptom
E-RUN at `4d73f39` (`validation/local/phase-E-run/SUMMARY.md` line 37 ff., `raw/05-compliance-local.log` line 220 ff., `validation/local/2au29i3yycjzbas/raw/run-errors.log`):

```
FAIL  tests/compliance/criteria/compl/targets.test.ts [ tests/compliance/criteria/compl/targets.test.ts ]
Error: …/docs/decisions/decision-log.md: unexpected target "\"a unit test of the report generator shows a criterion whose test has lost its tag as untested.\" names a unit test." in Where "\"A unit test of the report generator shows a criterion whose test has lost its tag as untested.\" Names a unit test."
 ❯ tests/compliance/criteria/compl/support.ts:170:13
 ❯ tests/compliance/criteria/compl/targets.test.ts:22:17
```

`targets.test.ts` calls `whereSets()` at module level (line 22), so the throw stops the file from loading. The integration Vitest run then reports a failed suite, and the driver exits 1, even though none of the selected IDs lives in that file.

## Evidence
1. **The text.** `docs/decisions/decision-log.md` line 2493 is in DEC-0319's table "ID | Why unit-level (criterion text)", lines 2491–2498:
   `| COMPL-AC-002 | "A unit test of the report generator shows a criterion whose test has lost its tag as untested." Names a unit test. |`
   The five rows after it (COMPL-AC-007, GOOGLE-AC-002, PROV-AC-007, CLI-AC-003, COMPL-AC-006) have the same shape. These are the only `| <AREA>-AC-NNN |` rows in the decision log (`grep -n "^| [A-Z]*-AC-[0-9]\{3\} |"`).
2. **The commit that introduced it.** `git log -S'lost its tag as untested." Names'` shows two commits. `ec78fa5` (fix-c3) added the table to a draft under `ai/implementation/decisions/`, outside `docs/`, where nothing parses it. `f42b382` ("CDE-INT: integrate phase C/D/E decision drafts as DEC-0319…DEC-0390") moved it into `docs/decisions/decision-log.md`. C-T5's `support.ts` came earlier, in `1b2577e`, which is an ancestor of `f42b382`.
3. **The test's reader** (`support.ts` `whereSets`, lines 179–199) walks every `.md` under `docs/`. Any line that starts with `|` and whose first cell matches `^[A-Z]+-AC-\d{3}$` counts as a criterion row, and its **last cell** is read as the Where text. This holds for a table of any width. `readWhere` (line 170) throws on any comma-separated token other than `local` or `cloud`. In a two-column row, the last cell is the prose cell, so the reader throws.
4. **The test's own stated scope is narrower.** The section header (line 140) says "component criteria tables; e2e-scenarios.md "Where:" lines". COMPL-AC-001 says "the criteria's "Where" columns and the scenarios' "Where" lines". The e2e-scenarios.md preamble (line 10) says "as the "Where" column does for component criteria". In the 20 documents that define criteria (19 under `docs/components/`, plus `docs/demo/demo-spec.md`), every criteria table has the header `| ID | Criterion | Verifies | Where |`. There are 20 such headers, and they hold 124 rows, which with the 16 scenarios gives 140 IDs. The decision log defines no criterion. It only refers to criteria, and CONVENTIONS §3 lets a decision name the items it affects.
5. **Reproduction.** I copied `support.ts` and `harness/catalogue.ts` verbatim to the scratchpad (`…/scratchpad/repro/`) and ran them with `node --experimental-strip-types` (no other code involved):

   | docs tree | test `whereSets` | driver `readCatalogue` |
   | --- | --- | --- |
   | HEAD (`8a7b790`, same docs as `4d73f39`) | throws (message above) | OK, 140 entries |
   | decision log from `f42b382^` | OK | OK, 140 |
   | decision log from `f42b382` | throws | OK, 140 |
   | HEAD with the decision log removed | OK | OK, 140 |
   | `f42b382` log plus one row `\| COMPL-AC-002 \| x \| y \| Local \|` | throws | **throws**: "COMPL-AC-002 is defined twice: in components/compliance.md and decisions/decision-log.md" |
6. **The driver and the test agree on the defining documents.** With the decision log removed, `compare.ts` (scratchpad) compares per target and tier: local automated 109/109, local milestone 2/2, cloudflare 70/70 and 12/12, aws 74/74 and 12/12. There are 0 differences.
7. **Why the driver survives today.** `catalogue.ts` `ROW = /^\|\s*((?:[A-Z]+-AC)-\d{3})\s*\|.*\|\s*([^|]*?)\s*\|\s*$/` needs at least three cells, and DEC-0319's rows have two. The driver also walks every `.md` under `docs/`, including the decision log (`readCatalogue`, `markdownFiles`). It has no rule restricting it to criteria tables either. It passes only because of the row width (item 5, last row).

## Chain (each link evidenced)
1. `f42b382` puts a two-column table into `docs/decisions/decision-log.md` whose first cells are criterion IDs (items 1, 2).
2. The test's reader scans all of `docs/`, takes any `| X-AC-NNN |` row at any width, and reads its last cell as Where (item 3).
3. That last cell is prose, so `readWhere` throws at `support.ts:170` (items 3, 5).
4. `whereSets()` runs at module load in `targets.test.ts:22`, so the file fails to load and the driver's integration run exits 1 (symptom).

## Alternatives considered
- **The decision-log entry is malformed.** Ruled out. Nothing in `docs/CONVENTIONS.md` or the decision log's format forbids a table that names criterion IDs. Decisions routinely name the items they affect, and the entry is correct content. Rewording it would only hide the fault: the next decision that tabulates IDs would break the test again, or break the driver if the table has three or more columns (item 5).
- **The driver's Where parsing has the same problem.** Partly. It reads the same documents, and on the defining documents it gives identical results (item 6), so there is no current divergence in what the two count as applicable. Both share one latent defect: neither restricts itself to criteria tables, and they differ only in which stray rows they accept (two columns: the test throws and the driver ignores the row; three or more columns: both take the row). Today the driver's output is correct (140 IDs, matching item 4).
- **Flaky or environmental.** Ruled out. The failure is deterministic and reproduces from a pure function of the docs tree (item 5).

## Fix (proposed; for review)
1. **Test (`tests/compliance/criteria/compl/support.ts`, `whereSets`).** Recognise a criteria row only inside a table whose header row is `| ID | Criterion | Verifies | Where |`, which is the format of every component criteria table (item 4). A table starts at its header row and ends at the first line that does not start with `|`. Take the Where text from the `Where` column of that table. Keep the `#### E2E-nnn` / `Where:` rule as it is. The test stays independent of the driver: it shares no code and states its own rule from the docs. Red first: add a unit-style check, or a fixture docs tree in a test, containing a two-column `| COMPL-AC-002 | prose |` table outside a criteria table. It must fail on the current reader and pass after the fix.
2. **Driver (`tests/compliance/harness/catalogue.ts`, `readCatalogue`), as hardening of the same latent defect (item 5, last row).** Apply the same rule: a row counts only under a `| ID | Criterion | Verifies | Where |` header. Add to `catalogue.unit.test.ts` a case with a three- or four-column ID table outside a criteria table, which must not be read as a definition. This is red now: it is reported as "defined twice". It keeps the driver and the test on one stated rule, so they cannot diverge again.

No doc change is needed. Optionally, compliance.md "Driver" could state that criteria are read from tables with that header. That needs owner wording and is not required for the fix.

## Verification
- The new red tests fail before the fix and pass after it.
- `node --experimental-strip-types` with the scratchpad `repro.ts` on the real `docs/`: both readers succeed. With `compare.ts`: 140 entries and 0 differences per target and tier, the same as with the decision log removed (item 6).
- `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/compl/targets.test.ts` loads the file and runs its tests.
- Re-run E-RUN's local compliance command. The driver must not exit 1 for a suite load failure.
