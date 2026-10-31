# Root cause: a membership change does not reach an existing session at its role refresh, because the auth app's `role(sub)` answers the role stored at the person's last sign-in

Status: reviewed (accepted-with-changes)

Item T2, branch `v0.2.0/80-e2e-signin`. Diagnosed 2026-10-31 by the item's implementer. This run has no in-process subagent tool, so no separate diagnoser was available (disclosed). The review is by an independent cloud session.

## Symptom

`npx playwright test --project=e2e-api E2E-007-E2E-018 --grep "role from membership"` (the first, combined version of the test; log `scratchpad/runs/refresh.log`). After the role-refresh interval (PAR-425, 5 min) plus 15 s:

```
expect(await people.promoted.me()).toMatchObject({ level: "admin" })   // line 214
- "level": "admin"
+ "level": "user"
```

In the same run, the outage at the refresh ended its session as expected (`role refresh failed (unknown); session ended`). So the refresh itself ran.

## Evidence

1. **Probe** (a temporary spec, not committed; its output is quoted verbatim below). Three members sign in as `user`. Then A and C are given an administrator role and B is removed from the account, all in the fake memberships API. A signs in once more in a second browser. After 5 min 15 s:
   - A's second, fresh session: `admin`;
   - A's first session, before the refresh: `user`; after it: `admin`;
   - C's session after the refresh (promoted, no new sign-in): `user`;
   - B's session after the refresh (removed from the account): `user`.
   ```
   a2 fresh sign-in after promote: {"level":"admin","id":"u_NRWWZBU3WSDV5YKR6MTIIJOYAZ","displayName":null}
   a1 before refresh: {"level":"user","id":"u_NRWWZBU3WSDV5YKR6MTIIJOYAZ","displayName":null}
   a1 after refresh (a signed in again meanwhile): {"level":"admin","id":"u_NRWWZBU3WSDV5YKR6MTIIJOYAZ","displayName":null}
   c1 after refresh (promoted, no new sign-in): {"level":"user","id":"u_DCXRSUKP3IAWPS2B6VG4YXJ7P7","displayName":null}
   b1 after refresh (removed from the account): {"level":"user","id":"u_YCIRU2RCCV7GQ62JXEUKNW2GVH","displayName":null}
   ```
   The committed outcome test (`E2E-007-E2E-018-signin.spec.ts`, last test) then failed all six soft assertions in its run: promoted still `user` with the admin route refused, demoted still `admin` with the admin route allowed, and removed still `user` with the user route allowed. So the demote is observed as well.
2. **Code:** `auth-app/service.ts` `role(sub)` returns `getRole(db, sub)`. `store.ts` `getRole` is `SELECT role FROM users WHERE sub = ?1`. The only writer of `users` is `upsertUser`, called in the sign-in callback (`app.ts` line 114, plan §4.1 step 3.5). The auth app keeps no Cloudflare token (step 3.6 revokes them), so `role(sub)` has no way to read `/memberships` again. No code deletes a `users` row, not even when a sign-in is refused.
3. **Intent:**
   - SYS-REQ-018 as amended (DEC-0690, owner-approved): "A role change in the Cloudflare account MUST take effect at the app's next role refresh or session renewal".
   - plan-v0.2.0 §4.1 step 5: "A removed member keeps any existing session only until it next renews".
   - `docs/components/auth.md` §2 (the role refresh): "A removed member keeps a session only until its next refresh", and "a role change … takes effect at the person's next sign-in or role refresh".
   - plan §4.1 step 5 also says "The auth app's record is refreshed at each sign-in", which is what the code does.

## Causal chain

1. The auth app learns a person's role only at sign-in, while it holds their token, and stores it (evidence 2).
2. `role(sub)`, which every app calls at a role refresh, returns that stored role and nothing newer (evidence 2).
3. So a change in the account reaches a session only after the same person signs in again somewhere, which updates the stored role, and then that session's next refresh (evidence 1, A). Without a new sign-in, a promote or a demote never shows (evidence 1, C). A removed member, who can no longer sign in, keeps their stored role at every refresh until their session expires (evidence 1, B).
4. That breaks SYS-REQ-018 as amended and auth.md's removal rule (evidence 3). Plan §4.1 has the same tension: "refreshed at each sign-in" and "only until it next renews" cannot both hold without a second source of membership.

## Alternatives ruled out

- **The refresh not running:** the outage session in the same window ended at its refresh. In the probe, A's first session changed level at the refresh once A's record changed.
- **The test's timing:** 5 min 15 s is past PAR-425 (5 min); the session's `checkedAt` was earlier than the change.
- **The fake memberships API not changing:** A's fresh sign-in after the change got `admin`, so the fake answered the new role.

## Resolution

2026-10-31: the owner chose option (b) with a shorter session (owner question 56, option a; DEC-0791, with DEC-0703's wording). A role change or removal takes effect at the person's next sign-in, an existing session keeps its role until it expires or the person signs in again, and PAR-250 is 12 hours. E2E-007's scenario and its outcome test now state and assert that rule (`behaviour-changed`), and the test is green. No auth-app code changes.

## Proposed fix

This is a design gap between the owner-approved requirement and the auth app's design, not a coding slip. It needs a decision before code. The options, for the orchestrator to put to the owner, or to A's successor as a T7 item:
- (a) **Make `role(sub)` current:** the auth app re-reads the person's membership when asked. It needs a credential that can list the account's members (for example an account token with Account Settings Read, kept in Secrets Store). That is a new credential and new setup, and against "keeping no Cloudflare tokens" for users' own tokens it is a different kind of token.
- (b) **Change the requirement:** a change takes effect at the person's next sign-in, and existing sessions keep their role until they expire. A removed member's sessions then last up to the session lifetime (PAR-250, 7 days). This weakens SYS-REQ-018 as amended and needs the owner (origin `owner-approved`).
- (c) **Bound the damage now:** shorten the session lifetime, or have `role(sub)` return `null` once the stored record is older than a maximum age, so a removed member is signed out at the first refresh after that age. People then sign in again periodically. This is a middle ground needing a PAR and a decision.

T2 changes no code (outside its paths; a design decision). The E2E-007 outcome test stays and is red until a decision and its fix land (DEC-0766). E2E-007's scenario text follows the owner-approved requirement and is not weakened.

## Similar cases (for the fixer, §7a.1.8 step 4)

AUTH-AC-003, AUTH-AC-012 and the stub's `grantRole` change the fake's or the stub's record directly, so they pass while hiding this gap: none of them changes the account and then waits for the auth app to notice. The fix's similar-case tests belong with them.

## Verification plan

- Red now: `[E2E-007] at the role refresh: the promoted member is admin, the demoted one user, and the removed one's session ends` fails all six soft assertions. Seen in the probe for promote and removal. The demote follows from the same stored role.
- Green after the fix: the same test passes, through `npm run compliance -- --target local --only E2E-007`.

## Review

Reviewer: independent cloud session `session_014mWQ6hK62oLK9sD5DbsAuY` (found neither cause, wrote none of the code), 2026-10-31.
Verdict: `accepted-with-changes`.
- Links 1 and 2 are proven by the code: the only writer of `users` is `upsertUser` (`app.ts` line 114), a refused sign-in throws before it, and `role(sub)` is `SELECT role FROM users`. Link 3's probe evidence fits. Link 4 checked against SYS-REQ-018 as amended: "MUST take effect at the app's next role refresh" cannot hold if the refresh reads a record only a sign-in updates. The alternatives are ruled out with evidence.
- "Design gap → owner decision, test stays red, scenario not weakened" is right.
- **minor:** add a Status line (done); quote the probe's output (done) and show the demote (done, from the committed test's run); list the similar cases (done); have the orchestrator confirm that a deliberately red local test, failing every compliance run until the owner decides, is intended rather than a not-run rule citing DEC-0766 (in the PR body and the report).
