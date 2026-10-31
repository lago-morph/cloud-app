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
6. **The plan and the other fakes treat listing stores as a read.** This is the plan's design assumption (§5.2: "Secrets Store Read … checking that they exist during the setup check"), *not verified live*: §2.1a listed stores with a sign-in user token, and §2.1b with the bootstrap set, which holds Write.
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
- *57z's probe reads the wrong endpoint.* By the plan's design (§5.2), listing stores is what Secrets Store Read is for, and E's fake treats it as a read (evidence 6). This is an assumption, not verified live (Response round 1).
- *The fake token lacks the group.* It holds every `EVERYDAY` group (evidence 3). The refusal comes from the fake's path rule, not from the token.

## Proposed fix
- **Where:** `setup-world.test-support.ts` (C's file), on 34b, the stack's behaviour-change PR (test support, not a removal).
- **Change (as amended by Response round 1):** a `GET` under `/secrets_store` needs "Secrets Store Read", and every other method needs "Secrets Store Write". `has()` applies `IMPLIED`, so Write also satisfies Read. `groupNamed` also searches `EVERYDAY_V2`.
- **Red–green:** a new unit test, `setup-world.unit.test.ts`, red on 34b before the fix:
  - a token holding only Secrets Store Read gets 200 on the store list and on a store's secrets, and 403 on a store create and on a secret `POST` or `PUT`;
  - a token holding only Secrets Store Write lists the stores.
- **Then:** merge 34b → 34a → 57z again.

## Verification plan
- On 34b: the new test is red before the fix and green after it, and unit and setup criteria stay green.
- On 34a: the same.
- On the 57z merge: unit and `criteria/setup` are fully green, and permission tables are clean.

## Review (round 1)

Reviewer: an independent cloud session that did not write this record (`session_014mWQ6jgCbDDUrS6CFmp5o3`), 2026-10-31. It reproduced the failure on a local merge of 34a into 57z, then removed the merge and its experiments.

**Verdict: accepted-with-changes (binding)**

1. **minor**: The symptom reproduces as recorded: 13 unit and 14 criteria failures, each "Secrets Store Read" (HTTP 403).
2. **minor**: Evidence 3 and 4 check out.
3. **minor**: The record's experiment gives unit 59/59, `criteria/setup` 43/43 and `provision` 395/395. Every link of the chain is supported, and the alternatives are ruled out for the test failures.
4. **major**: Evidence 6 and the second alternative overstate what was verified live.
   - §2.1a listed stores with a sign-in user token; §2.1b with a set that holds Write.
   - Reword both as the plan's design assumption, not verified live.
   - Add it to the §5.2 live verification.
5. **major**: Exempting one endpoint treats the symptom. The fix at the cause is method-based: a `GET` under `/secrets_store` needs Read, and every other method needs Write. This matches E's fake and `IMPLIED`. The reviewer ran it: unit `src` 2313/2313, `criteria/setup` 43/43.
6. **minor**: `rest` is a pathname with no query, so the regex's `(\?|$)` branch does nothing.
7. **minor**: The `g()`/`EVERYDAY_V2` note is correct.
8. **minor**: The red–green test should also cover:
   - Write alone lists the stores (`IMPLIED`);
   - Read alone gets 200 on a GET of a store's secrets and 403 on a `PUT`/`POST` of a secret.

   Show it red on 34b first.
9. **minor**: The step 4 sweep should include production reads of Secrets Store by the everyday token beyond the quick check, such as the deploy-time binding and the secret-existence check.

## Response (round 1)

- **To 4:** accepted. Evidence 6 and the alternative now say the Read-only list is the plan's design assumption (§5.2), not verified live. Adding the live check is not C's to do: the live-pass runbook (`live-pass-v0.2.0.md`) is L's, on branch 00. It goes as an open item for L: "list Secrets Store stores with a token holding only Secrets Store Read (everyday token, 57z)".
- **To 5:** accepted. The fix is method-based:
  - in `setup-world.test-support.ts`, a `GET` under `/secrets_store` needs Secrets Store Read, and any other method needs Secrets Store Write;
  - `IMPLIED` lets Write satisfy Read;
  - the regex goes, which also answers 6.
- **To 7:** `groupNamed` also searches `EVERYDAY_V2`.
- **To 8:** `setup-world.unit.test.ts` covers four cases: Read lists the stores and a store's secrets; Read cannot create a store or `POST`/`PUT` a secret; Write alone lists the stores. It is red on 34b before the fix.
- **To 9:** the step 4 sweep covers it, see below.

## Similar cases (§7a.1.8 step 4)

- **The same fake's other rules (`setup-world.test-support.ts`).**
  - `oauth_clients` needs OAuth Client Write for any method. This is the same pattern, but nothing reaches it today:
    - no token in any list holds "OAuth Client Read", and `permissions.ts` does not list that group;
    - only the bootstrap token, which holds Write, touches clients.

    It is not changed. It is noted so that a later read with Read alone is recognised.
  - `/workers/subdomain` needs Workers Scripts Write, which matches §2.1b ("need only Workers Scripts Write").
  - `reads` for GETs (Workers Scripts, R2, D1) uses the Write groups. These are the only groups those families have in the everyday set, so they are correct.
- **`fake-cloud.test-support.ts` `everydayApi`:** it refuses only token paths and zone writes, and never refuses a Secrets Store read. No case.
- **E's admin-app fake:** already method-based. No case.
- **Production reads by the everyday token beyond the quick check.**
  - `readSigningPlacement` (`r2-token.ts:163`) reads only the signing record (corrected after review round 2).
  - The code that reads a store's secrets is `signingCredentialState` through `storedSecrets` (`r2-token.ts:170–178`), along with `putInSecretsStore`. Both run with the setup page's sign-in token, not the everyday token.
  - Their tests run against `FakeCloud.api` (`fake-cloud.test-support.ts`), which checks no group, so no test hides the same assumption.
  - The live question is the same open item for L.

## Review (round 2)

Reviewer: the same independent cloud session as round 1 (`session_014mWQ6jgCbDDUrS6CFmp5o3`), 2026-10-31. It read the amended record and checked its claims against 57z and 34b. It committed and pushed nothing.

**Verdict: accepted**

1. **major (resolved)**: Round-1 item 4. Evidence 6 and the alternative now call the store list with Read alone the plan's design assumption, not verified live. Handing the live check to L's runbook is acceptable; track it until it is filed.
2. **major (resolved)**: Round-1 item 5. The fix is method-based, matching E's fake. This also settles item 6.
3. **minor**: The planned red test covers item 8. State the observed red result on 34b before the fix is pushed.
4. **minor**: `readSigningPlacement` reads only the signing record. The Secrets Store reads are `storedSecrets` and `putInSecretsStore`, which run with the setup page's sign-in token. Correct the bullet; the conclusion stands.
5. **minor**: The `oauth_clients` note checks out.
6. **minor**: The verification order is fine.

## Fix (attempt 1)

- **Red, on 34b (`7d03868`) before the fix:** `setup-world.unit.test.ts` gave 1 failed and 1 passed. The Read-only case failed on its first assertion: `GET …/secrets_store/stores?per_page=1` answered **403** where 200 was expected. The Write-only case passed (`IMPLIED`).
- **Fix:** in `setup-world.test-support.ts`, a `GET` under `/secrets_store` needs "Secrets Store Read" and any other method needs "Secrets Store Write". `groupNamed` also searches `EVERYDAY_V2`.
- **Green:** reported in the fix commit and the PR. Order: 34b, then 34a, then the 57z merge.
