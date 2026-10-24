# D-EV: Phase D exit check on Cloudflare

**Update 1 (D-EV5), 2026-10-24.** Base: `origin/claude/implement-local-cloudflare` at `ce53772` ("Batch verify 5 / final local 5 summaries"). Branch: `claude/implement-local-cloudflare-ev5`. A different independent evaluator subagent; I wrote none of the code, evidence or reviews judged here, ran no test suite and made no Cloudflare call. I ran `npm ci` and the read-only generator `node tests/compliance/tools/report.mjs release --commit 33b3df7…` only to confirm that the committed release report is its unedited output (it is, byte for byte). What this update changes:
- **C-1 closed.** E2E-009 re-ran on Cloudflare after fix-r2order: pass C-1, record `5nfl3uhrzxpuz4m` at `ad0e252`, stage `test-aufdf24vgdoqnph`, `--only E2E-009` **passed** (34.1 s), `leftovers: []`, stage removed (0 Workers, 0 D1 databases, 0 `sst-state` objects afterwards; `pass-C1/SUMMARY.md`). `git diff 1b474c1 ad0e252 -- packages apps tests skill` is empty, so the record is at the code of the base judged below. The record's only other selected entries are the five whole-ID §8.1 entries (AUTH-AC-011, CLI-AC-001, COMPL-AC-005, E2E-006, GOOGLE-AC-001, "Google login mocked for this phase"); they now are the newest record for those IDs and their status is unchanged (`not-run`). Usage: 32 D1 rows written, 41 read, 106 API requests, at most 78 in 5 minutes, no HTTP 429.
- **G6 closed.** Fix `33b3df7`: `harness/catalogue.ts` exports `NOT_SELECTED` and `selectedEntries`; `release.ts` (both lookups and `summary()`) and `traceability.ts` (`describeResults`) skip a "not selected for this run (--only)" entry; the driver uses the same constant (value byte-identical). Root cause `2026-10-24-G6-release-milestone-misread` has a Review (cause confirmed; fix accepted with required changes, which the commit makes). The regenerated release report `validation/release/2026-10-24-33b3df7.md` now reads E2E-010, E2E-012, PROV-AC-003 and PROV-AC-006 from their own passed milestone records (no line for them on Cloudflare) and PROV-AC-004 as `blocked … (run sysad9rajoir4yt)`. The new unit tests have no committed runner output yet (batch verify 5 is at `1b474c1`, before the fix); see L2 in final.md.
- **S-1 closed.** `skill/reference/troubleshooting.md` §1 now says the two `curl` commands are verified on Cloudflare (E2E-011, pass 2–5); the dashboard menu names stay marked "not yet verified".
- **E2E-015 in the release report.** With G6 fixed, it reads "E2E-015 on cloudflare (milestone): no record" instead of the masked "not-run: not selected … (run 0reagqr1j01rqfv)". That is correct: no milestone record has ever selected E2E-015 (G5). Its cloud part is judged, as before, from F-03's records (§7); the status stays `passed`.
- **No Cloudflare status changes.** The counts below stand: 67 passed, 2 failed, 3 blocked, 9 not-run. The open items are in §8.

Original D-EV text follows; where Update 1 changes it, the change is marked "(Update 1)".

Date: 2026-10-24. Base: `origin/claude/implement-local-cloudflare` at `1b474c1` ("Merge integration of Cloudflare-phase decisions (DEC-0421–0431)"). Branch: `claude/implement-local-cloudflare-d-ev`.

Evaluator: an independent D-EV subagent. I wrote none of the code, tests, evidence, root-cause records or reviews judged here. I judged from committed evidence only:
- I ran no test suite and made no Cloudflare call.
- I changed no code, test or evidence.
- `npm ci` was run only for the read-only release-report generator (`node tests/compliance/tools/report.mjs release`).

Inputs:
- plan §5 (D-EV, the D-RUN pass schedule and its rules), §8 (not-run rules) and §11 (Q1–Q14);
- `ai/implementation/evaluations/final.md` (F-EV3) and `ai/implementation/final-report.md`;
- the summaries `validation/cloudflare/{pass-0,pass-1b,pass-1c,pass-2to5,pass-B,pass-M,pass-C,f-03}/SUMMARY.md`. `pass-1/` and `cleanup-R/` have no SUMMARY.md: I read their `logs/` (pass 1's `deploy-1.log`, cleanup-R's `remove-R.log` and listings);
- all 19 Cloudflare driver and smoke records `validation/cloudflare/*.json`, with the raw Vitest JSON where a clause mattered, and the local smoke record `validation/local/kbe5rzjb8ls9p8z.json`;
- the root-cause records of 2026-10-23/24 and their Reviews (§5);
- DEC-0418…DEC-0431.

## 1. Verdict

**Phase D exit: not met.** Two Cloudflare criteria fail and three are blocked. Each of the five needs an owner decision or an owner-supplied credential or account; no agent change can pass them honestly. Everything else with Cloud in Where has passed on Cloudflare or is a confirmed §8.1 not-run.

| Target | Applicable | passed | failed | blocked | not-run |
| --- | --- | --- | --- | --- | --- |
| cloudflare | 81 | 67 | 2 | 3 | 9 (Google login mocked, §8.1) |

- **Failed (owner-dependent):**
  - FILES-AC-003, the expired-ticket clause: R2 sends no CORS headers on 403 (DEC-0101; owner question **Q4**);
  - SEC-AC-005, "the next request" after `secrets set`: Cloudflare's version rollout (DEC-0092; owner question **Q12**).
- **Blocked (by design in this sandbox and account):**
  - PROV-AC-002's restricted-token clause: no token without the R2-token permission was supplied (**Q13**);
  - PROV-AC-004's fresh-account clause: needs an account where `setup-account` never ran (DEC-0364);
  - LOG-AC-004's outside-request clause: nothing writes an entry outside a request (**Q8**, DEC-0314).
- **Not-run (§8.1, confirmed, §4):** AUTH-AC-011, CLI-AC-001, COMPL-AC-005, E2E-006, E2E-007 (cloud part), E2E-008, GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, SKILL-AC-006. Also three part entries inside passed IDs: AUTH-AC-005's successful callback and admin-list part, and AUTH-AC-009's production part.
- **Test stages removed, no leftovers:** yes (§3). **Milestone records present:** yes for all six D-RUN-M items (§3).
- **Scenarios still not met as scenarios:** E2E-002, E2E-004 and DEMO-AC-010 need AWS too, and E2E-004's pass part fails on Cloudflare because of the two failures (§2).

Change from F-EV3: the Cloudflare column was 0 passed, 73 blocked, 8 not-run, with no Cloudflare record (DEC-0317). CLI-AC-001 moves from `blocked` to `not-run`: the driver records the whole criterion as Google-mocked (plan §5 "Not runnable here").

## 2. How the statuses were read

- **Latest record per ID (DEC-0264).** For each ID I took the newest record (by `finishedAt`) whose result for that ID is not "not selected for this run (--only)". Earlier failures that a later record supersedes:

  | ID | Earlier | Later (decides) | Fix between |
  | --- | --- | --- | --- |
  | FILES-AC-001 | failed, `xdryowrec3lephb` (pass 1c, `93e6d7d`) | passed, `gblenqeyh7kuls5` (pass C, `321e41c`) | DEC-0430 (U+0001 key ending) |
  | E2E-004 | failed (coverage part), `xdryowrec3lephb` | passed, `gblenqeyh7kuls5` | DEC-0429 (AUTH-AC-005 cloud tests) |
  | AUTH-AC-005 | not-run (no tagged test), `xdryowrec3lephb` | passed with two not-run parts, `gblenqeyh7kuls5` | DEC-0429 |
  | SEC-AC-001 | failed, `cwcrlz8fxgo3ud4` (pass 2, `71ac98d`) | passed, `651l3x1zgz7pbx5` (pass C) | DEC-0431 (bounded wait) |
  | HTTP-AC-002 | failed, `cwcrlz8fxgo3ud4` | passed, `651l3x1zgz7pbx5` | DEC-0431 |

  FILES-AC-003 and SEC-AC-005 failed in both of their records, the same way each time.
- **Records span five commits** (`93e6d7d`, `71ac98d`, `24327c7`, `6417611`, `321e41c`); none is at the base. Code that changed between them: fix-auth005 and fix-sec001 (tests only), and fix-r2order (`be74246`, the Cloudflare files store and tickets). Everything after `6417611` up to the base `1b474c1` changes comments only (`git diff 6417611 1b474c1 -- packages apps tests skill`: 5 comment lines naming DEC numbers). Pass C re-ran FILES-AC-001…-005 after fix-r2order, and F-03 exercised the new keys with a 20 MB photo. ~~E2E-009 was not re-run after fix-r2order (caveat C-1).~~ (Update 1) E2E-009 re-ran in pass C-1 (`5nfl3uhrzxpuz4m`, `ad0e252`, a sixth commit, with no code difference from the base) and passed; C-1 is closed.
- **Records whose result is not the driver's:** E2E-002, DEMO-AC-010 and the cloud part of E2E-015 are judged from F-03's two smoke records and its source-difference log, as plan §5 pass 8 specifies. E2E-011's troubleshooting part is judged from `pass-2to5/logs/5-trouble.log`.
- **E2E-004 pass part.** Its own record passes (coverage and record parts). Read over the latest record of every ID, the pass part ("every applicable criterion passes") is not met on Cloudflare: 2 failed and 3 blocked. The column keeps the record's `passed`, as F-EV3 did for the local part, and the scenario is reported as not met.
- **Caps (plan §1, DEC-0418, DEC-0419):** every pass stayed under them (§6). No HTTP 429 in any pass.

## 3. Stage removal, leftovers, milestone records

**Leftovers.** Every one of the 18 driver records has `leftovers: []` (the smoke record has no such field). Each summary from pass 2 on records, after every step: no Workers, 0 D1 databases, 0 `sst-state` objects, R2 only `prototype-logs` and `sst-state`. The last listing (`f-03/logs/measure/*-3-after-remove.json`, 2026-10-24 06:07 UTC) shows exactly that: buckets `prototype-logs`, `sst-state`; 0 Workers; 0 D1 databases; `sst-state` empty.

**COMPL-AC-004** (`5kjbwwwpf3mvj95`, pass B): all three tests passed:
- "test stages are test- plus a random run ID…";
- "after an interrupted run the next cleanup removes its stage or lists it as leftovers; a stage whose R2 API token is left behind is reported with that token" (188 s; `raw/vitest.log:189`: "removed stage test-64l6y5erf83ipus of reference from cloudflare");
- "cleanup never removes prodcheck".

**Every stage created in phase D was removed:**

| Stage | Created in | Removed in | Evidence |
| --- | --- | --- | --- |
| `test-ycfmck8n9jis0gb` | pass 1 (failed at step 3, `Target not found: Files`; only `passphrase/` and `update/` state objects) | pass 1b step 1 (`remove` exit 0, skipped `sst remove`) | `pass-1b/SUMMARY.md` |
| `test-wxezkd4j5ye3oio` | pass 1b (failed at step 5, asset upload 401) | cleanup-R (`remove` exit 0, "deleted database …-db-1") | `cleanup-R/logs/remove-R.log`, listings before/after |
| `test-9mfkg261apxm7s2` (R) | pass 1c | pass 5 (`remove` exit 0) | `pass-2to5/SUMMARY.md` |
| driver and further stages | passes 2–4, B, M | by the tests or the driver | `leftovers: []` in each record |
| `test-byxa6sar2ps05po` (R2) | pass C | pass C (`remove` exit 0) | `pass-C/SUMMARY.md` |
| `test-s6jca41ew34ahz3` (demo) | F-03 | F-03 (`remove` exit 0) | `f-03/SUMMARY.md` |

Not covered by any listing: the account's API token list after pass 0. Stage R2 tokens are part of the leftover check (COMPL-AC-004), and the tests' read-only `compliance-r2read-*` tokens expire after 30 minutes. The owner check in final-report §7 includes the token list.

**Milestone records (D-RUN-M), all present:**

| ID | Record | Result |
| --- | --- | --- |
| E2E-010 | `xxiuurmy40pnr33` (`6417611`) | passed |
| E2E-012 | `e22y1n7jn93xoz4` | passed |
| PROV-AC-003 | `6e5ya5y8z05u4ce` | passed |
| PROV-AC-006 (CF part) | `6e5ya5y8z05u4ce` | passed |
| COMPL-AC-008 | `0reagqr1j01rqfv` | passed (both abort points in one record) |
| PROV-AC-004 | `sysad9rajoir4yt` (`93e6d7d`, pass 1c) | blocked (fresh-account clause); the twice-run part passed |

They are all after the last PROV/MIG/CF code change (fix-r2order is in `6417611`) except PROV-AC-004, which predates fix-r2order; that change touches the files store, not `setup-account`. `validation/invalidations.md` has no entries.

Outstanding milestones with reason: E2E-015 cloud part has no milestone record (G5; judged from F-03 records); GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006 and AUTH-AC-005 admin-list (Google mocked); all AWS runs.

**Generator finding G6 (new, agent work).** The release generator reads each milestone ID from the newest milestone record, even when that record only lists the ID as "not selected for this run (--only)". So for `1b474c1` it reports E2E-010, E2E-012, PROV-AC-003, PROV-AC-004 and PROV-AC-006 as `not-run … (run 0reagqr1j01rqfv)`, although their own milestone records passed (or, for PROV-AC-004, are blocked). DEC-0264 says "the latest record that contains an ID"; an entry that was never selected should not count as containing it. Fix the generator (`tests/compliance/tools/release.ts`) to skip not-selected entries, with a unit test. No verdict here depends on it, because the report is "not working" anyway. (Update 1) **Fixed** in `33b3df7`, together with the same defect in `traceability.ts`; the regenerated report is `validation/release/2026-10-24-33b3df7.md`.

## 4. The §8 lists

**§8.1 (Google mocked) holds.** Every record gives the detail "Google login mocked for this phase" to: AUTH-AC-011, CLI-AC-001, COMPL-AC-005, E2E-006, GOOGLE-AC-001 (automated records); E2E-007, E2E-008, GOOGLE-AC-005, SKILL-AC-006 and AUTH-AC-005's admin-list part (milestone records). Part entries: AUTH-AC-009 "cloud production part" (`xdryowrec3lephb`) and AUTH-AC-005 "contract part: successful callback (needs a real login provider)" (`gblenqeyh7kuls5`). I confirm both planner additions:
- **CLI-AC-001:** its `certify-auth` row needs a production stage with a Google client, which this phase never creates. Note that the driver records the whole ID, not only that row, as `not-run`, and no Cloudflare test is tagged CLI-AC-001; F-EV3's N1 ("other commands `blocked`") no longer applies.
- **AUTH-AC-005 successful callback:** a test stage has the mock and no provider (DEC-0171), so that response first exists on `prodcheck`. The rest of the contract part passed.

**§8.2 (AWS):** unchanged; no AWS code, no AWS record. PROV-AC-006's region part and SQL-AC-006's Data API loop are AWS-only and have no Cloudflare entry.

**Blocked with reasons (plan §5 "Always `blocked` here"):**
- PROV-AC-002 restricted-token clause: no longer refused by the sandbox (DEC-0420, DEC-0428); blocked only because `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION` was not set (`5swm2wowq7t3yho`, PrerequisiteMissingError). Q13.
- PROV-AC-004 fresh-account clause: `sysad9rajoir4yt`, PrerequisiteMissingError "needs a Cloudflare account on which setup-account has never run".
- LOG-AC-004 outside-request clause: `cwcrlz8fxgo3ud4`, PrerequisiteMissingError "the reference app has no way to write a log entry outside an HTTP request". Q8.
- DEC-0270's 403 "foreign" reading is not a criterion; it stays unverified (one account). The 200/404/409 readings were checked live in pass 0 and the 409 reading was corrected (DEC-0421).

## 5. Root-cause records of 2026-10-23/24

| Record | Cause | Review verdict | Outcome on Cloudflare |
| --- | --- | --- | --- |
| `2026-10-23-cloud-test-paths` | Cloud test paths: MIG blocks depended on each other and set the secret before the first deploy; missing D1/database guards; redundant second `remove`; per-pass request budgets | accepted with required changes (4) | fix-cloudtests, DEC-0423…0426. MIG-AC-002/-003/-006 passed in one record (`ghref0pc0a9bwmp`); the split-pass question of item 4 became moot when DEC-0418 raised the per-pass cap to 2,000 |
| `2026-10-23-pass0-F1-r2-api-delete-traversal-403` | The API `DELETE` of an `x/../y` key got 403 "path contains traversal sequence", most likely from the sandbox proxy | accepted with changes; "no defect found" holds only for this sandbox | DEC-0422; owner item **Q11**. No `..` leftover reached `remove` in any pass |
| `2026-10-23-pass0-F2-create-bucket-409-owned` | `createBucket` read every 409 as foreign; the live 409 says "you own it" | accepted with changes | fix-pass0, DEC-0421 |
| `2026-10-23-pass1-sst-target-not-found` | SST resolves `--target` only against existing state, so step 3 could never succeed on a first deploy | cause confirmed; fix accepted with R1–R4 | fix-pass1, DEC-0427. Check 10 passed live in pass 1c |
| `2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test` | AUTH-AC-005's contract part had no cloud test, so E2E-004's coverage part failed | cause accepted; fix approved with changes 1–5 | fix-auth005, DEC-0429. Both passed in pass C |
| `2026-10-24-pass1c-FILES-AC-001-r2-list-order` | R2 ranks a key's end like a byte between 0x31 and 0x61, so a name lists after its extensions | cause accepted; fix not approved as first written, approved after the live probe with items 1–7 | fix-r2order, DEC-0430 (`proposed`, owner review open, **Q14**). FILES-AC-001 passed in pass C |
| `2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early` | The test read once, 126 ms after deleting the secret, during the version rollout | diagnosis confirmed; fix accepted with R1 | fix-sec001, DEC-0431. Both passed in pass C |
| `2026-10-24-pass2-SEC-AC-005-next-request-version-rollout` | Cloudflare applies a secret change through a version rollout of up to seconds; "the next request" cannot be guaranteed | causal claim confirmed; deletion clause impossible, `secrets set` clause only probabilistic | No agent fix. Stays `failed` until the owner decides **Q12** |

Pass 1b's 401 on the static-asset upload (the proxy replaced every `Authorization` header) has no root-cause record; the orchestrator confirmed it in the summary with 2 requests, and the owner removed the cause (DEC-0420). CF-AC-001 then passed.

## 6. Cloud usage (plan §1)

D1 readings are account-wide GraphQL sums for the UTC day; requests are the runners' counts of Cloudflare API requests (SST/Pulumi calls not traced, so the true totals are higher).

| Day (UTC) | Passes | D1 rows written | D1 rows read | Requests counted | Peak D1 databases |
| --- | --- | --- | --- | --- | --- |
| 2026-10-23 | 0, 1, 1b, cleanup-R | 32 | 17 | ≈ 176 (38 + ≈ 20 + ≈ 80 + 38) | 1 |
| 2026-10-24 | 1c, 2–5, B, M, the R2 order probe, C, F-03 | 2,080 | 5,665 | ≈ 2,770 (176 + 389 + 833 + 1,018 + 37 + 207 + 107) | 2 |
| Cap per day | | 50,000 | 2,500,000 | none (≤ 2,000 per pass, ≤ 1,000 per 5 min) | 8 |

Largest pass: pass M, 1,018 requests, at most 268 in any 5 minutes. The between-pass D1 readings rose by 51 written / 364 read between pass M's last reading and pass C's first (not attributed in the summaries; within caps).

## 7. Per-ID Cloudflare status

Refs give the record (`validation/cloudflare/<runId>.json`), the pass and its commit; §8.1 means "Google login mocked for this phase". Short names in the notes: P1c = `xdryowrec3lephb` (pass 1c main run), P2 = `cwcrlz8fxgo3ud4` (pass 2), M4 = `0reagqr1j01rqfv` (pass M, COMPL-AC-008), C1 = `gblenqeyh7kuls5` (pass C step 1), F3D / F3D8 = `nu3lt4mhjsn4ihq` / `pqc4u7j4o1g4rpb` (F-03 driver), F3S = `vn8cm0ie7v2rhul` (F-03 cloud smoke). Every ID with Cloud in its Where, excluding `aws.md`:

| ID | Where | cloudflare | Record | Reason / evidence |
| --- | --- | --- | --- | --- |
| AUTH-AC-004 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| AUTH-AC-005 | Local, cloud; admin-list part: cloud (milestone) | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | Contract part passed over HTTP (6 tests, `auth/contract.test.ts`, DEC-0429). Two part entries are `not-run` (§8.1): the successful callback (C1, "needs a real login provider", planner addition confirmed) and the admin-list milestone part (M4). **Supersedes** pass 1c (P1c), where no cloud test was tagged and the ID was `not-run`. |
| AUTH-AC-006 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| AUTH-AC-007 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| AUTH-AC-009 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) | Test-stage part passed; production part `not-run` (§8.1), its own entry in P1c. |
| AUTH-AC-011 | Cloud | not-run | §8.1 | Google login mocked for this phase (every record). |
| CF-AC-001 | Cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) | First live check of SST's `@internal` `assets` option (DEC-0356): the static assets uploaded once DEC-0420 removed the proxy's header rewrite; the pass-1b 401 is gone. |
| CF-AC-002 | Cloud | passed | `5tr1c8w0x1b9lai` (pass 3, `71ac98d`) |  |
| CFG-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| CFG-AC-004 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| CFG-AC-005 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| CLI-AC-001 | Local, cloud | not-run | §8.1 | The driver records the whole ID `not-run` (Google mocked; planner addition, confirmed). No Cloudflare test is tagged CLI-AC-001. Its other cloud commands (deploy, `secrets set`, `smoke`, `remove`, `setup-account`) ran in every pass, but that is untagged evidence and does not count for the ID. |
| CLI-AC-004 | Local, cloud | passed | `cwcrlz8fxgo3ud4` (pass 2, `71ac98d`) |  |
| CLI-AC-005 | Local, cloud | passed | `2nl855v5sscoqls` (pass 4, `71ac98d`) |  |
| COMPL-AC-001 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| COMPL-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| COMPL-AC-004 | Cloud | passed | `5kjbwwwpf3mvj95` (pass B, `24327c7`) | All 3 tests passed. The interrupted-run test's cleanup removed `test-64l6y5erf83ipus` (`raw/vitest.log:189`); record leftovers []. See §3. |
| COMPL-AC-005 | Cloud | not-run | §8.1 |  |
| COMPL-AC-008 | Cloud (milestone) | passed | `0reagqr1j01rqfv` (pass M, --milestone, `6417611`) | Milestone record; both abort points (after copy, after code) in one record. |
| CORE-AC-002 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| CORE-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| DEMO-AC-001 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) | Page clauses from the driver set; newest first, drafts hidden and page size from the cloud smoke (F3S). W1 holds. |
| DEMO-AC-002 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) |  |
| DEMO-AC-003 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) | Display and page clauses from the driver set; 20 MB round trip, maximum and delete from the cloud smoke (F3S), with the U+0001 keys of DEC-0430. The warn clause is local only (W5 is a local test weakness). |
| DEMO-AC-004 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) |  |
| DEMO-AC-005 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) |  |
| DEMO-AC-007 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) |  |
| DEMO-AC-008 | Local, cloud | passed | `pqc4u7j4o1g4rpb` (F-03, `321e41c`) | The driver's cloud check, run alone (one worker). W3 holds. |
| DEMO-AC-009 | Local, cloud | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) |  |
| DEMO-AC-010 | Local, cloud | passed | `vn8cm0ie7v2rhul` (F-03 smoke, `321e41c`) | Cloudflare part: cloud smoke F3S and local smoke `kbe5rzjb8ls9p8z`, both at `321e41c` with the same `apps/demo` tree; `git diff --quiet HEAD -- apps/demo` exit 0 (`f-03/logs/8-source-diff.log`). No driver record (the criterion is judged from the smokes). **Criterion not met:** the AWS smoke is outstanding. |
| E2E-002 | Local, cloud | passed | `vn8cm0ie7v2rhul` (F-03 smoke, `321e41c`) | Cloudflare part, as DEMO-AC-010 (on a cloud `E2E-002.spec.ts` reports `blocked` by design, so no driver record). **Scenario not met:** the AWS stage is outstanding. |
| E2E-004 | Local, cloud | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | Coverage and record parts passed in C1. **Supersedes** P1c, where the coverage part failed (AUTH-AC-005 untagged on cloud; fixed by DEC-0429). Pass part, judged over the latest record per ID: **not met** (FILES-AC-003 and SEC-AC-005 failed; PROV-AC-002, PROV-AC-004 and LOG-AC-004 blocked). Scenario not met. |
| E2E-005 | Cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| E2E-006 | Cloud | not-run | §8.1 |  |
| E2E-007 | Local; cloud (milestone) | not-run | §8.1 | Cloud part (milestone); every milestone record. |
| E2E-008 | Cloud (manual, milestone) | not-run | §8.1 | Manual milestone; every milestone record. |
| E2E-009 | Local, cloud | passed | `5nfl3uhrzxpuz4m` (pass C-1, `ad0e252`) | (Update 1) Re-run alone after DEC-0430's key change (`be74246`): passed, 34.1 s, leftovers []. **Supersedes** P1c (`xdryowrec3lephb`, passed before the key change). Caveat C-1 closed. |
| E2E-010 | Cloud (milestone) | passed | `xxiuurmy40pnr33` (pass M, --milestone, `6417611`) | Milestone record. |
| E2E-011 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) | Automated part in P1c. Troubleshooting part: the two `curl` commands of `skill/reference/troubleshooting.md` §1 "Cloudflare", as written, found the `throw-plain` request's key by its requestId and read its `CORE.INTERNAL` entry (`pass-2to5/logs/5-trouble.log`, `tooling/trouble.sh`). This closes E-EV's open item. |
| E2E-012 | Cloud (milestone) | passed | `e22y1n7jn93xoz4` (pass M, --milestone, `6417611`) | Milestone record. |
| E2E-013 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| E2E-014 | Local, cloud | passed | `0ljocvikeb16ebm` (pass 5, `71ac98d`) | Both tests, cloud part included. |
| E2E-015 | Local, cloud (milestone) | passed | `nu3lt4mhjsn4ihq` (F-03, `321e41c`) | Cloud part of the milestone: every demo criterion with a Cloudflare part passed (F3D, F3D8, F3S), at `321e41c`, whose `apps/demo` equals round 4 apart from `BUILD-RECORD.md`. No milestone evidence record (G5). (Update 1) Status rechecked: still `passed`; nothing it rests on changed. The release report for `33b3df7` says "E2E-015 on cloudflare (milestone): no record" (and the same for local and aws). Before the G6 fix that line read "not-run: not selected … (run 0reagqr1j01rqfv)", a record that never ran it; "no record" is the true reading, because no `--milestone` run has selected E2E-015. The judgement does not come from a milestone record but from F-03's records, as plan §5 pass 8 specifies, so the line is the open item G5, not a failure. |
| FILES-AC-001 | Local, cloud | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | With DEC-0430's U+0001 key ending. **Supersedes** the failure in P1c (R2 listed `…/a` after `…/a b` and `…/a/b`). |
| FILES-AC-002 | Local, cloud | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | Also passed in P1c. The `x/../y` and `../up.txt` names were cleaned up through the binding; no `..` leftover reached `remove` (DEC-0422 rule not needed). |
| FILES-AC-003 | Local, cloud | failed | `gblenqeyh7kuls5` (pass C, `321e41c`) | 1 of 5 tests: the expired-ticket clause (`status is storage's HTTP status, got null`). Failed the same way in P1c. Expected: R2 sends no CORS headers on 403 (DEC-0101). **Owner-dependent: Q4.** |
| FILES-AC-004 | Local, cloud | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | Also passed in P1c. |
| FILES-AC-005 | Cloud | passed | `gblenqeyh7kuls5` (pass C, `321e41c`) | Also passed in P1c. |
| GOOGLE-AC-001 | Local, cloud | not-run | §8.1 | Cloud part (certification step 1 against production). |
| GOOGLE-AC-005 | Cloud (manual, milestone) | not-run | §8.1 | Manual milestone. |
| HTTP-AC-001 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| HTTP-AC-002 | Local, cloud | passed | `651l3x1zgz7pbx5` (pass C, `321e41c`) | With DEC-0431's bounded wait for SEC.MISSING. **Supersedes** the failure in P2 (read 126 ms after the delete). |
| HTTP-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| HTTP-AC-004 | Cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| HTTP-AC-005 | Cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| KV-AC-001 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| KV-AC-002 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| KV-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| KV-AC-004 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| KV-AC-005 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) | The only test over 50 rows (PAR-222 keys), allowed because the criterion names the limit. |
| LOG-AC-001 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| LOG-AC-002 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| LOG-AC-004 | Cloud | blocked | `cwcrlz8fxgo3ud4` (pass 2, `71ac98d`) | In-request key layout and removal clauses passed; outside-request clause `blocked`: no app or framework path writes an entry outside a request (DEC-0314). **Owner: Q8.** The random-final-part rule has unit evidence only (D-01). |
| LOG-AC-005 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| MIG-AC-002 | Local, cloud | passed | `ghref0pc0a9bwmp` (pass B, `24327c7`) | 2 tests. |
| MIG-AC-003 | Local, cloud | passed | `ghref0pc0a9bwmp` (pass B, `24327c7`) | 3 tests, failing deploy and preservation in one record (DEC-0423 blocks B and C). |
| MIG-AC-006 | Cloud | passed | `ghref0pc0a9bwmp` (pass B, `24327c7`) |  |
| PROV-AC-001 | Cloud | passed | `5fgih0buv8i5tc3` (pass B, `24327c7`) |  |
| PROV-AC-002 | Cloud | blocked | `5swm2wowq7t3yho` (pass B, `24327c7`) | 4 of 5 tests passed (credential removed; clean deploy and health; failing migration; secret removed by hook). Restricted-token clause `blocked`: `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION` not set. The sandbox refusal is gone (DEC-0428). **Owner: Q13.** |
| PROV-AC-003 | Cloud (milestone) | passed | `6e5ya5y8z05u4ce` (pass M, --milestone, `6417611`) | Milestone record. |
| PROV-AC-004 | Cloud (milestone) | blocked | `sysad9rajoir4yt` (pass 1c, --milestone, `93e6d7d`) | Milestone record: "setup-account twice changes nothing, including in the state home" passed; the fresh-account clause is `blocked` (needs an account where `setup-account` never ran, `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1`, DEC-0364). |
| PROV-AC-006 | Cloud (milestone) | passed | `6e5ya5y8z05u4ce` (pass M, --milestone, `6417611`) | Milestone record, Cloudflare clean-machine part; region part is AWS (§8.2, Q2). |
| SEC-AC-001 | Local, cloud | passed | `651l3x1zgz7pbx5` (pass C, `321e41c`) | With DEC-0431's bounded wait. **Supersedes** the failure in P2. |
| SEC-AC-002 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| SEC-AC-003 | Local, cloud | passed | `cwcrlz8fxgo3ud4` (pass 2, `71ac98d`) |  |
| SEC-AC-005 | Cloud | failed | `651l3x1zgz7pbx5` (pass C, `321e41c`) | The `secrets set` clause: the read right after `secrets set` saw the old value (`expected { sha256 } to deeply equal { sha256 }`). Failed the same way in P2. Cause: Cloudflare's version rollout (DEC-0092); no framework cache. **Owner-dependent: Q12** (root cause `2026-10-24-pass2-SEC-AC-005-…`, Review: stays `failed` until the owner amends the criterion). |
| SKILL-AC-006 | Cloud (milestone) | not-run | §8.1 | Milestone; every milestone record. |
| SQL-AC-003 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| SQL-AC-004 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| SQL-AC-005 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) |  |
| SQL-AC-006 | Local, cloud | passed | `xdryowrec3lephb` (pass 1c, `93e6d7d`) | One oversized row (PAR-215); the Data API retry loop is AWS (§8.2). |

## 8. Open items from D-EV

| # | Item | Who | Action |
| --- | --- | --- | --- |
| Q4 | FILES-AC-003 expired-ticket clause fails on Cloudflare | owner | Choose a DEC-0101 option (final-report §6.1). Then a test author and a runner act on it. |
| Q12 | SEC-AC-005 fails on Cloudflare | owner | Choose (A), (B) or (C) (final-report §6.1). Under (A), the test changes to wait and then read N times, and pass C's step 2 is re-run. |
| Q13 | PROV-AC-002 restricted-token clause blocked | owner | Supply the restricted token for one run, or accept `blocked`. |
| Q8 | LOG-AC-004 outside-request clause blocked | owner | As before. |
| — | PROV-AC-004 fresh-account clause blocked | owner (optional) | Only with a second Cloudflare account where `setup-account` never ran; otherwise it stays `blocked` with unit evidence. |
| Q11 | API `DELETE` of a `..` key on real Cloudflare unverified | owner | One request from outside the sandbox (final-report §6.1). |
| Q14 | DEC-0430's invisible U+0001 key ending | owner | Accept it, or change FILES-REQ-001. |
| C-1 | E2E-009 on Cloudflare predates fix-r2order | agent | **Closed (Update 1):** passed in pass C-1, `5nfl3uhrzxpuz4m` at `ad0e252`. |
| G6 | Release generator counts "not selected" entries of the newest milestone record | agent | **Closed (Update 1):** fixed in `33b3df7` (release and traceability); report regenerated as `validation/release/2026-10-24-33b3df7.md`. Its new unit tests still need a committed run (L2 in final.md). |
| S-1 | `skill/reference/troubleshooting.md` §1 still says the Cloudflare command-line commands are "not yet verified on Cloudflare in this phase" | agent (docs) | **Closed (Update 1):** the paragraph now says the two `curl` commands are verified (E2E-011, pass 2–5). |
| G5 | No milestone record for E2E-015 (local and cloud parts) | agent | Open, as in F-EV3. Since the G6 fix the release report shows it truthfully as "no record" (§7, E2E-015). |

Still open after Update 1: the owner items Q4, Q12, Q13, Q8, the PROV-AC-004 fresh account, Q11 and Q14, and the agent item G5. No Cloudflare agent run is outstanding.
