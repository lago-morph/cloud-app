# Root cause: CORE-AC-001 fails on the join branch because `./testing`'s `TestApp` names `TestAuthApp` and `TestClock`, which the hub does not export, and `TestAuthApp` is a `Pick` of the internal `FakeAuthAppBinding`

Author: item T7 (diagnosis, plan-v0.2.0 §7a.1.8 step 1), 2026-10-31. Base: `origin/v0.2.0/71n-path-map-after-removals` (PR #134) at `60b5e8e`, which holds A, B, C, D, E, F and S3. Node 22.23.4, Chromium shim per progress §6, local apiKey set on stdin (DEC-0779). I wrote none of the code involved.

## Symptom
`npm run compliance -- --target local --only CHECK-AC-005,CLI-AC-008,CORE-AC-001,E2E-016,SEC-AC-002` (run `hv2yas3d80t67es`) records CORE-AC-001 `failed`: 1 of 5 tests. T1's full run on branch 75 (`93eab74`, run `elfokkdfd656tww`) failed the same way, and so did my full run on `60b5e8e`.

```
FAIL packages/framework/test/integration/core/types.test.ts > CORE-AC-001 type fixtures >
  [CORE-AC-001] every framework type in a public signature is importable from a subpath its importers may use
- []
+ "@lago-morph/prototype-framework/testing: AuthAppBinding (used by FakeAuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: AuthAppIdentity (used by AuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: AuthAppIdentity (used by FakeAuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: AuthAppIdentity (used by TestApp)",
+ "@lago-morph/prototype-framework/testing: AuthAppRole (used by AuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: AuthAppRole (used by AuthAppIdentity)",
+ "@lago-morph/prototype-framework/testing: AuthAppRole (used by FakeAuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: FakeAuthAppBinding (used by TestAuthApp)",
+ "@lago-morph/prototype-framework/testing: RedeemInput (used by AuthAppBinding)",
+ "@lago-morph/prototype-framework/testing: TestAuthApp (used by TestApp)",
+ "@lago-morph/prototype-framework/testing: TestClock (used by TestApp)",
```

The other three CORE-AC-001 tests in the file pass.

## Evidence
1. **What the test checks.** `packages/framework/test/integration/core/types.test.ts:161–232` walks every exported symbol of `.`, `./client` and `./testing`. It follows each type reference to a framework-declared interface, type alias, class or enum. Each one must be among the exports of a subpath its importers may use: `./testing` may use `./testing` and `.` (CORE-REQ-005). This is CORE-AC-001's third sentence: "Every framework type appearing in a public signature can be imported from the subpath whose signatures use it" (`docs/components/core.md:84`).
2. **The hub on 71n** (`packages/framework/src/testing/index.ts:6`) exports the types `LogEntry, MailMessage, TestApp, TestAppOptions, TestCapability, TestMail, TestRole`, and `public.ts:8` exports the same list. Neither exports `TestAuthApp` or `TestClock`.
3. **The contract exports both.** `docs/contracts/ts/testing.d.ts:100` has `export interface TestAuthApp { … }`, stated in public terms: its identity parameter is an inline `{ sub; email; role: "admin" | "user" }`. `:110` has `export interface TestClock`. `loginWithAuthApp` (`:159`) also takes the inline identity type.
4. **The implementation names internal types.** `packages/framework/src/testing/test-app.ts:89` has `loginWithAuthApp(identity: AuthAppIdentity)`. `:115` has `export type TestAuthApp = Pick<FakeAuthAppBinding, …>`. Both come from `src/auth/auth-app-binding.ts`, whose header says the binding is "Never exported to app code" (`:5`). Following `FakeAuthAppBinding` reaches `AuthAppBinding`, `AuthAppIdentity`, `AuthAppRole` and `RedeemInput`. These are exactly the other nine entries.
5. **Where it came from.** `679c3bf` ("createTestApp signs in through the fake auth app (B, PR 41a)") added `authApp: TestAuthApp`, `clock: TestClock`, `loginWithAuthApp(AuthAppIdentity)` and the `Pick`. In the same commit it added `TestAuthApp` and `TestClock` to `testing.d.ts`, but it did not touch `testing/index.ts` or `public.ts` (`git show 679c3bf --stat`). `git log -1 origin/v0.2.0/71n-path-map-after-removals -- packages/framework/src/testing/index.ts` gives `25429b3` (2026-10-25), so the hub predates B 41a.
6. **Experiment, minimal fix.** In a scratch worktree of `60b5e8e`, I made three changes:
   - (a) stated `TestAuthApp` as an interface, with the contract's inline identity type;
   - (b) gave `loginWithAuthApp` the same inline type;
   - (c) exported `TestAuthApp` and `TestClock` from `public.ts` and `index.ts`.

   With all three, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts` gives 4 passed. An intermediate step that used a named, unexported identity alias left 2 entries (`TestAuthAppIdentity (used by TestApp)`, `(used by TestAuthApp)`). That confirms the test counts every named framework type, so inlining as the contract does is required. Typecheck (`npm run typecheck`), `eslint packages/framework/src/testing` and `vitest --config vitest.unit.config.ts packages/framework/src/testing` (60 passed) are clean.

## Causal chain
1. B 41a gave `TestApp` three new members whose types are `TestAuthApp`, `TestClock` and the internal `AuthAppIdentity` (evidence 4, 5).
2. It wrote `TestAuthApp` as a `Pick` of the internal `FakeAuthAppBinding`, so `./testing`'s signatures reach five internal types (evidence 4).
3. It did not add `TestAuthApp` or `TestClock` to the `./testing` hub, though the contract exports them (evidence 2, 3, 5).
4. CORE-AC-001's type walk therefore finds 11 framework types in `./testing` signatures that neither `./testing` nor `.` exports, and fails (Symptom, evidence 1). The minimal fix removes all 11 (evidence 6).

## Alternatives ruled out
- **The test is wrong or too strict.** No. It states CORE-AC-001's third sentence, and the contract itself exports `TestAuthApp` and `TestClock` and states them without internal types (evidence 1, 3). The test was green on main, where `TestApp` had no auth-app members.
- **Export the internal auth-app types from `./testing` instead.** No. `auth-app-binding.ts` is internal ("Never exported to app code"), and `testing.d.ts` does not list them. The hub's header says it exports "exactly the names of docs/contracts/ts/testing.d.ts".
- **A load or environment effect.** No. It is deterministic: it fails in all three runs (isolated, T1's full run and mine) and in the direct vitest run, and the type walk involves no timing.
- **Covered by a pending PR.** No. `packages/framework/src/testing/index.ts` on every `origin/v0.2.0/*` branch lacks `TestClock`, and no open PR on 71n (#136, #138, #140, #141, #143, #145–#153) changes `src/testing/` or `types.test.ts`.

## Proposed fix
Branch `v0.2.0/97-fix-testing-type-exports` on 71n. It changes no test.
- `test-app.ts`: `TestAuthApp` becomes an interface with exactly the contract's members and inline identity type. `loginWithAuthApp` takes the contract's inline identity type, and the `AuthAppIdentity` import goes. `FakeAuthAppBinding` still satisfies `TestAuthApp` structurally: the getter at `test-app.ts:312` returns it unchanged and type-checks.
- `public.ts` and `index.ts` export `TestAuthApp` and `TestClock`, so the hub matches `testing.d.ts`.

## Similar cases (§7a.1.8 step 4)
- **The other subpaths.** The same test walks `.` and `./client`, and finds nothing there. So no other public signature names an unexported framework type.
- **E2E-005's type scan (DEC-0762, a separate cause and item).** T2's accepted record `2026-10-31-T2-E2E-005-email-in-testing-types.md` (on PR #141) finds `email` in the same `./testing` identity type. Its fix drops `email` from the contract, from `loginWithAuthApp`, from `issueCode` and from about 45 call sites. DEC-0762 made that a new item outside T2. This fix keeps the contract's current shape, `{ sub, email, role }`. So E2E-005's finding moves from `dist/auth/auth-app-binding.d.ts` to `dist/testing/test-app.d.ts`, and still fails as before; it neither gets worse nor gets fixed. The two compose: the DEC-0762 item then deletes `email` from the two inline types here, and no longer has to touch the internal binding's types for `./testing`'s sake.
- **The same omission earlier.** `25429b3` ("CORE-AC-001 re-export", 2026-10-25) fixed this pattern before: a type added to a public signature, but not to its hub. The CORE-AC-001 test catches every case, so no new test is needed. A contract-vs-hub name check would catch it earlier, but adding one is outside T7's owned paths. I note it as a suggestion and do not open an item.

## Verification plan
- Red: on `60b5e8e`, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts` gives 1 failed (the 11 entries above).
- Green: on the fix branch, the same command gives 4 passed. `npm run compliance -- --target local --only CORE-AC-001` passes. Typecheck, lint and `npm run test:unit` stay clean.

## Review
Reviewer: independent root-cause reviewer, session_014mWQ6hjtYXfjcSWXUEWwEy, 2026-10-31
Verdict: accepted-with-changes

Reasons:
- **minor** Every link of the causal chain holds in the source. On 71n, `test-app.ts:25,89,115` import `AuthAppIdentity` and define `TestAuthApp` as a `Pick<FakeAuthAppBinding, …>`. `auth-app-binding.ts:5` says "Never exported to app code". `testing/index.ts` and `public.ts` do not export `TestAuthApp` or `TestClock`, while `testing.d.ts:100,110` exports both with the inline identity type. `679c3bf --stat` touches `test-app.ts` and `testing.d.ts` but neither hub file. No `origin/v0.2.0/*` branch (all 100 scanned) has `TestClock` in the hub.
- **minor** The proposed fix addresses the cause: the implementation now matches the contract and the hub lists exactly the names in `testing.d.ts`. I compared the two name lists after the fix: no contract name is missing from the hub. It does not export internal types, and it changes no test.
- **minor** Factual correction. Evidence 5 says the hub's last change is `25429b3` (2026-10-25). `git log -1 -- packages/framework/src/testing/index.ts` on 71n gives `9f6de80` (2026-10-26, the Playwright-install fix). Correct the statement or drop it. The causal chain does not depend on it.

Re-run:
- Red, on `60b5e8e`: `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts` gives 1 failed, 3 passed. The diff has exactly the 11 entries in the Symptom.
- Green, with fix 97 applied as briefed: the same command gives 4 passed. `npm run typecheck` is clean, `eslint packages/framework/src/testing` is clean, and `vitest --config vitest.unit.config.ts packages/framework/src/testing` gives 60 passed. `npm run compliance -- --target local --only CHECK-AC-005,CLI-AC-008,CORE-AC-001,SEC-AC-002` (run `he319fk0u13979l`, on `60b5e8e` plus fixes 97 and 98) records CORE-AC-001 as passed.

## Response (round 1)
- **Hub's last change (minor 3).** The original statement stands. `git log --format='%h %ci %s' -1 origin/v0.2.0/71n-path-map-after-removals -- packages/framework/src/testing/index.ts` gives `25429b3 2026-10-25 21:07:00 +0000 Fix pass-3 failures: CORE-AC-001 re-export, …`. `9f6de80` may be the last commit for a different path or ref (for example the whole `src/testing/` directory) in the reviewer's checkout. Either way, as the reviewer notes, the chain does not depend on it, so evidence 5 is reworded to name the command and its output.
- **Fix commit order.** The fix is committed on this branch after this Review, as the accepted Proposed fix states. Its own compliance green is run `atfwxyjibj7s38q` (`--only CORE-AC-001,CHECK-AC-005` on `60b5e8e` plus fixes 97 and 98): CORE-AC-001 5 of 5 passed.
