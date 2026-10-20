# Root cause: SKILL-AC-004 — `skill/examples/tests.md` copies `apps/template/vitest.config.ts`, a file `verify` neither type-checks nor reads

Author: diagnosing subagent (prompt §8 step 1; did not write the skill, the template or the test). Diagnosis only; no code, skill text or test changed. Needs independent review (§8 step 2) before any fix.

## Symptom
Branch `claude/implement-local-cloudflare-diag-e1` = `origin/claude/implement-local-cloudflare` `e891bec`, after `npm ci` and `npm run build -w packages/framework`:

```
npx vitest run --config vitest.integration.config.ts tests/skill/
 × [SKILL-AC-004] every TypeScript source is type-checked by its app's verify (src/ or tests/), and every test source is run by it (tests/**/*.test.ts)
 + [ "skill/examples/tests.md:255: apps/template/vitest.config.ts is outside apps/template/src and apps/template/tests, so verify does not type-check it" ]
 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 25 passed (26)
```

Only this one test fails. The other six SKILL-AC-004 tests pass, including both `npm --workspace apps/{template,reference} run verify` runs (about 256 s in total). The failure was also reproduced on its own, without the verify runs, using `-t`.

## Evidence
1. **The example block.** `skill/examples/tests.md` lines 252–266 hold `<!-- example-source: apps/template/vitest.config.ts -->` and a byte-for-byte copy of that file. The intro (line 9) describes it as "`vitest.config.ts`: the timeouts the template uses". Line 5 says of every block: "The framework's CI type-checks and tests those apps … so this code compiles and passes as shown." `skill/reference/testing.md` line 48 links the example as including "its Vitest configuration". The block came in with `ef0e2cb` (E-01). It is the only flagged block: the test lists one item.
2. **What `verify` type-checks.** `packages/framework/src/cli/verify/type-check.ts` calls `collectAppFiles(appDir)`. `packages/framework/src/check/engine.ts:48` has `APP_DIRS = ["src", "tests"]`, so only files under those directories are compiled. The program uses `APP_COMPILER_OPTIONS`, never the app's `tsconfig.json`. This matches cli.md §2 (line 92: "type checking (the app lib set …, never the app's `tsconfig.json`; `src/` and `tests/` in separate programs …)"). The portability lint (`lintAppFiles`, same `collectAppFiles`) does not see the file either.
3. **Nothing else in CI type-checks it.** Root `typecheck` = `tsc -p packages/framework/tsconfig.json && tsc -p tsconfig.json && tsc -p tests/compliance/harness/tsconfig.json`. Root `tsconfig.json` includes `*.config.ts` at the repo root (not `apps/**`), `tests/support/**` and `tests/skill/**`. Root `verify` runs no `tsc -p apps/template`. The template's own `tsconfig.json` includes only `src/**/*.ts` and `tests/**/*.ts`, and no CI step uses it anyway (item 2).
4. **`verify` does not even read the file.** `packages/framework/src/cli/verify/tests.ts:23–35` `testRunnerOptions` sets `config: false` and applies its own `include: [TEST_GLOB]` and 60 s test and hook timeouts. `smoke.ts:299` also has `config: false`, and cli.md line 79 says "without the app's Vitest config". The decision log (line 1564) says: "The app's Vitest configuration is not read … If an app needs Vitest settings beyond these, that is a framework change." `skill/reference/testing.md` line 7 already states the 60 s timeouts as `verify`'s own behaviour. So `vitest.config.ts` affects only a plain `npx vitest` run inside the app, which the skill does not tell agents to use.
5. **Would it type-check if it were in scope? Yes.** Scratch script `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/diag-e1/tc.mts` uses `APP_COMPILER_OPTIONS`, copied from `engine.ts`, with the framework built:
   ```
   src only (baseline) 17 files 0 diagnostics | tests only (baseline) 3 files 0
   config alone 1 file 0 | src + config 18 files 0 | tests + config 4 files 0
   ```
   `tsc -p …/diag-e1/tsconfig.tpl-with-config.json` extends the template's `tsconfig.json` and adds `vitest.config.ts` to `include`. It exits 0, and `--listFilesOnly` confirms the file is in the program. (Before the framework was built, every program reported only missing-module errors from `@lago-morph/prototype-framework` imports. None was in `vitest.config.ts`.)
6. **Negative control.** `…/diag-e1/neg.mts` uses the same options and the same file, with `testTimeout: 60_000` replaced in memory by `"sixty"`. It loads `vitest/dist/config.d.ts` and reports `TS2769 … Type 'string' is not assignable to type 'number'`. So the clean result in item 5 is a real check, not an unresolved `any`.
7. **Criterion and design.** SKILL-AC-004: "CI type-checks and runs every example and the template." SKILL-REQ-004: "Every example and template MUST type-check and pass `verify` in the framework's own CI." skill.md §2 "Implementation": "The code is type-checked and tested where it lives, by each app's `verify`." E-T1 DEC-PENDING-E-T1-6 reads this as: every TypeScript source of an example must lie in `src/` or `tests/`. That is exactly the scope in item 2 and nothing more.

## Chain (cause → symptom)
1. E-01 (`ef0e2cb`) added the whole of `apps/template/vitest.config.ts` to `examples/tests.md` as an example block (evidence 1).
2. That file is outside `src/` and `tests/`, so `verify` does not type-check it, and no other CI step does either (evidence 2, 3).
3. So the example contains TypeScript that "CI type-checks … every example" does not cover, and the example's claim "this code compiles and passes as shown" is not backed by CI for this block (evidence 7).
4. The E-T1 test checks exactly that condition and reports this block (symptom).

There is a second, independent problem with the block: `verify` and `smoke` ignore the file (evidence 4). The example shows a setting ("the timeouts the template uses") that has no effect on what the framework runs. An agent that copies or edits it changes nothing `verify` does.

## Alternatives considered
- **The test is too strict.** Ruled out. The criterion and the requirement say *every* example is type-checked in CI, and the example's own text promises that its code compiles. Both have no exception for config files. The test's scope (`src/`, `tests/`) is the scope `verify` actually type-checks, and cli.md §2 fixes it (evidence 2, 7). Relaxing the test would accept an example CI does not check, which weakens the criterion (§8: never weaken a test).
- **The template is wrong: put `vitest.config.ts` into a type-check scope.** The file would pass (evidence 5, 6). But the template's `tsconfig.json` is not what CI uses: `verify` never reads it, and root `typecheck` does not run it (evidence 2, 3). Adding the file to its `include` would therefore change nothing CI checks, and the test would still fail. Real coverage would need one of two changes. (a) `verify`'s type-check scope beyond `src/`+`tests/`: a CLI-REQ-002/cli.md §2 change, and the test would also have to change. (b) A new root `typecheck` step for each app's tooling files. Either way, CI would then check a file that the framework ignores at run time (evidence 4). That costs a spec change and buys no correctness for apps.
- **The template should drop `vitest.config.ts`.** Out of scope for this failure. The file is harmless, it serves a plain `npx vitest` run in the app, and PROV-AC-001's reading (D-T.md) lists it as permitted metadata. The example does not need it to exist.
- **Move the config into `tests/`.** Vitest would not pick it up there by default, and it would still not be a file `verify` uses. Rejected.

## Proposed fix
The example should not include that file. Remove the block and its mentions; touch no code, template or test:
- `skill/examples/tests.md`: delete the `## \`apps/template/vitest.config.ts\`` section (heading, marker and fenced block, lines 252–266). Delete the intro bullet "`vitest.config.ts`: the timeouts the template uses." (line 9). Where the timeouts matter, say in one line of prose that `verify` runs the tests with its own settings (PAR-116 glob, 60 s test and hook timeouts) and does not read an app's Vitest configuration (cli.md §2), with no code block.
- `skill/reference/testing.md` line 48: drop "its Vitest configuration," from the link text. Line 7 already states the timeouts.
- Owner of the change: an item that owns `skill/` (E-01/E-03 line). Afterwards, confirm by script that every remaining block still equals its source (E-03's method).

Sizes stay within PAR-072, since the file only gets smaller (now 12,545 bytes). SKILL-AC-001 is unaffected: no link targets the removed section.

## Verification
- Red: as observed above, `npx vitest run --config vitest.integration.config.ts tests/skill/examples.test.ts -t "type-checked by its app's verify"` fails with the one item.
- Green after the fix: the same command passes, and the full `npx vitest run --config vitest.integration.config.ts tests/skill/` reports 26 of 26 passed. That covers SKILL-AC-001 (links, budgets), -002, -003 and the rest of -004, including both apps' `verify`.
- `grep -n "vitest.config" skill/examples skill/reference` returns nothing.
- The test runner and evaluator re-run SKILL-AC-001…-004 (§8 step 4).

## Observation (not part of this failure)
SKILL-AC-004 also says CI type-checks "the template". By the same evidence (items 2, 3), the template's own `vitest.config.ts` is not type-checked by CI either. It does type-check clean (item 5), and `verify` does not use it (item 4). If the owner reads "the template" as every TypeScript file in `apps/template`, a reviewer may want a separate decision on it. No current test covers that reading.
