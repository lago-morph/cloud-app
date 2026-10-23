# Root cause: CLI-AC-003 (compliance runner): a failing `dev` stop throws out of the driver, and a failed stage cleanup after passing tests exits 0

Author: diagnosing subagent (prompt §8 step 1). I did not write the driver or these tests. This is a diagnosis only: the commit changes no code and no test (my local unskips and the trial fix were reverted). It needs an independent review (§8 step 2) before anyone fixes it. Local only: no Cloudflare calls were made.

Branch: `claude/implement-local-cloudflare-diag-c6`, from `origin/claude/implement-local-cloudflare-c-t6` (commit with the tests as `it.skip`).

**Finding in one line.** The code is wrong; both tests are right. (1) `runCompliance` awaits `local.stop()` unguarded in its `finally` block (`tests/compliance/harness/driver.ts:224`), so a rejection replaces the run's result with a thrown error: no record is written and `cli.ts` exits 64. (2) Nothing in the driver turns cleanup failures into a non-zero status: `removeStage` and `checkLeftovers` swallow errors and only append to `leftovers`, so a run whose tests all passed exits 0 with leftovers recorded.

## Symptom

Two `[CLI-AC-003]` tests in `tests/compliance/harness/driver.unit.test.ts` (block "compliance runner exit status under injected failures") were committed as `it.skip` by their author (DEC-0396, decision log `Item: C-T6`). Prompt §8 does not allow skipping, so they have to be unskipped once the driver is fixed.

1. Line 289: "local: a failing test whose cleanup (stopping dev) also fails keeps the original status and still writes the record".
2. Line 334: "cloud: passing tests whose stage cleanup fails (a partial failure) give a non-zero status".

## Evidence

### E1. Reproduction (unskipped locally)
I changed `it.skip(` to `it(` on both tests, then ran `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/driver.unit.test.ts -t "CLI-AC-003"` (Node v22.22.0, vitest 5.0.5, after `npm ci --ignore-scripts`). Result: 2 failed, 3 passed.

```
× local: a failing test whose cleanup (stopping dev) also fails …
Error: dev did not stop
 ❯ Object.stop tests/compliance/harness/driver.unit.test.ts:291:140
 ❯ runCompliance tests/compliance/harness/driver.ts:224:61
 ❯ tests/compliance/harness/driver.unit.test.ts:292:20

× cloud: passing tests whose stage cleanup fails (a partial failure) give a non-zero status
AssertionError: expected +0 not to be +0 // Object.is equality
 ❯ tests/compliance/harness/driver.unit.test.ts:343:37   (expect(result.exitStatus).not.toBe(0))
```

Test 2 loops over two cases and stops at the first failure. To check the second case ("listing refused") on its own, I removed the first case locally and ran the test again: it also failed with `expected +0 not to be +0`. So both cases fail: a refused `remove` with leftovers, and a refused leftover check.

### E2. Code path, failure 1 (`stop()` rejects)
- `driver.ts:223-226`: `finally { if (local !== undefined) raw["dev.log"] = await local.stop(); … }`. When an `await` in a `finally` block throws, that exception replaces the try/catch's normal completion. The stack in E1 shows the rejection propagating from `driver.ts:224:61` straight out of `runCompliance` to the test.
- So the code from `driver.ts:228` onwards never runs: neither `criterionResults` nor `deps.writeEvidence` (line 245). The test's `recordOf(h)` would find `h.written` empty. The run's `exitStatus` (already 1 from the failing Vitest run, line 215) is lost.
- `cli.ts:16-25`: any exception out of `runCompliance` is caught by the same `catch` that handles `parseArgs` usage errors, and it sets `exitCode = 64` ("64 for a usage error", `cli.ts:5`). The process therefore exits 64. That is not the original failure's status, which breaks CLI-REQ-003 ("When cleanup also fails, it MUST keep the original failure's status"). With no record written, it also breaks COMPL-REQ-003 ("Each run on each target MUST write an evidence record").
- The real `stop()` can reject. `node-deps.ts:108-116` awaits the child's `closed` promise after SIGINT/SIGKILL, plus whatever follows it. So this is a real path, not just a fake. The test injects the rejection through `DriverDeps.startLocal`, which is the driver's injection seam (DEC-0394).

### E3. Code path, failure 2 (cleanup fails after passing tests)
- `driver.ts:146-159` `removeStage`: a `remove` rejection is caught and written to `raw["remove-<stage>.log"]`. `checkLeftovers` (`:136-145`) catches a listing rejection and pushes `"<stage>: leftover check failed: …"` to `leftovers`. Neither touches `exitStatus`. The only effect of a `false` return is that the stage stays in the pending list (`:158`).
- `exitStatus` is assigned only at `:177` (typecheck), `:215` (runner status) and `:222` (setup failure). With passing tests (fake Vitest status 0) and no setup error, it stays 0. The record is written with `exitStatus: 0` and non-empty `leftovers`, and `runCompliance` returns 0. That matches E1.
- The sibling test "a failing test whose stage removal fails keeps the original status…" passes only because the runner status (1) was already set. It does not exercise this gap.

### E4. The tests match the criterion (are the tests right?)
- CLI-AC-003 (`docs/components/cli.md:107`): "Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure." CLI-REQ-003 (`cli.md:39-42`): non-zero "when it fails, including partial failures"; "When cleanup also fails, it MUST keep the original failure's status."
- Test 1 asserts exit 1, which is the original failure's status from the failing tagged test. It also asserts that the record is written with `exitStatus` 1, that KV-AC-001 is still `failed`, and that the raw output contains the stop error. Keeping status 1 is exactly what CLI-REQ-003 requires. Writing the record follows from COMPL-REQ-003. Putting the error text in raw output follows from COMPL-REQ-003's raw-output/evidence intent, and the driver already does this for `remove` failures. The test does not prescribe a raw file name, so it is not over-specified.
- Test 2 asserts only `not.toBe(0)`, and that the record's `exitStatus` equals the returned status. A cleanup failure after passing tests is a failure of the command: test stages "MUST always attempt to remove … and MUST record any leftover resources" (COMPL-REQ-004). Exiting 0 would say the run succeeded. That is the "partial failure" case CLI-REQ-003 names. It is also consistent with `remove` itself exiting 1 when leftovers remain (DEC-0395). The test does not fix the exact value, which the criterion does not fix either. I found no spec text that requires exit 0 with leftovers. The `cli.ts` header comment ("Exit status: the test runners' status …, 1 when setting up the target failed …") describes the current behaviour and is not a spec. It should be updated with the fix.
- Both tests use only the existing `harness()` fake and the public `DriverDeps` seam. Neither depends on internals.

### E5. Experiment: the proposed fix makes both tests pass and breaks nothing
I applied the fix below to `driver.ts` locally, with both tests unskipped, and ran `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/`: 14 files, 95 tests passed, 0 skipped in the block. `npx tsc -p tests/compliance/harness/tsconfig.json --noEmit` reported no errors in `driver.ts`. The only errors it reported were the existing `TS2307` errors for the unbuilt `@lago-morph/prototype-framework` in `tests/compliance/e2e/*`, which are unrelated. I then reverted the fix.

## Chain (cause → symptom)

1. Failure 1: unguarded `await local.stop()` in `finally` (`driver.ts:224`, E2) → the rejection escapes `runCompliance` (stack, E1) → `writeEvidence` is never reached (E2) → test: `recordOf` would throw / the exception surfaces as the test error (E1). In production, `cli.ts:22-24` turns the exception into exit 64 (E2).
2. Failure 2: cleanup errors are converted into `leftovers` entries only, and no line maps leftovers or cleanup failures to `exitStatus` (E3) → passing tests leave `exitStatus` 0 → returned and recorded status 0 → `expect(result.exitStatus).not.toBe(0)` fails, in both sub-cases (E1).

## Alternatives considered and ruled out

- **The test is wrong / over-specified.** Ruled out in E4: each assertion traces to CLI-REQ-003, COMPL-REQ-003 or COMPL-REQ-004, and no spec text allows exit 0 with leftovers.
- **The fake `harness()` misbehaves.** The fake's `stop` and `remove`/`listStageResources` overrides are plain rejected promises, passed through the public `DriverDeps`. The stack in E1 points into `driver.ts:224`, not into harness logic. The passing sibling tests use the same fake.
- **Fix in `cli.ts` (map exceptions to 1 instead of 64).** That would not write the record (COMPL-REQ-003) and would not keep the original status in general. It treats the symptom.
- **Wrap the whole `finally` in a try/catch.** It would also mask a `removeStage` exception from `pendingStages`/`assertTestStage` bookkeeping, which is wider than needed. The minimal guard covers only `stop()`. `removeStage` already guards its own calls.
- **A dedicated `cleanupFailed` flag instead of `leftovers.length > 0`.** Equivalent for both tests. However, it would also count a `remove` that rejects even though the leftover check then finds nothing left. `leftovers` is the authority on what remains (COMPL-REQ-004), and it includes a failed leftover check. A stage that an earlier interrupted run left behind and that cannot be removed is also a leftover of this run's cleanup. So the leftovers rule is the smaller, spec-aligned one. The reviewer may prefer the flag. Either way, the tests pass.

## Proposed fix (files)

`tests/compliance/harness/driver.ts`. This is the exact diff that was trialled in E5:

```diff
     } finally {
-      if (local !== undefined) raw["dev.log"] = await local.stop();
+      if (local !== undefined) {
+        try {
+          raw["dev.log"] = await local.stop();
+        } catch (error) {
+          raw["dev.log"] = `dev stop failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
+          deps.log(`compliance: stopping dev failed: ${firstLine(error)} (raw/dev.log)`);
+          exitStatus ||= 1;
+        }
+      }
       if (ops !== undefined && deployed && stage !== undefined) await removeStage(ops, stage);
     }
   }
+  // A stage that could not be removed, or a leftover check that could not run, is a partial failure (CLI-REQ-003).
+  if (leftovers.length > 0) exitStatus ||= 1;
```

`||=` keeps an earlier non-zero (original) status and sets 1 only when the run had otherwise succeeded.

Also:
- `tests/compliance/harness/cli.ts` header comment: add "1 when cleanup failed (dev did not stop, or leftovers remain) after an otherwise successful run".
- `docs/components/compliance.md`, Driver paragraph: one sentence with the same rule. It is not required by the tests, but the driver section is the spec of record.
- `tests/compliance/harness/driver.unit.test.ts`: change `it.skip(` to `it(` at lines 289 and 334, and remove the two "Skipped: …" comments. Make no other test changes.
- Item C-T6's decision draft (now DEC-0394…DEC-0397 in the decision log): change DEC-0396 to resolved, with a reference to this record.

## Verification (red-green, §8 step 3)

1. Red: on the unfixed driver, unskip both tests. `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/driver.unit.test.ts -t "CLI-AC-003"` → 2 failed (as in E1).
2. Green: apply the fix → the same command gives 5 passed, 0 skipped. Then `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` gives 95 passed (E5).
3. `grep -n "it.skip" tests/compliance/harness/driver.unit.test.ts` returns nothing.
4. `npm run verify` is green. The next local compliance run's record has no `not-run` skipped-test entries for CLI-AC-003's runner parts (each skipped tagged test currently adds one), and the evaluator re-checks CLI-AC-003 (§8 step 4).

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this, or write the driver or the tests. Local only, no Cloudflare calls. Branch `claude/implement-local-cloudflare-rc-c6-review`, from `origin/claude/implement-local-cloudflare-diag-c6`.

**Verdict: ACCEPTED**, with the fix requirements below.

### Links checked

- **E1 reproduced.** I unskipped both tests locally and ran `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/driver.unit.test.ts -t "CLI-AC-003"`. The result was `2 failed | 3 passed`, with `Error: dev did not stop` and `expected +0 not to be +0`, as recorded. I reverted the change.
- **E2 holds.** I read `driver.ts:223-226`. `await local.stop()` in `finally` has no guard, so a rejection there replaces the completion of the `try`/`catch`. That means `writeEvidence` (`:245`) is never reached. `cli.ts:17-25` wraps `runCompliance` in the same `catch` as `parseArgs` and sets 64. The real `stop()` (`node-deps.ts:108-116`) awaits `closed`, so the rejection is a real path and not only an artefact of the fake.
- **E3 holds.** I checked every assignment to `exitStatus`: `:132` (0), `:177`, `:215`, `:222`. Neither `checkLeftovers` (`:136-145`) nor `removeStage` (`:146-159`) touches it.
- **E5 reproduced.** I applied the exact diff and unskipped both tests. `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` gave `14 passed (14)` files and `95 passed (95)` tests. I reverted both.
- **E4: the tests are right.** CLI-REQ-003 (`cli.md:42`) says "non-zero … including partial failures" and "keep the original failure's status". CLI-AC-003 (`cli.md:107`) names the compliance runner and "a failure during cleanup". Test 1 asserts the original status (1), a written record (COMPL-REQ-003) and the error text in raw output. Test 2 asserts only `not.toBe(0)`. Neither is over-specified.
- **Alternatives.** The record argues each one convincingly. Changing only `cli.ts` would leave the record unwritten, so it treats the symptom. Wrapping the whole `finally` is wider than needed. The flag-versus-leftovers choice is covered below.

### Specific questions

1. **Does "any leftover ⇒ exit 1" match the criterion?** Yes. `leftovers` holds only two kinds of entry. The first is resources that `stageLeftovers` (`leftovers.ts:19-23`) still lists for a `test-` stage. These come only from PROV's removal list, matched by the exact stage name or pattern, and `prodcheck` is never checked. The second is `leftover check failed: …` entries. I found no code path that adds a benign or informational entry. A leftover is, by definition, cleanup that did not complete (COMPL-REQ-004), so it is a partial failure under CLI-REQ-003. The leftovers rule is better than a `cleanupFailed` flag. A `remove` that rejects while the check finds nothing (the check covers the Worker, bucket, R2 token, `sst-state` and D1, per DEC-0357) has met the cleanup goal, and the raw `remove-<stage>.log` still records it. Leftovers from a stage left pending by an earlier interrupted run also make this run exit 1 until they are removed. That is intended (DEC-0263: "its stages appear as leftovers"), and the existing log line `compliance: leftovers: …` (`:249`) names them.
2. **Could it turn every cloud run into a failure today, and what should an unrunnable check do?** It could, but only for runs where the check really cannot run, and that is the correct outcome. `package.json` (`"compliance": "node tests/compliance/harness/run.mjs"`) and `run.mjs`/`launch.mjs` do not set `NODE_USE_ENV_PROXY` for the driver process. Behind this sandbox's proxy, `stageResourceOperations` (`node-deps.ts:143-150`) therefore rejects before any request is sent unless the operator starts the driver with `NODE_USE_ENV_PROXY=1`. That is what DEC-0357 tells D-RUN to do. It rejects the same way when credentials are missing, and on `aws` ("not built"). An unrunnable check means the run cannot show that its stage is gone. DEC-0263 and D-06-2 require recording this as `leftover check failed`, "never as 'no leftovers'". Exiting 0 would claim a success the run cannot prove, which breaks CLI-REQ-003. **An unrunnable leftover check must give a non-zero status (1)**, with the reason in `leftovers` and the stage kept pending. It must not be exempted. When the launch is correctly configured, a run whose removal succeeds lists nothing and exits with the test status, so a correct run is not penalised. Operational note (not a fix requirement): cloud runs must be started as `NODE_USE_ENV_PROXY=1 npm run compliance -- --target cloudflare …`, or every one of them will now exit 1, and correctly so.
3. **Is an evidence record still written in every failure path?** With the fix, yes, in every path the tests inject and every path the record identifies: setup or deploy failure, failing tests, `stop()` rejection, `remove` rejection, and check rejection. Some paths are still unguarded and fall outside this record's cause: `deps.pendingStages.remove` (a file write) called from `removeStage` in `finally`, a non-`DirtyTreeError` exception from `assertCleanTree` or `writeEvidence`, and an exception from `criterionResults`/`versions()`. These throw out of `runCompliance`, so no record is written and the process exits 64. They are follow-ups, not blockers (see F1).
4. **Does the exit code distinguish usage errors (2) from failures (1), as cli.md says?** No, but cli.md does not bind the runner on this point. `cli.md:81` ("0 success, 1 failure, 2 usage error") describes the framework CLI in `src/cli/`. The compliance runner (`tests/compliance/harness/cli.ts`) defines its own statuses: 2 for refused evidence (a dirty tree) and 64 for a usage error. CLI-REQ-003/CLI-AC-003 only require a non-zero status that reflects the original failure, and both conventions meet that. The real defect is that `cli.ts` also gives 64, its *usage* status, to **any unexpected runtime exception**. That is how failure 1 surfaced as a "usage error". The proposed fix removes that path for `stop()`. The general mislabelling remains (F1).

### Fix requirements (step 3, red-green)

1. **Red:** unskip both tests (`it.skip(` → `it(` at `driver.unit.test.ts:289` and `:334`, and remove the two "Skipped: …" comments). Run them against the unfixed driver and confirm 2 fail. Change nothing else in the tests.
2. **Green:** apply the record's `driver.ts` diff exactly. Guard only `local.stop()`. In its `catch`, write `raw["dev.log"]` with the error text, call `deps.log`, and set `exitStatus ||= 1`. After the `if (toRun.length > 0)` block and before the record is built, add `if (leftovers.length > 0) exitStatus ||= 1;`. Use `||=`, never `=`, so that an earlier non-zero (original) status is kept. Do not exempt `leftover check failed` entries. Do not add a `cleanupFailed` flag.
3. `vitest … tests/compliance/harness/` gives 95 passed. `grep -n "it.skip" tests/compliance/harness/driver.unit.test.ts` finds nothing. `npm run verify` is green.
4. Update the `cli.ts` header comment: "1 when setting up the target failed, or when cleanup failed (dev did not stop, a stage could not be removed, or the leftover check could not run) after an otherwise successful run".
5. Add one sentence to the Driver paragraph in `docs/components/compliance.md`: a leftover, a leftover check that could not run, or a `dev` that did not stop makes the run exit non-zero, keeping any earlier non-zero status (CLI-REQ-003).
6. Set DEC-0396 to resolved, referring to this record and review.

### Follow-ups (not blockers; record as decision entries)

- **F1.** In `cli.ts`, catch `parseArgs` errors (usage, 64) separately from exceptions thrown by `runCompliance`. Those should exit 1 and print the message, so that an unexpected failure is never reported with the usage status. Whether the runner should move to the framework's 0/1/2 convention (and `smoke` exits 1 on a dirty tree, while the runner exits 2) is an owner decision. Either way, CLI-REQ-003 is already met.
- **F2.** Guard `deps.pendingStages.remove` in `removeStage` so that a failure to persist the pending list cannot stop the record from being written.

## Fix

Fixer: fixing subagent (prompt §8 step 3). I did not diagnose or review this record. Local only, no Cloudflare calls. Branch `claude/implement-local-cloudflare-fix-c6`, from `origin/claude/implement-local-cloudflare-rc-c6-review` with `origin/claude/implement-local-cloudflare` merged in.

- **Red.** I unskipped both tests (`it.skip(` → `it(`, and removed the two "Skipped: …" comments; no other test change). Against the unfixed driver, `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/driver.unit.test.ts -t "CLI-AC-003"` gave `2 failed | 3 passed`, with `Error: dev did not stop` and `AssertionError: expected +0 not to be +0`, as in E1.
- **Green.** I applied the reviewed diff to `tests/compliance/harness/driver.ts` exactly: only `local.stop()` is guarded (the error text goes to `raw["dev.log"]`, a `compliance: stopping dev failed: …` line is logged, and `exitStatus ||= 1`), and after the `if (toRun.length > 0)` block, `if (leftovers.length > 0) exitStatus ||= 1;`. There is no new flag, and `leftover check failed` entries are not exempted. The same command then gave `5 passed`. `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` gave 14 files and 95 tests passed. `grep -rnE "(it|test|describe)\.skip" tests/compliance/harness/` finds nothing.
- **Docs.** The `cli.ts` header comment and the Driver paragraph of `docs/components/compliance.md` state the rule (fix requirements 4 and 5). DEC-0396 (decision log, `Item: C-T6`) is now resolved and points here. Its integration into the decision log is left to the next -INT.
- **verify.** `npm run verify` passed (rc 0).
- **Not done here (review follow-ups).** F1: `cli.ts` still gives the usage status 64 to any runtime exception from `runCompliance`. F2: `deps.pendingStages.remove` in `removeStage` is still unguarded.
- **Local compliance run** (commit `1b0b953`, `--only CLI-AC-003,CORE-AC-006,SQL-AC-006`, record outside the repo): CLI-AC-003, CORE-AC-006 and SQL-AC-006 `passed`; CORE-AC-006 and SQL-AC-006 also have their expected `not-run` AWS parts (DEC-0397). No `not-run` skipped-test entry remains for CLI-AC-003. The run exited 1 because of an unrelated suite failure: `tests/compliance/criteria/compl/targets.test.ts` cannot parse a Where entry in `docs/decisions/decision-log.md` ("unexpected target … names a unit test."). Neither file is changed by this fix (both are identical to `origin/claude/implement-local-cloudflare`), so it needs its own root cause.
