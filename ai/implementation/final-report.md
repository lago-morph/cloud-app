# Final report: local and Cloudflare phase (interim)

Date: 2026-10-24 (first written 2026-10-20 at `faced8b`; updates 2026-10-21 at `c016e7e` and 2026-10-24 at `1b474c1`). Base: `origin/claude/implement-local-cloudflare` at `ce53772`. Pull request: https://github.com/lago-morph/cloud-app/pull/5.

**Status: interim.** Local work is complete, and the Cloudflare runs (D-RUN, D-RUN-M, F-03, C-1) are done. Five Cloudflare criteria wait on owner decisions or owner-supplied credentials. The local evidence is current at `1b474c1` (L1 closed). This report is written from committed files only. No test suite was run and no Cloudflare call was made for it.

**Overall verdict: "not working"** (COMPL-REQ-006, prompt §11). Release report: `validation/release/2026-10-24-33b3df7.md`.
- **Local:** 110 of 110 IDs passed (full run `kex4v2xk3522i52` at `1b474c1`, after every phase-D fix, with `verify` passing online and offline at the same commit).
- **Cloudflare:** 67 of 81 IDs passed. 2 failed (FILES-AC-003, SEC-AC-005) and 3 are blocked (PROV-AC-002, PROV-AC-004, LOG-AC-004); all five need the owner (§6.1, §6.2). 9 are `not-run` (Google).
- **AWS:** not started.
- **Google:** the real Google login is not certified.

## 1. Delivery

| Path | What was built |
| --- | --- |
| `packages/framework` | The framework package `@lago-morph/prototype-framework` 0.1.0. Components under `src/`: `core`, `http`, `sql`, `mig`, `kv`, `files`, `config`, `secrets`, `log`, `auth` (mock and stub provider), `google` (offline), `check` (portability lint rules and the migration checker), `build`, `targets/local`, `targets/cloudflare`, `testing` (`createTestApp`, `connectTestStage`), `cli` (local and cloud commands), `provision` (target-neutral core, plus the Cloudflare operations including D1), and `evidence`. Its in-process integration suites are in `test/integration/`. |
| `apps/template` | The smallest app that uses every capability once, with its README of owner tasks. |
| `apps/reference` | The reference app for compliance: a route per capability, the fixtures, and the shared case sets. |
| `apps/demo` | The demo (E2E-015), built in round 4 by a fresh agent from only `skill/`, `apps/template` and `docs/demo/demo-spec.md`. Its record is `apps/demo/BUILD-RECORD.md`. |
| `tests/compliance` | The compliance driver (`harness/`), the report tools (`tools/`), the criteria tests (`criteria/`), including the cloud hooks (`criteria/_cloud/`), and the E2E tests (`e2e/`). |
| `tests/skill` | The skill tests: size budgets, links, structure, hard rules, examples, and the check that no example comes from the demo. |
| `skill/` | `SKILL.md`, 13 references, examples, templates, and the scaffolder (`scripts/scaffold.mjs`). |

**Cloudflare adapter:** implemented (D-01…D-05), unit-tested against stubbed Cloudflare APIs, and now **tested on Cloudflare** in passes 0 to C and F-03 (2026-10-23/24). The live runs led to eight root-cause records. Their fixes (DEC-0421…DEC-0431) landed and were re-checked on Cloudflare, except SEC-AC-005 (owner decision) and the `..` key DELETE (unverified outside the sandbox) (§4). AWS code was not built, because it is out of scope. Google login is mocked.

## 2. Checks

Sources: `ai/implementation/evaluations/final.md` (update 5, base `ce53772`) and `ai/implementation/evaluations/D-cloudflare.md` (the D-EV verdict, update 1). Local evidence R5 is `validation/local/kex4v2xk3522i52.json` at `1b474c1`: one full, unfiltered run with exit 0, with batch verify BV5 (`validation/local/batch-verify-5/`) at the same commit. Cloudflare evidence is 19 driver records and 1 smoke record under `validation/cloudflare/`, at six commits from `93e6d7d` to `ad0e252`; the latest record that selected an ID decides it (DEC-0264).

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 110 | 0 | 0 | 0 (plus 2 §8.2 clause entries inside passed IDs: CORE-AC-006, SQL-AC-006) |
| cloudflare | 81 | 67 | 2 | 3 | 9 (Google login mocked; plus 3 part entries inside passed IDs) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

Cloudflare, notable entries:
- **Failed, owner-dependent:**
  - **FILES-AC-003** (`gblenqeyh7kuls5`): the expired-ticket clause gets status null, because R2 sends no CORS headers on a 403 (DEC-0101, Q4). The other four tests passed.
  - **SEC-AC-005** (`651l3x1zgz7pbx5`): the request right after `secrets set` still saw the old value. Cloudflare rolls a secret change out as a new Worker version over up to a few seconds (DEC-0092); the framework does not cache. The Review says no agent change can pass it honestly (Q12).
- **Blocked:** PROV-AC-002's restricted-token clause (no token supplied, Q13; 4 of 5 tests passed); PROV-AC-004's fresh-account clause (needs an account where `setup-account` never ran; the twice-run part passed); LOG-AC-004's outside-request clause (Q8; the other clauses passed).
- **Superseded failures:** FILES-AC-001 failed in pass 1c (R2 list order) and passed in pass C after DEC-0430. E2E-004's coverage part and AUTH-AC-005 failed or were not-run in pass 1c and passed in pass C after DEC-0429. SEC-AC-001 and HTTP-AC-002 failed in pass 2 and passed in pass C after DEC-0431.
- **Milestones (D-RUN-M):** E2E-010, E2E-012, PROV-AC-003, PROV-AC-006 (CF part) and COMPL-AC-008 passed with milestone records; PROV-AC-004 is blocked as above.
- **Demo on Cloudflare (F-03):** DEMO-AC-001…-005, -007, -008, -009 passed; the demo smoke passed on Cloudflare and locally from one commit with no source difference, which is the Cloudflare part of DEMO-AC-010 and E2E-002. E2E-015's cloud part is met. E2E-002, E2E-004 and DEMO-AC-010 stay unmet as scenarios until AWS passes, and E2E-004's pass part also needs the two failures resolved.
- **E2E-011:** the skill's two troubleshooting `curl` commands found a forced error's log entry by its requestId on Cloudflare. E-EV's open item is closed.
- **Stage removal:** every test stage was removed with no leftovers (every record `leftovers: []`; COMPL-AC-004 passed).
- **E2E-009 after the R2 key fix (C-1, closed):** re-run alone in pass C-1 (`5nfl3uhrzxpuz4m`, `ad0e252`), passed, stage removed with no leftovers (32 D1 rows written, 41 read, 106 API requests).

Local, notable entries:
- **R5 layer counts:** 109 passed and 2 §8.2 clause entries (CORE-AC-006, SQL-AC-006), 0 failed, 0 blocked, exit 0. Playwright 42/42, 0 flaky. Integration 632 tests: 570 passed and 62 skipped (Cloud-only tests, 2 untagged controls G4, and untagged regression and support unit tests that the ID filter skips; the 40 new ones since R4 are phase-D support unit tests that ran in the unit suite). None was skipped to obtain a pass. **Batch verify BV5** at the same commit: online and offline, exit 0, unit 1780/1780.
- **L1 closed:** R5 and BV5 are at `1b474c1`, after every phase-D fix, and R5 ran with the local `apiKey` set (SEC-AC-001 and HTTP-AC-002 passed). R5 repeats R4's result (`pzeugkxrk1xcu2w`, `a5b2164`) ID for ID.
- **MIG-AC-002 failed once**, in R3b (`r5nndia2aediccu`, `760e7b7`); cause unproven (U1), port race fixed (DEC-0417), passed in R4 and R5.
- **DEMO-AC-003:** `passed`, with the weak assertion W5 still open (Q10).
- **E2E-015, E2E-016:** judged `passed` on local, without milestone evidence records (G5). E2E-015 rests on `apps/demo/BUILD-RECORD.md` (round 4) and R5's demo results.
- **L2 (new, minor):** after `1b474c1` only the G6 fix (report tools and their unit tests) and the S-1 skill sentence changed. No committed run covers them yet.

The release report lists every automated entry as "no record for commit", because no record is for `33b3df7` itself. With G6 fixed, it reads the milestone items from the records that ran them: E2E-010, E2E-012, PROV-AC-003, PROV-AC-006 and COMPL-AC-008 have no Cloudflare line (passed), and PROV-AC-004 reads `blocked`. It says "no record" for E2E-015 (local and Cloudflare) and E2E-016 (local), because no `--milestone` record has selected them (G5). Their statuses are judged without one: E2E-015 from BUILD-RECORD plus R5 on local and from F-03's records on Cloudflare. The evaluator's hand-written note at the end of the report says this.

## 3. Spikes

Every spike is in `ai/implementation/spikes/a-NN/RESULT.md`. A-EV (`ai/implementation/evaluations/A.md`) accepted all ten.

| Spike | Result | Decisions |
| --- | --- | --- |
| A-01 Tool auth through the proxy | wrangler and SST/Pulumi both work with a placeholder `CLOUDFLARE_API_TOKEN`, which the proxy replaces. The SST state home is the R2 bucket `sst-state`, and `sst remove` leaves the state objects behind. | DEC-0083, DEC-0084, DEC-0107 |
| A-02 `workers.dev` reachability | Reachable from curl, from Node `fetch` (with `NODE_USE_ENV_PROXY=1`) and from Playwright Chromium. | DEC-0085, DEC-0086 |
| A-03 SST keeps API-set secrets | Kept. A binding named `SECRET_*` would destroy the secret. | DEC-0087, DEC-0088, DEC-0089 |
| A-04 Route off and on without a redeploy | Works. The call must send both `enabled` and `previews_enabled: false`. | DEC-0090, DEC-0091, DEC-0092 |
| A-05 Atomic D1 migration batch | Atomic: one `/query` request is one transaction. | DEC-0093, DEC-0094, DEC-0095 |
| A-06 D1 export/import copy | The native copy fails. The fallback, a page-by-page copy, was applied. | DEC-0096, DEC-0097; PAR-216…PAR-219 |
| A-07 R2 signed URLs, CORS, token | Works if `allHeaders: true` is set, so that `Content-Type` is signed. R2 sends no CORS headers on a 403, which leaves an owner item. | DEC-0098, DEC-0099, DEC-0100, DEC-0101 |
| A-08 Local vs remote D1 limits | Same limits locally and remotely (100 parameters, 100,000 bytes), so no portable limit was added. | DEC-0102; PAR-216, PAR-217 |
| A-09 `sql.d.ts` typing | The approach works. Three declarations were revised (a contract change). | DEC-0103 |
| A-10 Dependency pins | All pins work together. New pins recorded. | DEC-0104, DEC-0105, DEC-0106, DEC-0108, DEC-0109; PAR-111…PAR-118 |

**D1 incident (process failure).** On 2026-10-19 the phase A spikes wrote about 1.22 million D1 rows. The free plan allows 100,000 rows written per day (DEC-0317). Most of it came from A-05's limit probing, for example the 200,000-row insert requests e8 and e9 (`a-05/RESULT.md`, "Size and time limits"). That probing went well beyond any reasonable usage for a framework whose target apps need tens of rows: no binding requirement asked for those limits to be measured. The plan had no usage caps at the time. As a result:
- the plan §1 "Cloud usage limits" were added: per-item and per-day row caps, no limit probing, and D1 readings before and after each cloud item;
- the owner stopped D1 use (DEC-0317);
- every Cloudflare run was held until the owner lifted the stop on 2026-10-23 with new caps (DEC-0418, DEC-0419). The phase-D passes stayed well inside them (§7).

## 4. Failures

These are the records in `ai/implementation/root-causes/`. Verdicts are read from each record's Review section.

| Record | Cause | Review |
| --- | --- | --- |
| 2026-10-19 B-05-pglite-harness-test-timeout | PGlite harness unit test exceeds the 5 s timeout | accepted |
| 2026-10-19 B-17-negative-limit-not-pg-only | Drizzle drops a negative `limit`, so the fixture is not Postgres-only | accepted |
| 2026-10-19 CORE-AC-001-apierrorinit-not-exported | `ApiErrorInit` is reachable from `./client` but not exported | accepted |
| 2026-10-19 HTTP-AC-001-deep-link-relative-script-src | The fixture's relative script URL is rewritten by Vite on deep links | accepted |
| 2026-10-19 MIG-AC-001-seed-literal-ids-fail-framework-ids | Literal IDs in the seed fail the `framework-ids` rule | accepted |
| 2026-10-19 MIG-AC-002-metadata-sqlite-counted-as-d1-database | Miniflare's metadata SQLite file is counted as a D1 database | accepted |
| 2026-10-19 SQL-AC-001-reference-action-not-rejected | A reference action passed to `ref()` is silently ignored | accepted |
| 2026-10-19 template-download-popup | The template's download popup shows an empty URL and body | accepted |
| 2026-10-20 AUTH-AC-007-wrangler-proxy-rewrites-origin-scheme | wrangler's dev proxy rewrites the `Origin` scheme | accepted |
| 2026-10-20 CLI-AC-002-MIG-AC-001-offline-verify-fetch-failed | The migration checker opens both dialect databases at once, giving `fetch failed` offline | accepted |
| 2026-10-20 CLI-AC-003-driver-cleanup-failures | A failing `dev` stop throws out of the driver, and a failed cleanup exits 0 | accepted-with-changes ("ACCEPTED, with the fix requirements below") |
| 2026-10-20 COMPL-AC-001-where-parser-decision-log | The Where reader parses a decision-log table as criteria rows | accepted-with-changes ("ACCEPTED, subject to the fix requirements") |
| 2026-10-20 D-01-unit-timeouts-under-host-load | Unit-test timeouts when the host is loaded | accepted (Review added in `8f3ab0f`; the D-04 fix covers every named test) |
| 2026-10-20 D-03-unit-timeouts-under-load | Unit-test timeouts under load | accepted (Review added in `8f3ab0f`; the D-04 fix covers every named test) |
| 2026-10-20 D-04-verify-unrelated-failures | Unit timeouts under load and a non-hermetic evidence-writer test | accepted-with-changes (fix made concrete; fix in `2026-10-20-verify-fixes.md`) |
| 2026-10-20 E2E-004-coverage-and-not-run | Coverage from a source scan, unit-level IDs missing from the record, missing tags | accepted-with-changes (A accepted; B with conditions; C rejected in part, then the revised C accepted with a condition) |
| 2026-10-20 F-02-round-1-demo-issues | Five demo `FRAMEWORK-ISSUE.md` entries | accepted-with-changes (entry 2 rejected, re-diagnosed, then accepted with additions) |
| 2026-10-20 F-02-round-2-demo-issues | Four demo entries | accepted-with-changes ("ACCEPTED, all four entries, with the fix requirements") |
| 2026-10-20 F-02-round-3-demo-issues | No way to test the demo page in a browser | accepted-with-changes (fix 1 replaced, fixes 2 and 3 amended) |
| 2026-10-20 FILES-AC-003-execution-context-destroyed | A page reload during `addScriptTag` in `dev` | accepted |
| 2026-10-20 FILES-AC-004-dev-vite-default-cors-allows-loopback | Vite's default CORS allows loopback origins | accepted |
| 2026-10-20 SEC-AC-002-depends-on-sec-ac-001 | A test reads state created by other tests in the same file | accepted |
| 2026-10-20 SKILL-AC-001-deploying-missing-example-link | `deploying.md` does not link its example | accepted |
| 2026-10-20 SKILL-AC-004-demo-overlap | The demo kept template files unchanged | accepted |
| 2026-10-20 SKILL-AC-004-example-config-not-typechecked | An example copies a config file that `verify` never reads | accepted |
| 2026-10-20 compliance-cli-exit-and-pending-stages | Runtime exceptions exit with 64; a failed pending-stages write loses the record | accepted |
| 2026-10-20 demo-ac-009 | The clipboard test waits for a link that the page does not have | accepted |
| 2026-10-20 e2e-016-r01-portability-notes | Seven component documents have no portability note | accepted-with-changes ("agree-with-changes") |
| 2026-10-20 e2e-016-r06-raster-inline-disposition | Raster images download `inline`, and local and Cloudflare differ | accepted-with-changes ("agree-with-changes") |
| 2026-10-20 global-unit-timeout-review | Review of the change to a global unit timeout (a review document, not a diagnosis) | accepted |
| 2026-10-20 test-order-dependence-scan | Scan for order-dependent tests: no failures, one `sessions.test.ts` timer-overflow observation | accepted-with-changes (Review added in `8f3ab0f`: main result accepted with its limits; the observation is a real defect with a different cause, which led to the testing-dev-registry record) |
| 2026-10-20 mig-ac-002-workerd-crash | MIG-AC-002 failed in R3b: the no-change deploy's `dev` start died with a workerd fatal at startup. Diagnosed as `dev`'s pick-then-release port race | **not accepted as the proven cause** of that failure (the first fatal line was cut off). Accepted in part: (A) the port race is a proven latent defect, to be fixed race-free; (B) the diagnostic change. Fixed by fix-mig002 (DEC-0417); the cause of the R3b failure stays open (U1) |
| 2026-10-20 testing-dev-registry | `createTestApp` joined the host-wide Miniflare dev registry under a fixed name, so test apps interfered across processes | accepted-with-changes ("ACCEPTED, with the required changes below"). Fixed by fix-registry (DEC-0415) and fix-registry-2 (DEC-0416) |
| 2026-10-20 verify-fixes | The Fix section for the D-04 record (a fix log, not a diagnosis) | n/a (covered by the D-04 Review) |
| 2026-10-23 cloud-test-paths | Cloud test paths found by the pass-schedule estimate: the MIG blocks depended on each other across IDs and set the secret before the first Cloudflare deploy; further stages lacked the D1 and database-count guards; a redundant second `remove`; passes over the request budget | accepted-with-changes ("Accepted with the required changes below", 4 changes). Fixed by fix-cloudtests (DEC-0423…DEC-0426). The split-pass question of item 4 became moot when DEC-0418 raised the per-pass cap: MIG-AC-002/-003/-006 and COMPL-AC-008 each passed in one record |
| 2026-10-23 pass0-F1-r2-api-delete-traversal-403 | The API `DELETE` of an object named `x/../y` got 403 "request rejected: path contains traversal sequence", most likely from the sandbox proxy | accepted-with-changes; "no defect found" holds only for this sandbox. DEC-0422 records the limitation; whether real Cloudflare accepts the path is owner item **Q11**. No `..` key reached `remove` in any pass |
| 2026-10-23 pass0-F2-create-bucket-409-owned | `createBucket` read every 409 as "another account"; the live 409 says "you own it" | accepted-with-changes (4 changes). Fixed by fix-pass0 (DEC-0421, amends DEC-0270) |
| 2026-10-23 pass1-sst-target-not-found | SST 4.17.2 resolves `--target` only against existing state, so step 3 could never succeed on a first deploy; `sst remove` fails on a stage SST does not know | cause confirmed; fix accepted with required changes R1–R4. Fixed by fix-pass1 (DEC-0427). Checked live in pass 1c (DEC-0334 check 10 passed) |
| 2026-10-24 pass1c-E2E-004-AUTH-AC-005-no-cloud-test | AUTH-AC-005's contract part had only in-process tests, which the cloud selection excludes, so E2E-004's coverage part failed | cause accepted; fix approved with changes 1–5. Fixed by fix-auth005 (DEC-0429, owner review open). Both passed in pass C |
| 2026-10-24 pass1c-FILES-AC-001-r2-list-order | R2 ranks the end of a key like a byte between 0x31 and 0x61, so a name lists after its extensions | cause accepted; the first fix was not approved; after the live probe (an addendum to the record), approved with items 1–7. Fixed by fix-r2order (DEC-0430, `proposed`, owner review open, **Q14**). Passed in pass C |
| 2026-10-24 pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early | The test read once, 126 ms after deleting the secret, while Cloudflare still served the previous version | diagnosis confirmed; fix accepted with one required correction (R1). Fixed by fix-sec001 (DEC-0431). Both passed in pass C |
| 2026-10-24 pass2-SEC-AC-005-next-request-version-rollout | A secret change reaches requests through a Worker version rollout of up to seconds; "the next request" cannot be guaranteed on Cloudflare | causal claim confirmed; the deletion clause cannot be met, the `secrets set` clause only probabilistically. **No agent fix:** SEC-AC-005 stays `failed` until the owner decides **Q12** |

**Records without a committed review:** none. Pass 1b's static-asset 401 has no record of its own: the orchestrator confirmed the cause in `validation/cloudflare/pass-1b/SUMMARY.md` (the proxy replaced every `Authorization` header), and the owner removed it (DEC-0420).

**Still open from these records:**
- mig-ac-002-workerd-crash: the cause of the R3b failure is unproven (§6.5, U1). Its integration regression test has no runner output (O2).
- test-order-dependence-scan: the scan covers 29 of 84 integration files (O3, optional).
- pass2-SEC-AC-005: owner decision Q12.
- pass0-F1: real Cloudflare's answer to the `..` DELETE is unverified (Q11).
- pass1c-FILES-AC-001: DEC-0430's visible key ending needs the owner's review (Q14).

## 5. Decisions and design documents

**Decision-log entries added in this run:** DEC-0083…DEC-0431, 349 entries, with no gaps.

| Phase (decision-log heading) | Range | Count |
| --- | --- | --- |
| A spikes | DEC-0083…DEC-0109 | 27 |
| B local foundation | DEC-0110…DEC-0243 | 134 |
| C local compliance | DEC-0244…DEC-0318 | 75 |
| C follow-ups, D Cloudflare, E skill | DEC-0319…DEC-0393 | 75 |
| Follow-ups after E, F demo checks | DEC-0394…DEC-0412 | 19 |
| F-04 fixes for E2E-016 | DEC-0413…DEC-0414 | 2 |
| dev-registry fixes (fix-registry, fix-registry-2) | DEC-0415…DEC-0416 | 2 |
| `dev` port binding fix (fix-mig002) | DEC-0417 | 1 |
| Cloudflare API request budget (owner) | DEC-0418…DEC-0420 | 3 |
| Cloudflare live testing (2026-10-23/24) | DEC-0421…DEC-0431 | 11 |

Entries added since the 2026-10-21 report (DEC-0415…DEC-0417 are described in git history):
- **Owner, accepted:**
  - **DEC-0418:** at most 2,000 Cloudflare API requests per pass and 1,000 in any 5 minutes; stop on the first HTTP 429 (Cloudflare's own limit is 1,200 per 5 minutes).
  - **DEC-0419:** D1 caps from the free plan: per pass ≤ 10,000 rows written and ≤ 500,000 read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read; ≤ 8 databases at once; still no stress tests or row loops. Lifts DEC-0317's stop.
  - **DEC-0420:** the proxy no longer injects a Cloudflare token; a real token comes from `CLOUDFLARE_API_TOKEN`. This fixed pass 1b's static-asset upload 401.
- **AI-proposed, accepted:**
  - **DEC-0421:** a 409 on bucket creation is read back (owned → fine; 403 → foreign; 404 → error), amending DEC-0270.
  - **DEC-0422:** in this sandbox, `remove` cannot delete R2 objects whose names have a `..` segment through the API (Q11).
  - **DEC-0423…DEC-0426:** the MIG criteria as three self-contained blocks with the secret set after the first deploy; the shared stage guards and lock release on every further cloud stage; a removal by another actor cancels the cleanup only when nothing is left; one D1 listing per MIG deploy and batched snapshots.
  - **DEC-0427:** step 3 targets `Files` only when the stage has a database, and `sst remove` runs only when SST has the stage's state (amends DEC-0336).
  - **DEC-0428:** test hooks always send the environment token; PROV-AC-002's restricted-credential clause no longer refuses to run behind the proxy (Q13).
  - **DEC-0431:** the cloud SEC-AC-001 / HTTP-AC-002 test waits, bounded by `CLOUD_WAITS.secretRolloutMs` (60 s), for SEC.MISSING after deleting the secret.
- **Owner review open:**
  - **DEC-0429** (accepted as an assumption): AUTH-AC-005's contract part runs over HTTP on every target; its successful-callback response is a cloud not-run part (added to plan §8.1).
  - **DEC-0430** (`proposed`): on Cloudflare every R2 key is the name plus an invisible U+0001 (below PAR-230 bytes), so R2 lists in code point order (Q14).

**Entries marked "owner review open":** 174 in total (DEC-0429 and DEC-0430 added).

| Phase | Entries |
| --- | --- |
| A (7) | DEC-0086, DEC-0091, DEC-0096, DEC-0103, DEC-0107…0109 |
| B (78) | DEC-0110, DEC-0123, DEC-0134, DEC-0137…0145, DEC-0147…0150, DEC-0179…0190, DEC-0192…0204, DEC-0206…0242 |
| C (44) | DEC-0250…0256, DEC-0266, DEC-0270, DEC-0272, DEC-0277, DEC-0279…0282, DEC-0284…0310, DEC-0313, DEC-0318 |
| C follow-ups, D, E (31) | DEC-0319…0323, DEC-0328, DEC-0329, DEC-0331, DEC-0333, DEC-0335, DEC-0350, DEC-0356, DEC-0357, DEC-0359, DEC-0360, DEC-0362…0365, DEC-0367, DEC-0368, DEC-0371, DEC-0374, DEC-0376, DEC-0380…0382, DEC-0390…0393 |
| F (11) | DEC-0398, DEC-0403…0412 |
| F-04 (1) | DEC-0414 |
| Cloudflare live testing (2) | DEC-0429, DEC-0430 |

Some entries are marked "owner decision outstanding" instead: DEC-0101 (Q4), DEC-0146 (Q6), DEC-0165 (Q7) and DEC-0314 (Q8). Verified live since the last report: DEC-0270's 200, 404 and 409 readings (the 409 reading was wrong and is amended by DEC-0421; the 403 "foreign" reading cannot be produced with one account and stays an assumption); DEC-0356 (SST's `assets` option works); DEC-0334's checks 1–8, 10 and 11 (check 9's direct Worker `DELETE` was not observed: SST deleted the Worker first). DEC-0317's D1 stop is lifted (DEC-0419).

**Design documents changed in this run.** This is `git diff --stat d460045 HEAD -- docs/`. `d460045` (the merge of PR #3) is the parent of this run's first commit, `ebe46b9` "Add implementation plan for local and Cloudflare phase".

| File | Lines changed |
| --- | --- |
| `docs/components/auth.md` | 12 |
| `docs/components/aws.md` | 4 (portability note only) |
| `docs/components/check.md` | 27 |
| `docs/components/cli.md` | 24 (DEC-0417 rewrote one line of the `dev` bullet) |
| `docs/components/cloudflare.md` | 25 |
| `docs/components/compliance.md` | 8 |
| `docs/components/config.md` | 10 |
| `docs/components/core.md` | 8 |
| `docs/components/files.md` | 27 (DEC-0430: the U+0001 key ending in §2 Cloudflare) |
| `docs/components/google.md` | 8 |
| `docs/components/http.md` | 10 |
| `docs/components/kv.md` | 6 |
| `docs/components/local.md` | 12 |
| `docs/components/log.md` | 8 |
| `docs/components/migrations.md` | 29 |
| `docs/components/provisioning.md` | 10 |
| `docs/components/secrets.md` | 15 |
| `docs/components/skill.md` | 13 |
| `docs/components/sql.md` | 26 |
| `docs/contracts/ts/index.d.ts` | 2 (contract) |
| `docs/contracts/ts/sql.d.ts` | 36 (contract, DEC-0103) |
| `docs/contracts/ts/testing.d.ts` | 25 (contract) |
| `docs/decisions/decision-log.md` | 3192 |
| `docs/parameters/parameters.md` | 25 |

In total, 24 files changed: 3490 insertions and 72 deletions. Since the 2026-10-21 report, only `files.md` (DEC-0430), `skill.md` (2 lines) and the decision log changed (diff `c016e7e..1b474c1 -- docs`).

## 6. Open items and owner actions

### 6.1 Owner questions (plan §11)

| Q | Issue | What the owner does |
| --- | --- | --- |
| Q1 | Some Local criteria (skill, demo, E2E-004) were judged at E-EV or F-EV, not at C-EV. | Nothing, if you agree. Otherwise reply: `Q1: object — <reason>`. |
| Q2 | PROV-AC-006 on Cloudflare: the clean-machine part runs; the region part is recorded `not-run` (AWS). | Reply `Q2: confirmed` or `Q2: change — <rule>`. |
| Q3 | No `./targets/aws` subpath until the AWS phase (DEC-0110). | Reply `Q3: confirmed` or `Q3: add the subpath now`. |
| Q4 | FILES-AC-003's expired-ticket clause cannot pass on Cloudflare, because R2 sends no CORS headers on 403 (DEC-0101). **Confirmed live:** it failed in pass 1c and pass C with status null; the other four tests passed. | Reply one of: `Q4: (a) allow status null when storage's response is unreadable cross-origin`, `Q4: (b) check ticket expiry in the browser helper before sending`, `Q4: (c) route transfers through a framework upload service`. |
| Q5 | 174 assumptions marked "owner review open" (§5 above), now including DEC-0429 and DEC-0430. Visible change under DEC-0414: local photo links with `_blank` now download instead of displaying. | Read the entries in `docs/decisions/decision-log.md`. Reply `Q5: accept all`, or `Q5: reject DEC-nnnn — <reason>` for each one you reject. |
| Q6 | KV-AC-002 vs KV-REQ-002 on empty values (DEC-0146). | Reply `Q6: drop "and values" from KV-AC-002`, or `Q6: add an empty-value rule and code to KV-REQ-002`. |
| Q7 | A non-ticket value passed to `uploadFile`/`downloadUrl` fits no FILES-REQ-006 failure class (DEC-0165). | Reply `Q7: add the class "rejected before sending: not an upload/download ticket" to FILES-REQ-006`, or `Q7: use class <name>`. |
| Q8 | LOG-AC-004's "written outside a request" clause cannot be observed (DEC-0314). On Cloudflare it is the only clause of LOG-AC-004 not passed. | Reply `Q8: drop the clause from LOG-AC-004`, or `Q8: support out-of-request entries from <source>`. |
| Q9 | E-T2's readings DEC-0403…DEC-0407 were accepted by the orchestrator. | Reply `Q9: accept`, or `Q9: reject DEC-04nn`. A rejected entry must then remove its test check through its own decision. |
| Q10 | The testing contract cannot fail a deletion of a stored file (W5). | Reply one of: `Q10: (a) add a switchable failure switch`, `Q10: (b) add a seed API`, `Q10: (c) no change, accept W5`. |
| Q11 | In the sandbox, the R2 API refused `DELETE …/objects/x%2F..%2Fy` with 403 "path contains traversal sequence", most likely the egress proxy (DEC-0422). If real Cloudflare refuses it too, `remove` cannot delete valid FILES names with a `..` segment (PROV-REQ-003), and `deleteObjects` needs an S3-DELETE fallback. | On your own machine, in a test bucket you own (`B=<bucket>`), upload a one-byte object named exactly `x/../y` (for example through the dashboard), then run `curl -sS -i -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$B/objects/x%2F..%2Fy" \| head -20`. Reply `Q11: real Cloudflare answered <status>, Server <value>, cf-ray <present/absent>, body <first line>`, or `Q11: the proxy operators confirm the filter`. |
| Q12 | SEC-AC-005 fails on Cloudflare: after `secrets set`, the next request can still be served by the previous Worker version (rollout of up to seconds, DEC-0092); after a direct store deletion it is still 200. No framework change can make "the next request" true for the deletion clause. | Reply one of: `Q12: (A) amend SEC-AC-005 to "within <N> s, and <M> consecutive requests after that"` (recommended; for example `N = 60` (`CLOUD_WAITS.secretRolloutMs`), `M = 5`; supersedes DEC-0280's SEC-AC-005 bullet); `Q12: (A) plus (B) — also make secrets set wait until the stage serves the new version` (best effort, more requests per `secrets set`); `Q12: (C) move Cloudflare secrets to a read-after-write store` (changes SEC-REQ-003/-005; not recommended). |
| Q13 | PROV-AC-002's clause "a credential that lacks the permission to create R2 API tokens" is `blocked`: no such token was supplied (DEC-0428). The other four PROV-AC-002 tests passed. | Either create a second API token with the same permissions as the run token except the one that creates API tokens (Account API Tokens: Edit), and give it to the next run as the environment variable `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION` (never pasted into chat, logs or files), then reply `Q13: token provided`; or reply `Q13: accept blocked, unit tests only`. |
| Q14 | DEC-0430 (`proposed`): on Cloudflare every R2 key is the file name plus an invisible U+0001, so R2 lists in FILES-REQ-001's code point order. You would see the ending in the R2 dashboard and `wrangler r2 object get`; a lookup by the plain name finds nothing; S3 tools must list with `encoding-type=url`. | Reply `Q14: accept the U+0001 ending` or `Q14: change FILES-REQ-001 to the platform's order and drop DEC-0430`. |
| — | PROV-AC-004's clause "deploying without `setup-account` fails with a clear message" needs an account where `setup-account` never ran (DEC-0364). | Reply `PROV-AC-004: accept blocked`, or provide a second, empty Cloudflare account for one run with `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1`. |

### 6.2 Cloudflare criteria not passed

Detail per ID: `ai/implementation/evaluations/D-cloudflare.md` §7.

| ID | Status | Record | Why | Owner item |
| --- | --- | --- | --- | --- |
| FILES-AC-003 | failed | `gblenqeyh7kuls5` (pass C) | Expired-ticket clause: status null, no CORS headers on R2's 403 | Q4 |
| SEC-AC-005 | failed | `651l3x1zgz7pbx5` (pass C) | Version rollout after `secrets set` | Q12 |
| PROV-AC-002 | blocked | `5swm2wowq7t3yho` (pass B) | Restricted-token clause: token not supplied | Q13 |
| PROV-AC-004 | blocked | `sysad9rajoir4yt` (pass 1c, milestone) | Fresh-account clause | row "—" in §6.1 |
| LOG-AC-004 | blocked | `cwcrlz8fxgo3ud4` (pass 2) | Outside-request clause: nothing writes outside a request | Q8 |

**Not a criterion, still unverified:** DEC-0270's 403 "foreign bucket" reading (one account cannot produce it).

**After the owner answers:** a test author changes the affected test (Q4, Q12), and a runner re-runs only those IDs on one Cloudflare stage, under the plan §1 caps with D1 readings before and after. One stage lifecycle (deploy, `secrets set`, redeploy, `remove`) counted about 90 API requests plus SST's own and wrote under 50 D1 rows; pass C counted 207 requests for 10 IDs. The release report can only say "working" after AWS and Google, so these re-runs do not change the overall verdict.

### 6.3 Google criteria (`not-run`, "Google login mocked for this phase")

**IDs:**
- whole criteria: GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud part) and E2E-008. Every Cloudflare record confirms them;
- parts of criteria: AUTH-AC-005 (admin-list part, and the successful-callback part on cloud, DEC-0429) and AUTH-AC-009 (production part);
- CLI-AC-001 on Cloudflare: the driver records the whole ID as `not-run` (its `certify-auth` row needs a production stage), and no Cloudflare test is tagged with it.

**Owner action:** nothing in this phase. In a later phase, follow the Google OAuth client setup in `skill/reference/owner-tasks.md`, which was written but never executed:
1. Create the client.
2. Register the callback.
3. Put the client ID in the production values file and the secret through `secrets set`.
4. Run `certify-auth` on a production stage.

This phase creates no production stage and no Google client (prompt §4).

### 6.4 AWS

Every AWS entry is `not-run` ("AWS phase not started"): 85 IDs, including AWS-AC-001…-006 and the AWS parts of the criteria run here. **Owner action:** start the AWS phase with its own prompt. The framework cannot be called "working" before that phase passes and Google is certified.

### 6.5 Items from final.md

| Item | What | What to do |
| --- | --- | --- |
| **U1** | **The cause of MIG-AC-002's failure in R3b (`r5nndia2aediccu`, `760e7b7`) is unproven.** The visible workerd frames fit a port-bind error but also any other startup fatal or crash signal; the first line was cut off, and the run was not repeated. The port race was fixed as a confirmed defect (DEC-0417), and MIG-AC-002 passed in R4 and again in R5 (`kex4v2xk3522i52`). Clean runs cannot confirm the cause. | Agent work, no owner action. **Evidence that would settle it:** the first fatal line of workerd's stderr from a recurrence. The MIG deploy messages now keep it (`failureOutput`), so any recurrence in a later full run is self-diagnosing; or a runner can do the next full local run under the root-cause record's `MINIFLARE_WORKERD_PATH` wrapper, which stores every workerd's full stderr and arguments. A fatal that is not `bind(): Address already in use` sends the record back to §8 step 1. |
| O2 | fix-mig002's integration regression test (`test/integration/local/dev.test.ts`, "serves even when every port freePort returns is taken …") is untagged and not in `verify`, so no committed runner output covers it; only the fixer's red-green does. | Agent work: run it in the next batch, or tag it. No owner action. |
| L2 | The G6 fix (`tests/compliance/harness/catalogue.ts`, `driver.ts`, `tools/release.ts`, `tools/traceability.ts` and their unit tests) and the S-1 sentence in `skill/reference/troubleshooting.md` came after R5 and BV5 (`1b474c1`), so no committed run covers them. | Agent work: the next batch `verify` at the head, online and offline. No criterion status depends on it. No owner action. |
| O3 | The order-dependence scan covers 29 of 84 integration files. | Optional: the shuffle runs the accepted record names (`kv/*`, `sql/*`, `files/server-operations`, `local/dev`). No owner action. |
| W1 | DEMO-AC-001 "paginated": only the page size is shown. | Optional: a test author adds a check of the next page. No owner action. |
| W2 | The smoke-test clauses of DEMO-AC-001 and -003 count through E2E-002's tag. | None (accepted). |
| W3 | DEMO-AC-008 matches its `info` entry by time window and requestId, not by message. | Optional test strengthening. No owner action. |
| W4 | DEMO-AC-007's expiry clause uses a shifted clock. | None (accepted). |
| W5 | DEMO-AC-003's warn-clause test cannot delete a stored photo. | Answer Q10. A test author then strengthens the test, and a runner re-runs it. |
| G4 | The untagged controls for CFG-AC-002 and CORE-AC-007 are filtered out of driver runs. | Optional: tag them. No owner action. |
| G5 | E2E-015 (local and cloud parts) and E2E-016 (review part) have no milestone evidence record. | Agent work: record the milestones with `--milestone`, or write a record for the review. No owner action. |

Closed on 2026-10-24 (final.md update 5): **L1** (full local run `kex4v2xk3522i52` and batch verify 5 at `1b474c1`), **C-1** (E2E-009 passed on Cloudflare after fix-r2order, `5nfl3uhrzxpuz4m`), **G6** (release and traceability reports skip not-selected entries, `33b3df7`; report regenerated as `validation/release/2026-10-24-33b3df7.md`) and **S-1** (the troubleshooting page calls the two `curl` commands verified). No Cloudflare agent run is outstanding; the remaining Cloudflare items are the owner's (§6.1, §6.2).

Closed since the first version of this report: O1 (`expected.unit.test.ts` ran in BV3 and BV4), and the missing Reviews of the D-01, D-03 and order-scan records (`8f3ab0f`). Closed by the Cloudflare runs: E-EV's open item for E2E-011 on Cloudflare (the troubleshooting check passed) and the missing record of the Cloudflare `blocked` set (G5's second half; real records exist now).

## 7. Costs

**Account state per the last listings** (`validation/cloudflare/f-03/logs/measure/*-3-after-remove.json`, 2026-10-24 06:07 UTC, after F-03's `remove`):

| Resource | State | Billable |
| --- | --- | --- |
| R2 bucket `prototype-logs` (shared logs) | Present, created by `setup-account` in pass 0. Holds the test stages' log entries, small JSON objects that stay after `remove` by design. | Yes, near zero (a few kilobytes to megabytes of storage) |
| R2 bucket `sst-state` (SST state home) | Present, created in pass 0. Empty (0 objects). | Yes, near zero (empty) |
| Workers | None | — |
| D1 databases | None | — |
| Test stages (`test-*`), spike resources | None. Every phase-D stage was removed (D-cloudflare §3); every driver record has `leftovers: []`. | — |
| API tokens | Not listed since pass 0, when only the account's two own tokens existed. Stage R2 tokens are deleted by `remove` and covered by the leftover check; the tests' read-only `compliance-r2read-*` tokens expire after 30 minutes. | No (tokens are free) |

So the two shared buckets are the only billable resources, both at near-zero cost, and both stay by design (plan §10.6).

**Cloudflare usage on the testing days** (account-wide D1 readings from GraphQL `d1AnalyticsAdaptiveGroups` for the UTC day; requests as counted by the runners, without SST/Pulumi's own calls, which were not traced):

| Day (UTC) | Work | D1 rows written | D1 rows read | API requests counted | Peak D1 databases |
| --- | --- | --- | --- | --- | --- |
| 2026-10-23 | pass 0 (`setup-account`, live checks), pass 1, pass 1b, cleanup-R | 32 | 17 | ≈ 176 | 1 |
| 2026-10-24 | passes 1c, 2–5, B, M, the R2 order probe, C, F-03 | 2,080 | 5,665 | ≈ 2,770 | 2 |
| **Total** | | **2,112** | **5,682** | **≈ 2,950** | |
| Cap (DEC-0418, DEC-0419) | | ≤ 50,000 per day | ≤ 2,500,000 per day | ≤ 2,000 per pass, ≤ 1,000 per 5 min | ≤ 8 |

The largest pass (pass M) counted 1,018 requests, at most 268 in any 5 minutes. No pass got an HTTP 429. D1 usage was about 2 % of the free plan's daily rows written (100,000) and 0.1 % of rows read (5,000,000). API requests are not billed. Workers and R2 operations stayed within the free allowances by a wide margin (tens of deploys and a few hundred object operations), but no Workers or R2 usage was measured.

Pass C-1 (E2E-009 re-run) came after these readings, on 2026-10-24: 32 D1 rows written, 41 read, 106 API requests (at most 78 in 5 minutes), peak 1 D1 database, no HTTP 429. Afterwards the account held 0 Workers, 0 D1 databases, 0 `sst-state` objects and only the two shared R2 buckets (`validation/cloudflare/pass-C1/SUMMARY.md`), so the account state above is unchanged.

**Owner check (optional):**
- Dashboard: Storage & databases → R2 (expect only `prototype-logs` and `sst-state`), Workers & Pages (expect no Workers), D1 (expect none), My Profile → API Tokens (expect no `compliance-*`, `spike*` or per-stage tokens).
- Or, with your own token:
  ```
  npx wrangler d1 list
  npx wrangler r2 bucket list
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts"
  ```
- To remove the shared buckets after the project (they are needed for any further cloud run): empty `prototype-logs`, then delete both buckets in the dashboard.
