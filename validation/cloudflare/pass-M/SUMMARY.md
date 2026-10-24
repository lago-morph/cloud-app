# Cloudflare milestone pass (D-RUN-M) — 2026-10-24, 04:49–05:16 UTC

Written by the orchestrator from the runner's report. Commit 6417611; no run stage; `--milestone`; each step ran once. Redaction scan of 75 files: only the records' commit SHA matched.

## Usage
D1 (written / read / databases): before 1,365 / 3,484 / 0 → after E2E-010 1,488 / 3,986 / 0 → after E2E-012 1,554 / 4,098 / 0 → after PROV-AC-003/006 1,672 / 4,291 / 0 → after COMPL-AC-008 1,821 / 4,788 / 0. This run: 456 written, 1,304 read.
API requests counted: E2E-010 163, E2E-012 189, PROV-AC-003/006 320, COMPL-AC-008 321, measurements 25 = 1,018; at most 268 in any 5 minutes; no HTTP 429. SST/Pulumi calls not traced.

## Results
| Step | Record | Result |
| --- | --- | --- |
| 1 | `xxiuurmy40pnr33` | E2E-010 passed |
| 2 | `e22y1n7jn93xoz4` | E2E-012 passed |
| 3 | `6e5ya5y8z05u4ce` | PROV-AC-003 passed; PROV-AC-006 passed (Cloudflare clean-machine part; AWS region part not run) |
| 4 | `0reagqr1j01rqfv` | COMPL-AC-008 passed (both abort points: after copy and after code) |

No failures. Leftovers [] in every record; after every step and at the end: no Workers, 0 D1 databases, 0 `sst-state` objects, R2 only `prototype-logs` and `sst-state`.
