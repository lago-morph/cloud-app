# Root cause (fix record): `./testing` types still expose `email` (the fake auth app's identity) and the testing contract still declares MAIL

Item T7 97b (plan-v0.2.0 §7a.1.8 step 5, the fix of T2's E2E-005 record, routed by DEC-0762), branch `v0.2.0/97b-fix-testing-types-email` from `origin/v0.2.0/34a-remove-email-files` (PR #150, `97a8fba`), 2026-10-31. This record reuses T2's diagnosis, `ai/implementation/root-causes/2026-10-31-T2-E2E-005-email-in-testing-types.md` (on `origin/v0.2.0/78-e2e-scope` … `81-e2e-starter-upgrade`; Review: `accepted` by `session_014mWQ6iQm8CioUNqZEjoNmt`), and adds the contract half C 34a reported. I wrote none of the code involved (B 41a, D's contract).

## Symptom

On the base, after `npm run build -w packages/framework`, E2E-005's type test (the file on the base is the same as T2's for this test: `git diff HEAD origin/v0.2.0/81-e2e-starter-upgrade -- tests/compliance/e2e/E2E-005.spec.ts` changes only the header, imports and the new auth-app test) fails:

```
npx playwright test --project=e2e-ui -g "no app-facing type" E2E-005
  1) [E2E-005] no app-facing type exposes login-provider names, tokens, issuers or email addresses
    Error: app-facing types exposing login-provider details:
    dist/auth/auth-app-binding.d.ts: "email" (word "email")
  1 failed
```

C 34a also reported that `docs/contracts/ts/testing.d.ts` still declares `TestApp.mail` after MAIL's removal.

## Evidence

1. T2's record, evidence 2–5 (accepted): the walk follows `dist/testing/index.d.ts` → `public.d.ts` → `test-app.d.ts`, whose line 3 imports `AuthAppIdentity` and `FakeAuthAppBinding` from `../auth/auth-app-binding.js`; `AuthAppIdentity` declares `readonly email: string`. Reproduced here on `97a8fba`: the one finding above, nothing from mail (34a removed `src/mail`, `TestApp.mail` and `mailSender` from the package: `git grep -n "mail" packages/framework/src/testing` lists only a capability-name test and the `email` of the test identity).
2. `packages/framework/src/testing/test-app.ts` on the base: `loginWithAuthApp(identity: AuthAppIdentity)` (line 81) and `export type TestAuthApp = Pick<FakeAuthAppBinding, "issueCode" | …>` (line 107). These are the only uses of the binding's types in exported declarations; `Shared.authApp: FakeAuthAppBinding` is not exported.
3. `docs/contracts/ts/testing.d.ts` on the base: `issueCode(identity: { sub; email; role }, …)` (line 101) and `loginWithAuthApp(identity: { sub; email; role })` (line 159); and the MAIL leftovers: the header's "MAIL (outbox)" and `mail.md`, `MailMessage` (27–36), `TestMail` (39–44), `TestAppOptions.mailSender` (84–88), `TestApp.mail` (130–134). The package has none of the MAIL ones, so the contract and the package disagree (34a removed the runtime only).
4. `docs/components/auth.md` line 12 (AUTH-REQ-001): no framework interface available to app code may expose email addresses; line 71 (DEC-0691) and line 117: the auth app's binding returns an email, which the provider drops. So the internal binding keeps `email` (`docs/contracts/ts/internal/auth-app.d.ts` line 22); only `./testing` must not show it. AUTH-AC-013 (line 153) still requires that no response carries "the email address" after an in-process sign-in, so the fake must still be handed one.
5. CORE-REQ-005's row (`docs/components/check.md` line 74, "tests: `.` and `./testing`") makes `./testing` app-facing for test code, which is why E2E-005 walks it.

## Causal chain

1. The internal binding's identity carries `email` by design (evidence 4).
2. B 41a typed two `./testing` members with the binding's own types (evidence 2), so the emitted `test-app.d.ts` imports `auth-app-binding.d.ts` (evidence 1).
3. E2E-005 walks `./testing`'s declarations (evidence 5) and refuses the word `email`, so it fails on `AuthAppIdentity.email`.
4. Separately, D's contract still states the pre-v0.2.0 `TestApp` with `email` in both identity parameters and the whole MAIL test surface (evidence 3), which 34a removed from the package but not from the contract.

## Alternatives ruled out

- See T2's record (a test or detector change; an email in a response; the mail types): all ruled out there and re-checked here (evidence 1: the mail types are gone from the package on this base).
- **Making `FakeAuthAppBinding.issueCode`'s `email` optional** (T2's proposed form): works, but changes the internal fake that `src/auth-app` and `src/auth` unit tests use directly, for a need that is only `./testing`'s. Not chosen (DEC-0734).

## Proposed fix

DEC-0734. `./testing` states its own types in public terms; the internal binding is unchanged.

- `src/testing/test-app.ts`: `loginWithAuthApp(identity: { readonly sub: string; readonly role: "admin" | "user" })`; `TestAuthApp` an interface with inline types (`issueCode` takes the same `{ sub, role }`; `setRole`, `unregisterApp`, `failNext`, `setUnavailable`, `calls`), not a `Pick` of `FakeAuthAppBinding` (review minor 2 of T2's record). `TestApp.authApp` returns a small adapter over the fake; it and `loginWithAuthApp` hand the fake `{ sub, email: <sub>@auth-app.test, role }`, the address made up by a non-exported helper (`src/testing/auth-app-identity.ts`), so the fake's redeem still returns the internal shape and AUTH-AC-013 still has an address to look for. The identity types are inline, not a named alias, because CORE-AC-001's walk counts every named framework type (T7 97's record, evidence 6).
- `docs/contracts/ts/testing.d.ts`: the same two identity types; `MailMessage`, `TestMail`, `mailSender`, `TestApp.mail`, and MAIL in the header removed.
- Call sites: `src/testing/test-app.unit.test.ts` (the only `./testing` caller) drops `email` from its identity; AUTH-AC-013's "no email" assertion now looks for the made-up address, and also for any `@`. The binding's own unit tests keep `createFakeAuthAppBinding` with `email`.
- Similar cases (§7a.1.8 step 4), `git grep -nE 'mail|email|password' -- packages/framework/src/testing docs/contracts/ts packages/framework/src/client` on the base:
  - **fixed here**: `testing.d.ts` lines 5, 26, 38, 85–88, 101, 131–134, 154, 159 (above); `src/testing/connect.ts` lines 192 and 198, whose `grantRole`/`revokeRole` errors on a connected stage name the removed `admins` command with `<email>` (and the contract's `grantRole` text, line 181, the same command): they now point to `as(mockUsers.admin())`, since test stages sign in with the mock only (plan-v0.2.0 §4.3). A new unit test guards it.
  - **kept, by the spec**: `docs/contracts/ts/internal/auth-app.d.ts` line 22 (`AuthAppIdentity.email`: the binding returns it, auth.md line 117); `internal/login-provider.d.ts` lines 4 and 26 (comments: the removed password provider's history, and why the auth-app provider has no display name).
  - **kept, still true on this base**: `testing.d.ts` line 56, `TestAppOptions.config`'s `framework` section "(`{ email? }`, stage-config.schema.json)": the schema and `src/config/schema.ts` still have `framework.email` on 34a. Removing it is C's (MAIL configuration), not this item's; when it goes, that phrase goes with it.
  - **kept, not a defect**: `src/testing/test-app.unit.test.ts` line 171 (`setUnavailable(["mail"])` must throw "unknown capability": a negative test).
  - `packages/framework/src/client`: no hits.
  - Outside the grep's paths, noted for their owners, not fixed: `skill/reference/current-user.md` line 55 (`passwordLoginProvider`, `t.mail.lastTo`); the stale "MAIL's in-memory outbox" in `test-app.ts`'s header comment is fixed here (own file).

## Verification plan

- Red (done, above): E2E-005's type test fails on the base. My own type test, `src/testing/types.unit.test.ts` (no `mail`/`mailSender`; the two identity parameters are exactly `{ sub, role }`), fails `npm run typecheck` on the base; its runtime part (the adapter hands the fake an address on `auth-app.test`; the connected stage's role errors name neither `admins` nor an address) fails `vitest` on the base.
- Green: the same type test passes after `npm run build -w packages/framework`; `grep -n "auth-app-binding\|email" packages/framework/dist/testing/*.d.ts` finds nothing; `npm run typecheck && npm run lint && npm run test:unit`; `npx vitest run --config vitest.unit.config.ts tests/compliance/harness` (parses the contracts); CORE-AC-001's walk (`packages/framework/test/integration/core/types.test.ts`) loses its `AuthApp*`/`FakeAuthAppBinding` entries (its `TestAuthApp`/`TestClock` exports are T7 97's).

## Review

Status: awaiting review
