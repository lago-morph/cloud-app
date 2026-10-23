# Phase C evaluation (C-EV), local

Evaluator: an independent subagent. It wrote no code or tests, ran no suite and made no Cloudflare calls. Date: 2026-10-20. Base: `origin/claude/implement-local-cloudflare` at `9673867` (Merge C-RUN run 3 evidence). No code, test or evidence was changed. Read-only analysis scripts (parsing the raw JSON reports and the docs' Where columns) ran from the session scratchpad.

Inputs read:
- prompt `ai/prompts/implement-local-cloudflare.md` §4, §7, §8, §9 C, §11;
- `ai/implementation/plan.md`: C-RUN/C-EV, §8 (not-run rules), §10.3, Open question 1;
- the evidence record `validation/local/qrst96in89gbitx.json` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) and its raw output `validation/local/qrst96in89gbitx/raw/` (`vitest.json`, `vitest-unit.json`, `playwright.json`, logs, `expected.json`), and the runner's logs in `validation/local/phase-C-run-3/` (including `attempt-1/`, `SUMMARY.md` and `traceability.md`); earlier records `xc3s44jl2dbmqpv` (run 1) and `zcvgtq52o8niagx` (run 2) for history;
- the 13 root-cause files dated 2026-10-20 in `ai/implementation/root-causes/`;
- the acceptance criteria in `docs/components/*.md`, `docs/acceptance/e2e-scenarios.md` and `docs/demo/demo-spec.md`;
- the test code behind each record entry (paths in the table), `tests/compliance/harness/expected.ts` (not-run rules, unit-level list) and `driver.unit.test.ts`.

Abbreviations in the table: `R` = `validation/local/qrst96in89gbitx.json` (archived) (every row's result is in R; the test files below are the ones whose results R folds in, read from `raw/vitest.json`, `raw/vitest-unit.json` and `raw/playwright.json`); `FW-IT/` = `packages/framework/test/integration/`; `FW-SRC/` = `packages/framework/src/`; `CRIT/` = `tests/compliance/criteria/`; `E2E/` = `tests/compliance/e2e/`.

## 1. Exit-check verdict

**Phase C exit check: NOT MET.** Two IDs that plan C-EV judges in phase C are neither `passed` nor `not-run` under §4/§8:

1. **E2E-004 `failed`.** The coverage part fails because DEMO-AC-001…011 and E2E-002 have no tagged test, and the DEC-0305 pass condition (every other applicable result in the record passed) is not met. The root cause is accepted (E2E-004 record, Cause C revised): those components belong to phase F. It is not a code defect. But E2E-004 cannot pass on local before F, so either the plan moves E2E-004 (local) to F-EV (a planning/owner decision, like Open question 1), or the exit check stays unmet until then.
2. **CLI-AC-003: recorded `passed` on a part only.** No tagged test injects a failure into the compliance runner, and nothing checks the runner's exit status when its cleanup fails. A tagged test is needed (test author, then re-run). See Flag 1.

All other criteria and scenarios judged here passed, with an evidence record (R). Five IDs are deferred to E-EV and 13 to F-EV (section 6), plus CHECK-AC-005's demo part.

Record facts: run `qrst96in89gbitx` (archived), commit `1833e24`, target local, full unfiltered `npm run compliance -- --target local`, 12:31–13:06 UTC, exit status 1. 110 entries (109 IDs; CHECK-AC-005 has a passed and a not-run part entry): 96 passed, 13 not-run, 1 failed. The record covers every one of the 110 Local IDs except E2E-015, which is a milestone item and correctly absent from an automated run. Between `1833e24` and `475f954` (the code the runner checked out) only `validation/` changed. Between `1833e24` and the base `9673867`, the only non-evidence changes are `packages/framework/test/integration/secrets/cli.test.ts` and its root-cause record (Flag 4).

### Counts (110 Local IDs)

| Status (this evaluation) | Count |
| --- | --- |
| passed | 90 (including CHECK-AC-005, template part) |
| failed | 1 (E2E-004) |
| not-run, not under §4/§8 (blocks the exit) | 1 (CLI-AC-003, compliance-runner part) |
| blocked | 0 |
| deferred to E-EV | 5 |
| deferred to F-EV | 13 (plus CHECK-AC-005's demo part) |

Parts that are `not-run` under §4/§8 inside criteria judged `passed` (local target): GOOGLE-AC-001 cloud part, AUTH-AC-005 admin-list part, AUTH-AC-009 production part, E2E-007 cloud part (Google login mocked for this phase); CORE-AC-006 AWS-bundle clause, SQL-AC-006 Data API retry-loop clause (AWS phase not started). The record has no not-run entries for the last two (Flag 2).

## 2. Per-ID table

| ID | Status | Evidence (tests folded into R) | Notes |
| --- | --- | --- | --- |
| AUTH-AC-001 | passed | `FW-IT/auth/current-user.test.ts` |  |
| AUTH-AC-002 | passed | `FW-IT/auth/user-id.test.ts` |  |
| AUTH-AC-003 | passed | `FW-IT/auth/admin-and-users-lists.test.ts` |  |
| AUTH-AC-004 | passed | `FW-IT/auth/current-user.test.ts`, `CRIT/auth/access.test.ts` |  |
| AUTH-AC-005 | passed | `FW-IT/auth/routes-contract.test.ts` | Contract part. Admin-list part is cloud milestone, not-run (Google login mocked for this phase). |
| AUTH-AC-006 | passed | `FW-IT/auth/sessions.test.ts`, `CRIT/auth/sessions.test.ts` |  |
| AUTH-AC-007 | passed | `FW-IT/auth/forgery.test.ts`, `CRIT/auth/forgery.test.ts` | Both directly (in-process) and through the local router. Fix for the wrangler-proxy root cause is covered. |
| AUTH-AC-008 | passed | `FW-IT/auth/login-flow.test.ts` |  |
| AUTH-AC-009 | passed | `FW-IT/auth/routes-contract.test.ts`, `CRIT/auth/mock-login.test.ts` | Local and test-stage parts. Production 404 part needs a production stage: cloud, not-run (Google). "No mock in production bundles" is also shown by PROV-AC-005/CORE-AC-006 bundle tests. |
| AUTH-AC-010 | passed | `FW-IT/auth/login-flow.test.ts` |  |
| AUTH-AC-012 | passed | `FW-IT/auth/admin-and-users-lists.test.ts` |  |
| CHECK-AC-001 | passed | `FW-IT/check/portability-rules.test.ts` | 79 fixture tests, including every fixture the criterion names (node:fs, bare fs, Buffer, raw HTML, shared value import, SQL.CONFLICT, type-only shared import, zod, aliased and re-exported variants). |
| CHECK-AC-002 | passed | `FW-IT/check/portability-rules.test.ts` |  |
| CHECK-AC-003 | deferred (E-EV) | `FW-IT/check/portability-rules.test.ts` | Record: passed (15 diagnostics name an existing skill reference). Plan C-EV assigns it to E-EV. Not judged here. |
| CHECK-AC-004 | passed | `FW-IT/check/migration-checker.test.ts` |  |
| CHECK-AC-005 | passed (template part); demo part deferred (F-EV) | `FW-IT/cli/verify.test.ts` | Template part only (`verify passes on the template`, also tagged CLI-AC-002). Demo part recorded not-run ("demo built in phase F"); judged at F-EV. Record correctly splits it into two entries. |
| CHECK-AC-006 | passed | `FW-IT/check/rules-not-switchable.test.ts` |  |
| CLI-AC-001 | passed | `CRIT/cli/commands.test.ts` | Local part. Cloud commands are only dispatched with `--target local` (no cloud resources); their cloud part is for D-EV. |
| CLI-AC-002 | passed | `FW-IT/cli/verify.test.ts` | All six failure kinds, the template pass and the two offline runs. Re-check of the offline fetch-failed fix is satisfied. |
| CLI-AC-003 | not-run (part) | `FW-SRC/cli/commands/deploy.unit.test.ts`, `FW-SRC/cli/commands/remove.unit.test.ts`, `FW-SRC/provision/core/deploy.unit.test.ts`, `FW-SRC/provision/core/remove.unit.test.ts`, `FW-SRC/provision/core/setup-account.unit.test.ts` | Evidence covers `deploy`, `remove`, `setup-account` and the PROV core only (unit-level, fake target). No tagged test injects a failure into the **compliance runner**, and no test (tagged or not) checks the runner's exit status when its cleanup fails. Untagged `HARN/driver.unit.test.ts` cases show non-zero status for a failed deploy and a failed typecheck, but are not evidence. Recorded `passed` on a part only. |
| CLI-AC-004 | passed | `CRIT/cli/commands.test.ts` | Scans every output of the commands run in `commands.test.ts` (every table command, both forms, dev and smoke). Does not scan the driver's own output; acceptable for "every command". |
| CLI-AC-005 | passed | `CRIT/cli/smoke.test.ts` | Local part (against `dev`). Stage part is for D-EV. |
| CF-AC-003 | passed | `FW-IT/build/cloudflare-bundles.test.ts` |  |
| COMPL-AC-001 | passed | `CRIT/compl/targets.test.ts` | Automated and milestone lists compared with the Where columns and lines. |
| COMPL-AC-002 | passed | `HARN/catalogue.unit.test.ts`, `TOOLS/traceability.unit.test.ts` | Unit-level (plan §10.3). The run's own report (`phase-C-run-3/traceability.md` (archived)) lists 140 IDs. |
| COMPL-AC-003 | passed | `CRIT/compl/evidence.test.ts` | All four clauses. The run itself also showed the dirty-tree refusal (attempt 1). |
| COMPL-AC-006 | passed | `TOOLS/release.unit.test.ts` |  |
| COMPL-AC-007 | passed | `FW-SRC/provision/core/databases.unit.test.ts`, `FW-SRC/provision/core/deploy.unit.test.ts` | Unit-level, fake target, as the criterion states. |
| CFG-AC-001 | passed | `FW-IT/config/config.test.ts` |  |
| CFG-AC-002 | passed | `FW-IT/config/build.test.ts` | Untagged control was filtered out of the run; each negative test asserts the named key or file (Flag 6). |
| CFG-AC-003 | passed | `FW-IT/config/dev.test.ts`, `CRIT/config/values.test.ts` | Local clause. Cloud clause at D-EV. |
| CFG-AC-004 | passed | `FW-IT/config/build.test.ts`, `CRIT/config/secret-locations.test.ts` | Local and Cloudflare-build resolved configuration. |
| CFG-AC-005 | passed | `FW-IT/auth/admin-and-users-lists.test.ts`, `CRIT/config/lists.test.ts` | Local clauses with the stub provider. Cloud clause at D-EV. |
| CFG-AC-006 | passed | `FW-IT/config/build.test.ts` |  |
| CORE-AC-001 | passed | `FW-IT/core/runtime.test.ts`, `FW-IT/core/types.test.ts` |  |
| CORE-AC-002 | passed | `CRIT/core/deployment.test.ts` | Local start only. Cloudflare at D-EV; AWS not-run (AWS phase not started). |
| CORE-AC-003 | passed | `FW-IT/core/runtime.test.ts`, `CRIT/core/deployment.test.ts` |  |
| CORE-AC-004 | passed | `FW-IT/core/package.test.ts`, `FW-IT/core/runtime.test.ts` |  |
| CORE-AC-005 | passed | `FW-IT/cli/verify.test.ts`, `FW-IT/core/package.test.ts` |  |
| CORE-AC-006 | passed | `FW-IT/build/cloudflare-bundles.test.ts` | Cloudflare-bundle clauses shown for four stages. The "AWS bundle contains no Cloudflare-only modules" clause cannot run (no AWS bundle): it is a plan §8.2 not-run part ("AWS phase not started"), but the record has no not-run entry for it. |
| CORE-AC-007 | passed | `FW-IT/core/build.test.ts` | Untagged control ("a valid app name builds") was filtered out of the run; the negative test still asserts the message names the rule (Flag 6). |
| CORE-AC-008 | passed | `FW-IT/cli/verify.test.ts`, `FW-IT/core/runtime.test.ts` |  |
| FILES-AC-001 | passed | `FW-IT/files/server-operations.test.ts`, `CRIT/files/server-operations.test.ts` |  |
| FILES-AC-002 | passed | `FW-IT/files/server-operations.test.ts`, `CRIT/files/server-operations.test.ts` |  |
| FILES-AC-003 | passed | `CRIT/files/expired-ticket.spec.ts`, `CRIT/files/transfers.spec.ts` | All clauses, including the expired ticket, in a real browser on local. Re-check of the FILES-AC-003 fix (§8 step 4) is satisfied by this full run. |
| FILES-AC-004 | passed | `FW-IT/files/app-facing-types.test.ts`, `CRIT/files/app-facing-types.test.ts`, `FW-IT/files/transfers.spec.ts`, `CRIT/files/transfers.spec.ts` | Contract/type inspection and browser part (unrelated origin). Fix for the dev CORS root cause is covered. |
| FILES-AC-006 | passed | `FW-IT/files/server-operations.test.ts`, `CRIT/files/unavailable.test.ts`, `FW-IT/files/transfers.spec.ts`, `CRIT/files/transfers.spec.ts` |  |
| GOOGLE-AC-001 | passed | `FW-IT/google/provider.test.ts` | Local part (redirect PKCE/state/nonce; token request with `fetch` stubbed). Cloud certification step-1 part not-run (Google). |
| GOOGLE-AC-002 | passed | `FW-IT/google/provider.test.ts`, `FW-SRC/google/provider.unit.test.ts` | Hand-built tokens; every listed rejection plus a valid control. |
| GOOGLE-AC-003 | passed | `FW-IT/google/provider.test.ts` |  |
| HTTP-AC-001 | passed | `FW-IT/http/dev-paths.test.ts`, `FW-IT/http/errors.test.ts`, `CRIT/http/paths.test.ts` | Local; cloud at D-EV. |
| HTTP-AC-002 | passed | `FW-IT/http/errors.test.ts`, `CRIT/http/errors.test.ts` | Every catalogue code with a status; secret not echoed for 500 and 409. |
| HTTP-AC-003 | passed | `FW-IT/http/errors.test.ts`, `CRIT/http/input.test.ts` | Includes a PAR-200-byte control that reaches the handler. |
| HTTP-AC-006 | passed | `FW-IT/http/api-helper.spec.ts` |  |
| HTTP-AC-007 | passed | `FW-IT/http/errors.test.ts` |  |
| KV-AC-001 | passed | `FW-IT/kv/kv.postgres.test.ts`, `FW-IT/kv/kv.sqlite.test.ts`, `CRIT/kv/kv.d1.test.ts`, `CRIT/kv/kv.http.test.ts`, `CRIT/kv/kv.pglite.test.ts` |  |
| KV-AC-002 | passed | `FW-IT/kv/kv.postgres.test.ts`, `FW-IT/kv/kv.sqlite.test.ts`, `CRIT/kv/kv.d1.test.ts`, `CRIT/kv/kv.http.test.ts`, `CRIT/kv/kv.pglite.test.ts` |  |
| KV-AC-003 | passed | `FW-IT/kv/kv.postgres.test.ts`, `FW-IT/kv/kv.sqlite.test.ts`, `CRIT/kv/kv.d1.test.ts`, `CRIT/kv/kv.http.test.ts`, `CRIT/kv/kv.pglite.test.ts` |  |
| KV-AC-004 | passed | `FW-IT/kv/kv.postgres.test.ts`, `FW-IT/kv/kv.sqlite.test.ts`, `CRIT/kv/kv.d1.test.ts`, `CRIT/kv/kv.http.test.ts`, `CRIT/kv/kv.pglite.test.ts` | Local D1 and PGlite give identical results (shared literal expectations). AWS part not-run. |
| KV-AC-005 | passed | `FW-IT/kv/kv.postgres.test.ts`, `FW-IT/kv/kv.sqlite.test.ts`, `CRIT/kv/kv.d1.test.ts`, `CRIT/kv/kv.http.test.ts`, `CRIT/kv/kv.pglite.test.ts` |  |
| LOCAL-AC-001 | passed | `E2E/E2E-001-E2E-003.spec.ts` | Shown by the E2E-001 test (`unshare -rn`, no credentials, scaffolded from a packed tarball), now tagged with both IDs. |
| LOCAL-AC-002 | passed | `FW-IT/local/dev.test.ts` | Persistence and reset clause tested directly. "Each capability's local criteria pass" is read from this record: every SQL, MIG, KV, FILES, CFG, SEC, LOG and AUTH local criterion passed. |
| LOCAL-AC-003 | passed | `FW-IT/cli/verify.test.ts` |  |
| LOCAL-AC-004 | passed | `FW-IT/build/cloudflare-bundles.test.ts`, `FW-IT/local/dev.test.ts` | All clauses: localhost login/API, cloud builds reject local cookie settings, loopback only, `Host: evil.example` rejected. |
| LOG-AC-001 | passed | `FW-IT/log/log.test.ts`, `CRIT/log/writer.test.ts` | Local injected-writer case. AWS deny case not-run. |
| LOG-AC-002 | passed | `FW-IT/log/dev-files.test.ts`, `FW-IT/log/log.test.ts`, `CRIT/log/entries.test.ts` |  |
| LOG-AC-003 | passed | `FW-IT/log/dev-files.test.ts` |  |
| LOG-AC-005 | passed | `FW-IT/log/log.test.ts`, `CRIT/log/entries.test.ts` |  |
| MIG-AC-001 | passed | `FW-IT/mig/generate.test.ts` | Re-check of the offline fetch-failed fix is satisfied. |
| MIG-AC-002 | passed | `FW-IT/mig/deploy-local.test.ts`, `CRIT/mig/deploys.test.ts` | Local deployment. Cloud part at D-EV. |
| MIG-AC-003 | passed | `FW-IT/mig/deploy-local.test.ts`, `CRIT/mig/deploys.test.ts` | Local deployment. Cloud part at D-EV. |
| PROV-AC-005 | passed | `FW-IT/build/cloudflare-bundles.test.ts` | prod, prodcheck, mytest-1 without mock and with their own values file; test-<id> with mock and test.json. |
| PROV-AC-007 | passed | `FW-SRC/cli/commands/setup-account.unit.test.ts`, `FW-SRC/provision/cloudflare/account.unit.test.ts`, `FW-SRC/provision/core/deploy.unit.test.ts`, `FW-SRC/provision/core/setup-account.unit.test.ts` | Unit-level, stubbed Cloudflare response and fake target, as the criterion states. |
| SEC-AC-001 | passed | `FW-IT/secrets/cli.test.ts`, `FW-IT/secrets/secrets.test.ts`, `CRIT/secrets/read.test.ts` | Also shown by `FW-IT/secrets/secrets.test.ts` and `CRIT/secrets/read.test.ts`. `cli.test.ts` was rewritten after the record (see Flag 4); verdict unaffected. |
| SEC-AC-002 | passed | `FW-IT/secrets/cli.test.ts`, `FW-IT/secrets/secrets.test.ts`, `CRIT/secrets/no-leak.test.ts` | In this unfiltered run the old `cli.test.ts` SEC-AC-002 test read state from the SEC-AC-001 test that ran before it, so it was not vacuous; `CRIT/secrets/no-leak.test.ts` checks the criterion independently. The §8 step 4 re-run of the fixed file is still outstanding (Flag 4). |
| SEC-AC-003 | passed | `FW-IT/secrets/cli.test.ts`, `CRIT/secrets/storage.test.ts` | Local location (`.dev.vars`). IAM simulation part is AWS, not-run. |
| SEC-AC-004 | passed | `FW-IT/secrets/cli.test.ts` | Only evidence is the old `cli.test.ts`; the rewritten test keeps the same four rejected forms (record Fix). Verdict unaffected, re-run outstanding (Flag 4). |
| SKILL-AC-001 | deferred (E-EV) | `tests/skill/budgets-and-links.test.ts` | Phase E component; the record shows `passed` (skill built and tests merged before this run), but plan C-EV assigns it to E-EV. Not judged here. |
| SKILL-AC-002 | deferred (E-EV) | `tests/skill/structure.test.ts` | Phase E component; the record shows `passed` (skill built and tests merged before this run), but plan C-EV assigns it to E-EV. Not judged here. |
| SKILL-AC-003 | deferred (E-EV) | `tests/skill/hard-rules.test.ts` | Phase E component; the record shows `passed` (skill built and tests merged before this run), but plan C-EV assigns it to E-EV. Not judged here. |
| SKILL-AC-004 | deferred (E-EV) | `tests/skill/examples.test.ts` | Phase E component; the record shows `passed` (skill built and tests merged before this run), but plan C-EV assigns it to E-EV. Not judged here. |
| SKILL-AC-005 | passed | `CRIT/skill/scaffold.test.ts` | Integration test runs the real `skill/scripts/scaffold` into non-empty directories (the E2E-004 record's Fix C). |
| SQL-AC-001 | passed | `FW-IT/sql/schema-identical.test.ts`, `FW-IT/sql/sql.postgres.test.ts`, `FW-IT/sql/sql.sqlite.test.ts` |  |
| SQL-AC-002 | passed | `FW-IT/check/portability-rules.test.ts` |  |
| SQL-AC-003 | passed | `FW-IT/sql/sql.postgres.test.ts`, `FW-IT/sql/sql.sqlite.test.ts`, `CRIT/sql/sql.d1.test.ts`, `CRIT/sql/sql.http.test.ts`, `CRIT/sql/sql.pglite.test.ts` | Literal expectations shared by in-process local D1, in-process PGlite and the reference app over HTTP, so equal results follow. Data API part is AWS, not-run. |
| SQL-AC-004 | passed | `FW-IT/sql/sql.postgres.test.ts`, `FW-IT/sql/sql.sqlite.test.ts`, `CRIT/sql/sql.d1.test.ts`, `CRIT/sql/sql.http.test.ts`, `CRIT/sql/sql.pglite.test.ts` | Includes 2147483647/2147483648 and lone surrogates. AWS part not-run. |
| SQL-AC-005 | passed | `FW-IT/sql/sql.postgres.test.ts`, `FW-IT/sql/sql.sqlite.test.ts`, `CRIT/sql/sql.d1.test.ts`, `CRIT/sql/sql.http.test.ts`, `CRIT/sql/sql.pglite.test.ts` |  |
| SQL-AC-006 | passed | `FW-IT/sql/sql.postgres.test.ts`, `FW-IT/sql/sql.sqlite.test.ts`, `CRIT/sql/sql.d1.test.ts`, `CRIT/sql/sql.http.test.ts`, `CRIT/sql/sql.pglite.test.ts` | CONFLICT and RESULT_TOO_LARGE shown on D1, PGlite and HTTP. The local, deterministic Data API retry-loop clause is not tested: the Data API adapter is AWS code and is not built. Plan §8.2 makes it a not-run part ("AWS phase not started"), but the record has no not-run entry for it. |
| DEMO-AC-001 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-002 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-003 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-004 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-005 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-006 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-007 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-008 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-009 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-010 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| DEMO-AC-011 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| E2E-001 | passed | `E2E/E2E-001-E2E-003.spec.ts` |  |
| E2E-002 | deferred (F-EV) | — | Phase F component; recorded not-run ("no test tagged"). Judged at F-EV. |
| E2E-003 | passed | `E2E/E2E-001-E2E-003.spec.ts` |  |
| E2E-004 | failed | `E2E/E2E-004.spec.ts` | Coverage part failed: DEMO-AC-001…011 and E2E-002 have no tagged test. Under DEC-0305 the pass condition is "every other applicable result passed" in this record; it is not met (13 not-run). Cause accepted in the E2E-004 root-cause record (Cause C, revised): components of phase F. Record part passed. |
| E2E-007 | passed | `FW-IT/auth/admin-and-users-lists.test.ts`, `E2E/E2E-007.spec.ts` | Local part (in-process and through the account page). Cloud part is milestone, not-run (Google). |
| E2E-009 | passed | `E2E/E2E-009-large-photos.spec.ts` |  |
| E2E-011 | passed | `E2E/E2E-011.spec.ts` | Local part. The Cloudflare run, which needs the skill's troubleshooting commands, is judged at E-EV. |
| E2E-013 | passed | `E2E/E2E-013.spec.ts` |  |
| E2E-014 | passed | `E2E/E2E-014.spec.ts` |  |
| E2E-015 | deferred (F-EV) | — | Milestone item (Where "Local, cloud (milestone)"); correctly absent from this automated record. Judged at F-EV. |
| E2E-016 | passed | `E2E/E2E-016.spec.ts` | Scan part. Review part is a milestone, judged at F-EV (F-04). |

## 3. Flagged problems

1. **CLI-AC-003: `passed` on a part only (blocks the exit).** The criterion reads: "Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure." The nine folded tests (`FW-SRC/cli/commands/{deploy,remove}.unit.test.ts`, `FW-SRC/provision/core/{deploy,remove,setup-account}.unit.test.ts`) cover deploy and remove, including cleanup failures. None covers the compliance runner. `tests/compliance/harness/driver.unit.test.ts` has untagged cases: a failed deploy gives exit 1, a failed typecheck gives 2, and a leftover check that cannot run is recorded. These are not evidence for the ID. None of them asserts the exit status after a cleanup (stage removal or leftover listing) failure. Needed: a `[CLI-AC-003]` test of the runner with an injected failure and a failing cleanup, then a re-run.
2. **Record has no not-run parts for two §8.2 AWS clauses inside Local criteria.** CORE-AC-006 ("the AWS bundle contains no Cloudflare-only modules") and SQL-AC-006 ("Locally and deterministically … the retry loop gives up at PAR-210 and returns `SQL.UNAVAILABLE`") are recorded as a plain `passed`, but no test checks those clauses. Plan §8.2 lists both as AWS not-run parts. This does not change the phase C verdict, since the parts are allowed not-runs. But `PHASE_RULES` in `tests/compliance/harness/expected.ts` should give them `part` rules ("AWS phase not started"), as it does for CHECK-AC-005's demo part, so that the record does not overstate the evidence. The same applies to the release report.
3. **E2E-004 can never pass at phase C.** As noted in section 1, DEC-0305 makes E2E-004's local pass depend on DEMO-* and E2E-002, which are phase F items. Plan C-EV lists E2E-004 as a phase C item. That is a plan inconsistency, and it needs a planning/owner decision.
4. **SEC test-independence fix (merged after the record).** `e043933` (merged at `c9e5ee0`) rewrote only `FW-IT/secrets/cli.test.ts`. It is not an ancestor of `1833e24`, so R was produced with the old file. **Verdicts are unaffected:**
   - No product code changed.
   - In this unfiltered run the old file ran in order. Its SEC-AC-002 test read real responses recorded by the SEC-AC-001 test before it, so it was not vacuous.
   - SEC-AC-001, -002 and -003 also have independent evidence (`FW-IT/secrets/secrets.test.ts`, `CRIT/secrets/{read,no-leak,storage}.test.ts`).
   - SEC-AC-004's only evidence is the old `cli.test.ts`. The rewritten test keeps the same four rejected forms and the stdin control (record Fix).

   Still open: the record's §8 step 4 (a runner re-run of the fixed file, `--only` and full) has not been done, so there is no committed evidence for the current `cli.test.ts`. Review point 7 is also open: the scan of other files for the same cross-test dependency. The next local run should be made on a commit that contains `e043933`.
5. **Root-cause records D-01, D-03 and D-04 have no review on the feature branch.** On `origin/claude/implement-local-cloudflare` all three say "Review: pending".
   - The accepted Review of D-04 exists only on the unmerged branch `origin/claude/implement-local-cloudflare-rc-verify-review`. Its Fix (`2026-10-20-verify-fixes.md`) and the follow-up `2026-10-20-global-unit-timeout-review.md` (ACCEPTED, fix applied in fix-c4) are merged. The record file itself was never updated.
   - D-01 and D-03 have no review of their own. Their findings (timeouts under load, offline git signing) are the same as D-04's and are covered by that review and fix. D-03's "unexplained" Miniflare socket error was later diagnosed, reviewed and fixed in `2026-10-20-CLI-AC-002-MIG-AC-001-offline-verify-fetch-failed.md`.

   §8 is met in substance, but the records do not show it. The D-04 Review section should be merged, and D-01/D-03 should point to the D-04 review and the CLI-AC-002/MIG-AC-001 record. No local verdict depends on this.
6. **Untagged controls were filtered out of the recorded run.** The compliance driver selects tests by tag. Three untagged positive controls were therefore `skipped` in `raw/vitest.json` (CORE-AC-007 "a valid app name builds", CFG-AC-002 "complete values files build", and the CHECK-AC-003 fixture-coverage control), and `test:integration` was not run separately. Each negative test still asserts the specific message (rule, key or file), so no verdict changes. Tagging the controls, so that they run with their criteria, would make the record self-contained.
7. **Tests tagged with IDs they do not check:** none found. The other 16 `skipped` entries in `raw/vitest.json` are Cloud-only tests (CF-AC-001/002, FILES-AC-005, HTTP-AC-005, LOG-AC-004, MIG-AC-006, PROV-AC-001…004/006, COMPL-AC-004/008, the further-stage SEC test) that skip on local and are not in R. `tests/compliance/harness/catalogue.unit.test.ts:87` mentions DEMO-AC-011 in a catalogue check, not as a tag. It is correctly not folded.
8. **Weaker-than-criterion assertions:** none found in the passed rows beyond Flags 1–2. Rows with noted readings: LOCAL-AC-002 (its "each capability's criteria pass" clause is read from R), CLI-AC-001 (the cloud commands are only dispatched locally), and CLI-AC-004 (scans every table command's output, not the driver's).

### Google-mocked not-run list (prompt §4, plan §8.1)

Confirmed against the documents. The list is: GOOGLE-AC-001 (cloud part), GOOGLE-AC-005, AUTH-AC-005 (admin-list part), AUTH-AC-009 (cloud production part), AUTH-AC-011, COMPL-AC-005, SKILL-AC-006, E2E-006, E2E-007 (cloud part), E2E-008, plus the planner's CLI-AC-001 (cloud). Every criterion whose text needs `prodcheck`, a production deployment or a Google client is on it (auth.md, compliance.md, google.md, e2e-scenarios.md). **No Local criterion needs a real Google login:** the local parts of GOOGLE-AC-001/-002/-003, AUTH-AC-005/-009 and E2E-007 run offline with hand-built tokens, a stubbed `fetch`, the mock or the stub provider. No missing entry was found. One thing for D-EV: `PHASE_RULES` marks the whole of CLI-AC-001 not-run on cloud, although only `certify-auth` needs a production stage. A `part` rule ("certify-auth part") would leave the other commands' cloud runs as evidence. A test fixture uses a made-up Google client ID (`FAKE_CLIENT_ID`) only against a stubbed `fetch`. It is not a credential and contacts nothing.

## 4. Root-cause records dated 2026-10-20 (§8)

| Record | Diagnosis | Independent review | Red-green fix | Re-run (step 4) |
| --- | --- | --- | --- | --- |
| AUTH-AC-007 wrangler proxy origin scheme | yes | ACCEPTED | yes (`runtime.unit.test.ts`, red → green) | yes: R, AUTH-AC-007 passed |
| FILES-AC-004 dev Vite CORS | yes | ACCEPTED | yes | yes: R, FILES-AC-004 passed |
| CLI-AC-002 / MIG-AC-001 offline fetch failed | yes | ACCEPTED | yes (ordering test, red → green; stress check) | yes: R, both passed |
| E2E-004 coverage and not-run (A, B, C) | yes (C revised after a partial rejection) | A, B ACCEPTED; C rejected in part, then revised C ACCEPTED | yes (Fix A/B, Fix C, phase rule) | yes: in R the "no test tagged" set is exactly DEMO-*, E2E-002 (SKILL-AC-001…004 have since gained E-T1 tests), and E2E-004's coverage list equals it, as the record predicts |
| FILES-AC-003 execution context destroyed | yes | ACCEPTED | yes (watch-ignore test, red → green) | yes: R, FILES-AC-003 passed (expired-ticket clause included) |
| SKILL-AC-004 example config not type-checked | yes | ACCEPTED | yes | yes: R, SKILL-AC-004 passed (judged at E-EV) |
| SEC-AC-002 depends on SEC-AC-001 | yes | ACCEPTED | yes (`cli.test.ts`, red → green, shuffle seeds) | **no**: merged after R (Flag 4) |
| D-04 verify unrelated failures | yes | ACCEPTED on an unmerged branch only (Flag 5) | yes (`verify-fixes.md`: hermetic git, red → green; timeouts) | verify online and offline green; unit 1638/1638 in `04-test-unit.log` |
| global unit timeout (review of a fix change) | n/a | ACCEPTED | applied (fix-c4), verify green | covered by `04-test-unit.log` |
| D-01, D-03 unit timeouts | yes | **missing** (Flag 5) | covered by the D-04 fix | same |
| verify-fixes | Fix section of D-04 | — | — | — |

Every failure in the three local runs went through §8. Run 1 (`xc3s44jl2dbmqpv` (archived)) failed CHECK-AC-003, CLI-AC-002, MIG-AC-001 and E2E-004. Run 2 (`zcvgtq52o8niagx`) failed FILES-AC-003 and E2E-004. Run 3 (R) failed only E2E-004. No test was skipped, deleted or weakened to get a pass. The FILES-AC-003 review explicitly kept the test as written, and the SEC fix added a non-vacuity assertion.

## 5. Runner procedure

Sound, with one operator error that it handled correctly.
- **Attempt 1.** The runner committed partial evidence (`345a4fb`) while the driver was running from `475f954`. The driver then refused to write evidence because HEAD had moved. This is the intended COMPL-AC-003 behaviour, so no record exists for attempt 1. Its logs are kept in `phase-C-run-3/attempt-1/` (archived) with a NOTE.
- **Attempt 2.** A full, unfiltered re-run, with HEAD held at `1833e24` throughout. `1833e24` differs from `475f954` only under `validation/`. The record is therefore valid for the code under test.
- **Prerequisites and environment.** The dummy `apiKey` was set through stdin, as DEC-0277 requires, and is never recorded. Load average was 1.5–4.2, so the timeout root causes do not apply. No dev process was left behind.
- **For later runs:**
  - Commit nothing on the run's branch until the driver has finished. Keep interim logs uncommitted, or keep them in another worktree.
  - `test:unit` (step 4) ran before the HEAD move, at `475f954`. That is acceptable because only evidence changed.
  - Make the next run on a commit that contains the SEC fix (Flag 4).

## 6. IDs deferred to E-EV / F-EV

- **E-EV:** SKILL-AC-001, SKILL-AC-002, SKILL-AC-003, SKILL-AC-004, CHECK-AC-003. R already shows them `passed` (the skill was merged before this run). Also E2E-011 on Cloudflare (plan D-EV note).
- **F-EV:** DEMO-AC-001…DEMO-AC-011, CHECK-AC-005 (demo part), E2E-002 (local part), E2E-015 (milestone), E2E-016 (review part, milestone).
- **Proposed (needs a planning/owner decision):** E2E-004 (local) to F-EV (Flag 3).
