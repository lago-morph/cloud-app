# Unit-test timeouts in PGlite/KV suites during D-01's `npm run verify`

## Symptom
`npm run verify` on branch `claude/implement-local-cloudflare-d-01` (2026-10-20 ~04:10 UTC) failed in `test:unit`: 2 of 1433 tests ("Test timed out in 5000ms"): `kv/service.unit.test.ts` "limit above PAR-222 is clamped…" and `sql/postgres.unit.test.ts` "gives every call its own empty database". A second full `npm run test:unit` (~04:20) had 6 timeouts in the same files plus `sql/queries.unit.test.ts` (postgres "cannot be reached"), duration 519 s.

## Evidence
- Every failure is the 5 s Vitest default timeout, none an assertion failure.
- All failing tests are in PGlite/KV suites; D-01 changed none of `src/kv/**`, `src/sql/**` or anything they import (D-01's diff: `src/log/cloudflare/**`, `src/targets/cloudflare/**`, docs).
- The two failing files run alone: `2 passed, 24 tests passed`.
- `uptime` at 04:28: load average 28.32 / 25.74 / 18.88 on `nproc` = 4. `ps` showed concurrent `tsc`, Vitest and Playwright processes from other agents' worktrees (`agent-ad061b3c…`, `agent-a8c74719…`, `agent-a58040d9…`, `agent-ad8c36d0…`).
- The set of failing tests differs between runs (2, then 6), all timeouts.

## Causal chain
1. The host runs several phase-D agents' builds and test suites at once (load ≈ 7× CPUs; `ps`).
2. PGlite tests are CPU-bound (WASM Postgres start-up per database, DEC-0135 notes seconds per first database even unloaded); under that load single tests exceed 5 s (timeouts in exactly those suites).
3. Vitest reports them as failures (error text "Test timed out in 5000ms").
Not proven: that no D-01 change adds load in the same run — D-01 adds three test files that start workerd (`worker.unit.test.ts`, `settings.workerd.unit.test.ts`), which add some CPU work in the same suite.

## Alternatives ruled out
- A D-01 code change breaking KV/SQL: those files pass alone on the same tree; D-01 touches no code they import.

## Proposed fix
None to code. Re-run `npm run verify` when the host load is normal (load < 8); report that run.

## Verification plan
Re-run `npm run verify` and the offline form at normal load; both must be green.

## Review
(pending — independent reviewer)
