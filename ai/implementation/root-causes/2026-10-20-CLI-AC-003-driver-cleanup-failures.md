# Root cause: CLI-AC-003 (compliance runner): a failing `dev` stop throws out of the driver, and a failed stage cleanup after passing tests exits 0

Author: diagnosing subagent (prompt §8 step 1). I did not write the driver or these tests. This is a diagnosis only: the commit changes no code and no test (my local unskips and the trial fix were reverted). It needs an independent review (§8 step 2) before anyone fixes it. Local only: no Cloudflare calls were made.

Branch: `claude/implement-local-cloudflare-diag-c6`, from `origin/claude/implement-local-cloudflare-c-t6` (commit with the tests as `it.skip`).

**Finding in one line.** The code is wrong; both tests are right. (1) `runCompliance` awaits `local.stop()` unguarded in its `finally` block (`tests/compliance/harness/driver.ts:224`), so a rejection replaces the run's result with a thrown error: no record is written and `cli.ts` exits 64. (2) Nothing in the driver turns cleanup failures into a non-zero status: `removeStage` and `checkLeftovers` swallow errors and only append to `leftovers`, so a run whose tests all passed exits 0 with leftovers recorded.

## Symptom

Two `[CLI-AC-003]` tests in `tests/compliance/harness/driver.unit.test.ts` (block "compliance runner exit status under injected failures") were committed as `it.skip` by their author (DEC-PENDING-C-T6-3, `ai/implementation/decisions/C-T6.md`). Prompt §8 does not allow skipping, so they have to be unskipped once the driver is fixed.

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
- The real `stop()` can reject. `node-deps.ts:108-116` awaits the child's `closed` promise after SIGINT/SIGKILL, plus whatever follows it. So this is a real path, not just a fake. The test injects the rejection through `DriverDeps.startLocal`, which is the driver's injection seam (DEC-PENDING-C-T6-1).

### E3. Code path, failure 2 (cleanup fails after passing tests)
- `driver.ts:146-159` `removeStage`: a `remove` rejection is caught and written to `raw["remove-<stage>.log"]`. `checkLeftovers` (`:136-145`) catches a listing rejection and pushes `"<stage>: leftover check failed: …"` to `leftovers`. Neither touches `exitStatus`. The only effect of a `false` return is that the stage stays in the pending list (`:158`).
- `exitStatus` is assigned only at `:177` (typecheck), `:215` (runner status) and `:222` (setup failure). With passing tests (fake Vitest status 0) and no setup error, it stays 0. The record is written with `exitStatus: 0` and non-empty `leftovers`, and `runCompliance` returns 0. That matches E1.
- The sibling test "a failing test whose stage removal fails keeps the original status…" passes only because the runner status (1) was already set. It does not exercise this gap.

### E4. The tests match the criterion (are the tests right?)
- CLI-AC-003 (`docs/components/cli.md:107`): "Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure." CLI-REQ-003 (`cli.md:39-42`): non-zero "when it fails, including partial failures"; "When cleanup also fails, it MUST keep the original failure's status."
- Test 1 asserts exit 1, which is the original failure's status from the failing tagged test. It also asserts that the record is written with `exitStatus` 1, that KV-AC-001 is still `failed`, and that the raw output contains the stop error. Keeping status 1 is exactly what CLI-REQ-003 requires. Writing the record follows from COMPL-REQ-003. Putting the error text in raw output follows from COMPL-REQ-003's raw-output/evidence intent, and the driver already does this for `remove` failures. The test does not prescribe a raw file name, so it is not over-specified.
- Test 2 asserts only `not.toBe(0)`, and that the record's `exitStatus` equals the returned status. A cleanup failure after passing tests is a failure of the command: test stages "MUST always attempt to remove … and MUST record any leftover resources" (COMPL-REQ-004). Exiting 0 would say the run succeeded. That is the "partial failure" case CLI-REQ-003 names. It is also consistent with `remove` itself exiting 1 when leftovers remain (DEC-PENDING-C-T6-2). The test does not fix the exact value, which the criterion does not fix either. I found no spec text that requires exit 0 with leftovers. The `cli.ts` header comment ("Exit status: the test runners' status …, 1 when setting up the target failed …") describes the current behaviour and is not a spec. It should be updated with the fix.
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
- `ai/implementation/decisions/C-T6.md`: change DEC-PENDING-C-T6-3 to resolved, with a reference to this record.

## Verification (red-green, §8 step 3)

1. Red: on the unfixed driver, unskip both tests. `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/driver.unit.test.ts -t "CLI-AC-003"` → 2 failed (as in E1).
2. Green: apply the fix → the same command gives 5 passed, 0 skipped. Then `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` gives 95 passed (E5).
3. `grep -n "it.skip" tests/compliance/harness/driver.unit.test.ts` returns nothing.
4. `npm run verify` is green. The next local compliance run's record has no `not-run` skipped-test entries for CLI-AC-003's runner parts (each skipped tagged test currently adds one), and the evaluator re-checks CLI-AC-003 (§8 step 4).
