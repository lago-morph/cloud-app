# Cloudflare passes 2–5 — 2026-10-24, 03:55–04:14 UTC

Written by the orchestrator from the runner's report (subagents may not write report files). Raw evidence in `logs/` (redacted; scan of 89 files found no token, account ID, subdomain or apiKey value; two SHA-256 digests of test secret values replaced). Run stage R `test-9mfkg261apxm7s2`, removed at the end.

## Usage
D1 (written / read / databases): before 754 / 1,510 / 1 → after pass 2 793 / 1,553 / 1 → pass 3 825 / 1,594 / 1 → pass 4 850 / 1,611 / 1 → pass 5 853 / 1,625 / 1 → after removal 853 / 1,649 / 0. This run: 99 written, 139 read.
API requests counted: pass 2 100, pass 3 106, pass 4 88, pass 5 23, troubleshooting 2, `remove` 42, measurements 28 = 389 (SST/Pulumi not traced; estimate 650–700 in all, worst case 1,469); at most 139 in any 5 minutes; no HTTP 429.

## Results
| Pass | Record | Result |
| --- | --- | --- |
| 2 (further stage) | `cwcrlz8fxgo3ud4` | SEC-AC-003 passed; CLI-AC-004 passed; **SEC-AC-001 and HTTP-AC-002 failed**: `GET /api/ref/secret → status 200, code none (expected status 500 with code SEC.MISSING)`; **SEC-AC-005 failed**: the request after `secrets set` saw a different value; LOG-AC-004 blocked (outside-request clause: no fixture, DEC-0277…0280; removal clause passed) |
| 3 | `5tr1c8w0x1b9lai` | CF-AC-002 passed |
| 4 | `2nl855v5sscoqls` | CLI-AC-005 passed |
| 5 | `0ljocvikeb16ebm` | E2E-014 passed (both tests, cloud part included) |
| E2E-011 troubleshooting | — | passed: the skill's list command found the `throw-plain` request's key and the read command returned the `CORE.INTERNAL` entry (the first attempt was a runner-script path error before any API request; both logs kept) |

All records: leftovers []. 

## Removal (DEC-0334 check 9)
`remove --stage test-9mfkg261apxm7s2` exit 0 ("deleted database …-db-1", "removed stage …"). The Worker was deleted by SST/Pulumi; the framework's direct `DELETE …/workers/scripts/<name>?force=true` was not observed in this run. Afterwards: no Workers, 0 D1 databases, 0 `sst-state` objects; R2 holds only `prototype-logs` and `sst-state`.
