# Batch verify 4 (plan §1 "Test economy" rule 3)

- Commit tested: `a5b2164` (origin/claude/implement-local-cloudflare, "Merge integration of DEC-0417", on top of `eb36e1c`)
- Evidence branch: `claude/implement-local-cloudflare-final-local-4`; tracked tree clean before runs
- Local only; no Cloudflare calls. `COMPLIANCE_DEMO_BASE_URL` and `COMPLIANCE_CLOUDFLARE_D1` were unset for every run.
- Method as in batch-verify-3. Offline uses `scripts/offline.sh` in a new network namespace. No extra environment
  was set. No `dial tcp` lines in either log.
- Each run was done once, one after another; nothing was re-run.
- Environment: node v22.22.0, npm 10.9.4, 4 CPUs, Linux 6.18.44-fc-v139 x86_64.

| Run | Command | Exit | Duration | Load avg before -> after (1m) |
|---|---|---|---|---|
| install | `npm ci` | 0 | 10 s | 0.59 -> 0.65 |
| online | `npm run verify` | 0 | 358 s | 0.60 -> 3.54 |
| offline | `unshare -rn sh scripts/offline.sh npm run verify` | 0 | 343 s | 3.07 -> 4.02 |

Full `uptime` lines are in the `*.meta` files; raw output is in the `*.log` files.

## Test counts (identical online and offline)

- Unit (vitest): 179 files, 1706 tests passed (batch-verify-3 at `760e7b7`: 178 files, 1692 tests)
- apps/template verify: sqlite 18 passed / 0 failed / 0 skipped; postgres 18 / 0 / 0
- apps/reference verify: sqlite 52 / 0 / 0; postgres 52 / 0 / 0
- tests/skill/example-pages.test.ts: 1 file, 2 tests passed

## Failures

None.

## Dev registry check (`~/.config/.wrangler/registry`)

Empty (0 entries) at start and after each run: npm ci, online verify, offline verify. See `registry-checks.txt`.
