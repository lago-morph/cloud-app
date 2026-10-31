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
4. Underneath (reason 3 of Review (round 1)): `release.ts` was never moved off DEC-0512's rule when DEC-0692 replaced it with the live sign-in records. #115 only made the stale rule visible.
5. The release and driver unit tests did not catch it: their fixtures hand-write a PWD-AC-009 `passed` record that the current command never writes, and no test compares the tool's ID with the command's IDs. Shown by `release.unit.test.ts:93-95, 107` and `driver.unit.test.ts:635-771`, all from before #115.

## Alternatives ruled out
- **`check-login` should still pass PWD-AC-009.** Ruled out: PWD is retired (DEC-0696), and DEC-0670 records it as `not-run` on purpose. A pass for a retired criterion would be false evidence.
- **The driver folds a passing PWD-AC-009 into the run's record.** Ruled out: it folds only `toRun` IDs (`driver.ts:336`), and PWD-AC-009 is not in the catalogue.
- **AUTH-AC-011 as the reference ID.** Ruled out: AUTH-AC-011 covers only steps 1–2 (DEC-0670), and other tests could tag it in future (it is an AUTH criterion). E2E-008 is the scenario the whole command passes ("E2E-008 automated part is now this command", #115). It is in the catalogue as automated on Cloudflare and is not a milestone item (`release.unit.test.ts:129-132`).
- **`check-login`'s automated E2E-008 record as the reference point** (the first draft's fix; ruled out in Response (round 1)). COMPL-REQ-006 and COMPL-AC-006, as amended by the owner-approved DEC-0692 (`compliance.md:59, 125`), name "the latest passing real sign-in records (the live parts of E2E-007 and E2E-008)". They say this "replaces the rule that named PWD, MAIL and `check-login`'s record". The automated sign-in path check is not a real sign-in.

## Proposed fix
Revised in Response (round 1).
- `release.ts`: `REAL_SIGN_IN = ["E2E-007", "E2E-008"]` replaces `LOGIN_CHECK`, following COMPL-AC-006 (DEC-0692). For each of the two IDs, the reference is the newest milestone record (non-dry-run, any target) whose entries for that ID all passed. The older of the two is the reference point; if either is missing, all of history is listed. `check-login`'s automated record never counts. The report's lines say "real sign-in records". Decision DEC-0780.
- `release.ts` `LOGIN_PROVIDER_PATHS` (orchestrator, from the 71n fixer, PR #134): the list drops the deleted `src/auth/password/`, `src/mail/` and `auth-password.openapi.yaml`. It now names the files COMPL-AC-006 (DEC-0692) names, "AUTH, auth-app or login-provider interface files": `packages/framework/src/auth/`, `packages/framework/src/auth-app/`, `packages/framework/src/targets/cloudflare/auth-app.ts`, `packages/framework/src/provision/cloudflare/auth-app-deploy.ts`, `docs/contracts/ts/auth.d.ts`, `docs/contracts/ts/internal/auth-app.d.ts` and `docs/contracts/ts/internal/login-provider.d.ts`. These are AUTH's `paths` in `scripts/ci/path-map.json` plus the auth app's binding, its deploy and the contracts. The report heading follows. A new test checks that every listed path exists, so a later deletion fails a test instead of leaving a dead entry. Decision DEC-0780.
- `prodcheck.ts`: `CHECK_LOGIN_IDS = ["AUTH-AC-011", "E2E-008"]`, the command's IDs that the catalogue has; the driver could never fold PWD-AC-009 (`driver.ts:336`). `PRODCHECK_IDS` drops `MAIL-AC-006` and `CLI-AC-007`. `check-login.ts` is **not** changed. It keeps writing PWD-AC-009 as `not-run` until COMPL-AC-005 is amended (Review (round 1), reason 4). Decision DEC-0787.
- Tests (red first):
  - the login case of `release.unit.test.ts`, rewritten: passing and failing live milestone records of E2E-007 and E2E-008, and the record `check-login` writes since #115, which must not count. It also covers separate records (the older decides), a dry run, and only one of the two IDs (no reference point);
  - a guard test: the harness's `CHECK_LOGIN_IDS` equals the command's IDs that the documents' catalogue has; both `REAL_SIGN_IN` IDs are in the catalogue; every `LOGIN_PROVIDER_PATHS` entry exists;
  - in `driver.unit.test.ts`, the fixtures and the folded-ID lists drop PWD-AC-009, and the failing-step detail is the command's real step-1 message. The same assertions are kept for AUTH-AC-011 and E2E-008.

  All are once-green test changes: record `ai/implementation/test-reviews/2026-10-31-T7-94.md`, with `test-was-wrong` for the stale fixtures and `behaviour-changed` for the retired IDs.

## Similar cases (§7a.1.8 step 4)
Searched with `git grep -nE 'PWD-AC|MAIL-AC|CLI-AC-00[67]|admins' -- tests scripts packages/framework/src`, excluding retired tables and history (the catalogue and support tests that assert the retirement, `config` tests asserting there is no `admins` list, and comments that cite history):
- **Fixed in this item:** `prodcheck.ts:15, 27, 30`; `driver.unit.test.ts` (above); `prodcheck.test.ts:20` (comment: "folds PWD-AC-009 in" → E2E-008); `release.ts` doc comments and rendered lines (`:7-11, 30-32, 76, 147-150`).
- **`check-login.ts:23, 39, 150-161`** keeps the `not-run` PWD-AC-009 entry until D amends COMPL-AC-005 (below). Then it goes (DEC-0670), and the guard test needs no change.
- **`release.ts:22-28` `LOGIN_PROVIDER_PATHS`**, and the report heading "PWD, MAIL or login-provider interface files". The list names deleted password and mail paths, and COMPL-AC-006 (DEC-0692) now names "AUTH, auth-app or login-provider interface files". The 71n record opened this as a new item; the orchestrator assigned it here. **Fixed in this item** (Proposed fix). Until E2E-007 and E2E-008 have a milestone Where line for their live parts (DEC-0693 note), no live record exists, and the report lists all of history. That is the output the spec requires today.
- **`docs/components/compliance.md` COMPL-AC-005** still says "`check-login`'s PWD-AC-009 result is present", and COMPL-REQ-005's 2026 amendment names PWD-AC-009 and MAIL-AC-006. `docs/acceptance/e2e-scenarios.md` E2E-008 still describes the password steps (T5 advisory to T2). These are D/T2 docs. **New item.**
- **`packages/framework/src/testing/connect.ts:224, 230`** tell users to run the removed `admins` command. Fixed in T7's 94b (finding 4). `docs/contracts/ts/testing.d.ts` (`grantRole` doc: "use the `admins` command there") is the same text in the contract. **New item** for D.
- **`packages/framework/src/auth/roles.ts:5`** comment names "the `admins` command (writing)". Stale comment, B's path. **New item** (cosmetic).
- **Tests tagged with retired MAIL criteria:** `provision/cloudflare/email.unit.test.ts:42`, `sst.unit.test.ts:101, 146`, `target.unit.test.ts:129, 229, 286`, `targets/cloudflare/settings.unit.test.ts:60, 66` (MAIL-AC-004/005/007). They test email code that stays until C 34a. Their tags name criteria no longer in the catalogue. **New item**, with C 34a.
- **Orphan helpers** (the orchestrator asked to remove `tests/compliance/criteria/cli/support/admins.ts` as `code-removed` unless something still imports it). It is still imported: `criteria/compl/prodcheck.test.ts:36` (`recordedOrigin`) and `criteria/prov/setup-account.test.ts:97, 100` (`sinkMail`, `emailDomain`). `record-requests.mjs` beside it is used by `criteria/setup/starter-offline.test.ts:36`. So neither file is removed here. Its `admins`, `cloudRole`, `recordRequests` and `d1ApiRequests` exports have no importer left. Moving the three live helpers out and deleting the rest is a **new item** for B/T2, together with `criteria/pwd/support.ts`, which is still imported too (open from the 71n record).
- **Stale PWD-AC-009 comments** (found by Review (round 1)): `tests/compliance/harness/expected.ts:78` and `criteria/prov/test-stages.test.ts:109`. They are comments only and cite history. **New item** (cosmetic), with the COMPL-AC-005 amendment.
- **`cli/cloudflare-settings.unit.test.ts:73`** uses `"admins"` only as a command-name label for a generic wrapper. Not a defect.

## Verification plan
- **Red:** on `60b5e8e` with only the first-draft test, `npx vitest run --config vitest.unit.config.ts tests/compliance/tools/release.unit.test.ts` gives 1 failed / 16 passed (Symptom). With the revised tests and the old `release.ts` and `prodcheck.ts` (plus only the `REAL_SIGN_IN` export, so the file loads): 2 failed / 15 passed. The failures are `expected [ undefined ] to deeply equal [ 'c-pass' ]` (login case) and `expected [ 'PWD-AC-009', 'AUTH-AC-011', …(1) ] to deeply equal [ 'AUTH-AC-011', 'E2E-008' ]` (guard).
- **Green:** after the fix, `npx vitest run --config vitest.unit.config.ts tests/compliance` and `packages/framework/src/cli/commands/check-login.unit.test.ts` pass.
- **The new tests can fail:** shown by the red above. With the old `LOGIN_PROVIDER_PATHS`, the path-exists check fails on the deleted password paths.
- **Gate:** `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit`, all green. Then CI on the PR.

## Review (round 1)
Reviewer: independent reviewer session `session_014mWQ6jiYUf4VJvhgExH7cr` (a fresh cloud session), 2026-10-31, on `30a9f68`. It reproduced the red (`expected [ undefined ] to deeply equal [ 'c-pass' ]`, 1 failed / 16 passed), and as an experiment set `LOGIN_CHECK = "E2E-008"`. It committed nothing.

**Verdict: accepted-with-changes.**
1. **minor**: The evidence holds. Every cited line checks out, and the alternatives are ruled out fairly.
2. **minor**: Reproduced. With `LOGIN_CHECK = "E2E-008"`, only the stale old login case fails.
3. **major**: The cause is stated too narrowly. DEC-0692 (`compliance.md:59`, COMPL-AC-006 `:125`) replaced the `check-login` rule with "the latest passing real sign-in records (the live parts of E2E-007 and E2E-008)". `release.ts` was never moved to that rule. The draft fix (E2E-008, any record) brings back a retired reference point and leaves out E2E-007. Use the newest milestone records in which the live parts of both passed. Until they exist, the right output is "no passing real sign-in record".
4. **major**: COMPL-AC-005 (`compliance.md:124`) still says "`check-login`'s PWD-AC-009 result is present". Dropping the entry from `check-login` before COMPL-AC-005 is amended leaves the code short of the criterion as written. Keep writing the `not-run` entry until it is amended (DEC-0670's own condition).
5. **minor**: `LOGIN_PROVIDER_PATHS` is right against COMPL-AC-006: all seven paths exist and match AUTH's map paths plus the auth app's binding, deploy and contracts. The path-exists test is a good addition.
6. **minor**: Dropping `MAIL-AC-006` and `CLI-AC-007` from `PRODCHECK_IDS` is correct (neither is in the catalogue). The harness-to-command guard is the right fix for "no test ties the tool to the command".
7. **minor**: Keeping `criteria/cli/support/admins.ts` is right; it is still imported.
8. **minor**: The `release.ts` doc comments and rendered lines must follow reason 3. Two stale PWD-AC-009 comments are missing from Similar cases: `harness/expected.ts:78` and `criteria/prov/test-stages.test.ts:109`.
9. **minor**: Of the IDs the command writes, E2E-008 beats AUTH-AC-011. Under reason 3, though, the reference is the pair of live milestone records.

## Response (round 1)
- **To 3 (major).** Agreed: `compliance.md:59` says the DEC-0692 rule "replaces the rule that named PWD, MAIL and `check-login`'s record". The causal chain gains link 4, and the Alternatives and Proposed fix are revised above.
  - `release.ts` now has `REAL_SIGN_IN = ["E2E-007", "E2E-008"]`. For each ID it takes the newest passing milestone record (not a dry run). The older of the two is the reference point (where "records" is plural, the conservative reading), and with either missing, all of history is listed.
  - The brief asked that the tool "name B's new check and its criterion ID". The owner-approved rule takes precedence. The prodcheck harness still names the check and its IDs (AUTH-AC-011, E2E-008). The release tool names that check only to say it never counts. Recorded as DEC-0780.
  - The rewritten login test checks this rule. `check-login`'s current record must not count. Red on the old tool: `expected [ undefined ] to deeply equal [ 'c-pass' ]`.
- **To 4 (major).** Agreed. `check-login.ts` and its PWD-AC-009 assertions are left unchanged. The harness's `CHECK_LOGIN_IDS` is the command's IDs that the catalogue has: AUTH-AC-011 and E2E-008. The driver could never fold PWD-AC-009 (`driver.ts:336`), so its behaviour does not change. The guard test compares the two lists that way, so it stays right when the command drops the entry later. The COMPL-AC-005 amendment stays a new item for D. DEC-0787 is reworded.
- **To 8.** The `release.ts` comments and lines follow reason 3. The two comments are added to Similar cases.
- **To 1, 2, 5, 6, 7, 9.** No change needed.

## Review (round 2)
Reviewer: the same independent reviewer session (`session_014mWQ6jiYUf4VJvhgExH7cr`), 2026-10-31, round 2, on `203b5cc`. It read the record and the planned diff in a read-only worktree, and did not re-run vitest; the red results match its round 1 reproduction.

**Verdict: accepted.**
1. **minor**: Round 1 reason 3 is resolved. Link 4 traces the cause to DEC-0692. `REAL_SIGN_IN` reads only non-dry-run milestone records, so `check-login`'s automated record can never count. With no live milestone Where line yet, every report lists all of history, as the spec requires.
2. **minor**: The per-ID lookup reuses `selects`/`summary` and the newest-first order, so it picks the newest *passing* record and skips a newer failing one. The older of the two is the right conservative reading of "records".
3. **minor**: Round 1 reason 4 is resolved. `check-login.ts` is unchanged. Narrowing the harness's `CHECK_LOGIN_IDS` to catalogue IDs changes no behaviour (`driver.ts:336-337`). The guard stays right when the command later drops the entry.
4. **minor**: Round 1 reason 8 is resolved.
5. **minor** (optional): compare `finishedAt` with `Date.parse`, as the invalidation check does, not as strings. Taken in the fix.
6. **minor** (optional): say in the doc comment that an invalidation entry does not move the reference point (COMPL-AC-006 says only "latest passing"). Taken in the fix.
7. **minor**: The proposed tests are adequate.
