# Phase D merge: local verify run (test runner record)

Branch `claude/implement-local-cloudflare-staging-d` at `704a453` (Merge D-T). Local only; no Cloudflare calls.
Offline form (plan §10.2): `unshare -rn sh scripts/offline.sh npm run verify`.

| Step | Exit | Load before (1/5/15 min) | Load after (1/5/15 min) | Wall clock |
| --- | --- | --- | --- | --- |
| `npm ci` | 0 | 11.34, 15.23, 17.73 (05:56:03) | 11.98, 15.18, 17.67 (05:56:18) | ~15 s |
| `npm run verify` (online) | 0 | 11.98, 15.13, 17.64 (05:56:21) | 15.41, 17.18, 17.76 (06:12:13) | ~15 m 52 s |
| `npm run verify` (offline) | 0 | 14.46, 16.85, 17.64 (06:12:36) | 23.90, 20.23, 18.13 (06:26:30) | ~13 m 54 s |

Counts (identical online and offline):
- build, typecheck, lint: passed
- `test:unit` (Vitest): 166/166 files, 1570/1570 tests passed (Vitest duration 451.19 s online, 319.49 s offline)
- `apps/template` verify: passed; tests sqlite 14 passed / 0 failed / 0 skipped, postgres 14 / 0 / 0
- `apps/reference` verify: passed; tests sqlite 52 passed / 0 failed / 0 skipped, postgres 52 / 0 / 0

Failing tests: none. The `"severity":"error"` JSON lines in the logs are stderr echoes from unit tests that force error paths (in-memory sink), not test failures.

Raw output: `npm-ci.log`, `verify-online.log`, `verify-offline.log`, `*.exit`, `uptime-*.txt`.
