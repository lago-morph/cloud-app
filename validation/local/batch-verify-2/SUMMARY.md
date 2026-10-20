# Batch verify 2 (plan §1 "Test economy" rule 3)

- Commit tested: `1487c7d` (origin/claude/implement-local-cloudflare, "Merge integration of DEC-0413/0414")
- Branch: `claude/implement-local-cloudflare-batch-verify-2`, clean tree before runs
- Local only; no Cloudflare calls. `COMPLIANCE_DEMO_BASE_URL` and `COMPLIANCE_CLOUDFLARE_D1` were unset for every run.
- Method as in batch-verify-1. Offline uses `scripts/offline.sh` in a new network namespace. The hermetic
  config is the one built into `packages/framework/src/evidence/writer.unit.test.ts` (global config /dev/null,
  no system config); no extra environment was set. No `dial tcp` lines in any log.
- Each run was done once; nothing was re-run.

| Run | Command | Exit | Duration | Load avg before -> after (1m) |
|---|---|---|---|---|
| install | `npm ci` | 0 | 11 s | 0.16 -> 0.74 |
| online | `npm run verify` | 0 | 419 s | 0.68 -> 4.30 |
| offline | `unshare -rn sh scripts/offline.sh npm run verify` | 0 | 420 s | 3.35 -> 3.99 |

Full `uptime` lines are in the `*.meta` files; raw output is in the `*.log` files.

## Test counts (identical online and offline)

- Unit (vitest): 178 files, 1687 tests passed (batch-verify-1 at `2901e94`: 1689)
- apps/template verify: sqlite 18 passed / 0 failed / 0 skipped; postgres 18 / 0 / 0
- apps/reference verify: sqlite 52 / 0 / 0; postgres 52 / 0 / 0
- tests/skill/example-pages.test.ts: 1 file, 2 tests passed

## Failures

None. The error-level JSON log lines in the logs come from tests that passed.
