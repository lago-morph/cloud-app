# Final local run 2 (phase-end full compliance, local) — summary

Recorded by the test runner (did not write the code or tests under test). Records only; the evaluator judges. **Local only: no Cloudflare calls were made** (`COMPLIANCE_DEMO_BASE_URL` and `COMPLIANCE_CLOUDFLARE_D1` unset in every step). No code or tests were changed. `npm run verify` was not run (covered by batch-verify-2). Method copied from `validation/local/final-local/`; `NODE_USE_ENV_PROXY` was not set, as final-local did not set it. The driver was run once; nothing was re-run.

- Branch: `claude/implement-local-cloudflare-final-local-2`, from `origin/claude/implement-local-cloudflare` at `26128b1fd0ec90e14b55c7055b6f5bb1f3d736af`. Tracked tree clean at start and before the driver run.
- Environment: see `environment.txt` (Node v22.22.0, npm 10.9.4, Linux 6.18.44-fc-v139 x86_64, 4 CPUs).
- Evidence record: `validation/local/q3qgbyunuxaz1fw.json` (raw: `validation/local/q3qgbyunuxaz1fw/raw/`), runId `q3qgbyunuxaz1fw`, target local, commit `26128b1fd0ec90e14b55c7055b6f5bb1f3d736af`, exitStatus 0, 2026-10-20T21:09:09.736Z – 2026-10-20T21:45:30.784Z. HEAD did not move during the run; nothing was committed until the run had finished.
- Each step log starts with `# uptime before:` and ends with `# exit code:` and `# uptime after:`.

## Commands and exit codes

| Step | Command | Exit | Log | uptime before → after (UTC, 1-min load) |
| --- | --- | --- | --- | --- |
| 1 | `npm ci` | 0 | `01-npm-ci.log` | 21:08:28 (0.25) → 21:08:37 (0.39) |
| 2 | `npm run build -w packages/framework` | 0 | `02-build-framework.log` | 21:08:42 (0.44) → 21:08:51 (0.77) |
| 3 | `(cd apps/reference && npm run secrets -- set apiKey --target local --stage local) < <dummy>` and `(cd apps/demo && npm run secrets -- set shareKey --target local --stage local) < <dummy>` (each value 32 random letters/digits on stdin, never recorded) | 0, 0 | `03-secrets-set.log` | 21:09:00 (0.65) → 21:09:03 (0.68) |
| 4 | `npm run compliance -- --target local` (full, unfiltered) | 0 | `04-compliance-local.log` | 21:09:08 (0.62) → 21:45:30 (3.80) |

Exit codes are also in `exit-codes.txt`.

### Compliance driver

Driver line: `compliance: 109 passed, 2 not-run; evidence …/validation/local/q3qgbyunuxaz1fw.json`. Playwright: 42 tests using 2 workers, 42 passed (17.2m).

## Counts by status (evidence record: 111 results, 109 distinct IDs)

- passed: 109
- not-run: 2
- failed: 0
- blocked: 0

CORE-AC-006 and SQL-AC-006 each have one `passed` entry and one `not-run` entry for a clause (see table).

## Failed / blocked / not-run

- failed: none.
- blocked: none.
- **CORE-AC-006 — not-run (clause entry; another entry passed):** AWS-bundle clause: AWS phase not started
- **SQL-AC-006 — not-run (clause entry; another entry passed):** Data API retry-loop clause: AWS phase not started

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
| DEMO-AC-002 | passed |  |
| DEMO-AC-003 | passed |  |
| DEMO-AC-004 | passed |  |
| DEMO-AC-005 | passed |  |
| DEMO-AC-006 | passed |  |
| DEMO-AC-007 | passed |  |
| DEMO-AC-008 | passed |  |
| DEMO-AC-009 | passed |  |
| DEMO-AC-010 | passed |  |
| DEMO-AC-011 | passed |  |
| E2E-001 | passed |  |
| E2E-002 | passed |  |
| E2E-003 | passed |  |
| E2E-004 | passed |  |
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
