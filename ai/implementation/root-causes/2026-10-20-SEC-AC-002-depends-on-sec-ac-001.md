# Root cause: SEC-AC-002 fails under `--only` because a SEC-AC-002 test reads state that the same file's SEC-AC-001 and SEC-AC-003/004 tests create

Author: diagnosing subagent (prompt §8 step 1; did not write the code or the tests). Diagnosis only; no code or test changed. Needs independent review (§8 step 2) before any fix.

## Symptom
Branch `claude/implement-local-cloudflare-diag-c5` = `origin/claude/implement-local-cloudflare` `475f954`, after `npm ci`, with no `apps/reference/.dev.vars`:

```
npm run compliance -- --target local --only FILES-AC-003,SKILL-AC-005,E2E-001,SEC-AC-002
compliance: 105 not-run, 3 passed, 1 failed; evidence …/scratchpad/run1/validation/local/6tq04e8fhokpowd.json
exit=1
```

The record's entry: `SEC-AC-002 failed — "1 of 5 tests failed: SEC on the local target > [SEC-AC-002] local: the repository, build output, .logs/ and error responses contain no test secret value: AssertionError: expected +0 to be 3 // Object.is equality"`. FILES-AC-003, SKILL-AC-005 and E2E-001 passed. (Raw output is in scratch, outside the repo: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/run1/`.)

The failing test is **not** in `tests/compliance/criteria/secrets/`. It is `packages/framework/test/integration/secrets/cli.test.ts:119`. The integration config (`vitest.integration.config.ts`) includes `packages/framework/test/integration/**/*.test.ts`, so the driver runs it as SEC-AC-002 evidence.

## Evidence
1. **Outcomes of the filtered run** (`raw/vitest.json`, SEC tests only):
   - `cli.test.ts`: `[SEC-AC-004]` skipped, `[SEC-AC-003]` skipped, `[SEC-AC-001]` skipped, `[SEC-AC-002]` **failed** with `expected +0 to be 3`.
   - `secrets.test.ts`: both `[SEC-AC-002]` tests passed. All three `[SEC-AC-001]` tests skipped.
   - `criteria/secrets/no-leak.test.ts`: the stub-login `[SEC-AC-002]` test passed. The main `[SEC-AC-002]` test reported `PREREQUISITE MISSING: … apiKey has no value in apps/reference/.dev.vars`. That is the documented run prerequisite (DEC-0277), not this failure (see Alternatives 3).
   - `criteria/secrets/read.test.ts` and `storage.test.ts`: all skipped.
2. **The code.** `cli.test.ts` says in its header (line 5): "The steps share one fixture app and run in order." State lives at module scope:
   - line 32 `let app: TempApp` (one fixture app, created in `beforeAll`);
   - line 33 `const secret = uniqueValue(...)`;
   - line 34 `const errorResponses: string[] = []`.

   Who writes and reads that state:

   | Test (tag) | Writes | Reads |
   |---|---|---|
   | SEC-AC-004 (l. 64) | `.dev.vars` ← a second stdin value (l. 79) | `.dev.vars` must not already contain `secret` (l. 75) |
   | SEC-AC-003 (l. 84) | `.dev.vars` ← `secret` (l. 85) | — |
   | SEC-AC-001 (l. 90) | starts `dev`; pushes 3 error bodies into `errorResponses` (l. 103, 113); `dev` writes `.logs/` | `/api/secret` must return `secret`, so needs SEC-AC-003's write (l. 95) |
   | SEC-AC-002 (l. 119) | builds | `errorResponses.length === 3` (l. 127); `.logs/` has an `"error"` entry (l. 137–138); `.dev.vars` contains `secret` (l. 146) |

   So SEC-AC-002's assertions depend on SEC-AC-001 (the error responses and the `.logs/` entries) and on SEC-AC-003 (the `.dev.vars` value). SEC-AC-001 in turn depends on SEC-AC-003. SEC-AC-004 depends on running before SEC-AC-003.
3. **The driver selects by tag, as specified.**
   - `tests/compliance/harness/driver.ts:206` runs `vitest run --config vitest.integration.config.ts -t <pattern>`.
   - `reports.ts:102` `grepPattern(ids)` gives `\[(?:FILES-AC-003|SKILL-AC-005|E2E-001|SEC-AC-002)\]`.
   - `selection.ts` only chooses the invocations (config, paths, projects). It does not filter tests. On local it passes no paths, so every integration file is collected.
   - compliance.md "Driver" (line 65) specifies this: "It runs each selected test layer once, selecting only the tests tagged with an expected ID". `--only` narrows the expected IDs (`driver.ts:94–95`).
   - So under `--only …SEC-AC-002` (without SEC-AC-001/003/004), vitest skips the three producer tests and runs only the consumer.
4. **Minimal reproduction, without the driver** (`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/secrets/cli.test.ts …`):

   | Filter | Result |
   |---|---|
   | none | `Tests 4 passed (4)` |
   | `-t '\[SEC-AC-002\]'` | `[SEC-AC-002]` × `expected +0 to be 3` at `cli.test.ts:127:35`; 1 failed, 3 skipped |
   | `-t '\[(?:SEC-AC-001\|SEC-AC-002)\]'` | `[SEC-AC-001]` × `expected 500 to be 200` at `:94:25` (no value in `.dev.vars`: SEC-AC-003 skipped); `[SEC-AC-002]` × at `:127:35`; 2 failed, 2 skipped |
   | none, `--sequence.shuffle --sequence.seed=3` | `[SEC-AC-004]` × at `:75:51` (`.dev.vars` already contains `secret`: SEC-AC-003 ran first); `[SEC-AC-002]` × at `:127:35` (ran before SEC-AC-001); 2 failed, 2 passed |

   The failure comes from the tests themselves, whatever selects them. The driver is not needed to produce it. It is deterministic: the same assertion failed in the run above, in both runs of the FILES-AC-003 fix check (`2026-10-20-FILES-AC-003-execution-context-destroyed.md`, "Checks": runs `vhigthtzz589duv` and `bgsa0djfwc7wl79`), and in the direct `-t` run.
5. **The other SEC-AC-002 tests are self-contained.**
   - `criteria/secrets/no-leak.test.ts` makes its own leaking activity (step 1 of the test) and its own in-process app.
   - `secrets.test.ts`'s two SEC-AC-002 tests passed with every SEC-AC-001 test skipped (evidence 1).
   - So `cli.test.ts` is the only file whose SEC-AC-002 test depends on other tests.

## Chain (cause → symptom)
1. `cli.test.ts` is written as one ordered scenario. Its SEC-AC-002 test asserts on module-level state (`errorResponses`, the fixture's `.logs/` and `.dev.vars`) that only the earlier SEC-AC-003 and SEC-AC-001 tests create. **Evidence 2.**
2. The driver selects tests by tag (`-t`), as compliance.md specifies. With `--only` naming SEC-AC-002 but not SEC-AC-001/003, vitest skips those producer tests. **Evidence 1, 3.**
3. So `errorResponses` is still empty when the SEC-AC-002 test reaches line 127, and `expect(errorResponses.length).toBe(3)` fails with `expected +0 to be 3`. If that line passed, lines 138 and 146 would fail next for the same reason. **Evidence 2, 4.**
4. The driver records the failing tagged test, so SEC-AC-002 is `failed` (symptom). Unfiltered, the producers run first in file order, and the file passes 4/4. **Evidence 4.**

## Alternatives considered
1. **The driver's selection is wrong.** Ruled out.
   - Selecting by tag is the specified behaviour (compliance.md line 65; evidence 3).
   - The same failure occurs with plain `vitest -t` and with a shuffled order, with no driver involved (evidence 4).
   - Making the driver run whole files, or add every test sharing a file with a selected one, would hide the dependency only for `--only`. It would not fix a shuffle or a hand-run `-t`. It would also run untagged-for-this-run tests whose outcomes the driver must then discard, against "selecting only the tests tagged with an expected ID".
   - A test whose pass depends on which other tests are selected is not valid evidence for its own ID. The evaluator could not tell from its outcome alone what it showed.
2. **Timing or flakiness.** Ruled out. The result is deterministic across four runs, and it follows exactly from which tests ran (evidence 4).
3. **The missing `apiKey` prerequisite** (`no-leak.test.ts`). It is a separate, documented cause (DEC-0277; FILES-AC-003 record E7).
   - It does not explain this assertion: the failing test uses its own fixture app and its own `uniqueValue` secret, not `apps/reference/.dev.vars`.
   - The FILES-AC-003 fix's run `bgsa0djfwc7wl79` had `apiKey` set. `no-leak.test.ts` passed there, and `cli.test.ts` still failed with the same `expected +0 to be 3`.
   - The prerequisite still has to be met for the main `no-leak.test.ts` test to give evidence. That is the runner's job, not part of this fix.

## Proposed fix (test change; owner: the B-T1 test cases)
Make every test in `packages/framework/test/integration/secrets/cli.test.ts` independent of order and selection. Do not weaken any assertion. File: `packages/framework/test/integration/secrets/cli.test.ts` only. No framework code, driver or `selection.ts` change.

1. **SEC-AC-004 and SEC-AC-003 each use their own fixture app.** Each creates it with `makeTempApp(devFixtureFiles(...))` and removes it in `finally`, or in a per-test `beforeEach`/`afterEach`. Then SEC-AC-004's "`.dev.vars` does not contain the value" check holds whatever else ran before.
2. **SEC-AC-001 and SEC-AC-002 share one memoised, self-provisioning fixture.** For example, `const exercised = once(async () => { … })` called at the start of both tests. It:
   - creates its own app;
   - runs `secrets set apiKey` with `secret` on stdin;
   - starts `dev`;
   - records the responses of `/api/secret`, `/api/secret/undeclared`, `/api/secret/missing` and `/api/throw/secret` (status, headers, body);
   - stops `dev`;
   - returns them.

   `afterAll` removes the app if it was created. SEC-AC-001 keeps all its current assertions, made on the recorded responses. SEC-AC-002 keeps all of its own (three error responses, no hit outside `.dev.vars`/`.wrangler/`, a non-empty `.logs/` error entry, a clean `git grep`, `.dev.vars` holding the value). Whichever of the two runs first, alone or together, provisions the state. (A `beforeAll` in a `describe` holding just those two tests also works: vitest runs a suite's `beforeAll` when any of its tests is selected. The steps it performs are then not attributed to a tagged test, so the memoised helper is preferred.)
3. Update the file header: drop "run in order", and say that each test provisions what it reads.

## Verification
- **Red (before the fix), already observed:** `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/secrets/cli.test.ts -t '\[SEC-AC-002\]'` fails at `cli.test.ts:127` (evidence 4). This command is the reproducing test. It is the driver's own selection mechanism applied to this file.
- **Green (after the fix):**
  - That command passes.
  - So does each of `-t '\[SEC-AC-001\]'`, `-t '\[SEC-AC-003\]'` and `-t '\[SEC-AC-004\]'` alone.
  - So does the unfiltered file.
  - So do `--sequence.shuffle` with seeds 1–5 (seed 3 fails today).
- **Re-check (§8 step 4):**
  - The test runner sets the `apiKey` prerequisite (DEC-0277) and reruns `npm run compliance -- --target local --only FILES-AC-003,SKILL-AC-005,E2E-001,SEC-AC-002`. Expect SEC-AC-002 to have no failed test.
  - It also reruns `npm run compliance -- --target local --only SEC-AC-001`. Expect no failure from `cli.test.ts`.
  - Then a full unfiltered local run. The evaluator judges.
- **Scan for the same pattern** (reviewer or fixer). Look for other integration and criteria files whose tests read module-level state that differently tagged tests write. Repeat the shuffle and single-tag `-t` runs per file. This record proves the pattern only for `cli.test.ts`.
