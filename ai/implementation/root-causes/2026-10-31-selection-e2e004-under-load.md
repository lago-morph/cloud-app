# Root cause: E2E-004's offline Cloudflare listing test in `selection.unit.test.ts` times out under CPU contention. Its body runs two child test runners synchronously (about 35 CPU-seconds), and a fixed 180 s limit fails it when contention stretches that past 180 s. The assertions still hold.

Diagnosing subagent under plan-v0.2.0-testing-auth §7a.1.8 (`ai/prompts/implement-local-cloudflare.md` §8). Ref under test: `origin/main` `1e0c289`. Comparison ref: `origin/v0.2.0/15-playwright-projects` `1dee257` (S3). No code or tests were changed.

## Symptom
Another diagnoser ran a full `npm run test:unit` on `origin/main` (1e0c289) while the machine was heavily loaded (other agents, plus CPU-burner loops). It saw one failure in `tests/compliance/harness/selection.unit.test.ts`, in a test about E2E-004. Its exact output was not captured.

The file has two `[E2E-004]` describe blocks. Under load, the failing test is always the second block's only test, `selection.unit.test.ts:73`:

```
 FAIL  tests/compliance/harness/selection.unit.test.ts > [E2E-004] the Cloudflare selection covers every criterion expected there > every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)
Error: Test timed out in 180000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ tests/compliance/harness/selection.unit.test.ts:73:3
```

There was no `AssertionError` and no stack beyond the test's own line. The five tests in the first block passed in every run.

## Reproduction (nproc = 4; host load from other agents was already 11–45 throughout)
Each run used `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/selection.unit.test.ts` with the JSON reporter, after `npm ci` and `npm run build -w packages/framework`. "Loops" means `node -e 'for(;;){}'` processes started by the diagnoser.

| Ref | Setting | Runs | Result | Duration of the failing/passing test |
|---|---|---|---|---|
| main | file alone, no loops (load 21–29) | 5 | 5 passed | 48–58 s |
| main | 4 copies in parallel + 4 loops (load 22–34) | 8 (2 rounds) | **8 failed**, all `Test timed out in 180000ms.` | 222–290 s |
| main | full `test:unit`, no loops (load 11–14) | 1 | 237/237 files passed | 60 s |
| main | full `test:unit` + 6 loops (load 14–47) | 1 | 12 tests failed, this one included (`Test timed out in 180000ms.`, 269 s) | 269 s |
| S3 | file alone, no loops (load 20–25) | 2 | 2 passed | 30–50 s |
| S3 | 4 copies in parallel + 4 loops (load 25–32) | 4 | **4 failed**, all `Test timed out in 180000ms.` | 185–192 s |

In the full suite with loops, the other 11 failures were also timeouts or hook timeouts in PGlite/workerd/tsc tests (`kv/service`, `mig/apply`, `sql/guard`, `check/migrations/*`, `auth/password/provider`), plus two D1 copy tests with `fetch failed`. They are outside this record. Machine load of that size is already covered by `2026-10-20-D-04-verify-unrelated-failures.md` and `2026-10-20-global-unit-timeout-review.md`.

## Evidence
1. **The test's body runs two full test-runner processes.** `listDriverTests("cloudflare", …)` (`tests/compliance/tools/listing.ts:76-85`) runs one `listSelection` per `runnerSelection({ target: "cloudflare" })` entry. Each one calls `execFileSync("npx", …)` (`listing.ts:42-44`):
   - `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria -t '^COLLECT-ONLY: …$' --passWithNoTests --reporter=json`. This imports all 79 criteria files and runs no test body.
   - `npx playwright test tests/compliance/ --project integration --project e2e --list --reporter=json`.
2. **That work is CPU-bound and costs about 35 CPU-seconds.** The same two commands were timed at load 20:
   - Vitest: real 22.0 s, user 29.7 s, sys 4.9 s, with Vitest's own report reading `import 89%`.
   - Playwright `--list`: real 5.1 s, user 5.1 s, sys 0.7 s.
3. **Its wall time follows CPU contention, and the result stays complete and correct.** A probe ran the test's body outside Vitest with no limit (the same calls: `listSelection` per selection, `scopeTests`, `uncovered` against `expectedCriteria(…, "cloudflare", "automated")`), timing each child:
   - alone, load 20: 28 s in total (vitest 22 s, playwright 6 s), 196 + 36 tests listed, `errors=[]`, `uncovered=[]`;
   - 4 copies + 4 loops, load 18→29: 177–184 s (vitest 164–166 s), 196 + 36 tests, `errors=[]`, `uncovered=[]`;
   - 6 copies + 4 loops, load 31→40: 301–313 s (vitest 246–254 s), 196 + 36 tests, `errors=[]`, `uncovered=[]`.

   So, given the time, the assertions the test makes (`listing.errors` equals `[]`, and `uncovered(…)` equals `[]`) hold under the same load in which the test fails.
4. **The limit is a fixed 180 s.** It is the test's own argument, `}, 180_000);` at `selection.unit.test.ts:85`, which overrides the config's `testTimeout: 30_000`. It came with merge `c00aaad` (2026-10-24), and no recorded rationale for the value was found.
5. **Vitest cannot interrupt the body. It reports the timeout only after the children finish.** `execFileSync` blocks the worker's event loop, so the 180 s timer can run only once both children have returned. The failing runs report durations of 185–290 s for a 180 s limit, which is consistent with this. The limit therefore does not bound wall time and does not catch a hang: `execFileSync` has no `timeout`, so a hung child would block indefinitely. Its only effect is to turn a slow but complete listing into a failure.

## Chain from cause to symptom
1. CPU contention: other agents' work plus loops, at load 22–47 on 4 CPUs. Evidence: `/proc/loadavg` recorded before and after each run (table).
2. The test's body is integration-scale, CPU-bound work, about 35 CPU-seconds of module import in two child runners. Its wall time stretches from 28–60 s to 177–313 s under that contention, while the listing stays complete. Evidence: points 1–3.
3. The test's fixed 180 s limit is crossed. When the synchronous children return, Vitest marks the test `Test timed out in 180000ms.`, although the body completed and its assertions would pass. Evidence: points 3–5, and every loaded failure carries exactly this message and no `AssertionError`.

## Alternatives ruled out
- **S3's change (`v0.2.0/15-playwright-projects`).** Ruled out. `origin/main` fails identically (8 of 8 loaded runs), and S3 fails identically too (4 of 4). Both pass alone. S3 only renames the Playwright projects in `selection.ts` and in this test's expected strings.
- **An incomplete or wrong listing under load** (a child crashing, a file failing to load, a tag being missed). Ruled out. Every loaded probe listed the same 196 Vitest and 36 Playwright tests as the unloaded probe, with `errors=[]` and `uncovered=[]`.
- **A hang or deadlock in a child.** Ruled out. Every child returned: every probe finished, and every failing run reported a finite duration of 185–290 s.
- **Interference from other unit tests in the full suite** (shared files, ports, the Playwright `test-results` directory). Ruled out as necessary. The failure reproduces with this file alone in parallel copies, where no other unit test runs. The full-suite failure has the same signature.
- **Interference between the parallel copies themselves.** Ruled out as the mechanism. Six parallel probes produced correct, complete listings, and the failures are timeouts, not wrong results.
- **The framework build missing (`packages/framework/dist`).** This is a different, deterministic failure, and not what was reproduced here. With `dist` moved aside, the same test fails in 26 s with `AssertionError: expected [ …(10) ] to deeply equal []`. The errors include `playwright: Error: Cannot find module '…/node_modules/@lago-morph/prototype-framework/dist/testing/index.js' imported from …/tests/compliance/e2e/demo-criteria.spec.ts`. `npm run test:unit` does not build the framework, and the test's comment (`selection.unit.test.ts:70-71`) states the prerequisite. The original diagnoser's output was not captured, so it cannot be told which of the two it saw. The signature distinguishes them: `Test timed out in 180000ms.` means this record's cause, while an `AssertionError` listing `Cannot find module …/dist/…` means a missing build.

## Proposed fix (for a fixer; not applied here)
1. In `tests/compliance/harness/selection.unit.test.ts`, raise this test's own limit from `180_000` to `600_000`. Add a comment citing this record and its numbers: alone 28–60 s, and 301–313 s with 6 copies and 4 loops at load 40. That leaves about 2× headroom over the worst measured complete listing. No assertion changes, so the test is not weakened. This follows the precedent of `2026-10-20-global-unit-timeout-review.md`: a CPU-bound test whose assertions pass when given time gets a limit sized to its measured work under contention.
2. Follow-up, for the owner of `tests/compliance/tools/listing.ts` (a separate item, not required for this symptom): because of evidence point 5, give `execFileSync` its own `timeout`, recording a named error in `errors` when it is reached. A real child hang would then fail with a clear message instead of blocking indefinitely. Also consider whether this test belongs in the unit layer at all. It needs the framework build that `test:unit` does not run, and it spends about 35 CPU-seconds on runner processes, against prompt §6 ("Unit tests are fast").

## Verification
- **Before the fix**, red: 4 parallel copies of the file with 4 loops fail with `Test timed out in 180000ms.` (reproduced here 12 of 12 times across both refs).
- **After the fix**, green: the same setting (4 copies + 4 loops, and once 6 copies + 4 loops) passes. The test then reports durations above 180 s with no failure.
- The file alone, and a full `npm run test:unit` at ordinary load, still pass.
- With `packages/framework/dist` removed, the test still fails with the `Cannot find module …/dist/…` `AssertionError`. This shows that the limit change does not mask a real listing error.

## Review
Pending (an independent reviewer subagent).
