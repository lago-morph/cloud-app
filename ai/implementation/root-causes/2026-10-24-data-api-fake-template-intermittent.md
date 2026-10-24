# Root cause: intermittent unit failures under load. (1) A bare `npx vitest run <dirs>` loads no config, so PGlite-backed Data API fake tests run under Vitest's 5 s test and 10 s hook defaults. (2) `untilTrue` in `targets/aws/handler.unit.test.ts` bounds its wait by 10,000 event-loop turns, which is not a duration.

Author: diagnosing subagent (prompt §8, plan §8). Base: `origin/claude/implement-aws` `c383d8b` for cause 1, and `b350476` for cause 2 (rebased onto the branch head before pushing). Machine: 4 CPUs, shared with other agents. Run logs from the scratchpad are quoted below. No test assertion was changed.

Two causes, in one record, because they share a trigger (CPU load), a setting (a parallel `npx vitest run` over several directories), and a fix pattern (a bound in wall time, with a stated reason). They are otherwise independent.

## Symptom
1. `npx vitest run packages/framework/src/sql packages/framework/src/provision packages/framework/src/mig`, right after a framework build, failed once:
   `sql/data-api-fake.unit.test.ts > databases: CREATE … TEMPLATE and DROP … WITH (FORCE) > creates from template0 with C collation, copies with TEMPLATE, and drops WITH (FORCE)`.
   Three standalone runs and one re-run passed. An earlier batch of sql, provision and kv had one failure that was not identified.
2. `npx vitest run packages/framework/src/build packages/framework/src/targets packages/framework/src/files` (at `b350476`, after build and typecheck) failed two tests in `targets/aws/handler.unit.test.ts`:
   "the handler returns only once a pending log write has finished", and
   "[LOG-AC-001] … with PutObject denied (403 AccessDenied) the request still succeeds".
   Run alone, the file passed 18/18 twice.

## Reproduction
Load: `burn.sh` runs N `while :; do :; done` loops. "Dual": the command under test runs while a second `npx vitest run packages/framework/src/sql packages/framework/src/provision` runs at the same time, plus 4 loops. Load average was 16–19, which matches the 15–28 recorded for this shared machine in `2026-10-20-global-unit-timeout-review.md`.

| Condition | Command | Result |
|---|---|---|
| idle | `data-api-fake.unit.test.ts` alone | pass; the TEMPLATE test took **2,419 ms** |
| idle, parallel | symptom 1 command, ×2 | pass; **3,756 ms** and **4,044 ms** (5,000 ms limit) |
| 4 loops | symptom 1 command, ×3 | **3/3 fail**: `Error: Test timed out in 5000ms.` at `data-api-fake.unit.test.ts:458:3` (6,254 / 7,998 / 6,134 ms). Run 3 also failed the 42P04 test (timeout) and `provision/aws/databases.unit.test.ts` (`Error: Hook timed out in 10000ms.` at `:87` `beforeEach`, then `TypeError: Cannot read properties of undefined (reading 'close')` at `:93`) |
| dual, no root config | background sql+provision, ×3 | **3/3 fail**: 2, 5, 7 failures, all `Test timed out in 5000ms.`, `Hook timed out in 10000ms.`, or their cascades (below) |
| 4 loops, 8 loops, 8 loops with vitest at `nice 19`, 4 loops ×6 with `--sequence.shuffle`, file alone with 6 loops ×12 | symptom 2 command | 0 failures in 21 runs (the `nice 19` run failed only build/workerd tests, on their own 30–120 s timeouts) |
| dual, no root config | symptom 2 command, ×3 | **run 2 failed**, the two tests below. A temporary probe in `untilTrue` printed `turns=10000 ms=111.6` for the failing wait |

Symptom 2, as reproduced (dual run 2):
```
FAIL targets/aws/handler.unit.test.ts > AWS Lambda runtime: log writes > [LOG-AC-001] … (fake timers): a log write that never completes delays the response by exactly PAR-260, then is abandoned
AssertionError: expected false to be true // Object.is equality
 ❯ untilTrue packages/framework/src/targets/aws/handler.unit.test.ts:238:23
 ❯ packages/framework/src/targets/aws/handler.unit.test.ts:434:5
FAIL targets/aws/handler.unit.test.ts > AWS Lambda runtime: log writes > [LOG-AC-001] … with PutObject denied (403 AccessDenied) the request still succeeds
AssertionError: expected [ { …(3) }, { …(3) } ] to have a length of 1 but got 2
 ❯ packages/framework/src/targets/aws/handler.unit.test.ts:447:21
```
The coordinator's pair (the pending-write test instead of the fake-timer test) is the same mechanism in the other `untilTrue` caller. The failing test differs, and so does the test that receives the leaked PutObject.

## Cause 1: no config, Vitest defaults, real PGlite work
E1. There is no root `vitest.config.ts`. `npm run test:unit` passes `--config vitest.unit.config.ts`, which sets `testTimeout: 30_000` for exactly this class (records `2026-10-20-D-04-verify-unrelated-failures.md`, `2026-10-20-global-unit-timeout-review.md`). A bare `npx vitest run <dirs>`, the symptom command, loads no config. It runs with Vitest 5.0.5's defaults: `testTimeout` 5,000 ms, `hookTimeout` 10,000 ms, and 3 forks.

E2. The work is legitimately slow. Each database in the fake is its own PGlite instance (`data-api-fake.test-support.ts:895-950`). Idle, measured with a throwaway probe test: the per-process initdb took 2,252 ms; `dumpDataDir` took 110–122 ms for a 40–48 MB data directory; booting PGlite from it took 353–424 ms; `CREATE DATABASE … TEMPLATE template0` took 34 ms. The TEMPLATE test needs three boots and three dumps: d_one, the scratch copy, and d_two. That gives 2.4 s idle, about 4 s with three forks, and 6–8 s under load: above 5 s.

E3. `provision/aws/databases.unit.test.ts`'s `describe(…, { timeout: 60_000 })` covers tests, not hooks. Its `beforeEach` runs `DataApiFake.create`, and the first one in a process pays initdb, so it crosses the 10 s hook default under load.

E4. The other failures are cascades, not further defects. A timed-out test's body keeps running and holds the fake's `adminLock`, so the next test's `CREATE DATABASE "app"` (2 ms alone) queues behind it and times out. A timed-out `beforeEach` finishes late and assigns `fake`/`clock` under the next test ("waits for a resuming cluster…": `expected [] to have a length of 3`).

Ruled out:
- **A race in the fake's TEMPLATE copy.** The copy runs under `adminLock` plus the source's lock (`:896-918`). Every failure is a timeout or a cascade of one. No run produced a wrong row, collation or name.
- **Shared temp directory.** The fake uses in-memory PGlite and writes no files.
- **Shared global state between files.** Forks isolate files, and the failing tests pass alone under the same load once the limit is 30 s.
- **Making the operation faster.** Each per-database instance needs a boot from a data directory, because PGlite has one database per instance. A single further dump could be avoided only by an on-disk scratch directory, which would add the temp-dir state ruled out above and save under 0.2 s idle.

## Cause 2: a turn-count bound on real I/O
E5. `untilTrue(condition)` (handler test) spun at most 10,000 `setImmediate` turns, waiting for a log PutObject to reach the test's `s3Fetch` stub. Before that point, `putEntry` (`log/aws/sink.ts`) does WebCrypto work for SigV4 (SHA-256, then HMAC chains), which runs on libuv's thread pool. Turns on the main thread do not wait for the pool, so the number of turns that pass before the PutObject arrives depends on scheduling.

E6. Measured with the probe: idle, 19 turns / 2 ms (pending test) and 516 turns / 3.2 ms (fake-timer test). In passing loaded runs, the maximum was 2,698 turns / 30.2 ms. In the failing loaded run, 10,000 turns took **111.6 ms** and the PutObject had not arrived. The cap measures nothing physical.

E7. The second failure is a cascade. The failed test's request is still in flight when `afterEach` clears `logPuts`. Its PutObject then lands in the next test's `logPuts`: 2 entries instead of 1 at `:447`.

Ruled out:
- **The PAR-260 wait (2 s real timer) racing.** Under the heaviest starvation tried, the log requests took 5–11 ms, about 200× below PAR-260.
- **Global fetch, timer or env leaks between files.** Every `useFakeTimers`, `stubGlobal` and network guard in build/targets/files is restored. The file alone under load never failed (0/12).
- **A test timeout.** The describes carry `{ timeout: 60_000 }`, and the failure is an assertion, not a timeout.

## Fix (red-green)
1. `vitest.config.ts` (new, root): a bare `npx vitest run [paths]` gets the unit layer's runner limits. `include` stays at Vitest's default, so a bare run selects the same files as before. `npm run test:unit` and `test:integration` pass `--config` and are unaffected. `vitest.unit.config.ts` exports these limits as `UNIT_RUNNER` and adds `hookTimeout: 30_000`. The 30 s bound was accepted for the test timeout in `2026-10-20-global-unit-timeout-review.md`. Hooks get the same bound because they pay the same PGlite costs (E3). The worst measured case is 22.1 s (green runs below), and 30 s still fails a hang.
2. `targets/aws/handler.unit.test.ts`: `untilTrue` waits up to `UNTIL_TRUE_MS = 10_000` ms of wall time (`performance.now()`, which these tests do not fake) instead of 10,000 turns. The bound is about 90× the failing point (111.6 ms) and about 330× the worst passing case (30.2 ms). A condition that never holds still fails, with the same assertion. It stays inside the suite's 60 s timeout.

No assertion changed. No test was skipped.

## Evidence
- Red (cause 1): the 4-loop and dual rows above, at `c383d8b` with no root config.
- Green (cause 1): the symptom 1 command under 4 loops with the fix, 3/3 pass, 615 passed / 1 skipped each. The TEMPLATE test took 18,075 / 22,140 / 5,953 ms.
- Red (cause 2): dual run 2 above (no root config, old `untilTrue`).
- Green (both): the dual condition with both fixes, 3/3. The symptom 2 command passed 357/357 each run. The background sql+provision run passed 579 / 1 skipped each run. The probe's largest `untilTrue` waits were 1,031 / 6,501 / 7,502 turns (11.7 / 78.5 / 95.8 ms). Two of the three runs came close to the old 10,000-turn cap and passed only because the bound is now time. The probe was then removed.
- `npm run typecheck` and `npm run lint` pass.

## Follow-up (not done here)
- The handler log tests leak an in-flight request into the next test when one fails (E7). That only amplifies a failure that has already happened, so it was left alone. A per-test generation check in `s3Fetch` would contain it.
- A timed-out Data API fake test leaves work holding `adminLock` (E4), with the same effect.
