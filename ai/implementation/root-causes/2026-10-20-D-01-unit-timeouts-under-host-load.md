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

## Addendum: offline run (`unshare -rn sh scripts/offline.sh npm run verify`, ~04:42 UTC)
12 failures. 3 were timeouts again (PGlite, `cli/verify/type-check`, and D-01's own `settings.workerd.unit.test.ts` first request into workerd). D-01 gave its workerd-backed suites the 60 s allowance `build.unit.test.ts` already uses for workerd. 9 were in `evidence/writer.unit.test.ts` and are not timeouts: the test's `git commit` fails because this sandbox's global git config signs commits through a helper (`environment-runner code-sign`) that calls an MCP server on `127.0.0.1:45463`, which does not exist inside the new network namespace ("dial tcp 127.0.0.1:45463: connect: connection refused"). That is the sandbox's git signing configuration, not framework code; D-01 does not touch `src/evidence/**`. Proposed fix (owner of `src/evidence/**` or `scripts/offline.sh`): have the test's git calls pass `-c commit.gpgsign=false`, or have the offline wrapper set `GIT_CONFIG_GLOBAL=/dev/null`.

## Re-runs (verification)
- ~05:07 UTC, `npm run verify` (load ≈ 14): exit 0; 145 files, 1433 tests passed.
- ~05:15 UTC, offline `npm run verify`: 1424 passed, 9 failed, all in `evidence/writer.unit.test.ts` with the git-signing error above; no timeouts. The `/root/.gitconfig` sets `commit.gpgsign true` with `gpg.ssh.program /tmp/code-sign`, which needs the loopback service outside the namespace.

## Integrator note (2026-10-20, appended; the text above is unchanged)

This record's Review was left pending. The same cause (unit-test timeouts when the host is loaded) is covered by `2026-10-20-D-04-verify-unrelated-failures.md`, whose Review is ACCEPTED. Its fix is recorded in `2026-10-20-verify-fixes.md`, and the global unit-test timeout in `2026-10-20-global-unit-timeout-review.md`. Read those for the reviewed causal chain and the fix.

## Review (independent reviewer, prompt §8 step 2, 2026-10-20)

**Verdict: ACCEPTED.** This covers the cause and the decision to rely on the D-04 fix. The reviewer did not write this record, D-04, or any of the fixes. Branch `claude/implement-local-cloudflare-rc-final-review`, from `origin/claude/implement-local-cloudflare` `7f8c5c0`. I checked the code and the committed evidence. No test suite was run for this record.

Reasons:
- **The evidence supports every link.**
  - Every failure is the 5 s default ("Test timed out in 5000ms"). None is an assertion failure.
  - The same files pass when run alone, and the set of failing tests changes between runs.
  - The load was about 7 times the CPU count, and `ps` showed other worktrees' processes.
  - The same chain was reproduced on its own and accepted in `2026-10-20-D-04-verify-unrelated-failures.md` (Review) and in `2026-10-20-global-unit-timeout-review.md`. There, under artificial load, the same tests pass when only the limit is raised.
- **A D-01 regression is ruled out.** The D-01 merge `b3aa9a1` touches nothing under `src/kv/`, `src/sql/`, `src/cli/verify/` or `src/evidence/` (`git diff --stat b3aa9a1^1 b3aa9a1`). The record's own "not proven" point stays open: D-01's workerd suites may add CPU load in the same run. That does not matter for the fix, which works whoever adds the load.
- **The fix covers every test this record names, and weakens none.**
  - The global limit is `vitest.unit.config.ts:12`, `testTimeout: 30_000` (commit `9755706`). The named tests also have their own limits:
    - `kv/service.unit.test.ts:22,150,167,176` (`MANY_PUTS_TIMEOUT_MS`, which covers "limit above PAR-222");
    - `sql/postgres.unit.test.ts:27,40` ("gives every call its own empty database");
    - `sql/queries.unit.test.ts:223` ("cannot be reached");
    - `cli/verify/type-check.unit.test.ts:24,32,41,46` (the type-check timeout in the offline addendum).
  - D-01's own workerd suite has `{ timeout: 60_000 }` at `targets/cloudflare/settings.workerd.unit.test.ts:78`. That matches the existing workerd allowance.
  - The offline `evidence/writer.unit.test.ts` failures in the addendum were fixed by making the test hermetic, not by relaxing it. See `HERMETIC_GIT_ENV` at `evidence/writer.unit.test.ts:15` (commit `9d866f4`). The red and green runs are in `2026-10-20-verify-fixes.md`.
  - No assertion changed. The timing tests measure time themselves and do not depend on `testTimeout`. This was checked in `2026-10-20-global-unit-timeout-review.md`, "Does a global 30 s timeout weaken any test?". A real hang still fails, after 30 s instead of 5 s.
- **Verification.** With the D-04 fix, a full `npm run verify` passed both online and offline (`2026-10-20-verify-fixes.md`, and "Fix" in `2026-10-20-global-unit-timeout-review.md`). This record's own re-run at 05:07 UTC was also green.

Required follow-up: none for this record. `2026-10-20-verify-fixes.md` lists two more load-sensitive tests. The global 30 s limit covers them.
