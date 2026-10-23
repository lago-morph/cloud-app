# F-EV: Final evaluation (local and Cloudflare phase)

**Update 3 (F-EV3), 2026-10-21.** This file replaces F-EV2 (`27b4366`, base `903d0f9`), which is in git history; F-EV2 itself replaced the first F-EV (`b53f841`). Since F-EV2, new §8 cycles have landed (the reviews of the D-01, D-03 and order-scan records; fix-registry and fix-registry-2; fix-mig002), and two more full local runs were recorded: one failed MIG-AC-002 (final-local-3 (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md)), and the next passed everything (final-local-4). This update re-bases the local column on final-local-4, records the MIG-AC-002 failure and its outcome, and updates the open items. The Cloudflare and AWS columns are unchanged.

Evaluator: an independent F-EV subagent. I wrote none of the code, tests, evidence or reviews judged here. I worked from committed evidence only:
- I ran no test suite and made no Cloudflare call.
- I changed no code, test or evidence.
- `npm ci` was run only so that the read-only release-report generator could run (`node tests/compliance/tools/report.mjs release`, which reads records and `git log`).

Base: `origin/claude/implement-local-cloudflare` at `c016e7e` ("Merge batch-verify-4 and final-local-4 evidence"). Branch: `claude/implement-local-cloudflare-f-ev3`.

Inputs:
- plan §1, §7 (F-EV) and §8;
- F-EV2 (this file at `27b4366`) and the interim report `ai/implementation/final-report.md`;
- the root-cause records and reviews added since `903d0f9`: `2026-10-20-D-01-…`, `2026-10-20-D-03-…` and `2026-10-20-test-order-dependence-scan.md` (Reviews), `2026-10-20-testing-dev-registry.md` (fix-registry, fix-registry-2), `2026-10-20-mig-ac-002-workerd-crash.md` (fix-mig002);
- decision-log entries DEC-0415…DEC-0417;
- the evidence listed below, including the raw Vitest and Playwright JSON of R3, R3b and R4, compared test by test for skips.

Context taken as given: Cloudflare testing is stopped (DEC-0317). D1 has been off since the phase A spikes used up the daily row limit on 2026-10-19, and the owner has not yet allowed testing to resume. D-RUN, D-RUN-M and F-03 have not run, so D-EV is not done. Google login is mocked (§8.1). AWS is out of scope (§8.2).

## Evidence references

| Ref | What | Commit | Notes |
| --- | --- | --- | --- |
| **R4** | `validation/local/pzeugkxrk1xcu2w.json` (+ `raw/`), logs in `validation/local/final-local-4/` | `a5b2164` | **Full, unfiltered** `npm run compliance -- --target local`, run once. 111 results for 109 distinct IDs: 109 passed and 2 not-run, the §8.2 clause entries of CORE-AC-006 and SQL-AC-006. 0 failed, 0 blocked, exit 0. Playwright: 42/42 passed, 0 skipped, 0 flaky. Integration layer: 586 tests, 564 passed and 22 skipped (§4.3). Unit layer: 1706 tests, 53 passed, 1653 skipped by design (DEC-0319). HEAD did not move during the run. Dev registry empty after every step. Not run under the `MINIFLARE_WORKERD_PATH` wrapper (the summary does not mention it). |
| **BV4** | `validation/local/batch-verify-4/` | `a5b2164` | `verify` online and offline, exit 0, each run once. Unit 179 files, 1706/1706; template 18/18 and reference 52/52 per dialect; skill example pages 2/2. |
| R3b | `validation/local/r5nndia2aediccu.json`, `validation/local/final-local-3/` (archived) | `760e7b7` | Full, unfiltered run: 108 passed, 2 not-run (the same clause entries), **1 failed (MIG-AC-002)**, exit 1. The failure was not re-run. Integration 582 tests: 563 passed, 1 failed, 18 skipped. Playwright 42/42. Superseded by R4; see §5 for the failure. |
| BV3 | `validation/local/batch-verify-3/` (archived) | `760e7b7` | `verify` online and offline, exit 0. Unit 178 files, 1692/1692. |
| R3 | `validation/local/q3qgbyunuxaz1fw.json` (archived), `validation/local/final-local-2/` | `26128b1` | F-EV2's basis: 109 passed, 2 not-run, exit 0. Superseded by R4. |
| R1, R2 | `emckebxm5x3kxd1` (archived), `cmzgvk4zb2o6ako` | `8d65a70`, `ed1f51b` | Earlier runs, superseded. |
| **S1** | `validation/local/g7586p3q4x45qyc.json` | `97dd0d7` | F-01 round 4's own `smoke --target local`: 7/7 passed. Since `97dd0d7`, the only change under `apps/demo` is `b098f89`, which edits `BUILD-RECORD.md` alone (`git diff --stat 26128b1 a5b2164 -- apps tests/compliance/e2e skill` is empty). |
| review | `validation/reviews/E2E-016.md` (review at `e8c3289`, re-review at `b3e3775`) | | The E2E-016 review part. |
| RC-009 | `ai/implementation/root-causes/2026-10-20-demo-ac-009.md`, section "Review" | `19a6b09` | Independent review: **accepted**. |
| BUILD-RECORD | `apps/demo/BUILD-RECORD.md` (round 4) | `97dd0d7` | Model and inputs of the E2E-015 build. |

What changed between the evidence and the base:
- **R4 and BV4 (`a5b2164`) to the base (`c016e7e`):** only `validation/` changed (`8c53e2c`). So R4's results hold for the base tree. The release report still reads "no record for commit", because COMPL-REQ-006 counts only records of the exact commit (§8).
- **R3 (`26128b1`) to R4 (`a5b2164`), outside `validation/`, `ai/` and `docs/`:**
  - fix-registry (`cb80eb0`): `testing/test-app.ts` and its unit test (DEC-0415);
  - fix-registry-2 (`ef62a5d`): new `targets/local/platform-proxy.ts`, used by `test-app.ts`, `check/migrations/databases.ts` and `provision/cloudflare/d1/fake-d1-api.ts`, with guard tests (DEC-0416);
  - fix-mig002 (`86f3928`): `cli/commands/dev.ts`, `cli/dev/plan.ts`, `cli/dev/runtime.ts` and their unit tests; `test/integration/local/dev.test.ts`; `tests/compliance/criteria/mig/deploys.test.ts` and `support/stage.ts` (`failureOutput`, messages only) with `failure-output.unit.test.ts` (DEC-0417).
  - Nothing under `apps/`, `skill/` or `tests/compliance/e2e/` changed. R4 and BV4 cover every change at one commit.

## 1. Verdict

**The framework is "not working"** (COMPL-REQ-006, prompt §11):
- **AWS:** nothing has run (AWS phase not started).
- **Google:** the real Google login certification (GOOGLE-AC-005, E2E-008) and the other Google-dependent items are outstanding.
- **Cloudflare:** every Cloudflare criterion is `blocked`. The phase-D and F-03 cloud runs have not started.

**Local:**
- All 110 Local IDs are `passed`, and none is `failed`.
- 109 of them passed in one full, unfiltered run at one commit (R4, `a5b2164`), and `verify` passed online and offline at the same commit (BV4). The 110th is E2E-015, a milestone with no runner record of its own (BUILD-RECORD plus R4).
- Two clause entries inside passed IDs are `not-run` under §8.2: CORE-AC-006's AWS bundle and SQL-AC-006's Data API retry loop.
- **MIG-AC-002 failed once since F-EV2**, in R3b. Its cause is **unproven**. A confirmed latent defect of the same signature (the `dev` port race) was fixed under DEC-0417, and MIG-AC-002 passed in the next full run, R4. One clean run does not prove the failure is gone; it is recorded as open item U1 (§5, §6).
- Phase F's local exit is **met**, with these open items, none of which blocks it:
  - **U1:** the cause of R3b's MIG-AC-002 failure is unproven (§5);
  - **W5:** DEMO-AC-003's warn-clause test is weak, and fixing it needs an owner decision (Q10);
  - **G5:** there is no milestone evidence record for E2E-015 and E2E-016;
  - **G4 and O2:** untagged tests filtered out of driver runs (optional; §4.3);
  - **O3:** the order scan covers 29 of 84 integration files (optional).

Counts by status (every `*-AC-*` and `E2E-*` ID, per target where its Where applies; a milestone-only item counts once):

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 110 | 0 | 0 | 0 (plus 2 §8.2 clause entries inside passed IDs: CORE-AC-006, SQL-AC-006) |
| cloudflare | 81 | 0 | 0 | 73 | 8 (Google login mocked) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

Change from F-EV2: none in the counts. The local basis moves from R3 (`26128b1`) to R4 (`a5b2164`). MIG-AC-002 was `failed` in R3b in between and is `passed` in R4.

### DEMO-AC-003: status decided under plan §8

Unchanged from F-EV2 (`27b4366`, §1), now on R4. I record DEMO-AC-003 on local as **`passed`, with the open weak assertion W5**, not as `not-run`:
- No §8 rule applies: the warn clause is a Local, automated clause, and R4 ran its tagged test, which passed (`demo-criteria.spec.ts:656`, 4.7 s; the `FILES.UNAVAILABLE` error entry is at R4 `raw/playwright.log:37`).
- The test simulates the failure the only way the testing contract allows (`unavailable: ["files"]`). Under that contract the deleted post can never hold a stored photo (`testing.d.ts:40-41,93`; no seed API; `service.ts:140-144`), so the failing operation is the `files.list` of an empty prefix, never the `files.delete` of a stored file.
- My source reading closes the gap for this demo (`posts.ts:109-120`: one `try`/`catch` around the `list` and every `delete` writes the `warn`), but the test does not. A stronger test needs a contract change, which belongs to the owner: plan §11 Q10.

## 2. Judgements: demo criteria and the F-EV scenarios

In this table, CF means Cloudflare. Local evidence is R4 unless the row says otherwise.

| ID | local | cloudflare | aws | Judgement |
| --- | --- | --- | --- | --- |
| DEMO-AC-001 | passed (R4, S1) | blocked (F-03 not run; D1) | not-run (§8.2) | As in the first F-EV, now from R4. The "renders as text" clause comes from `demo-pages.spec.ts`. The "only published, newest first, paginated" clause comes from the smoke test run inside E2E-002. W1 still applies. |
| DEMO-AC-002 | passed (R4) | blocked | not-run | Page requests replayed as four identities. |
| DEMO-AC-003 | **passed (R4, S1); W5 open** | blocked | not-run | Display: `demo-pages.spec.ts:230`, after fix-f04b (the `attachment` header does not affect `<img src>`). Round trip, maximum and delete: the smoke test inside E2E-002, after fix-f04b. Warn clause: `demo-criteria.spec.ts:656`, passed in 4.7 s. Its weak assertion W5 is explained in §1 above. The re-run asked for in §4.1 is done. |
| DEMO-AC-004 | passed (R4) | blocked | not-run | Unchanged. |
| DEMO-AC-005 | passed (R4) | blocked | not-run | Unchanged. |
| DEMO-AC-006 | passed (R4) | n/a | n/a | Unchanged. |
| DEMO-AC-007 | passed (R4) | blocked | not-run | Unchanged (W4). |
| DEMO-AC-008 | passed (R4) | blocked (driver's cloud check at F-03) | not-run | Unchanged (W3). |
| DEMO-AC-009 | passed (R4) | blocked | not-run | The root-cause record now has an independent Review: accepted, no required changes (RC-009). F3 is closed. |
| DEMO-AC-010 | passed (R4, local part) | blocked (F-03) | not-run | Local part only. The criterion needs Cloudflare and AWS from the same commit. |
| DEMO-AC-011 | passed (R4) | n/a | n/a | Unchanged. |
| CHECK-AC-005 | **passed (R4)** | n/a | n/a | Template part: `verify passes on the template`. Demo part: the new `[CHECK-AC-005] demo part` test (`demo-local.spec.ts:26`). It copies `apps/demo` to a fresh `.framework/e2e/` directory, without local state, build output or secrets, runs the app's own `verify`, and asserts exit 0. It passed in 84.1 s, which fits a real `verify` with the app's tests. The stale `PHASE_RULES` entry was removed (`expected.ts`), and R4's `raw/expected.json` lists CHECK-AC-005 with no not-run part. G2 is closed for this ID. |
| E2E-002 | passed (local part, R4) | blocked (F-03) | not-run | **Scenario not met:** it needs all three smoke runs from one commit. The local part is sound. |
| E2E-004 | **passed (R4)** | blocked | not-run | All three parts are now read from one full, unfiltered record: the coverage part (every expected local ID has a tagged test), the record part, and the pass part. For the pass part, every other applicable result in R4 is `passed`, apart from the two §8.2 clause entries; the driver's own E2E-004 result is `passed` and its exit status is 0. G1 is closed. **Scenario not met** until Cloudflare and AWS pass. |
| E2E-015 | **passed (milestone; BUILD-RECORD, R4)** | blocked (F-03) | not-run | Round 4 was built by a fresh agent from only `skill/`, `apps/template` and `demo-spec.md`, and BUILD-RECORD records the model and inputs. No `FRAMEWORK-ISSUE.md` entry was raised; the only such file is the template `skill/templates/FRAMEWORK-ISSUE.md`. The F-02 records for rounds 1 to 3 are ACCEPTED, and their fixes have landed. Every local demo criterion now passes in R4, at a commit whose `apps/demo` equals round 4. DEMO-AC-003 carries W5, which concerns the test, not the demo. The first F-EV's reasoning on `skill/reference/files.md` line 39 (fix-f04b; no rebuild needed) still holds. **There is no milestone evidence record (G5)**, so the release report cannot see this pass. This is the same footing on which E2E-016's review was counted. Cloud parts are blocked. |
| E2E-016 | passed (scan R4; review) | n/a | n/a | Scan part: 3 tagged tests passed in R4. Review part: unchanged. G5: no milestone evidence record. |
| FILES-AC-003 | **passed (R4)** | blocked | not-run | R4 is after fix-f04b, so the provisional note in §4.1 is lifted. |
| E2E-009 | **passed (R4)** | blocked | not-run | R4 is after fix-f04b, so the BMP `attachment` path now has a committed run. Its test passed in 9.9 s. The provisional note in §4.1 is lifted. |

## 3. Phase-F notes on the non-demo IDs

- CLI-AC-003: C-EV Flag 1 is closed. The tagged driver tests that inject runner and cleanup failures are in `tests/compliance/harness/driver.unit.test.ts`.
- SEC-AC-001…004: C-EV Flag 4 is closed.
- E2E-011 (local): passed in R4. Its Cloudflare run, which must use only the commands in `skill/reference/troubleshooting.md`, stays blocked (E-EV).

## 4. Specific checks

### 4.1 fix-f04b and the re-run of FILES-AC-003, E2E-009 and DEMO-AC-003

Resolved in F-EV2 (R3), and still holds: R4 is later than fix-f04b, and all three IDs passed in it. SKILL-AC-001 and SKILL-AC-004 also passed in R4.

### 4.2 Unit test counts

- BV2 (`1487c7d`) 1687 → BV3 (`760e7b7`) 1692 → BV4 (`a5b2164`) 1706, every one passed online and offline.
- The rise comes from new tests only: the dev-registry guard tests of fix-registry and fix-registry-2 (`test-app.unit.test.ts`, `databases.unit.test.ts`, `fake-d1-api.unit.test.ts`), and fix-mig002's `plan`, `dev` and `runtime` unit tests and `failure-output.unit.test.ts` (red-green tables in the two root-cause records).
- I found no removed or weakened test. fix-mig002's changes to `deploys.test.ts` and `support/stage.ts` alter only the message argument of `expect(result.ok, msg).toBe(true)` and of one `throw` (`deploys.test.ts:80,109,138,166,190`), as the Review required.

### 4.3 Skipped tests, weak assertions, mis-tagged tests

**Skipped, integration layer: 22 in R4, against 18 in R3b and R3.** I compared the skipped sets test by test (`raw/vitest.json`). The 18 are identical in R3, R3b and R4. The 4 new ones are the regression tests added by fix-mig002:

| # | Test | Why skipped |
| --- | --- | --- |
| 1–16 | Cloud-only tests: CF-AC-001, CF-AC-002, FILES-AC-005, HTTP-AC-005, LOG-AC-004 (2), MIG-AC-006, PROV-AC-001, -002, -003, -004, -006, COMPL-AC-004, COMPL-AC-008, the secrets further-stage test and the SEC storage cloud part | No local part; they run on a Cloudflare stage (`blocked`). Unchanged since R1. |
| 17–18 | The untagged positive controls for CFG-AC-002 and CORE-AC-007 | Untagged, so the driver's `-t` ID filter leaves them out (G4). Unchanged. |
| 19 | `test/integration/local/dev.test.ts`: "dev picks no port before binding it (MIG-AC-002 root cause, …) serves even when every port freePort returns is taken by another socket before dev binds it" | **New.** Untagged (its title names MIG-AC-002 without the `[ID]` form), so the driver's `-t` filter leaves it out. It is an integration test, so `verify` does not run it either. Its only run is the fixer's red-green (red at `2e33dc5`: "Port 39191 is already in use"; green with the fix), in the record, not in runner output. Open item O2. |
| 20–22 | `tests/compliance/criteria/mig/support/failure-output.unit.test.ts`, 3 tests of `failureOutput` | **New.** Untagged unit tests. The integration glob `tests/compliance/criteria/**/*.test.ts` also collects this `*.unit.test.ts` file, and the `-t` filter skips it there and in the driver's unit pass. They are in the unit suite (`tests/**/*.unit.test.ts`) and **passed in BV4** (1706/1706). |

**None was skipped to obtain a pass (prompt §8).**
- No test in either file carries `.skip`, `.todo` or a skip condition (`dev.test.ts:19-28`, `failure-output.unit.test.ts:4-23`). They are skipped only by the ID filter, as every untagged test is.
- None of them is a criterion test. Every tagged test of MIG-AC-002 ran in R4 and passed: `deploys.test.ts` "[MIG-AC-002] initial deployment …" (9.7 s) and "[MIG-AC-002] a second deployment with no changes …" (10.2 s, the test that failed in R3b), and `mig/deploy-local.test.ts` "[MIG-AC-002] local: …" (21.1 s). The LOCAL-AC-002 and LOCAL-AC-004 tests in `dev.test.ts`, which exercise the changed `dev`, also ran and passed.
- The integration pass count is 564 in both R3 and R4; R4's total is 4 higher (586 against 582), exactly the 4 new untagged tests.

**Other skipped counts:** R4 Playwright: none (42/42 ran, 0 flaky). R4 unit layer: 1653 skipped by design (DEC-0319), up from 1634 by the 19 new untagged unit tests (1706 − 1687).

**Weak assertions:** W1–W5 unchanged from F-EV2:
- W1. DEMO-AC-001 "paginated": only the page size is shown.
- W2. The smoke-test clauses of DEMO-AC-001 and -003 count through E2E-002's tag.
- W3. DEMO-AC-008 matches its `info` entry by time window and requestId, not by message.
- W4. DEMO-AC-007's expiry clause uses a shifted clock.
- **W5 (open, owner, Q10).** DEMO-AC-003's warn clause (§1).

**O1 (closed).** The edited `tests/compliance/harness/expected.unit.test.ts` is in the unit suite, which passed in BV3 and BV4.

**Mis-tagged:** none found. The new regression tests carry no tag, which is correct: they guard a root cause, not a criterion clause.

## 5. Root-cause records (prompt §8)

| Record | Diagnosed | Review | Fix and re-check |
| --- | --- | --- | --- |
| **mig-ac-002-workerd-crash** (new) | yes: workerd died at startup in `Server::run`; the visible frames match a deliberate `bind(): Address already in use` frame for frame (F2) | **Not accepted as the proven cause** of R3b's failure. Accepted in two narrower parts: (A) the pick-then-release port race is a proven latent defect, to be fixed race-free (not by retry); (B) the diagnostic change. | fix-mig002 (`86f3928`, DEC-0417): Wrangler on `--port 0 --inspector-port 0` with the port read from IPC `DEV_SERVER_READY`; Vite first on port 0, with a bounded retry on structured `EADDRINUSE` only; `failureOutput()` keeps the first `***` fatal line and `Runtime stderr:` block. Red-green recorded. MIG-AC-002 passed in R4. **Cause of the R3b failure still open (U1).** |
| **testing-dev-registry** (new) | yes: `createTestApp` joined the host-wide Miniflare dev registry under the fixed name `test-app` | **ACCEPTED, with required changes** (assert the env restore, name the guard, narrow the `~/.config` wording, add a follow-up item) | fix-registry (`cb80eb0`, DEC-0415) and the follow-up fix-registry-2 (`ef62a5d`, DEC-0416: one registry-free helper for `createTestApp`, the migration checker and the fake D1 API). Red-green recorded. Guard tests passed in BV3 and BV4; registry empty after every R4 step; no `TimeoutOverflowWarning` in R4's integration log. |
| test-order-dependence-scan | yes | **ACCEPTED-WITH-CHANGES** (new Review): main result accepted with its stated limits; the `sessions.test.ts` observation is a real defect with a different cause, which became the testing-dev-registry record | Fixed by fix-registry. The scan's coverage gap (55 of 84 files) stays open (O3). |
| D-01, D-03 | yes | **ACCEPTED** (new Reviews): the cause is host load against the 5 s default, and the D-04 fix (`testTimeout: 30_000`, per-test limits) covers every named test | Covered by the D-04 fix. |
| e2e-016-r01, -r06; demo-ac-009; F-02 rounds 1–3; CLI-AC-003, compliance-cli-exit, COMPL-AC-001, SKILL-AC-001/-004, E2E-004; earlier B/C records | yes | as in F-EV2 | Landed. |

**MIG-AC-002 in R3b: what is known and what is not.**
- **Failure:** in R3b (`760e7b7`), `deploys.test.ts:109` "[MIG-AC-002] a second deployment with no changes …" failed. The no-change deploy's `dev` start exited 1: workerd printed a fatal stack and wrangler exited "before serving". The test kept only the last 1500 characters, so the first line of workerd's error was cut off, and wrangler's log file holds no error. The run was not repeated. The scratch app was deleted after the run.
- **Diagnosis:** the code `dev` runs was byte-identical between R3 (passed) and R3b (failed); fix-registry and fix-registry-2 are ruled out (they do not run in `dev`). OOM and a deterministic app error are ruled out. The failure did not reproduce in 3 isolated `--only MIG-AC-002` runs.
- **Unproven:** that the fatal was a port-bind error. The visible frames are workerd's generic fatal path, shared by any kj exception or a crash signal (record F1; Review reason 1). No per-port record of the run exists.
- **Fixed anyway, as a confirmed defect:** the reviewer accepted the pick-then-release race as real (deterministic reproduction, F2) and required a race-free fix, which DEC-0417 made.
- **Outcome:** MIG-AC-002 passed in the next full run, R4 (all 3 tagged tests), and BV4 passed. Given the measured collision rate (about 0.1–0.65 % per freed port under load, record F8), one clean run is consistent with the fix but cannot confirm that the race was this failure's cause.
- **What would settle it (U1):** the first fatal line of workerd's stderr from a recurrence.
  - The MIG deploy messages now keep it (`failureOutput`). So any recurrence in a later full run is self-diagnosing.
  - Or a full local run under `MINIFLARE_WORKERD_PATH=<scratch>/workerd-wrap.sh` (the record's wrapper), which stores every workerd's full stderr and arguments. R4 was not run under it.
  - If a later run fails any `dev` start with a fatal that is not `bind(): Address already in use`, the record returns to §8 step 1 with that line (Review verdict). A bind error on the worker or inspector port can no longer happen, because `dev` no longer pre-picks them.

## 6. Gaps and open items

| # | Item | Status | Evidence / remaining action |
| --- | --- | --- | --- |
| G1 | Full local run at one commit | **Closed** | R4 (`a5b2164`, exit 0), with BV4 at the same commit. |
| G2 | Demo `verify` and DEMO-AC-003 warn-clause runner evidence | **Closed, with W5 open** | Both tests passed in R4. |
| G3 | Review on the DEMO-AC-009 record | **Closed** | RC-009. |
| G4 | Untagged controls for CFG-AC-002 and CORE-AC-007 are filtered out of driver runs | Open (optional) | Tag them. No verdict depends on it. |
| G5 | No milestone evidence records (E2E-016 review, E2E-015); no record of the Cloudflare `blocked` set | **Open** | As before. The generator, run for `a5b2164` (not committed), lists only four local lines: CORE-AC-006 and SQL-AC-006 (the §8.2 clause entries), and E2E-015 and E2E-016 (milestone, no record). Record them with `--milestone`, or with a record written for the review. Record the Cloudflare `blocked` set once a `--blocked` run is confirmed to make no Cloudflare request (DEC-0261). |
| W5 | DEMO-AC-003 warn clause: weak assertion forced by the testing contract | **Open, owner** | Plan §11 Q10. |
| **U1** | **Cause of R3b's MIG-AC-002 failure unproven** | **Open (new)** | The race is fixed (DEC-0417) and MIG-AC-002 passed in R4. Settled by the first fatal line of a recurrence, which `failureOutput` now keeps, or by a full local run under the `MINIFLARE_WORKERD_PATH` wrapper (§5). A non-bind fatal sends the record back to §8 step 1. No verdict depends on it today. |
| **O2** | fix-mig002's integration regression test (`dev.test.ts`, "serves even when every port freePort returns is taken …") has no runner output | Open (new, minor) | It is untagged and not in `verify`, so no committed run covers it; only the fixer's red-green does. Run it in the next batch (`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/local/dev.test.ts`), or have the driver run untagged regression tests. |
| O3 | Order-dependence scan covers 29 of 84 integration files | Open (optional) | The accepted record's next step: shuffle runs for `kv/*`, `sql/*`, `files/server-operations` and `local/dev`. |
| O1 | Edited `expected.unit.test.ts` had no runner output | **Closed** | BV3, BV4. |
| — | D-01, D-03 and order-scan records lacked Reviews | **Closed** | Reviews committed in `8f3ab0f`. |

Also noted, not open: the testing-dev-registry Review's re-check 5 (run `sessions.test.ts` alone with a planted foreign entry) has no committed output of its own. The same mechanism is guarded by the three `createTestApp and the dev registry` unit tests, which plant foreign entries under faked dates and passed in BV3 and BV4.

**Remaining open local items:** U1 (unproven cause), W5 (owner), G5 (milestone records), O2 (minor), G4 and O3 (optional), and W1–W4 (accepted weak points). None is a `failed` or `not-run` local entry.

Cloudflare (not local): every entry is `blocked`. When the owner allows it after the D1 reset, the order is D-RUN, D-RUN-M, F-03 and then D-EV, each under the plan §1 caps, with before and after D1 readings. E2E-011 (cloud, troubleshooting commands only) and the DEMO cloud parts (including DEMO-AC-008's driver check) go with F-03.

## 7. Confirmed §8 not-run lists

Unchanged from F-EV2. In brief:
- **§8.1 (Google login mocked):** GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-005 (admin-list), AUTH-AC-009 (production), AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud), E2E-008, and CLI-AC-001 for its `certify-auth` part only (note N1: its other cloud commands are `blocked`).
- **§8.2 (AWS phase not started):** every AWS entry, plus the AWS parts inside the criteria run here. On local, the AWS parts appear as R4's two clause entries for CORE-AC-006 and SQL-AC-006. No AWS code exists, so no clause was wrongly passed.
- **§8.3 (milestones):**
  - E2E-016 review and E2E-015 (local) are judged `passed`, with no evidence record (G5).
  - E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006 (CF part) and COMPL-AC-008 are `blocked` (D-RUN-M not run).
  - GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006 and AUTH-AC-005 admin-list are `not-run` (Google).
  - All AWS runs are `not-run`.
- **No §8 rule is used for DEMO-AC-003** (§1), and none for the skipped regression tests (§4.3), which are not criterion tests.

## 8. Release report

The report is generated with `node tests/compliance/tools/report.mjs release --commit c016e7e831c9cced1f9b1f441d47d5c54e09be0d --out validation/release/2026-10-21-c016e7e.md`, in the same way as the earlier report for `903d0f9` (since deleted from `validation/release/`; the same command regenerates it).

- **Result:** **"not working"**.
- **Why:** COMPL-REQ-006 counts automated records only for the exact commit. The latest local record (R4) is for `a5b2164`, and the base `c016e7e` adds only `validation/` files, so every automated entry again reads "no record for commit". The generated text is identical to the `903d0f9` report apart from the SHA.
- **Context:** for information, the same generator run for `a5b2164` (not committed) lists only four local lines: CORE-AC-006 and SQL-AC-006 (the §8.2 clause entries, run `pzeugkxrk1xcu2w`), and E2E-015 and E2E-016 (milestone, no record; G5).
- **Milestones:** no milestone record exists, including the Google certification GOOGLE-AC-005. Every commit since the start of history that touched GOOGLE or login-provider interface files is therefore listed.
- **Evaluator's note:** appended below the generated text and marked as not generated.

## 9. Full per-target status table

Status cells give the status and its evidence ref. Evidence refs:
- R4, S1, BUILD-RECORD and review are defined at the top.
- DEC-0317 means no Cloudflare record exists because Cloudflare testing is stopped. Every Cloudflare `blocked` has the detail "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset".
- §8.1 means "Google login mocked for this phase".
- §8.2 means "AWS phase not started".
- n/a means the Where column does not name that target.

Notes that hold for most rows are given here and not repeated in each row:
- **Local `passed` with R4 and no note:** every tagged test passed in R4, at `a5b2164`. The base `c016e7e` differs from it only in `validation/`.
- **Cloudflare:** "D-RUN not run", unless the row says otherwise.

| ID | Where | local | cloudflare | aws | Notes |
| --- | --- | --- | --- | --- | --- |
| AUTH-AC-001 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-002 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-003 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-005 | Local, cloud; admin-list part: cloud (milestone) | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Contract part. Admin-list part is cloud milestone (Google, §8.1). CF: Contract part `blocked` (D1). Admin-list part (milestone) `not-run`: Google login mocked. |
| AUTH-AC-006 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-007 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-008 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-009 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Local and test-stage parts; production 404 part is cloud (Google, §8.1). CF: Test-stage part `blocked` (D1). Production part `not-run`: Google login mocked. |
| AUTH-AC-010 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-011 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| AUTH-AC-012 | Local | passed (R4) | n/a | n/a |  |
| AWS-AC-001 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-002 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-003 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-004 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-005 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-006 | Cloud | n/a | n/a | not-run (§8.2) |  |
| CF-AC-001 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-002 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-003 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-006 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-003 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-004 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-005 | Local | passed (R4) | n/a | n/a | L: Template part: `verify passes on the template`. Demo part: `demo-local.spec.ts` `[CHECK-AC-005] demo part`, `verify` on a fresh copy of `apps/demo` (exit 0, 84 s). The stale `PHASE_RULES` entry is gone (R4 `raw/expected.json`: no not-run part). G2 closed. |
| CHECK-AC-006 | Local | passed (R4) | n/a | n/a |  |
| CLI-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | CF: Only the `certify-auth` part needs a production stage (Google, §8.1). The other commands are `blocked` (§8 note N1). |
| CLI-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CLI-AC-003 | Local | passed (R4) | n/a | n/a | L: C-EV Flag 1 closed: the tagged driver tests that inject runner and cleanup failures. |
| CLI-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CLI-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-005 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| COMPL-AC-006 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-007 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-008 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| CORE-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-004 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-005 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-006 | Local | passed (R4) | n/a | n/a | L: AWS-bundle clause `not-run` (§8.2), recorded as its own entry in R4. |
| CORE-AC-007 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-008 | Local | passed (R4) | n/a | n/a |  |
| DEMO-AC-001 | Local, cloud | passed (R4; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Script clause: `demo-pages.spec.ts`. Newest first, drafts hidden and page size: the demo's smoke test, run inside E2E-002 in R4. Weak point W1. |
| DEMO-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: `demo-criteria.spec.ts`. Four identities replay the page's own requests. |
| DEMO-AC-003 | Local, cloud | passed (R4; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Display (`demo-pages.spec.ts`), round trip, maximum and delete (smoke inside E2E-002), and the warn clause (`demo-criteria.spec.ts:656`, in-process with `unavailable: ["files"]`), all after fix-f04b. **Open weak assertion W5:** the warn test can only fail the `list` of an empty prefix, never the deletion of a stored photo, because of the testing contract (§4.3, Q10). |
| DEMO-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: R4. |
| DEMO-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: logout through the page and login again in the same and a new browser. |
| DEMO-AC-006 | Local | passed (R4) | n/a | n/a | L: `demo-local.spec.ts`: values file changed, then `dev` restarted. |
| DEMO-AC-007 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: altered link through the page; expiry in-process with a shifted clock. |
| DEMO-AC-008 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: info entries matched by app, severity, requestId and time window (W3). CF: Cloud check by the driver at F-03. |
| DEMO-AC-009 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: R4, after the test fix `c3b407c`. The root-cause record now has its Review (accepted; G3 closed). |
| DEMO-AC-010 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Local part: `E2E-002.spec.ts` (shared tag). |
| DEMO-AC-011 | Local | passed (R4) | n/a | n/a | L: production values files, then the stub provider in-process. |
| E2E-001 | Local | passed (R4) | n/a | n/a |  |
| E2E-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Local part only: the smoke test passed from a copy identical to `apps/demo` at `a5b2164`. CF: F-03 not run. |
| E2E-003 | Local | passed (R4) | n/a | n/a |  |
| E2E-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Coverage, record and pass parts, all in R4, one full unfiltered run at one commit: every other result is `passed` or a §8.2 clause entry, exit 0. G1 closed. **Scenario not met** until Cloudflare and AWS also pass. |
| E2E-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-006 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-007 | Local; cloud (milestone) | passed (R4) | not-run (§8.1) | not-run (§8.2) | L: Local part (in-process, stub provider); cloud part milestone, not-run (§8.1). |
| E2E-008 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-009 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: R4 is after fix-f04b, so the BMP `attachment` path is now covered. The provisional status of the previous F-EV is lifted. |
| E2E-010 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-011 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | CF: Must use only the commands in `skill/reference/troubleshooting.md` §1 (E-EV). |
| E2E-012 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-013 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-014 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-015 | Local, cloud (milestone) | passed (BUILD-RECORD; R4) | blocked (DEC-0317) | not-run (§8.2) | L: Round-4 demo (`97dd0d7`, BUILD-RECORD) built from the three inputs. No `FRAMEWORK-ISSUE.md` entry is open, and every F-02 record is ACCEPTED. Every local demo criterion passed in R4 (DEMO-AC-003 with W5). No milestone evidence record exists (G5). CF: Cloud part of the milestone: F-03 not run. |
| E2E-016 | Local; review: milestone | passed (R4; review) | n/a | n/a | L: Scan part: R4. Review part (milestone): `validation/reviews/E2E-016.md` re-review at `b3e3775`. Checks 1 to 3 pass, R-01 and R-06 are resolved, and R-10 was closed by DEC-0413/0414 (`2d99be2`). No milestone evidence record exists (§6 G5). |
| FILES-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: R4 is after fix-f04b. |
| FILES-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-006 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-001 | Local, cloud | passed (R4) | not-run (§8.1) | not-run (§8.2) | L: Local part (stubbed `fetch`); cloud step-1 part not-run (§8.1). |
| GOOGLE-AC-002 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-003 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-005 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| HTTP-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-006 | Local | passed (R4) | n/a | n/a |  |
| HTTP-AC-007 | Local | passed (R4) | n/a | n/a |  |
| KV-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOCAL-AC-001 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-003 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-004 | Local | passed (R4) | n/a | n/a | L: R4 is after DEC-0417 (`dev` binds port 0 for Vite, the Worker and the inspector); the loopback-only test passed. |
| LOG-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | CF: On Cloudflare only the local case applies (criterion text); the run is still held. |
| LOG-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-003 | Local | passed (R4) | n/a | n/a |  |
| LOG-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-001 | Local | passed (R4) | n/a | n/a |  |
| MIG-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Failed 1 of 3 tests in R3b (`r5nndia2aediccu`, `760e7b7`): the no-change deploy's `dev` start died (workerd fatal at startup; first line cut off). Cause unproven (U1, §5); the port race was fixed as a confirmed defect (DEC-0417); all 3 tests passed in R4. |
| MIG-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-006 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-001 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-002 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: The restricted-credential clause also stays `blocked` in this sandbox (DEC-0335, DEC-0363). |
| PROV-AC-003 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| PROV-AC-004 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. Its `setup-account` clause needs no D1, but it runs in that pass. |
| PROV-AC-005 | Local | passed (R4) | n/a | n/a |  |
| PROV-AC-006 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone (CF part); D-RUN-M not run. |
| PROV-AC-007 | Local | passed (R4) | n/a | n/a |  |
| SEC-AC-001 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-002 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-004 | Local | passed (R4) | n/a | n/a |  |
| SEC-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| SKILL-AC-001 | Local | passed (R4) | n/a | n/a | L: R4 is after the fix-f04b edit of `skill/reference/files.md`. |
| SKILL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-003 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-004 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-005 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-006 | Cloud (milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| SQL-AC-001 | Local | passed (R4) | n/a | n/a |  |
| SQL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| SQL-AC-003 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-004 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-005 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-006 | Local, cloud | passed (R4) | blocked (DEC-0317) | not-run (§8.2) | L: Data API retry-loop clause `not-run` (§8.2), recorded as its own entry in R4. |
