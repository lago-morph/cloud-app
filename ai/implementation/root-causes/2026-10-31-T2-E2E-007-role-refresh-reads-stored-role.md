# Root cause: a membership change does not reach an existing session at its role refresh, because the auth app's `role(sub)` answers the role stored at the person's last sign-in

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

1. **Probe** (a temporary spec, not committed; log `scratchpad/runs/probe.log`). Three members sign in as `user`. Then A and C are given an administrator role and B is removed from the account, all in the fake memberships API. A signs in once more in a second browser. After 5 min 15 s:
   - A's second, fresh session: `admin`;
   - A's first session, before the refresh: `user`; after it: `admin`;
   - C's session after the refresh (promoted, no new sign-in): `user`;
   - B's session after the refresh (removed from the account): `user`.
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

## Proposed fix

This is a design gap between the owner-approved requirement and the auth app's design, not a coding slip. It needs a decision before code. The options, for the orchestrator to put to the owner, or to A's successor as a T7 item:
- (a) **Make `role(sub)` current:** the auth app re-reads the person's membership when asked. It needs a credential that can list the account's members (for example an account token with Account Settings Read, kept in Secrets Store). That is a new credential and new setup, and against "keeping no Cloudflare tokens" for users' own tokens it is a different kind of token.
- (b) **Change the requirement:** a change takes effect at the person's next sign-in, and existing sessions keep their role until they expire. A removed member's sessions then last up to the session lifetime (PAR-250, 7 days). This weakens SYS-REQ-018 as amended and needs the owner (origin `owner-approved`).
- (c) **Bound the damage now:** shorten the session lifetime, or have `role(sub)` return `null` once the stored record is older than a maximum age, so a removed member is signed out at the first refresh after that age. People then sign in again periodically. This is a middle ground needing a PAR and a decision.

T2 changes no code (outside its paths; a design decision). The E2E-007 outcome test stays and is red until a decision and its fix land (DEC-0766). E2E-007's scenario text follows the owner-approved requirement and is not weakened.

## Verification plan

- Red now: `[E2E-007] at the role refresh: the promoted member is admin, the demoted one user, and the removed one's session ends` fails all six soft assertions. Seen in the probe for promote and removal. The demote follows from the same stored role.
- Green after the fix: the same test passes, through `npm run compliance -- --target local --only E2E-007`.

## Review

(pending: independent root-cause reviewer)
