# F-EV: Final evaluation (local and Cloudflare phase)

**Update 2 (F-EV2), 2026-10-20.** This file replaces the first F-EV (`b53f841`, base `3caff76`), which is in git history. That F-EV left gaps G1–G5. Since then G3 (the review of the DEMO-AC-009 record), G2 (the tests for CHECK-AC-005's demo part and DEMO-AC-003's warn clause) and G1 (a full local run at one commit) have landed. This update re-judges the local column. The Cloudflare and AWS columns are unchanged.

Evaluator: an independent F-EV subagent. I wrote none of the code, tests, evidence or reviews judged here. I worked from committed evidence only:
- I ran no test suite and made no Cloudflare call.
- I changed no code, test or evidence.
- `npm ci` was run only so that the read-only release-report generator could run (`node tests/compliance/tools/report.mjs release`, which reads records and `git log`).

Base: `origin/claude/implement-local-cloudflare` at `903d0f9` ("Merge final-local-2 full local compliance evidence"). Branch: `claude/implement-local-cloudflare-f-ev2`.

Inputs:
- plan §1, §7 (F-EV) and §8;
- the first F-EV (gaps G1–G5);
- `docs/demo/demo-spec.md` §2 and `docs/acceptance/e2e-scenarios.md`;
- `docs/contracts/ts/testing.d.ts`, `skill/reference/testing.md` and `packages/framework/src/files/service.ts`, for the testing-contract limit behind W5;
- `apps/demo/src/server/posts.ts` (`deletePost`);
- the evidence and reviews listed below;
- the test sources behind the judged IDs (`git show 6f92711`).

Context taken as given: Cloudflare testing is stopped (DEC-0317). D1 has been off since the phase A spikes used up the daily row limit on 2026-10-19, and the owner has not yet allowed testing to resume. D-RUN, D-RUN-M and F-03 have not run, so D-EV is not done. Google login is mocked (§8.1). AWS is out of scope (§8.2).

## Evidence references

| Ref | What | Commit | Notes |
| --- | --- | --- | --- |
| **R3** | `validation/local/q3qgbyunuxaz1fw.json` (+ `raw/`), logs in `validation/local/final-local-2/` | `26128b1` | **Full, unfiltered** `npm run compliance -- --target local`. 111 results for 109 distinct IDs: 109 passed and 2 not-run, the §8.2 clause entries of CORE-AC-006 and SQL-AC-006. 0 failed, 0 blocked, exit 0. Playwright: 42/42 passed, 0 skipped, 0 flaky. Integration layer: 564 passed and 18 skipped (the same 18 as R1). Unit layer: 53 passed (DEC-0319). HEAD did not move during the run. |
| R1 | `validation/local/emckebxm5x3kxd1.json`, `validation/local/final-local/` | `8d65a70` | Earlier full run: 98 passed, 12 not-run and 2 failed. Superseded by R3. |
| R2 | `validation/local/cmzgvk4zb2o6ako.json`, `validation/local/demo-rerun/` | `ed1f51b` | Earlier `--only` demo run: 13/13 passed. Superseded by R3. |
| **S1** | `validation/local/g7586p3q4x45qyc.json` | `97dd0d7` | F-01 round 4's own `smoke --target local`: 7/7 passed. Since `97dd0d7`, the only change under `apps/demo` is `b098f89`, which edits `BUILD-RECORD.md` alone (`git log 97dd0d7..903d0f9 -- apps/demo`). |
| **BV2** | `validation/local/batch-verify-2/` | `1487c7d` | `verify` online and offline, exit 0. Unit 1687/1687, template 18/18, reference 52/52 per dialect. |
| review | `validation/reviews/E2E-016.md` (review at `e8c3289`, re-review at `b3e3775`) | | The E2E-016 review part. |
| RC-009 | `ai/implementation/root-causes/2026-10-20-demo-ac-009.md`, section "Review" | `19a6b09` | Independent review: **accepted**, no required changes. |
| BUILD-RECORD | `apps/demo/BUILD-RECORD.md` (round 4) | `97dd0d7` | Model and inputs of the E2E-015 build. |

What changed between the evidence and the base:
- **R3 (`26128b1`) to the base (`903d0f9`):** only `validation/` changed. So R3's results hold for the base tree. The release report still reads "no record for commit", because COMPL-REQ-006 counts only records of the exact commit (§8).
- **BV2 (`1487c7d`) to R3 (`26128b1`), outside `validation/`:**
  - `tests/compliance/e2e/demo-criteria.spec.ts` and `demo-local.spec.ts`: the two G2 tests;
  - `tests/compliance/harness/expected.ts`: the stale CHECK-AC-005 rule removed;
  - `tests/compliance/harness/expected.unit.test.ts`: the matching unit test changed;
  - the first F-EV and the RC-009 Review (documents only).
  - No code under `packages/`, `apps/` or `docs/` changed. R3 covers everything that changed except `expected.unit.test.ts` (O1, §4.3).

## 1. Verdict

**The framework is "not working"** (COMPL-REQ-006, prompt §11):
- **AWS:** nothing has run (AWS phase not started).
- **Google:** the real Google login certification (GOOGLE-AC-005, E2E-008) and the other Google-dependent items are outstanding.
- **Cloudflare:** every Cloudflare criterion is `blocked`. The phase-D and F-03 cloud runs have not started.

**Local:**
- All 110 Local IDs are `passed`, and none is `failed`.
- 109 of them passed in one full, unfiltered run at one commit (R3). The 110th is E2E-015, a milestone with no runner record of its own (BUILD-RECORD plus R3).
- Two clause entries inside passed IDs are `not-run` under §8.2: CORE-AC-006's AWS bundle and SQL-AC-006's Data API retry loop.
- Phase F's local exit is **met**, with these open items, none of which blocks it:
  - **W5:** DEMO-AC-003's warn-clause test is weak, and fixing it needs an owner decision (Q10);
  - **G5:** there is no milestone evidence record for E2E-015 and E2E-016;
  - **G4:** the untagged controls (optional);
  - **O1:** the edited unit test has no runner output.

Counts by status (every `*-AC-*` and `E2E-*` ID, per target where its Where applies; a milestone-only item counts once):

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 110 | 0 | 0 | 0 (plus 2 §8.2 clause entries inside passed IDs: CORE-AC-006, SQL-AC-006) |
| cloudflare | 81 | 0 | 0 | 73 | 8 (Google login mocked) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

Change from the first F-EV: on local, 4 not-run became passed (DEMO-AC-003, CHECK-AC-005, E2E-004, E2E-015). The Cloudflare and AWS columns are unchanged.

### DEMO-AC-003: status decided under plan §8

I record DEMO-AC-003 on local as **`passed`, with the open weak assertion W5**. I do not record it as `not-run`. My reasons:
- **No §8 rule applies.** §8 allows `not-run` only for Google login mocked (§8.1), the AWS phase (§8.2) and milestone items (§8.3). The warn clause is a Local, automated clause, so none of these covers it. A `not-run` here would be an evidence gap, and the gap that the first F-EV recorded (no runner evidence) is now closed: R3 ran the tagged test and it passed.
- **The clause, as written, is exercised.** It reads: "In a local test, a simulated file-deletion failure produces a `warn` log entry." The test simulates the failure the only way the testing contract allows (`unavailable: ["files"]`; `skill/reference/testing.md:16`). The delete request then still succeeds, the post is gone, and the demo writes a `warn` entry during that request (`demo-criteria.spec.ts:656-708`; R3 `raw/playwright.log:36`, which shows the `FILES.UNAVAILABLE` (list) error entry of LOG-REQ-005 written alongside).
- **The weakness is real, and it is recorded, not hidden.** The deleted post can never hold a stored photo in this test:
  - `unavailable` holds for the whole test app from creation (`testing.d.ts:40-41`; `skill/reference/testing.md:16`);
  - each `createTestApp` call gets fresh, empty storage (`testing.d.ts:93`);
  - there is no seed API;
  - `createUploadTicket` calls `store.head` first, so no upload can succeed (`service.ts:140-144`).
  
  So the failing operation is the `files.list` of an empty prefix, never the `files.delete` of a stored file. The test passes only because this demo attempts cleanup even for a post with no photos (`posts.ts:109-116`).
- **My source reading closes the gap for this demo, but the test does not.** In `deletePost`, the `list` and every `delete` sit in one `try`/`catch` that writes the `warn` entry (`posts.ts:109-120`). A failed deletion of a stored photo therefore takes the same path that the test observed.
- **The test can misjudge another demo in both directions:**
  - a demo that cleans up only posts with photo rows would fail the test, even if it logs correctly;
  - a demo with a separate, unlogged path for a failed `delete` would pass it.
  
  A stronger test needs a contract change (a per-request failure switch, or a seed API). Contract changes belong to the owner: plan §11 Q10.

## 2. Judgements: demo criteria and the F-EV scenarios

In this table, CF means Cloudflare. Local evidence is R3 unless the row says otherwise.

| ID | local | cloudflare | aws | Judgement |
| --- | --- | --- | --- | --- |
| DEMO-AC-001 | passed (R3, S1) | blocked (F-03 not run; D1) | not-run (§8.2) | As in the first F-EV, now from R3. The "renders as text" clause comes from `demo-pages.spec.ts`. The "only published, newest first, paginated" clause comes from the smoke test run inside E2E-002. W1 still applies. |
| DEMO-AC-002 | passed (R3) | blocked | not-run | Page requests replayed as four identities. |
| DEMO-AC-003 | **passed (R3, S1); W5 open** | blocked | not-run | Display: `demo-pages.spec.ts:230`, after fix-f04b (the `attachment` header does not affect `<img src>`). Round trip, maximum and delete: the smoke test inside E2E-002, after fix-f04b. Warn clause: `demo-criteria.spec.ts:656`, passed in 4.9 s. Its weak assertion W5 is explained in §1 above. The re-run asked for in §4.1 is done. |
| DEMO-AC-004 | passed (R3) | blocked | not-run | Unchanged. |
| DEMO-AC-005 | passed (R3) | blocked | not-run | Unchanged. |
| DEMO-AC-006 | passed (R3) | n/a | n/a | Unchanged. |
| DEMO-AC-007 | passed (R3) | blocked | not-run | Unchanged (W4). |
| DEMO-AC-008 | passed (R3) | blocked (driver's cloud check at F-03) | not-run | Unchanged (W3). |
| DEMO-AC-009 | passed (R3) | blocked | not-run | The root-cause record now has an independent Review: accepted, no required changes (RC-009). F3 is closed. |
| DEMO-AC-010 | passed (R3, local part) | blocked (F-03) | not-run | Local part only. The criterion needs Cloudflare and AWS from the same commit. |
| DEMO-AC-011 | passed (R3) | n/a | n/a | Unchanged. |
| CHECK-AC-005 | **passed (R3)** | n/a | n/a | Template part: `verify passes on the template`. Demo part: the new `[CHECK-AC-005] demo part` test (`demo-local.spec.ts:26`). It copies `apps/demo` to a fresh `.framework/e2e/` directory, without local state, build output or secrets, runs the app's own `verify`, and asserts exit 0. It passed in 89.8 s, which fits a real `verify` with the app's tests. The stale `PHASE_RULES` entry was removed (`expected.ts`), and R3's `raw/expected.json` lists CHECK-AC-005 with no not-run part. G2 is closed for this ID. |
| E2E-002 | passed (local part, R3) | blocked (F-03) | not-run | **Scenario not met:** it needs all three smoke runs from one commit. The local part is sound. |
| E2E-004 | **passed (R3)** | blocked | not-run | All three parts are now read from one full, unfiltered record: the coverage part (every expected local ID has a tagged test), the record part, and the pass part. For the pass part, every other applicable result in R3 is `passed`, apart from the two §8.2 clause entries; the driver's own E2E-004 result is `passed` and its exit status is 0. G1 is closed. **Scenario not met** until Cloudflare and AWS pass. |
| E2E-015 | **passed (milestone; BUILD-RECORD, R3)** | blocked (F-03) | not-run | Round 4 was built by a fresh agent from only `skill/`, `apps/template` and `demo-spec.md`, and BUILD-RECORD records the model and inputs. No `FRAMEWORK-ISSUE.md` entry was raised; the only such file is the template `skill/templates/FRAMEWORK-ISSUE.md`. The F-02 records for rounds 1 to 3 are ACCEPTED, and their fixes have landed. Every local demo criterion now passes in R3, at a commit whose `apps/demo` equals round 4. DEMO-AC-003 carries W5, which concerns the test, not the demo. The first F-EV's reasoning on `skill/reference/files.md` line 39 (fix-f04b; no rebuild needed) still holds. **There is no milestone evidence record (G5)**, so the release report cannot see this pass. This is the same footing on which E2E-016's review was counted. Cloud parts are blocked. |
| E2E-016 | passed (scan R3; review) | n/a | n/a | Scan part: 3 tagged tests passed in R3. Review part: unchanged. G5: no milestone evidence record. |
| FILES-AC-003 | **passed (R3)** | blocked | not-run | R3 is after fix-f04b, so the provisional note in §4.1 is lifted. |
| E2E-009 | **passed (R3)** | blocked | not-run | R3 is after fix-f04b, so the BMP `attachment` path now has a committed run. Its test passed in 9.6 s. The provisional note in §4.1 is lifted. |

## 3. Phase-F notes on the non-demo IDs

- CLI-AC-003: C-EV Flag 1 is closed. The tagged driver tests that inject runner and cleanup failures are in `tests/compliance/harness/driver.unit.test.ts`.
- SEC-AC-001…004: C-EV Flag 4 is closed.
- E2E-011 (local): passed in R3. Its Cloudflare run, which must use only the commands in `skill/reference/troubleshooting.md`, stays blocked (E-EV).

## 4. Specific checks

### 4.1 fix-f04b and the re-run of FILES-AC-003, E2E-009 and DEMO-AC-003

**Resolved.** R3 (`26128b1`) contains fix-f04b (`cfbd946`, merged `b3e3775`), and all three IDs passed in it:
- FILES-AC-003: 20 MB and expired-ticket tests in the integration layer;
- E2E-009: 20 MB and 100 MB BMPs through a real browser, viewed and downloaded byte-identical;
- DEMO-AC-003: display, round trip, maximum, delete and the warn clause.

The first F-EV's provisional status is lifted. SKILL-AC-001 and SKILL-AC-004 also passed in R3, after the `skill/reference/files.md` edit.

### 4.2 Unit tests 1689 → 1687

Unchanged from the first F-EV: `cfbd946` accounts for exactly −2, and nothing is weakened.

### 4.3 Skipped tests, weak assertions, mis-tagged tests

- **Skipped:**
  - R3 Playwright: none (42/42 ran, 0 flaky).
  - R3 integration layer: 18 skipped, the same set as R1. There are 16 Cloud-only tests, plus the 2 untagged positive controls of C-EV Flag 6 (G4, **still open**, optional).
  - R3 unit layer: 1634 skipped by design (DEC-0319).
- **Weak assertions:**
  - W1. DEMO-AC-001 "paginated": only the page size is shown. Open, and no verdict depends on it.
  - W2. The smoke-test clauses of DEMO-AC-001 and DEMO-AC-003 are carried by the E2E-002 test's tag. Open, and acceptable.
  - W3. DEMO-AC-008 matches the `info` entry by time window and requestId, not by its message. Open.
  - W4. DEMO-AC-007's expiry clause uses a shifted clock. Open.
  - **W5 (new, open). DEMO-AC-003's warn clause** (`demo-criteria.spec.ts:656`). Under the testing contract, the deleted post can never hold a stored photo (§1). The simulated failure is therefore the `list` of an empty prefix, and the test passes only because the demo attempts cleanup for posts with no photos. For this demo, the source reading closes the gap: one `try`/`catch` covers the `list` and every `delete` (`posts.ts:109-120`). The test alone, though, does not show that a failed deletion of a stored photo logs `warn`. **Status: open, owner decision needed (plan §11 Q10).** It does not change DEMO-AC-003's `passed` status (§1).
  - Also checked in the warn test: the `warn` filter excludes the framework's own components (`FRAMEWORK_COMPONENTS`) and requires the demo's app name and a requestId. So the framework's `error` entry for `FILES.UNAVAILABLE` (LOG-REQ-005) cannot satisfy it, and the match is not vacuous.
- **O1 (new, open, minor).** `tests/compliance/harness/expected.unit.test.ts` was edited in `6f92711`, after BV2. In R3's unit layer it is skipped, because it is not tagged with a unit-level ID (DEC-0319). So no runner output covers the edited test. The behaviour it checks is shown directly by R3's `raw/expected.json`: CHECK-AC-005 has `notRunParts: []`, and CORE-AC-006 and SQL-AC-006 keep theirs. The next batch `verify` covers it. No verdict depends on it.
- **Mis-tagged:** none found. The two new tests carry exactly `[CHECK-AC-005]` (demo part, stated in its title) and `[DEMO-AC-003]` (the failure clause, stated in its title).

## 5. Root-cause records (prompt §8)

| Record | Diagnosed | Review | Fix and re-check |
| --- | --- | --- | --- |
| e2e-016-r01-portability-notes | yes | agree-with-changes | fix-f04a, re-review PASS |
| e2e-016-r06-raster-inline-disposition | yes | agree-with-changes | fix-f04b, re-review PASS. The compliance re-run is now committed (R3). |
| demo-ac-009 | yes | **accepted** (Review appended in `19a6b09`, independent reviewer, no required changes) | Test fix `c3b407c`. Passed in R2 and in R3. **F3/G3 closed.** |
| F-02 rounds 1, 2, 3 | yes | ACCEPTED | Landed. |
| CLI-AC-003-driver-cleanup-failures, compliance-cli-exit-and-pending-stages, COMPL-AC-001-where-parser, SKILL-AC-001/-004 records, E2E-004 (A, B, C revised) | yes | ACCEPTED | Landed. E2E-004 Cause C (revised) is now fully acted on: the CHECK-AC-005 rule was removed when its test landed. |
| D-01, D-03 | yes | pending, with an integrator note pointing to the ACCEPTED D-04 review and fix | Covered. |
| Earlier phase B/C records | yes | ACCEPTED | As judged at B-EV and C-EV. |

No new local failure occurred in R3, so no new root-cause record is needed.

## 6. Gaps from the first F-EV, and open items

| # | Gap | Status | Evidence / remaining action |
| --- | --- | --- | --- |
| G1 | No full local run at one commit | **Closed** | R3: full, unfiltered, at `26128b1`, exit 0. `verify` was not part of that run. BV2 (`1487c7d`) covers it, and between the two only test files and documents changed (see O1). |
| G2 | No runner evidence for the demo's `verify` and DEMO-AC-003's warn clause; stale `PHASE_RULES` rule | **Closed, with W5 open** | `6f92711`: the CHECK-AC-005 demo-part test and the DEMO-AC-003 warn-clause test; the rule was removed. Both tests passed in R3. W5 records the weak warn assertion (§4.3, Q10). |
| G3 | No Review on the DEMO-AC-009 record | **Closed** | Review appended in `19a6b09`: accepted. |
| G4 | Untagged controls for CFG-AC-002 and CORE-AC-007 are filtered out of driver runs (C-EV Flag 6) | Open (optional) | Tag them. No verdict depends on it. |
| G5 | No milestone evidence records (E2E-016 review, E2E-015); no record of the Cloudflare `blocked` set | **Open** | As before. Both milestone passes are judged here but invisible to the release report: it lists "E2E-015 on local (milestone): no record" and "E2E-016 on local (milestone): no record". Record them with `--milestone`, or with a record written for the review. Record the Cloudflare `blocked` set once a `--blocked` driver run is confirmed to make no Cloudflare request (DEC-0261). |
| W5 | DEMO-AC-003 warn clause: weak assertion forced by the testing contract | **Open, owner** | Plan §11 Q10: a per-request failure switch, or a seed API. When the owner chooses, a test author strengthens the test so that it deletes a post holding a stored photo, then a runner re-runs it. |
| O1 | Edited `expected.unit.test.ts` has no runner output | Open (minor) | Covered by the next batch `verify`. |

**Remaining open local items:** W5 (owner), G5 (milestone records), G4 (optional), O1 (minor), and W1–W4 (accepted weak points, unchanged). None is a `failed` or `not-run` local entry.

Cloudflare (not local): every entry is `blocked`. When the owner allows it after the D1 reset, the order is D-RUN, D-RUN-M, F-03 and then D-EV, each under the plan §1 caps, with before and after D1 readings. E2E-011 (cloud, troubleshooting commands only) and the DEMO cloud parts (including DEMO-AC-008's driver check) go with F-03.

## 7. Confirmed §8 not-run lists

Unchanged from the first F-EV. In brief:
- **§8.1 (Google login mocked):** GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-005 (admin-list), AUTH-AC-009 (production), AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud), E2E-008, and CLI-AC-001 for its `certify-auth` part only (note N1: its other cloud commands are `blocked`).
- **§8.2 (AWS phase not started):** every AWS entry, plus the AWS parts inside the criteria run here. On local, the AWS parts appear as R3's two clause entries for CORE-AC-006 and SQL-AC-006. No AWS code exists, so no clause was wrongly passed.
- **§8.3 (milestones):**
  - E2E-016 review and E2E-015 (local) are judged `passed`, with no evidence record (G5).
  - E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006 (CF part) and COMPL-AC-008 are `blocked` (D-RUN-M not run).
  - GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006 and AUTH-AC-005 admin-list are `not-run` (Google).
  - All AWS runs are `not-run`.
- **No §8 rule is used for DEMO-AC-003** (§1).

## 8. Release report

The report is generated with `node tests/compliance/tools/report.mjs release --commit 903d0f9026c47b11fde339b2f14bfb9cf6b5b82f --out validation/release/2026-10-20-903d0f9.md`, in the same way as `2026-10-20-3caff76.md`.

- **Result:** **"not working"**.
- **Why:** COMPL-REQ-006 counts automated records only for the exact commit. The latest local record (R3) is for `26128b1`, and the base `903d0f9` adds only `validation/` files, so every automated entry again reads "no record for commit". The generated text is identical to the `3caff76` report apart from the SHA.
- **Context:** for information, the same generator run for `26128b1` (not committed) lists only four local lines:
  - CORE-AC-006 and SQL-AC-006: the §8.2 clause entries;
  - E2E-015 and E2E-016: milestone, no record (G5).
- **Milestones:** no milestone record exists, including the Google certification GOOGLE-AC-005. Every commit since the start of history that touched GOOGLE or login-provider interface files is therefore listed.
- **Evaluator's note:** appended below the generated text and marked as not generated.

## 9. Full per-target status table

Status cells give the status and its evidence ref. Evidence refs:
- R3, S1, BUILD-RECORD and review are defined at the top.
- DEC-0317 means no Cloudflare record exists because Cloudflare testing is stopped. Every Cloudflare `blocked` has the detail "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset".
- §8.1 means "Google login mocked for this phase".
- §8.2 means "AWS phase not started".
- n/a means the Where column does not name that target.

Notes that hold for most rows are given here and not repeated in each row:
- **Local `passed` with R3 and no note:** every tagged test passed in R3, at `26128b1`. The base `903d0f9` differs from it only in `validation/`.
- **Cloudflare:** "D-RUN not run", unless the row says otherwise.

| ID | Where | local | cloudflare | aws | Notes |
| --- | --- | --- | --- | --- | --- |
| AUTH-AC-001 | Local | passed (R3) | n/a | n/a |  |
| AUTH-AC-002 | Local | passed (R3) | n/a | n/a |  |
| AUTH-AC-003 | Local | passed (R3) | n/a | n/a |  |
| AUTH-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-005 | Local, cloud; admin-list part: cloud (milestone) | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Contract part. Admin-list part is cloud milestone (Google, §8.1). CF: Contract part `blocked` (D1). Admin-list part (milestone) `not-run`: Google login mocked. |
| AUTH-AC-006 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-007 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-008 | Local | passed (R3) | n/a | n/a |  |
| AUTH-AC-009 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Local and test-stage parts; production 404 part is cloud (Google, §8.1). CF: Test-stage part `blocked` (D1). Production part `not-run`: Google login mocked. |
| AUTH-AC-010 | Local | passed (R3) | n/a | n/a |  |
| AUTH-AC-011 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| AUTH-AC-012 | Local | passed (R3) | n/a | n/a |  |
| AWS-AC-001 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-002 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-003 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-004 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-005 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-006 | Cloud | n/a | n/a | not-run (§8.2) |  |
| CF-AC-001 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-002 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-003 | Local | passed (R3) | n/a | n/a |  |
| CFG-AC-001 | Local | passed (R3) | n/a | n/a |  |
| CFG-AC-002 | Local | passed (R3) | n/a | n/a |  |
| CFG-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-006 | Local | passed (R3) | n/a | n/a |  |
| CHECK-AC-001 | Local | passed (R3) | n/a | n/a |  |
| CHECK-AC-002 | Local | passed (R3) | n/a | n/a |  |
| CHECK-AC-003 | Local | passed (R3) | n/a | n/a |  |
| CHECK-AC-004 | Local | passed (R3) | n/a | n/a |  |
| CHECK-AC-005 | Local | passed (R3) | n/a | n/a | L: Template part: `verify passes on the template`. Demo part: `demo-local.spec.ts` `[CHECK-AC-005] demo part`, `verify` on a fresh copy of `apps/demo` (exit 0, 90 s). The stale `PHASE_RULES` entry is gone (R3 `raw/expected.json`: no not-run part). G2 closed. |
| CHECK-AC-006 | Local | passed (R3) | n/a | n/a |  |
| CLI-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | CF: Only the `certify-auth` part needs a production stage (Google, §8.1). The other commands are `blocked` (§8 note N1). |
| CLI-AC-002 | Local | passed (R3) | n/a | n/a |  |
| CLI-AC-003 | Local | passed (R3) | n/a | n/a | L: C-EV Flag 1 closed: the tagged driver tests that inject runner and cleanup failures. |
| CLI-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CLI-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-002 | Local | passed (R3) | n/a | n/a |  |
| COMPL-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-005 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| COMPL-AC-006 | Local | passed (R3) | n/a | n/a |  |
| COMPL-AC-007 | Local | passed (R3) | n/a | n/a |  |
| COMPL-AC-008 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| CORE-AC-001 | Local | passed (R3) | n/a | n/a |  |
| CORE-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-004 | Local | passed (R3) | n/a | n/a |  |
| CORE-AC-005 | Local | passed (R3) | n/a | n/a |  |
| CORE-AC-006 | Local | passed (R3) | n/a | n/a | L: AWS-bundle clause `not-run` (§8.2), recorded as its own entry in R3. |
| CORE-AC-007 | Local | passed (R3) | n/a | n/a |  |
| CORE-AC-008 | Local | passed (R3) | n/a | n/a |  |
| DEMO-AC-001 | Local, cloud | passed (R3; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Script clause: `demo-pages.spec.ts`. Newest first, drafts hidden and page size: the demo's smoke test, run inside E2E-002 in R3. Weak point W1. |
| DEMO-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: `demo-criteria.spec.ts`. Four identities replay the page's own requests. |
| DEMO-AC-003 | Local, cloud | passed (R3; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Display (`demo-pages.spec.ts`), round trip, maximum and delete (smoke inside E2E-002), and the warn clause (`demo-criteria.spec.ts:656`, in-process with `unavailable: ["files"]`), all after fix-f04b. **Open weak assertion W5:** the warn test can only fail the `list` of an empty prefix, never the deletion of a stored photo, because of the testing contract (§4.3, Q10). |
| DEMO-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: R3. |
| DEMO-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: logout through the page and login again in the same and a new browser. |
| DEMO-AC-006 | Local | passed (R3) | n/a | n/a | L: `demo-local.spec.ts`: values file changed, then `dev` restarted. |
| DEMO-AC-007 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: altered link through the page; expiry in-process with a shifted clock. |
| DEMO-AC-008 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: info entries matched by app, severity, requestId and time window (W3). CF: Cloud check by the driver at F-03. |
| DEMO-AC-009 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: R3, after the test fix `c3b407c`. The root-cause record now has its Review (accepted; G3 closed). |
| DEMO-AC-010 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Local part: `E2E-002.spec.ts` (shared tag). |
| DEMO-AC-011 | Local | passed (R3) | n/a | n/a | L: production values files, then the stub provider in-process. |
| E2E-001 | Local | passed (R3) | n/a | n/a |  |
| E2E-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Local part only: the smoke test passed from a copy identical to `apps/demo` at `26128b1`. CF: F-03 not run. |
| E2E-003 | Local | passed (R3) | n/a | n/a |  |
| E2E-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Coverage, record and pass parts, all in R3, one full unfiltered run at one commit: every other result is `passed` or a §8.2 clause entry, exit 0. G1 closed. **Scenario not met** until Cloudflare and AWS also pass. |
| E2E-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-006 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-007 | Local; cloud (milestone) | passed (R3) | not-run (§8.1) | not-run (§8.2) | L: Local part (in-process, stub provider); cloud part milestone, not-run (§8.1). |
| E2E-008 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-009 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: R3 is after fix-f04b, so the BMP `attachment` path is now covered. The provisional status of the previous F-EV is lifted. |
| E2E-010 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-011 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | CF: Must use only the commands in `skill/reference/troubleshooting.md` §1 (E-EV). |
| E2E-012 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-013 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-014 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-015 | Local, cloud (milestone) | passed (BUILD-RECORD; R3) | blocked (DEC-0317) | not-run (§8.2) | L: Round-4 demo (`97dd0d7`, BUILD-RECORD) built from the three inputs. No `FRAMEWORK-ISSUE.md` entry is open, and every F-02 record is ACCEPTED. Every local demo criterion passed in R3 (DEMO-AC-003 with W5). No milestone evidence record exists (G5). CF: Cloud part of the milestone: F-03 not run. |
| E2E-016 | Local; review: milestone | passed (R3; review) | n/a | n/a | L: Scan part: R3. Review part (milestone): `validation/reviews/E2E-016.md` re-review at `b3e3775`. Checks 1 to 3 pass, R-01 and R-06 are resolved, and R-10 was closed by DEC-0413/0414 (`2d99be2`). No milestone evidence record exists (§6 G5). |
| FILES-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: R3 is after fix-f04b. |
| FILES-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-006 | Local | passed (R3) | n/a | n/a |  |
| GOOGLE-AC-001 | Local, cloud | passed (R3) | not-run (§8.1) | not-run (§8.2) | L: Local part (stubbed `fetch`); cloud step-1 part not-run (§8.1). |
| GOOGLE-AC-002 | Local | passed (R3) | n/a | n/a |  |
| GOOGLE-AC-003 | Local | passed (R3) | n/a | n/a |  |
| GOOGLE-AC-005 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| HTTP-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-006 | Local | passed (R3) | n/a | n/a |  |
| HTTP-AC-007 | Local | passed (R3) | n/a | n/a |  |
| KV-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOCAL-AC-001 | Local | passed (R3) | n/a | n/a |  |
| LOCAL-AC-002 | Local | passed (R3) | n/a | n/a |  |
| LOCAL-AC-003 | Local | passed (R3) | n/a | n/a |  |
| LOCAL-AC-004 | Local | passed (R3) | n/a | n/a |  |
| LOG-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | CF: On Cloudflare only the local case applies (criterion text); the run is still held. |
| LOG-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-003 | Local | passed (R3) | n/a | n/a |  |
| LOG-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-001 | Local | passed (R3) | n/a | n/a |  |
| MIG-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-006 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-001 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-002 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: The restricted-credential clause also stays `blocked` in this sandbox (DEC-0335, DEC-0363). |
| PROV-AC-003 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| PROV-AC-004 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. Its `setup-account` clause needs no D1, but it runs in that pass. |
| PROV-AC-005 | Local | passed (R3) | n/a | n/a |  |
| PROV-AC-006 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone (CF part); D-RUN-M not run. |
| PROV-AC-007 | Local | passed (R3) | n/a | n/a |  |
| SEC-AC-001 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-002 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-004 | Local | passed (R3) | n/a | n/a |  |
| SEC-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| SKILL-AC-001 | Local | passed (R3) | n/a | n/a | L: R3 is after the fix-f04b edit of `skill/reference/files.md`. |
| SKILL-AC-002 | Local | passed (R3) | n/a | n/a |  |
| SKILL-AC-003 | Local | passed (R3) | n/a | n/a |  |
| SKILL-AC-004 | Local | passed (R3) | n/a | n/a |  |
| SKILL-AC-005 | Local | passed (R3) | n/a | n/a |  |
| SKILL-AC-006 | Cloud (milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| SQL-AC-001 | Local | passed (R3) | n/a | n/a |  |
| SQL-AC-002 | Local | passed (R3) | n/a | n/a |  |
| SQL-AC-003 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-004 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-005 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-006 | Local, cloud | passed (R3) | blocked (DEC-0317) | not-run (§8.2) | L: Data API retry-loop clause `not-run` (§8.2), recorded as its own entry in R3. |
