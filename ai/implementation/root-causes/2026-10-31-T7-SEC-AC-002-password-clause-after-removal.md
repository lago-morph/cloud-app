# Root cause: SEC-AC-002's password parts fail on the join branch because `secrets/password-no-leak.test.ts` still signs up through the password routes that B 45 removed. The test goes with C 34a (#150), but the criterion's password clause has not been retired.

Author: item T7 (diagnosis, plan-v0.2.0 §7a.1.8 step 1), 2026-10-31. Base: `origin/v0.2.0/71n-path-map-after-removals` (PR #134) at `60b5e8e`. Node 22.23.4, Chromium shim per progress §6, local apiKey set on stdin (DEC-0779). I wrote none of the code or tests involved.

## Symptom
In run `hv2yas3d80t67es`, SEC-AC-002 is `failed`, 2 of 7 tests. Both are in `tests/compliance/criteria/secrets/password-no-leak.test.ts`:

```
× [SEC-AC-002] locally, the stored log entries contain no test password, verification token or reset token of the password provider
× [SEC-AC-002] locally (in-process with passwordLoginProvider), the log entries contain no test password, verification token or reset token
AssertionError: POST /api/auth/password/sign-up → 404 HTTP.NOT_FOUND {"error":{"code":"HTTP.NOT_FOUND",…}}: expected 404 to be 200
 ❯ expectResult tests/compliance/criteria/pwd/support.ts:211
```

The other five SEC-AC-002 tests pass: secret values, session cookies, ticket URLs and the stub authorization code. T1's run `elfokkdfd656tww` (`93eab74`) and my full run show the same thing.

## Evidence
1. **The route is gone by design.** `4ebbbf5` ("WIP remove password (B, PR 45)") removed the password provider and its `/api/auth/password/*` routes (plan-v0.2.0 §6; DEC-0698 retires `frameworkAuthSecret` with the provider, `ai/implementation/decisions/v020-D.md:94`; `docs/components/secrets.md:50` carries that retirement). The 404 is HTTP's answer for an unknown API route.
2. **The test was left behind.** B 45 kept `password-no-leak.test.ts` and `criteria/pwd/support.ts`. C 34a removes both: `ed8f873` ("C 34a: remove the email and mail files (pure removal, DEC-0689)") on `origin/v0.2.0/34a-remove-email-files`, PR #150 (stacked on #149, on 71n). Its test-change record lists them under "component-removed — password sign-in (plan §6, B 45)": "`password-no-leak.test.ts` (failed at runtime since B 45)".
3. **The criterion still has the clause.** `docs/components/secrets.md:73`, SEC-AC-002, still ends "…; locally, they also contain no stub login provider authorization code, and no test password, verification token or reset token of the password provider." The sentence is unchanged on every `origin/v0.2.0/*` branch, including D's latest (`39c-role-change-wording`, #151) and 34a. No decision in `docs/decisions/decision-log.md` or `ai/implementation/decisions/v020-*.md` retires that clause.
4. **Confirmation on #150's head.** See "Confirmation run" below.

## Causal chain
1. B 45 removed the password provider and its routes (evidence 1).
2. The SEC-AC-002 password test still signs up a test account through `POST /api/auth/password/sign-up`, gets 404, and fails before it scans anything (Symptom, evidence 2).
3. C 34a removes the test with the provider's other leftovers (evidence 2). That clears the failure, but the criterion still asks for the password clause (evidence 3).

## Alternatives ruled out
- **A leak, or a defect in new code.** No. The test fails at its setup step (sign-up 404), not at the scan, and the five other SEC-AC-002 tests pass.
- **Rewrite the test against the auth-app provider.** No. The values the clause names (test password, verification token, reset token) no longer exist in v0.2.0. The auth-app sign-in's own values (authorization code, session cookie) are AUTH and SEC criteria that T1 covers (#131/#132).
- **Fix it here.** No. #150 already removes the test. The clause's retirement is D's spec work (plan §6.1), so T7 changes neither the test nor the docs.

## Proposed fix
- **Test:** covered by #150 (C 34a, `component-removed`). No T7 change.
- **Open, for D (spec), before #150 merges or with it.** Retire the clause with an amendment under the SEC criteria table in `docs/components/secrets.md`, citing plan §6 and DEC-0698. Exact text proposed:

  > Amendment for v0.2.0 (Origin: ai-proposed · Decision: DEC-0698; plan-v0.2.0 §6): the password provider is removed, so SEC-AC-002's clause "and no test password, verification token or reset token of the password provider" is retired. SEC-AC-002 reads: "A scan of the repository, the build output, the deployed browser assets, the stored log entries, and error responses from a test run finds no test secret value. The stored log entries also contain no test session cookie value and no issued ticket URL; locally, they also contain no stub login provider authorization code."

  D may instead follow DEC-0696's precedent (PWD and MAIL retired; their criteria move to the Retired tables), or allocate a new DEC. It is D's choice.
- **Also open, for D (spec).** `docs/components/secrets.md:58` ("**Local.**") still lists `frameworkAuthSecret` among the development secrets `dev` generates into `.dev.vars`. On 71n, `dev` generates only `SECRET_FRAMEWORK_SESSION_KEY`, `SECRET_FRAMEWORK_AUTH_SECRET` and `SECRET_FRAMEWORK_LOCAL_TICKET_KEY` (observed in `.dev.vars` after a run). Either the sentence or the code must follow DEC-0698 ("the CLI no longer generates it"). Diagnosing that is outside this record.

## Verification plan
- On #150's head (`97a8fba`, which contains 71n and `873eb3c`): `npm run compliance -- --target local --only SEC-AC-002` gives `passed` (the five remaining tests).
- After D's amendment, the criterion text and the tests agree, with no tagged SEC-AC-002 test for the password clause.

## Confirmation run
I made a scratch merge of `origin/v0.2.0/34a-remove-email-files` (#150, `97a8fba`, which already contains 71n) into 71n. It fast-forwards to `97a8fba`. I rebuilt the framework, set a throwaway local apiKey on stdin, and ran `npm run compliance -- --target local --only SEC-AC-002` (run `1nxoecbpeai44fd`): **passed**, 5 of 5 tests. These are the secret-value scan, the stub-login entries, the in-process entries and responses, the in-process stub code, and the repository, build and `.logs/` scan. With the test file removed, no password test remains. The criterion's clause still stands in `secrets.md` (open, above).

## Review
Reviewer: independent root-cause reviewer, session_014mWQ6hjtYXfjcSWXUEWwEy, 2026-10-31 (at `6a983d2`)
Verdict: accepted-with-changes

Reasons:
- **minor** The causal chain holds. On 71n no `/api/auth/password/*` route remains, and the failure is the sign-up 404 in setup. `ed8f873` on `34a-remove-email-files` deletes `password-no-leak.test.ts` and `pwd/support.ts`. `2026-10-31-C34a.md:43` lists them as component-removed. `secrets.md:73` keeps the password clause on every `origin/v0.2.0/*` branch, 34a and 39c included.
- **minor** The Confirmation run (added in `6a983d2`, run `1nxoecbpeai44fd` on `97a8fba`) agrees with my own independent run. The Verification plan still names #150's head as `873eb3c`. It is now `97a8fba` (34b merged into 34a), which contains `873eb3c`. Update it.
- **minor** Evidence 1 cites `secrets.md:50` for "DEC-0698 retires `frameworkAuthSecret`". The retirement is in `v020-D.md:94` (DEC-0698, SEC bullet). `secrets.md:50` and `:58` still describe `frameworkAuthSecret` as live on 71n and on 39c. Cite `v020-D.md:94` instead. Also list `secrets.md:50/:58` as a further open item for D, beside the SEC-AC-002 clause. The commit subject of `4ebbbf5` is "WIP remove password (B, PR 45)".
- **minor** The proposed amendment could also cite DEC-0696 (PWD and MAIL retired; their criteria move to the Retired tables), which is the closer precedent. It is D's choice.

Re-run:
- Red, on `60b5e8e` (run `he319fk0u13979l`): SEC-AC-002 failed, 2 of 7. Both failures are in `password-no-leak.test.ts` with `POST /api/auth/password/sign-up → 404 HTTP.NOT_FOUND`. The other 5 passed.
- Confirmation, on #150's head `97a8fba`: `npm run compliance -- --target local --only SEC-AC-002` (run `ndbgbq7elieah4x`) passed, 5 of 5.

## Response (round 1)
- **Applied:**
  - the head is now `97a8fba` in Verification plan;
  - `v020-D.md:94` is cited for DEC-0698;
  - the commit subject is corrected;
  - DEC-0696 is offered to D as the precedent.
- **`secrets.md:50`, partly rebutted.** On 71n (`git show origin/v0.2.0/71n-path-map-after-removals:docs/components/secrets.md`, line 50), the `frameworkAuthSecret` bullet already ends "retired in v0.2.0 with the password provider (DEC-0698): the CLI no longer generates it, and an existing Worker secret is left in place". Line 58 (**Local.**) is the stale one, and it is now listed as a further open item for D.
