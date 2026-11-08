# Root cause: the `./testing` suite's exact-PAR-425 check runs on the real clock, so it fails whenever a real second boundary falls between sign-in and the check

Status: accepted

## Symptom

Release workflow run 42429796126, job 128575950155, commit `de75082` (`main`), step "Integration tests the harness does not run": 1 failed of 69 run.

- File `packages/framework/test/integration/testing/testing.postgres.test.ts` (shared body `testing.suite.ts`).
- Test "TestApp contract (PGlite) › with the fake auth app, a role changed by grantRole/revokeRole or authApp.setRole shows at the next role refresh after PAR-425, with one role call and no new sign-in (PGlite)", 1212 ms.
- `AssertionError: inside the interval the session's level stands: expected 'admin' to be 'user'` at `testing.suite.ts:199:89`, the first `whoami` after `a.clock.advance(ROLE_REFRESH_MS)` (exactly 300 000 ms).
- The same test passed in the same step in its local-D1 variant (`testing.sqlite.test.ts`, 942 ms).

## Evidence

1. **Re-run alone (owner's rule: only this file, foreground).** `vitest run --config vitest.integration.config.ts packages/framework/test/integration/testing/testing.postgres.test.ts` on `de75082`: 7 of 7 passed. Then the failing test alone (`-t "fake auth app"`) 5 times: 5 of 5 passed. The failure does not reproduce on demand, so it is intermittent, not deterministic.
2. **The same code passed in PR CI 15 minutes earlier.** CI run 42428765817 (PR #167, head `ba01ac0`), compliance job 128572868908, step "Integration tests of the selected suites not run by the harness", 00:16 UTC: `testing.postgres.test.ts` 7 tests passed, this test (PGlite) passed in 4880 ms; local D1 passed in 1786 ms. `git diff ba01ac0 de75082 -- packages/` is empty. The assertion at line 198–199 is unchanged since the suite was added (`609d31f`, 2026-10-31, `git log -L`), and `auth/role-refresh.ts`, `auth/runtime.ts`, `testing/test-app.ts` have had no change to this path since then (only `73e88df`, `ed8f873`: email/mail removal).
3. **The test's clock is real time plus an offset.** `src/testing/test-app.ts:396–401`: `clock.now = () => Date.now() + clockOffset`; `advance(ms)` adds to the offset. AUTH reads this clock (`authClock.now`, line 434). The suite does not freeze `Date` (no `vi.useFakeTimers` in `testing.suite.ts`), so real time keeps running between steps.
4. **AUTH keeps the confirmation time in whole seconds and compares whole seconds.** `src/auth/runtime.ts:108`: at sign-in `checkedAt: Math.floor(now() / 1000)`. `runtime.ts:185`: `nowSeconds = Math.floor(now() / 1000)`. `src/auth/role-refresh.ts:17`: `refreshDue = nowSeconds - checkedAt > 300`. So with an offset of exactly 300 000 ms, the check at line 199 refreshes if and only if a real second boundary fell between the sign-in's `now()` and the check's `now()`. There is no dialect-specific code on this path: the session is a cookie and the fake auth app is in memory.
5. **Minimal reproduction (scratch test, not committed; both dialects, run alone).** The suite's own sequence (`createTestApp` with `authAppLoginProvider`, `loginWithAuthApp`, `/api/auth/me`, `grantRole`, `clock.advance(300_000)`, `/api/whoami`), with `Date.now()` brackets:
   - *Statistics, 40 runs per dialect:* real span from before sign-in to after the check, median 5 ms / max 19 ms (PGlite), median 3 ms / max 22 ms (local D1). 0 of 40 refreshed on each; every run in which the span stayed inside one real second gave `user`.
   - *Forced:* the same sequence with a wait to just past the next real second (`sleep(1000 - Date.now() % 1000 + 20)`) before `grantRole`: `admin` on **PGlite and on local D1** (`crossed: true`). The failure is reproduced on demand on both dialects.
   - *Control:* the forced sequence with `vi.useFakeTimers({ toFake: ["Date"] })`: `user` on both dialects. With `Date` frozen, `TestApp.clock` is the only clock that moves and the exact-300 s check holds.
6. **The CI run was under parallel load.** The failing step runs every direct integration file in one `vitest run` (pool `forks`); `testing.postgres.test.ts` (19 287 ms) overlapped with `create.offline.test.ts` (53 836 ms), `testing.sqlite.test.ts` and others (log timestamps 00:30:30–00:31:49). PGlite files are slower than D1 there (19.3 s vs 12.4 s for the file; 1212 ms vs 942 ms for this test), so the real span between sign-in and the check is longer on PGlite.
7. **What the parameter and the other tests say.** `docs/parameters/parameters.md` PAR-425: "used … for up to and including 300 s; at 301 s it is read again". DEC-0668 (decision log): "exactly PAR-425 is still current". The decision log entry for AUTH-AC-003/-012/-013/-015 (line 6939): "Date is frozen with `vi.useFakeTimers({ toFake: ["Date"] })`, so `TestApp.clock` is the only clock that moves". `tests/compliance/criteria/auth/role-refresh.test.ts:26` and `test/integration/auth/sessions.test.ts`, `login-flow.test.ts` freeze `Date`; `testing.suite.ts` is the one file that checks exactly PAR-425 (`advance(ROLE_REFRESH_MS)` with no `+ 1_000`) without freezing it (grep of `advance(…REFRESH…)` across `packages` and `tests`).
8. **DEC-0703 does not make the test wrong in substance.** DEC-0703 says a role change in the Cloudflare account takes effect at the next sign-in because the auth app records the role at sign-in and `role(sub)` reads that record; a refresh then keeps sessions in step with the record. Its "Not changed" list keeps AUTH-AC-003 and the `testing.d.ts` comments, which "describe the fake auth app's record changing, which a refresh does pick up". `testing.d.ts:137–138`: `authApp.setRole` "changes … the user record the next role refresh reads"; `grantRole`/`revokeRole` go through `setRole` (`test-app.ts:409–413`). So "shows at the next role refresh" is correct for the fake's record; the test's expectations (stays `user` at 300 s, `admin` at 301 s, one `role` call) match the code and PAR-425.
9. **PR CI does run this file; it cannot catch a rare failure.** `ci.yml`'s compliance job runs the same command as `release.yml`'s step (`npx vitest run --config vitest.integration.config.ts $DIRECT …`), but with `DIRECT` chosen from the changed paths (`classify.mjs --base`); `scripts/ci/path-map.json` lists `packages/framework/test/integration/testing` under CORE and CLI (CLI depends on AUTH and others), while `release.yml` uses `--all`. It was selected and passed on #167 (evidence 2). A single green run says little about a failure of a fraction of a percent to a few percent per run.

## Causal chain

1. AUTH stamps a session's confirmation time and reads "now" in whole seconds, and refreshes when the difference is more than 300 (evidence 4). This is the specified behaviour (evidence 7).
2. `TestApp.clock` is `Date.now()` plus the offsets the test adds, and `testing.suite.ts` does not freeze `Date`, so between sign-in and the line-199 check the clock moves by 300 000 ms **plus the real time the steps take** (evidence 3).
3. Therefore, when a real second boundary falls inside that real span, `floor(now) − checkedAt` is 301, the refresh runs at the check that expects the level to stand, and the fake's record (`admin`, set by `grantRole`) is returned: `expected 'admin' to be 'user'` (evidence 4, 5 forced). When no boundary falls inside it, the level stands and the test passes (evidence 1, 2, 5 statistics, 5 control).
4. The chance of a boundary is about span ÷ 1000 ms. The span is a few ms alone (≈0.3–0.5 % per run, evidence 5) and longer under the parallel CI step, and longer on PGlite, whose requests are slower (evidence 6). That is why it hit PGlite in this run and not D1; nothing dialect-specific decides the outcome (evidence 4, 5 forced fails on D1 too).
5. So the test, not the code, is wrong: it asserts an exact-boundary outcome (`exactly PAR-425 is still current`) with a clock that is not exact. Its expectations are right (evidence 7, 8); its clock set-up is not.

## Alternatives ruled out

- **A code defect in the refresh boundary (`>` vs `>=`, ms vs s).** `refreshDue` uses `>` on whole seconds, matching PAR-425 and DEC-0668; with `Date` frozen the same sequence gives `user` at 300 s on both dialects (evidence 5 control), and the frozen-clock compliance test of the same boundary is green.
- **Something PGlite-specific (storage, transactions, timestamps in Postgres).** The path reads no SQL: the session is a signed cookie and the fake auth app is in memory (evidence 4). Forcing a second boundary makes local D1 fail the same way (evidence 5 forced).
- **DEC-0703 changed the behaviour and the test is out of date.** DEC-0703 changed wording only ("No code changes") and explicitly keeps the fake-record behaviour the test relies on (evidence 8). The title's "next role refresh" is accurate for the fake's record; at most it could say "the fake auth app's record", which is optional wording, not the cause.
- **DEC-0791 (12-hour sessions, PAR-250).** The test's clock moves at most ≈ 15 min (3 × 301 s); the session cannot expire, and expiry would give `anonymous`, not `admin`.
- **Load alone (rule 7: "passes alone ⇒ a load problem of the run").** It passes alone only by chance; it is reproduced alone on demand by placing a real second boundary in the span (evidence 5 forced). Load raises the probability; the cause is the unfrozen clock, and it would fail alone at ≈0.3–0.5 % per run.
- **A change between PR CI and release.** `git diff ba01ac0 de75082 -- packages/` is empty (evidence 2).

## Proposed fix

Test-only, reason code `test-was-wrong` (citing this record), in `packages/framework/test/integration/testing/testing.suite.ts`; owner of the file: the `./testing` suite (item T3, PR 85).

- Freeze `Date` in the auth-app role test, as the AUTH-AC tests do (DEC entry at decision log line 6939): `vi.useFakeTimers({ toFake: ["Date"] })` at the start of that test, and `vi.useRealTimers()` in the suite's `afterEach` (before `dispose`). Then `TestApp.clock` is the only clock that moves and line 199 checks exactly 300 s.
- The `loginWithStub … grantRole shows at the next refresh` test needs no change: it checks only at `+ 301 s`, which real time can only lengthen.
- Keep every expectation and message as they are; weakening line 199 (e.g. advancing `ROLE_REFRESH_MS - 1_000`) would drop the "exactly PAR-425 is still current" check and is not the fix.
- Optional title wording: "a role changed in the fake auth app's record by grantRole/revokeRole or authApp.setRole …". Not needed for the fix; if changed, list it as `refactor-only`.

## Verification plan

1. **Red first.** In the test, before the fix, place a real second boundary in the span (e.g. a temporary `await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 20))` after `/api/auth/me`), run `testing.postgres.test.ts` and `testing.sqlite.test.ts` alone: both fail at line 199 with `expected 'admin' to be 'user'`.
2. **Green.** Add the `Date` freeze (keep the temporary wait for this run): both files pass. Remove the temporary wait.
3. Run both files alone 5 times each: all pass.
4. Check that `afterEach` restores real timers, so the other six tests of the suite still run on real time (they pass in the same runs).
5. Re-run the release step "Integration tests the harness does not run" via the next release-candidate run (re-check, step 4 of `failure-diagnosis.md`).

## Review

Reviewer: independent root-cause reviewer subagent (`failure-diagnosis.md`, step 2). Date: 2026-11-08. I did not write this diagnosis, the suite or the AUTH code. Base: `v0.2.0/rc01-role-refresh-fix` at 24774dc (`de75082` plus this record). Owner's rule: I ran only `testing.postgres.test.ts`, in the foreground. Every experiment edit was reverted, and nothing but this section and the status line is changed.

**Verdict: accepted.** Each link is supported. I reproduced the failure on demand, and the control, on the failing file. The dialect and load alternatives are ruled out. The fix freezes the clock the test already assumes and weakens no assertion.

### What I checked
1. **Symptom, with `get_job_logs` on job 128575950155.** The checkout is `de75082`. The log has `testing.postgres.test.ts (7 tests | 1 failed) 19287ms`; the failing test is "with the fake auth app … (PGlite) 1212ms", failing with `AssertionError: inside the interval the session's level stands: expected 'admin' to be 'user'` at `testing.suite.ts:199:89`. The local-D1 variant passed in 942 ms, and the file `create.offline.test.ts` (53 836 ms) finished in the same window. Confirmed.
2. **Code, links 1 and 2.**
   - `test-app.ts`: `clock.now = () => Date.now() + clockOffset`.
   - `runtime.ts:108`: `checkedAt: Math.floor(now() / 1000)`. `runtime.ts:185`: `nowSeconds = Math.floor(now() / 1000)`.
   - `role-refresh.ts`: `refreshDue` is `nowSeconds - checkedAt > 300`.
   - `testing.suite.ts` has no `useFakeTimers`.

   So at an offset of exactly 300 000 ms, the result depends only on whether a real second boundary falls between sign-in and line 199. Confirmed. PAR-425 in `parameters.md` ("up to and including 300 s; at 301 s it is read again") matches the code.
3. **Forced-boundary experiment, link 3 (run alone, `-t "fake auth app"`).** I added `await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000) + 20))` after `const redeems = …`, before `grantRole`. Result: **failed** with the identical message, `expected 'admin' to be 'user'`, at the shifted line 200. So it reproduces alone, on PGlite, with no load.
4. **Control.** I kept the forced wait and added `vi.useFakeTimers({ toFake: ["Date"] })` at the test's start and `vi.useRealTimers()` at the top of `afterEach`. The whole file passed: **7 of 7**. So the other six tests are unaffected by the freeze and its reset.
5. **Mutation, to show the fix weakens nothing.** I kept the frozen set-up from 4 and changed `refreshDue` to `>=`. The test **failed** at the exact-300 s check (`expected 'admin' to be 'user'`). With `Date` frozen, `floor((T + 300 000)/1000) − floor(T/1000)` is exactly 300 for every T, so line 199 still detects an off-by-one boundary, and now does so deterministically. I reverted both edits.

### Links and alternatives
- **Links 1–3 and 5:** supported by 2–4 above. **Link 4 (probability, PGlite more often):** consistent with the record's timings and the CI log. It is a matter of exposure, not the cause, and the record says so.
- **Dialect:** ruled out. The path reads only the signed cookie and the in-memory fake, and nothing on it is dialect-specific. A forced boundary fails PGlite alone (3), with no load. I did not re-run the local-D1 forced case (owner's rule: only this file). The code argument and the D1 variant's own exposure under the same logic make it unnecessary for the verdict.
- **Load (rule 7):** ruled out as a cause, which is why this case still needed diagnosis although it passes alone. The failure reproduces alone on demand (3). Load only widens the real span.
- **Code defect at the boundary:** ruled out. `>` on whole seconds is what PAR-425 and DEC-0668 specify, and the frozen run passes the exact-300 s check and catches `>=` (5).
- **DEC-0703 and DEC-0791:** I accept the record's reading. The fake's record changes through `setRole`, and a refresh reads it. The test's clock moves at most about 15 minutes against 12-hour sessions, and an expired session would give `anonymous`, not `admin`.

### Fix: accepted
- Freezing `Date` in this one test, with `useRealTimers` in `afterEach` before `dispose`, matches the AUTH-AC tests (`tests/compliance/criteria/auth/role-refresh.test.ts:26`; decision log line 6939). Every assertion and message stays the same. Rejecting `ROLE_REFRESH_MS - 1_000` as a weakening is right. The reason code `test-was-wrong` is right.
- **Same pattern elsewhere in the suite: none.** The only other clock use in `testing.suite.ts` is the `loginWithStub … grantRole` test (`:178–180`). Its "stands" check has no advance (it would need more than 300 s of real time), and its later check is at `+301 s`, which real time can only lengthen. So it needs no change, as the record says.
- **Beyond the suite:** every other `clock.advance` user either freezes `Date` (`role-refresh.test.ts`, `test-app.unit.test.ts`) or advances past the boundary by at least 1 s (`admin-role.test.ts` uses `(300 + 1) * 1000`; `E2E-007-E2E-018-signin.spec.ts` uses `REFRESH_MS + 1000` and a 60 s expiry margin). None asserts an exact boundary on the real clock.

### Verification plan: adequate
Steps 1–2 are the red and green I ran in 3–4. For step 1 the fixer should use the temporary wait, then remove it, as written. The fixer runs both dialect files alone only if the owner's rule for that run allows it. Otherwise run the PGlite file and leave D1 to the release re-run (step 5).
