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

Reviewer: independent root-cause reviewer subagent (plan-v0.2.0-testing-auth §7a.1.8 step 2, with §7a.1.9 because the fix changes a once-green test's timeout). Date: 2026-10-31. I did not write this diagnosis, the test or `listing.ts`. Base: this branch at `2148993` (on `origin/main` `1e0c289`). S3 read at `origin/v0.2.0/17-ci-no-duplicates` `4b04a55`.

**Verdict: `accepted-with-changes`.** The cause chain is accepted. The proposed fix (raise 180 s to 600 s, with the rest as an optional follow-up) is **not** accepted as written: on its own it masks the cause. The binding fix below replaces it.

### What I re-ran
1. `npm ci` and `npm run build -w packages/framework`, then the file alone: `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/selection.unit.test.ts --reporter=json`. This ran at load 18.2→18.7 on 4 CPUs (other agents' load, with no loops added). All 6 tests passed. Test `:73` took **52.5 s**. The whole process tree took 54.7 s wall and **50.6 CPU-seconds** (user 43.6 s, sys 7.0 s, measured with bash `time`, which counts the waited-for children).
2. One experiment on the hypothesis I wanted to check myself, that Vitest cannot preempt a synchronous child. I wrote a scratch test file outside the repository and ran it with this repository's Vitest 5.0.5. It has two tests with a 1 s limit, and each blocks on `execFileSync("sleep", ["4"])`:
   - when the assertion holds, the result is `Error: Test timed out in 1000ms.`, reported after 4,062 ms, and the body's log line "returned after 4038 ms" shows the body ran to the end;
   - when the assertion fails, the result is `AssertionError: expected 1 to be 2`, after 4,012 ms, with **no** timeout error.
3. Source check: `node_modules/vitest/dist/chunks/run.BPv-BBRv.js:3270-3328` (`withTimeout`). A synchronous body is called inside `try`. If it returns, `resolve()` checks `deadline.exceeded()` and rejects with the timeout error (vitest-dev/vitest#2920). If it throws, `reject()` reports that error and never checks the deadline.

I did not re-run the loaded failure. Test economy rule 8 allows a run under load because timing is the claimed cause, but the brief asked only for a short check, and my alone-timing matches the record's (48–58 s alone, 52.5 s here).

### Cause: accepted
- **Link 1 (contention) and link 2 (CPU-bound child runners): supported.** `listing.ts:42` runs `execFileSync("npx", …)` with no `timeout`, once per entry of `runnerSelection({ target: "cloudflare" })` (`selection.ts:29-31`, `listing.ts:76-80`). My measurement agrees in scale with the record's. *Minor:* the "about 35 CPU-seconds" counts the two children only. The whole test file costs about 50 CPU-seconds alone, and that is the figure that competes for CPU in a unit run.
- **Link 3 (fixed limit crossed, assertions hold): supported, and stronger than the record says.** Experiment 2 shows that, for a synchronous body, `Test timed out in …ms.` is reported **only** when the body returned without throwing. So each loaded failure's signature is direct proof that `listing.errors` was `[]` and `uncovered(…)` was `[]` in that run, not only an inference from the separate probes in Evidence 3. The record's way of telling the two failure modes apart (timeout means load, `AssertionError … Cannot find module …/dist/…` means a missing build) is correct for the same reason.
- **Evidence 5 (Vitest cannot interrupt; a hang is never caught): confirmed** by experiment 2 and the source. The 180 s argument at `selection.unit.test.ts:85` therefore bounds nothing. It only turns a slow listing that completed into a failure after the fact. A hung child blocks the worker indefinitely, because `execFileSync` has no `timeout`.
- **Alternatives ruled out: adequate for the cause.** S3, a wrong listing, a hang, interference and the missing build are each ruled out with evidence.

### Fix: why 600 s alone masks the cause (major)
1. **The limit cannot do its job at any value (major).** Raising it changes when a slow listing that completed is called a failure. It still bounds nothing and still catches no hang. The record's own Evidence 5 shows this. Choosing "2× the worst load measured so far" (301–313 s) is the same pattern that produced 180 s, and the next heavier load will need another raise. Plan §7a.1.9 lists "a widened … timeout" among reviewed changes, and §7a.1.8 requires a fix of the cause, not the symptom.
2. **The cited precedent does not apply (major).** `2026-10-20-global-unit-timeout-review.md` raised limits for in-process tests that take 2–4 s idle, where Vitest's timer *can* fire. This test takes 52.5 s alone, above the unit layer's own `testTimeout: 30_000` (`vitest.unit.config.ts:11`). It also runs the integration layer's own runner (`vitest.integration.config.ts` over `tests/compliance/criteria`, plus Playwright `--list`) as child processes. It needs the framework build, which `test:unit` does not run (`package.json:21`), while `test:integration` does (`package.json:22`). That is integration-scale work in the fast unit layer (prompt §6, "Unit tests are fast"). Placement in the unit layer was a convenience: root cause `2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test.md:54` offered "a unit test in `tests/compliance/harness/` … or the E2E-004 spec … listing only", with no reason to prefer the unit layer.
3. **The cause has three parts, and the record defers two of them (major).** (i) The child runs are unbounded. (ii) The work sits in a layer whose cost profile and build precondition it does not meet. (iii) The 180 s figure is arbitrary: the record found no rationale for it. Raising the number addresses only (iii), and only by picking another arbitrary number.

### The alternatives
- **(a) Move it to the integration layer: required, with a CI condition.** The integration layer is where its cost and its build precondition belong (`test:integration` builds first). How S3 assigns layers matters here:
  - Layer is decided by file name and path. `**/*.unit.test.ts` is unit only (S3's `vitest.integration.config.ts` excludes it, DEC-0640). A non-`unit` file is collected only under the integration globs. A plain `*.test.ts` left in `tests/compliance/harness/` would be collected by **no** layer.
  - Under `scripts/ci/classify.mjs`, every code change sets `unit.all`, so the unit layer, and today this test, runs on almost every PR. An integration directory runs only when its component is selected, and a change inside one component's criteria directory selects only that component (`classify.mjs`, "a file under a component's integration directories selects that component"). So a plain move to COMPL would stop CI from checking Cloudflare coverage on a PR that removes or renames a tag in, for example, `tests/compliance/criteria/kv/`. That would weaken the check, which §7a.1.9 forbids.
  - DEC-0640 (`example-copies.unit.test.ts` → `tests/skill/example-copies.test.ts`) is the precedent for this kind of move.
- **(b) Make the child runs cheaper by listing fewer files: rejected.** The check's value is that it lists exactly the driver's Cloudflare selection (`selection.ts:1-6`; root cause `2026-10-20-E2E-004-coverage-and-not-run`, causes A and B). Listing fewer files, or changing runner flags (pool, isolation) relative to the driver's, would let the check drift from what the driver runs, so it would weaken the test. About 89 % of the Vitest child's time is import, and every criteria file can carry an expected ID.
- **(c) A `timeout` on `execFileSync`, with a named error: required.** This is the only change that makes any limit real and catches a hung child. Because a synchronous throw beats the deadline check (experiment 2), the named error then reaches the report as an `AssertionError` on `listing.errors`, whatever the Vitest limit is. The same unbounded call also serves `tests/compliance/e2e/E2E-004.spec.ts:41` and `tests/compliance/tools/report.ts:48`, so fixing it in `listing.ts` covers those call sites too (§7a.1.8 step 4).
- **(d) A precondition with a clear message: required.** It is cheap, and it turns failure mode 2 into an explicit message instead of an `AssertionError` listing ten `Cannot find module` lines. It still helps after (a), because a bare `npx vitest run <file>` does not build. Building inside the test is not required: the layer's script already builds.

### Binding fix (replaces "Proposed fix")
1. **Bound the children in `tests/compliance/tools/listing.ts`.**
   - Pass `timeout` to `execFileSync` (and `killSignal: "SIGKILL"`, or kill the whole process group). Make it a `ListOptions` field with a named default constant sized from this record's worst complete child (Vitest 254 s, with 6 copies and 4 loops), for example 300 s.
   - On timeout (`error.code === "ETIMEDOUT"` or `error.signal` set), push a distinct error: `<label>: timed out after <n> s; listing incomplete`.
   - The fixer must show that no `vitest` or `playwright` grandchild survives the kill. `npx` adds a process layer, so call the local bin directly or kill the process group.
   - Red-green: first a cheap unit test of `listSelection` with a stub command that never exits and a 1 s timeout, which fails until the named error exists.
2. **Assert the build precondition.** Before listing, check that `packages/framework/dist/testing/index.js` exists, and if it does not, fail with a message naming `npm run build -w packages/framework`. Red-green: the test fails with that message when `dist` is moved aside.
3. **Move the Cloudflare coverage test out of the unit layer** into a non-`unit` file that exactly one layer, the integration layer, collects. This goes through §7a.1.9, reason `behaviour-changed`, citing this record. Constraints:
   - S3's `--check-duplicates` stays green, and S3's path map lists the file's directory under COMPL's `integration` directories.
   - **No loss of CI coverage.** CI must still run it for every change that can change the Cloudflare selection or its expectations: `tests/compliance/criteria/**`, `tests/compliance/e2e/**`, the catalogue documents (already COMPL test inputs), `tests/compliance/harness/**` and `tests/compliance/tools/**`. Use a path-map entry or an equivalent, checked by `tests/ci-classify.unit.test.ts`. If that cannot be done in S3's map, the move does not land, and the test stays in the unit layer with items 1, 2 and 4 only. That fallback is the only case where the unit layer keeps it.
   - Do not put it inside the cloud Vitest selection (`tests/compliance/criteria`) unless it skips itself there. Otherwise every Cloudflare run would repeat the listing that `E2E-004.spec.ts` already does (§7a.2.4 "No duplicates"). The fixer decides, in the test-change record, whether the title keeps `[E2E-004]`, given that local runs then count it as E2E-004 evidence.
   - The move depends on S3 (`vitest.integration.config.ts` exclude, `scripts/ci/path-map.json`). It lands on top of S3, or as a new item if the fixing item does not own those paths (§7a.1.8 step 4; `plan.md` §1 ownership).
4. **Derive the test's limit; do not pick one.** The per-test limit is at least the sum of the child timeouts from item 1, plus catalogue reading. Put it in one shared constant next to `listing.ts`'s default, and have `E2E-004.spec.ts`'s `LISTING_TIMEOUT_MS` use the same constant. The comment cites this record and Evidence 5: the limit is a ceiling on the listing's duration, and item 1 is what catches a hang.
5. **No interim raise to 600 s by itself.** The test stays red under heavy load until items 1–4 land. That failure is already distinguishable by its signature (Link 3 above), and the D-04 and global-unit-timeout records already cover machine load of that size.

**Verification (amends the record's plan).**
- Item 1: the stub-hang unit test goes red, then green, and no orphan process remains.
- Item 2: with `dist` moved aside, the test fails with the build message.
- After items 3–4: 4 copies plus 4 loops pass in the new layer, and the file alone passes.
- `node scripts/ci/classify.mjs --files tests/compliance/criteria/kv/kv.pglite.test.ts --json` selects the moved test, and `--check-duplicates` exits 0.
- The evaluator checks that the §7a.1.9 test-change record covers the move and the timeout change.
