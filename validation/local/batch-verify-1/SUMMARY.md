# Batch verify 1 (plan §1 "Test economy" rule 3)

- Commit tested: `2901e948fd75cbfd573079e841c17f7cf4d02cf9` (origin/claude/implement-local-cloudflare)
- Branch: `claude/implement-local-cloudflare-batch-verify-1`, clean tree before runs
- Local only; no Cloudflare calls.

| Run | Command | Exit | Duration | Load avg before -> after (1m) |
|---|---|---|---|---|
| install | `npm ci` | 0 | 11 s | 0.94 -> 1.24 |
| online | `npm run verify` | 0 | 525 s | 1.14 -> 5.98 |
| offline | `unshare -rn sh scripts/offline.sh npm run verify` | 0 | 439 s | 5.58 -> 3.87 |

Full `uptime` lines are in the `*.meta` files; raw output is in the `*.log` files.

## Test counts (identical online and offline)

- Unit (vitest): 178 files, 1689 tests passed
- apps/template verify: sqlite 18 passed / 0 failed / 0 skipped; postgres 18 / 0 / 0
- apps/reference verify: sqlite 52 / 0 / 0; postgres 52 / 0 / 0
- tests/skill/example-pages.test.ts: 1 file, 2 tests passed

## Failures

None. The error-level JSON log lines in the logs come from tests that passed.
