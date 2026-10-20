# C-RUN — local test run (facts only)

Runner: test-runner subagent for plan item C-RUN. Target: local only; no Cloudflare calls were made. Nothing here is a verdict. The evaluator decides each status.

## Commits and environment
- Base commit: `73efc29dba04b113b23bf7aed533a761b3c2bec2` (origin/claude/implement-local-cloudflare). The working branch is `claude/implement-local-cloudflare-c-run`.
- Commit the compliance run verified (the evidence record's `commit` field): `4ff83c4ddaf62dc45f484937e99d26899deef392`. This is the base commit plus the runner's first evidence commit, which added only files under `validation/local/phase-C-run/` (01, 02a–02c, 03, environment.txt).
- node v22.22.0, npm 10.9.4, Linux 6.18.44-fc-v139 (`environment.txt`). Versions in the record: framework 0.1.0, vitest 5.0.5, @playwright/test 1.64.1, wrangler 4.149.0, typescript 6.0.3, drizzle-orm 0.45.4, drizzle-kit 0.31.11, hono 4.13.13, zod 4.6.7, pglite 0.5.8, esbuild 0.28.2, sst 4.17.2.

## Commands and exit codes
Each log starts with its exact command and records its start time, end time and exit code.

| # | Command | Exit | Log |
| --- | --- | --- | --- |
| — | `git status --short` after creating the branch | 0 | empty output (not saved to a file) |
| 01 | `npm ci` | 0 | `01-npm-ci.log` |
| 02a | `npm run secrets -- set apiKey --target local --stage local` in `apps/reference`, value on stdin | 1 | `02a-secrets-set-first-attempt.log`: `ERR_MODULE_NOT_FOUND` for `packages/framework/dist/cli/public.js` (framework not built after `npm ci`) |
| 02b | `npm run build -w packages/framework` | 0 | `02b-build-framework.log` |
| 02c | same as 02a (new generated value, 24 letters/digits, on stdin) | 0 | `02c-secrets-set.log`: `set secret apiKey for target local as SECRET_API_KEY in .dev.vars` |
| 03 | `npm run test:unit` | 0 | `03-test-unit.log`: 140 files passed, 1407 tests passed |
| 04 | `npm run compliance -- --target local` | 1 | `04-compliance-local.log`; record `validation/local/xc3s44jl2dbmqpv.json` (`exitStatus` 1), raw output in `validation/local/xc3s44jl2dbmqpv/raw/` |
| 05 | `node tests/compliance/tools/report.mjs traceability --out validation/local/phase-C-run/traceability.md` | 0 | `05-traceability.log`, `traceability.md` |

The dummy secret value was kept only in a scratchpad file outside the repo and in the git-ignored `apps/reference/.dev.vars`. A fixed-string scan (`grep -rlF`) of every file under `validation/` for that value found 0 matches before each commit.

Dev server: the driver started and stopped `dev` itself (`raw/dev.log`). After the run, no dev/workerd/wrangler process from this worktree was running.

## Driver result (record `xc3s44jl2dbmqpv`, started 2026-10-20T03:59:07Z, finished 2026-10-20T04:53:29Z)
Driver line: `compliance: 79 passed, 4 failed, 26 not-run`. There were 109 result entries and 0 blocked.

Raw runner totals: Vitest integration had 521 tests, 494 passed, 17 failed and 10 pending (`raw/vitest.json`). Playwright had 28 tests, 27 passed and 1 failed (`raw/playwright.log`). The build and typecheck logs are `raw/build.log` and `raw/typecheck.log`.

### Passed (79)
AUTH-AC-001…010, AUTH-AC-012; CF-AC-003; CFG-AC-001…006; CHECK-AC-001, -002, -004, -006; CLI-AC-001, -004, -005; CORE-AC-001…008; E2E-001, -003, -007, -009, -011, -013, -014, -016; FILES-AC-001, -002, -003, -004, -006; GOOGLE-AC-001…003; HTTP-AC-001, -002, -003, -006, -007; KV-AC-001…005; LOCAL-AC-002, -003, -004; LOG-AC-001, -002, -003, -005; MIG-AC-002, -003; PROV-AC-005; SEC-AC-001…004; SQL-AC-001…006.

### Failed (4), with the detail the record holds
- **CHECK-AC-003**: `15 of 15 tests failed`. First: `no allowed-imports diagnostic for src/server/fail/ai-node-fs.ts names /node:fs/ and an existing skill/reference/*.md`. The other 14 tests fail the same way for no-env-access (`ne-execution-ctx.ts`), browser-api-only (`ba-fetch.ts`), no-raw-sql and the remaining rules.
- **CLI-AC-002**: `1 of 8 tests failed: verify on the template > two consecutive verify runs with networking disabled give identical results: AssertionError: verify exit 1:`. Raw output: `verify: migration checker` then `verify failed: fetch failed` (`packages/framework/test/integration/cli/verify.test.ts:77`).
- **E2E-004**: `1 of 2 tests failed: coverage part … Error: applicable on local but no tagged test in this target's suite:`. The list is below. The record part passed.
- **MIG-AC-001**: `1 of 3 tests failed: editing a generated migration makes the checker fail …: AssertionError: verify must pass before the edit:`. Raw output: `verify: migration checker` then `verify failed: fetch failed` (`packages/framework/test/integration/mig/generate.test.ts:64`).

### Blocked (0)
None. No `--blocked` was passed, and no test reported a missing prerequisite.

### Not-run (26). Every one has the detail `no test tagged [<ID>] ran on local`
CHECK-AC-005; CLI-AC-003; COMPL-AC-001, -002, -003, -006, -007; DEMO-AC-001…011; E2E-002; LOCAL-AC-001; PROV-AC-007; SKILL-AC-001…005.

## E2E-004 coverage list (applicable on local, no tagged test in this target's suite), verbatim from `raw/playwright.log`
CHECK-AC-005, CLI-AC-003, COMPL-AC-001, COMPL-AC-002, COMPL-AC-003, COMPL-AC-006, COMPL-AC-007, DEMO-AC-001, DEMO-AC-002, DEMO-AC-003, DEMO-AC-004, DEMO-AC-005, DEMO-AC-006, DEMO-AC-007, DEMO-AC-008, DEMO-AC-009, DEMO-AC-010, DEMO-AC-011, E2E-002, KV-AC-001, KV-AC-002, KV-AC-003, KV-AC-004, KV-AC-005, LOCAL-AC-001, PROV-AC-007, SKILL-AC-001, SKILL-AC-002, SKILL-AC-003, SKILL-AC-004, SKILL-AC-005, SQL-AC-003, SQL-AC-004, SQL-AC-005, SQL-AC-006 (35 IDs).

The record shows KV-AC-001…005 and SQL-AC-003…006 as `passed`, even though they are on this list. The other 26 IDs on the list are the record's not-run entries.

## Traceability report
`traceability.md` says: `Criteria and scenarios: 140. Untested: 39 of 140.` This count also includes unit tests and cloud-only IDs.
