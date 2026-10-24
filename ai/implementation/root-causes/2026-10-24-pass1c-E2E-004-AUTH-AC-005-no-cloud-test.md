# Root cause: pass 1c. E2E-004 coverage part on Cloudflare names AUTH-AC-005. The criterion's contract part applies on cloud (automated), but its only tagged tests are in the framework's local integration suite, which the cloud driver does not select. The not-run rule covers only the milestone admin-list part.

Author: diagnosing subagent (prompt §8). I did not write the code under diagnosis, and I did not run pass 1c. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: `origin/claude/implement-local-cloudflare` `71ac98d`. Evidence: `validation/cloudflare/xdryowrec3lephb.json`, `validation/cloudflare/xdryowrec3lephb/raw/{expected.json,vitest.json,playwright.log}`, `validation/cloudflare/pass-1c/logs/6-driver.log`.

A different subagent must review this record.

## Symptom
- `E2E-004` `failed`. Coverage part (`tests/compliance/e2e/E2E-004.spec.ts:32-48`): `applicable on cloudflare but no tagged test in this target's suite: AUTH-AC-005` (`6-driver.log:379-388`). The record part passed.
- `AUTH-AC-005` `not-run`: `no test tagged [AUTH-AC-005] ran on cloudflare` (`xdryowrec3lephb.json`, results).

AUTH-AC-005 is the only ID in the coverage list. The two symptoms are one cause.

## Evidence
E1. **The criterion has two parts with different Where.** `docs/components/auth.md:96`: "`/api/auth/*` responses validate against the HTTP contract. Admin-list part, a milestone item run on each cloud's `prodcheck` stage: … | AUTH-REQ-005 | Local, cloud; admin-list part: cloud (milestone)". So the **contract part is automated on Local and cloud**, and only the admin-list part is a cloud milestone item.

E2. **The harness expects the automated part on Cloudflare and has no rule for it.** `tests/compliance/harness/expected.ts:42` has `{ id: "AUTH-AC-005", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED }` (the admin-list part needs `prodcheck` and a real Google login). There is no `automated` rule for AUTH-AC-005. `expectedCriteria(…, "cloudflare", "automated")` therefore gives `{ id: "AUTH-AC-005", run: true, parts: [""], notRunParts: [] }`, which is what the run wrote to `raw/expected.json:10-17`. `expected.unit.test.ts:72-74` checks only the milestone rule. Both are correct as written: the contract part does not need Google (E5).

E3. **The only AUTH-AC-005 tests are in the framework's local integration suite.** `grep -rln AUTH-AC-005 tests apps packages --include=*.ts` finds `packages/framework/test/integration/auth/routes-contract.test.ts` (three tests, lines 39, 69, 92), `packages/framework/src/auth/runtime.unit.test.ts` and the harness's own unit tests. `tests/compliance/criteria/auth/` (`access`, `forgery`, `mock-login`, `sessions`) has no AUTH-AC-005 tag. `routes-contract.test.ts` runs in-process against `createTestApp` (`newApp()`, `app.request(…)`), so it cannot run against a deployment as written.

E4. **The cloud driver does not select the framework's integration suite.** `tests/compliance/harness/selection.ts:28-31`: on cloud, Vitest runs `vitest.integration.config.ts` restricted to `tests/compliance/criteria`, and Playwright is restricted to `tests/compliance/`. There is no unit layer. E2E-004 lists the same selection (`listDriverTests`, `selection.ts` header). So no AUTH-AC-005 test is listed or run on Cloudflare. `raw/vitest.json` has 0 occurrences of `AUTH-AC-005`. The 4 in `raw/playwright.json` are E2E-004's failure text. Locally the integration config also includes `packages/framework/test/integration`, so the C-local evaluation records AUTH-AC-005 `passed` from `FW-IT/auth/routes-contract.test.ts` (`ai/implementation/evaluations/C-local.md:47`).

E5. **The contract part can be checked over HTTP on a test stage, except one response.** On a `test-` stage the mock is present and there is no real provider (DEC-0171). Then:
- `GET /api/auth/me`: 200, `no-store`, CurrentUser at each level via `POST /api/auth/mock-login`. The AUTH-AC-006 and AUTH-AC-009 cloud tests already log in this way and passed in this run.
- `POST /api/auth/mock-login`: 204; invalid bodies → 400 ErrorResponse (DEC-0171).
- `GET /api/auth/login`: 302 with a mock session (DEC-0171). The AUTH-AC-006 cloud test already exercises it (`sessions.test.ts:31-45`, passed).
- `GET /api/auth/callback` without a transaction: 302 to `/?authError=login_failed&requestId=…` (`packages/framework/src/auth/runtime.ts:159-171`).
- `POST /api/auth/logout`: 204. Wrong methods → ErrorResponse.
- **Not on a cloud test stage:** a *successful* callback (302 to `returnTo` with a session cookie). It needs a login provider. The stub provider exists only in-process (`createTestApp(…, { stubLoginProvider: true })`, DEC-0172; `sessions.test.ts` header), and the real one is Google, mocked in this phase.

## Chain from cause to symptom
1. AUTH-AC-005's contract part is automated on cloud (E1), and the harness rightly expects it on Cloudflare (E2).
2. → C-T3 (`a6b711e`) moved the cloud-capable criteria into `tests/compliance/criteria/auth/` but added no AUTH-AC-005 test there. Its tests stayed in the in-process framework suite from B-T3 (`2cce9b0`) (E3).
3. → The cloud selection excludes that suite (E4).
4. → E2E-004's coverage listing finds no AUTH-AC-005 test for Cloudflare, and the driver records AUTH-AC-005 `not-run` (symptom).

## Alternatives ruled out
- **A missing whole-criterion not-run rule.** Ruled out. Only the admin-list part needs Google (E1, E5). Marking the whole automated criterion not-run would hide a contract check that a test stage can run. The C-local evaluation (`C-local.md:177`) also found that "no Local criterion needs a real Google login", and the contract part is Local and cloud.
- **The coverage check or tag parsing is wrong.** Ruled out. The listing is the driver's own selection (E4), and every other expected ID was found.
- **Running `packages/framework/test/integration` on cloud.** Ruled out. Those tests run in-process against local bindings, not the deployment (E3). Including them would count local evidence for the cloud target.

## Proposed fix (minimal, red-green)
1. Add `tests/compliance/criteria/auth/contract.test.ts` with tests tagged `[AUTH-AC-005]` that run over HTTP against the target through the harness `client()` (as `access.test.ts` and `sessions.test.ts` do). They validate against `docs/contracts/http/framework.openapi.yaml`, reusing the schema checks the framework test uses (`isCurrentUserResponse`, `expectContractError`, moved or imported into `tests/compliance/criteria/auth/support.ts`):
   - `GET /api/auth/me`: anonymous, user, admin (via mock-login): 200, `no-store`, JSON CurrentUser.
   - `POST /api/auth/mock-login`: 204 empty; the four invalid bodies → 4xx ErrorResponse.
   - `GET /api/auth/login?returnTo=%2Fafter`: 302 (`Location` path `/after` on a test stage and `dev`).
   - `GET /api/auth/callback` with no transaction cookie: 302 to `/` with `authError=login_failed`.
   - `POST /api/auth/logout`: 204 empty. `GET /api/auth/logout` and `DELETE /api/auth/me`: ErrorResponse.
   - On local only (in-process, `openReference` as `sessions.test.ts:105-140` does): the successful stub-provider callback.
2. Add a part rule in `tests/compliance/harness/expected.ts`: `{ id: "AUTH-AC-005", targets: CLOUD, mode: "automated", part: "successful-callback response", detail: GOOGLE_MOCKED }`, like AUTH-AC-009's. That response needs a real provider on cloud (E5). Extend `expected.unit.test.ts` to expect `notRunParts` for it on Cloudflare, and none on local.
3. Record a short decision-log entry (the cloud location of AUTH-AC-005's contract part and the part rule), and update plan §8.1's not-run list.

**Red test:** before step 1, `npx vitest run tests/compliance/harness/expected.unit.test.ts` with the new expectation (part rule on Cloudflare automated) is red. Also run E2E-004's coverage check offline: `listDriverTests("cloudflare")` + `uncovered(…)` (a unit test in `tests/compliance/harness/` over the real repository, or the E2E-004 spec with `--target cloudflare` listing only) returns `["AUTH-AC-005"]` today, and `[]` after step 1. This needs no deployment, because listing is collect-only.

## How the fix will be verified
- Locally: the new tests pass against `dev` and in-process (local driver, AUTH-AC-005 `passed`). `expected.unit.test.ts` is green. The offline coverage listing for Cloudflare is empty.
- Pass 2 on Cloudflare: AUTH-AC-005 `passed`, with a `not-run` part entry "successful-callback response: Google login mocked for this phase", and the milestone admin-list part still on the outstanding list. E2E-004's coverage part passes.

## Review

Reviewer: independent root-cause reviewer (prompt §8). I did not write this diagnosis or the code under it. Base `ff16516`. No Cloudflare call, no suite run.

**Verdict: cause accepted. Fix approved with the changes below.**

### Cause: confirmed
- `docs/components/auth.md:96`: the Where of AUTH-AC-005 is "Local, cloud; admin-list part: cloud (milestone)". So the contract part, "`/api/auth/*` responses validate against the HTTP contract", is automated on cloud.
- `tests/compliance/harness/expected.ts:42` has only the milestone rule. `expectedCriteria` (`expected.ts:70-86`) therefore yields `run: true, parts: [""]` for cloudflare/automated, which matches `raw/expected.json`.
- `selection.ts:28-31` restricts cloud Vitest to `tests/compliance/criteria`. The only AUTH-AC-005 tests are `packages/framework/test/integration/auth/routes-contract.test.ts:39,69,92`, which run in-process (`newApp()`). The alternatives the record rules out are correctly ruled out. In particular, adding the in-process suite to the cloud selection would count local evidence for the cloud target.

### Fix: required changes
1. **Do not import `packages/framework/test/integration/auth/support.ts` into the compliance suite.** It imports `createTestApp` and `node:crypto` (`support.ts:8-19`). Move only the pure schema checks (`isCurrentUserResponse`, `isErrorResponse`) to a module without in-process dependencies, and have both suites import them. `expectContractError` is local to `routes-contract.test.ts:31-36` and depends on `ERROR_CATALOGUE`. The cloud version must assert the catalogue status for the code, as that one does, and not only "4xx".
2. **Leave out the "On local only (in-process, openReference)" successful-callback test.** The local selection already runs `routes-contract.test.ts:69`, which covers the stub-provider success. A copy adds nothing to local evidence. Keep the new file target-neutral over `client()`, as `sessions.test.ts:31-45` is.
3. **Name the part rule after a clause, and record it as an addition.** The AUTH-AC-005 text names only the admin-list part. The plan's §8.1 list comes from prompt §4 (`ai/implementation/plan.md:563`), which does not include this response. Add it as the plan already does for CLI-AC-001: "Added … for the evaluator to confirm" (`plan.md:564`). Use the detail `GOOGLE_MOCKED`. Use a part name that states the clause, for example `"contract part: successful callback (needs a real login provider)"`. The reason is correct: test stages have no provider (DEC-0171), so this response first exists on `prodcheck` with Google, like AUTH-AC-009's cloud production part (`expected.ts:43`). `checkRules` (`expected.ts:90-107`) accepts the rule, because AUTH-AC-005 is automated on cloud.
4. **Fix the red-test order.** The `expected.unit.test.ts` expectation (Cloudflare automated `notRunParts` = [that part]; local none; next to the existing `expected.unit.test.ts:72`) is red until step 2, not step 1. The offline coverage check (`uncovered` over `listDriverTests("cloudflare")`) is red until step 1. Commit both red first, then step 1, then step 2.
5. Tests that use mock-login must use per-test ids, as `sessions.test.ts` does. The `login?returnTo` assertion must accept `[302, 303]` and the test-stage mock-session behaviour (DEC-0171), as `sessions.test.ts:33` does.

No live probe needed. Pass 2 verifies the fix: AUTH-AC-005 `passed` on Cloudflare, plus a `not-run` part entry, and E2E-004's coverage part passes.
