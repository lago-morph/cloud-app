# Root cause: three unit tests exceed Vitest's 5 s default timeout during D-03's `npm run verify`

## Symptom
D-03's first `npm run verify` (2026-10-20 ~04:30 UTC) failed `test:unit` with 3 of 1467 tests failing, each with `Error: Test timed out in 5000ms`:
- `src/sql/postgres.unit.test.ts`: "gives every call its own empty database" (5244 ms)
- `src/sql/queries.unit.test.ts`: "a database that cannot be reached is SQL.UNAVAILABLE; a forced outage too"
- `src/cli/verify/type-check.unit.test.ts`: "passes a clean app, and an app with no TypeScript files" (5207 ms)

## Evidence
- `uptime` while the tests ran: load average 22.90 / 25.12 / 20.46 on `nproc` = 4. Other agents (D-01, D-02, D-04, D-T1, D-T2) were running in parallel on the same machine.
- Re-running the three files alone right afterwards at the same load: two passed, and `type-check` failed again in 7164 ms.
- Re-running `type-check` and `postgres` with `--testTimeout 60000` (load 20.6): all 6 tests passed. So the assertions hold and only elapsed time exceeds the bound.
- None of the three files, and nothing they import, was changed by D-03. D-03 changed only `src/provision/cloudflare/**` and `ai/implementation/**` (`git diff --stat origin/claude/implement-local-cloudflare`).

## Causal chain
1. Several agents run CPU-heavy work (tsc, PGlite, vitest forks) at once. Evidence: load ≈ 21–25 on 4 CPUs.
2. These tests do CPU-bound work per test: PGlite start-up, and a `tsc` run over a fixture app. Under that contention they take 5.2–7.2 s. Evidence: the measured durations above.
3. Vitest's default per-test timeout is 5000 ms (`vitest.unit.config.ts` sets none), so they fail. Evidence: the error text, and the pass with a longer timeout.

## Alternatives ruled out
- A regression from D-03: ruled out. D-03 touches no code on these tests' paths, and the tests pass when given time.
- Network: ruled out. The tests are offline; the offline `verify` run is reported separately.

## Proposed fix
None in D-03's paths. If parallel waves keep loading the machine, the owner of `vitest.unit.config.ts` (an integrator) may raise `testTimeout` for these CPU-bound unit tests. Otherwise, run `verify` when the machine is less loaded. D-03 does not change the tests (prompt §8).

## Verification plan
Re-run `npm run verify` (and the offline run) once the load is lower. The result is reported in D-03's hand-back.

## Addendum: the offline run (`unshare -rn sh scripts/offline.sh npm run verify`, ~04:40 UTC, load ≈ 16–19)
The three timeouts did not recur. 10 other tests failed:
- **`src/evidence/writer.unit.test.ts`, 9 tests.** `git commit` in the test's temporary repository failed with `error: … MCP server request failed … dial tcp 127.0.0.1:45463: connect: connection refused` from `environment-runner code-sign`. This sandbox's git config has `commit.gpgsign=true` and `gpg.format=ssh` (`git config --get`). Signing goes through a local server in the outer network namespace, which `unshare -rn` cuts off. The same file passes online (9/9). Cause: the sandbox's commit signing, not framework code. These tests cannot pass offline in this sandbox while global signing is on. Proposed fix, for the test owner (B-T/C-02 item, not D-03): pass `-c commit.gpgsign=false` in the test's own `git commit` (it already passes `-c user.email`).
- **`src/check/migrations/checker.unit.test.ts`, 1 test** (CHECK-AC-004 supported changes): `TypeError: fetch failed … SocketError: other side closed` from Miniflare's local proxy (127.0.0.1) during `introspectSqlite`. Re-run alone offline, it passes 9/9. The link from "machine load" to "workerd closing the socket" is **not proven**. Recorded as unexplained, for a diagnoser if it recurs. It is not in D-03's paths: D-03 changed no file this test imports.

## Caveat and final run
The scratchpad directory is shared with other agents, and one log (`verify2.log`) contained another worktree's output (`agent-ad061…`). The earlier logs may therefore be mixed, and the offline findings above need re-checking by a diagnoser. Final online run, logged uniquely to `d03-verify-online-final.log` at about 05:05 UTC with a load average of about 15 on 4 CPUs: build, typecheck and lint passed; `test:unit` reported 1465 passed and 2 failed. Both failures were `Test timed out in 5000ms`: `postgres.unit.test.ts` "gives every call its own empty database" and `type-check.unit.test.ts` "[CLI-AC-002] reports a type error…". These are the same CPU-bound files, and both pass with a longer timeout. All 98 provision tests passed.

## Review
Pending (an independent reviewer subagent).
