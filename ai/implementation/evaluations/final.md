# F-EV: Final evaluation (local and Cloudflare phase)

Evaluator: independent F-EV subagent. I wrote none of the code, tests, evidence or reviews judged here. I worked from committed evidence only, on 2026-10-20:
- I ran no test suite and made no Cloudflare call.
- I changed no code, test or evidence.
- `npm ci` was run only so that two read-only tools could run:
  - the release-report generator (`node tests/compliance/tools/report.mjs release`, which reads records and `git log`);
  - a catalogue dump (`readCatalogue(docs)`, from the session scratchpad), which gives every ID and its Where column.

Base: `origin/claude/implement-local-cloudflare` at `3caff76` ("Merge batch-verify-2 evidence"). Branch: `claude/implement-local-cloudflare-f-ev`.

Inputs:
- plan §1, §7 (F-01 … F-EV) and §8;
- prompt §4, §7, §8, §11 and §12;
- the evaluations A, B, C-local and E;
- `docs/demo/demo-spec.md` §2, `docs/acceptance/e2e-scenarios.md`, `docs/components/compliance.md` and `check.md`;
- the evidence and reviews listed below;
- the root-cause records in `ai/implementation/root-causes/`;
- the test sources behind the judged IDs.

Context taken as given: Cloudflare testing is stopped (DEC-0317). D1 has been off since the phase A spikes used up the daily row limit on 2026-10-19, and the owner has not yet allowed testing to resume. D-RUN, D-RUN-M and F-03 have not run, so D-EV is not done. Google login is mocked (§8.1). AWS is out of scope (§8.2).

## Evidence references

| Ref | What | Commit | Notes |
| --- | --- | --- | --- |
| **R1** | `validation/local/emckebxm5x3kxd1.json` (+ `raw/`), logs in `validation/local/final-local/` | `8d65a70` | Full, unfiltered local compliance run. 98 passed, 12 not-run, 2 failed (DEMO-AC-009, E2E-004). Exit 1. `verify` online and offline: exit 0, unit 1689/1689. |
| **R2** | `validation/local/cmzgvk4zb2o6ako.json` (+ `raw/`), logs in `validation/local/demo-rerun/` | `ed1f51b` | `--only DEMO-AC-001…011,E2E-002,E2E-004`. All 13 passed: 14 Playwright tests, 0 skipped, exit 0. |
| **S1** | `validation/local/g7586p3q4x45qyc.json` | `97dd0d7` | F-01 round 4's own `smoke --target local`: 7/7 passed. `apps/demo` has not changed since `97dd0d7`. |
| **BV2** | `validation/local/batch-verify-2/` | `1487c7d` | `verify` online and offline, exit 0. Unit 1687/1687, template 18/18, reference 52/52 per dialect. Its tree equals `3caff76` outside `validation/`. |
| review | `validation/reviews/E2E-016.md` (review at `e8c3289`, re-review at `b3e3775`) | | The E2E-016 review part. |
| BUILD-RECORD | `apps/demo/BUILD-RECORD.md` (round 4) | `97dd0d7` | Model and inputs of the E2E-015 build. |

Changes after R1 (`git diff 8d65a70 3caff76`, outside `validation/`):
- **Tests only, before R2:** the demo compliance specs (`demo-criteria`, `demo-local`, `E2E-002`, `support/demo.ts`) and the DEMO-AC-009 test fix (`c3b407c`).
- **After R2:**
  - fix-f04b: FILES code, its three unit-test files, `files.md` and one line of `skill/reference/files.md`;
  - fix-f04a: docs only;
  - the decision-log integration;
  - one comment in `tests/compliance/harness/catalogue.ts`.
- **Unchanged:** `apps/` and `docs/contracts/`.
- **Catalogue check:** the docs changes still parse. The catalogue at `3caff76` reads 140 IDs, the same as R1's traceability report.

## 1. Verdict

**The framework is "not working"** (COMPL-REQ-006, prompt §11):
- **AWS:** nothing has run (AWS phase not started).
- **Google:** the real Google login certification (GOOGLE-AC-005, E2E-008) and the other Google-dependent items are outstanding.
- **Cloudflare:** every Cloudflare criterion is `blocked`. The phase-D and F-03 cloud runs have not started.

**Local:**
- No failures.
- 106 of the 110 Local IDs are `passed`, and 4 are `not-run` for evidence gaps. Those gaps need one cheap runner action and one test-author action (§6).
- Phase F's local exit is therefore **not fully met**.

Counts by status (every `*-AC-*` and `E2E-*` ID, per target where its Where applies; a milestone-only item counts once):

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 106 | 0 | 0 | 4 (DEMO-AC-003, CHECK-AC-005, E2E-004, E2E-015) |
| cloudflare | 81 | 0 | 0 | 73 | 8 (Google login mocked) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

None of the local `not-run` results falls under §8. All four are evidence gaps:
- **DEMO-AC-003:** one clause has no runner evidence.
- **CHECK-AC-005:** the demo part has no tagged test and no runner evidence, and the phase rule that excuses it is stale.
- **E2E-004:** there has been no full run at one commit since the demo tests were added.
- **E2E-015:** it depends on DEMO-AC-003, and no milestone record exists.

## 2. Judgements: demo criteria and the F-EV scenarios

In this table, CF means Cloudflare.

| ID | local | cloudflare | aws | Judgement |
| --- | --- | --- | --- | --- |
| DEMO-AC-001 | passed (R2, S1) | blocked (F-03 not run; D1) | not-run (§8.2) | "Renders as text": `demo-pages.spec.ts` checks the literal text, that no `script` element is added and that the script never runs, for the author and for an anonymous visitor in the list and on the post. "Only published, newest first, paginated" comes from the demo's smoke test, run inside R2's E2E-002 (and S1): a draft is 404 for anonymous visitors, and `?pageSize=2` returns `[newest, older]`. W1: no test opens a second page. |
| DEMO-AC-002 | passed (R2) | blocked | not-run | The demo's own page requests are recorded and replayed as anonymous, user, other user and admin. Each permitted action succeeds, and each forbidden one is refused (401/403/404) and changes nothing. |
| DEMO-AC-003 | **not-run** (warn clause) | blocked | not-run | Shown on local: a JPEG of at least 20 MB displays (`<img>` complete, at the photo's size; R2). The 20 MB round trip is byte-identical, the maximum holds, and deleting the post gives a 404 for the post and a failing ticket for its file (smoke inside R2's E2E-002, and S1). **Not shown by any runner:** "in a local test, a simulated file-deletion failure produces a `warn` log entry". That is only `apps/demo/tests/app.test.ts` "logs a file-deletion failure at warn", which runs only in `apps/demo` verify, and no committed runner output of that exists (G2). It also needs a re-run after fix-f04b (§4.1). |
| DEMO-AC-004 | passed (R2) | blocked | not-run | An admin sets the banner through the page, and anonymous and logged-in visitors see it. A user's replayed attempt is refused and changes nothing. |
| DEMO-AC-005 | passed (R2) | blocked | not-run | The choice made in the page survives logout through the page's control and a mock login again, and also a new browser context. Another user keeps the default. |
| DEMO-AC-006 | passed (R2) | n/a | n/a | `demo-local.spec.ts`: the title is changed in the values file, `dev` is restarted, and the page shows the new title. Where: Local only. |
| DEMO-AC-007 | passed (R2) | blocked | not-run | A share link shows the draft to an anonymous visitor. The link with one character changed is refused and shows nothing. Expiry was tested in-process with a 1-day lifetime: the link still opens at 12 h and is refused at 2 days. The spec asks for "the test runner's fake timers"; a clock shift is an acceptable stand-in. |
| DEMO-AC-008 | passed (R2) | blocked (driver's cloud check at F-03) | not-run | An `info` entry of the demo with a requestId appears in the local `.logs` within the publish window and within the delete window. W3: it does not check the message. The framework writes no `info` entries (only `warn`/`error`), so the match is not vacuous. |
| DEMO-AC-009 | passed (R2) | blocked | not-run | After `c3b407c`, the test checks that the account heading and the `/api/auth/me` ID are shown, and that the copy button puts exactly that ID on the clipboard (sentinel replaced). R1's failure was a test defect (the record shows no demo defect). F3: the record has no committed Review. |
| DEMO-AC-010 | passed (R2, local part) | blocked (F-03) | not-run | Local part only: the smoke test passed from a copy identical to the commit's `apps/demo`. The criterion needs Cloudflare and AWS from the same commit. |
| DEMO-AC-011 | passed (R2) | n/a | n/a | Every committed production values file sets `framework.users`. In-process with the stub provider: a listed login creates a draft, and an unlisted login gets 401 and sees only the published post. |
| CHECK-AC-005 | **not-run** (demo part) | n/a | n/a | Template part: passed (R1, `verify passes on the template`). Demo part: R1 records it `not-run` through `PHASE_RULES` ("demo built in phase F (plan C-EV)"). That rule is now stale; it was to be removed "when phase F adds the demo's [CHECK-AC-005] test", and no such test exists. BUILD-RECORD says `verify` passed, but that is the builder's own report, not runner evidence (prompt §7). BV2's root `verify` does not include `apps/demo`. See G2. |
| E2E-002 | passed (local part, R2) | blocked (F-03) | not-run | **Scenario not met:** it needs all three smoke runs from one commit. The local part is sound. The copy is compared file by file with `git show HEAD:` (only the scratch `.gitignore` is excluded), `smoke` exits 0, its record validates, and every result is `passed`. |
| E2E-004 | **not-run** (pass part) | blocked | not-run | R2 passed both tests: the coverage part (every expected local ID has a tagged test) and the record part. The pass part ("every other applicable result passed", read from the same record, DEC-0305) cannot be read from an `--only` run. The last full run (R1) failed it. **Scenario not met.** It needs one full local run at one commit (G1), plus Cloudflare and AWS. |
| E2E-015 | **not-run** (milestone) | blocked (F-03) | not-run | Round 4 was built by a fresh agent from only `skill/`, `apps/template` and `demo-spec.md`; BUILD-RECORD records the model and inputs. It raised no `FRAMEWORK-ISSUE.md`. The F-02 records for rounds 1 to 3 are ACCEPTED, and their fixes have landed. The local demo criteria pass except DEMO-AC-003's warn clause (G2). There is no milestone evidence record (G5). Cloud parts are blocked. Note: `skill/reference/files.md` line 39 changed after round 4 (fix-f04b). I do not count that as requiring a rebuild: it is one sentence of FILES behaviour, the demo uses `<img src>` for display, and its photo link with `target=_blank` now downloads, which is the DEC-0414 visible change listed for the owner. |
| E2E-016 | passed (scan R1; review) | n/a | n/a | Scan part: 3 tagged tests passed in R1, and `docs/contracts/` has not changed since. Review part (milestone): the re-review at `b3e3775` records checks 1 to 3 passing and the blocking findings R-01 and R-06 resolved, including the `demo-spec.md` scope ruling. Its R-10 (decision log) was closed by DEC-0413/DEC-0414 (`2d99be2`): DEC-0313 is marked superseded, and no `DEC-PENDING` is left in `packages/`, `docs/` or `skill/`. Non-blocking R-02…R-05 and R-07…R-09 stay open with their owners. G5: no milestone evidence record, so the release report cannot see this pass. |

## 3. Phase-F notes on the non-demo IDs

- CLI-AC-003: C-EV Flag 1 is closed. R1 folds in 8 tagged driver tests that inject runner and cleanup failures (`tests/compliance/harness/driver.unit.test.ts`).
- SEC-AC-001…004: C-EV Flag 4 is closed. R1 is at a commit that contains the rewritten `cli.test.ts`.
- E2E-011 (local): passed in R1. Its Cloudflare run, which must use only the commands in `skill/reference/troubleshooting.md`, stays blocked (E-EV).

## 4. Specific checks requested

### 4.1 fix-f04b after the final local run: does the evidence for FILES-AC-003, E2E-009 and DEMO-AC-003 still count?

fix-f04b (`cfbd946`, merged `b3e3775`) changed `files/cloudflare/disposition.ts`, `files/cloudflare/tickets.ts` and `files/local/route.ts`. Every download now gets `attachment; filename*=UTF-8''<name>`; before, raster images were served `inline` locally. Its planned by-ID compliance run (FILES-AC-003, E2E-009, DEMO-AC-003) was not committed. BV2 covers unit, typecheck, lint, and the template and reference `verify` runs. It does not cover Playwright or `tests/skill`.

| ID | Does the R1/R2 evidence still count? | Why |
| --- | --- | --- |
| FILES-AC-003 | **Yes** | Every tagged test downloads `application/octet-stream` (20 MB, expired ticket) through `fetch`, or only uploads. For non-raster types the header was already `attachment; filename*=…`, so the bytes it sees are unchanged. The route-level unit tests in BV2 cover the new code. |
| E2E-009 | **Yes, provisionally. Re-run.** | The photos are BMPs (raster), so their header did change from `inline` to `attachment`. The download goes through the reference app's same-origin `<a download>` (`apps/reference/src/client/pages/files.ts:34`), and the preview through `<img>`; neither depends on the disposition. The behaviour on the tested path has changed, though, and no committed run covers it. |
| DEMO-AC-003 | **The display clause counts provisionally. Re-run.** | The JPEG now gets `attachment`. The test asserts `<img>` display, and `<img src>` ignores the header. The smoke test's round trip uses `fetch`. Untested, but visible: the demo's photo link (`post-view.ts:19-20`, `target=_blank`) now downloads instead of displaying (DEC-0414). No criterion requires the old behaviour. |

Also checked: SKILL-AC-001 and SKILL-AC-004 still count after the `skill/reference/files.md` edit. The line got shorter (the file is 6,633 B, PAR-071 is 12,000 B), no link changed, and the line is not inside a code block.

**Action:** re-run FILES-AC-003, E2E-009 and DEMO-AC-003 at the current HEAD. The full local run in G1 covers them.

### 4.2 Unit tests 1689 → 1687

`git show cfbd946` accounts for exactly −2:
- `disposition.unit.test.ts`: 14 → 11 (−3). The 8 raster content-type cases (including `IMAGE/PNG` and `image/png; x=y`) and the 4 non-raster type cases became one `it.each` of 9 file names.
- `route.unit.test.ts`: +1 (the new local/Cloudflare parity test).
- `tickets.unit.test.ts`: one test changed, same count.

**This does not weaken anything.** `downloadDisposition(name)` no longer takes a content type, so the removed cases tested an input that no longer exists. The content-type cases that still matter run through the real route and its stored content type: `text/html`, `image/svg+xml`, `application/octet-stream` and `application/pdf` ("served as an attachment", `nosniff`, `CSP: sandbox`), PNG, and JPEG/GIF/WebP/AVIF/BMP all assert `attachment`. The new parity test compares the local route's header with the Cloudflare issuer's signed `response-content-disposition` for `p.png`. The only case gone without a replacement is "the Cloudflare issuer without a content type gives `attachment`", and that parameter was removed.

### 4.3 Skipped tests, weak assertions, mis-tagged tests

- **Skipped:**
  - R2: none (14/14 ran).
  - R1 integration layer: 18 skipped. 16 are Cloud-only tests that report "nothing to run on local" or skip on local (CF, HTTP-AC-005, LOG-AC-004, FILES-AC-005, MIG-AC-006, PROV, SEC further-stage); none of these IDs is Local.
  - The other 2 are untagged positive controls ("complete values files build" for CFG-AC-002, "a valid app name builds" for CORE-AC-007), filtered out by tag. This is C-EV Flag 6 and is **still open**. Each negative test asserts the named key or rule, so no verdict changes.
  - R1 unit layer: 1636 skipped by design (DEC-0319: only unit-level IDs are run there).
- **Weak assertions:**
  - W1. DEMO-AC-001 "paginated": only the page size is shown (`?pageSize=2` gives two posts, newest first). No test pages forward.
  - W2. DEMO-AC-003's non-display clauses and DEMO-AC-001's list clauses rest on the smoke test run inside the E2E-002 test, which is tagged E2E-002/DEMO-AC-010. That test checks only that every smoke result passed; the per-test results were in a deleted scratch copy. S1 gives the per-test results for the same demo tree. Acceptable, but the criterion's own tag does not carry them.
  - W3. DEMO-AC-008 matches an `info` entry by time window and requestId, not by its message.
  - W4. DEMO-AC-007's expiry clause uses a shifted clock rather than the runner's fake timers.
  - None of these changes a verdict.
- **Mis-tagged:** none found. `demo-pages.spec.ts` states that its DEMO-AC-001/-003/-009 tags cover the in-page clauses only. `E2E-002.spec.ts` carries DEMO-AC-010 for exactly the local part of "smoke passes from one commit".

## 5. Root-cause records (prompt §8)

| Record | Diagnosed | Review | Fix and re-check |
| --- | --- | --- | --- |
| e2e-016-r01-portability-notes | yes | agree-with-changes | fix-f04a, re-review PASS |
| e2e-016-r06-raster-inline-disposition | yes | agree-with-changes | fix-f04b (red parity test, then green; BV2), re-review PASS. Compliance re-run not committed (§4.1). |
| demo-ac-009 | yes | **no Review section committed** (F3) | Test fix `c3b407c`, red-green and two non-vacuity checks recorded; passed in R2. |
| F-02 rounds 1, 2, 3 | yes | ACCEPTED (round 1 entry 2 revised; round 3 with fix 1 replaced) | Landed. The round-3 fix is the `demo-pages.spec.ts` and DEC-0393 path. |
| CLI-AC-003-driver-cleanup-failures, compliance-cli-exit-and-pending-stages, COMPL-AC-001-where-parser, SKILL-AC-001/-004 records, E2E-004 (A, B, C revised) | yes | ACCEPTED | Landed; R1 passes the IDs, and E2E-004 is as judged above. |
| D-01, D-03 | yes | pending, with an integrator note pointing to the ACCEPTED D-04 review and fix | Covered (C-EV Flag 5 is addressed by the notes). |
| Earlier phase B/C records | yes | ACCEPTED (B-05's fix came before its review, which the review notes) | As judged at B-EV and C-EV. |

F3: `2026-10-20-demo-ac-009.md` says "Fix (applied after review acceptance)", but no Review section, review branch or review commit exists. The diagnosis is sound on its face: the round-4 demo has no account link, and demo-spec names none. The fix also strengthens the test. Still, §8 step 2 is not recorded, and an independent review should be appended.

## 6. Local gaps and failures needing action

No local criterion is `failed`.

| # | Gap | Action |
| --- | --- | --- |
| G1 | No full local run at one commit since the demo tests (R2 is `--only`), and none since fix-f04b. E2E-004's pass part, and the post-fix FILES-AC-003, E2E-009 and DEMO-AC-003 results, are unshown. | A runner runs one full, unfiltered `npm run compliance -- --target local` (with `verify` online and offline) at the post-F-EV feature-branch HEAD, and commits it. Do G2 first, so that one run settles everything. |
| G2 | The demo's own `verify` has never been run by a runner. CHECK-AC-005's demo part and DEMO-AC-003's warn clause depend on it, and `PHASE_RULES` still excuses CHECK-AC-005's demo part with a stale rule. | A test author (not the demo's builder) adds a tagged `[CHECK-AC-005]` test that runs `verify` on `apps/demo` (as `verify passes on the template` does), and a tagged `[DEMO-AC-003]` local test of the warn clause (or tags the demo test's equivalent in a compliance-layer test). The rule owner (C-02 harness) removes the CHECK-AC-005 demo-part rule from `tests/compliance/harness/expected.ts`. Then G1. |
| G3 | The DEMO-AC-009 root-cause record has no Review (F3). | An independent reviewer appends the Review. |
| G4 | The untagged controls for CFG-AC-002 and CORE-AC-007 are filtered out of driver runs (C-EV Flag 6). | Tag them. Optional; no verdict depends on it. |
| G5 | The milestone passes (E2E-016 review, and E2E-015 once complete) have no evidence record, so the release report shows "no record". The blocked Cloudflare items also have no record (E-EV F6). | Record milestone results as evidence records (`--milestone`, or a record written for the review). When it is confirmed that a `--blocked '*=<D1 detail>'` driver run makes no Cloudflare request (DEC-0261: "nothing is deployed or run"), record the Cloudflare `blocked` set that way. |

Cloudflare (not local): every entry is `blocked`. When the owner allows it after the D1 reset, the order is D-RUN, D-RUN-M, F-03 and then D-EV, each under the plan §1 caps, with before and after D1 readings. E2E-011 (cloud, troubleshooting commands only) and the DEMO cloud parts (including DEMO-AC-008's driver check) go with F-03.

## 7. Confirmed §8 not-run lists

**§8.1 Google login mocked ("Google login mocked for this phase").** Confirmed against `auth.md`, `google.md`, `compliance.md`, `skill.md` and `e2e-scenarios.md`:
- GOOGLE-AC-001 (cloud step-1 part; on Cloudflare the whole automated entry, since the local part runs on local);
- GOOGLE-AC-005 (milestone);
- AUTH-AC-005 (admin-list part, milestone);
- AUTH-AC-009 (cloud production part);
- AUTH-AC-011;
- COMPL-AC-005;
- SKILL-AC-006 (milestone; it needs a real login to be "anonymous after login");
- E2E-006;
- E2E-007 (cloud part, milestone);
- E2E-008 (milestone).

The planner-added **CLI-AC-001 is confirmed for its `certify-auth` part only**. `certify-auth` needs a production stage with a Google client. Every other command's cloud run needs only a test stage, so in this table it is `blocked` (D1), not `not-run` (note N1). I recommend that `PHASE_RULES` make CLI-AC-001 a `part` rule ("certify-auth part"), as C-EV also suggested.

**No missing entries:**
- E2E-005, HTTP-AC-005 and CFG-AC-005 (cloud) use the mock on a test stage.
- No Local criterion needs a real login.

**§8.2 AWS ("AWS phase not started").** Confirmed:
- AWS-AC-001…006;
- the AWS run of every criterion whose Where says cloud (85 AWS entries, all `not-run`);
- the AWS parts inside criteria run here: CORE-AC-002 (AWS start), CORE-AC-006 (AWS bundle; its own `not-run` entry in R1), SQL-AC-003/-004/-005/-006 (Data API; SQL-AC-006's retry loop has its own `not-run` entry in R1), KV-AC-004, SEC-AC-003 (IAM simulation), LOG-AC-001 (AWS deny), PROV-AC-001, PROV-AC-006 (region), E2E-002, E2E-004, E2E-009, E2E-011, E2E-013, E2E-014 and DEMO-AC-010.

No AWS code exists, so no clause was wrongly passed.

**§8.3 Milestone items:**
- **Recorded in this phase:**
  - E2E-016 review: passed (review file; no evidence record, G5).
  - E2E-015: local not-run (G2, G5); cloud blocked.
- **Outstanding with reason:**
  - E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006 (CF part) and COMPL-AC-008: `blocked`. D-RUN-M has not run (D1).
  - GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006 and AUTH-AC-005 admin-list: `not-run`, Google login mocked.
  - All AWS runs: `not-run`, AWS phase not started.

## 8. Release report

The report is generated with `node tests/compliance/tools/report.mjs release --commit 3caff76e7435fd69f33ac325580a04b0b5401fbd` and committed at `validation/release/2026-10-20-3caff76.md`. The format is `renderRelease` (COMPL-REQ-006, DEC-0264), and `--out` is written under `validation/`, where cli.md §2 keeps evidence.

- **Result:** **"not working"**.
- **Why:** COMPL-REQ-006 counts automated records only for the exact commit, and no record exists for `3caff76`, so every automated entry reads "no record for commit".
- **Milestones:** no milestone record exists. That includes the Google certification GOOGLE-AC-005 (none recorded). Every commit since the start of history that touched GOOGLE or login-provider interface files is therefore listed.
- **Evaluator's note:** I appended one below the generated text and marked it as not generated. It says that AWS and the Google certification are outstanding, that Cloudflare is blocked by the D1 stop, and what the local state is.

## 9. Full per-target status table

Status cells give the status and its evidence ref. Evidence refs:
- R1, R2 and S1 are defined at the top.
- DEC-0317 means no Cloudflare record exists because Cloudflare testing is stopped. Every Cloudflare `blocked` has the detail "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset", because every Cloudflare criterion here runs on a deployed test stage or by stage lifecycle, and each of those holds a D1 database.
- §8.1 means "Google login mocked for this phase".
- §8.2 means "AWS phase not started".
- n/a means the Where column does not name that target.

Notes that hold for most rows are given here and not repeated in each row:
- **Local `passed` with R1 and no note:** every tagged test passed in R1, at `8d65a70`. The code it exercises has not changed since, except FILES (§4.1).
- **Cloudflare:** "D-RUN not run", unless the row says otherwise.

| ID | Where | local | cloudflare | aws | Notes |
| --- | --- | --- | --- | --- | --- |
| AUTH-AC-001 | Local | passed (R1) | n/a | n/a |  |
| AUTH-AC-002 | Local | passed (R1) | n/a | n/a |  |
| AUTH-AC-003 | Local | passed (R1) | n/a | n/a |  |
| AUTH-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-005 | Local, cloud; admin-list part: cloud (milestone) | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | L: Contract part. Admin-list part is cloud milestone (Google, §8.1). CF: Contract part `blocked` (D1). Admin-list part (milestone) `not-run`: Google login mocked. |
| AUTH-AC-006 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-007 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| AUTH-AC-008 | Local | passed (R1) | n/a | n/a |  |
| AUTH-AC-009 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | L: Local and test-stage parts; production 404 part is cloud (Google, §8.1). CF: Test-stage part `blocked` (D1). Production part `not-run`: Google login mocked. |
| AUTH-AC-010 | Local | passed (R1) | n/a | n/a |  |
| AUTH-AC-011 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| AUTH-AC-012 | Local | passed (R1) | n/a | n/a |  |
| AWS-AC-001 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-002 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-003 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-004 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-005 | Cloud | n/a | n/a | not-run (§8.2) |  |
| AWS-AC-006 | Cloud | n/a | n/a | not-run (§8.2) |  |
| CF-AC-001 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-002 | Cloud | n/a | blocked (DEC-0317) | n/a |  |
| CF-AC-003 | Local | passed (R1) | n/a | n/a |  |
| CFG-AC-001 | Local | passed (R1) | n/a | n/a |  |
| CFG-AC-002 | Local | passed (R1) | n/a | n/a |  |
| CFG-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-005 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CFG-AC-006 | Local | passed (R1) | n/a | n/a |  |
| CHECK-AC-001 | Local | passed (R1) | n/a | n/a |  |
| CHECK-AC-002 | Local | passed (R1) | n/a | n/a |  |
| CHECK-AC-003 | Local | passed (R1) | n/a | n/a |  |
| CHECK-AC-004 | Local | passed (R1) | n/a | n/a |  |
| CHECK-AC-005 | Local | not-run (R1) | n/a | n/a | L: Template part passed (R1). Demo part: no tagged test. `PHASE_RULES` still records it `not-run` ("demo built in phase F", now stale), and no runner output of `apps/demo` verify is committed (G2). |
| CHECK-AC-006 | Local | passed (R1) | n/a | n/a |  |
| CLI-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | CF: Only the `certify-auth` part needs a production stage (Google, §8.1). The other commands are `blocked` (§8 note N1). |
| CLI-AC-002 | Local | passed (R1) | n/a | n/a |  |
| CLI-AC-003 | Local | passed (R1) | n/a | n/a | L: C-EV Flag 1 closed: 8 tagged driver tests in R1 inject runner and cleanup failures. |
| CLI-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CLI-AC-005 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-002 | Local | passed (R1) | n/a | n/a |  |
| COMPL-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| COMPL-AC-005 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| COMPL-AC-006 | Local | passed (R1) | n/a | n/a |  |
| COMPL-AC-007 | Local | passed (R1) | n/a | n/a |  |
| COMPL-AC-008 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| CORE-AC-001 | Local | passed (R1) | n/a | n/a |  |
| CORE-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| CORE-AC-004 | Local | passed (R1) | n/a | n/a |  |
| CORE-AC-005 | Local | passed (R1) | n/a | n/a |  |
| CORE-AC-006 | Local | passed (R1) | n/a | n/a | L: AWS-bundle clause `not-run` (§8.2), recorded as its own entry in R1. |
| CORE-AC-007 | Local | passed (R1) | n/a | n/a |  |
| CORE-AC-008 | Local | passed (R1) | n/a | n/a |  |
| DEMO-AC-001 | Local, cloud | passed (R2; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Script clause: R2 `demo-pages.spec.ts`. Newest first, drafts hidden and page size: the demo's smoke test, run inside E2E-002 in R2. Weak point W1. |
| DEMO-AC-002 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2 `demo-criteria.spec.ts`. Four identities replay the page's own requests. |
| DEMO-AC-003 | Local, cloud | not-run (R2; S1) | blocked (DEC-0317) | not-run (§8.2) | L: Display (R2), round trip, maximum and delete (smoke inside E2E-002, R2) are shown. The clause "in a local test, a simulated file-deletion failure produces a `warn` entry" is only in `apps/demo/tests/app.test.ts`. That file runs only in `apps/demo` verify, and no runner has run it (G2). The JPEG path also changed with fix-f04b. **Re-run.** |
| DEMO-AC-004 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2. |
| DEMO-AC-005 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2: logout through the page and login again in the same and a new browser. |
| DEMO-AC-006 | Local | passed (R2) | n/a | n/a | L: R2 `demo-local.spec.ts`: values file changed, then `dev` restarted. |
| DEMO-AC-007 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2: altered link through the page; expiry in-process with a shifted clock. |
| DEMO-AC-008 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2: info entries matched by app, severity, requestId and time window (W3). CF: Cloud check by the driver at F-03. |
| DEMO-AC-009 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: R2, after the test fix `c3b407c` (the account link is now optional, and the heading and the shown ID are asserted). The root-cause record has no recorded Review (F3). |
| DEMO-AC-010 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: Local part: R2 `E2E-002.spec.ts` (shared tag). |
| DEMO-AC-011 | Local | passed (R2) | n/a | n/a | L: R2: production values files, then the stub provider in-process. |
| E2E-001 | Local | passed (R1) | n/a | n/a |  |
| E2E-002 | Local, cloud | passed (R2) | blocked (DEC-0317) | not-run (§8.2) | L: Local part only: the smoke test passed from a copy identical to `apps/demo` at `ed1f51b`. CF: F-03 not run. |
| E2E-003 | Local | passed (R1) | n/a | n/a |  |
| E2E-004 | Local, cloud | not-run (R2; R1 (failed)) | blocked (DEC-0317) | not-run (§8.2) | L: Coverage and record parts passed in R2. That was an `--only` run, so the pass part ("every other applicable result passed" in the same record, DEC-0305) cannot be read from it. The last full run, R1, failed. No full run at one commit exists since the demo tests were added (G1). |
| E2E-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-006 | Cloud | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-007 | Local; cloud (milestone) | passed (R1) | not-run (§8.1) | not-run (§8.2) | L: Local part (in-process, stub provider); cloud part milestone, not-run (§8.1). |
| E2E-008 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| E2E-009 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | L: Still counts after fix-f04b (§4.1), but its BMP downloads now get `attachment` instead of `inline` and that path has no committed run. **Re-run.** |
| E2E-010 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-011 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | CF: Must use only the commands in `skill/reference/troubleshooting.md` §1 (E-EV). |
| E2E-012 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| E2E-013 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-014 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| E2E-015 | Local, cloud (milestone) | not-run (BUILD-RECORD; R2) | blocked (DEC-0317) | not-run (§8.2) | L: Round-4 demo (`97dd0d7`, BUILD-RECORD) built from the three inputs. No `FRAMEWORK-ISSUE.md` is open, and every F-02 record is ACCEPTED. Local criteria pass except DEMO-AC-003's warn clause (G2). No milestone record exists (G5). CF: Cloud part of the milestone: F-03 not run. |
| E2E-016 | Local; review: milestone | passed (R1; review) | n/a | n/a | L: Scan part: R1. Review part (milestone): `validation/reviews/E2E-016.md` re-review at `b3e3775`. Checks 1 to 3 pass, R-01 and R-06 are resolved, and R-10 was closed by DEC-0413/0414 (`2d99be2`). No milestone evidence record exists (§6 G5). |
| FILES-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | L: Still counts after fix-f04b (§4.1): its downloads are `application/octet-stream`, whose header did not change, read with `fetch`. In the re-run list as a check. |
| FILES-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| FILES-AC-006 | Local | passed (R1) | n/a | n/a |  |
| GOOGLE-AC-001 | Local, cloud | passed (R1) | not-run (§8.1) | not-run (§8.2) | L: Local part (stubbed `fetch`); cloud step-1 part not-run (§8.1). |
| GOOGLE-AC-002 | Local | passed (R1) | n/a | n/a |  |
| GOOGLE-AC-003 | Local | passed (R1) | n/a | n/a |  |
| GOOGLE-AC-005 | Cloud (manual, milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| HTTP-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| HTTP-AC-006 | Local | passed (R1) | n/a | n/a |  |
| HTTP-AC-007 | Local | passed (R1) | n/a | n/a |  |
| KV-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| KV-AC-005 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOCAL-AC-001 | Local | passed (R1) | n/a | n/a |  |
| LOCAL-AC-002 | Local | passed (R1) | n/a | n/a |  |
| LOCAL-AC-003 | Local | passed (R1) | n/a | n/a |  |
| LOCAL-AC-004 | Local | passed (R1) | n/a | n/a |  |
| LOG-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | CF: On Cloudflare only the local case applies (criterion text); the run is still held. |
| LOG-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-003 | Local | passed (R1) | n/a | n/a |  |
| LOG-AC-004 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| LOG-AC-005 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-001 | Local | passed (R1) | n/a | n/a |  |
| MIG-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| MIG-AC-006 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-001 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| PROV-AC-002 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: The restricted-credential clause also stays `blocked` in this sandbox (DEC-0335, DEC-0363). |
| PROV-AC-003 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. |
| PROV-AC-004 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone; D-RUN-M not run. Its `setup-account` clause needs no D1, but it runs in that pass. |
| PROV-AC-005 | Local | passed (R1) | n/a | n/a |  |
| PROV-AC-006 | Cloud (milestone) | n/a | blocked (DEC-0317) | not-run (§8.2) | CF: Milestone (CF part); D-RUN-M not run. |
| PROV-AC-007 | Local | passed (R1) | n/a | n/a |  |
| SEC-AC-001 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-002 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SEC-AC-004 | Local | passed (R1) | n/a | n/a |  |
| SEC-AC-005 | Cloud | n/a | blocked (DEC-0317) | not-run (§8.2) |  |
| SKILL-AC-001 | Local | passed (R1) | n/a | n/a | L: fix-f04b changed one line of `skill/reference/files.md` after R1. The line got shorter (6,633 B, PAR-071 is 12,000 B) and its links did not change, so R1 still counts. |
| SKILL-AC-002 | Local | passed (R1) | n/a | n/a |  |
| SKILL-AC-003 | Local | passed (R1) | n/a | n/a |  |
| SKILL-AC-004 | Local | passed (R1) | n/a | n/a |  |
| SKILL-AC-005 | Local | passed (R1) | n/a | n/a |  |
| SKILL-AC-006 | Cloud (milestone) | n/a | not-run (§8.1) | not-run (§8.2) |  |
| SQL-AC-001 | Local | passed (R1) | n/a | n/a |  |
| SQL-AC-002 | Local | passed (R1) | n/a | n/a |  |
| SQL-AC-003 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-004 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-005 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) |  |
| SQL-AC-006 | Local, cloud | passed (R1) | blocked (DEC-0317) | not-run (§8.2) | L: Data API retry-loop clause `not-run` (§8.2), recorded as its own entry in R1. |
