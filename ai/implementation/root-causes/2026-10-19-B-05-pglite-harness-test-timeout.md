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
Pending: needs an independent root-cause reviewer (prompt §8).
