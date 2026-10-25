# Cloudflare pass 1c — 2026-10-24

**Archived 2026-10-25** to branch `archive/implement-local-cloudflare` (same paths; `ai/ARCHIVE.md`, then `ARCHIVE-INDEX.md` there): the record `sysad9rajoir4yt` (`../sysad9rajoir4yt.json` and `raw/`); `xdryowrec3lephb` stays here.

Written by the orchestrator from the runner reports (subagents may not write report files). Raw evidence in `logs/` (redacted; a scan of all 71 files found no token, account ID, subdomain, apiKey value or 32-hex string). Run stage R: `test-9mfkg261apxm7s2`, kept for later passes. The first driver run was killed by a container restart during its last test (log `4-driver.log`, no record); the driver was re-run once (runner loss).

## Usage
| Reading (UTC) | D1 rows written | D1 rows read | D1 databases |
| --- | --- | --- | --- |
| 03:08 before the pass | 0 | 0 | 0 |
| 03:32 before the re-run | 393 | 772 | 1 |
| 03:51 after | 754 | 1,510 | 1 |

Cloudflare API requests: about 176 counted, no HTTP 429. First deploy 31 framework + 37 SST; `secrets set` 1; redeploy 19 + 28; killed driver run 9; driver re-run 9; milestone run 27; measurements 15. Per SST run (state calls logged): 18, 19, 14, 14; Pulumi provider calls (e.g. the asset upload) are not logged.

## Deploy (DEC-0334 check 10, DEC-0356)
- First deploy: exit 1 as designed, "required secrets are not set: apiKey"; `secrets set apiKey` exit 0; redeploy exit 0 (database `…-db-1`).
- Check 10 **pass**: step 3 bucket-only (untargeted, fix-pass1); step 5 created the Worker with `DB`/`FILES`/`LOGS`, variables and assets; the redeploy's `--target Files` run left all 8 resources unchanged and the Worker secrets stayed set; SST used the `sst-state` home.
- DEC-0356 **confirmed live**: the static assets uploaded (CF-AC-001 passed). The 401 of pass 1b is gone (DEC-0420).

## Results (records `xdryowrec3lephb.json`, milestone `sysad9rajoir4yt.json`, leftovers [] in both)
- **Passed (36):** AUTH-AC-004, -006, -007, -009 (production part not-run: Google mocked), CF-AC-001, CFG-AC-003, -004, -005, COMPL-AC-001, -003, CORE-AC-002, -003, E2E-005, -009, -011, -013, FILES-AC-002, -004, -005, HTTP-AC-001, -003, -004, -005, KV-AC-001…-005, LOG-AC-001, -002, -005, SEC-AC-002, SQL-AC-003…-006.
- **Failed (3):**
  - FILES-AC-001 (list order across pages): `expected [ …(7) ] to strictly equal [ …(7) ]` — R2 returned `…/a` after `…/a b` and `…/a/b`; code-point order puts it first.
  - FILES-AC-003 expired-ticket clause: `status is storage's HTTP status, got null` — expected (owner question Q4, DEC-0101).
  - E2E-004 coverage part: `applicable on cloudflare but no tagged test in this target's suite: AUTH-AC-005` (record part passed).
- **Not-run:** AUTH-AC-005 (no tagged test ran on cloudflare).
- **Blocked:** PROV-AC-004 fresh-account clause (needs an account where `setup-account` never ran); its setup-account-twice part passed.
- E2E-011's troubleshooting `curl` check was not scheduled in this pass.

## Resources left (R kept)
Worker `reference-test-9mfkg261apxm7s2`; D1 `reference-test-9mfkg261apxm7s2-db-1`; R2 `prototype-logs`, `reference-test-9mfkg261apxm7s2-files`, `sst-state` (14 objects of R).
