# Cloudflare pass C-1 — E2E-009 after the R2 key fix — 2026-10-24

Written by the orchestrator from the runner's report. Base ad0e252; stage `test-aufdf24vgdoqnph`; record `5nfl3uhrzxpuz4m` (exit 0; leftovers []). Redaction scan of 73 files: 0 hits.

- D1 (written / read / databases): before 2,088 / 5,711 / 0 → after deploy 2,120 / 5,728 / 1 → after driver 2,120 / 5,752 / 1 → after removal 2,120 / 5,752 / 0 (32 written, 41 read).
- API requests: 106 (deploy 31, secret 1, redeploy 19, remove 35, measurements 20); at most 78 in any 5 minutes; no HTTP 429.
- Sequence: first deploy exit 1 as designed (apiKey unset); `secrets set apiKey` exit 0; redeploy exit 0; `--only E2E-009` **passed** (34.1 s); `remove` exit 0.
- Afterwards: 0 Workers, 0 D1 databases, 0 `sst-state` objects; R2 only `prototype-logs` and `sst-state`.
