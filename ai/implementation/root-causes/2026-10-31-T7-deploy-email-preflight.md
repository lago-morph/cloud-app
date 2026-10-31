# Root cause: a production deploy on an account set up only by v0.2.0 stops at the preflight, because deploy still requires the email domain that only 0.1.x recorded, for an `EMAIL` binding that v0.2.0 removed from the spec

Author: item T7 (diagnosis, §7a.1.8 step 1), 2026-10-31. Branch `v0.2.0/96b-fix-deploy-without-email`, on `origin/v0.2.0/34a-remove-email-files` (PR #150, head `97a8fba`). Found by C 34a (progress-v0.2.0 "From C 34a (done)" item 1; DEC-0689 "What stays").

## Symptom
On an account whose setup record `framework/account.json` is the one v0.2.0 writes (`setupVersion`, `frameworkVersion`, `appliedAt`, `completedSteps`, no `emailDomain`), every production `deploy --target cloudflare` exits 1 at step 1 and creates nothing:

```
deploy failed at step 1 (preflight): missing prerequisites:
  - the account settings record names no email domain, which a production stage's EMAIL binding still needs (only a 0.1.x setup recorded one) (required for a production stage)
```

v0.2.0's `cloudflare-setup` and the admin app's Account setup page never write an email domain (DEC-0689, DEC-0698), so on a new account no production stage can ever be deployed. Test stages are not affected. Release-blocking: PROV-AC-002 ("A clean deploy passes the health check") fails for every production stage of a v0.2.0-only account.

## Evidence
- **Reproduction against the fake Cloudflare API** (`tests/compliance/criteria/prov/auth-app-fake.test.ts`, three new tests, red on `97a8fba`; log `scratchpad/red96b.log`). The account has the shared resources, the auth app with its registry, and a setup record without `emailDomain`, built from `ACCOUNT_SETUP_VERSION` and `SETUP_STEPS`. `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/prov/auth-app-fake.test.ts` gives 3 failed / 3 passed:
  - `[PROV-AC-002] … on an account set up only by v0.2.0 …, a clean production deploy passes the preflight and the health check`: exit 1, with the message in the Symptom.
  - `… a production deploy on an account set up by 0.2.0 binds no EMAIL …`: the same preflight stop.
  - `… a production deploy on an account set up by 0.1.x binds no EMAIL …`: the deploy succeeds, but the Worker gets `{ type: "send_email", name: "EMAIL", allowedSenderAddresses: ["no-reply@example.test"] }`, and the program sets `FRAMEWORK_MAIL_FROM`. The spec says it must do neither (below).
  The three existing tests in the file pass, because the file's `account()` helper always stored a 0.1.x `{ emailDomain: "example.test" }` "for the EMAIL binding" (line 54 before this change).
- **Gate 1, the preflight** (`packages/framework/src/provision/core/deploy.ts:227-233`):
  ```ts
  await attempt("account settings", async () => {
    emailDomain = (await ops.readAccountSettings()).emailDomain;
    if (production && emailDomain === undefined) missing.push(`${noEmailDomainMessage()} (required for a production stage)`);
  });
  ```
  `emailDomain` is then passed to steps 3 and 5 (`deploy.ts:96`, `:101`, `:114`). It also decides whether the result prints `sign-in page:` and `sender address:` (`deploy.ts:144-147`).
- **Gate 2, the Worker settings, behind the preflight.** `targets/cloudflare/settings.ts:87-92` throws `CORE.MISCONFIGURED` for a production stage without `emailDomain`. With a domain it adds `sendEmail: [{ binding: "EMAIL", allowedSenderAddresses: ["no-reply@<domain>"] }]` and `FRAMEWORK_MAIL_FROM` (`:105-106`). The probe `scratchpad/s96b/settings-probe.mjs` runs on the built `dist`:
  ```
  production, no domain: THROWS CORE.MISCONFIGURED a production stage's Worker needs the account's email domain for its EMAIL binding; …
  production, 0.1.x domain: sendEmail [{"binding":"EMAIL","allowedSenderAddresses":["no-reply@example.test"]}] vars {…,"FRAMEWORK_MAIL_FROM":"no-reply@example.test"}
  test stage, no domain: sendEmail []
  ```
  So removing only the preflight check would move the stop from step 1 to step 3: `sst.ts` `workerSettings` → `cloudflareWorkerSettings` runs inside `deployInfrastructure` for a stage with a database, and in `deployCode`.
- **The binding is wired through every layer.** `DeployInput.emailDomain` (`core/operations.ts:114-119`); `target.ts:130-136` (`workerInput` + `mail(input)`); `SstInput.worker.emailDomain` (`sst.ts:79-80`, `:123`); the `send_email` binding appended in `sstProgram` (`sst.ts:154`); `BINDINGS.email`/`BINDINGS.mailFrom` (`targets/cloudflare/bindings.ts:28-31`).
- **Nothing reads the binding at runtime.** `git grep -nE 'BINDINGS\.(email|mailFrom)|FRAMEWORK_MAIL_FROM|env\.EMAIL'` over `packages/framework/src` finds only `settings.ts` and tests. B 46 removed the mail sender (`src/mail/**`), and C 34a deleted the rest of `src/mail/`.
- **What the spec says now (base branch):**
  - PROV-REQ-002 step 1: "for production stages, that the login provider's prerequisites are present: in v0.2.0 the account's auth app and its registry … (DEC-0698 replaces DEC-0553's email-domain check)".
  - provisioning.md §2 "Account settings record": "In v0.2.0 (DEC-0698) `emailDomain` is no longer written or read".
  - provisioning.md §2 "Publishing the result" and cli.md `deploy`: "in v0.2.0 there is no sign-in page and no sender address (DEC-0698)".
  - cloudflare.md §2, v0.2.0 amendment: "Production stages bind no `EMAIL`".
  - mail.md: MAIL retired (DEC-0696), including MAIL-AC-004, the only criterion that named the `EMAIL` binding.
- **History.** C 34b (`b998818`, DEC-0689) removed the email *setup* checks from the preflight (`emailPrerequisites`, Zone and Email Sending reads). It kept the domain requirement on purpose, because "F's `sst.ts` and B's `targets/cloudflare/settings.ts` still bind `EMAIL` (MAIL-AC-004) … Removing the binding is F's" (`decisions/v020-C.md`, DEC-0689 "What stays"). B's handover says the same: "The EMAIL binding and MAIL-AC-004 tests stay until F's `sst.ts` stops reading them → C 34a" (progress "From B (done)" item 3). F's PRs #101–#103 (DEC-0725–0729) added AUTH and Secrets Store bindings but did not touch the email binding, and no item's brief named its removal. Each side waited for the other.
- **Why no test caught it.** Every production-deploy test seeded a 0.1.x domain: `auth-app-fake.test.ts` `account()`; `target.unit.test.ts` `recordEmailDomain` (lines 56-63); `FakeTarget`'s default `accountSettings: { emailDomain: "example.test" }` (`fake-target.ts:104`). Two once-green tests assert the defect as intended behaviour:
  - `cli/commands/deploy.unit.test.ts:141` "a production stage without the account's email domain stops at the preflight";
  - `cloudflare/target.unit.test.ts:234` "the preflight requires the account's email domain for the EMAIL binding".

## Causal chain
1. v0.2.0 removes email: no setup step records an email domain (C 34b, DEC-0689), and the spec drops the production email check, the `EMAIL` binding and the sender output (DEC-0698, DEC-0696). Evidence: the spec quotes and `b998818`.
2. The deploy code kept the 0.1.x contract "a production stage binds `EMAIL` from the account's email domain" (DEC-0514) in two places: the preflight requirement (`deploy.ts:232`) and the Worker settings requirement (`settings.ts:87`). The binding is wired through `DeployInput` → `target.ts` → `sst.ts` → `settings.ts`. Evidence: the code lines and the probe.
3. The removal of that contract was assigned between items (C → F, B → C 34a), and none of them removed it. C kept the requirement so as not to break F's and B's binding. Evidence: DEC-0689 "What stays", progress "From B" item 3.
4. Tests seeded a 0.1.x domain for every production deploy, and two tests assert the stop as intended, so the suites stayed green. Evidence: the helpers and tests listed above.
5. On a v0.2.0-only account the record has no `emailDomain`, so gate 1 fires and the deploy stops at step 1 (Symptom, red tests). Without gate 1, gate 2 would stop it at step 3 (probe). On a 0.1.x account the deploy still succeeds, but it binds `EMAIL` and sets `FRAMEWORK_MAIL_FROM`, against cloudflare.md's v0.2.0 amendment (third red test).

## Alternatives ruled out
- **The setup should record an email domain.** Ruled out by the spec: DEC-0698 and SETUP-REQ-002/003 as amended (DEC-0697) remove it, and C 34b removed `--email-domain` and `CLOUDFLARE_EMAIL_DOMAIN` on purpose.
- **Only the preflight line is wrong.** Ruled out by the probe: `cloudflareWorkerSettings` refuses the same stage at step 3.
- **The fake Cloudflare API misreports the record.** Ruled out: the fake returns the stored object (`objectBodies`). `readAccountSettings` returns `{}` for a record without `emailDomain` (`account-settings.ts:32`; `target.unit.test.ts:186` asserts `{}` for a fresh record). The message comes from `deploy.ts:232`, not from a read failure (which would be "account settings: …").
- **Something at runtime needs `EMAIL` or `FRAMEWORK_MAIL_FROM`.** Ruled out: no reader in `packages/framework/src` outside `settings.ts` (grep above). The sender code was deleted by B 46 and C 34a.
- **A 0.1.x stage needs its `EMAIL` binding removed by hand, or `remove`/upgrade needs a change.** Ruled out by the code path:
  - A full `sst deploy` (step 5) uploads the script with exactly the declared `bindings`. `transform.worker` keeps only `keepBindings: ["secret_text", "secret_key"]` (`sst.ts:191`), so a `send_email` binding and the `FRAMEWORK_MAIL_FROM` plain-text variable left by 0.1.x are dropped on the next deploy.
  - `remove` writes the bucket-only program (`target.ts:359`) and deletes the Worker, so it never touches the binding.
  - `npm run upgrade` writes no Worker settings.
  - The live check of "the upload replaces the binding list" is the same as DEC-0336's, and is not run here (no token).

## Proposed fix
Remove the 0.1.x email contract from deploy, and what only it used (DEC-0732):
- `provision/core/deploy.ts`:
  - the preflight no longer reads the account settings record, and has no production email-domain requirement;
  - steps 3 and 5 get no `emailDomain`;
  - the result prints the public origin only (no `sign-in page:`, no `sender address:`), as provisioning.md §2 "Publishing the result" and cli.md say.
- `provision/core/operations.ts`: `DeployInput.emailDomain` and `TargetOperations.readAccountSettings` go; deploy was their only caller.
- `provision/core/fake-target.ts`: `readAccountSettings` and `deployedEmailDomains` go. `accountSettings` stays as the fake's model of the stored record, which `setup-account` must leave as it is (C's tests assert that).
- `provision/core/setup-account.ts`: `noEmailDomainMessage` goes (deploy was its only user).
- `provision/core/account-settings.ts`: `senderAddress` goes (deploy and `settings.ts` were its only users). `emailDomainProblem` and `testMailDomain` stay, because `cloudflare/account-settings.ts` still validates a stored 0.1.x record for the admin app's tests.
- `provision/cloudflare/target.ts`: `readAccountSettings`, `mail()` and the email domain in `workerInput` go; the header comment is updated.
- `provision/cloudflare/sst.ts`: `SstInput.worker.emailDomain` and the `send_email` binding go; the header comment is updated.
- `targets/cloudflare/settings.ts`: the `emailDomain` input, the production requirement, `sendEmail` (and Wrangler's `send_email`) and `FRAMEWORK_MAIL_FROM` go. `targets/cloudflare/bindings.ts`: `BINDINGS.email` and `BINDINGS.mailFrom` go.
- Comments that would become false: `cloudflare/account-settings.ts:6-8` and `cloudflare/setup-record.ts:10-12` ("deploy still reads it").
- Tests: the reproduction tests above (red → green). The MAIL-AC-004 tests of `sst.unit.test.ts`, `settings.unit.test.ts` and `target.unit.test.ts` are retired as `component-removed` (MAIL retired, DEC-0696). The two tests that assert the stop, and the output tests that expect `sign-in page:`/`sender address:`, are `test-was-wrong` (this record). The `readAccountSettings` tests of `target.unit.test.ts` and `senderAddress`'s assertion are `code-removed`. Record: `ai/implementation/test-reviews/2026-10-31-T7-96b.md`.
- 0.1.x stages, `remove` and upgrade: nothing is needed beyond stopping the binding (Alternatives).

## Similar cases (§7a.1.8 step 4)
Search: `git grep -niE 'email|EMAIL' packages/framework/src/provision packages/framework/src/cli/commands/deploy* packages/framework/src/config` on `97a8fba`: 245 lines in 36 files (`scratchpad/s96b/similar.txt`). Each file's hits are below.
- **Same defect, fixed here (deploy path):**
  - `core/deploy.ts`: the preflight, threading and output, as above.
  - `core/operations.ts`: `DeployInput.emailDomain`.
  - `core/fake-target.ts`: `deployedEmailDomains`, `readAccountSettings`.
  - `cloudflare/{target,sst}.ts`.
  - `core/setup-account.ts`: `noEmailDomainMessage`.
  - `core/account-settings.ts`: `senderAddress`.
  - The search's scope misses the second gate, `targets/cloudflare/settings.ts` with `bindings.ts`. It was found by following `sst.ts`'s import, and is fixed here.
- **Tests that seeded or asserted the defect** (fixed here, recorded in the test review):
  - `cli/commands/deploy.unit.test.ts:131-153`;
  - `core/deploy.unit.test.ts:284-313`;
  - `cloudflare/{sst,target}.unit.test.ts`;
  - `targets/cloudflare/settings.unit.test.ts`;
  - `core/account-settings.unit.test.ts` (`senderAddress`).
- **Not the defect: 0.1.x data kept on purpose**, with no deploy effect:
  - `cloudflare/account-settings.ts`, which still parses and validates a stored `emailDomain`. After the fix its only callers are the admin app's tests (`setup-page.unit.test.ts:179`) and `setup-record.ts` (constants).
  - The `lifecycle.unit.test.ts:46` and `cloudflare-setup.unit.test.ts:538` fixtures.
  - The admin app's `cleanup-page.ts` (the optional v0.1.x cleanup, plan §8).
  - Listed for T6: whether `parseAccountSettings`/`readAccountSettings` can go once nothing outside tests reads them.
- **Not the defect: setup and permissions comments and the 0.1.x permission catalogue** (C/E, shared `permissions.ts`):
  - `permissions.ts:53-101, 240-269`: the Email Sending/Routing groups and probes;
  - `setup-steps.ts`, `token-sources.ts`, `token-policies.ts`, `everyday-token.ts`, `cloudflare-setup.ts`, `account.ts:113`, `setup-world.test-support.ts`, `fake-cloud.test-support.ts`: comments, the fake's email endpoints, and token tests of 0.1.x tokens.

  None is read by `deploy`. `account.ts:113` says "`setup-steps.ts` adds the email steps after them", which has been stale since 34b. Outside T7's paths → T6.
- **Outside the deploy path, a different component: `config/schema.ts`, `config/resolve.ts`, `targets/stage.ts:118`** still accept and carry `framework.email.senderName` (MAIL-REQ-003), which nothing uses. The contract `stage-config.schema.json` still documents it. It does not stop a deploy: an app without it validates. This is a CFG/contract removal (MAIL-AC-005 is retired), so it becomes a **new item** (D for the contract, the CFG owner for the code), not a silent fix.
- **The other target:** there is no AWS target on this branch (`provision/` has only `cloudflare` and `core`), so there is nothing to check.
- **Docs:** provisioning.md §2 says "only `deploy` and the setup check read the record". After the fix, deploy no longer reads it, so the sentence is stale → D. cloudflare.md §2's base text (lines 42-43) still describes `EMAIL` and `FRAMEWORK_MAIL_FROM`, but the v0.2.0 amendment (line 61) overrides it. No change is needed for correctness.
- `tests/compliance/criteria/compl/prodcheck.test.ts:39` names MAIL-AC-004 in a comment → T6.

## Verification plan
- **Red** (done, above): the three new tests in `auth-app-fake.test.ts` fail on `97a8fba`.
- **Green:** after the fix, `auth-app-fake.test.ts` passes 6/6. The rewritten unit tests check:
  - core deploy with an empty record: a production stage passes the preflight, and the output has no sign-in page or sender;
  - the Cloudflare target with no record: a production deploy succeeds, binds `AUTH`, and binds no `EMAIL`;
  - the settings: a production stage with no domain gets no `sendEmail`/`FRAMEWORK_MAIL_FROM`.
- **The new tests can fail:** each fails with the old `deploy.ts:232` line restored, and each binding assertion fails with the old `settings.ts:105` line restored.
- **Gate:** `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit`, plus `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/prov tests/compliance/criteria/cf packages/framework/test/integration/provision`. That last directory does not exist on this base: T3's #138 adds it on another stack. Then CI on the PR.

## Review (round 1)
Status: awaiting review
