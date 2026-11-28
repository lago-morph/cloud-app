# Root cause: setup creates OAuth clients with field names the live API does not accept

Status: reviewed, accepted (2026-11-27)

## Symptom

SETUP-AC-011's live run (2026-11-27, the owner's account, the branch `v0.2.0/single-cloudflare-token` at `3d089eb6`, packed and installed in a new app) stopped at the first write after the permission check:

```
cloudflare-setup failed: creating the OAuth client prototype-framework-admin failed: HTTP 400: client_name is required (code 70705)
```

Exit status 1. Nothing had been created (the inventory after the run equalled the one before).

## Evidence

1. **The body sent.** `clientBody` (`packages/framework/src/provision/cloudflare/oauth-clients.ts`) sent `name`, `redirect_uris`, `response_types`, `grant_types`, `token_endpoint_auth_method`, `scopes` (the two required scopes) and `optional_scopes` (the admin client's six). Its header comment and DEC-0684 record every field name except `redirect_uris` and `response_types` as *unverified*.
2. **The live list.** `GET /accounts/<a>/oauth_clients` on the same account (one existing client, made outside the framework) returns each client with `client_name`, `client_id`, `visibility: "private"`, `scopes`, and no `name` field.
3. **Cloudflare's API reference** (developers.cloudflare.com, "Create OAuth Client", `POST /accounts/{account_id}/oauth_clients`): the body field is `client_name`; `optional_scopes` "Each value must also appear in `scopes`".
4. **Probe 1** (a throwaway client `pf-probe-subset`: `client_name`, the two required scopes in `scopes`, the six in `optional_scopes`): HTTP 400, `optional scope must exist in client scopes` (code 70748). Nothing was created.
5. **Probe 2** (`pf-probe-superset`: the same, with all eight in `scopes`): HTTP 200; the answer has `client_id`, `client_secret`, `visibility: "private"`, `optional_scopes` the six, `scopes` the eight plus `openid` (added because `response_types` holds `id_token`). `DELETE …/oauth_clients/<id>` then answered 200. Probe output in the notes (`single-cloudflare-token.md` §8).
6. **The fake API** (`fake-cloud.test-support.ts`) accepted any body and listed clients under `name`, so every automated test passed with the wrong field names.

## Causal chain

1. The body's field names were never checked against the live API (evidence 1); the fake was written from the same assumption (evidence 6). →
2. The live API requires `client_name` and refuses the create without it (Symptom; evidence 3). →
3. Setup stops at the admin client. Behind it were two more defects of the same origin, each proven by evidence 2, 4 and 5: the optional scopes would have been refused (code 70748), and `ensureOAuthClients` filtered the list by `c.name`, which the live list does not have, so a re-run after a part-done setup would never have found its clients (it would have made new ones next to the old).

## Alternatives ruled out

- **A missing permission**: the token holds OAuth Client Write (setup's own check said "has every permission"), and probe 2 created a client with the same token.
- **A body format problem (encoding, content type)**: probe 2 used the same `api` shape (JSON body) and succeeded; the error names the one missing field.
- **`visibility` must be sent**: probe 2 did not send it and got `private`, as the reference says.

## Proposed fix

`clientBody` sends `client_name` and lists the optional scopes in `scopes` too (`[...REQUIRED_SCOPES, ...optional]`); `ensureOAuthClients` finds clients by `client_name`. The fake answers as the live API: it lists `client_name`, refuses a body without it (70705) and an optional scope not in `scopes` (70748). The comment's *unverified* paragraph becomes the verified facts.

## Verification plan

- Red: with the fake changed and the unit test's expected bodies changed, `oauth-clients.unit.test.ts` failed 9 of 15 with the live error (70705). Green after the fix: 15 of 15; `provision/cloudflare` and `cli` unit tests 554 of 554; the whole unit suite 2969 of 2969.
- Integration: `tests/compliance/criteria/setup` (SETUP-AC-005's scope check now reads the required scopes as `scopes` minus `optional_scopes`, and checks `client_name`), `admin-app`, `git-warnings`, `tests/skill/cloudflare-setup.test.ts`: 60 of 60. E2E-017: 6 of 6.
- Live: the same run again created both clients and finished (exit 0); a second run changed nothing; a test stage deployed, passed `smoke` (4 of 4) and was removed; the admin app's sign-in redirects to Cloudflare's authorize page with the new admin client's ID, and Cloudflare answers with its login page (the client is accepted).

## Review

Verdict: accepted-with-changes (2026-11-27; the change: the fake's list and create answer, below). Reviewer: a root-cause reviewer subagent that neither diagnosed nor fixed this failure (testing-standards rule 1).

The diagnoser was also the fixer (one subagent, which may not start others); this review is the independent check.

**Diagnosis: confirmed.** Each link of the causal chain was checked against a source other than the record:
- **Cloudflare's API reference** (developers.cloudflare.com, IAM → OAuth clients, "Create" and "List", read 2026-11-27): the create body requires `client_name`, `grant_types`, `redirect_uris`, `response_types`, `scopes` and `token_endpoint_auth_method`; `optional_scopes` is optional, "each value must also appear in `scopes`", and `openid`/`offline_access` are added or removed from `scopes` by `response_types`/`grant_types`. There is no `name` field anywhere; the list's items carry `client_name`. This matches evidence 3 and all three defects of the causal chain.
- **A read-only live list** (`GET …/oauth_clients?per_page=100` with the token in `~/.secrets/cloudflare`; no write): the two clients the fixed run made are listed as `client_name` `prototype-framework-admin` and `prototype-framework-sign-in`, `visibility: "private"`, `token_endpoint_auth_method: "client_secret_post"`, `response_types ["code","id_token"]`; the admin client's `scopes` are the two required, the six optional and `openid`, its `optional_scopes` the six; the sign-in client has `scopes` the two plus `openid` and no `optional_scopes` key at all. So the fixed body is what the live API stores.
- **The alternatives** ruled out are ruled out by probe 2 (same token, same transport, success) and by the docs (`visibility` is not a body field).

**Fix: correct and complete for the defects found.** `clientBody` and the list filter now use the documented names; the comment's *unverified* paragraph is replaced by facts the probes and the list show.

**The tests fail on the old code** (mutation runs, `oauth-clients.unit.test.ts`, 15 tests):
- the whole pre-fix `oauth-clients.ts`: 9 of 15 fail (the record's red run, reproduced);
- only the list filter reverted to `name`: 4 fail (run again, replacement, review A, review B);
- only the optional scopes left out of `scopes`: 8 fail (the body test and every create, the fake's code 70748).
`tests/compliance/criteria/setup/cloudflare-setup.test.ts` (SETUP-AC-005) now checks `client_name` and that the optional scopes are in `scopes`.

**The fake against the live API.** The three behaviours the record names (the name field, codes 70705 and 70748) match. Gaps found and fixed in this review (`fake-cloud.test-support.ts`): the list and the create answer now show the client as the live API does, with its body's fields, `openid` added to `scopes` when `response_types` holds `id_token`, `optional_scopes` left out when empty, and an empty `result_info` on the list (live answers `{}`). Still not modelled, and acceptable because setup never sends them: refusal of other missing required fields, of unknown scope names and of `openid` as an optional scope.

**For the owner (not caused by this fix):** the live list answers `result_info: {}`, and the reference documents no `per_page` parameter for the list (its example shows `per_page: 20`). So `ensureOAuthClients`'s one-page guard (`total_count > list.length`) never fires live. If the API ignores `per_page` and pages at 20, an account with more than 20 OAuth clients could hide a framework client on page 2, and setup would make a second one. This could not be checked read-only on an account with 3 clients.

**Re-run by the reviewer** (official Node 22.22.1): the unit suite 2970 of 2970; `criteria/setup`, `criteria/prov/preflight-fake`, `skill/cloudflare-setup` and the other `tests/skill` files pass except two unrelated to this change: SKILL-AC-001's router size (`skill/SKILL.md` is 8,098 bytes, over PAR-070's 8,000, already at `0368d86d`) and SKILL-AC-004 (Chromium is not installed on this machine); `test/integration/admin-app` 9 of 9 (mock-oauth2-server from its Docker image); E2E-017 6 of 6; typecheck and lint pass.
