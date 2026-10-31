# Root cause: after C 34a merges into E's 57z, 13 `cloudflare-setup` unit tests and 14 SETUP criteria fail with "failed the quick check for "Secrets Store Read" (HTTP 403)". The fake setup world requires "Secrets Store Write" for every Secrets Store request, reads included.

Author: item C (diagnosis, §7a.1.8 step 1), 2026-10-31. The diagnoser is C's 34a implementer: subagents here cannot start another subagent, so the independent review below is a fresh cloud session. Found on a local merge of `origin/v0.2.0/34a-remove-email-files` (`873eb3c`) into `origin/v0.2.0/57z-everyday-switch` (`0d7e6ee`); merge commit `a45d441`, not pushed.

## Symptom
With `CLOUDFLARE_*` unset, on the merge:
- `npx vitest run --config vitest.unit.config.ts`: 13 failed, 2695 passed, all in `packages/framework/src/cli/commands/cloudflare-setup.unit.test.ts`.
- `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/setup`: 14 failed, 29 passed, all in `cloudflare-setup.test.ts`. They are SETUP-AC-002 ×2, -007, -008 ×5 and -009 ×6.
Build, typecheck, lint and `permission-tables --check` are clean. On 34a alone (`873eb3c`), unit is 2708/2708 and setup criteria are 43/43.

## Evidence
1. Each failing run that reaches the everyday path prints `This needs the admin app:` followed by `- CLOUDFLARE_API_TOKEN failed the quick check for "Secrets Store Read" (HTTP 403)`, and exits 1 where the test expects 0. This was seen in the unit test "everything valid and current", with the output printed through a temporary `expect(status, io.out + io.err)`, which was reverted afterwards, and in the criteria log's AssertionErrors.
2. 57z (`753d4fd`) makes `EVERYDAY` equal `EVERYDAY_V2`: Workers Scripts Write, Workers R2 Storage Write, D1 Write and Secrets Store Read. It also makes `probeEveryday` read `GET /accounts/<a>/secrets_store/stores?per_page=1` for Secrets Store Read (`permissions.ts`, `reads[GROUPS.secretsStoreRead.id]`).
3. The fake world's everyday token gets `dashboardPolicies(EVERYDAY, account)` (`setup-world.test-support.ts:88`), so it holds Secrets Store Read and no Secrets Store Write.
4. `setup-world.test-support.ts:165–172` makes every request under `/secrets_store` need "Secrets Store Write", whatever the method: `const bootstrapNeeds = … rest.startsWith("/secrets_store") ? "Secrets Store Write" : …`. A GET with only Secrets Store Read therefore answers `UNAUTHORIZED` (403).
5. **Experiment** (then reverted): let a `GET` of `/secrets_store/stores` (the list, with or without a query) pass with "Secrets Store Read" (`/^\/secrets_store\/stores\/?(\?|$)/`). With it, `cloudflare-setup.unit.test.ts` passes 59/59 and `criteria/setup` passes 43/43 on the merge.
6. **The live API and the other fakes agree that listing stores is a read.**
   - Plan §2.1b names "Secrets Store Read" and "Secrets Store Write" as the only two groups.
   - E's admin-app fake (`admin-app/fake-cloudflare.test-support.ts:40`) maps a Secrets Store GET to `secrets-store.read` and a write to `secrets-store.write`.
   - `permissions.ts` `IMPLIED` lists Secrets Store Write as also satisfying Secrets Store Read, so Read is the narrower group.
7. Before 57z the everyday token never read Secrets Store. 57z's own commit message records that 22 unit tests and 21 setup criteria fail "until C's 34a removes that lookup". 34a removes the zone lookup. The Secrets Store part of those failures stays, and it comes from the fake.

## Causal chain
1. 57z adds Secrets Store Read to the everyday set, and with it a store-list read to the quick check (evidence 2).
2. The fake setup world, written for the bootstrap token when only that token touched Secrets Store, requires Write for every Secrets Store request (evidence 4).
3. The fake everyday token holds Read only (evidence 3), so its quick-check read answers 403. `cloudflare-setup` correctly reports a failed quick check and stops (evidence 1).
4. The tests expect a passing check, so they fail. Allowing the list read with Read alone makes all of them pass (evidence 5).

## Alternatives ruled out
- *34a's code is wrong.* On 34a alone every test passes, and the reported failure is the quick check of a group that 34a neither added nor reads. The command's report is correct for the 403 it got.
- *57z's probe reads the wrong endpoint.* The store list is the documented read (§2.1a table: "List Secrets Store stores" with the user's token), and E's fake treats it as a read (evidence 6).
- *The fake token lacks the group.* It holds every `EVERYDAY` group (evidence 3). The refusal comes from the fake's path rule, not from the token.

## Proposed fix
- **Where:** `setup-world.test-support.ts` (C's file), on 34b, the stack's behaviour-change PR (test support, not a removal).
- **Change:** a `GET` of the store list (`/secrets_store/stores`, with or without a query) needs only "Secrets Store Read". Every other Secrets Store request still needs Write.
  - `has()` goes through `comparePolicies`, which applies `IMPLIED`, so a token with Write still passes the list read.
  - The fake's `g()` resolves group names from `EVERYDAY` and `BOOTSTRAP` only. On 34b, before 57z, Secrets Store Read is only in `EVERYDAY_V2`, so `g()` must also search `EVERYDAY_V2`.
- **Red–green:** a new unit test `setup-world.unit.test.ts`. A token holding only Secrets Store Read gets 200 on the list and 403 on a store create (`POST`) and on a secret write. It fails on 34b before the fix.
- **Then:** merge 34b → 34a → 57z again.

## Similar cases (§7a.1.8 step 4)
To do after review: the other request rules of the same fake (`reads`, `bootstrapNeeds`) for any read that requires a write group, and `fake-cloud.test-support.ts` `everydayApi`.

## Verification plan
- On 34b: the new test is red before the fix and green after it, and unit and setup criteria stay green.
- On 34a: the same.
- On the 57z merge: unit and `criteria/setup` are fully green, and permission tables are clean.

## Review
Status: awaiting review
