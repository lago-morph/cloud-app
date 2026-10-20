# Batch verify 3 (plan §1 "Test economy" rule 3)

- Commit tested: `760e7b7` (origin/claude/implement-local-cloudflare, "Merge integration of DEC-0415/0416", on top of `50281bc`)
- Evidence branch: `claude/implement-local-cloudflare-final-local-3`; tracked tree clean before runs
- Local only; no Cloudflare calls. `COMPLIANCE_DEMO_BASE_URL` and `COMPLIANCE_CLOUDFLARE_D1` were unset for every run.
- Method as in batch-verify-2. Offline uses `scripts/offline.sh` in a new network namespace. No extra environment
  was set. No `dial tcp` lines in either log.
- Each run was done once, one after another; nothing was re-run.

| Run | Command | Exit | Duration | Load avg before -> after (1m) |
|---|---|---|---|---|
| install | `npm ci` | 0 | 9 s | 1.12 -> 1.27 |
| online | `npm run verify` | 0 | 367 s | 1.25 -> 3.84 |
| offline | `unshare -rn sh scripts/offline.sh npm run verify` | 0 | 339 s | 2.53 -> 3.52 |

Full `uptime` lines are in the `*.meta` files; raw output is in the `*.log` files.

## Test counts (identical online and offline)

- Unit (vitest): 178 files, 1692 tests passed (batch-verify-2 at `1487c7d`: 1687)
- apps/template verify: sqlite 18 passed / 0 failed / 0 skipped; postgres 18 / 0 / 0
- apps/reference verify: sqlite 52 / 0 / 0; postgres 52 / 0 / 0
- tests/skill/example-pages.test.ts: 1 file, 2 tests passed

## Failures

None.

## Dev registry check (`~/.config/.wrangler/registry`)

Empty (0 entries) at start and after each run: npm ci, online verify, offline verify. See `registry-checks.txt`.
