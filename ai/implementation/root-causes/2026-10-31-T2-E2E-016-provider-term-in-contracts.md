# Root cause: E2E-016's scan finds "Cloudflare" in three app-facing contract sentences that v0.2.0 items added

Item T2 (e2e scope of plan-v0.2.0 §7.1), branch `v0.2.0/78-e2e-scope` (base `origin/v0.2.0/71m-merge-auth-provider-into-admin-app`, `39c87a0`). Diagnosed 2026-10-31 by the item's implementer: this run has no in-process subagent tool, so no separate diagnoser was available (disclosed, as in `2026-10-31-A-workerd-fetch-redirect-error.md`). The review is by an independent cloud session.

## Symptom

`PLAYWRIGHT_BROWSERS_PATH=<shim> npm run compliance -- --target local --only E2E-001,…,E2E-016` and, alone, `npx playwright test --project=e2e-api E2E-016`: the test `[E2E-016] scan part: no app-facing contract contains a provider or protocol term` fails (2 of the 3 E2E-016 tests pass):

```
+ "docs/contracts/ts/testing.d.ts:75 comment \"Cloudflare\" in \"/**\n   * Use the auth-app provider (sign-in with Cloudflare; provider id `cf-account`) over the …\"",
+ "docs/contracts/ts/testing.d.ts:154 string \"Cloudflare\" in \": signs in as the Cloudflare user \"",
+ "docs/contracts/http/framework.openapi.yaml:50 text \"Cloudflare\" in \"an administrator role in the owner's Cloudflare account (SYS-REQ-018, DEC-0690).\"",
```

## Evidence

1. The term list is unchanged for this term: `Cloudflare` has been in `tests/compliance/e2e/terms.txt` and in E2E-016's text since before v0.2.0. PR 78 adds only `refresh token`, `PKCE` and `Secrets Store`, none of which is among the findings.
2. At v0.2.0's base (`1e0c289`) neither file contains the word: `git show 1e0c289:docs/contracts/ts/testing.d.ts | grep -c Cloudflare` → 0; the same for `framework.openapi.yaml` → 0. P0's baseline compliance run on `1e0c289` did not list E2E-016 among its failures (progress §6 "Baseline").
3. The lines came from two v0.2.0 items: `git log -L` names `679c3bf` ("auth, testing: … createTestApp signs in through the fake auth app (B, PR 41a)") for `testing.d.ts` lines 75–76 and 154, and `30fb97d` ("D 37: auth.md for the auth-app provider, AUTH criteria rewritten, contracts") for `framework.openapi.yaml` line 50.
4. E2E-016's scan part is `Where: Local` (automated), and it runs only in the e2e layer, which no PR in those stacks ran: their PRs changed docs and framework source with the e2e projects selected only by the staged CI (not yet applied, progress Open items "no writes to `.github/workflows/*`"), and the items' exit checks were unit, integration and their own criteria.
5. The other two findings' kinds (comment, string, text) show the scanner did what E2E-016 says: whole-word, case-sensitive, over comments, string literals and YAML text.

## Causal chain

1. v0.2.0's sign-in is "sign-in with Cloudflare" and admins are "members with an administrator role in the owner's Cloudflare account" (SYS-REQ-018 and SYS-REQ-019 as amended, DEC-0690, DEC-0691) — evidence 3: both added sentences paraphrase these amendments.
2. B 41a and D 37 wrote that wording into two app-facing contracts (`docs/contracts/ts/testing.d.ts`, outside `internal/`, and `framework.openapi.yaml`) — evidence 2, 3.
3. E2E-016 forbids provider terms in exactly those files (SYS-REQ-002/SYS-REQ-005: app code and app-facing contracts carry application concepts only; the provider is named in internal contracts and component docs) — the scenario text and evidence 5.
4. Neither item ran the e2e layer, so the failure first shows in the first local e2e run after them, this one — evidence 4.

## Alternatives ruled out

- **PR 78's term-list change:** none of the three added terms is in a finding (evidence 1); the findings are for `Cloudflare`, listed since release 1.
- **The scanner over-matching:** each finding is the exact word `Cloudflare` in prose; the negative controls in the second E2E-016 test (other case, longer words) pass.
- **The term list being wrong to include `Cloudflare` in v0.2.0:** SYS-REQ-019 as amended keeps "App code MUST NOT be able to tell which provider is in use", and the internal contracts (`internal/auth-app.d.ts`, `internal/login-provider.d.ts`) are where the provider is named; the scan excludes `internal/` for that reason.

## Proposed fix

Change the three sentences to the framework's own terms, keeping their meaning and their references, so the contracts name the auth app and the account but not the provider:
- `testing.d.ts` line 75: "Use the auth-app provider (sign-in through the account's auth app; provider id `cf-account`) …".
- `testing.d.ts` line 154: "signs in as the auth-app user `identity` …".
- `framework.openapi.yaml` line 50: "… admins are the members with an administrator role in the owner's account (SYS-REQ-018, DEC-0690)."

These are contract comments and descriptions only: no type, field or schema changes, so no generated or compiled output changes. The fix goes in PR 78 as part of its "matching spec edits", in a commit after this record's review. The files are outside T2's owned paths (D owns the contracts, done); the change is recorded as DEC-0760.

## Verification plan

- Red (now, before the fix): `npx playwright test --project=e2e-api E2E-016` → 1 failed, 2 passed, with the three findings above.
- Green (after the fix): the same command → 3 passed; then E2E-016 through the harness (`npm run compliance -- --target local --only E2E-016`) passes.
- Similar cases: a repository-wide scan of every app-facing contract for every listed term is the test itself, so a green run is the similar-case search for this pattern. Also checked: `grep -rlw Cloudflare docs/contracts/ts/*.d.ts docs/contracts/http/framework.openapi.yaml` lists only these two files.

## Review

Reviewer: independent cloud session `session_014mWQ6iQm8CioUNqZEjoNmt` (found neither cause, wrote none of the code), 2026-10-31, before the fix commit.
Verdict: `accepted-with-changes`.
- Reproduced at `6f7ddcf`: `npx playwright test --project=e2e-api E2E-016` → 1 failed, 2 passed, exactly the three findings; `Cloudflare` occurs 0 times in both files at `1e0c289`. Every link has evidence; the alternatives are argued; the fix addresses the cause and keeps the meaning (comments and descriptions only).
- **minor (binding):** in `testing.d.ts` line 76 also drop "provider id `cf-account`" (or point to `internal/login-provider.d.ts`): `cf` abbreviates the provider's name, against SYS-REQ-005, though the whole-word scan cannot catch it. It is the only occurrence in an app-facing contract.
- **minor (non-binding):** in `framework.openapi.yaml` line 50, "the owner's account" is a little vague; "the account the auth app serves (the owner's)" is more precise. Either is acceptable.
- **minor:** the line-154 wording is fine; red/green should also `grep -rnw "cf-account\|Cloudflare"` over the app-facing contracts.

## Fix (after the review)

Applied as amended: line 76 reads "Use the auth-app provider (sign-in through the account's auth app) over …" with no provider ID; line 154 "signs in as the auth-app user `identity`"; `framework.openapi.yaml` line 50 "… an administrator role in the account the auth app serves (the owner's) (SYS-REQ-018, DEC-0690)". Red before (the run above), green after: see the commit that follows this record's Review.
