# Root cause: `cloudflare-setup` runs the whole bootstrap with a protected bootstrap token (PAR-361), and a refused (long-lived) bootstrap token lists accounts, with the everyday token's reads in between, before it deletes itself

Author: item T7 (diagnosis, §7a.1.8 step 1), 2026-10-31. Found by T1's SETUP criteria tests (PR #133): DEC-0751 (the protected token) and DEC-0750's note on the account-list gap (the refused token). Reproduced on `v0.2.0/34c-fix-bootstrap-token-rules`, branched from `origin/v0.2.0/34a-remove-email-files` (`97a8fba`, PR #150), which holds C's latest `cloudflare-setup.ts`. The diagnoser is T7's fixer: subagents here cannot start another subagent, so the independent review below is a fresh cloud session.

## Symptom
1. **Protected token used.** A bootstrap token whose ID is in `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (PAR-361) and whose expiry is within PAR-435 runs the whole bootstrap. It creates both OAuth clients, writes four Secrets Store secrets and deploys the admin app. On a fresh account it also registers the `workers.dev` subdomain. It is not deleted, a note says so, and the run exits 0. SETUP-REQ-004 as amended (DEC-0697) says a protected token "MUST be neither used for the bootstrap nor deleted". C's DEC-0681 says "neither deleted nor used".
2. **Refused token lists accounts first.** A bootstrap token with no expiry, or one more than PAR-435 away, sends `GET /accounts?per_page=50` before its verify call, its own details and its DELETE. With an everyday token set, the everyday token's two identification reads come between the bootstrap token's verify and its own-details read. DEC-0681 says that the refused token "sends its own DELETE at once. Nothing else is read or used with it: no account check and no permission comparison".

Neither defect fails a test today. At `97a8fba` with `CLOUDFLARE_*` unset:
- `cloudflare-setup.unit.test.ts` passes 59/59;
- `criteria/setup` passes 63/63, with T1's `bootstrap-v020.test.ts` copied in locally and not committed.

T1's tests do not catch either defect:
- SETUP-AC-005's text only says "neither updated nor deleted" (DEC-0751);
- T1's expiry test allows the account list (DEC-0750).

## Evidence
1. **New red tests.** Two tests in `packages/framework/src/cli/commands/cloudflare-setup.unit.test.ts`, under "the bootstrap token's rules", fail at `97a8fba`:
   - "a protected bootstrap token is refused before any use…": `with an everyday token: expected +0 to be 1` (exit status).
   - "a long-lived bootstrap token deletes itself before any other call…": `1 day + 1 s away: expected [ …(4) ] to deeply equal [ …(3) ]`.
2. **Request logs at `97a8fba`.** A probe (temporary, not committed) recorded each `SetupWorld` request (`setup-world.test-support.ts:127–129` logs `<token id> <method> <path>` for every call the command makes) and the matching output lines:
   - **Protected, usable expiry, with an everyday token: exit 0, not deleted, 2 OAuth clients.** The requests are:
     - `boot-id GET /accounts?per_page=50`, then `boot-id GET …/tokens/verify`;
     - `everyday-id GET /accounts?per_page=50`, then `everyday-id GET …/tokens/verify`;
     - `boot-id GET …/tokens/boot-id`, then `GET …/workers/subdomain`, `GET …/oauth_clients`, `GET …/secrets_store/stores`;
     - two `POST …/oauth_clients`, four `POST …/secrets_store/stores/store1/secrets`;
     - `PUT …/workers/scripts/prototype-admin`, `POST …/workers/scripts/prototype-admin/subdomain`.

     The output ends with `note: the bootstrap token is protected, so setup did not delete it; CLOUDFLARE_BOOTSTRAP_TOKEN is kept as it is` and `The Cloudflare bootstrap is complete.`
   - **Protected, bootstrap token only: exit 0.** The requests are the same, plus `boot-id PUT …/workers/subdomain`, a write to the account.
   - **Long-lived, with an everyday token: exit 1, deleted.** The requests are: `boot-id GET /accounts?per_page=50`, `boot-id GET …/tokens/verify`, `everyday-id GET /accounts?per_page=50`, `everyday-id GET …/tokens/verify`, `boot-id GET …/tokens/boot-id`, `boot-id DELETE …/tokens/boot-id`.
   - **Long-lived, bootstrap token only: exit 1, deleted.** The requests are: `boot-id GET /accounts?per_page=50`, `boot-id GET …/tokens/verify`, `boot-id GET …/tokens/boot-id`, `boot-id DELETE …/tokens/boot-id`.
3. **The code at `97a8fba`, `provision/cloudflare/cloudflare-setup.ts`:**
   - `bootstrap()` (lines 584–624) checks `isProtected(token.id)` only at line 604, after `ensureSubdomain`, `ensureOAuthClients`, `ensureStore` and `deployAdminApp`. There it skips only the self-delete.
   - `refuseLongLived()` (line 634) is the only place a protected token is "neither deleted nor used".
   - In the run order, `identifyIn(BOOTSTRAP_SETTING, …)` (line 410) runs before `identifyIn(EVERYDAY_SETTING, …)` (line 412). The own-details read and the expiry rule come after both (lines 441–451).
4. **`identify()` (lines 287–319) always starts with `listAccounts`** (`GET /accounts?per_page=50`). It then tries `GET /accounts/<a>/tokens/verify` on each listed account, then `/user/tokens/verify`. An account token verifies only under its own account:
   - the fake world answers `/accounts/<a>/tokens/verify` only when `t.account === a` (`setup-world.test-support.ts:142`);
   - it answers `/user/tokens/verify` only for a user token (line 135);
   - DEC-0584 (`decision-log.md`, "Tokens") describes the same for the real API: "`GET /accounts` lists what the token sees; `GET /accounts/<a>/tokens/verify` on each … finds an account token's owner, else `GET /user/tokens/verify` a user token". `setup.md` §3 step 2 also checks each token "with `/accounts/<id>/tokens/verify`".

   This was not re-verified live here. With no account known otherwise, the list is therefore the only way to reach the token's own verify call.
5. **History.**
   - `git blame` puts the protected branch of `bootstrap()` and the `refuseLongLived` check in C 30 (`083304c`, "bootstrap token rules").
   - Before `083304c`, the v0.1.x code (`409824c`, DEC-0589) skipped only the DELETE for a protected token. Its comment reads "its line is kept and a note says so". That matches SETUP-REQ-004's v0.1.x paragraph: "does not delete itself … and finishes as it otherwise would".
   - The v0.2.0 amendment replaces that paragraph with "neither used for the bootstrap nor deleted".
   - C's DEC-0682 records that the SETUP text lagged while C 30 was written ("Spec lag … D 39 rewrites it").
6. **C's unit test fixed the old behaviour.** "a protected bootstrap ID is never deleted: … the run finishes normally (DEC-0589)" (`cloudflare-setup.unit.test.ts`, the token write guard block) asserts exit 0 and `The Cloudflare bootstrap is complete.` C's expiry test asserts the bootstrap-only request list `[GET /accounts?per_page=50, verify, own details, DELETE]`. That is the case where the list is needed (evidence 4), so it shows the list but no ordering with the everyday token.

## Causal chain
1. **Protected token.**
   - C 30 rewrote the bootstrap from plan §5.1, which does not mention protected tokens. It kept v0.1.x's DEC-0589 behaviour on the normal path: skip the DELETE and finish (evidence 3, 5).
   - C applied DEC-0681's "neither deleted nor used" only inside `refuseLongLived` (evidence 3).
   - So `isProtected` is checked after the bootstrap's writes, and only the DELETE is withheld (evidence 2).
   - C's unit test asserts that old outcome (evidence 6), so nothing went red.
   - The write guard refuses only token writes, so the OAuth client, Secrets Store and Worker writes pass through it.
2. **Refused token.**
   - `identify()` always lists accounts first (evidence 4). C 30 placed the expiry rule after both tokens were identified (evidence 3).
   - So every refused token sends `GET /accounts` before its DELETE. When an everyday token is set, the everyday token's reads also come between the bootstrap token's verify and its DELETE (evidence 2).
   - The list itself is needed to reach the token's own verify call (evidence 4). What breaks DEC-0681 is the order: the everyday token's requests come before the refused token's DELETE because C 30 placed the expiry rule after both tokens were identified (corrected in Response round 1; this bullet first said the list was avoidable).

## Alternatives ruled out
- **The fake world adds requests of its own.** No. `SetupWorld.apiFor` logs only calls the command makes through `deps.apiFor` (evidence 2, 4). The setup steps run before the command (`setUpAccount`) go to `FakeCloud.api` directly and do not appear.
- **The write guard should have stopped it.** The guard (DEC-0589) judges only requests that name a token ID. It does refuse a protected token's DELETE. Creating OAuth clients, writing secrets and deploying are not token writes, so the guard cannot see them. The rule belongs before the bootstrap, not in the guard.
- **T1's reading is too strict.** No. SETUP-REQ-004 as amended ("MUST be neither used for the bootstrap nor deleted"), SETUP-AC-011 ("does not use it for the bootstrap") and DEC-0681 ("neither deleted nor used") agree. SETUP-AC-005's text lags (DEC-0751). That is D's to amend, and it is listed as open.
- **The bootstrap token can skip the account list in every case.** No (evidence 4). An account token verifies only under its own account. With no everyday token and no other account the run knows, the list is the only way to its verify call. That is the usual first run (plan §5.1: the bootstrap token alone).
- **Find the bootstrap token's account without its own list** (the fix first proposed, withdrawn in Response round 1). This would use `CLOUDFLARE_ACCOUNT_ID`, or the everyday token's accounts, as the account to verify on. Both can send the bootstrap token's verify to an account it does not belong to:
  - in an account switch, `CLOUDFLARE_ACCOUNT_ID` names the old account;
  - so does an everyday token that is still the old account's, or one of another account than the bootstrap token's.

  SETUP-AC-006 says "no request is sent to the old account". The list asks Cloudflare only what the bootstrap token itself sees, so it is kept (review round 1, item 4).

## Proposed fix (as amended by Response round 1)
In `provision/cloudflare/cloudflare-setup.ts` (C's file; T7 fixes it by §7a.1.8 on C's 34a stack):
1. **The bootstrap token's own checks move up.** They run right after its identification, which already runs first, and before the everyday token is identified. The order is:
   1. identification (its account list, then its verify);
   2. a user token is refused (never deleted, as before);
   3. **a protected token is refused**;
   4. its own details are read;
   5. the expiry rule.

   The order of the problem messages may change: the user-token problem now comes before the everyday token's. The "same token as the everyday token" (same ID) check still needs the everyday token, so it stays after the everyday token is identified. The value check (the same value in both settings) and the own-details check ("was the everyday token pasted there?") still stop the everyday token pasted as the bootstrap token before any DELETE.
2. **Refusing a protected token.** It is refused as soon as its verify call gives its ID, before its own-details read, the expiry rule and any other use. It becomes a bootstrap-token problem:
   - it is not deleted, its line is kept, and the run exits 1 with the bootstrap link;
   - the message: `it is protected (its ID is in PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS) and was not deleted: setup did not use it for the bootstrap, and its line is kept as it is`.

   The protected branches in `bootstrap()` and `refuseLongLived()` become unreachable and go. The write guard keeps refusing a protected ID as defence in depth.
3. **What a refused long-lived token sends.** Its list (as before), its verify, its own details, then its DELETE. The run then stops: no request of any other token comes before or after, so "delete itself before any other call" holds in its plain reading. This follows DEC-0681 with one reading, recorded as DEC-0733: the list is how the token's own verify call is reached (evidence 4). It is not DEC-0681's "account check", which is step 4: `CLOUDFLARE_ACCOUNT_ID`, the switch and the other-account stop.
4. **The write guard at that point.** The early requests go through a guard that does not yet know the everyday token's ID (review round 1, item 6). Its rule still allows only the bootstrap token's own ID while the self-delete is armed, and the everyday token's ID differs from it (point 1). The bootstrap itself still uses a guard built after both tokens are identified.
5. **Tests.**
   - The protected test (evidence 1) stays as it is.
   - The long-lived test is rewritten before the fix, as review round 1 item 5 asks. It asserts that:
     - the token's own requests are its identification, then its own details, then its DELETE as its last request;
     - with an everyday token set, no request of the everyday token appears anywhere in the run.

     It is red at `97a8fba`, because the everyday token's list and verify come before the DELETE.
   - C's "finishes normally" test (evidence 6) asserted the defect. It is changed to the amended rule, with reason `test-was-wrong`, citing this record.
   - The long-lived protected test's message assertion follows the new text, with reason `behaviour-changed`, citing DEC-0733.
   - Both changes go in `test-reviews/2026-10-31-T7-34c.md`.

## Verification plan
- The two new tests are red at `97a8fba` (evidence 1, and the rewritten long-lived test) and green after the fix.
- The whole unit suite passes, and so do `criteria/setup` with T1's file copied in (not committed), build, typecheck, lint and `permission-tables --check`.
- With the probe:
  - a protected token's own requests are only its list and its verify, with no write;
  - a long-lived token sends list, verify, own details and DELETE, the DELETE is the run's last request, and no other token's request comes before it.

## Review (round 1)

Reviewer: an independent cloud session that did not write this record or the code (`session_014mWQ6h81Y226hhQgrgLGtF`), 2026-10-31. It ran `npm ci` and the build, ran the tests with `CLOUDFLARE_*` unset, edited nothing, and committed and pushed nothing.

**Verdict: accepted-with-changes**

1. **minor**: Reproduced at `35b4b13`: `cloudflare-setup.unit.test.ts` gives 2 failed and 59 passed (61). The failures are `with an everyday token: expected +0 to be 1` and `1 day + 1 s away: expected [ …(4) ] to deeply equal [ …(3) ]`. Both match evidence 1 and 2.
2. **minor**: The causal chain is supported by the code. The alternatives (requests added by the fake, the write guard, T1's reading being too strict) are correctly ruled out. Exit 1 as a bootstrap-slot problem with the bootstrap link is consistent with SETUP-REQ-001 as amended. Refusing as soon as verify gives the ID is the earliest point at which it can be known.
3. **major**: The record misses the simplest alternative: move the own-details read, the protected check and the expiry rule up to just after the bootstrap token's identification. That token is already identified first. A refused token then sends nothing after its DELETE, and no other token's request comes before it either. The everyday-first order meets "delete itself before any other call" only under the record's narrower reading.
4. **major**: Using the everyday token's accounts for the bootstrap token's verify brings back the cross-account request the record raised against `CLOUDFLARE_ACCOUNT_ID`. Examples are a bootstrap token of another account than the everyday token's, and a switch while the everyday token is still the old account's. Either take item 3's move and keep the list, or state and justify the cross-account request.
5. **major**: The second red test forces the everyday-first design ("no account list"; exactly three requests). It should assert:
   - the token's own requests are identification, then own details, then the DELETE as its last request;
   - no other token's request falls in that span or after it, or, under item 3's move, anywhere in the run.
6. **minor**: Under item 3's move, the user-token refusal also comes before the own-details read, and the guard has no `everydayId` when the refused DELETE is armed. The value check and the own-details check still protect the everyday token, but the record should say so.
7. **minor**: The fix PR must add DEC-0733 and the test-change record. SETUP-AC-005's missing clause stays D's open item (DEC-0751). The protected message must say "protected" and "was not deleted"; the proposed text does.

## Response (round 1)

- **To 3:** accepted. The fix is now the move: the bootstrap token's checks run right after its identification and before the everyday token is identified (Proposed fix, point 1). A refused token's DELETE is then the run's last request, and no other token's request comes before it.
- **To 4:** accepted. The everyday-accounts idea is withdrawn and added to Alternatives ruled out. The list stays, read with the bootstrap token only. DEC-0733 records that the list is identification.
- **To 5:** accepted. The long-lived test is rewritten as asked:
  - its own requests are identification (list or verify), then its own details, then its DELETE, which is its last request;
  - no request of the everyday token appears anywhere in the run.

  It is red with the code at `97a8fba`. The unit file gives 2 failed and 59 passed, and this test fails with `1 day + 1 s away: no other token's request, before or after the DELETE: expected [ …(6) ] to deeply equal [ …(4) ]`.
- **To 6:** accepted. The user-token refusal is step 2 of the new order. Point 4 of the fix states what protects the everyday token while the early guard lacks its ID.
- **To 1, 2, 7:** noted. DEC-0733 is drafted in `decisions/v020-T7.md`, and the test-change record comes with the fix.

## Review (round 2)

Status: awaiting review
