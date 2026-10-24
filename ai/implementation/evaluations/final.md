# F-EV: Final evaluation (local and Cloudflare phase)

**Update 4 (D-EV), 2026-10-24.** This update makes the Cloudflare column real. Cloudflare testing resumed on 2026-10-23 (DEC-0419), and D-RUN, D-RUN-M and F-03 ran in passes 0 to C. The Cloudflare statuses and their evidence are judged in `ai/implementation/evaluations/D-cloudflare.md` (the D-EV verdict); this file carries them into the per-target table (§9), the counts (§1) and the demo judgements (§2). The local and AWS columns are unchanged from Update 3 (F-EV3, `c016e7e`, in git history), apart from the staleness note L1 (§1). F-EV3 replaced F-EV2 (`27b4366`), which replaced the first F-EV (`b53f841`).

Evaluator: an independent D-EV subagent. I wrote none of the code, tests, evidence or reviews judged here. I worked from committed evidence only:
- I ran no test suite and made no Cloudflare call.
- I changed no code, test or evidence.
- `npm ci` was run only so that the read-only release-report generator could run (`node tests/compliance/tools/report.mjs release`, which reads records and `git log`).

Base: `origin/claude/implement-local-cloudflare` at `1b474c1` ("Merge integration of Cloudflare-phase decisions (DEC-0421–0431)"). Branch: `claude/implement-local-cloudflare-d-ev`.

Inputs for this update: plan §5 (D-EV), §8 and §11; F-EV3 (this file at `c016e7e`); the Cloudflare pass summaries and the 19 records under `validation/cloudflare/`; the local smoke record `kbe5rzjb8ls9p8z`; the root-cause records of 2026-10-23/24 and their Reviews; DEC-0418…DEC-0431. F-EV3's inputs are listed in git history.

Context: Google login is mocked (§8.1). AWS is out of scope (§8.2). The D1 stop of DEC-0317 was lifted by the owner on 2026-10-23 (DEC-0419), within the plan §1 caps.

## Evidence references

| Ref | What | Commit | Notes |
| --- | --- | --- | --- |
| **R4** | `validation/local/pzeugkxrk1xcu2w.json` (+ `raw/`), logs in `validation/local/final-local-4/` | `a5b2164` | **Full, unfiltered** `npm run compliance -- --target local`, run once. 111 results for 109 distinct IDs: 109 passed and 2 not-run, the §8.2 clause entries of CORE-AC-006 and SQL-AC-006. 0 failed, 0 blocked, exit 0. Playwright: 42/42 passed, 0 skipped, 0 flaky. Integration layer: 586 tests, 564 passed and 22 skipped (§4.3). Unit layer: 1706 tests, 53 passed, 1653 skipped by design (DEC-0319). HEAD did not move during the run. Dev registry empty after every step. Not run under the `MINIFLARE_WORKERD_PATH` wrapper (the summary does not mention it). |
| **BV4** | `validation/local/batch-verify-4/` | `a5b2164` | `verify` online and offline, exit 0, each run once. Unit 179 files, 1706/1706; template 18/18 and reference 52/52 per dialect; skill example pages 2/2. |
| **CF** | `validation/cloudflare/*.json` (18 driver records, 1 smoke record) and `validation/cloudflare/<pass>/` | `93e6d7d`, `71ac98d`, `24327c7`, `6417611`, `321e41c` | Passes 1c, 2–5, B, M (milestone), C and F-03. The record per ID and its pass are in `D-cloudflare.md` §7; §9 below names the run ID. Every record has `leftovers: []`. |
| **F3S / F3L** | `validation/cloudflare/vn8cm0ie7v2rhul.json` (demo `smoke --target cloudflare`) and `validation/local/kbe5rzjb8ls9p8z.json` (demo `smoke --target local`) | `321e41c` | Both 7/7 passed, same commit and same `apps/demo` tree; `f-03/logs/8-source-diff.log`: `git diff --quiet HEAD -- apps/demo` exit 0, nothing untracked. |
| **F3D** | `validation/cloudflare/nu3lt4mhjsn4ihq.json` (DEMO-AC-001…-005, -007, -009) and `pqc4u7j4o1g4rpb.json` (DEMO-AC-008 alone) | `321e41c` | Demo criteria on Cloudflare against the F-03 stage `test-s6jca41ew34ahz3`, all passed. |
| R3b | `validation/local/r5nndia2aediccu.json`, `validation/local/final-local-3/` (archived) | `760e7b7` | Full, unfiltered run: 108 passed, 2 not-run (the same clause entries), **1 failed (MIG-AC-002)**, exit 1. Superseded by R4; see §5. |
| R3, R1, R2, BV3 | earlier local runs and verify (archived) | | Superseded. |
| **S1** | `validation/local/g7586p3q4x45qyc.json` | `97dd0d7` | F-01 round 4's own `smoke --target local`: 7/7 passed. |
| review | `validation/reviews/E2E-016.md` (review at `e8c3289`, re-review at `b3e3775`) | | The E2E-016 review part. |
| RC-009 | `ai/implementation/root-causes/2026-10-20-demo-ac-009.md`, section "Review" | `19a6b09` | Independent review: **accepted**. |
| BUILD-RECORD | `apps/demo/BUILD-RECORD.md` (round 4) | `97dd0d7` | Model and inputs of the E2E-015 build. Between `97dd0d7` and `321e41c` only this file changed under `apps/demo` (its "Smoke runs" and "Framework issues" sections were filled in). |

What changed between the evidence and the base:
- **R4 (`a5b2164`) to the base (`1b474c1`):** the phase-D fixes changed framework and test code: fix-pass0 (`account.ts`), fix-pass1 (`provision/cloudflare/target.ts`, `sst.ts`), fix-cloudtests (`tests/compliance/criteria/**` stage helpers), fix-envtoken (`_cloud/api.ts`, test hooks), fix-auth005 (new `auth/contract.test.ts`, `expected.ts`), fix-r2order (Cloudflare files store and tickets) and fix-sec001 (tests). **No full local run or batch verify exists after them** (L1, §1, §6). The only later local records are the filtered fixer run `nhtt0ff3xx72qvn` (`75b68b9`; MIG-AC-002/-003, SEC-AC-003, CLI-AC-004, E2E-014 passed; SEC-AC-001 and HTTP-AC-002 `blocked` because that worktree had no local `apiKey` value) and F-03's local smoke F3L.
- **Cloudflare records to the base:** after `6417611`, only comments changed in code (`git diff 6417611 1b474c1 -- packages apps tests skill`). The records before `6417611` predate fix-r2order; pass C re-ran the FILES criteria after it (D-cloudflare §2, caveat C-1 for E2E-009).
- COMPL-REQ-006 counts automated records only for the exact commit, so the release report for `1b474c1` reads "no record for commit" for every automated entry (§8).

## 1. Verdict

**The framework is "not working"** (COMPL-REQ-006, prompt §11):
- **AWS:** nothing has run (AWS phase not started).
- **Google:** the real Google login certification (GOOGLE-AC-005, E2E-008) and the other Google-dependent items are outstanding.
- **Cloudflare:** 67 of 81 IDs passed. **2 failed**, both owner-dependent: FILES-AC-003's expired-ticket clause (Q4, DEC-0101) and SEC-AC-005's "next request" (Q12, DEC-0092). **3 are blocked**: PROV-AC-002's restricted token (Q13), PROV-AC-004's fresh account (DEC-0364) and LOG-AC-004's outside-request clause (Q8). 9 are `not-run` (Google mocked). Phase D's exit check is not met (D-cloudflare §1).

**Local:**
- All 110 Local IDs are `passed` on the R4 basis, and none is `failed`. 109 passed in one full, unfiltered run at one commit (R4, `a5b2164`), with `verify` passing online and offline at the same commit (BV4). The 110th is E2E-015, a milestone with no runner record of its own (BUILD-RECORD plus R4).
- Two clause entries inside passed IDs are `not-run` under §8.2: CORE-AC-006's AWS bundle and SQL-AC-006's Data API retry loop.
- **L1 (new): the local basis is stale.** Phase D's fixes changed framework and test code after `a5b2164`, and no full local run or `verify` batch has been recorded since. Under DEC-0264's latest-record reading, the filtered run `nhtt0ff3xx72qvn` would decide SEC-AC-001 and HTTP-AC-002 on local as `blocked`; that is a missing run prerequisite in the fixer's worktree (no local `apiKey`), not a result of the code, so I keep R4 as the local basis. A full local run and batch verify at the head are needed before the local column can be called current.
- Open local items, none a `failed` entry: L1; U1 (cause of R3b's MIG-AC-002 failure unproven, §5); W5 (DEMO-AC-003's warn-clause test; Q10); G5 (no milestone record for E2E-015 and E2E-016); G4, O2, O3 (optional).

Counts by status (every `*-AC-*` and `E2E-*` ID, per target where its Where applies; a milestone-only item counts once):

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 110 | 0 | 0 | 0 (plus 2 §8.2 clause entries inside passed IDs: CORE-AC-006, SQL-AC-006) |
| cloudflare | 81 | 67 | 2 | 3 | 9 (Google login mocked; plus 3 §8.1 part entries inside passed IDs: AUTH-AC-005 ×2, AUTH-AC-009) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

Change from F-EV3: Cloudflare was 0 passed, 73 blocked, 8 not-run. CLI-AC-001 moved from `blocked` to `not-run`: the driver records the whole ID as Google-mocked and no Cloudflare test is tagged with it (F-EV3's note N1 no longer applies). Local and AWS counts are unchanged.

### DEMO-AC-003: status decided under plan §8

Unchanged from F-EV3. On local, DEMO-AC-003 is **`passed`, with the open weak assertion W5**, not `not-run`:
- No §8 rule applies: the warn clause is a Local, automated clause, and R4 ran its tagged test, which passed (`demo-criteria.spec.ts:656`).
- The test simulates the failure the only way the testing contract allows (`unavailable: ["files"]`). Under that contract the deleted post can never hold a stored photo (`testing.d.ts:40-41,93`; no seed API; `service.ts:140-144`), so the failing operation is the `files.list` of an empty prefix.
- A stronger test needs a contract change, which belongs to the owner: plan §11 Q10.
- The warn clause is local only, so W5 does not affect the Cloudflare status.

## 2. Judgements: demo criteria and the F-EV scenarios

In this table, CF means Cloudflare. Local evidence is R4 unless the row says otherwise; Cloudflare evidence is F-03 (F3S, F3L, F3D) unless the row says otherwise.

**F-03 (the demo on Cloudflare, plan §5 pass 8).** The demo stage `test-s6jca41ew34ahz3` was deployed from `321e41c` (first deploy stopped on the unset `shareKey`, as designed; `secrets set`; redeploy), then: cloud smoke 7/7 (F3S), local smoke 7/7 (F3L) from the same commit and tree, the demo criteria set (F3D, 7 passed), DEMO-AC-008 alone (passed), and `remove` (exit 0, nothing left). D1: 137 rows written, 451 read; 107 API requests. F-03 is **met**.

| ID | local | cloudflare | aws | Judgement |
| --- | --- | --- | --- | --- |
| DEMO-AC-001 | passed (R4, S1) | **passed** (F3D, F3S) | not-run (§8.2) | Page clauses from the driver set; newest first, drafts hidden and page size from the cloud smoke. W1 still applies on both targets. |
| DEMO-AC-002 | passed (R4) | **passed** (F3D) | not-run | Page requests replayed as four identities against the Cloudflare stage. |
| DEMO-AC-003 | **passed (R4, S1); W5 open** | **passed** (F3D, F3S) | not-run | Cloudflare: display and page clauses from the driver set; the 20 MB round trip, the maximum and delete from the cloud smoke, on DEC-0430's U+0001 keys. The warn clause is local only. |
| DEMO-AC-004 | passed (R4) | **passed** (F3D) | not-run | |
| DEMO-AC-005 | passed (R4) | **passed** (F3D) | not-run | |
| DEMO-AC-006 | passed (R4) | n/a | n/a | Unchanged. |
| DEMO-AC-007 | passed (R4) | **passed** (F3D) | not-run | W4 applies to the local expiry clause. |
| DEMO-AC-008 | passed (R4) | **passed** (`pqc4u7j4o1g4rpb`) | not-run | The driver's cloud check, run alone with one worker and `COMPLIANCE_DEMO_STAGE`, matched the `info` entries in the shared log bucket. W3 holds (time window and requestId, not message). |
| DEMO-AC-009 | passed (R4) | **passed** (F3D) | not-run | |
| DEMO-AC-010 | passed (R4, local part) | **passed, Cloudflare part** (F3S, F3L) | not-run | Cloud and local smokes pass from one commit with no source difference. **Criterion not met:** the AWS smoke is outstanding. |
| DEMO-AC-011 | passed (R4) | n/a | n/a | Unchanged. |
| CHECK-AC-005 | passed (R4) | n/a | n/a | Unchanged. |
| E2E-002 | passed (local part, R4) | **passed, Cloudflare part** (F3S, F3L) | not-run | Two of the three smoke runs pass from one commit with no source difference (on a cloud `E2E-002.spec.ts` reports `blocked` by design, so there is no driver record; plan §5 pass 8). **Scenario not met:** the AWS stage is outstanding. |
| E2E-004 | **passed (R4)** | passed (`gblenqeyh7kuls5`; coverage and record parts) | not-run | Cloudflare: the coverage part failed in pass 1c (AUTH-AC-005 had no cloud test) and passed in pass C after DEC-0429. The pass part, read over the latest record of every ID (DEC-0264), is **not met** on Cloudflare: FILES-AC-003 and SEC-AC-005 failed; PROV-AC-002, PROV-AC-004 and LOG-AC-004 are blocked. **Scenario not met.** |
| E2E-015 | **passed (milestone; BUILD-RECORD, R4)** | **passed, cloud part** (F3D, F3S) | not-run | Every demo criterion with a Cloudflare part passed on Cloudflare from `321e41c`, whose `apps/demo` is round 4 (only `BUILD-RECORD.md` changed; it records no `FRAMEWORK-ISSUE.md`). **No milestone evidence record (G5)** for either part, so the release report cannot see it. |
| E2E-016 | passed (scan R4; review) | n/a | n/a | Unchanged. G5. |
| FILES-AC-003 | **passed (R4)** | **failed** (`gblenqeyh7kuls5`) | not-run | The expired-ticket clause: status null instead of storage's status, because R2 sends no CORS headers on 403 (DEC-0101). The other four tests passed. **Owner: Q4.** |
| E2E-009 | **passed (R4)** | passed (`xdryowrec3lephb`) | not-run | Cloudflare record predates fix-r2order (caveat C-1, D-cloudflare §2). |
| E2E-011 | passed (R4) | **passed** (`xdryowrec3lephb` and the troubleshooting check) | not-run | The two `curl` commands of `skill/reference/troubleshooting.md` §1, as written, found the forced error's entry by its requestId (`validation/cloudflare/pass-2to5/logs/5-trouble.log`). This closes E-EV's open item. |

## 3. Phase-F notes on the non-demo IDs

- CLI-AC-003: C-EV Flag 1 is closed. The tagged driver tests that inject runner and cleanup failures are in `tests/compliance/harness/driver.unit.test.ts`.
- SEC-AC-001…004: C-EV Flag 4 is closed.
- E2E-011: passed on local (R4) and on Cloudflare (`xdryowrec3lephb`, plus the troubleshooting check with only the skill's `curl` commands, `pass-2to5/logs/5-trouble.log`). E-EV's open item is closed. The skill still calls those two commands "not yet verified on Cloudflare in this phase" (S-1, §6).

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
| 1–16 | Cloud-only tests: CF-AC-001, CF-AC-002, FILES-AC-005, HTTP-AC-005, LOG-AC-004 (2), MIG-AC-006, PROV-AC-001, -002, -003, -004, -006, COMPL-AC-004, COMPL-AC-008, the secrets further-stage test and the SEC storage cloud part | No local part; they run on a Cloudflare stage. Unchanged since R1. All of them have now run on Cloudflare (D-cloudflare §7). |
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
| **Cloudflare, 2026-10-23/24 (8 records)**: cloud-test-paths; pass0-F1 (`..` DELETE 403); pass0-F2 (409 owned); pass1 SST `--target`; pass1c E2E-004/AUTH-AC-005; pass1c FILES-AC-001 R2 order; pass2 SEC-AC-001/HTTP-AC-002; pass2 SEC-AC-005 | yes, all eight | all reviewed: six accepted with required changes or conditions; FILES-AC-001's fix approved only after the live probe; SEC-AC-005's causal claim confirmed, no agent fix possible | Fixes DEC-0421…DEC-0431 landed and re-checked on Cloudflare, except SEC-AC-005 (Q12) and F1 (real Cloudflare unverified, Q11). Detail: D-cloudflare §5. |

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
| G5 | No milestone evidence records for E2E-015 (local and cloud parts) and the E2E-016 review | **Open** | Record them with `--milestone`, or with a record written for the review. The Cloudflare `blocked` set of F-EV3 is superseded by real Cloudflare records, so that part of G5 is closed. |
| W5 | DEMO-AC-003 warn clause: weak assertion forced by the testing contract | **Open, owner** | Plan §11 Q10. |
| **U1** | **Cause of R3b's MIG-AC-002 failure unproven** | **Open** | The race is fixed (DEC-0417) and MIG-AC-002 passed in R4. Settled by the first fatal line of a recurrence, which `failureOutput` now keeps, or by a full local run under the `MINIFLARE_WORKERD_PATH` wrapper (§5). A non-bind fatal sends the record back to §8 step 1. No verdict depends on it today. |
| **O2** | fix-mig002's integration regression test (`dev.test.ts`, "serves even when every port freePort returns is taken …") has no runner output | Open (new, minor) | It is untagged and not in `verify`, so no committed run covers it; only the fixer's red-green does. Run it in the next batch (`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/local/dev.test.ts`), or have the driver run untagged regression tests. |
| O3 | Order-dependence scan covers 29 of 84 integration files | Open (optional) | The accepted record's next step: shuffle runs for `kv/*`, `sql/*`, `files/server-operations` and `local/dev`. |
| O1 | Edited `expected.unit.test.ts` had no runner output | **Closed** | BV3, BV4. |
| — | D-01, D-03 and order-scan records lacked Reviews | **Closed** | Reviews committed in `8f3ab0f`. |

Also noted, not open: the testing-dev-registry Review's re-check 5 (run `sessions.test.ts` alone with a planted foreign entry) has no committed output of its own. The same mechanism is guarded by the three `createTestApp and the dev registry` unit tests, which plant foreign entries under faked dates and passed in BV3 and BV4.

| **L1** | **Local basis stale:** no full local run or batch verify since the phase-D fixes (62 files under `packages`, `apps`, `tests`, `skill` changed between `a5b2164` and `1b474c1`) | **Open (new)** | Agent work: one full `npm run compliance -- --target local` and `verify` online and offline at the head, with the reference app's local `apiKey` set (the filtered run `nhtt0ff3xx72qvn` lacked it). |
| **C-1** | E2E-009 on Cloudflare predates fix-r2order | Open (new, minor) | Agent work: `--only E2E-009` on one Cloudflare stage at a later commit. |
| **G6** | The release generator reads milestone IDs from the newest milestone record even when it lists them as "not selected" | Open (new) | Agent work: fix `tests/compliance/tools/release.ts` (D-cloudflare §3). |
| **S-1** | `skill/reference/troubleshooting.md` §1 calls the two Cloudflare `curl` commands "not yet verified" | Open (new, docs) | They are verified now; update that wording only. |

**Remaining open local items:** L1 (stale basis), U1 (unproven cause), W5 (owner), G5 (milestone records), O2 (minor), G4 and O3 (optional), and W1–W4 (accepted weak points). None is a `failed` or `not-run` local entry.

**Cloudflare:** 2 `failed` (FILES-AC-003, Q4; SEC-AC-005, Q12) and 3 `blocked` (PROV-AC-002, Q13; PROV-AC-004, fresh account; LOG-AC-004, Q8), all owner-dependent; C-1 and G6 are agent work. Other owner items from the Cloudflare passes: Q11 (`..` DELETE on real Cloudflare) and Q14 (DEC-0430's U+0001 ending). Detail: `D-cloudflare.md` §8.

## 7. Confirmed §8 not-run lists

Now confirmed against the Cloudflare records (D-cloudflare §4). In brief:
- **§8.1 (Google login mocked):** GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-005 (admin-list part, and the successful-callback part added by DEC-0429), AUTH-AC-009 (production), AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud), E2E-008, and CLI-AC-001. Every Cloudflare record gives these the detail "Google login mocked for this phase". CLI-AC-001 is recorded `not-run` as a whole, not only its `certify-auth` part; F-EV3's note N1 no longer applies.
- **§8.2 (AWS phase not started):** every AWS entry, plus the AWS parts inside the criteria run here. On local, the AWS parts appear as R4's two clause entries for CORE-AC-006 and SQL-AC-006. No AWS code exists, so no clause was wrongly passed.
- **§8.3 (milestones):**
  - E2E-016 review and E2E-015 (local) are judged `passed`, with no evidence record (G5).
  - E2E-010 (`xxiuurmy40pnr33`), E2E-012 (`e22y1n7jn93xoz4`), PROV-AC-003 and PROV-AC-006 CF part (`6e5ya5y8z05u4ce`) and COMPL-AC-008 (`0reagqr1j01rqfv`) **passed** with milestone records. PROV-AC-004's record (`sysad9rajoir4yt`) is `blocked` on its fresh-account clause.
  - E2E-015's cloud part is judged `passed` from F-03's records, with no milestone record (G5).
  - GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006 and AUTH-AC-005 admin-list are `not-run` (Google).
  - All AWS runs are `not-run`.
- **No §8 rule is used for DEMO-AC-003** (§1), and none for the skipped regression tests (§4.3), which are not criterion tests.

## 8. Release report

The report is generated with `node tests/compliance/tools/report.mjs release --commit 1b474c11c859653831ca14a595beec2b2e2df917 --out validation/release/2026-10-24-1b474c1.md`, as for the earlier reports. The previous report (`2026-10-21-c016e7e.md`) is deleted; the same command with its SHA regenerates it.

- **Result:** **"not working"**.
- **Why:** COMPL-REQ-006 counts automated records only for the exact commit. No record (local or Cloudflare) is for `1b474c1`, so every automated entry reads "no record for commit".
- **Milestones:** the generator lists every milestone item as missing or `not-run`. For E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006 that reading is wrong: it takes the newest milestone record (`0reagqr1j01rqfv`, COMPL-AC-008 only), which lists them as "not selected for this run (--only)" (G6). Their own milestone records passed (PROV-AC-004: blocked). No GOOGLE-AC-005 record exists, so every commit since the start of history that touched GOOGLE or login-provider interface files is listed.
- **Evaluator's note:** appended below the generated text and marked as not generated.

## 9. Full per-target status table

Status cells give the status and its evidence ref. Evidence refs:
- R4, S1, BUILD-RECORD and review are defined at the top.
- Cloudflare cells name the record `validation/cloudflare/<runId>.json` that decides the ID (the latest record that selected it, DEC-0264). Pass, commit and detail per ID: `D-cloudflare.md` §7.
- §8.1 means "Google login mocked for this phase".
- §8.2 means "AWS phase not started".
- n/a means the Where column does not name that target.

Notes that hold for most rows are given here and not repeated in each row:
- **Local `passed` with R4 and no note:** every tagged test passed in R4, at `a5b2164`. The code has changed since (L1).
- **Cloudflare `passed` with no note:** every tagged test of the ID passed in the named record, and the record's leftovers are [].

| ID | Where | local | cloudflare | aws | Notes |
| --- | --- | --- | --- | --- | --- |
| AUTH-AC-001 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-002 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-003 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-004 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| AUTH-AC-005 | Local, cloud; admin-list part: cloud (milestone) | passed (R4) | passed (gblenqeyh7kuls5) | not-run (§8.2) | L: Contract part. Admin-list part is cloud milestone (Google, §8.1). CF: Contract part passed over HTTP (DEC-0429); successful-callback part and admin-list part (milestone) `not-run` (§8.1). Supersedes pass 1c's `not-run`. |
| AUTH-AC-006 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| AUTH-AC-007 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| AUTH-AC-008 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-009 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) | L: Local and test-stage parts; production 404 part is cloud (Google, §8.1). CF: Test-stage part passed; production part `not-run` (§8.1). |
| AUTH-AC-010 | Local | passed (R4) | n/a | n/a |  |
| AUTH-AC-011 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| AUTH-AC-012 | Local | passed (R4) | n/a | n/a |  |
| AWS-AC-001 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-002 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-003 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-004 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-005 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-006 | Cloud | n/a | n/a | not-run (§8.2) |  |
| CF-AC-001 | Cloud | n/a | passed (xdryowrec3lephb) | n/a |  |
| CF-AC-002 | Cloud | n/a | passed (5tr1c8w0x1b9lai) | n/a |  |
| CF-AC-003 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CFG-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| CFG-AC-004 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| CFG-AC-005 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| CFG-AC-006 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-003 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-004 | Local | passed (R4) | n/a | n/a |  |
| CHECK-AC-005 | Local | passed (R4) | n/a | n/a | L: Template part: `verify passes on the template`. Demo part: `demo-local.spec.ts` `[CHECK-AC-005] demo part`, `verify` on a fresh copy of `apps/demo` (exit 0, 84 s). The stale `PHASE_RULES` entry is gone (R4 `raw/expected.json`: no not-run part). G2 closed. |
| CHECK-AC-006 | Local | passed (R4) | n/a | n/a |  |
| CLI-AC-001 | Local, cloud | passed (R4) | not-run (§8.1) | not-run (§8.2) | CF: Whole ID `not-run` (§8.1, planner addition; N1 superseded): no Cloudflare test is tagged CLI-AC-001. |
| CLI-AC-002 | Local | passed (R4) | n/a | n/a |  |
| CLI-AC-003 | Local | passed (R4) | n/a | n/a | L: C-EV Flag 1 closed: the tagged driver tests that inject runner and cleanup failures. |
| CLI-AC-004 | Local, cloud | passed (R4) | passed (cwcrlz8fxgo3ud4) | not-run (§8.2) |  |
| CLI-AC-005 | Local, cloud | passed (R4) | passed (2nl855v5sscoqls) | not-run (§8.2) |  |
| COMPL-AC-001 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| COMPL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| COMPL-AC-004 | Cloud | n/a | passed (5kjbwwwpf3mvj95) | not-run (§8.2) | CF: Test stage removed, no leftovers (D-cloudflare §3). |
| COMPL-AC-005 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| COMPL-AC-006 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-007 | Local | passed (R4) | n/a | n/a |  |
| COMPL-AC-008 | Cloud (milestone) | n/a | passed (0reagqr1j01rqfv) | not-run (§8.2) | CF: Milestone record, both abort points. |
| CORE-AC-001 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-002 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| CORE-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| CORE-AC-004 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-005 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-006 | Local | passed (R4) | n/a | n/a | L: AWS-bundle clause `not-run` (§8.2), recorded as its own entry in R4. |
| CORE-AC-007 | Local | passed (R4) | n/a | n/a |  |
| CORE-AC-008 | Local | passed (R4) | n/a | n/a |  |
| DEMO-AC-001 | Local, cloud | passed (R4; S1) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: Script clause: `demo-pages.spec.ts`. Newest first, drafts hidden and page size: the demo's smoke test, run inside E2E-002 in R4. Weak point W1. |
| DEMO-AC-002 | Local, cloud | passed (R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: `demo-criteria.spec.ts`. Four identities replay the page's own requests. |
| DEMO-AC-003 | Local, cloud | passed (R4; S1) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: Display (`demo-pages.spec.ts`), round trip, maximum and delete (smoke inside E2E-002), and the warn clause (`demo-criteria.spec.ts:656`, in-process with `unavailable: ["files"]`), all after fix-f04b. **Open weak assertion W5:** the warn test can only fail the `list` of an empty prefix, never the deletion of a stored photo, because of the testing contract (§4.3, Q10). |
| DEMO-AC-004 | Local, cloud | passed (R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: R4. |
| DEMO-AC-005 | Local, cloud | passed (R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: logout through the page and login again in the same and a new browser. |
| DEMO-AC-006 | Local | passed (R4) | n/a | n/a | L: `demo-local.spec.ts`: values file changed, then `dev` restarted. |
| DEMO-AC-007 | Local, cloud | passed (R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: altered link through the page; expiry in-process with a shifted clock. |
| DEMO-AC-008 | Local, cloud | passed (R4) | passed (pqc4u7j4o1g4rpb) | not-run (§8.2) | L: info entries matched by app, severity, requestId and time window (W3). CF: Driver's cloud check, run alone. |
| DEMO-AC-009 | Local, cloud | passed (R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: R4, after the test fix `c3b407c`. The root-cause record now has its Review (accepted; G3 closed). |
| DEMO-AC-010 | Local, cloud | passed (R4) | passed (vn8cm0ie7v2rhul) | not-run (§8.2) | L: Local part: `E2E-002.spec.ts` (shared tag). CF: Cloudflare part, as E2E-002. Criterion not met (AWS). |
| DEMO-AC-011 | Local | passed (R4) | n/a | n/a | L: production values files, then the stub provider in-process. |
| E2E-001 | Local | passed (R4) | n/a | n/a |  |
| E2E-002 | Local, cloud | passed (R4) | passed (vn8cm0ie7v2rhul) | not-run (§8.2) | L: Local part only: the smoke test passed from a copy identical to `apps/demo` at `a5b2164`. CF: Cloudflare part: cloud and local smokes at `321e41c`, same `apps/demo` tree. Scenario not met (AWS). |
| E2E-003 | Local | passed (R4) | n/a | n/a |  |
| E2E-004 | Local, cloud | passed (R4) | passed (gblenqeyh7kuls5) | not-run (§8.2) | L: Coverage, record and pass parts, all in R4, one full unfiltered run at one commit: every other result is `passed` or a §8.2 clause entry, exit 0. G1 closed. **Scenario not met** until Cloudflare and AWS also pass. CF: Coverage and record parts; supersedes pass 1c's coverage failure. Pass part not met on Cloudflare (2 failed, 3 blocked). |
| E2E-005 | Cloud | n/a | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| E2E-006 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-007 | Local; cloud (milestone) | passed (R4) | not-run (§8.1) | not-run (§8.2) | L: Local part (in-process, stub provider); cloud part milestone, not-run (§8.1). CF: Cloud part (milestone). |
| E2E-008 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-009 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) | L: R4 is after fix-f04b, so the BMP `attachment` path is now covered. The provisional status of the previous F-EV is lifted. CF: Caveat C-1: before fix-r2order; not re-run since. |
| E2E-010 | Cloud (milestone) | n/a | passed (xxiuurmy40pnr33) | not-run (§8.2) | CF: Milestone record. |
| E2E-011 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) | CF: Plus the troubleshooting `curl` commands, as written (`pass-2to5/logs/5-trouble.log`). |
| E2E-012 | Cloud (milestone) | n/a | passed (e22y1n7jn93xoz4) | not-run (§8.2) | CF: Milestone record. |
| E2E-013 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| E2E-014 | Local, cloud | passed (R4) | passed (0ljocvikeb16ebm) | not-run (§8.2) |  |
| E2E-015 | Local, cloud (milestone) | passed (BUILD-RECORD; R4) | passed (nu3lt4mhjsn4ihq) | not-run (§8.2) | L: Round-4 demo (`97dd0d7`, BUILD-RECORD) built from the three inputs. No `FRAMEWORK-ISSUE.md` entry is open, and every F-02 record is ACCEPTED. Every local demo criterion passed in R4 (DEMO-AC-003 with W5). No milestone evidence record exists (G5). CF: Cloud part: every cloud demo criterion passed at F-03. No milestone record (G5). |
| E2E-016 | Local; review: milestone | passed (R4; review) | n/a | n/a | L: Scan part: R4. Review part (milestone): `validation/reviews/E2E-016.md` re-review at `b3e3775`. Checks 1 to 3 pass, R-01 and R-06 are resolved, and R-10 was closed by DEC-0413/0414 (`2d99be2`). No milestone evidence record exists (§6 G5). |
| FILES-AC-001 | Local, cloud | passed (R4) | passed (gblenqeyh7kuls5) | not-run (§8.2) | CF: Supersedes pass 1c's failure (R2 order; DEC-0430). |
| FILES-AC-002 | Local, cloud | passed (R4) | passed (gblenqeyh7kuls5) | not-run (§8.2) |  |
| FILES-AC-003 | Local, cloud | passed (R4) | failed (gblenqeyh7kuls5) | not-run (§8.2) | L: R4 is after fix-f04b. CF: Expired-ticket clause: status null (DEC-0101). Owner: Q4. |
| FILES-AC-004 | Local, cloud | passed (R4) | passed (gblenqeyh7kuls5) | not-run (§8.2) |  |
| FILES-AC-005 | Cloud | n/a | passed (gblenqeyh7kuls5) | not-run (§8.2) |  |
| FILES-AC-006 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-001 | Local, cloud | passed (R4) | not-run (§8.1) | not-run (§8.2) | L: Local part (stubbed `fetch`); cloud step-1 part not-run (§8.1). |
| GOOGLE-AC-002 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-003 | Local | passed (R4) | n/a | n/a |  |
| GOOGLE-AC-005 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| HTTP-AC-001 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| HTTP-AC-002 | Local, cloud | passed (R4) | passed (651l3x1zgz7pbx5) | not-run (§8.2) | CF: Supersedes pass 2's failure (DEC-0431 wait). |
| HTTP-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| HTTP-AC-004 | Cloud | n/a | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| HTTP-AC-005 | Cloud | n/a | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| HTTP-AC-006 | Local | passed (R4) | n/a | n/a |  |
| HTTP-AC-007 | Local | passed (R4) | n/a | n/a |  |
| KV-AC-001 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| KV-AC-002 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| KV-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| KV-AC-004 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| KV-AC-005 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| LOCAL-AC-001 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-003 | Local | passed (R4) | n/a | n/a |  |
| LOCAL-AC-004 | Local | passed (R4) | n/a | n/a | L: R4 is after DEC-0417 (`dev` binds port 0 for Vite, the Worker and the inspector); the loopback-only test passed. |
| LOG-AC-001 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| LOG-AC-002 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| LOG-AC-003 | Local | passed (R4) | n/a | n/a |  |
| LOG-AC-004 | Cloud | n/a | blocked (cwcrlz8fxgo3ud4) | not-run (§8.2) | CF: Outside-request clause `blocked` (Q8); the other clauses passed. |
| LOG-AC-005 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| MIG-AC-001 | Local | passed (R4) | n/a | n/a |  |
| MIG-AC-002 | Local, cloud | passed (R4) | passed (ghref0pc0a9bwmp) | not-run (§8.2) | L: Failed 1 of 3 tests in R3b (`r5nndia2aediccu`, `760e7b7`): the no-change deploy's `dev` start died (workerd fatal at startup; first line cut off). Cause unproven (U1, §5); the port race was fixed as a confirmed defect (DEC-0417); all 3 tests passed in R4. |
| MIG-AC-003 | Local, cloud | passed (R4) | passed (ghref0pc0a9bwmp) | not-run (§8.2) |  |
| MIG-AC-006 | Cloud | n/a | passed (ghref0pc0a9bwmp) | not-run (§8.2) |  |
| PROV-AC-001 | Cloud | n/a | passed (5fgih0buv8i5tc3) | not-run (§8.2) |  |
| PROV-AC-002 | Cloud | n/a | blocked (5swm2wowq7t3yho) | not-run (§8.2) | CF: Restricted-token clause `blocked`: token not supplied (Q13); 4 of 5 tests passed. |
| PROV-AC-003 | Cloud (milestone) | n/a | passed (6e5ya5y8z05u4ce) | not-run (§8.2) | CF: Milestone record. |
| PROV-AC-004 | Cloud (milestone) | n/a | blocked (sysad9rajoir4yt) | not-run (§8.2) | CF: Milestone record: twice-run part passed; fresh-account clause `blocked` (DEC-0364). |
| PROV-AC-005 | Local | passed (R4) | n/a | n/a |  |
| PROV-AC-006 | Cloud (milestone) | n/a | passed (6e5ya5y8z05u4ce) | not-run (§8.2) | CF: Milestone record (CF part). |
| PROV-AC-007 | Local | passed (R4) | n/a | n/a |  |
| SEC-AC-001 | Local, cloud | passed (R4) | passed (651l3x1zgz7pbx5) | not-run (§8.2) | CF: Supersedes pass 2's failure (DEC-0431 wait). |
| SEC-AC-002 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| SEC-AC-003 | Local, cloud | passed (R4) | passed (cwcrlz8fxgo3ud4) | not-run (§8.2) |  |
| SEC-AC-004 | Local | passed (R4) | n/a | n/a |  |
| SEC-AC-005 | Cloud | n/a | failed (651l3x1zgz7pbx5) | not-run (§8.2) | CF: `secrets set` clause: version rollout (DEC-0092). Owner: Q12. |
| SKILL-AC-001 | Local | passed (R4) | n/a | n/a | L: R4 is after the fix-f04b edit of `skill/reference/files.md`. |
| SKILL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-003 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-004 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-005 | Local | passed (R4) | n/a | n/a |  |
| SKILL-AC-006 | Cloud (milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| SQL-AC-001 | Local | passed (R4) | n/a | n/a |  |
| SQL-AC-002 | Local | passed (R4) | n/a | n/a |  |
| SQL-AC-003 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| SQL-AC-004 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| SQL-AC-005 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) |  |
| SQL-AC-006 | Local, cloud | passed (R4) | passed (xdryowrec3lephb) | not-run (§8.2) | L: Data API retry-loop clause `not-run` (§8.2), recorded as its own entry in R4. |
