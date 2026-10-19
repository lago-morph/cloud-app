# Root cause: MIG-AC-001 "editing a generated migration makes the checker fail": control `verify` fails on `framework-ids`

Author: diagnosing subagent (prompt §8 step 1); did not write the code or the tests. Date: 2026-10-19. Diagnosis only: no code or test changed. Needs independent review (§8 step 2) before any fix.

## Tests explained
`packages/framework/test/integration/mig/generate.test.ts` › `[MIG-AC-001] editing a generated migration makes the checker fail (verify passes before the edit, fails after it)`. Only this test. It is unrelated to the `metadata.sqlite` cause (`2026-10-19-MIG-AC-002-metadata-sqlite-counted-as-d1-database.md`): generate.test never inspects D1 files.

## Symptom
Phase-B run (`validation/local/phase-B/05a-integration-vitest-json.log` lines 1823–1857): `AssertionError: verify must pass before the edit:` at `generate.test.ts:64`. The unedited control `verify` exits 1. Its output:
```
verify: type checking: passed
verify: portability rules
src/app.ts:19:11  error  id value the literal "00000000-0000-4000-8000-000000000001" is not from newId(); id() columns hold IDs from newId() only.  prototype-framework/framework-ids
src/app.ts:20:11  error  … "…-000000000002" …
src/app.ts:23:11  error  … "…-00000000000a" …
src/app.ts:24:11  error  … "…-00000000000b" …
src/app.ts:25:11  error  … "…-00000000000c" …
verify: portability rules: 5 problems
verify: migration checker: passed
verify: zod version: passed (4.6.7)
verify: tests (sqlite): passed (1 passed, 0 failed, 0 skipped)
verify: tests (postgres): passed (1 passed, 0 failed, 0 skipped)
verify failed: portability rules
```
Reproduced on this branch with `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/mig/`, with the same assertion and the same five diagnostics.

## Evidence
1. **The flagged lines are the fixture's seed inserts.** `mig/apps.ts` `ROUTES` (lines 21–30) is the `/seed` route. It contains `c.var.sql.insert(parents).values([{ id: "00000000-0000-4000-8000-000000000001", … }, { id: "…02", … }])` and `insert(children).values([{ id: "…0a", parentId: "…01", … }, { id: "…0b", … }, { id: "…0c", … }])`. In the generated `src/app.ts` (PRELUDE + table definitions + ROUTES) these are lines 19, 20, 23, 24 and 25. The five diagnostics are exactly the five `id:` literals. `parentId` literals (a `ref()` column) and the `eq(parents.id, "…02")` in `/fix-codes` (a `where`, not an insert) are not flagged.
2. **The rule does what the spec says.** `docs/components/check.md:79`: "`framework-ids`: in `insert(…).values(…)`, an `id()` column value that is a literal, a template, or a call or construction other than the framework's `newId` … is rejected". `docs/components/sql.md:49`: `id()` holds "UUID v4 from `newId()`; immutable". Implementation: `packages/framework/src/check/rules/framework-ids.ts`, `idValueProblem` (string literal → problem).
3. **Every other verify step passes** in the control run (symptom: type checking, migration checker, zod, tests in both dialects). The only failing step is portability rules, and all of its 5 problems are `framework-ids`.
4. **History.** The fixture was written in B-T2 (`2b6fb55`, 2026-10-19 20:52 UTC). The `framework-ids` rule was added later, in B-14 (`ed99a2d`, 21:47 UTC). When the fixture was written, `verify` did not have this rule.
5. **Confirming experiment** (temporary edit, reverted with `git checkout`, not committed): in `apps.ts`, import `newId` and replace the five seed `id:` literals with `newId()`. Change nothing else. `npx vitest run … mig/generate.test.ts` then gives **3 passed (3)**, exit 0: the control `verify` passes, and after the edit `verify` fails and names the edited migration. This shows that the migration checker's edit detection works and that the literals were the only obstacle.

## Cause → symptom chain
1. The shared MIG fixture app writes fixed UUID literals into `id()` columns in its `/seed` route (evidence 1).
2. CHECK's `framework-ids` rule rejects literal `id()` values in `insert().values()`, as check.md and sql.md require (evidence 2). It runs as `verify`'s portability-rules step.
3. So the unedited control `verify` exits 1 with exactly these 5 problems, and nothing else fails (evidence 3).
4. `generate.test.ts:64` requires the control run to exit 0, so the test fails before it reaches the edit (symptom).
5. Removing only link 1 makes the test pass (evidence 5).

## Code or test?
The test fixture is wrong. The code is not. The fixture's app breaks a rule the spec defines (check.md `framework-ids`, sql.md `id()` from `newId()`). DEC-0223 requires the control `verify` on the unedited scratch app to exit 0, so the scratch app must itself be a compliant app. The failure came from the fixture being written before B-14 added the rule (evidence 4).

## Alternatives ruled out
- **The migration checker misfiring on unedited files.** Ruled out: `verify: migration checker: passed` in the control run, and evidence 5.
- **The `framework-ids` rule being over-broad.** Ruled out. check.md:79 explicitly lists literals, and the rule flags only the `id()` keys in inserts, not `ref()` values or `where` comparisons (evidence 1).
- **The test needing zero tests or a different APP_TEST.** Ruled out. Both dialect test runs passed with 1 test (DEC-0223's zero-tests condition is met).
- **Shared cause with the deploy-local failures.** Ruled out. The deploy tests do not run `verify`, and their seed succeeded at run time (`POST /api/seed` → 204, `DATA_V1` matched before the D1-file assertion threw). generate.test does not read D1 files.

## Proposed fix (test fixture only)
Make the MIG scratch app compliant: the `/seed` route in `mig/apps.ts` generates IDs with `newId()`. Because `deploy-local.test.ts` compares against fixed `P1/P2/C1–C3` and `/fix-codes` updates parent 2 by ID, the seed route should return the IDs it created as JSON, for example `{ parents: [id1, id2], children: [ida, idb, idc] }`. The tests then build `DATA_V1`/`DATA_V2` from them (functions instead of constants). Sort the expected rows by `id` as the routes do, or change the routes to order by `name`/`label`. `/fix-codes` takes the parent ID in its request body: a `where` value, which the rule does not cover. Do not get around the rule by moving literals behind properties or `let` bindings, because sql.md requires IDs from `newId()`. No framework change.

## Verification plan (red-green, §8 step 3)
1. Red: the current fixture's control `verify` exits 1 with 5 `framework-ids` problems (as reproduced).
2. Green: with the fixture fix, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/mig/` passes all 6 tests. This also needs the `metadata.sqlite` fix from the other record for the deploy tests.
3. Check that the control `verify` output shows `portability rules: passed`, and that after the edit `verify` fails at `migration checker` and names the edited file.

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). Did not diagnose this failure or write the code or tests. Date: 2026-10-19. No code or test changed.

**Verdict: ACCEPTED.**

Reasons:
1. **Link 1 confirmed.** `mig/apps.ts` `ROUTES` writes five string-literal UUIDs into the `id` keys of `insert(parents).values(…)` and `insert(children).values(…)` in `/seed`. These are the five flagged positions.
2. **Link 2: the rule is correct per spec.** check.md:79 says: "`framework-ids`: in `insert(…).values(…)`, an `id()` column value that is a literal, a template, or a call or construction other than the framework's `newId` … is rejected". sql.md:49 says `id()` is "UUID v4 from `newId()`". `framework-ids.ts` `idValueProblem` returns a problem for `StringLiteral` and template literals and accepts only a framework-origin `newId` call. It inspects only `id()` keys of `values` objects and `id()` keys in `set`, so `parentId` (`ref()`) and the `eq(parents.id, …)` in `where` are correctly left alone. The rule is not over-broad. Suppression is not an option (`no-suppression-comments`), and the record correctly forbids moving the literals behind untraceable properties.
3. **Links 3–5.** The control output shows every other verify step passing. The history (fixture `2b6fb55` before rule `ed99a2d`) explains how this happened. The confirming experiment isolates the literals as the only obstacle.
4. **The question asked of this review: does seeding with `newId()` keep MIG-AC-001's test as strong as the criterion?** Yes.
   - **generate.test.** It never calls `/seed`. It only generates migrations and runs `verify`. MIG-AC-001 (one new migration per dialect; an edited migration makes the checker fail) and DEC-0223's control run are judged exactly as before, and the control run must still exit 0 on a now spec-compliant app. A compliant fixture is required for the control to be meaningful: a control that fails for an unrelated reason cannot isolate the edit.
   - **deploy-local (MIG-AC-002/-003).** The seed's IDs matter there. That suite uses `P1`/`P2`/`C1–C3` for `DATA_V1`/`DATA_V2` (`apps.ts:72–100`) and at `deploy-local.test.ts:200`, and `/fix-codes` targets parent 2 by a literal. The proposed fix keeps those tests as strong only if the expected data is built from the IDs the seed returns. Children a and b must still reference parent 1 and child c parent 2, so "every row and reference preserved" is still checked exactly. Sort order must not depend on random UUIDs: sort expected rows by `id` the same way, or order by `name`/`label`. The implementer should also assert that the seed returned five distinct IDs.
5. **The fix addresses the cause** (a fixture that breaks a spec rule), not the symptom. No framework change, and no rule relaxation.
