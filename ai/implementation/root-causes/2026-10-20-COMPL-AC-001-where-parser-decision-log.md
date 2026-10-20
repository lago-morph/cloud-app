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

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this failure or write the driver, the C-T5 tests or DEC-0319. No code, test or doc was changed. No Cloudflare call was made.

**Verdict: ACCEPTED**, subject to the fix requirements below. They tighten the proposed fix; they do not change the cause.

### Links checked
- **Symptom → module-load failure.** `targets.test.ts:22` calls `const where = whereSets();` inside the `describe` callback, which runs during collection. A throw there fails the whole file. Confirmed.
- **Link 1 (`f42b382` brings the table into `docs/`).** `git log -S'lost its tag as untested." Names'` lists `ec78fa5` and `f42b382` (plus this record's own commit, `ab50ab0`). `1b2577e` is an ancestor of `f42b382`. `grep "^| [A-Z]*-AC-[0-9]\{3\} |"` over `docs/` finds 130 rows: 124 sit directly under one of the 20 `| ID | Criterion | Verifies | Where |` headers (checked with awk, counting a table from its header to the first line that does not start with `|`), and the other 6 are DEC-0319's rows at decision-log.md:2493–2498. No other stray criterion-ID rows exist anywhere in `docs/`. Confirmed.
- **Links 2–3 (the test's reader takes the last cell of any width; `readWhere` throws).** I reproduced this independently. I extracted `markdown`/`readWhere`/`whereSets` verbatim from `support.ts` and copied `catalogue.ts` verbatim to `scratchpad/rv/`, then ran them with `node --experimental-strip-types`:

  | docs tree | `whereSets` | `readCatalogue` |
  | --- | --- | --- |
  | branch HEAD | throws `decision-log.md: unexpected target "\"a unit test of the report generator …` | OK, 140 |
  | HEAD, DEC-0319 rows widened to 3 columns | throws `unexpected target "extra"` | throws `COMPL-AC-002 is defined twice: in components/compliance.md and decisions/decision-log.md` |
  | HEAD without decision-log.md | OK (local automated 109) | OK, 140 |

  This confirms the record's items 3, 5 and 7. The driver skips the rows today only because `ROW` needs at least three cells.
- **Alternatives.** "The entry is malformed" is correctly ruled out. Nothing in CONVENTIONS forbids a decision from tabulating the IDs it affects (§3), and DEC-0319's `Affects:` list names them. Flakiness is ruled out because the result is a pure function of the docs tree. The driver/test divergence is correctly described as one shared latent defect.

### Is the header rule correct per CONVENTIONS.md?
`docs/CONVENTIONS.md` does **not** define the format of an acceptance-criterion table. §2 defines only the ID format, §3 the `Verifies:` link, and §7 the document set. So the rule is not "per CONVENTIONS"; it is the **de facto format of every defining document**, which COMPL-AC-001 ("the criteria's "Where" columns and the scenarios' "Where" lines") and compliance.md "Driver" ("from the Where columns and lines") rely on. The record's item 4 says this accurately. The rule finds every criterion: all 124 criterion rows are under the header, and none are elsewhere (link 1 check). Together with the 16 scenarios that makes 140, the same as the driver's catalogue. e2e-scenarios.md has no criteria tables: it defines scenarios as `#### E2E-nnn` headings with a `Where:` line (its preamble, line 10), so the header rule does not touch it. The scenario rule must be kept separately, as the record proposes. CONVENTIONS §7 independently supports the scope: criteria live in the component design documents and `demo/`, scenarios in `acceptance/`, and `decisions/decision-log.md` holds "all recorded decisions", not criteria.

### Header rule or directory exclusion?
Use the header rule, not a directory exclusion such as "skip `docs/decisions/`". An exclusion fixes only this instance. A component design document, `parameters.md` or a plan under `docs/` can tabulate criterion IDs just as well. compliance.md already names many IDs in prose, and a table there would break both readers again. The header rule ties recognition to what makes a row a definition: a row of a criteria table with a Where column. Do not add a directory allowlist on top. It would duplicate the rule and could silently drop a new defining document.

### Fix requirements (binding on the fix subagent)
1. **One stated rule, two independent implementations.** A row defines a criterion only when it is a body row of a table whose header row has the cells `ID`, `Criterion`, `Verifies`, `Where`, in that order, compared cell by cell after trimming, with the `| --- |` separator row next. The table ends at the first line that does not start with `|`. Take the ID from the `ID` cell and the Where text from the `Where` column by index, not from "the last cell". Implement this in `support.ts` `whereSets` and in `catalogue.ts` `readCatalogue` separately. The test must still share no code with the harness.
2. **No silent drops.** Silently losing a criterion is worse than the current throw. In both readers, a body row inside a recognised criteria table whose first cell is not `<AREA>-AC-NNN`, or whose cell count differs from the header's, must throw with the file and line. A header row whose first two cells are `ID | Criterion` but which lacks the `Where` column must also throw. Rows outside criteria tables are ignored, whatever their width.
3. **Scenarios unchanged.** Keep the `#### E2E-nnn` + `Where:` rule as it is. It is not affected by this fault. (Optional hardening, not required: the same latent class exists if a decision ever quotes a `#### E2E-` heading. If it is hardened, both readers must do it the same way.)
4. **Red first, both readers.** (a) Add a test for `whereSets` on a fixture docs tree (a temp dir, not the real `docs/`) containing a criteria table plus a two-column `| COMPL-AC-002 | prose |` table elsewhere. It must fail on the current code with the `unexpected target` error. (b) Add a `catalogue.unit.test.ts` case on a fixture containing a criteria table plus a three-column ID table elsewhere. It must fail now with "defined twice". (c) For requirement 2, add a case where a malformed row inside a criteria table throws. All of these must pass after the fix.
5. **Equivalence on the real docs.** After the fix, `readCatalogue(docs)` returns the same 140 IDs and the same `applies` as before. `whereSets(docs)` matches it per target and tier (local automated 109, as reproduced above with the log removed). The record's Verification steps stand, including loading `targets.test.ts` and re-running E-RUN's local compliance command.
6. **No doc change is required.** DEC-0319's table stays as written. The fix subagent records the rule in the decision draft for the fix, because the driver's catalogue rule changes. Stating it in compliance.md "Driver" is left to the owner.

## Fix

Fix subagent (prompt §8 step 3), branch `claude/implement-local-cloudflare-fix-e2` from `origin/claude/implement-local-cloudflare` (`25eb37d`). Local only; no Cloudflare call. `tests/compliance/harness/driver.ts` not touched.

**Change (Review fix requirements 1–3, 6).** Both readers now apply the stated rule. They are written separately, and the test still imports nothing from the harness:
- `tests/compliance/harness/catalogue.ts` `readCatalogue`: `ROW` is gone. A criterion is a body row of a table whose header cells are exactly `ID | Criterion | Verifies | Where` (trimmed), with a `| --- |` separator row next. The table ends at the first line that does not start with `|`. The ID and Where cells are read by column index, and an escaped `\|` does not split a cell. Inside a criteria table, a row whose cell count differs from the header's, or whose ID cell is not `<AREA>-AC-NNN`, throws `<file>:<line>: …`. An `ID | Criterion …` header of any other shape, or one with no separator after it, also throws. Rows outside criteria tables are ignored. The scenario rule is unchanged.
- `tests/compliance/criteria/compl/support.ts` `whereSets`: the same rule, implemented independently. It throws `<abs file>:<line>: …` in the same cases.
- Decision draft `ai/implementation/decisions/fix-e2.md` (DEC-0408) records the rule. No doc change; DEC-0319 stays as written.

**Red (`251737e`)**, requirement 4. New tests on temp-dir fixture trees:
- `support.unit.test.ts`: a two-column `| COMPL-AC-002 | prose |` table, which failed with `unexpected target …`; three- and four-column ID tables under other headers, which were wrongly read; and four malformed cases (a non-ID first cell, too few cells, too many cells, and an `ID | Criterion | Verifies` header), none of which threw.
- `catalogue.unit.test.ts`: two-, three- and four-column ID tables in `decisions/decision-log.md`, which failed with `KV-AC-001 is defined twice`; and the same malformed cases, none of which threw.

All 11 new tests failed. The existing catalogue fixtures `cloudflare.md`, `aws.md` and `dup.md` gained the criteria-table header that the rule requires.

**Green.** Both files now pass, 25/25. `npm run verify` exits 0: 176 test files and 1650 tests passed.

**Equivalence on the real `docs/` (requirement 5).** I used the scratchpad scripts `e2/dump.ts` and `e2/summ.cjs`. The baseline is the pre-fix `readCatalogue(docs)`, plus the pre-fix `whereSets` on `docs/` with `decision-log.md` removed, because the pre-fix reader throws on the real tree. After the fix, both readers run on the real `docs/`:

| | before | after |
| --- | --- | --- |
| catalogue IDs | 140 (124 AC, 16 E2E) | 140, identical list |
| catalogue (id, where, source, applies) | — | identical |
| whereSets automated local / cloudflare / aws | 109 / 70 / 74 | 109 / 70 / 74, identical sets |
| whereSets milestone local / cloudflare / aws | 2 / 12 / 12 | 2 / 12 / 12, identical sets |
| whereSets vs catalogue, per target and tier | equal | equal |

**Run.** `npm run compliance -- --target local --only COMPL-AC-001,COMPL-AC-003,E2E-004 --out <scratchpad>/e2/run` gave: `106 not-run, 2 passed, 1 failed`, exit 1.
- `targets.test.ts` now loads. Its two COMPL-AC-001 tests pass, and the five COMPL-AC-003 tests pass.
- E2E-004 failed on its coverage part: "applicable on local but no tagged test in this target's suite: DEMO-AC-001 … DEMO-AC-011, E2E-002". Its record part passed. This failure is not caused by this fix. The catalogue is unchanged (table above), and `git grep` finds no test file tagged with any DEMO-AC ID or with E2E-002, so the coverage check is reporting a real gap in the test suite. The failure was hidden before because `targets.test.ts` failed to load first. It needs its own §8 diagnosis.
