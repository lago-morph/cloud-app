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

- `src/testing/test-app.ts`: `loginWithAuthApp(identity: { readonly sub: string; readonly role: "admin" | "user" })`; `TestAuthApp` an interface with inline types (`issueCode` takes the same `{ sub, role }`; `setRole`, `unregisterApp`, `failNext`, `setUnavailable`, `calls`), not a `Pick` of `FakeAuthAppBinding` (review minor 2 of T2's record). `TestApp.authApp` returns a small adapter over the fake; it and `loginWithAuthApp` hand the fake `{ sub, email: <sub>@auth-app.test, role }`, the address made up by a non-exported helper (`src/testing/auth-app-adapter.ts`), so the fake's redeem still returns the internal shape and AUTH-AC-013 still has an address to look for. The identity types are inline, not a named alias, because CORE-AC-001's walk counts every named framework type (T7 97's record, evidence 6).
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

- Red (done, above): E2E-005's type test fails on the base. My own type test, `src/testing/types.unit.test.ts`, fails `npm run typecheck` on the base at the two identity parameters (still `{ sub, email, role }`) and the missing adapter module; its `mail`/`mailSender` assertions pass on the base (34a removed those members) and stay as guards against their return. Its runtime part fails `vitest` on the base: the contract scan finds `MailMessage`, `TestMail`, `mailSender`, `mail` and both `email` parameters, the adapter module is missing, and the new `connect.unit.test.ts` test finds the `admins` command in the role errors.
- Green: the same type test passes after `npm run build -w packages/framework`; `grep -n "auth-app-binding\|email" packages/framework/dist/testing/*.d.ts` finds nothing; `npm run typecheck && npm run lint && npm run test:unit`; `npx vitest run --config vitest.unit.config.ts tests/compliance/harness` (parses the contracts); CORE-AC-001's walk (`packages/framework/test/integration/core/types.test.ts`) loses its `AuthApp*`/`FakeAuthAppBinding` entries (its `TestAuthApp`/`TestClock` exports are T7 97's).

## Review

Reviewer: independent cloud session `session_014mWQ6iZWyN1eT5GNm9RpoZ` (found neither cause, wrote none of the code), 2026-10-31.
Verdict: `accepted`
- Reproduced: on `8845634`, `npm ci && npm run build -w packages/framework && npx playwright test --project=e2e-ui -g "no app-facing type" E2E-005` fails with exactly one finding, `dist/auth/auth-app-binding.d.ts: "email" (word "email")`. `test-app.ts` line 25 imports `AuthAppIdentity` and `FakeAuthAppBinding`, line 81 is `loginWithAuthApp(identity: AuthAppIdentity)`, line 107 the `Pick`: causal links 1–3 hold. The MAIL leftovers in `testing.d.ts` are at the lines given; auth.md lines 12, 71, 117, 153 and check.md line 74 say what the record says, so the internal binding keeps `email` and only `./testing` drops it. T2's ruled-out alternatives still hold on this base.
- Experiment (fix addresses the cause): with the identity inline `{ sub, role }`, `TestAuthApp` an interface and the `authApp` getter returning an adapter that adds `<sub>@auth-app.test`, the emitted `dist/testing/test-app.d.ts` imports only `core/public`, `config/public`, `auth/public` and `log/entry`, and E2E-005's type test passes; tree restored. DEC-0734 is sound over T2's "make the fake's email optional": it leaves the internal fake and its tests alone and meets T2's review minor 2 (no `Pick`).
- Red tests are meaningful and not weakened (tsc errors at `types.unit.test.ts` lines 11, 40, 41; the connect test fails on `admins`; the contract scan matches `MailMessage`, `TestMail`, `mailSender`, `mail` and both `email` parameters). AUTH-AC-013's check now looks for the made-up address and any `@`: stricter, not weaker.
- The similar-case list is complete; the `admins` command is gone (cli.md line 33, DEC-0698), so the connect.ts 192/198 and contract 181 fixes are right.
- **minor:** the helper file is named `auth-app-identity.ts` in the fix section but `auth-app-adapter.ts` in the test and brief; use one name.
- **minor:** DEC-0734 is cited but not in any `ai/implementation/decisions/*.md`; record it before merge, since it replaces T2's proposed fix form.
- **minor:** the verification plan says the `mail`/`mailSender` assertions fail on the base; they pass (34a removed those members) and act as guards. Say so.
- **minor:** overlap with T7 97 (`origin/v0.2.0/97-fix-testing-type-exports`): both rewrite `TestAuthApp` and `loginWithAuthApp` in the serialised `test-app.ts`. Whichever merges second keeps 97b's types and adapter with 97's hub exports of `TestAuthApp`/`TestClock`; run CORE-AC-001's walk and E2E-005 after both land.
- **minor:** the adapter forwarding test does not check that `issueCode`'s `options.returnUrl` reaches the fake; add it.

## Response (round 1)

All five minors, before the fix commit:
1. One name: `src/testing/auth-app-adapter.ts` (fix section corrected).
2. DEC-0734 is in `ai/implementation/decisions/v020-T7.md` on this branch (the fix commit).
3. Verification plan corrected: the `mail`/`mailSender` assertions are guards; what is red on the base is listed.
4. The overlap is stated in the PR body and DEC-0734 as an open item for the merge order; CORE-AC-001's walk on this branch alone loses its nine `AuthApp*`/`FakeAuthAppBinding`/`RedeemInput` entries and keeps only `TestAuthApp`/`TestClock` (97's).
5. `types.unit.test.ts` adds a test that `issueCode`'s `returnUrl` reaches the fake: a code issued through the adapter for a given return URL is refused after `unregisterApp` and a fresh registration of only the default URL, which it would pass had the adapter dropped `returnUrl`; a control code for the default URL is accepted.
