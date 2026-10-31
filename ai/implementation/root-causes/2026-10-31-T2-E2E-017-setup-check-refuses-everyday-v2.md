# Root cause: `cloudflare-setup` refuses the everyday token the admin app makes, because its check still expects the 0.1.x set and the email domain's zone

Item T2, branch `v0.2.0/79-e2e-setup` (on `v0.2.0/78-e2e-scope`). Diagnosed 2026-10-31 by the item's implementer: this run has no in-process subagent tool, so no separate diagnoser was available (disclosed). The review is by an independent cloud session.

## Symptom

`npx playwright test --project=e2e-api E2E-017`: 7 passed, 1 failed. The failing test is `[E2E-017] continue setup: cloudflare-setup with the everyday token the admin app made finds the account set up, and changes nothing`. It exits 1:

```
CLOUDFLARE_API_TOKEN (the everyday token): it could not list the account's domains (HTTP 403: Unauthorized to access requested resource (code 9109)); it needs "Zone Read".
Replace it with a new token from this link:
  https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=…2d5b4b1f…c8fed203…9c88f9c5…1b600d9d…&name=prototype-framework
```

## Evidence

1. In the same run, the everyday token test passes. Page 2 made the token with exactly the four groups of plan §5.2 (`e086da7e…`, `bf7481a1…`, `09b2857d…`, `5e33b7d7…`), written out in the test rather than imported.
2. `permissions.ts` has two sets. `EVERYDAY` has seven groups: Workers Scripts Write, R2 Storage Write, D1 Write, Email Sending Read, Zone Read, Analytics Read and Email Routing Rules Read. `EVERYDAY_V2` has the four. Page 2 uses `EVERYDAY_V2` (`everyday-token.ts`, `SET = EVERYDAY_V2`). `cloudflare-setup` uses `probeEveryday` and `deepLink("everyday")`, both on `EVERYDAY`, and imports `zoneCandidates` from `email.ts` (`cloudflare-setup.ts` lines 53 and 56).
3. Without a bootstrap token, `cloudflare-setup` reaches step 5, the email domain. It lists the account's zones with the everyday token, and a four-group token gets 403 code 9109 for that (the fake answers as live, `SetupWorld.apiFor`: `/zones` needs Zone Read).
4. DEC-0716 (`ai/implementation/decisions/v020-E.md`) records this exact gap, decided by E. It says that "a token made by page 2 would fail that check". `EVERYDAY` and the quick check move to the four groups in `57z-everyday-switch`, after C's 34a removes the email-domain lookup. DEC-0716 calls 57z "a hard release blocker".

## Causal chain

1. Plan §5.2 page 2 makes the everyday token with four groups and no zone group (evidence 1, and 2 for `EVERYDAY_V2`).
2. `cloudflare-setup`, which runs at "continue prototype setup" (plan §5.3 step 4), still asks the everyday token for the email domain's zones (evidence 2, 3). That needs Zone Read, which the four-group token lacks.
3. So the check refuses the token and links the 0.1.x seven-group token (evidence 2: its link holds the zone and email groups). This is the open switch of DEC-0716 (evidence 4). The other tests had not chained page 2 into the CLI check before, so E2E-017 is the first test to show it.

## Alternatives ruled out

- **The edge or the fake account answering wrongly:** the 403 is the live answer for `/zones` without Zone Read. The bootstrap and account-setup steps on the same world pass.
- **The test misreading the token:** the token's groups are asserted in the test before this one, and the failing run prints the zone-lookup refusal, not a verify failure.

## Proposed fix

There is no new fix. The existing plan of DEC-0716 applies: C's 34a removes the email-domain lookup from `cloudflare-setup`, and `57z-everyday-switch` moves `EVERYDAY`, `probeEveryday`, the deep link and the generated tables to the four groups. Both are outside T2's paths and already assigned, so T2 changes no code. The E2E-017 test stays as it is and fails until 57z lands. It then becomes 57z's acceptance check at the e2e layer (DEC-0763).

## Verification plan

- Red now, as above.
- Green after 57z: `npx playwright test --project=e2e-api E2E-017` gives 8 passed, and so does `npm run compliance -- --target local --only E2E-017`.

## Review

(pending: independent root-cause reviewer)
