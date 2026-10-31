# Root cause: the release report can never find a passing login check. `release.ts` still keys it on PWD-AC-009, which `check-login` has recorded only as `not-run` since B's #115. Its unit test stayed green on fixtures that still record PWD-AC-009 as `passed`.

Author: item T7 (diagnosis, §7a.1.8 step 1), 2026-10-31. Finding 1 of T5's review of B's #115 (`ai/implementation/test-reviews` record for #115 on `t5/batch2-record-drafts`, commit `662a905`, advisory minor to T6). Branch `v0.2.0/94-fix-release-login-check` on `origin/v0.2.0/71n-path-map-after-removals` (`60b5e8e`), the newest join of every stack.

## Symptom
`tests/compliance/tools/release.ts` picks the reference point for its "commits since the last passing check-login record" list as the newest record whose `LOGIN_CHECK` entries all passed. `LOGIN_CHECK = "PWD-AC-009"` (line 30). On `60b5e8e`, a test fed the record that `check-login` writes now fails:

```
× [COMPL-AC-006] release report > finds the last passing automated sign-in path check (check-login, E2E-008) in the record check-login writes now
  AssertionError: expected [ undefined ] to deeply equal [ 'c-pass' ]      (loginCommits was asked "since undefined")
  Tests  1 failed | 16 passed (17)
```

The fixture is one `check-login` record per commit, as the command writes it since #115: `PWD-AC-009 not-run "retired with the password provider (plan-v0.2.0 §6)"`, `AUTH-AC-011 passed`, `E2E-008 passed` (passing at `c-pass`, failing at a newer `c-fail`). The report finds no passing record, so it lists every commit since the start of history and prints "No passing check-login record (PWD-AC-009)". Every real release report would do the same.

## Evidence
- **`check-login` never records PWD-AC-009 as passed.** `packages/framework/src/cli/commands/check-login.ts:156` (success) and `:150` (failure) both put `retired()` first. `retired()` (`:159-161`) is `{ id: "PWD-AC-009", status: "not-run", … }`. Its own test asserts this (`check-login.unit.test.ts:175`, and `:220` for every fault). The command's passing result is E2E-008 (steps 1–3) and AUTH-AC-011 (steps 1–2). DEC-0670 (`ai/implementation/decisions/v020-B.md`) names it "the automated sign-in path check".
- **`release.ts` requires every PWD-AC-009 entry to pass.** `release.ts:125-128`: `entries = r.results.filter((x) => x.id === LOGIN_CHECK); return entries.length > 0 && entries.every((x) => x.status === "passed")`. A `not-run` entry fails `every`, so no record after #115 qualifies. The driver cannot supply one either: it folds only IDs in `toRun` (`driver.ts:336`), and `toRun` comes from the catalogue, where PWD-AC-009 is retired (`catalogue.unit.test.ts:143`, D 38 `d42a68f`).
- **The unit test stayed green because its fixture is stale.** `release.unit.test.ts:93-95` (on `60b5e8e`) builds the check-login record as `[{ id: "PWD-AC-009", status }, { id: "AUTH-AC-011", status }, { id: "E2E-008", status }]` with `status = "passed"`. That is the pre-#115 shape. The folded cloud-run fixture at `:107` is `PWD-AC-009 passed` alone. Both fixtures come from `84f6882` (release 1, DEC-0512). No record of that shape can be written any more.
- **No test ties the release tool to the command.** `release.ts` and `release.unit.test.ts` import nothing from `check-login.ts`. `tests/compliance/harness/prodcheck.ts:27` keeps its own copy of the command's `CHECK_LOGIN_IDS`; its comment says "`CHECK_LOGIN_IDS` of the command", but nothing checks that. The driver's tests (`driver.unit.test.ts:635, 658, 676, 691, 701, 724, 752, 771`) use the same stale fixture: PWD-AC-009 is in the catalogue and is passed or failed with a password-era detail ("step 1: sign-up with a forged host").
- **Why each change missed it.** B's #115 (`05da181`, `e6244cd`) changed only `check-login.ts`, its unit test and `main.ts`. Its body says "the harness still folds three IDs", and DEC-0670 keeps PWD-AC-009 "as `not-run`, retired, until the harness drops it". D 38 (`f97c3b4`) updated the catalogue-wide release test (`release.unit.test.ts:120-146`) to stop demanding PWD-AC-009, but not the login-check test above it. Each PR's tests passed on its own fixtures.
- **The same retired IDs are listed in prodcheck.** `prodcheck.ts:30` `PRODCHECK_IDS` still has `MAIL-AC-006` (retired, DEC-0696) and `CLI-AC-007` (retired, DEC-0698; `docs/components/cli.md` §4 Retired table). They are no longer in the catalogue, so they can never be in `toRun`, and listing them changes nothing. They are stale only.

## Causal chain
1. B's #115 made `check-login` record PWD-AC-009 as `not-run` always, and E2E-008/AUTH-AC-011 as its pass. Shown by `check-login.ts:150-161` and its test `:175`.
2. `release.ts` still keys the reference point on PWD-AC-009 passing (`:30`, `:125-128`). No other record can pass it, because the driver folds only catalogue IDs and PWD-AC-009 is retired. Shown by `driver.ts:336` and `catalogue.unit.test.ts:143`.
3. So `lastLoginCheck` is always undefined, and the report lists all of history. Shown by the red test (Symptom).
4. The release and driver unit tests did not catch it: their fixtures hand-write a PWD-AC-009 `passed` record that the current command never writes, and no test compares the tool's ID with the command's IDs. Shown by `release.unit.test.ts:93-95, 107` and `driver.unit.test.ts:635-771`, all from before #115.

## Alternatives ruled out
- **`check-login` should still pass PWD-AC-009.** Ruled out: PWD is retired (DEC-0696), and DEC-0670 records it as `not-run` on purpose. A pass for a retired criterion would be false evidence.
- **The driver folds a passing PWD-AC-009 into the run's record.** Ruled out: it folds only `toRun` IDs (`driver.ts:336`), and PWD-AC-009 is not in the catalogue.
- **AUTH-AC-011 as the reference ID.** Ruled out: AUTH-AC-011 covers only steps 1–2 (DEC-0670), and other tests could tag it in future (it is an AUTH criterion). E2E-008 is the scenario the whole command passes ("E2E-008 automated part is now this command", #115). It is in the catalogue as automated on Cloudflare and is not a milestone item (`release.unit.test.ts:129-132`).
- **The live real sign-in records (DEC-0692) as the reference point.** COMPL-AC-006 as amended names "the latest passing real sign-in records (the live parts of E2E-007 and E2E-008)". Those live parts have no milestone Where line yet (compliance.md DEC-0693 note), so no such record can exist today. E2E-008 is the same ID for both parts: any later milestone record of its live part also counts with the proposed fix. Narrowing to milestone records only is left open (see Similar cases).

## Proposed fix
- `release.ts`: `LOGIN_CHECK = "E2E-008"`, the automated sign-in path check's scenario. Doc comments name `check-login` as the automated sign-in path check (DEC-0670). The rule stays the same: the newest non-dry-run record of any target and tier whose E2E-008 entries all passed. That is `check-login`'s own record, or a cloud run that folded it in. Decision DEC-0780.
- `release.ts` `LOGIN_PROVIDER_PATHS` (orchestrator, from the 71n fixer, PR #134): the list drops the deleted `src/auth/password/`, `src/mail/` and `auth-password.openapi.yaml`. It now names the files COMPL-AC-006 (DEC-0692) names, "AUTH, auth-app or login-provider interface files": `packages/framework/src/auth/`, `packages/framework/src/auth-app/`, `packages/framework/src/targets/cloudflare/auth-app.ts`, `packages/framework/src/provision/cloudflare/auth-app-deploy.ts`, `docs/contracts/ts/auth.d.ts`, `docs/contracts/ts/internal/auth-app.d.ts` and `docs/contracts/ts/internal/login-provider.d.ts`. These are AUTH's `paths` in `scripts/ci/path-map.json` plus the auth app's binding, its deploy and the contracts. The report heading follows. A new test checks that every listed path exists, so a later deletion fails a test instead of leaving a dead entry. Decision DEC-0780.
- `prodcheck.ts`: `CHECK_LOGIN_IDS = ["AUTH-AC-011", "E2E-008"]`. `PRODCHECK_IDS` drops `MAIL-AC-006` and `CLI-AC-007`. `check-login.ts` stops writing the retired PWD-AC-009 entry, which ends DEC-0670's "until the harness drops it". Decision DEC-0787.
- Tests (red first):
  - the new `release.unit.test.ts` case above, with the record shape #115 writes;
  - the existing login-check case's fixtures move to the shape the command writes after the fix (`AUTH-AC-011`, `E2E-008`);
  - a guard test: `LOGIN_CHECK` is in the command's `CHECK_LOGIN_IDS`, and the harness's `CHECK_LOGIN_IDS` equals the command's. A future change to the command's IDs then fails a test instead of leaving stale fixtures green;
  - in `driver.unit.test.ts`, the fixtures and the folded-ID lists drop PWD-AC-009, and the failing-step detail is the command's real step-1 message. The same assertions are kept for AUTH-AC-011 and E2E-008.

  All are once-green test changes: record `ai/implementation/test-reviews/2026-10-31-T7-94.md`, with `test-was-wrong` for the stale fixtures and `behaviour-changed` for the retired IDs.

## Similar cases (§7a.1.8 step 4)
Searched with `git grep -nE 'PWD-AC|MAIL-AC|CLI-AC-00[67]|admins' -- tests scripts packages/framework/src`, excluding retired tables and history (the catalogue and support tests that assert the retirement, `config` tests asserting there is no `admins` list, and comments that cite history):
- **Fixed in this item:** `prodcheck.ts:15, 27, 30`; `driver.unit.test.ts` (above); `check-login.ts:23, 39, 150-161`; `prodcheck.test.ts:17-21` (comment: "folds PWD-AC-009 in" → E2E-008).
- **`release.ts:22-28` `LOGIN_PROVIDER_PATHS`**, and the report heading "PWD, MAIL or login-provider interface files". The list names deleted password and mail paths, and COMPL-AC-006 (DEC-0692) now names "AUTH, auth-app or login-provider interface files". The 71n record opened this as a new item; the orchestrator assigned it here. **Fixed in this item** (Proposed fix). Narrowing the reference point to the live milestone records of E2E-007 and E2E-008 stays open until those parts have a milestone Where line (DEC-0693 note).
- **`docs/components/compliance.md` COMPL-AC-005** still says "`check-login`'s PWD-AC-009 result is present", and COMPL-REQ-005's 2026 amendment names PWD-AC-009 and MAIL-AC-006. `docs/acceptance/e2e-scenarios.md` E2E-008 still describes the password steps (T5 advisory to T2). These are D/T2 docs. **New item.**
- **`packages/framework/src/testing/connect.ts:224, 230`** tell users to run the removed `admins` command. Fixed in T7's 94b (finding 4). `docs/contracts/ts/testing.d.ts` (`grantRole` doc: "use the `admins` command there") is the same text in the contract. **New item** for D.
- **`packages/framework/src/auth/roles.ts:5`** comment names "the `admins` command (writing)". Stale comment, B's path. **New item** (cosmetic).
- **Tests tagged with retired MAIL criteria:** `provision/cloudflare/email.unit.test.ts:42`, `sst.unit.test.ts:101, 146`, `target.unit.test.ts:129, 229, 286`, `targets/cloudflare/settings.unit.test.ts:60, 66` (MAIL-AC-004/005/007). They test email code that stays until C 34a. Their tags name criteria no longer in the catalogue. **New item**, with C 34a.
- **Orphan helpers** (the orchestrator asked to remove `tests/compliance/criteria/cli/support/admins.ts` as `code-removed` unless something still imports it). It is still imported: `criteria/compl/prodcheck.test.ts:36` (`recordedOrigin`) and `criteria/prov/setup-account.test.ts:97, 100` (`sinkMail`, `emailDomain`). `record-requests.mjs` beside it is used by `criteria/setup/starter-offline.test.ts:36`. So neither file is removed here. Its `admins`, `cloudRole`, `recordRequests` and `d1ApiRequests` exports have no importer left. Moving the three live helpers out and deleting the rest is a **new item** for B/T2, together with `criteria/pwd/support.ts`, which is still imported too (open from the 71n record).
- **`cli/cloudflare-settings.unit.test.ts:73`** uses `"admins"` only as a command-name label for a generic wrapper. Not a defect.

## Verification plan
- **Red:** on `60b5e8e` with only the new test, `npx vitest run --config vitest.unit.config.ts tests/compliance/tools/release.unit.test.ts` gives 1 failed / 16 passed (Symptom). The guard test also fails on `60b5e8e`, because `LOGIN_CHECK` is not a passing ID there and the harness's list differs from the command's once the command drops PWD-AC-009.
- **Green:** after the fix, `npx vitest run --config vitest.unit.config.ts tests/compliance` and `packages/framework/src/cli/commands/check-login.unit.test.ts` pass.
- **The new tests can fail:** with `LOGIN_CHECK` set back to `"PWD-AC-009"`, the new case and the guard fail. With the old `LOGIN_PROVIDER_PATHS`, the path-exists test fails on the deleted password paths.
- **Gate:** `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit`, all green. Then CI on the PR.

## Review (round 1)
Status: awaiting review
