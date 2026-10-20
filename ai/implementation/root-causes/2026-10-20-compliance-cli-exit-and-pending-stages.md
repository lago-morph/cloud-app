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
