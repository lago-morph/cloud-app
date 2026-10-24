# Cloudflare pass B — 2026-10-24, 04:19–04:46 UTC

Written by the orchestrator from the runner's report. Commit 24327c7; no run stage (`--base-url https://no-run-stage.invalid`). Each step ran once. Redaction scan of 75 files: only the records' commit SHA matched.

## Usage
D1 (written / read / databases): before 853 / 1,649 / 0 → after PROV-AC-001 873 / 1,673 / 0 → after COMPL-AC-004 905 / 1,714 / 0 → after MIG 1,267 / 3,101 / 0 → after PROV-AC-002 1,365 / 3,448 / 0. This run: 512 written, 1,799 read.
API requests counted (Node traces + measurement curls): PROV-AC-001 88, COMPL-AC-004 111, MIG 448, PROV-AC-002 161, measurements 25 = 833; at most 214 in any 5 minutes; no HTTP 429. SST/Pulumi calls not traced.

## Results
| Step | Record | Result |
| --- | --- | --- |
| Pass 6 | `5fgih0buv8i5tc3` | PROV-AC-001 passed |
| Pass 7 | `5kjbwwwpf3mvj95` | COMPL-AC-004 passed |
| MIG | `ghref0pc0a9bwmp` | MIG-AC-002 (2 tests), MIG-AC-003 (3 tests), MIG-AC-006 (1 test) passed |
| PROV-AC-002 | `5swm2wowq7t3yho` | blocked: 4 of 5 tests passed (credential removed; clean deploy and health; failing migration; secret removed by hook); the restricted-token test needs `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`, not set |

All records: leftovers []. After every step and at the end: no Workers, 0 D1 databases, 0 `sst-state` objects; R2 only `prototype-logs` and `sst-state`.
