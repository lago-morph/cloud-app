# Pass 4 — Cloudflare automated pass and demo stage (2026-10-25)

Code: `claude/better-auth` at 49b78b7. Logs: `logs/` and `demo-logs/`, redacted; a scan of 176 new files found no token, account ID, zone ID or subdomain.

## Preparation
- **Leftover stage:** `remove --target cloudflare --stage test-wkj70sooa7z9xav` (34 API calls) deleted the pass-3 leftover stage, and the inventory confirms it is gone.
- **Old token:** before deleting it, I checked that `prodcheck` uses `prototype-r2-signing`:
  - its tickets carry that token's access key;
  - an upload, a download and a delete through them worked, and the downloaded bytes matched.
  
  Then `reference-prodcheck-files-signing` was deleted (HTTP 200).
- **Local check:** CORE-AC-001 passed (`validation/local/eos4jdelyobnni8`), which confirms the fix.

## Automated Cloudflare pass (`02yo2n87eya5fp5`, 21:46Z to about 23:24Z)
**59 passed, 5 failed, 10 blocked, 2 not run. No leftovers.**

- **Blocked by design:** the DEMO criteria and E2E-002, which this pass cannot reach.
- **Not run:** AUTH-AC-005's callback part (DEC-0513) and CLI-AC-001 (DEC-0509).
- **Inline images on Cloudflare:** FILES-AC-003 passed. A direct presigned GET with `response-content-type=image/png` came back as inline `image/png` for an object stored as `application/octet-stream`.
- **Everyday token:** its deploy passed (DEC-0551). Preflight, deploy, stop and start all worked without any API-token permission.

| Failure | Diagnosis (by the runner, not yet reviewed) |
|---|---|
| PWD-AC-009 / E2E-008: check-login step 8 got no 429 | The sandbox's requests leave through several IPs. Prodcheck's `__framework_auth_rate_limit` table showed `/sign-in/email` with count 4 for each of two IPs, so the per-IP limit of 5 was never reached. Step 8 assumes one client IP. |
| MIG-AC-003 | The previous version was re-enabled at 22:38:09.886Z. The test's first request, 1.9 s later, got an edge 404 with no requestId; it does not wait for the route to answer again. |
| PROV-AC-002, failing-migration test | `provision/core/deploy.ts:104` prints the "copied database …" line only on success, so a failed migration's copy is never reported, which DEC-0545 expects. |
| PROV-AC-002, credential-removed test | It timed out after 15 minutes. The pass-3 kill left a stale lock `/tmp/c-t1-further-stage.lock`, and the PID in it had been reused by another process. The runner removed the lock at 22:25Z; the test needs a re-run. |
| SEC-AC-005 | After `secrets set`, request 4 of 5 consecutive requests (counted from the first that saw the new value) still saw the old value. Cloudflare propagates a secret unevenly within PAR-310. |

## Demo stage (`test-z8ey6q3j123mpoe`, left deployed)
**Smoke checks passed** on Cloudflare and locally, 7/7 each (`3yv6g7d85p5zgln`, `validation/local/7r5e8mas3l00u5t`), with no difference in `apps/demo`.

**Demo criteria** (`nyfty5q3amybl55`): DEMO-AC-001, 002, 003, 004, 005, 007 and 009 passed. **DEMO-AC-008 failed** (`lwqhmd08zi8j656`):
- Both info entries are in `prototype-logs`, with app, stage and requestId.
- Cloudflare's clock was 2.3–4.4 s ahead of the sandbox's, beyond the test's `MARGIN_MS = 2_000` (`demo-criteria.spec.ts:595`).

## Budget
- **Automated pass:** 1,809 API calls (including 164 SST state calls), at most 236 in any 5 minutes, no 429. D1: 1,696 rows written, 4,960 read.
- **Demo pass:** 263 API calls. D1: 176 rows written, 551 read.
- Pulumi provider calls were not counted.

## Left behind
- The demo stage and `prodcheck`, both intended.
- One `compliance-r2read-*` token, expiring at 00:06Z. The driver's leftover check does not report this kind of token.
