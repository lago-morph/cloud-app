# Root cause: COMPL-AC-001: SETUP-AC-011 is a milestone item by its Where column, but COMPL-REQ-006's list of milestone items was never amended to name it

Author: diagnosing subagent for P0 (plan-v0.2.0 §7a.1.8 step 1, prompt §8 step 1). I did not write COMPL-AC-001's test, the SETUP spec (DEC-0603) or COMPL-REQ-006's amendments. This record is a diagnosis only: I changed no code, test or doc. It needs an independent review before any fix.

Base: `origin/main` at `1e0c289`. Node 22.23.4. Chromium shim per progress-v0.2.0 §6.

## Symptom
`npm run compliance -- --target local --only COMPL-AC-001,MAIL-AC-005,CORE-AC-002,HTTP-AC-002,SEC-AC-001,SEC-AC-002,E2E-013` (record `y6qa0drbpq3riqs`) fails one of COMPL-AC-001's two tests, the milestone tier. The automated tier passes:

```
FAIL  tests/compliance/criteria/compl/targets.test.ts > compliance runs per target > [COMPL-AC-001] one command lists, for each target, exactly the milestone criteria and scenarios the Where columns and lines name
AssertionError: expected [ 'COMPL-AC-008', 'E2E-010', …(10) ] to deeply equal [ 'COMPL-AC-008', 'E2E-010', …(9) ]
@@ -7,7 +7,8 @@
    "MAIL-AC-007",
    "PROV-AC-002",
    "PROV-AC-003",
    "PROV-AC-004",
    "PROV-AC-006",
+   "SETUP-AC-011",
    "SKILL-AC-006",
  ]
 ❯ tests/compliance/criteria/compl/targets.test.ts:74:37
```

**Correction to the baseline's wording.** Progress §6 says "the milestone listing returns 10 items where the test expects 9". Vitest's `…(n)` counts the elements *after* the two it prints. So the listing actually has **12** items and the expected list has **11** (evidence item 2). The only difference is SETUP-AC-011.

## Evidence
1. **The assertion.** `targets.test.ts:70–74` (milestone tier): `named` is the set of IDs that COMPL-REQ-006's milestone sentence names (`support.ts` `milestoneItemsNamed`, lines 240–246: the **last** sentence in `docs/components/compliance.md` matching `The milestone items (of release 1 )?are (therefore )?…`), filtered to IDs that have a milestone Where on local or cloudflare. `union` is the union of the IDs listed by the nested runs `npm run compliance -- --target <local|cloudflare> --milestone --blocked '*=…'`. The test asserts `union == named`. DEC-0322 (decision log, Item C-T5) defines the clause this way: "the union of the … milestone runs' lists equals COMPL-REQ-006's named list".
2. **The two lists, reproduced outside Vitest.**
   - **The driver's lists.** I ran the exact nested commands from `targets.test.ts:36` on the worktree (scratchpad `compl/scripts/nested.sh`; both exit 0):
     - local: 2 items, `E2E-015 E2E-016`;
     - cloudflare: 11 items, `COMPL-AC-008 E2E-010 E2E-012 E2E-015 MAIL-AC-007 PROV-AC-002 PROV-AC-003 PROV-AC-004 PROV-AC-006 SETUP-AC-011 SKILL-AC-006`.

     Their union is 12 items.
   - **The test's oracle.** `support.ts` `whereSets` and `milestoneItemsNamed`, imported unchanged by the scratchpad `compl/scripts/milestone.ts` (`node --experimental-strip-types`), on `docs/` at `1e0c289`:
     - the sentence names 11 IDs;
     - the Where milestone union has 12 IDs;
     - in Where but not in the sentence: `SETUP-AC-011`;
     - in the sentence but not in Where: none.
3. **The Where column.** `docs/components/setup.md:90`, row SETUP-AC-011, has Where `Cloud (milestone)`. This has been so since the row was added in `2a13e5f` (2026-10-26, "Spec: SETUP component and criteria … decisions DEC-0598..0604"). The later edit `b8b7f79` changed only the text. DEC-0603 says "SETUP-AC-011 (Cloud, milestone: plan §6's live pass)".
4. **The milestone sentence was not amended.** The last matching sentence is `compliance.md:55` (Amendment DEC-0560, commit `889ffed`, 2026-10-25, before SETUP existed): "The milestone items of release 1 are therefore E2E-015, E2E-016 (review part), SKILL-AC-006, … PROV-AC-006, MAIL-AC-007 and COMPL-AC-008." `2a13e5f` added only the "Tokens the harness is given" paragraph to compliance.md (`git show 2a13e5f -- docs/components/compliance.md`). DEC-0603's `Affects:` list does not name compliance.md or COMPL-REQ-006.
5. **Bisection on the docs tree** (same `milestone.ts`, docs extracted with `git archive`):

   | docs tree | in Where, not in the sentence | in the sentence, not in Where |
   | --- | --- | --- |
   | `2a13e5f^` | none (11 = 11) | none |
   | `2a13e5f` | SETUP-AC-011 | none |
   | `1e0c289` | SETUP-AC-011 | none |
   | `1e0c289` + "…, MAIL-AC-007, COMPL-AC-008 and SETUP-AC-011." in a new last sentence (scratch copy) | none (12 = 12) | none |

6. **It was green before.** Local record `validation/local/htth52fbl34gzk7.json` (commit `2855407`, 2026-10-25) has COMPL-AC-001 `passed`. No test or support file under `tests/compliance/criteria/compl/` changed between `2855407` and `1e0c289` (`git log 2855407..1e0c289 -- tests/compliance/criteria/compl/` is empty). The only input that changed is the docs tree (item 5).
7. **Why it went unnoticed.** COMPL-AC-001 is integration-layer (`vitest.integration.config.ts` includes `tests/compliance/criteria/**/*.test.ts`) and runs only through the driver. `2a13e5f` updated the unit-layer catalogue counts (`catalogue.unit.test.ts`), which pass. No local compliance record covering COMPL-AC-001 was committed after 2026-10-26 (the latest local record, `zouaxszod98yyh1` at `feab5a2`, ran with `--only` and lists COMPL-AC-001 as not selected).

## Causal chain (each link evidenced)
1. `2a13e5f` adds SETUP-AC-011 with Where `Cloud (milestone)` (item 3).
2. The same commit leaves COMPL-REQ-006's last "milestone items of release 1 are therefore …" sentence unchanged, so the sentence does not name SETUP-AC-011 (item 4).
3. The driver derives its milestone listing from the Where columns, so `--target cloudflare --milestone` lists SETUP-AC-011 (item 2).
4. The test's `named` comes from the sentence, so it lacks SETUP-AC-011, and `union` has one more element (items 1, 2). The assertion at `targets.test.ts:74` fails. Adding the ID to the sentence alone makes the sets equal (item 5, last row).

## Alternatives ruled out
- **The test is wrong.** Ruled out. DEC-0322 defines the milestone clause as "union equals COMPL-REQ-006's named list". The test implements exactly that, and it is unchanged since it last passed (item 6). It caught a real disagreement between two normative texts.
- **SETUP-AC-011's Where is wrong (it should be automated).** Ruled out. It needs a real account and a bootstrap token that the owner made for the run (setup.md:90; DEC-0603 "Cloud, milestone: plan §6's live pass"; DEC-0604). An automated pass may not change the account's shared resources (DEC-0560). It is a milestone item by design.
- **The driver lists the wrong set.** Ruled out. The driver's union equals the test's own `whereSets` milestone union (item 2), so they agree about the Where texts.
- **"10 vs 9" means two IDs differ.** Ruled out. The lists are 12 and 11, with exactly one difference (Symptom, item 2).
- **Flaky or environmental.** Ruled out. The result is a pure function of the docs tree (item 5).

## Similar cases (input for §7a.1.8 step 4)
The same comparison finds no other ID whose Where marks it as a milestone item but which COMPL-REQ-006 does not name, and none the other way round (item 2). The defect pattern is "a spec commit adds a `(milestone)` Where and leaves COMPL-REQ-006 unchanged". It recurs whenever v0.2.0 adds or removes milestone items: item D adds the real sign-in (plan §6.1 item 4), and B and D remove MAIL-AC-007 (plan §6, §7 "MAIL-AC-007 leaves the milestone list").

## Proposed fix
- **`docs/components/compliance.md`, COMPL-REQ-006.** Append a new amendment paragraph after line 55, so that it is the last matching sentence. For example: "Amendment (Origin: ai-proposed · Decision: DEC-0778): SETUP-AC-011 (DEC-0603), the live setup pass on a real account, is a milestone item (its Where column). The milestone items of release 1 are therefore E2E-015, E2E-016 (review part), SKILL-AC-006, and the stage-lifecycle and account criteria E2E-010, E2E-012, PROV-AC-002 (signing-credential clause), PROV-AC-003, PROV-AC-004, PROV-AC-006, MAIL-AC-007, COMPL-AC-008 and SETUP-AC-011."
  - This follows the style of DEC-0526 and DEC-0560.
  - compliance.md is a shared file (progress §2), so the edit is serialised with other items.
- **Decision draft `ai/implementation/decisions/v020-P0.md`.** Add DEC-0778, recording the amendment and its reason. Only INT items edit the decision log (progress §2).
- **No code or test change.**
- **Requirement on item D.** D's rewrite of COMPL-REQ-006 (plan §6.1 item 4) must keep SETUP-AC-011 in the list unless a decision retires SETUP-AC-011. The v0.2.0 plan does not retire it (no `SETUP-` mention in plan-v0.2.0). When MAIL-AC-007 leaves (B and D), the same sentence must drop it in the same change, or COMPL-AC-001 goes red again.
- **Retired by v0.2.0?** No. SETUP and COMPL-AC-001 both stay in v0.2.0.

## Verification plan
- **Red now:** `npm run compliance -- --target local --only COMPL-AC-001` fails as in Symptom. This is the reproduction test, so no new test is needed: the existing criterion test is the red test.
- **Commit the docs change before re-running.** `cloneAtHead()` clones HEAD, so an uncommitted edit is invisible to the nested runs.
- **Green after the fix:** the same command passes both COMPL-AC-001 tests. The scratchpad `milestone.ts` on the new `docs/` shows 12 = 12 and no differences either way.
- `npm run test:unit` is unchanged. The catalogue counts do not change, because no Where column changes.

## Review
(pending: independent root-cause reviewer)
