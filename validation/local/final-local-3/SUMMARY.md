# Final local run 3 (phase-end full compliance, local) — summary

Recorded by the test runner (did not write the code or tests under test). Records only; the evaluator judges. **Local only: no Cloudflare calls were made** (`COMPLIANCE_DEMO_BASE_URL` and `COMPLIANCE_CLOUDFLARE_D1` unset in every step). No code or tests were changed. `npm run verify` is covered by `validation/local/batch-verify-3/` (same commit). Method copied from `validation/local/final-local-2/` (same dummy-secret script); `NODE_USE_ENV_PROXY` was not set. The driver was run once; **the failure was not re-run**.

- Branch: `claude/implement-local-cloudflare-final-local-3`, from `origin/claude/implement-local-cloudflare` at `760e7b7f3d8abc5ef1a95128cf01d920c6ac5cfc` ("Merge integration of DEC-0415/0416", on top of `50281bc`). Tracked tree clean at start and before the driver run.
- Environment: see `environment.txt` (v22.22.0, npm 10.9.4, 4 CPUs).
- Evidence record: `validation/local/r5nndia2aediccu.json` (raw: `validation/local/r5nndia2aediccu/raw/`), runId `r5nndia2aediccu`, target local, commit `760e7b7f3d8abc5ef1a95128cf01d920c6ac5cfc`, exitStatus 1, 2026-10-20T23:04:39.446Z – 2026-10-20T23:39:35.280Z. HEAD did not move during the run; nothing was committed until the run had finished.
- Each step log starts with `# uptime before:` and ends with `# exit code:` and `# uptime after:`.

## Commands and exit codes

| Step | Command | Exit | Log | uptime before → after (UTC, 1-min load) |
| --- | --- | --- | --- | --- |
| 1 | `npm ci` | 0 | `01-npm-ci.log` | 23:04:04 (1.66) → 23:04:16 (1.56) |
| 2 | `npm run build -w packages/framework` | 0 | `02-build-framework.log` | 23:04:19 (1.43) → 23:04:27 (1.40) |
| 3 | `(cd apps/reference && npm run secrets -- set apiKey --target local --stage local) < <dummy>` and `(cd apps/demo && npm run secrets -- set shareKey --target local --stage local) < <dummy>` (each value 32 random letters/digits on stdin, never recorded) | 0, 0 | `03-secrets-set.log` | 23:04:32 (1.29) → 23:04:34 (1.26) |
| 4 | `npm run compliance -- --target local` (full, unfiltered) | 1 | `04-compliance-local.log` | 23:04:38 (1.26) → 23:39:35 (2.90) |

Exit codes are also in `exit-codes.txt`.

### Compliance driver

Driver line: `compliance: 108 passed, 2 not-run, 1 failed; evidence …/validation/local/r5nndia2aediccu.json`. Vitest (integration): 88 files (1 failed, 74 passed, 13 skipped), 582 tests (1 failed, 563 passed, 18 skipped). Playwright: 42 tests using 2 workers, 42 passed (16.5m).

## Counts by status (evidence record: 111 results, 109 distinct IDs)

- passed: 108
- not-run: 2
- failed: 1
- blocked: 0

## Failed / blocked / not-run

- **MIG-AC-002 — failed** (1 of 3 tests): `tests/compliance/criteria/mig/deploys.test.ts:109`, "[MIG-AC-002] a second deployment with no changes changes no data, does not stop the app (cloud: it answers throughout), and leaves it answering". The no-change deploy's `dev` start failed: workerd crashed (native stack frames in `workerd` and `libc.so.6`) and wrangler 4.149.0 exited with status 1 before serving. The test's message cuts off the start of the crash output. The wrangler log it names (`/root/.config/.wrangler/logs/wrangler-2026-10-20_23-05-37_327.log`, outside the repo) holds only the startup and bindings lines and no error. Exact failure message (from `raw/vitest.json`):

```
AssertionError: no-change deploy failed (status 1): cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@5a404cd /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@2159d90 /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@215cd18 /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@21430f2 /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@2143108 /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@5b18586 /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@2143154 /lib/x86_64-linux-gnu/libc.so.6@2a1c9 /lib/x86_64-linux-gnu/libc.so.6@2a28a /home/user/cloud-app/.claude/worktrees/agent-a97a1d548a7f53c9e/node_modules/@cloudflare/workerd-linux-64/bin/workerd@2143024
[wrangler] [32mIf you think this is a bug then please create an issue at https://github.com/cloudflare/workers-sdk/issues/new/choose[0m
[wrangler] Note that there is a newer version of Wrangler available (4.151.3). Consider checking whether upgrading resolves this error.
[wrangler] 🪵  Logs were written to "/root/.config/.wrangler/logs/wrangler-2026-10-20_23-05-37_327.log"
dev failed: wrangler exited with status 1 before serving
: expected false to be true // Object.is equality
```

- blocked: none.
- **CORE-AC-006 — not-run (clause entry; another entry passed):** AWS-bundle clause: AWS phase not started
- **SQL-AC-006 — not-run (clause entry; another entry passed):** Data API retry-loop clause: AWS phase not started

## Dev registry check (`~/.config/.wrangler/registry`)

Empty (0 entries) after every step, including after the driver run (see `registry-checks.txt`). No workerd, wrangler, vite, vitest or playwright processes were left running after the driver exited.

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
| MIG-AC-002 | failed | 1 of 3 tests failed: MIG: initial and unchanged deployments, a failing data-dependent migration and its re-run > [MIG-AC-002] a second deployment with no changes changes no data, does not stop the app… (truncated here; full text above) |
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
