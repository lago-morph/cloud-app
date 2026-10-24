# F-03 — the demo on Cloudflare — 2026-10-24

Written by the orchestrator from the runner's report. Demo stage `test-s6jca41ew34ahz3`; commit 321e41c; `apps/demo` tree 6dcb8f41c576ad77b7a37604496cdba8992f4413.

## Usage
D1 (written / read / databases): before 1,943 / 5,214 / 0 → after smoke 1,962 / 5,263 / 1 → before removal 2,080 / 5,665 / 1 → after removal 2,080 / 5,665 / 0 (137 written, 451 read).
API requests counted: deploy 31 (stopped on unset shareKey, as designed), secret 1, redeploy 19, DEMO-AC-008 3, remove 35, measurements 18 = 107; at most 59 in any 5 minutes; no HTTP 429.

## Results
| Check | Record | Result |
| --- | --- | --- |
| `smoke --target cloudflare` | `vn8cm0ie7v2rhul` | 7/7 passed |
| `smoke --target local` (demo `dev`) | `kbe5rzjb8ls9p8z` | 7/7 passed |
| Source difference (E2E-002 Cloudflare and local parts, DEMO-AC-010) | — | both smokes from the same commit and `apps/demo` tree; `git diff --quiet HEAD -- apps/demo` exit 0, nothing untracked |
| Demo criteria on Cloudflare | `nu3lt4mhjsn4ihq` | DEMO-AC-001, -002, -003, -004, -005, -007, -009 passed |
| DEMO-AC-008 alone (one worker, `COMPLIANCE_DEMO_STAGE`) | `pqc4u7j4o1g4rpb` | passed |

Removal: `remove` exit 0; nothing left (no Workers, 0 D1 databases, 0 `sst-state` objects; R2 only the shared buckets). Leftovers [] in both records.
