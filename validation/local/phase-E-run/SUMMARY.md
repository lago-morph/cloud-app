# E-RUN — test runner record (local only)

Runner: E-RUN test-runner subagent (did not author the skill or the tests). Results are recorded, not judged; the evaluator (E-EV) decides status.

- Branch: `claude/implement-local-cloudflare-e-run`, from `origin/claude/implement-local-cloudflare` at `4d73f396a1219d28e8a49bbbcb6803984c6abac6`. Tracked tree clean at start (see `environment.txt`).
- Environment: Node v22.22.0, npm 10.9.4, Linux 6.18.44 x86_64, 4 CPUs; load average ~7–10 from other sessions on the host during the run.
- Cloudflare: **no Cloudflare calls were made** (owner direction, DEC-0317).
- No code or tests were changed.

## Commands and exit codes

| Step | Command | Exit | Raw output |
| --- | --- | --- | --- |
| 1 | `npm ci` | 0 | `raw/01-npm-ci.log` |
| 2 | `npm run build -w packages/framework` | 0 | `raw/02-build-framework.log` |
| 3 | `npm run verify` | 0 | `raw/03-verify.log` |
| 4 | `npx vitest run --config vitest.integration.config.ts tests/skill` | 0 | `raw/04-tests-skill.log` (4 files, 26/26 tests passed, 261 s) |
| 5 | `npm run compliance -- --target local --only SKILL-AC-001,SKILL-AC-002,SKILL-AC-003,SKILL-AC-004,SKILL-AC-005,CHECK-AC-003` | **1** | `raw/05-compliance-local.log`; evidence `validation/local/2au29i3yycjzbas.json`, driver raw output `validation/local/2au29i3yycjzbas/raw/` |

Exit codes are also listed in `raw/exit-codes.txt`.

## Driver evidence record `2au29i3yycjzbas` (target local, commit 4d73f39)

Totals: 6 passed, 103 not-run (all 103 with detail "not selected for this run (--only)"), `exitStatus` 1.

| ID | Recorded status | Tagged tests executed (from `raw/vitest.json`) |
| --- | --- | --- |
| SKILL-AC-001 | passed | 7 passed |
| SKILL-AC-002 | passed | 3 passed |
| SKILL-AC-003 | passed | 9 passed |
| SKILL-AC-004 | passed | 7 passed |
| SKILL-AC-005 | passed | 2 passed |
| CHECK-AC-003 | passed | 15 passed |

## Failures

- **Driver exit 1 — suite load failure in a non-selected file.** `tests/compliance/criteria/compl/targets.test.ts` failed to load (0 tests ran in it); vitest reported "Test Files 1 failed | 6 passed | 77 skipped (84)". Error (also in `validation/local/2au29i3yycjzbas/raw/run-errors.log`):

  ```
  Error: docs/decisions/decision-log.md: unexpected target "\"a unit test of the report generator shows a criterion whose test has lost its tag as untested.\" names a unit test." in Where "\"A unit test of the report generator shows a criterion whose test has lost its tag as untested.\" Names a unit test."
   ❯ tests/compliance/criteria/compl/support.ts:170:13 (readWhere / whereSets)
   ❯ tests/compliance/criteria/compl/targets.test.ts:22:17
  ```

  The Where parser in `tests/compliance/criteria/compl/support.ts` throws on a "Where" text found in `docs/decisions/decision-log.md`. This file carries none of the six selected IDs, and none of the six IDs is recorded failed. Not diagnosed here (runner role); it needs a diagnoser.

No other failures. `npm run verify` and the `tests/skill` run had none.

## Not done: E2E-011 Cloudflare re-run — blocked

The E-RUN item also re-runs E2E-011 (log lookup using only the E-02 commands) on a fresh Cloudflare `test-` stage. **This was not run.** Status: **blocked**. Reason: the owner stopped Cloudflare use after the D1 daily row limit was exhausted ("D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset", DEC-0317). No stage was created, so there was nothing to remove. No D1 usage measurement was taken, because no Cloudflare work was done. It must be re-run, with the before/after D1 measurement of plan §1, once the owner lifts the stop.
