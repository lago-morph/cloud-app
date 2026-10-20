# Root cause: compliance runner: runtime exceptions exit with the usage status 64 (F1), and a failed pending-stages write loses the evidence record (F2)

Author: diagnosing subagent (prompt §8 step 1). I did not write the compliance driver, `cli.ts` or their tests. This is a diagnosis only. The commit changes no code and no tests: the reproduction tests and the trial fix were run locally and then removed or reverted. The record needs an independent review (§8 step 2) before anyone fixes it. Local only: no Cloudflare calls were made.

Branch: `claude/implement-local-cloudflare-diag-c7`, from `origin/claude/implement-local-cloudflare` (`1f59686`). Node v22.22.0, vitest 5.0.5, after `npm ci --ignore-scripts`.

Origin: these are the two follow-ups F1 and F2 in the Review of `2026-10-20-CLI-AC-003-driver-cleanup-failures.md`. The Fix of that record left both open. Another fix is editing `tests/compliance/harness/catalogue.ts` and `tests/compliance/criteria/compl/support.ts`. Nothing here reads or depends on those changes.

**Finding in one line.** Both defects are confirmed.
- **F1:** `cli.ts` handles `parseArgs` errors and every exception thrown by `runCompliance` in a single `catch`, and that `catch` sets 64. So a runtime failure is reported with the usage status.
- **F2:** `removeStage` calls `deps.pendingStages.remove` with no guard. A write failure there either escapes `runCompliance` and loses the record (the run's own stage, removed in `finally`), or is misreported as a setup failure that cancels every test (a stale stage, removed before deploy).

---

## F1. `cli.ts` exits 64 on any runtime exception

### Symptom
When `runCompliance` rejects, `npm run compliance` exits 64. Its header comment documents 64 as "64 for a usage error" (`cli.ts:5`). The arguments were valid, so the status says the failure was the user's when it was not.

### Evidence
**E1.1. Reproduction (fakes).** I added a temporary unit test, `tests/compliance/harness/zz-diag-c7-cli.unit.test.ts` (full source in the Appendix). It mocks `./driver.js` (`runCompliance` is a `vi.fn()`) and `./node-deps.js`, sets `process.argv`, stubs `process.exit` and `process.stderr.write`, and then imports `./cli.js` after `vi.resetModules()`.
- Control: `--target nowhere` gives 64 and `runCompliance` is never called. This passed.
- Control: a resolved `{ exitStatus: 1 }` gives 1. This passed.
- Defect: `runCompliance` rejects with `Error("EACCES: …pending-stages.json")`. The message reaches stderr, but the code is 64:

```
FAIL  zz-diag-c7-cli.unit.test.ts > … > runtime exception from runCompliance -> should be 1, not the usage status 64
AssertionError: expected 64 to be 1 // Object.is equality
 ❯ tests/compliance/harness/zz-diag-c7-cli.unit.test.ts:46:20
```

**E1.2. Code path.** `cli.ts:17-27`. A single `try` covers `parseArgs(argv)` (`:19`), the self-test `out` default (`:21`), `nodeDeps(repoRoot)` and `await runCompliance(…)` (`:22`). The single `catch` (`:23-26`) writes the message and sets `exitCode = 64`, whatever was thrown.

**E1.3. Exceptions that really reach this catch.** I traced each of these in `driver.ts`:
- `select()` → `deps.catalogue()` (`:89`, `:125`, outside any try). A Where-text parse error from `catalogue.ts:51-95` (`cannot read the Where text`, `unknown target`, `defined twice`) throws from here.
- `assertCleanTree` throws something other than `DirtyTreeError`, for example when git fails (`:117`).
- `writeEvidence` throws something other than `DirtyTreeError`, for example a schema or fs error (`:262`).
- `criterionResults` or `deps.versions()` throw (`:240`, `:251`).
- `deps.pendingStages.remove` throws inside `finally` (F2, E2.1). That is a direct path from F2 to the 64 status.

### Is it a defect against the criterion?
Yes.
- CLI-AC-003 (`docs/components/cli.md:107`): injected failures in the compliance runner "yield non-zero exit statuses **that reflect the original failure**". The original failure here is a runtime error, such as a parse or I/O error. 64 is the runner's documented usage status (`cli.ts:5`), so it reports a failure of a different kind. 64 is non-zero, so the "non-zero" half of CLI-REQ-003 (`cli.md:42`) holds. The "reflect the original failure" half of CLI-AC-003 does not.
- The runner's own documented contract (`cli.ts:1-6`) lists no 64 for runtime failures. Its catch-all for failures is 1 ("1 when setting up the target failed, or when cleanup failed …"). The behaviour contradicts the file's own spec comment.
- `cli.md:81` (0/1/2) governs the framework CLI in `src/cli/`, not this runner, so I do not use it as evidence. The CLI-AC-003 review (question 4) concluded the same. Whether the runner should move to 0/1/2 is an owner decision and is outside this fix.

### Chain
`runCompliance` rejects (any path in E1.3) → the shared `catch` at `cli.ts:23` → `exitCode = 64` at `:25` → `process.exit(64)` at `:27`. E1.1 shows the rejection reaching the `catch` (message on stderr) and the 64 reaching `process.exit`.

### Alternatives considered
- **The test fakes cause the 64.** No. The two control cases use the same harness and pass: usage gives 64, and a resolved status is passed through. Only the rejection case differs.
- **Make the driver never throw instead.** It cannot be total. If `writeEvidence` fails with an I/O error, there is no record to fall back to and the error has to surface. `cli.ts` still needs a correct status for that case. Guarding individual driver paths (F2) is complementary, not a replacement.
- **Exit 2 for runtime errors.** 2 already means "evidence refused (dirty tree)" (`cli.ts:5`). Reusing it would mislabel the failure again.

### Proposed fix (files)
`tests/compliance/harness/cli.ts`: parse in its own `try` (usage, 64). Run in a second `try` whose `catch` prints the message and sets 1. This is the exact diff I trialled:

```diff
-let exitCode: number;
+const message = (error: unknown): string => `compliance: ${error instanceof Error ? error.message : String(error)}\n`;
+let parsed: ReturnType<typeof parseArgs> | undefined;
 try {
-  const parsed = parseArgs(argv);
-  // The self-test's record is not compliance evidence: it goes outside validation/ by default.
-  const args = parsed.selfTest && parsed.out === undefined ? { ...parsed, out: join(repoRoot, ".framework", "compliance", "self-test") } : parsed;
-  exitCode = (await runCompliance(args, argv, nodeDeps(repoRoot))).exitStatus;
+  parsed = parseArgs(argv);
 } catch (error) {
-  process.stderr.write(`compliance: ${error instanceof Error ? error.message : String(error)}\n`);
-  exitCode = 64;
+  process.stderr.write(message(error));
+}
+let exitCode = 64;
+if (parsed !== undefined) {
+  try {
+    // The self-test's record is not compliance evidence: it goes outside validation/ by default.
+    const args = parsed.selfTest && parsed.out === undefined ? { ...parsed, out: join(repoRoot, ".framework", "compliance", "self-test") } : parsed;
+    exitCode = (await runCompliance(args, argv, nodeDeps(repoRoot))).exitStatus;
+  } catch (error) {
+    process.stderr.write(message(error));
+    exitCode = 1;
+  }
 }
 process.exit(exitCode);
```

Also update the `cli.ts` header comment to add "1 when the runner failed unexpectedly (the message is printed)". The fixer adds the E1.1 test as a committed unit test. Name it `cli.unit.test.ts` and tag it `[CLI-AC-003]`.

### Verification
1. Red: on the unfixed `cli.ts`, the E1.1 test fails `expected 64 to be 1`, and both controls pass.
2. Green: with the diff, all three pass (E-T below).

---

## F2. A failing pending-stages write loses the evidence record

### Symptom
On a cloud run, suppose the stage is removed and the leftover check finds nothing, but persisting the pending list then fails. For example, `.framework/compliance/pending-stages.json` is unwritable. Then `runCompliance` throws, no evidence record is written, and the CLI exits 64 (F1). If the failing stage is a stale one from an earlier run, the whole run is instead recorded as "setting up the target failed", and every criterion is `not-run`, although the tests could have run.

### Evidence
**E2.0. The real store throws.** `pendingStageStore` (`node-deps.ts:28-52`) swallows read errors (`:30-34`). Its `write` (`:36-39`: `mkdirSync` and `writeFileSync`) has no guard, and `add` and `remove` call it directly. I checked this experimentally. `pendingStageStore("/dev/null/compliance/pending-stages.json")` returns `[]` from `list`, and its `remove` throws `/ENOTDIR|EEXIST/`. The temporary test passed. So the fake's throwing `remove` below matches a real behaviour and is not an artefact of the fake.

**E2.1. Reproduction A: the run's own stage (fakes).** I added a temporary test, `zz-diag-c7-pending.unit.test.ts` (Appendix). It uses a cloudflare run with one tagged test passing, no stale stages, `deploy`/`remove`/`listStageResources` succeeding, and `pendingStages.remove` throwing `EACCES`. The event log and the result:

```
events: run run, run run, deploy test-abcdefghij12345, run vitest, run playwright,
        remove test-abcdefghij12345, pending- test-abcdefghij12345 (throws)
thrown: "EACCES: permission denied, open '.framework/compliance/pending-stages.json'"
written: 0
AssertionError: expected Error: EACCES: … to be undefined   (zz-diag-c7-pending.unit.test.ts:67)
```

**E2.2. Reproduction B: a stale stage (fakes).** This is the same setup with `pending = ["test-oldoldoldold123"]`. The record is written, but:

```
events: run run, run run, remove test-oldoldoldold123, pending- test-oldoldoldold123 (throws),
        log compliance: not run: setting up the target failed: EACCES: …
result: { exitStatus: 1 }
results: [{ id: "KV-AC-001", status: "not-run", detail: "not run: setting up the target failed: EACCES: …" }]
leftovers: []
AssertionError: expected 'not-run' to be 'passed'
```

The stale stage was in fact removed, and nothing was left over. Even so, no stage was deployed and no test ran.

**E2.3. Code path.**
- `driver.ts:146-159` `removeStage`: `remove` is guarded (`:153-157`) and `checkLeftovers` guards itself (`:136-145`). Line `:158`, `if (await checkLeftovers(ops, name)) deps.pendingStages.remove(args.target, name);`, has no guard.
- Path A: `removeStage(ops, stage)` is awaited inside `finally` (`:233`). A throw from a `finally` replaces the completion of the `try`/`catch`, so `runCompliance` rejects, and `:237-260`, including `deps.writeEvidence` at `:255`, never runs. This is the same mechanism as failure 1 in the CLI-AC-003 record, but at a different call.
- Path B: `removeStage(ops, old)` for each stale stage runs inside the `try` (`:182`). The throw goes to the setup `catch` (`:217-222`), which marks every runnable criterion `not-run: setting up the target failed` (`:221`) before deploy and before any test.
- I ruled out `pendingStages.add` (`:185`). It is inside the `try` and before `deployed = true` (`:186`), so a failed `add` deploys nothing and the record is written as a setup failure. That behaviour is correct: a stage that cannot be recorded as pending must not be created.

### Is it a defect against the criterion?
Yes.
- COMPL-REQ-003 (`compliance.md:22`): "Each run on each target MUST write an evidence record". Path A writes none, although the record could have been written, since tests ran and cleanup succeeded.
- CLI-REQ-003 / CLI-AC-003: a failure during cleanup must keep "the original failure's status". In path A, the status of the run (0 or the runner's status) is lost and replaced by 64 (F1).
- COMPL-REQ-004 and the Driver paragraph (`compliance.md:65`): the pending list exists so that "the next cloud run removes them first". Removing a stale stage is housekeeping. Treating a failed bookkeeping write as a failed target setup (path B) records every criterion as `not-run` for a reason that did not stop the target. The record's `detail` is then inaccurate under COMPL-REQ-003's reasons rule: the target was not the thing that failed to set up.
- A failed persist is still a partial failure of the command (CLI-REQ-003 "including partial failures"). The stage stays in the file, so the next run will try to remove it again. The run must therefore exit non-zero, but it must still write its record and run its tests.

### Chain
- A: `writeFileSync` throws (E2.0) → `pendingStages.remove` throws at `driver.ts:158` → `removeStage` rejects at `:233` in `finally` → `runCompliance` rejects (E2.1 `thrown`) → `writeEvidence` (`:255`) is never reached (E2.1 `written: 0`) → `cli.ts:25` exits 64 (F1, E1.1).
- B: the same throw at `:158` → `removeStage` rejects at `:182` inside `try` → setup `catch` `:217-222` → all criteria `not-run`, exit 1 (E2.2).

### Alternatives considered
- **Make `pendingStageStore` swallow write errors.** This hides the failure entirely. The run would exit 0 while the file still lists a removed stage, which breaks CLI-REQ-003's partial-failure rule. The store also has no way to report a failure into the record.
- **Wrap the whole `finally` (or the `:182` loop) in try/catch.** This is wider than needed, and for path B it would still need its own handling. One guard at `:158` fixes both paths, because both go through `removeStage`.
- **Log only, keep the status.** A run that cannot persist its state has partly failed (CLI-REQ-003). `||= 1` keeps an earlier non-zero status, which is the same rule the CLI-AC-003 fix uses.
- **Treat it as a leftover.** The stage's resources are gone (the leftover check returned `[]`). `leftovers` is the authority on what remains (CLI-AC-003 review, question 1), so adding a non-resource entry would blur that. A separate raw log is the honest place for it.

### Proposed fix (files)
`tests/compliance/harness/driver.ts`, `removeStage` only. This is the exact diff I trialled:

```diff
-    if (await checkLeftovers(ops, name)) deps.pendingStages.remove(args.target, name);
+    if (await checkLeftovers(ops, name)) {
+      try {
+        deps.pendingStages.remove(args.target, name);
+      } catch (error) {
+        raw["pending-stages.log"] = `${raw["pending-stages.log"] ?? ""}${name}: could not update the pending-stage list: ${error instanceof Error ? error.message : String(error)}\n`;
+        deps.log(`compliance: ${name} was removed, but the pending-stage list could not be updated: ${firstLine(error)} (raw/pending-stages.log)`);
+        exitStatus ||= 1;
+      }
+    }
```

`exitStatus` is the enclosing `let` (`:132`), declared before `removeStage`, so the closure updates it. Also:
- Add one clause to the `cli.ts` header comment ("… or the pending-stage list could not be updated").
- Add one clause to the same sentence in `compliance.md:65` ("A leftover, a leftover check that could not run, a `dev` that did not stop, or a pending-stage list that could not be updated makes the run exit non-zero …").
- The fixer adds E2.1 and E2.2 as `[CLI-AC-003]` tests in `driver.unit.test.ts`, using the existing `harness()` with a throwing `pendingStages.remove`.

### Verification
1. Red: on the unfixed driver, A fails with the thrown `EACCES` and `written: 0`, and B fails `expected 'not-run' to be 'passed'`.
2. Green: with the diff, A writes one record. B records KV-AC-001 `passed`, `exitStatus` 1 (both returned and in the record), and `raw["pending-stages.log"]` contains `EACCES`.

---

## E-T. Trial of both fixes together (then reverted)
- With both diffs applied and the two temporary test files present, `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` gave `Test Files 16 passed (16)` and `Tests 101 passed (101)`. That is the existing 95 plus the 6 diagnostic tests: 3 for F1, 1 for the store, 2 for F2.
- `npx tsc -p tests/compliance/harness/tsconfig.json --noEmit` reported only the 5 existing `TS2307` errors for the unbuilt framework package in `tests/compliance/e2e/*`, and nothing in `cli.ts` or `driver.ts`.
- I then reverted `cli.ts` and `driver.ts` (`git checkout --`) and removed the temporary tests. `git status` was clean before this record was added.

## Observation (not diagnosed here; for the reviewer)
- Some throws still happen before the record exists or while it is written: `deps.catalogue()` in `select()` (`driver.ts:125`), a non-dirty `assertCleanTree` error, and a non-dirty `writeEvidence` error. They still write no record. After F1 they exit 1 with the message, which reflects the failure. Whether COMPL-REQ-003 requires a record when the catalogue itself cannot be read is a separate question. I did not reproduce it beyond the code reading in E1.3, so I make no claim about it.

## Appendix: the temporary reproduction tests (not committed as tests)

`tests/compliance/harness/zz-diag-c7-cli.unit.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const runCompliance = vi.fn();
vi.mock("./driver.js", () => ({ runCompliance }));
vi.mock("./node-deps.js", () => ({ nodeDeps: () => ({}) }));

async function runCli(argv: string[]): Promise<{ code: number | undefined; stderr: string }> {
  vi.resetModules();
  const saved = process.argv;
  process.argv = ["node", "cli", ...argv];
  let code: number | undefined;
  let stderr = "";
  const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { code = c; }) as never);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { stderr += s; return true; }) as never);
  try {
    await import("./cli.js");
  } finally {
    process.argv = saved;
    exit.mockRestore();
    err.mockRestore();
  }
  return { code, stderr };
}

afterEach(() => runCompliance.mockReset());

describe("diag-c7 F1: compliance cli exit status", () => {
  it("usage error -> 64 (control)", async () => {
    const r = await runCli(["--target", "nowhere"]);
    expect(runCompliance).not.toHaveBeenCalled();
    expect(r.code).toBe(64);
  });
  it("driver result is passed through (control)", async () => {
    runCompliance.mockResolvedValue({ exitStatus: 1 });
    expect((await runCli(["--target", "local"])).code).toBe(1);
  });
  it("runtime exception from runCompliance -> should be 1, not the usage status 64", async () => {
    runCompliance.mockRejectedValue(new Error("EACCES: permission denied, open '.framework/compliance/pending-stages.json'"));
    const r = await runCli(["--target", "local"]);
    expect(r.stderr).toContain("EACCES");
    expect(r.code).toBe(1);
  });
});
```

`tests/compliance/harness/zz-diag-c7-pending.unit.test.ts` (the essentials; the `deps()` fake mirrors `harness()` in `driver.unit.test.ts`, with one passing `[KV-AC-001]` Vitest test, succeeding cloud ops, and `pendingStages.remove` throwing `EACCES`):

```ts
describe("diag-c7 F2: the real store throws when it cannot write", () => {
  it("pendingStageStore.remove throws on an unwritable path", async () => {
    const { pendingStageStore } = await import("./node-deps.js");
    const store = pendingStageStore("/dev/null/compliance/pending-stages.json");
    expect(store.list("cloudflare")).toEqual([]);
    expect(() => store.remove("cloudflare", "test-x")).toThrow(/ENOTDIR|EEXIST/);
  });
});
describe("diag-c7 F2: pending-stages write failure", () => {
  it("A: run's own stage removed, then persisting the pending list fails -> record still written", async () => {
    // runCompliance(parseArgs(["--target","cloudflare"]), …, deps([], written, events))
    expect(thrown).toBeUndefined();
    expect(written).toHaveLength(1);
  });
  it("B: stale stage from an earlier run removed, then persisting fails -> the tests still run", async () => {
    // deps(["test-oldoldoldold123"], written, events)
    expect(written[0]?.record.results.find((r) => r.id === "KV-AC-001")?.status).toBe("passed");
    expect(result.exitStatus).toBe(1);
    expect(written[0]?.record.exitStatus).toBe(1);
    expect(written[0]?.raw["pending-stages.log"]).toContain("EACCES");
  });
});
```

---

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this, nor write `cli.ts`, `driver.ts` or their tests. Branch `claude/implement-local-cloudflare-rc-c7-review` from `origin/claude/implement-local-cloudflare` (`5ff76ea`). Local only; no Cloudflare calls. No code or tests changed: my reproduction tests and the trial of both diffs were run, then removed and reverted (`git status` clean before this section was added).

**Verdict: ACCEPTED.**

### Independent reproduction (own fakes)
Temporary `zz-rev-c7-cli.unit.test.ts` (mocks `./driver.js` and `./node-deps.js`, imports `./cli.js` after `vi.resetModules()`) and `zz-rev-c7-pending.unit.test.ts` (the `harness()` of `driver.unit.test.ts`, one passing `[KV-AC-001]` test, `pendingStages.remove` replaced by a thrower). On the unfixed code:
- F1: unknown option `--bogus` → 64 (control, passes); resolved `{ exitStatus: 2 }` → 2 (control, passes); a **non-Error** rejection (`"boom"`) → `expected 64 to be 1`; `nodeDeps()` throwing (`git missing`) → `expected 64 to be 1`. The second case is a path the record did not list: `nodeDeps(repoRoot)` is evaluated inside the same `try` (`cli.ts:22`).
- F2 A (own stage): events `… remove test-abcdefghij12345 | pending- test-abcdefghij12345 THROW`; `runCompliance` rejects with `EACCES`; `written` 0. Confirms E2.1.
- F2 B (stale stage): events `run run | run run | remove test-oldoldoldold123 | pending- … THROW`; no deploy, no test run; KV-AC-001 and KV-AC-002 `not-run: setting up the target failed: EACCES…`; `leftovers []`; exit 1. Confirms E2.2.
- F2 C (whole store unwritable: `add` also throws), stale stage: record written, exit 1, criteria `not-run: setting up the target failed`. Passes before and after the fix, which is right (record's ruling on `add`).
- F2 D (own-stage write fails after a failing test run with runner status 3): before the fix it rejects (no record); after, exit 3 and KV-AC-001 `failed`, i.e. the original status is kept (CLI-REQ-003).

### Trial of both diffs as written in the record
Applied verbatim, with my temp tests present: `npx vitest run --config vitest.unit.config.ts tests/compliance/harness/` → `Test Files 16 passed (16)`, `Tests 103 passed (103)` (95 existing + my 8). `tsc -p tests/compliance/harness/tsconfig.json --noEmit` showed nothing in `cli.ts`/`driver.ts` (only the existing unbuilt-package TS2307 errors and strictness notes in my temp file). Then reverted.

### Checks asked of the review
1. **Evidence supports every link.** Yes. Each chain link (shared catch at `cli.ts:23-26`; unguarded `:158`; `finally` at `:233` replacing the completion so `:255` is never reached; `:182` inside the setup `try` → `:217-222`) is shown by the event logs and assertions above, and E2.0 shows the real store's `write` throws.
2. **64 vs 2 for usage, against cli.md.** `cli.md` "Implementation (`src/cli/`, …)" (0 success, 1 failure, 2 usage) governs the framework CLI, not this runner; the runner already uses 2 for "evidence refused" (`cli.ts:5`, `driver.ts:119`, `:264`) and documents 64 for usage. Keeping usage at 64 and mapping runtime failures to 1 matches the runner's own contract and CLI-AC-003 ("reflect the original failure"). Moving the runner onto 0/1/2 would collide with its 2 and is an owner decision, out of scope. Not a reason to reject.
3. **Alternatives ruled out.** Yes: the controls rule out the fakes; the driver cannot be made total (`writeEvidence` I/O); swallowing in the store hides a partial failure; reusing 2 mislabels.
4. **Is a record now written in every path the defect covers?** For every pending-store path, yes: after the guard, nothing in `removeStage` can throw (`assertTestStage`, `ops.remove`, `checkLeftovers` and now `pendingStages.remove` are each guarded) and `local.stop` is guarded, so the `finally` cannot replace the completion; A, B and D all write one record. Paths that still write none are those before the record exists or while writing it (`select()`/`deps.catalogue()` at `:125`, non-dirty `assertCleanTree` at `:117`, `criterionResults`/`deps.versions()` at `:240`/`:251`, non-dirty `writeEvidence` at `:262`). After F1 they exit 1 with the message. The record lists them as an open observation; they are not part of this defect, and I do not require them here.
5. **Stale-stage failure records criteria correctly, not as setup failures.** Yes (B after fix): KV-AC-001 `passed`, no `driver-error.log`, `raw["pending-stages.log"]` holds `EACCES`, exit 1 both returned and in the record, `leftovers` empty. Note: because the stale-stage write fails first, `exitStatus` is already 1 when the test runners report, so a later non-zero runner status (say 3) is recorded as 1. This is the existing first-failure-wins `||=` rule (same as typecheck at `:177`) and the per-criterion results still show the failures, so I accept it; the fixer should not "improve" it ad hoc.
6. **Fix addresses the cause.** Yes: F1 separates usage errors from runtime errors at the one place the status is chosen; F2 guards the single unguarded call both paths go through.

### Fix requirements (for §8 step 3)
1. `tests/compliance/harness/cli.ts`: apply the F1 diff as given (parse in its own `try` → 64; run in a second `try` → print `compliance: <message>` and exit 1; `String(error)` for non-Error values). `nodeDeps(repoRoot)` must stay inside the second `try`. Update the header comment: "1 … when the runner failed unexpectedly (the message is printed)".
2. `tests/compliance/harness/driver.ts`: apply the F2 diff in `removeStage` only, exactly as given (append to `raw["pending-stages.log"]`, log with `firstLine`, `exitStatus ||= 1`). Do not guard `pendingStages.add` (a stage that cannot be recorded as pending must not be deployed).
3. Docs: add the pending-stage-list clause to the `cli.ts` header and to the exit sentence in `docs/components/compliance.md` (Driver paragraph), as proposed.
4. Red-green tests tagged `[CLI-AC-003]`, committed red first:
   - new `tests/compliance/harness/cli.unit.test.ts`: usage → 64 and `runCompliance` not called; resolved status passed through (include 2); `Error` rejection → 1 with message on stderr; non-Error rejection → 1; `nodeDeps` throwing → 1.
   - in `driver.unit.test.ts`, using `harness()`: A (own stage: one record, exit 1, KV-AC-001 `passed`, `raw["pending-stages.log"]` contains the error); B (stale stage: deploy and tests run, KV-AC-001 `passed`, no `driver-error.log`, exit 1 returned and in record); D (failing run with runner status 3 + own-stage write failure: one record, exit 3, KV-AC-001 `failed`).
5. Re-check per §8 step 4: the full `tests/compliance/harness/` unit run and the harness `tsc` check.
