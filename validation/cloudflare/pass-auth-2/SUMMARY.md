# Cloudflare pass-auth-2, 2026-10-25, at dc00996

Written by the orchestrator from the runner's report (subagents may not write report files). Logs and usage readings are in this folder. A redaction scan of 110 files found no secret or identifier; the only match was the records' commit SHA.

## Runs
- **Full run** `wxnforn019mo5ic` (stage `test-wxnforn019mo5ic`): exit 1. 60 passed, 2 failed, 2 not-run, 12 blocked; leftovers [].
- **check-login** against `prodcheck`, inside the full run: record `g8np1sdqoq1yvgz`, exit 0, all 8 steps passed. The steps were real sign-up, mail through the sink, verification, sign-in, admin grant and revoke, password reset, and the 429 burst.
- **Milestone run** `ykpjdoi5gccpsdv` (`--only PROV-AC-004,MAIL-AC-007`): exit 1. MAIL-AC-007 passed, PROV-AC-004 was blocked, 7 not-run; leftovers [].

## Failures (both known, both waiting on owner decisions)
- **FILES-AC-003**, expired-ticket clause: `status is storage's HTTP status, got null`. Waits on Q4.
- **SEC-AC-005**: `GET /api/ref/secret → 200` (expected 500 `SEC.MISSING`). Waits on Q12.

## Fixed since pass-auth
The sign-up Error 1000, PWD-AC-008 (429 reached), E2E-005, AUTH-AC-011, E2E-008 and PWD-AC-009 now pass.

## Blocked and not-run
- **Blocked:**
  - DEMO-AC-001…005, DEMO-AC-007…010 and E2E-002: there is no demo stage.
  - LOG-AC-004, outside-request clause: no fixture.
  - PROV-AC-002: no token without the R2-token permission.
  - PROV-AC-004: needs an account where `setup-account` never ran, plus a token without an email permission.
- **Not-run:**
  - AUTH-AC-005's callback part (DEC-0513), CLI-AC-001 (DEC-0509) and SKILL-AC-006 (DEC-0509).
  - E2E-010, E2E-012, E2E-015, PROV-AC-003, PROV-AC-006 and COMPL-AC-008 were left out to stay within budget. Their earlier records stand.

## Usage
- **API requests:** 1,952 of 2,000 (full run 1,513, milestone run 415, measurements 24), at most 400 in any 5 minutes, no 429. Pulumi provider calls are not counted.
- **D1:** 1,806 rows written and 4,948 read; at most 2 databases at once.
- **Email:** 4 real emails delivered to the mail sink.

## Account afterwards
- **Stages:** no `test-` stages, and the pending list is empty.
- **Workers:** `prototype-mailsink`, `reference-prodcheck`.
- **D1:** `reference-prodcheck-db-1`.
- **R2:** `prototype-logs`, `prototype-mailsink`, `reference-prodcheck-files`, `sst-state`.
