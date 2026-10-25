# Cloudflare pass C (re-run of fixed criteria) — 2026-10-24

Written by the orchestrator from the runner's report. Run stage R2 `test-byxa6sar2ps05po`. The first runner was killed by a container restart during step 1 (log `logs/4-driver.log`, no record); the resumed runner re-ran step 1 once and continued. Redaction scan (pass C + F-03, 188 files): 0 hits; two SHA-256 digests of test secret values replaced.

## Usage
D1 (written / read / databases): before deploy 1,872 / 5,152 / 0 → after deploy 1,896 / 5,167 / 1 → resume 1,904 / 5,193 / 1 → after step 2 1,943 / 5,214 / 1 → after removal 1,943 / 5,214 / 0.
API requests counted: first runner 61 (deploy 31, secret 1, redeploy 19, measurements 10); step 1 rerun 0 (183 to the Worker, 5 to R2 storage); step 2 90; remove 36; measurements 20 = 207; at most 136 in any 5 minutes; no HTTP 429.

## Results
| Step | Record | Result |
| --- | --- | --- |
| 1 | `gblenqeyh7kuls5` | FILES-AC-001 (with the U+0001 key fix), -002, -004, -005, AUTH-AC-005 and E2E-004 passed; **FILES-AC-003 failed** (1 of 5 tests, the expired-ticket clause: `status is storage's HTTP status, got null` — owner question Q4, DEC-0101) |
| 2 | `651l3x1zgz7pbx5` | SEC-AC-001 and HTTP-AC-002 passed (cloud SEC.MISSING clause, with the bounded wait); **SEC-AC-005 failed** as expected (`the next request after secrets set: expected { sha256 } to deeply equal { sha256 }`) — owner decision pending (root cause 2026-10-24-pass2-SEC-AC-005) |

Removal: `remove` exit 0; afterwards no Workers, 0 D1 databases, 0 `sst-state` objects; R2 only `prototype-logs` and `sst-state`. Leftovers [] in both records.
