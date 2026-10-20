# Final local run (phase-end run for C, E, F locally) — summary

Recorded by the test runner (did not write the code or tests under test). Records only; the evaluator judges. **Local only: no Cloudflare calls were made.** No code or tests were changed.

- Branch: `claude/implement-local-cloudflare-final-local`, from `origin/claude/implement-local-cloudflare` at `8d65a707e2360516a45609673c948ab35b2224f0`. Tracked tree clean at start and before the driver run.
- Environment: see `environment.txt` (Node v22.22.0, npm 10.9.4, Linux 6.18.44-fc-v139 x86_64, 4 CPUs).
- Evidence record: `validation/local/emckebxm5x3kxd1.json` (raw: `validation/local/emckebxm5x3kxd1/raw/`), runId `emckebxm5x3kxd1`, target local, commit `8d65a707e2360516a45609673c948ab35b2224f0`, exitStatus 1, 2026-10-20T18:15:13.176Z – 2026-10-20T18:53:23.530Z. HEAD did not move during the run; nothing was committed until both runs had finished.
- Each step log starts with `# uptime before:` and ends with `# exit code:` and `# uptime after:`.

## Commands and exit codes

| Step | Command | Exit | Log | uptime before → after (UTC, 1-min load) |
| --- | --- | --- | --- | --- |
| 1 | `npm ci` | 0 | `01-npm-ci.log` | 17:59:39 (0.60) → 17:59:51 (0.59) |
| 2 | `npm run build -w packages/framework` | 0 | `02-build-framework.log` | 17:59:53 (0.59) → 18:00:05 (0.68) |
| 3 | `npm run verify` (online) | 0 | `03-verify-online.log` | 18:00:08 (0.68) → 18:07:37 (4.14) |
| 4 | `unshare -rn sh scripts/offline.sh npm run verify` (offline) | 0 | `04-verify-offline.log` | 18:07:40 (3.81) → 18:14:55 (3.36) |
| 5 | `(cd apps/reference && npm run secrets -- set apiKey --target local --stage local) < <dummy>` and `(cd apps/demo && npm run secrets -- set shareKey --target local --stage local) < <dummy>` (each value 32 random letters/digits on stdin, never recorded) | 0, 0 | `05-secrets-set.log` | → 18:15:06 (2.92) |
| 6 | `npm run compliance -- --target local` (full, unfiltered) | **1** | `06-compliance-local.log` | 18:15:11 (2.69) → 18:53:23 (4.21) |
| 7 | `node tests/compliance/tools/report.mjs traceability --out validation/local/final-local/traceability.md` | 0 | `07-traceability.log`, `traceability.md` | 18:53:34 (3.57) → 18:55:35 (3.69) |

Exit codes are also in `exit-codes.txt`.

### Batch check (`npm run verify`), online and offline — identical results

Build, typecheck, lint passed. `test:unit`: 178 files, 1689 tests passed. `apps/template` verify: type checking, portability rules, migration checker, zod version (4.6.7) passed; tests sqlite 18/18, postgres 18/18. `apps/reference` verify: same checks passed; tests sqlite 52/52, postgres 52/52. `tests/skill/example-pages.test.ts`: 1 file, 2 tests passed.

### Compliance driver

Driver line: `compliance: 98 passed, 12 not-run, 2 failed; evidence …/validation/local/emckebxm5x3kxd1.json`. Playwright: 31 tests, 29 passed, 2 failed (16.8m).

Traceability report: "Criteria and scenarios: 140. Untested: 22 of 140." (as printed).

## Counts by status (evidence record: 112 results, 109 distinct IDs)

- passed: 98
- not-run: 12
- failed: 2
- blocked: 0

CHECK-AC-005, CORE-AC-006 and SQL-AC-006 each have one `passed` entry and one `not-run` entry for a clause (see table).

## Failed / blocked / not-run

- **DEMO-AC-009 — failed:** 1 of 1 tests failed: `[DEMO-AC-009] with clipboard permissions granted, the account page's copy button puts exactly the /api/auth/me user ID on the clipboard`: `TimeoutError: locator.click: Timeout 30000ms exceeded.` while waiting for `getByRole('link', { name: /account/i }).first()` (`tests/compliance/e2e/demo-pages.spec.ts:275`). Playwright error context: `error-context/DEMO-AC-009.md`.
- **E2E-004 — failed:** 1 of 2 tests failed (coverage part): "applicable on local but no tagged test in this target's suite". **Uncovered list:** DEMO-AC-002, DEMO-AC-004, DEMO-AC-005, DEMO-AC-006, DEMO-AC-007, DEMO-AC-008, DEMO-AC-010, DEMO-AC-011, E2E-002. The record part passed. Error context: `error-context/E2E-004.md`.
- **CHECK-AC-005 — not-run (clause entry; another entry passed):** demo part: demo built in phase F (plan C-EV)
- **CORE-AC-006 — not-run (clause entry; another entry passed):** AWS-bundle clause: AWS phase not started
- **SQL-AC-006 — not-run (clause entry; another entry passed):** Data API retry-loop clause: AWS phase not started
- **DEMO-AC-002, DEMO-AC-004, DEMO-AC-005, DEMO-AC-006, DEMO-AC-007, DEMO-AC-008, DEMO-AC-010, DEMO-AC-011, E2E-002 — not-run:** "no test tagged [<ID>] ran on local" (each).
- blocked: none.

## Per-criterion/scenario status as recorded

| ID | Status | Detail |
| --- | --- | --- |
| AUTH-AC-001 | passed |  |
| AUTH-AC-002 | passed |  |
| AUTH-AC-003 | passed |  |
| AUTH-AC-004 | passed |  |
| AUTH-AC-005 | passed |  |
| AUTH-AC-006 | passed |  |
| AUTH-AC-007 | passed |  |
| AUTH-AC-008 | passed |  |
| AUTH-AC-009 | passed |  |
| AUTH-AC-010 | passed |  |
| AUTH-AC-012 | passed |  |
| CF-AC-003 | passed |  |
| CFG-AC-001 | passed |  |
| CFG-AC-002 | passed |  |
| CFG-AC-003 | passed |  |
| CFG-AC-004 | passed |  |
| CFG-AC-005 | passed |  |
| CFG-AC-006 | passed |  |
| CHECK-AC-001 | passed |  |
| CHECK-AC-002 | passed |  |
| CHECK-AC-003 | passed |  |
| CHECK-AC-004 | passed |  |
| CHECK-AC-005 | passed |  |
| CHECK-AC-005 | not-run | demo part: demo built in phase F (plan C-EV) |
| CHECK-AC-006 | passed |  |
| CLI-AC-001 | passed |  |
| CLI-AC-002 | passed |  |
| CLI-AC-003 | passed |  |
| CLI-AC-004 | passed |  |
| CLI-AC-005 | passed |  |
| COMPL-AC-001 | passed |  |
| COMPL-AC-002 | passed |  |
| COMPL-AC-003 | passed |  |
| COMPL-AC-006 | passed |  |
| COMPL-AC-007 | passed |  |
| CORE-AC-001 | passed |  |
| CORE-AC-002 | passed |  |
| CORE-AC-003 | passed |  |
| CORE-AC-004 | passed |  |
| CORE-AC-005 | passed |  |
| CORE-AC-006 | passed |  |
| CORE-AC-006 | not-run | AWS-bundle clause: AWS phase not started |
| CORE-AC-007 | passed |  |
| CORE-AC-008 | passed |  |
| DEMO-AC-001 | passed |  |
| DEMO-AC-002 | not-run | no test tagged [DEMO-AC-002] ran on local |
| DEMO-AC-003 | passed |  |
| DEMO-AC-004 | not-run | no test tagged [DEMO-AC-004] ran on local |
| DEMO-AC-005 | not-run | no test tagged [DEMO-AC-005] ran on local |
| DEMO-AC-006 | not-run | no test tagged [DEMO-AC-006] ran on local |
| DEMO-AC-007 | not-run | no test tagged [DEMO-AC-007] ran on local |
| DEMO-AC-008 | not-run | no test tagged [DEMO-AC-008] ran on local |
| DEMO-AC-009 | failed | 1 of 1 tests failed: [DEMO-AC-009] with clipboard permissions granted, the account page's copy button puts exactly the /api/auth/me user ID on the clipboard: TimeoutError: locator.click: Timeout 30000ms exceeded. |
| DEMO-AC-010 | not-run | no test tagged [DEMO-AC-010] ran on local |
| DEMO-AC-011 | not-run | no test tagged [DEMO-AC-011] ran on local |
| E2E-001 | passed |  |
| E2E-002 | not-run | no test tagged [E2E-002] ran on local |
| E2E-003 | passed |  |
| E2E-004 | failed | 1 of 2 tests failed: [E2E-004] coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes: Error: applicable on local but no tagged test in this target's suite: |
| E2E-007 | passed |  |
| E2E-009 | passed |  |
| E2E-011 | passed |  |
| E2E-013 | passed |  |
| E2E-014 | passed |  |
| E2E-016 | passed |  |
| FILES-AC-001 | passed |  |
| FILES-AC-002 | passed |  |
| FILES-AC-003 | passed |  |
| FILES-AC-004 | passed |  |
| FILES-AC-006 | passed |  |
| GOOGLE-AC-001 | passed |  |
| GOOGLE-AC-002 | passed |  |
| GOOGLE-AC-003 | passed |  |
| HTTP-AC-001 | passed |  |
| HTTP-AC-002 | passed |  |
| HTTP-AC-003 | passed |  |
| HTTP-AC-006 | passed |  |
| HTTP-AC-007 | passed |  |
| KV-AC-001 | passed |  |
| KV-AC-002 | passed |  |
| KV-AC-003 | passed |  |
| KV-AC-004 | passed |  |
| KV-AC-005 | passed |  |
| LOCAL-AC-001 | passed |  |
| LOCAL-AC-002 | passed |  |
| LOCAL-AC-003 | passed |  |
| LOCAL-AC-004 | passed |  |
| LOG-AC-001 | passed |  |
| LOG-AC-002 | passed |  |
| LOG-AC-003 | passed |  |
| LOG-AC-005 | passed |  |
| MIG-AC-001 | passed |  |
| MIG-AC-002 | passed |  |
| MIG-AC-003 | passed |  |
| PROV-AC-005 | passed |  |
| PROV-AC-007 | passed |  |
| SEC-AC-001 | passed |  |
| SEC-AC-002 | passed |  |
| SEC-AC-003 | passed |  |
| SEC-AC-004 | passed |  |
| SKILL-AC-001 | passed |  |
| SKILL-AC-002 | passed |  |
| SKILL-AC-003 | passed |  |
| SKILL-AC-004 | passed |  |
| SKILL-AC-005 | passed |  |
| SQL-AC-001 | passed |  |
| SQL-AC-002 | passed |  |
| SQL-AC-003 | passed |  |
| SQL-AC-004 | passed |  |
| SQL-AC-005 | passed |  |
| SQL-AC-006 | passed |  |
| SQL-AC-006 | not-run | Data API retry-loop clause: AWS phase not started |
