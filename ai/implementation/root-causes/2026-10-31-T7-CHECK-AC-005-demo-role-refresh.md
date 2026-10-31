# Root cause: CHECK-AC-005's demo part fails because the demo's own admin-role test still expects `grantRole`/`revokeRole` to show on the next request. Since B 41a (DEC-0672) they show at the session's next role refresh (PAR-425).

Author: item T7 (diagnosis, plan-v0.2.0 §7a.1.8 step 1), 2026-10-31. Base: `origin/v0.2.0/71n-path-map-after-removals` (PR #134) at `60b5e8e`. Node 22.23.4, Chromium shim per progress §6, local apiKey set on stdin (DEC-0779). I wrote none of the code or tests involved.

## Symptom
In run `hv2yas3d80t67es` (`--only CHECK-AC-005,…`), CHECK-AC-005 is `failed`, 1 of 2 tests:

```
[CHECK-AC-005] demo part: verify passes on a fresh copy of apps/demo (…)
Error: verify on the demo copy exited 1:
  verify: type checking: passed / portability rules: passed / migration checker: passed / zod version: passed
  verify: tests (sqlite)
    FAIL tests/app.test.ts > signed-up users and admins by role (DEMO-REQ-002; DEC-0521, DEC-0522)
         > every signed-up user can post; the admin role, granted and revoked, decides who publishes
         expected 'user' to be 'admin' // Object.is equality
  verify: tests (sqlite): 1 failed (31 passed, 1 failed, 0 skipped)
  verify: tests (postgres): 1 failed (31 passed, 1 failed, 0 skipped)
```

T1's full run on branch 75 (`93eab74`, run `elfokkdfd656tww`) and my full run on `60b5e8e` show the same thing. The same test was also seen red, 2 of 2 runs, by the demo-signing review on PR #153 (`2026-10-31-T7-demo-signing.md`, Review reason 3: "needs its own §7a.1.8 record and item").

## Evidence
1. **The failing assertion.** `apps/demo/tests/app.test.ts:347–349`: `await t.grantRole(bossMe.id, "admin")`, then `/api/auth/me` must answer `level: "admin"` on the very next request. It answers `user`.
2. **The contract changed.** `docs/contracts/ts/testing.d.ts:176–178` (`grantRole`): "A session keeps the level it has until its next role refresh (PAR-425; move `clock` past it), so the change shows then, with no new login (AUTH-REQ-003, DEC-0525, DEC-0672)."
   - `ai/implementation/decisions/v020-B.md` DEC-0672: "Item D's rewritten AUTH criteria apply the role refresh to the stub provider as well (a `grantRole` shows 'at the next role refresh') … Every real-provider session follows DEC-0668/DEC-0669: the level is used for PAR-425, then refreshed."
   - PAR-425 is 300 s. A level is current "up to and including 300 s; at 301 s it is read again" (`v020-B.md:69`, `ROLE_REFRESH_INTERVAL_SECONDS` asserted 300 in `src/auth/role-refresh.unit.test.ts:23`).
3. **B updated the framework's copies of this test, but not the demo's.** `679c3bf` (B, PR 41a) rewrote `packages/framework/test/integration/auth/admin-role.test.ts:20–35` and `src/testing/test-app.unit.test.ts:204–222`. Each now asserts "within PAR-425 the session keeps its level", then calls `clock.advance(REFRESH_DUE_MS)` with `REFRESH_DUE_MS = (ROLE_REFRESH_INTERVAL_SECONDS + 1) * 1000`. `git log -- apps/demo` shows no commit after `18c8086` (release 0.1.1). `apps/demo/tests/app.test.ts` is the 0.1.1 test.
4. **Experiment, the same test with the clock moved.** In a scratch worktree of `60b5e8e`, I changed only `apps/demo/tests/app.test.ts`: after `grantRole`, assert `user` (still within PAR-425), `t.clock.advance(301_000)`, then assert `admin`; and `t.clock.advance(301_000)` after `revokeRole`. Then `npx prototype-framework verify` in `apps/demo`:
   - run 1: tests (sqlite) 32 passed, 0 failed. The postgres step crashed (`[vitest-pool]: Worker forks emitted error`, the test file skipped) at 13:49–13:51 UTC. The kernel log shows cgroup OOM kills of `node` processes in that minute. This is the memory cause recorded for CLI-AC-008 (`2026-10-31-T7-CLI-AC-008-oom-kill-shared-cgroup.md`), not this test.
   - run 2 (exit 0): tests (sqlite) **32 passed**, tests (postgres) **32 passed**.
   - run 3 (exit 0, after also asserting that a fresh `loginWithStub("boss")` after the grant answers `admin` at once): **32 passed** on sqlite and on postgres.

   The role is granted and revoked as the test intends, once the refresh is due, and a new sign-in confirms the recorded role at once.
5. **"Next sign-in" vs "next refresh" (the orchestrator's DEC-0703 framing).** DEC-0703 (proposed in #151) says a role change in the Cloudflare dashboard takes effect at the person's next sign-in. That is because the real auth app writes its `users` record only at sign-in, and a refresh reads that record. In tests, the stub's in-memory account (or the fake auth app's record, `setRole`) **is** the recorded role. `grantRole` changes that record directly, so a refresh picks it up. DEC-0703's "Not changed" bullet keeps the `testing.d.ts` comments for this reason. So both rules hold for the demo test:
   - a new sign-in shows the recorded role at once;
   - an existing session shows it at its next refresh (PAR-425).

   The fixed test asserts both.
6. **Covered by a pending PR?** No. No `origin/v0.2.0/*` branch changes `apps/demo/tests/app.test.ts` (no branch's copy contains `advance`). The open PRs on 71n (#136, #138, #140, #141, #143, #145–#153) leave `apps/demo/` alone, except #153, which changes `apps/demo/src/server/signing.ts` and its tests only. #151 (39c, role-change wording, DEC-0703) keeps the at-refresh semantics for `grantRole` ("the `testing.d.ts` … comments describe the fake auth app's record changing, which a refresh does pick up, so they stay").

## Causal chain
1. B 41a moved every real-provider session, the stub's included, to a level confirmed at sign-in and re-read only after PAR-425 (DEC-0672; evidence 2).
2. B updated the framework's own grant/revoke tests to move the clock, but not the demo app's copy, which is outside `packages/framework` (evidence 3).
3. The demo test asks `/api/auth/me` right after `grantRole`, within PAR-425, so the session still says `user` (evidence 1).
4. The demo's `verify` therefore fails its tests step on both databases, and CHECK-AC-005's demo part, which runs `verify` on a fresh copy, fails (Symptom). With the clock moved past PAR-425, the same test passes on both (evidence 4).

## Alternatives ruled out
- **A defect in the role refresh or in `grantRole`.** No. The framework's grant/revoke tests (AUTH-AC-003, AUTH-AC-015) pass in the same runs. The demo test passes once the refresh is due (evidence 4). The behaviour matches the contract (evidence 2).
- **Retire or skip the demo test.** No. DEMO-REQ-002 (who may publish) is unchanged, and so is the test's purpose: grant makes a user an admin who may publish, and revoke takes it back. Only the moment the change shows moved.
- **Load or environment.** No for this failure: it fails on sqlite and postgres alike, deterministically, with an assertion, not a crash. The one postgres worker crash in evidence 4 is the separate memory cause, and run 2 is clean.
- **Owner.** `apps/demo` has had no owner item in v0.2.0. The miss is B 41a's: its TS-9 test impact should have listed the demo's copy. Plan §7a.1.10 says the implementer changes affected tests in the same work. T7 fixes it here because no pending PR covers it.

## Proposed fix
Branch `v0.2.0/98-fix-demo-role-refresh` on 71n, test only (`behaviour-changed`, DEC-0672). In `apps/demo/tests/app.test.ts`, the admin-role test now does what the framework's tests do:
- after `grantRole`, assert the session is still `user` within PAR-425;
- move `t.clock` past PAR-425 (`301_000` ms, a named constant citing PAR-425, because the demo imports only the public package and `ROLE_REFRESH_INTERVAL_SECONDS` is internal), then assert `admin` and that publishing succeeds;
- after the second `loginWithStub("boss")`, assert `admin` at once: a new sign-in confirms the recorded role (DEC-0672: the stub returns its account's roles at sign-in; consistent with DEC-0703, proposed in #151, pending owner approval of wording);
- after `revokeRole`, move the clock again, then assert `user`.

Every original assertion stays, and two are added. The `describe` title cites DEC-0672. #153 changes only `signing.ts` and `signing.test.ts`, so this fix is based on 71n, not on #153. Test-change record: `ai/implementation/test-reviews/2026-10-31-T7-98.md`.

## Similar cases (§7a.1.8 step 4)
- **Other copies of the grant/revoke pattern outside the framework.** `grep -rn 'grantRole\|revokeRole' apps tests skill packages/create-prototype-app` finds `apps/demo/tests/app.test.ts`, and two skill pages. `skill/reference/current-user.md:55` still describes the 0.1.x rule ("the next request sees the new level", with `passwordLoginProvider`). `configuration.md:50` mentions the reserved `admins` key. G's branches 64–69 (PR #128 onward) already rewrite `current-user.md:55` to `authAppLoginProvider`/`authApp.setRole` plus the next refresh, so that is covered there. The template and reference apps do not call `grantRole`/`revokeRole`. The compliance criteria for AUTH-AC-003/015 are T1's (PRs #131/#132) and already use the clock.
- **Other 0.1.1-era demo files naming removed features.** `apps/demo/package.json` still has the scripts `check-login`, `mail` and `admins`, and the commands behind `mail` and `admins` are removed (plan §6). That is not this failure: `verify` does not run them, and CHECK-AC-005 passes with them present. It is listed as open for C 34a / D (removed-feature cleanup in apps), not fixed here.

## Verification plan
- Red: on `60b5e8e`, `npm run compliance -- --target local --only CHECK-AC-005` fails the demo part with `expected 'user' to be 'admin'` (run `hv2yas3d80t67es`).
- Green: on the fix branch, `npx prototype-framework verify` in `apps/demo` gives 32 passed on sqlite and on postgres, and `npm run compliance -- --target local --only CHECK-AC-005` passes both tests.
- Once-green change: reviewed per §7a.1.9 in the test-change record.

## Review
Reviewer: independent root-cause reviewer, session_014mWQ6hjtYXfjcSWXUEWwEy, 2026-10-31
Verdict: accepted-with-changes

Reasons:
- **minor** The causal chain holds. `testing.d.ts` (`grantRole`) says "A session keeps the level it has until its next role refresh (PAR-425; move `clock` past it)". DEC-0672 (v020-B.md:43, accepted) applies the refresh to the stub and says "The stub returns its account's roles at sign-in". `679c3bf` changed `admin-role.test.ts` and `test-app.unit.test.ts`, and `apps/demo` has no commit after `18c8086`. A boundary experiment confirms that the PAR-425 refresh is the cause, and that `grantRole` itself works: with the demo test changed to advance 300_000 ms, the `admin` assertion still fails (`expected 'user' to be 'admin'`); with 301_000 ms it passes.
- **minor** The DEC-0703 framing is correct. DEC-0703 (on `39c-role-change-wording`, status pending owner approval of wording) concerns the real auth app, which records a role only at sign-in. Its "Not changed" bullet keeps the `testing.d.ts` comments because a refresh does pick up the fake's or the stub's record. So both rules hold for test apps. Because DEC-0703 is pending, the "new sign-in confirms the recorded role" assertion should rest on DEC-0672 (the stub returns its roles at sign-in). Cite DEC-0703 only as proposed, in the test comment and in the record.
- **minor** The Similar cases grep claim is wrong. `grep grantRole|revokeRole` over `skill` also matches `skill/reference/current-user.md:55` ("the next request sees the new level", the 0.1.x rule, with `passwordLoginProvider`) and `configuration.md:50`. G's branches 64–69 already rewrite `current-user.md:55` to `authApp.setRole` plus the next refresh, so this is covered. Record that rather than "finds only apps/demo".
- **minor** Evidence is numbered 1, 2, 3, 4, 6, 5. Renumber it.

Re-run:
- Red, on `60b5e8e`: `npx vitest run tests/app.test.ts -t "admin role"` in `apps/demo` gives 1 failed, `expected 'user' to be 'admin'`.
- Green, with fix 98 applied as briefed: the same test passes. Compliance run `he319fk0u13979l` records CHECK-AC-005 as passed, including the demo part (`demo-local.spec.ts`, verify on a fresh copy, 1 passed).
- Experiment: `ROLE_REFRESH_DUE_MS = 300_000` fails and 301_000 passes, which is the PAR-425 boundary ("up to and including 300 s", v020-B.md:69).

## Response (round 1)
All four minors are applied in this record before the fix commit:
- the sign-in assertion rests on DEC-0672, with DEC-0703 cited as proposed (Proposed fix; and the test comment in the fix commit);
- Similar cases names the two skill pages and G's coverage;
- the evidence is renumbered.

My own compliance green with the fix is run `atfwxyjibj7s38q` (`--only CORE-AC-001,CHECK-AC-005` on `60b5e8e` plus fixes 97 and 98): CHECK-AC-005 2 of 2 passed.
