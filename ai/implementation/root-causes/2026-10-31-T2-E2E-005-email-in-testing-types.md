# Root cause: E2E-005's type scan finds `email` in the `./testing` types, because B 41a exposed the fake auth app's identity type through `TestApp`

Item T2 (e2e scope of plan-v0.2.0 §7.1), branch `v0.2.0/78-e2e-scope` (base `origin/v0.2.0/71m-merge-auth-provider-into-admin-app`, `39c87a0`). Diagnosed 2026-10-31 by the item's implementer: this run has no in-process subagent tool, so no separate diagnoser was available (disclosed). The review is by an independent cloud session.

## Symptom

`PLAYWRIGHT_BROWSERS_PATH=<shim> npm run compliance -- --target local --only E2E-001,…,E2E-016` (raw log `scratchpad/runs/e2e-78.log`, lines 413–432): `[E2E-005] no app-facing type exposes login-provider names, tokens, issuers or email addresses` fails:

```
Error: app-facing types exposing login-provider details:
dist/auth/auth-app-binding.d.ts: "email" (word "email")
```

The other E2E-005 test (anonymous, user and admin in a browser through the mock) passes in the same run.

## Evidence

1. PR 78 changes E2E-005's Where from `Cloud` to `Local, cloud` (DEC-0753). Before it, E2E-005 never ran locally, and no cloud run has happened in v0.2.0 (no Cloud token), so this is the first run of the type test since v0.2.0's code changes. The test itself is unchanged (`git diff 39c87a0 -- tests/compliance/e2e/E2E-005.spec.ts` is empty).
2. The test walks the declaration files the package's `.`, `./client` and `./testing` exports name, following every relative import, and runs `providerExposures` on each identifier and string literal (`typeTokens` excludes comments) — `E2E-005.spec.ts` lines 163–190, `support/scan.ts` `typeTokens`, `providerExposures`.
3. `packages/framework/dist/testing/test-app.d.ts` line 3: `import { type AuthAppIdentity, type FakeAuthAppBinding } from "../auth/auth-app-binding.js";`. `dist/auth/auth-app-binding.d.ts` lines 15–19: `export interface AuthAppIdentity { readonly sub: string; readonly email: string; readonly role: AuthAppRole; }`. The identifier `email` is the only finding.
4. The import came with `679c3bf` ("auth, testing: session format 3 for every real provider; createTestApp signs in through the fake auth app (B, PR 41a)"): `git log -S"auth-app-binding" -- packages/framework/src/testing/test-app.ts`. `TestApp.loginWithAuthApp(identity: AuthAppIdentity)` and `TestAuthApp = Pick<FakeAuthAppBinding, "issueCode" | …>` (whose `issueCode` takes an `AuthAppIdentity`) are exported types of `./testing`. The contract `docs/contracts/ts/testing.d.ts` lines 101 and 159 declare the same `{ sub, email, role }` shape.
5. The internal binding contract (`docs/contracts/ts/internal/auth-app.d.ts`) carries `email` by design: the auth app returns it from `redeem`. The app-side provider drops it (`auth-app-provider.ts` line 78: `displayName: null`), so no app response carries it; only the type is exposed.

## Causal chain

1. The auth app's binding returns `{ sub, email, role }` (internal contract; evidence 5).
2. B 41a let tests sign in through the fake binding and typed `TestApp.loginWithAuthApp` and `TestApp.authApp.issueCode` with that internal identity type (evidence 4), so `./testing`'s declarations import `auth-app-binding.d.ts` (evidence 3).
3. E2E-005 counts `./testing` as app-facing (CORE-REQ-005) and refuses the word `email` in any app-facing type (evidence 2), so the walk reaches `AuthAppIdentity.email` and fails.
4. It shows only now because E2E-005 first runs locally with PR 78 (evidence 1).

## Alternatives ruled out

- **A PR 78 change to the test or the detector:** the spec and `scan.ts` are unchanged (evidence 1); only the Where line changed, which makes it run.
- **An email in a response:** the browser test, which inspects every `/api` response, passes in the same run; the provider sets `displayName: null`.
- **`email` reached through the mail types** (`TestMail`, still exported until C 34a removes MAIL leftovers): the only finding is in `auth-app-binding.d.ts`; `mail/outbox.d.ts` is walked and gives none.

## Proposed fix

`./testing` takes and shows only what an app test needs: the subject and the role. The fake auth app keeps the internal identity, with an email it makes up, inside the framework.
- `TestApp.loginWithAuthApp(identity: { sub, role })` and `TestApp.authApp.issueCode(identity: { sub, role }, …)`: no `email` in either type, in `src/testing/test-app.ts` and in `docs/contracts/ts/testing.d.ts`; `TestAuthApp` declared in `test-app.ts` without referring to `auth-app-binding` types, so `dist/testing/*.d.ts` no longer imports `auth-app-binding.d.ts`.
- The fake binding (`createFakeAuthAppBinding`) fills `email` itself (`<sub>@auth-app.test`, a reserved domain) when a test gives none, so `redeem` still returns the internal contract's shape.
- About 45 call sites in 10 files pass `email:` today (`grep -rn "loginWithAuthApp\|\.issueCode("`); each drops it, except the internal binding's own unit tests, which keep using `createFakeAuthAppBinding` directly.

This is framework source and its tests (`src/testing/`, `src/auth/auth-app-binding.ts`, `docs/contracts/ts/testing.d.ts`, B's test files), outside T2's owned paths, and `test-app.ts` is a serialised shared file (progress §2). Per §7a.1.8 step 4 it becomes a **new item** for the orchestrator (a T7 fix), not a silent fix in T2. Until it lands, E2E-005's type test fails on every target; T2 does not weaken or skip it.

The other reading — that `./testing` identities may carry an email because they are test inputs — was considered and not proposed: E2E-005 names `./testing` among the app-facing types, and SYS-REQ-005 gives the reason (application concepts only, so app tests written against the mock and the real provider look the same).

## Verification plan

- Red (now): `npm run compliance -- --target local --only E2E-005` → the type test fails with the one finding above.
- Green (after the new item's fix): the same → both E2E-005 tests pass; `npm run test:unit` and the `auth` integration suites still pass with the edited call sites.
- Similar cases: the same walk over `.` and `./client` finds nothing today (it is the same test); `grep -n "email" packages/framework/dist/testing/*.d.ts` after the fix lists comments only.

## Review

(pending: independent root-cause reviewer)
