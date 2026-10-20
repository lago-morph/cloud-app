# C-RUN run 3 — summary (local only; no Cloudflare calls)

Recorded by the test runner. Records only; the evaluator judges.

- Branch: `claude/implement-local-cloudflare-c-run3`, from `origin/claude/implement-local-cloudflare` at `475f954f64ec0f690eee8749ede5432e42cbe9e6`.
- Environment: see `environment.txt` (node v22.22.0, npm 10.9.4, Linux 6.18.44-fc-v139).
- Evidence record: `validation/local/qrst96in89gbitx.json` (+ `validation/local/qrst96in89gbitx/` raw), runId `qrst96in89gbitx`, commit `1833e24969b6fcf8c4d3ec335f0e013809bc78cc`, exitStatus 1, 2026-10-20T12:31:43.921Z – 2026-10-20T13:06:26.158Z.
- Commit `1833e24969b6fcf8c4d3ec335f0e013809bc78cc` = base `475f954` + evidence-only commits (`validation/local/phase-C-run-3/` files); no code or test changes.

## Commands and exit codes

| Step | Command | Exit | Log |
| --- | --- | --- | --- |
| uptime before | `uptime` | — | 00-uptime-before.txt (11:45:49Z, load 0.77) |
| 1 | `npm ci` | 0 | 01-npm-ci.log |
| 2 | `npm run build -w packages/framework` | 0 | 02-build-framework.log |
| 3 | `(cd apps/reference && npm run secrets -- set apiKey --target local --stage local) < <dummy file>` (24-char random alphanumeric, stdin, never recorded) | 0 | 03-secrets-set.log |
| 4 | `npm run test:unit` | 0 | 04-test-unit.log (175 files, 1638 tests passed) |
| 5 (attempt 1) | `npm run compliance -- --target local` | 2 | attempt-1/05-compliance-local.log — see attempt-1/NOTE.txt |
| uptime before attempt 2 | `uptime` | — | 04b-uptime-before-compliance-attempt2.txt (12:31:42Z, load 1.51) |
| 5 (attempt 2, recorded) | `npm run compliance -- --target local` (full, unfiltered) | 1 | 05-compliance-local.log |
| 6 | `node tests/compliance/tools/report.mjs traceability --out validation/local/phase-C-run-3/traceability.md` | 0 | 06-traceability.log, traceability.md |
| uptime after | `uptime` | — | 07-uptime-after.txt (13:08:25Z, load 4.15) |

**Attempt 1 (exit 2):** the test runner committed partial evidence (files 00–04) while the driver was running, so HEAD moved from 475f954 to 345a4fb; the driver refused to record evidence ("the working tree is at 345a4fb…, not at the recorded commit 475f954…"). Its Playwright summary: 27 passed, 1 failed (E2E-004 coverage part). No evidence JSON. Re-run as attempt 2 with HEAD fixed at 1833e24 throughout. Operator error, not a code issue.

**Attempt 2 driver line:** `compliance: 96 passed, 13 not-run, 1 failed; evidence …/validation/local/qrst96in89gbitx.json`. Playwright: 27 passed, 1 failed (15.8m).

Traceability report: 140 criteria and scenarios; "Untested: 25 of 140" (as printed by the report).

## Counts by status (evidence record, 110 results)

- passed: 96
- not-run: 13
- failed: 1

## Failed / blocked / not-run

- **E2E-004 — failed:** 1 of 2 tests failed: [E2E-004] coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes: Error: applicable on local but no tagged test in this target's suite:
  Uncovered list (05-compliance-local.log): DEMO-AC-001, DEMO-AC-002, DEMO-AC-003, DEMO-AC-004, DEMO-AC-005, DEMO-AC-006, DEMO-AC-007, DEMO-AC-008, DEMO-AC-009, DEMO-AC-010, DEMO-AC-011, E2E-002. The other E2E-004 test (record part) passed.
- **CHECK-AC-005 — not-run:** demo part: demo built in phase F (plan C-EV)
- **DEMO-AC-001 — not-run:** no test tagged [DEMO-AC-001] ran on local
- **DEMO-AC-002 — not-run:** no test tagged [DEMO-AC-002] ran on local
- **DEMO-AC-003 — not-run:** no test tagged [DEMO-AC-003] ran on local
- **DEMO-AC-004 — not-run:** no test tagged [DEMO-AC-004] ran on local
- **DEMO-AC-005 — not-run:** no test tagged [DEMO-AC-005] ran on local
- **DEMO-AC-006 — not-run:** no test tagged [DEMO-AC-006] ran on local
- **DEMO-AC-007 — not-run:** no test tagged [DEMO-AC-007] ran on local
- **DEMO-AC-008 — not-run:** no test tagged [DEMO-AC-008] ran on local
- **DEMO-AC-009 — not-run:** no test tagged [DEMO-AC-009] ran on local
- **DEMO-AC-010 — not-run:** no test tagged [DEMO-AC-010] ran on local
- **DEMO-AC-011 — not-run:** no test tagged [DEMO-AC-011] ran on local
- **E2E-002 — not-run:** no test tagged [E2E-002] ran on local
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
| CORE-AC-007 | passed |  |
| CORE-AC-008 | passed |  |
| DEMO-AC-001 | not-run | no test tagged [DEMO-AC-001] ran on local |
| DEMO-AC-002 | not-run | no test tagged [DEMO-AC-002] ran on local |
| DEMO-AC-003 | not-run | no test tagged [DEMO-AC-003] ran on local |
| DEMO-AC-004 | not-run | no test tagged [DEMO-AC-004] ran on local |
| DEMO-AC-005 | not-run | no test tagged [DEMO-AC-005] ran on local |
| DEMO-AC-006 | not-run | no test tagged [DEMO-AC-006] ran on local |
| DEMO-AC-007 | not-run | no test tagged [DEMO-AC-007] ran on local |
| DEMO-AC-008 | not-run | no test tagged [DEMO-AC-008] ran on local |
| DEMO-AC-009 | not-run | no test tagged [DEMO-AC-009] ran on local |
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

No dev server left running after the run (checked for wrangler/workerd/vite/playwright processes: none).
