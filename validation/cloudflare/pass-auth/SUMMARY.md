# Cloudflare pass-auth, 2026-10-25, at 1d9623e

Written by the orchestrator from the runner's report (subagents may not write report files). Logs, traces and usage readings are in `logs/`. A redaction scan of 99 files found no token, account ID, zone ID, subdomain or password.

## Runs
- **Full run** `k9cc5zjcbm5mrkc` (stage `test-k9cc5zjcbm5mrkc`): exit 1. 49 passed, 13 failed, 2 not-run, 12 blocked; leftovers [].
- **Milestone run** `y5cuhf8fwk5khtd` (`--milestone --only PROV-AC-004,MAIL-AC-007`): exit 1. 1 failed, 1 blocked, 7 not-run; leftovers [].

## Failures
| Criteria | First error | Note |
| --- | --- | --- |
| AUTH-AC-005 (admin part), AUTH-AC-006, AUTH-AC-014, CLI-AC-007, E2E-007 | `POST /api/auth/password/sign-up → 403 "Error 1000: DNS points to prohibited IP"` | One root cause, under diagnosis |
| AUTH-AC-011, E2E-008, PWD-AC-009 | `check-login: no recorded deploy output for stage prodcheck` (the driver had just redeployed it) | Harness wiring; COMPL-AC-005 was blocked for a related reason |
| PWD-AC-008 | 6 sign-ins within 60 s answered 400 `AUTH.LOGIN_FAILED` ×6, never 429 | The rate limit is not effective on the deployed stage |
| E2E-005 | "app-facing types exposing login-provider details" | The app-facing contract leaks provider details |
| PROV-AC-002 | `GET /api/ref/schema-version → 404` | Under diagnosis |
| MAIL-AC-007 (milestone run) | "the sending entry is verified … expected false to be true" | The test reads a field the live API does not return |
| SEC-AC-005 | `GET /api/ref/secret → 200` (expected 500 `SEC.MISSING`) | Known; waits on owner question Q12 |
| FILES-AC-003 | `status is storage's HTTP status, got null` | Known; waits on owner question Q4 |

## Blocked and not-run
- **Blocked:**
  - DEMO-AC-001…005, DEMO-AC-007…010 and E2E-002: there is no demo stage.
  - LOG-AC-004, outside-request clause: no fixture.
  - PROV-AC-004:
    - its token check: no restricted token was provided;
    - its fresh-account clause: needs an account where `setup-account` never ran.
    
    Its setup-account-twice part passed.
- **Not-run:**
  - CLI-AC-001 (DEC-0509) and AUTH-AC-005's callback part (no redirect provider, DEC-0513).
  - Left out to stay within budget: E2E-010, E2E-012, PROV-AC-003, PROV-AC-006 and COMPL-AC-008. Their earlier records are still valid.

## Usage
- **API requests:** 1,687 counted (budget 2,000), at most 274 in any 5 minutes, no 429. Pulumi provider calls are not counted, so the real total is higher.
- **D1:** 1,562 rows written and 4,542 read; at most 2 databases at once.
- **Email:** none sent successfully, because every sign-up was refused.

## Account afterwards
- **Stages:** no `test-` stages, and no pending list.
- **Workers:** `prototype-mailsink`, `reference-prodcheck`.
- **D1:** `reference-prodcheck-db-1`.
- **R2:** `prototype-logs`, `prototype-mailsink`, `sst-state`, `reference-prodcheck-files`.
