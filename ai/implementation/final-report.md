# Final report: local and Cloudflare phase (interim)

Date: 2026-10-21 (first written 2026-10-20 at `faced8b`). Base: `origin/claude/implement-local-cloudflare` at `c016e7e`. Pull request: https://github.com/lago-morph/cloud-app/pull/5.

**Status: interim.** Local work is complete. Cloudflare testing is stopped, and the Cloudflare checks have not run. This report is written from committed files only. No test suite was run and no Cloudflare call was made for it.

**Overall verdict: "not working"** (COMPL-REQ-006, prompt §11). Release report: `validation/release/2026-10-21-c016e7e.md`.
- **Local:** 110 of 110 IDs passed (full run `pzeugkxrk1xcu2w` at `a5b2164`). MIG-AC-002 failed once in the run before it; the cause is unproven (§6.5, U1).
- **Cloudflare:** no criterion has passed. 73 are `blocked` and 8 are `not-run` (Google).
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

**Cloudflare adapter:** implemented (D-01…D-05) and unit-tested against stubbed Cloudflare APIs. It has **not** been tested in the cloud. AWS code was not built, because it is out of scope. Google login is mocked.

## 2. Checks

Source: `ai/implementation/evaluations/final.md` (F-EV3, base `c016e7e`). Local evidence R4 is `validation/local/pzeugkxrk1xcu2w.json` at `a5b2164` (logs in `validation/local/final-local-4/`): one full, unfiltered run with exit 0. The base differs from `a5b2164` only in `validation/`.

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| local | 110 | 110 | 0 | 0 | 0 (plus 2 §8.2 clause entries inside passed IDs: CORE-AC-006, SQL-AC-006) |
| cloudflare | 81 | 0 | 0 | 73 | 8 (Google login mocked) |
| aws | 85 | 0 | 0 | 0 | 85 (AWS phase not started) |

Notable entries:
- **R4:** 109 of the local IDs passed in R4. The 110th, E2E-015, is a milestone judged from BUILD-RECORD plus R4.
- **R4 layer counts:** Playwright 42/42, 0 flaky. Integration 586 tests: 564 passed and 22 skipped. The 22 are 16 Cloud-only tests, the 2 untagged controls (G4), and 4 untagged regression tests added by fix-mig002 (one `dev.test.ts` port test, O2, and three `failure-output.unit.test.ts` tests, which passed in BV4). None was skipped to obtain a pass: they are left out by the driver's ID filter, and every tagged MIG-AC-002 test ran and passed. Unit-level criteria 53 passed.
- **Batch verify BV4** (`validation/local/batch-verify-4/`, `a5b2164`, the same commit as R4): online and offline, exit 0. Unit 1706/1706, template 18/18, reference 52/52 per dialect, skill example pages 2/2.
- **MIG-AC-002 failed once**, in the previous full run R3b (`validation/local/r5nndia2aediccu.json`, `760e7b7`, 108 passed, 1 failed, exit 1): the no-change deploy's `dev` start died with a workerd fatal at startup, and the first line of the error was cut off. The cause is **unproven**. A confirmed `dev` port race of the same signature was fixed (fix-mig002, DEC-0417), the test messages now keep the first fatal line, and MIG-AC-002 passed in R4. Open item U1 (§6.5).
- **DEMO-AC-003:** `passed`, with the weak assertion W5 still open (owner question Q10).
- **E2E-002, E2E-004, DEMO-AC-010:** only their local parts pass. The scenarios are not met until the Cloudflare and AWS runs pass.
- **E2E-015, E2E-016:** judged `passed` on local, but neither has a milestone evidence record (G5). The release report therefore cannot see them.
- **Every Cloudflare `blocked`** carries the detail "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset" (DEC-0317).

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
- every Cloudflare run since has been held.

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

**Records without a committed review:** none. The D-01, D-03 and order-scan Reviews landed in `8f3ab0f`.

**Still open from these records:**
- mig-ac-002-workerd-crash: the cause of the R3b failure is unproven (§6.5, U1). Its integration regression test has no runner output (O2).
- test-order-dependence-scan: the scan covers 29 of 84 integration files (O3, optional).

## 5. Decisions and design documents

**Decision-log entries added in this run:** DEC-0083…DEC-0417, 335 entries, with no gaps.

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

The three new entries, all `accepted` and none marked "owner review open":
- **DEC-0415:** a test app never joins Wrangler's local dev registry (refines DEC-0105).
- **DEC-0416:** one registry-free platform-proxy helper (`targets/local/platform-proxy.ts`) for `createTestApp`, the migration checker and the fake D1 API, each with a guard test.
- **DEC-0417:** `dev` binds its ports itself: Vite first on port 0, then Wrangler on port 0 for the Worker and the inspector, with the real ports read back; a bounded retry on Vite's structured `EADDRINUSE` only (refines DEC-0204).

**Entries marked "owner review open":** 172 in total (unchanged; DEC-0415…DEC-0417 add none).

| Phase | Entries |
| --- | --- |
| A (7) | DEC-0086, DEC-0091, DEC-0096, DEC-0103, DEC-0107…0109 |
| B (78) | DEC-0110, DEC-0123, DEC-0134, DEC-0137…0145, DEC-0147…0150, DEC-0179…0190, DEC-0192…0204, DEC-0206…0242 |
| C (44) | DEC-0250…0256, DEC-0266, DEC-0270, DEC-0272, DEC-0277, DEC-0279…0282, DEC-0284…0310, DEC-0313, DEC-0318 |
| C follow-ups, D, E (31) | DEC-0319…0323, DEC-0328, DEC-0329, DEC-0331, DEC-0333, DEC-0335, DEC-0350, DEC-0356, DEC-0357, DEC-0359, DEC-0360, DEC-0362…0365, DEC-0367, DEC-0368, DEC-0371, DEC-0374, DEC-0376, DEC-0380…0382, DEC-0390…0393 |
| F (11) | DEC-0398, DEC-0403…0412 |
| F-04 (1) | DEC-0414 |

Some entries are marked "owner decision outstanding" instead: DEC-0101 (Q4), DEC-0146 (Q6), DEC-0165 (Q7) and DEC-0314 (Q8). Some entries are unverified until D-RUN, for example DEC-0270 and DEC-0317.

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
| `docs/components/files.md` | 26 |
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
| `docs/decisions/decision-log.md` | 2990 |
| `docs/parameters/parameters.md` | 25 |

In total, 24 files changed: 3287 insertions and 72 deletions. Since the first version of this report, `core.md` §2 "Testing" (DEC-0415/0416), `check.md` §3 "Uses" (DEC-0416), `cli.md` §2 and `local.md` §2 (DEC-0417) changed.

## 6. Open items and owner actions

### 6.1 Owner questions (plan §11)

| Q | Issue | What the owner does |
| --- | --- | --- |
| Q1 | Some Local criteria (skill, demo, E2E-004) were judged at E-EV or F-EV, not at C-EV. | Nothing, if you agree. Otherwise reply: `Q1: object — <reason>`. |
| Q2 | PROV-AC-006 on Cloudflare: the clean-machine part runs; the region part is recorded `not-run` (AWS). | Reply `Q2: confirmed` or `Q2: change — <rule>`. |
| Q3 | No `./targets/aws` subpath until the AWS phase (DEC-0110). | Reply `Q3: confirmed` or `Q3: add the subpath now`. |
| Q4 | FILES-AC-003's expired-ticket clause cannot pass on Cloudflare, because R2 sends no CORS headers on 403 (DEC-0101). | Reply one of: `Q4: (a) allow status null when storage's response is unreadable cross-origin`, `Q4: (b) check ticket expiry in the browser helper before sending`, `Q4: (c) route transfers through a framework upload service`. |
| Q5 | 172 assumptions marked "owner review open" (§5 above). Visible change under DEC-0414: local photo links with `_blank` now download instead of displaying. | Read the entries in `docs/decisions/decision-log.md`. Reply `Q5: accept all`, or `Q5: reject DEC-nnnn — <reason>` for each one you reject. |
| Q6 | KV-AC-002 vs KV-REQ-002 on empty values (DEC-0146). | Reply `Q6: drop "and values" from KV-AC-002`, or `Q6: add an empty-value rule and code to KV-REQ-002`. |
| Q7 | A non-ticket value passed to `uploadFile`/`downloadUrl` fits no FILES-REQ-006 failure class (DEC-0165). | Reply `Q7: add the class "rejected before sending: not an upload/download ticket" to FILES-REQ-006`, or `Q7: use class <name>`. |
| Q8 | LOG-AC-004's "written outside a request" clause cannot be observed (DEC-0314). | Reply `Q8: drop the clause from LOG-AC-004`, or `Q8: support out-of-request entries from <source>`. |
| Q9 | E-T2's readings DEC-0403…DEC-0407 were accepted by the orchestrator. | Reply `Q9: accept`, or `Q9: reject DEC-04nn`. A rejected entry must then remove its test check through its own decision. |
| Q10 | The testing contract cannot fail a deletion of a stored file (W5). | Reply one of: `Q10: (a) add a switchable failure switch`, `Q10: (b) add a seed API`, `Q10: (c) no change, accept W5`. |

### 6.2 Blocked Cloudflare criteria

**Blocked (73):**

AUTH-AC-004, -005, -006, -007, -009; CF-AC-001, -002; CFG-AC-003, -004, -005; CLI-AC-001, -004, -005; COMPL-AC-001, -003, -004, -008; CORE-AC-002, -003; DEMO-AC-001, -002, -003, -004, -005, -007, -008, -009, -010; E2E-002, -004, -005, -009, -010, -011, -012, -013, -014, -015; FILES-AC-001…-005; HTTP-AC-001…-005; KV-AC-001…-005; LOG-AC-001, -002, -004, -005; MIG-AC-002, -003, -006; PROV-AC-001, -002, -003, -004, -006; SEC-AC-001, -002, -003, -005; SQL-AC-003…-006.

**Always `blocked` in this sandbox, even after the runs:**
- DEC-0270's 403 "foreign bucket" reading;
- PROV-AC-002's restricted-credential clause (DEC-0335, DEC-0363);
- PROV-AC-004's "deploy without `setup-account`" clause (DEC-0364);
- LOG-AC-004's outside-request clause (Q8).

**Owner action:**
1. Check D1 usage for today. In the dashboard: Workers & Pages → D1 → Metrics (rows written and read today). Or run this on your own machine with your own token. The query shape is from plan §1; it was not run for this report.
   ```
   curl -sS https://api.cloudflare.com/client/v4/graphql \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
     -d '{"query":"query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){d1AnalyticsAdaptiveGroups(limit:100,filter:{date:$d}){sum{rowsRead rowsWritten}}}}}","variables":{"a":"'"$CLOUDFLARE_ACCOUNT_ID"'","d":"'"$(date -u +%F)"'"}}'
   ```
2. Check the D1 database count (account limit 10, PAR-219): Workers & Pages → D1, or `npx wrangler d1 list`.
3. Reply: `go ahead with Cloudflare runs`.

**Planned Cloudflare pass sequence once allowed** (plan §1, §5). Every pass is under the caps:
- per item: ≤ 1,000 D1 rows written, ≤ 10,000 rows read, ≤ 500 Cloudflare API requests and ≤ 2 D1 databases at once;
- for the whole run: ≤ 10,000 rows written per UTC day;
- every pass takes D1 readings before and after.

| # | Pass | Estimate |
| --- | --- | --- |
| 0 | `setup-account --target cloudflare` (once) and DEC-0334's 11 live checks | 3 requests (up to 6 when creating); the live checks take < 30 requests |
| 1 | D-RUN main pass: every expected ID except MIG-AC-002, -003, -006, on one `test-<id>` stage plus at most one further stage at a time | Per stage ≈ 215–370 API requests including SST, < 60 D1 rows written, 1 database. C-T2's tests ≈ 350 rows (≤ 700 with indexes), < 2,000 read, 100–150 requests. D-T1's main pass ≈ 145 written / 80 read / 315 requests. |
| 2 | D-RUN MIG pass, run after pass 1's stage is removed: MIG-AC-002, -003, -006 and PROV-AC-002, with no run stage | ≈ 110 written / 100 read / 245 requests; 2 databases |
| 3 | D-RUN-M: E2E-010 in its own pass | 2 databases |
| 4 | D-RUN-M: E2E-012 in its own pass | 2 databases |
| 5 | D-RUN-M: PROV-AC-003, -004, -006 | ≈ 380 requests |
| 6 | D-RUN-M: COMPL-AC-008 alone | ≈ 260 written / 150 read / 420 requests |
| 7 | F-03: deploy the demo to `test-<id>`; then `smoke --target cloudflare`, the DEMO-AC-008 driver check, E2E-011 cloud (using only the commands in `skill/reference/troubleshooting.md` §1), and `remove` | Per stage as in pass 1; F-03 writes its own estimate before it starts |
| 8 | D-EV, then the release report again | No cloud usage |

Start the driver as `NODE_USE_ENV_PROXY=1 npm run compliance -- --target cloudflare …` (DEC-0349, DEC-0357).

Also still open before the SEC, HTTP and CORE criteria that need it: the driver's `apiKey` handling (DEC-0277, DEC-0366, DEC-0398).

### 6.3 Google criteria (`not-run`, "Google login mocked for this phase")

**IDs:**
- whole criteria: GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud part) and E2E-008;
- parts of criteria: AUTH-AC-005 (admin-list part), AUTH-AC-009 (production part) and CLI-AC-001 (`certify-auth` part).

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
| **U1** | **The cause of MIG-AC-002's failure in R3b (`r5nndia2aediccu`, `760e7b7`) is unproven.** The visible workerd frames fit a port-bind error but also any other startup fatal or crash signal; the first line was cut off, and the run was not repeated. The port race was fixed as a confirmed defect (DEC-0417), and MIG-AC-002 passed in R4. One clean run cannot confirm the cause. | Agent work, no owner action. **Evidence that would settle it:** the first fatal line of workerd's stderr from a recurrence. The MIG deploy messages now keep it (`failureOutput`), so any recurrence in a later full run is self-diagnosing; or a runner can do the next full local run under the root-cause record's `MINIFLARE_WORKERD_PATH` wrapper, which stores every workerd's full stderr and arguments. A fatal that is not `bind(): Address already in use` sends the record back to §8 step 1. |
| O2 | fix-mig002's integration regression test (`test/integration/local/dev.test.ts`, "serves even when every port freePort returns is taken …") is untagged and not in `verify`, so no committed runner output covers it; only the fixer's red-green does. | Agent work: run it in the next batch, or tag it. No owner action. |
| O3 | The order-dependence scan covers 29 of 84 integration files. | Optional: the shuffle runs the accepted record names (`kv/*`, `sql/*`, `files/server-operations`, `local/dev`). No owner action. |
| W1 | DEMO-AC-001 "paginated": only the page size is shown. | Optional: a test author adds a check of the next page. No owner action. |
| W2 | The smoke-test clauses of DEMO-AC-001 and -003 count through E2E-002's tag. | None (accepted). |
| W3 | DEMO-AC-008 matches its `info` entry by time window and requestId, not by message. | Optional test strengthening. No owner action. |
| W4 | DEMO-AC-007's expiry clause uses a shifted clock. | None (accepted). |
| W5 | DEMO-AC-003's warn-clause test cannot delete a stored photo. | Answer Q10. A test author then strengthens the test, and a runner re-runs it. |
| G4 | The untagged controls for CFG-AC-002 and CORE-AC-007 are filtered out of driver runs. | Optional: tag them. No owner action. |
| G5 | E2E-015 and E2E-016 (review part) have no milestone evidence record, and the Cloudflare `blocked` set has no record. | Agent work: record the milestones with `npm run compliance -- --target local --milestone`, or write a record for the review. Record the `blocked` set once a `--blocked` run is confirmed to make no Cloudflare request (DEC-0261). No owner action. |

Closed since the first version of this report: O1 (`expected.unit.test.ts` ran in BV3 and BV4), and the missing Reviews of the D-01, D-03 and order-scan records (`8f3ab0f`).

## 7. Costs

The list below comes from the spike records, the evaluation records and plan §10.6. **It has not been checked against the account today.**

| Resource | Status per records |
| --- | --- |
| Spike resources (Workers, KV, R2 buckets, D1 databases, R2 token) | None left. Every spike's RESULT.md records zero leftovers. |
| `sst-state` R2 bucket (SST state home) | Stays by design once created. A-01 and A-03 created it, then emptied and deleted it. Per records it does not exist now; the first `setup-account` or SST deploy creates it again. |
| `prototype-logs` R2 bucket (shared logs) | Stays by design once created. Per records it was never created, because `setup-account` has not run. |
| Test stages (`test-*`) | None. No D-RUN, E-RUN cloud or F-03 stage was created, and no `validation/cloudflare/` record exists. |

**Owner check:**
- Dashboard: Workers & Pages (Workers and D1), R2 Object Storage (buckets), and My Profile → API Tokens (tokens named `spike*` or per stage).
- Or, with your own token:
  ```
  npx wrangler d1 list
  npx wrangler r2 bucket list
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts"
  ```
- Expected: no `spike*` or `test-*` resources.
