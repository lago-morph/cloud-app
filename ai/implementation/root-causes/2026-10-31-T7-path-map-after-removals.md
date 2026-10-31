# Root cause: after B's auth-provider stack merged into E's admin-app stack (PR #127), three `tests/ci-classify.unit.test.ts` tests fail. S3's CI path map (E's stack) still names what B's stack removed (MAIL's criteria tests, E2E-007's spec) and the §3 dependencies that D (inside B's stack) changed. Neither stack contained both sides.

Author: item T7 (diagnosis, §7a.1.8 step 1), 2026-10-31. Branch `origin/v0.2.0/71m-merge-auth-provider-into-admin-app` (PR #127, head `39c87a0`), which merges B's top `v0.2.0/42-drop-auth-mail-tables` (PR #124) into E's top `v0.2.0/61a-admin-app-ci` (PR #120). The merge had no textual conflicts. Merge base: `8442136`.

## Symptom
After `npm ci`, `npx vitest run tests/ci-classify.unit.test.ts` gives 3 failed and 27 passed. The build, typecheck and lint are clean.

```
× the CI plan … > an e2e spec change names the integration tests the harness also runs for its IDs
  expected [] to deeply equal ArrayContaining ["packages/framework/test/integration/auth/admin-role.test.ts"]   (line 173)
× the path map > names only existing test files and components
  tests/compliance/criteria/mail: expected false to be true                                                     (line 235)
× the path map > dependsOn mirrors docs/architecture/component-map.md §3
  PROV: map [AUTH, CF, CFG, HTTP, LOG, MAIL, MIG, SEC], doc [AUTH, CF, CFG, HTTP, LOG, MIG, SEC]                (line 262)
```

## Evidence
- **Each failing test stops at its first failing `expect`.** A script repeats the two path-map checks over every row (`scratchpad/rows.mjs`: the test's §3 parser and the `existsSync` check, unchanged). It finds four stale entries, not two:
  - `MISMATCH PROV map: AUTH,CF,CFG,HTTP,LOG,MAIL,MIG,SEC doc: AUTH,CF,CFG,HTTP,LOG,MIG,SEC`
  - `MISMATCH CLI map: CHECK,COMPL,CORE,LOCAL,MAIL,MIG,PROV,PWD,SEC doc: AUTH,CHECK,COMPL,CORE,LOCAL,MIG,PROV,SEC`
  - `MISMATCH SKILL map: CFG,CLI,CORE,PROV,PWD,SETUP doc: CFG,CLI,CORE,PROV,SETUP`
  - `MISSING integration MAIL tests/compliance/criteria/mail`

  No other component's `dependsOn` differs. Every other integration directory, `testInputs[].unit` file and `e2e.ui` spec exists.
- **Which stack holds each side** (`git merge-base --is-ancestor` against both tips):
  - The path map, the classifier and the tests are on E's stack only. They come from S3: `a73a5c0` (PR 14) wrote MAIL's `integration: ["tests/compliance/criteria/mail"]` and PROV/CLI/SKILL's `dependsOn` from §3 as it then stood. `0f161c8` (PR 16 review) added the E2E-007 test at line 172.
  - B's stack (which merged D's docs in `44m`) holds the removals and the §3 edits:
    - `4ebbbf5` and `0999b99` (B, PR 45) deleted `tests/compliance/criteria/mail/mail.test.ts` and `tests/compliance/e2e/E2E-007.spec.ts`;
    - `3c9c69a` (B, PR 46) deleted `tests/compliance/criteria/mail/sink.test.ts`, the last file in that directory;
    - `d42a68f` (D 38) removed §3's PWD and MAIL rows and MAIL from PROV's row;
    - `2548e3a` (D 39a) changed CLI's row from `…, SEC, PWD, MAIL, CORE, COMPL` to `…, SEC, AUTH, CORE, COMPL` (`mail` and `admins` removed, DEC-0698) and removed PWD from SKILL's row.
- **On E's tip each entry was right.** `git show origin/v0.2.0/61a-admin-app-ci:docs/architecture/component-map.md` has `| PROV | …, AUTH, MAIL |`, `| CLI | …, PWD, MAIL, CORE, COMPL |` and `| SKILL | …, PROV, PWD, SETUP |`. `git ls-tree` on that tip lists `criteria/mail/{mail,sink}.test.ts` and `e2e/E2E-007.spec.ts`.
- **E2E-007 fails because its spec file is gone, not because of the map.**
  - `ciPlan` reads tags from the files themselves: `tagsIn` → `sourcesUnder`, which returns `[]` for a path that does not exist (`classify.mjs:133-137`). So `e2eIds = []`, `e2eOnly = []` and `alsoIntegration = []` (line 170).
  - `admin-role.test.ts` still carries `tag("E2E-007", …)` (`tagsIn` → `[AUTH-AC-003, E2E-007]`). Only the spec is gone.
  - No edit to `path-map.json` can make a deleted spec name its IDs.
- **The mechanism the test covers still works on the merged tree, through one genuine tag pair** (corrected in Response (round 1)). For each remaining spec, the plan's `alsoIntegration` (`scratchpad/also.mjs`):
  - `demo-local.spec.ts` → `packages/framework/test/integration/cli/verify.test.ts`. Both carry a real tag: `demo-local.spec.ts:26` `test(tag("CHECK-AC-005", …))` and `verify.test.ts:59` `tag(["CLI-AC-002", "CHECK-AC-005"], …)`.
  - `E2E-004.spec.ts` → `tests/compliance/criteria/compl/evidence.test.ts`. This one is **not** a genuine pair: `evidence.test.ts:76` has `const kept = "E2E-004"`, a data string that `classify.mjs:130` `TAG` over-matches (any quoted `"E2E-nnn"`). See Similar cases.
  - every other spec → `[]`.
- **§3 is the side that is right.** The D commits that changed it are reviewed docs work, with independent reviews recorded as accepted (`e6c2533`, `d7ebd37`). They follow the retirement decisions: DEC-0696 retires PWD and MAIL, and DEC-0698 removes `mail` and `admins`. B's code matches them:
  - PROV no longer sets up email: `3c9c69a` removed MAIL's sending and the stage mail binding, and `email.ts`/`mail-sink.ts` stay only until C 34a.
  - The CLI no longer has `mail` or `admins` (`3c9c69a`, `2fe4002`), and `check-login` checks the auth-app sign-in (`05da181`, `e6244cd`). Those are AUTH paths.
  - SKILL no longer documents sign-up or password setup.

  The map's own `$comment` says "Component codes and dependsOn follow docs/architecture/component-map.md §3" (DEC-0635), and `testing-standards/resources/ci-path-map.md` says the map is updated in the same change as the component. Here the component change and the map were on different stacks.

## Causal chain
1. S3 (E's stack, `a73a5c0`, `0f161c8`) wrote the map and tests from the tree as it then stood: §3 with PWD/MAIL dependencies, `criteria/mail/`, `E2E-007.spec.ts`. Shown by the E-tip `git show`/`git ls-tree` above.
2. B's stack (B 45/46 and D 38/39a) removed `criteria/mail/*.test.ts` and `E2E-007.spec.ts`, and changed §3's PROV, CLI and SKILL rows. B's stack has no `scripts/ci/path-map.json`, so B could not update it, and no test on B's stack checks it. Shown by `--is-ancestor` and the `--diff-filter=D` logs.
3. Git merged the two sides without a textual conflict because they touch different files. The map now names a deleted directory and §3's old dependencies, and the test names a deleted spec. Shown by the merge `39c87a0` and the failures above.
4. The three tests compare the map and the plan with the merged tree and fail: `existsSync(criteria/mail)` is false, `dependsOn` ≠ §3 for PROV (and CLI and SKILL, hidden behind it), and the E2E-007 input has no tags. Shown by the Symptom and the full-row script.

## Alternatives ruled out
- **§3 is wrong and the map is right.** Ruled out by the Evidence above: the §3 rows were changed on purpose, reviewed, and match the code after B's removals. Restoring PWD/MAIL in §3 would contradict DEC-0696 and DEC-0698. `component-map.md` is not changed.
- **The test's §3 parser is wrong.** Ruled out: the parser is unchanged since S3, and it parses the E-tip §3 identically to the map (the test was green on E's tip). It fails only on rows whose text changed.
- **The classifier (`classify.mjs`) is wrong.** Ruled out: `alsoIntegration` still works for E2E-004 and demo-local (Evidence). The deleted spec has nothing to tag.
- **MAIL and PWD should leave the map.** Ruled out: §2's Capabilities table still lists PWD and MAIL (retired, "kept for the record"), and the §3 test expands "All capability components" for LOCAL, CF and COMPL from that table, filtering only GOOGLE. Those three `dependsOn` lists must therefore still name PWD and MAIL, and the "only existing components" check requires both codes to stay in `components`. `packages/framework/src/mail/**` also still exists in part, until C 34a (`3c9c69a` message), so MAIL's `paths` still select something.
- **PWD's integration directory is stale too.** Ruled out for now: `tests/compliance/criteria/pwd/` still holds `support.ts`. That file reads `parameters.md` and is imported by `harness/http.ts`, `harness/sign-up-budget.ts`, `criteria/secrets/password-no-leak.test.ts`, `criteria/prov/setup-account.test.ts` and `criteria/cli/support/admins.ts`. So `testInputs` "parameters.md → CORE, PWD" still selects a directory that exists. See Similar cases.
- **Flaky or order-dependent.** Ruled out: deterministic (pure file reads), and the same 3 failures occur on every run.

## Proposed fix
In `scripts/ci/path-map.json` only:
- `MAIL.integration`: `["tests/compliance/criteria/mail"]` → `[]`. MAIL's criteria tests are removed (B 45/46); this is the same shape as DEMO's `[]`.
- `PROV.dependsOn`: drop `MAIL` (§3 row, D 38).
- `CLI.dependsOn`: drop `PWD` and `MAIL`, add `AUTH` (§3 row, D 39a; DEC-0698).
- `SKILL.dependsOn`: drop `PWD` (§3 row, D 39a).

In `tests/ci-classify.unit.test.ts`, the E2E-007 test's input is a deleted file. This is `code-removed` (B 45 deleted `E2E-007.spec.ts`; plan-v0.2.0 §6 and §7.1, E2E-007 is pending T2's rewrite). It is not a path-map defect.
- The test keeps its name, its matcher (`arrayContaining`) and what it checks: an e2e spec change names the integration test files that carry the spec's IDs.
- It uses the remaining genuine-tag pair (revised in Response (round 1)): `tests/compliance/e2e/demo-local.spec.ts` → `packages/framework/test/integration/cli/verify.test.ts`, which share `CHECK-AC-005` through real `tag(...)` calls. Like the original `admin-role.test.ts`, the expected file is a framework suite outside `tests/compliance/criteria/`.
- This is a change to a once-green test, so it gets its own test-change review record (`ai/implementation/test-reviews/2026-10-31-T7-71n.md`, §7a.1.9).

No change to `component-map.md`, `classify.mjs`, the staged `scripts/ci/workflows/ci.yml` or `release.yml`. Neither workflow names a deleted path (see Similar cases). No decision ID is needed: the fix applies DEC-0635's rule that the map follows §3, and the existing removal decisions.

## Similar cases (§7a.1.8 step 4)
Searched the merged tree for each of the 47 paths B's stack deleted (`git diff --name-only --diff-filter=D 8442136 origin/v0.2.0/42-drop-auth-mail-tables`). The search excluded `node_modules`, `validation/`, `retrospective/` and the historical record directories `decisions/`, `root-causes/`, `test-reviews/` and `spikes/`. Results:
- **`scripts/ci/path-map.json`**: the four entries above. Two more entries are stale but cause no failure:
  - `PWD.paths` `packages/framework/src/auth/password/**` matches nothing now, and AUTH's `!packages/framework/src/auth/password/**` excludes nothing. Both are harmless.
  - `PWD.integration` `tests/compliance/criteria/pwd` now holds only `support.ts`, which live tests still import.

  Left as they are. They go when `criteria/pwd/support.ts` is retired (B/T2's removal follow-up), not in this fix.
- **`tests/ci-classify.unit.test.ts:173`**: the E2E-007 input, fixed as above. Lines 37–38 use `src/auth/password/**` only as glob-matching literals, not as repository paths, so they are not stale.
- **`tests/compliance/tools/release.ts:22-28` (`LOGIN_PROVIDER_PATHS`)** still lists `packages/framework/src/auth/password/` and `docs/contracts/http/internal/auth-password.openapi.yaml` (both deleted), and `src/mail/` (partly deleted), as paths whose change invalidates PWD-AC-009 evidence. `release.unit.test.ts:114-118` asserts that list. The paths cannot change any more, so the check is dead for them but does not fail. This is outside T7's map scope (COMPL tools, B/T2's PWD-AC-009 retirement), so it becomes a **new item**, not a silent fix.
- **The staged and live workflows** (`scripts/ci/workflows/{ci,release}.yml`, `.github/workflows/{ci,release}.yml`), **`vitest.*.ts`, `playwright.config.ts`, `eslint.config.js`, `tsconfig*.json`, `package.json`, `packages/framework/package.json`, `tests/compliance/package.json`**: no reference to any deleted path, and none to `mail`, `pwd`, `password`, `admins` or `E2E-007`.
- **Non-record docs and plans:** `plan-v0.2.0-testing-auth.md:314,347-350` and `plan-auth.md` name the deleted paths as what to remove or what was built, so they are history, not path lists. Comments in `fake-cloud.test-support.ts:208` and `permissions.ts:240` name `email-delivery.ts`; those belong to C 34a's email removal. `criteria/cli/support/admins.ts` still exists after `admins` was removed (B 47): orphan helper, B/T2's follow-up.
- **`scripts/ci/classify.mjs:130` `TAG` over-matches** (found by the round 1 review). It counts any quoted `"E2E-nnn"` or `"X-AC-nnn"` literal as a tag, so `evidence.test.ts:76` (`const kept = "E2E-004"`) makes E2E-004's plan name `evidence.test.ts`, although no test there is tagged E2E-004. This only over-selects; the harness filters on titles. The fix is in the classifier, not the map, so it is outside this fix and becomes a **new item**, together with the `release.ts` item above.
- **Open, not a defect here:** §2 still lists PWD and MAIL as Capabilities, so the §3 test makes LOCAL, CF and COMPL depend on two retired components. That only over-selects in CI. Whether the test should filter retired capabilities as it filters GOOGLE is a question for the owner and D.

## Verification plan
- **Red:** on `39c87a0`, `npx vitest run tests/ci-classify.unit.test.ts` → 3 failed / 27 passed (Symptom). With only the test change, 2 fail. With only the map change, 1 fails (E2E-007).
- **Green:** after both, the file passes 30/30, and the full-row script reports no mismatch and no missing path.
- **The new input can fail:** with `classify.mjs:170` mutated so that `alsoIntegration` is always `[]`, the demo-local test fails (1 failed / 29 passed); restored afterwards.
- **Gate:** `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit`, all green. Then CI on the PR.

## Review (round 1)
Reviewer: an independent reviewer session (Claude Code remote session `session_014mWQ6jfAb7RXyx6CVpx1br`), 2026-10-31. It reproduced 3 failed / 27 passed on `39c87a0`. It also ran the four map edits alone (1 fails, E2E-007) and with the test change (30/30), and it removed PWD/MAIL from the map (LOCAL's §3 check then fails, as the record predicts).

**Verdict: accepted-with-changes.**
1. **major**: The causal chain holds, but the proposed E2E-004 replacement does not exercise the mechanism. `criteria/compl/evidence.test.ts` has no E2E-004 tag; "E2E-004" appears only as data at line 76 (`const kept = "E2E-004"`). `classify.mjs:130` `TAG` matches any quoted literal, so the pair is a classifier false positive, and the test would pin it as expected behaviour. Use an input whose spec ID is a genuine `tag(...)` in an integration test (a fixture root, or `demo-local.spec.ts` → `cli/verify.test.ts` through CHECK-AC-005), and correct the Evidence bullet.
2. **minor**: §3 is right, not the map. Keeping PWD and MAIL with `MAIL.integration: []` is right. The E2E-007 failure is outside the map. The map edits weaken no test and follow DEC-0635.
3. **minor**: The similar cases are reasonable. Optionally, the new item could also cover making `TAG` ignore non-tag string literals.

## Response (round 1)
- **To 1 (major).** Agreed and confirmed: `grep -n E2E-004 tests/compliance/criteria/compl/evidence.test.ts` gives only `76: const kept = "E2E-004";`.
  - The revised fix uses `demo-local.spec.ts` → `packages/framework/test/integration/cli/verify.test.ts`. Both sides are genuine tags: `demo-local.spec.ts:26` `test(tag("CHECK-AC-005", …))` and `verify.test.ts:59` `tag(["CLI-AC-002", "CHECK-AC-005"], …)`.
  - For a spec-only change no component is selected, so `integrationIds = []` and `e2eOnly` holds CHECK-AC-005. The pair goes through the same `e2eOnly` path as E2E-007 did.
  - This is the simpler of the two options: no fixture root, and the expected file is a framework suite, as `admin-role.test.ts` was.
  - With the four map edits and this input, the file passes 30/30. With `alsoIntegration` mutated to `[]`, this test fails.
  - The Evidence bullet and the Proposed fix are corrected above.
- **To 2.** No change.
- **To 3.** Taken: the `TAG` over-match is listed under Similar cases as a new item.

## Review (round 2)
Reviewer: the same independent reviewer session (`session_014mWQ6jfAb7RXyx6CVpx1br`), 2026-10-31, round 2, on `15efd6f`. It reapplied the four map edits and the revised test line on `39c87a0`: the file passes 30/30, and build, typecheck and lint exit 0. It stopped the full unit run early, so that run stays with the fixer and CI.

**Verdict: accepted.**
1. **minor**: The round 1 major is resolved. Both sides of demo-local → verify.test.ts are real tags (`demo-local.spec.ts:26`, `verify.test.ts:59`), and no other literal in either file gives CHECK-AC-005. A spec-only change selects no component, so CHECK-AC-005 reaches `alsoIntegration` through `e2eOnly`, the path E2E-007 used.
2. **minor**: The causal chain and the alternatives ruled out stand as in round 1.
3. **minor**: The `TAG` over-match is a new item and is not fixed silently, which fits T7's map-only scope.
