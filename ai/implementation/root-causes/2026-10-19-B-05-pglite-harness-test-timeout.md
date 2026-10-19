# Root cause — B-05: PGlite harness unit test intermittently exceeds the per-test timeout

## Symptom
After rebasing B-05 on the feature branch, one full `npm run test:unit` run (35 files) reported
`× opens a fresh database created with LC_COLLATE 'C' and LC_CTYPE 'C' 5243ms`
(`packages/framework/src/sql/drivers.unit.test.ts`), 1 failed / 462 passed. Three immediate reruns passed (463/463).

## Evidence
1. Vitest's default per-test timeout is 5000 ms; `vitest.unit.config.ts` does not change it. The failing duration, 5243 ms, is just over it.
2. The first test in the file is the first caller of `openPostgres()` in its process, so it also pays the once-per-process template creation in `drivers.ts` (`PGlite.create()` initdb, `CREATE DATABASE app TEMPLATE template0 …`, `dumpDataDir`), then loads a fresh instance. The second test pays only the load.
3. Measured durations of that first test: 3156 ms when the file runs alone; 4101 ms in a full verbose unit run (35 files in parallel, forks pool); 5243 ms in the failing run. Second test: 968–1492 ms.
4. Reproduction of the exact failure mode: `npx vitest run --config vitest.unit.config.ts --testTimeout=2500 packages/framework/src/sql/drivers` → `× … 2724ms → Test timed out in 2500ms.`; the second test passes.
5. Earlier, in isolation (scratch probe, `node`), creating the template took 2797 ms and each load 541 ms.

## Causal chain
- The one-time template cost (evidence 2, 5) is charged to whichever test first calls `openPostgres()`.
- Under parallel load from the other 34 files that test's duration rises (evidence 3: 3.2 s → 4.1 s → 5.2 s).
- When it exceeds 5000 ms, Vitest fails it with "Test timed out" (evidence 1, reproduced in 4 with a lower limit).

## Alternatives ruled out
- Wrong collation or harness behaviour: the same assertions pass in every other run, and with the lower limit only the timing fails (4).
- Interference between test files: each file runs in its own forked process (forks pool), and the harness creates per-process in-memory instances with no shared storage.

## Proposed fix
Create the template in the file's `beforeAll` (a per-process setup step with its own, larger hook timeout) by calling `openPostgres()` once and closing it, so each test measures only its behaviour (opening a fresh database and checking it). No assertion changes.

## Verification plan
Rerun with `--testTimeout=2500` (must now pass: each test's own work is ~0.5–1.5 s) and run the full unit suite three times.

## Review
**ACCEPTED** — independent reviewer (prompt §8 step 2), 2026-10-19, branch `claude/implement-local-cloudflare-rc-b05-review`. No code or tests were changed in the review; probe and scratch files were removed.

Process deviation: the fix (commit 000320f) was applied before this review, against §8 step 3. The record was judged on its merits; the deviation is noted here and does not change the verdict.

Checks against the code (`packages/framework/src/sql/drivers.ts`, `drivers.unit.test.ts`, `vitest.unit.config.ts`):
- `vitest.unit.config.ts` sets only `include` and `pool: "forks"`, so Vitest's default 5000 ms test timeout applies (evidence 1 holds).
- `postgresTemplate()` memoises a module-level promise. The first `openPostgres()` in a process therefore runs initdb, `CREATE DATABASE … TEMPLATE template0`, and `dumpDataDir`, and later calls only load (evidence 2 holds).

Reviewer experiments (4 CPUs):
1. Cost split, standalone node probe, 3 runs: `PGlite.create()` initdb 2308–2726 ms; CREATE DATABASE plus dump 189–217 ms; each load 452–542 ms. This confirms that the one-time template cost is about 2.5–2.9 s and most of it is PGlite initdb, consistent with evidence 5.
2. Contention link (the one link the record supports only by correlation, evidence 3): the same probe with 8 busy-loop node processes running gave initdb 7558–8043 ms and loads 496–2025 ms. The cost is CPU-bound and grows about 3x under contention. This directly supports "under parallel load that test's duration rises".
3. Symptom reproduced at the default timeout. I ran the pre-fix test file (from d38af60) and the post-fix file side by side under the same 8-process load. Pre-fix: `× opens a fresh database … 9804ms → Test timed out in 5000ms`. Post-fix: same test ✓ 1315 ms. The second test passed in both files (4037 ms and 3240 ms).
4. Verification plan rerun. Post-fix with `--testTimeout=2500`: both tests pass (522 ms, 1070 ms). Full `npm run test:unit` three times: 40/40 files, 519/519 tests each time.

Alternatives: wrong collation is ruled out because the assertions pass whenever the timeout is not hit, including in experiment 3 under load. Shared state between files is ruled out because the pool is forks and the template is per-process in-memory. No hypothesis rests on "flaky" or "timing" without a measurement.

Does the fix address the cause, or hide it? The cause is that a one-time, per-process fixture cost (building the C/C template) is charged to whichever test happens to run first. That cost is legitimate:
- PGlite cannot switch databases within one instance, so the design (DEC-0106) needs the template.
- It is paid once per process by design.
- It is not the behaviour under test.

Moving it into `beforeAll` matches the existing pattern in `databases.unit.test.ts` (open in `beforeAll` with 60 s). The 60 s hook limit is generous, but a hang during template creation would still fail the file.

Did the fix weaken the test? No. `git diff d38af60 HEAD` shows only the added `beforeAll` and a comment, with no assertion changes. Template creation is still exercised: if `beforeAll` throws, every test in the file fails. If the template had the wrong collation, the first test's `datcollate`/`datctype`/`lower('ÀB')` assertion would still catch it. Each test still calls `openPostgres()` itself.

Residual note (not a rejection reason): under heavy contention the second test, which makes two loads, took 3.2–4.0 s, inside 5 s but with less margin. This is the load cost under contention, not the cause diagnosed here. If it ever times out, it needs its own §8 record.
