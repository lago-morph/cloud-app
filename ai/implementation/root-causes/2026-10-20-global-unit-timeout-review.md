# Review: global unit-test timeout instead of per-test timeouts (2026-10-20)

This is a prompt §8 step 2 review of a proposed **change of fix** for the accepted record
`ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md` (branch
`origin/claude/implement-local-cloudflare-d-04`). That record's Fix is in
`ai/implementation/root-causes/2026-10-20-verify-fixes.md` (branch `origin/claude/implement-local-cloudflare-fix-verify`).
The reviewer did not write the record, the fix, or the tests. No code or tests were changed in this review.
Review branch: `claude/implement-local-cloudflare-rc-timeout-review`, from `origin/claude/implement-local-cloudflare` (`85b1f6b`).

## Proposal under review
Set `testTimeout: 30_000` in the root `vitest.unit.config.ts`, with a comment that cites the record, and keep the
per-test timeouts from the fix. The aim is to stop adding per-test timeouts one at a time, as tests of the same kinds
keep timing out at 5 s.

## Verdict: **ACCEPTED**

## What was checked
- **Prompt §6:** "Unit tests are fast and need no network." **Prompt §8:** every failure needs an evidence-based
  cause, and no test may be weakened.
- **Plan §10.1:** the unit layer is `FW/src/**/*.unit.test.ts` plus tool unit tests. It sets no runner timeouts.
- **`vitest.unit.config.ts`:** it sets only `include` and `pool: "forks"`. Vitest 5.0.5 therefore uses its defaults:
  `testTimeout` 5,000 ms, `hookTimeout` 10,000 ms, and `maxWorkers` = `availableParallelism() - 1` = 3 on this machine
  (`node_modules/vitest/dist/chunks/index.1TqnEahn.js:1624`).
- **Fix branch status:** the fix-verify branch is **not** an ancestor of `origin/claude/implement-local-cloudflare`.
  Its per-test constants (`MANY_PUTS_TIMEOUT_MS`, `PGLITE_LOAD_TIMEOUT_MS`, `TSC_TIMEOUT_MS`) are therefore not on the
  feature branch yet.
- **Precedent:** the framework's own app test runner already sets global limits,
  `packages/framework/src/cli/verify/tests.ts:29-30` (`testTimeout: 60_000, hookTimeout: 60_000`). Its stated reason
  is the same PGlite open cost. `cli/verify/tests.unit.test.ts:39` asserts that value.

## Evidence: load, not a defect, also explains the further tests
I spot-checked the two named tests on `nproc` = 4:
- `sql/postgres.unit.test.ts > opens a fresh database created with LC_COLLATE 'C' and LC_CTYPE 'C'`
- `kv/service.unit.test.ts > KV on sqlite > [KV-AC-001][KV-AC-004] list matches the prefix literally…`

Each run used both files: `npx vitest run --config vitest.unit.config.ts --reporter=verbose <both files>`.

An idle machine was not available. "Alone" means these two files only, with no artificial load, but with the background
load from other agents.

| Run | Load avg (1 min) | "opens a fresh database" | KV/sqlite "prefix literally" | Result |
|---|---|---|---|---|
| alone 1 | 18.0 | 2,955 ms ✓ | 3,503 ms ✓ | 24/24 |
| alone 2 | 20.0 | 2,026 ms ✓ | 2,648 ms ✓ | 23/24: 1 `Test timed out in 5000ms.` (another test in these files) |
| alone 3 | 22.5 | 1,525 ms ✓ | 2,194 ms ✓ | 24/24 |
| + 8 busy loops, 1 | 22.2 | **6,304 ms timed out** | 9,380 ms ✓ ¹ | 6 failed, 18 passed |
| + 8 busy loops, 2 | 24.2 | **7,105 ms timed out** | **10,809 ms timed out** | 6 failed, 18 passed |
| + 8 loops, `--testTimeout=30000` | 21.6 | 4,469 ms ✓ | 4,290 ms ✓ | **24/24** |
| + 8 loops, `--maxWorkers=1` | 17.3 | 3,753 ms ✓ | 3,437 ms ✓ | 1 failed ("gives every call its own empty database", 6,344 ms, timed out) |

¹ Vitest's reported duration includes the `beforeEach` hook, which opens the harness and has its own 60 s limit. A
reported duration above 5 s can therefore still pass.

What the runs show:
- **Every failure was a timeout.** In each loaded run at the default timeout, all 6 failures were
  `Test timed out in 5000ms.` The last run's output had no `AssertionError` and no `expected` mismatch.
- **The same assertions pass when the limit is raised.** Under the same artificial load, `--testTimeout=30000` gave
  24/24.
- **Duration follows CPU contention.** "Opens a fresh database" took 1.5–3.0 s without artificial load and
  6.3–7.1 s with it. KV/sqlite "prefix literally" took 2.2–3.5 s without it and 9.4–10.8 s with it.
- **This matches the earlier records.** The B-05 review measured PGlite initdb at about 3× slower under 8 busy loops.
  Its residual note predicted that "gives every call its own empty database" would time out under load, and here it
  did. The D-04 record reproduced the same timeouts without D-04's files.
- **The tests' work is CPU-bound in-process, not network.** The KV test does 18 `put`s and 10 `list`s on a D1
  (workerd) or PGlite harness. "Opens a fresh database" loads one PGlite instance and runs one query; the template is
  built in `beforeAll` (B-05 fix). Neither has a sleep, a poll, or an external wait that a defect could stretch.

The causal chain therefore holds for these further tests, with evidence for each link: CPU contention (`uptime`, the
injected loops) → in-process PGlite/workerd/tsc work runs 2–4× slower → it crosses the 5 s default → Vitest fails the
test with a timeout and no assertion fails. A defect is ruled out, because the assertions pass whenever the limit is
not hit, including under the same load.

## Does a global 30 s timeout weaken any test?
**No.** I searched all unit tests (`*.unit.test.ts` under `packages/framework/src`, `tests`, `skill/scripts`) for
`performance.now`, `Date.now`, `hrtime`, `setTimeout`, `useFakeTimers`, `AbortSignal.timeout`, `elapsed` and
`toBeLessThan`.

- **No unit test uses Vitest's timeout as its oracle.** No test expects to be killed at 5 s, and none checks that it
  finished "within the test timeout".
- **The tests whose purpose is timing measure time themselves, and none of those measurements involves `testTimeout`:**
  - `log/writer.unit.test.ts:48-52`: 100 writes against a never-completing sink, `toBeLessThan(100)` ms.
  - `log/request.unit.test.ts:52-60`: the response is within PAR-260 (2,000 ms) of a baseline.
  - `sql/guard.unit.test.ts:35-41`: a never-settling operation is SQL.UNAVAILABLE within a 20 ms budget.
  - `log/writer.unit.test.ts:61-65`: "never settles" uses its own 20 ms `Promise.race`.
  - The clock tests in `auth/runtime`, `files/local/*` and `sql/values` use fake timers. `tests/compliance/harness/wait`
    uses an injected fake clock.
- **No product delay falls between 5 s and 30 s in a way that a unit test could now pass and before could not.**
  - SQL budget PAR-210 is 45 s, which is above 30 s, so a test that wrongly waited for it would still fail. The unit
    tests use `budgetMs: 20`.
  - The 10 s `SIGKILL` fallback in `cli/dev/runtime.ts:84` is not exercised by `cli/dev/runtime.unit.test.ts`.
- **A real hang still fails.** It is reported after 30 s instead of 5 s. That costs at most about 25 s per hung test
  and hides nothing. The heavy tests already allow 30–120 s: 23 explicit per-test, hook or `describe` timeouts, for example
  `check/**` at 120 s and `kv`, `sql`, `mig`, `targets` at 60 s.
- **No assertion changes**, so §8's "never weaken a test" holds.

## Is there a cheaper or better fix?
- **Limiting Vitest workers (`maxWorkers: 1` or `2`) is not better.** It did not cure the timeout: with
  `--maxWorkers=1` under the same load, a test still timed out at 6.3 s. That is expected. Most of the load (15–28 on
  4 CPUs) comes from other agents' processes. Vitest's own 3 workers are a small share of the run queue, so removing 2
  of them barely changes each test's CPU share. Fewer workers also makes every unit run slower when the machine is
  idle. It treats the wrong cause.
- **Per-test timeouts one at a time is worse.** About 10 unit files open PGlite/D1/workerd. They hold about 100 tests
  that run against a real database with the 5 s default, and new ones arrive with each item. Each new timeout needs
  another §8 cycle for the same proven cause.
- **Raising the global limit is the cheapest fix that matches the cause.** It is one line, it has a precedent in
  `cli/verify/tests.ts`, and it changes no assertion.
- **`hookTimeout`: not part of this change.** The heavy hooks already set 60 s, and no hook timeout was observed. A
  hook timeout would need its own evidence.
- **Running verify only on an idle machine** would remove the cause, but the orchestrator cannot enforce it while
  agents share the machine.

## Exact recommended change
1. In `vitest.unit.config.ts`, make the `test` block:
   ```ts
     test: {
       include: ["packages/framework/src/**/*.unit.test.ts", "tests/**/*.unit.test.ts", "skill/scripts/**/*.unit.test.ts"],
       pool: "forks",
       // Tests that open PGlite or D1/workerd, or run tsc, take 2–4 s here and 6–11 s when other agents load the
       // shared 4-CPU machine (load 15–28). The 5 s default then fails them with no defect. Tests that need more
       // keep their own, larger timeouts. See ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md
       // and 2026-10-20-global-unit-timeout-review.md.
       testTimeout: 30_000,
     },
   ```
2. Keep every existing per-test or `describe` timeout, including those from `claude/implement-local-cloudflare-fix-verify`
   (commit `7eef8a8`) when that branch is merged. They are all at least 30 s, so they still apply.
3. Change nothing else: no `hookTimeout`, no `maxWorkers`, and no assertions.

## Verification for the fix subagent (§8 step 3)
- **Red, on the current config:** run the two spot-check files with 8 `while :; do :; done` loops on `nproc` = 4.
  Expect at least one `Test timed out in 5000ms.`, as in the table above.
- **Green, after the change:** run the same command under the same load with no CLI flag. Expect 24/24.
- **Then:** run `npm run test:unit` once under the same load, and run `npm run verify`. Expect 0 timeouts.
- **Residual, not caused by this change:** the wall-clock assertions in `log/writer` (< 100 ms) and `log/request`
  (≤ 2,000 ms) are load-sensitive in their own right, and `testTimeout` does not affect them. If they fail under load,
  each needs its own §8 record.

## Fix
Fixing subagent (prompt §8 step 3), branch `claude/implement-local-cloudflare-fix-c4`; it did not write the record or this
review. Applied the recommended change as written: `testTimeout: 30_000` in `vitest.unit.config.ts`, with a comment
citing the D-04 record and this review. All per-test, hook and `describe` timeouts kept; no `hookTimeout`, `maxWorkers`
or assertion change. `npm run verify` passed online and offline (`unshare -rn sh scripts/offline.sh npm run verify`),
both exit 0, at load average 10–17 on 4 CPUs.
