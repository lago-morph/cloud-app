# Root cause: pass 0 F-2. `createBucket` reports every HTTP 409 as "belongs to another account", but Cloudflare's live 409 (code 10004) for an existing bucket says "already exists, and you own it". The code follows DEC-0270's unverified "409 → foreign" reading, and pass 0 disproved that reading.

Author: diagnosing subagent (prompt §8 step 1). I did not write the code under diagnosis, and I did not run pass 0. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: branch `claude/implement-local-cloudflare-diag-pass0`, from `origin/claude/implement-local-cloudflare` `80bfd9b`. Evidence: `validation/cloudflare/pass-0/SUMMARY.md`, check 3; `validation/cloudflare/pass-0/logs/responses.jsonl`, label `c03-create-existing`.

A different subagent must review this record.

## Symptom
DEC-0334 check 3 sent `POST /accounts/<id>/r2/buckets {"name":"prototype-logs"}` after `setup-account` had created `prototype-logs` in this account. The answer was:

```
{"label": "c03-create-existing", "response": {"success": false, "errors": [{"code": 10004, "message": "The bucket you tried to create already exists, and you own it."}]}}
```

That is HTTP 409 (ledger `c03-create-existing POST /accounts/ACCT/r2/buckets -> 409`). The framework would turn this answer into `R2 bucket prototype-logs already exists but belongs to another account; nothing was created`. That message is false: the account owns the bucket.

## Evidence

### E1: the code maps every 409 to "foreign"
`packages/framework/src/provision/cloudflare/account.ts:42-48`:
```ts
if (r.status === 409) throw new Error(`${name} already exists but belongs to another account; nothing was created`);
```
The file header (`account.ts:11-18`) states the reading: "a creation that conflicts with an existing bucket (HTTP 409) → it exists but this account does not own it". It also states that the readings are "not yet verified against the live API: D-RUN verifies them (DEC-0334)".

### E2: the tests and the fake encode the same unverified reading
- `account.unit.test.ts:67-76`, "a creation conflict means another account holds the name": it stubs `409, 10004, "The bucket you tried to create already exists."` and expects `/another account/`.
- `fake-cloud.test-support.ts:98`: the fake answers 409 10004 "The bucket you tried to create already exists." for a bucket **this same account** created. So the fake already models the live behaviour, 409 for the account's own bucket. Only the message text is shorter than the live one.

### E3: the requirement and the decisions
- PROV-REQ-004 (`docs/components/provisioning.md:35-38`): "`setup-account` MUST create the account's shared resources if they do not exist, and MUST change nothing if they do. … A shared resource counts as existing only if this account owns it; otherwise `setup-account` and `deploy` stop with a clear message." A false "another account" message breaks "clear message", and it stops a run whose end state is already the one required.
- PROV-AC-007 (`provisioning.md:117`) is about a log bucket that "belongs to another account". It is tested through the **inspection** path (GET 403 → foreign, `account.unit.test.ts:86-104`), not through the 409. The fix below leaves it unchanged.
- DEC-0270: "Creation is `POST …` ; HTTP 409 → foreign." Status: "unverified against the live API, verify in D-03/D-RUN". **To verify:** "D-RUN must confirm the 404/403/409 readings".
- DEC-0334 item 1: "R2 bucket names are scoped to an account, so another account's bucket of the same name is invisible rather than refused." So a 409 from this account's create path means the bucket exists **in this account**. Pass 0's answer confirms that: "you own it".

### E4: when the 409 path is reached
`createSharedResources` (`account.ts:86-93`) creates only resources that `inspectBucket` found `absent` (GET 404) in the same run. setup-account in pass 0 was GET 404 → POST 200 ×2 (`SUMMARY.md`, "setup-account"). So the 409 appears only if the bucket appears between the GET and the POST: a concurrent `setup-account`, or a bucket created by hand. In that case the bucket is now owned by this account, and the wrong message is printed.

## Chain from cause to symptom
1. DEC-0270 assumed, offline, that 409 means foreign (E3).
2. `createBucket` implements that assumption for every 409, with no further check (E1). The unit test fixes it in place (E2).
3. Cloudflare answers 409 10004 "already exists, and you own it" for this account's own bucket (pass 0 check 3). A foreign same-name bucket is invisible to this account (DEC-0334 item 1), so it is not what produces this 409.
4. So any 409 that `setup-account` meets would be reported as "belongs to another account", which is false (E4).

## Proposed fix (minimal, red-green)
**Test first (red)**, in `account.unit.test.ts`, replacing the 409 half of the test at lines 67-76:

1. "a creation conflict on a bucket this account owns is not an error: the bucket exists in this account".
   - Stub `POST /accounts/${ACCOUNT}/r2/buckets` → `err(409, 10004, "The bucket you tried to create already exists, and you own it.")`, and `GET ${BUCKET_PATH}` → `ok({ name: LOG_BUCKET })`.
   - Expect `createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }])` to resolve.
   - Expect `api.requests` to equal `[POST …, GET …]`.
   - Against the current code this fails, because it throws `…belongs to another account…`.
2. "a creation conflict that this account cannot read back stops, naming the bucket and both readings".
   - Stub POST → 409 10004, and GET → `err(403, 10002, …)`.
   - Expect rejection matching `/R2 bucket prototype-logs.*another account/`, keeping DEC-0270's foreign wording for the 403 reading.
   - Add a GET → 404 variant (the bucket vanished again) that expects an error naming the bucket and the status, never "created".

**Fix (green)**, in `createBucket` only. On 409, read the bucket back with the existing `inspectBucket`, at the cost of one extra GET that happens only on 409:
```ts
if (r.status === 409) {
  const now = await inspectBucket(api, accountId, bucket);
  if (now.state === "owned") return; // exists in this account: the end state PROV-REQ-004 requires
  if (now.state === "foreign") throw new Error(`${name} already exists but belongs to another account; nothing was created`);
  throw new Error(`creating ${name} failed: ${describeFailure(r)}; reading it back found it absent`);
}
```
A follow-up GET is used, not the 409 message text. The text is not a contract, and the code is 10004 in both the fake and live. The GET reuses DEC-0270's own GET readings (200 owned / 403 foreign / 404 absent).

Accompanying, non-code:
- Update the fake's message (`fake-cloud.test-support.ts:98`) to the live text.
- Amend DEC-0270: "409 → read back: owned → no change; 403 → foreign", citing pass 0 check 3.
- Update the header comment in `account.ts:11-18`.

**Known limit for the reviewer:** in the race case, `setup-account` still prints `created: R2 bucket …` (`core/setup-account.ts:36-38`), although another process created it. The bucket exists and is owned, which is the state PROV-REQ-004 requires. Changing the output wording would widen the operation interface (`createSharedResources` returns `void`), and that is outside this minimal fix.

## How the fix will be verified
- Red: the new test 1 fails on the current `createBucket` with "belongs to another account".
- Green: tests 1 and 2 and the variant pass, and the whole `account.unit.test.ts` passes, including PROV-AC-007 and "setup-account creates the bucket once; a second run sends no change".
- `npm run verify`, as §7 requires.
- Live: no new call needed. Pass 0 check 3 already supplies the 409 body. The GET-200 reading was confirmed by check 1.

## Review

Reviewer: independent root-cause reviewer (prompt §8). I did not write this diagnosis or the code. I made no Cloudflare call and ran no suite. Base `9ed0664`.

**Verdict: accepted with changes.** The fix is minimal and correct in substance, with one wording correction and one test correction.

### Reasons
1. **The cause is confirmed.**
   - `packages/framework/src/provision/cloudflare/account.ts:46` maps every 409 to "belongs to another account", and the header at `account.ts:12-18` records this reading as unverified.
   - Pass 0 `c03-create-existing` returned 409 10004 "…already exists, and you own it." (`logs/responses.jsonl`, ledger `c03`).
   - `docs/decisions/decision-log.md:2630` (DEC-0334 item 1) already says another account's same-name bucket is invisible, so a 409 on this account's path means this account has it.
   - The unit test at `account.unit.test.ts:67-76` and the fake at `fake-cloud.test-support.ts:98` encode the old reading. Nothing else depends on the 409 wording: grepping for "another account" finds only the 403/foreign paths (`core/setup-account.ts:18`, `fake-target.ts:146`, the PROV-AC-007 tests).
2. **The fix is minimal and correct.**
   - The read-back reuses `inspectBucket` (`account.ts:33-40`). It costs one GET, and only on 409.
   - It checks ownership, which is what PROV-REQ-004 says counts as existing (`docs/components/provisioning.md:35-38`). It does not rely on message text.
   - PROV-AC-007 is unaffected, because it goes through the GET 403 path (`account.unit.test.ts:86-104`).
   - If the read-back GET itself errors (5xx), `inspectBucket` throws "checking R2 bucket … failed", which is acceptable.
3. **The foreign message after a 409 + GET 403 is slightly wrong.** DEC-0334 item 1 says a foreign bucket is invisible, so in practice this sequence means "this credential cannot read it". The core's foreign message already says that (`core/setup-account.ts:18`, "or this account's credentials cannot see it"), and so does `account.ts:15`. The proposed `createBucket` text drops the qualifier.
4. **One test is not red, and one must be made red.** Test 2 (409 then GET 403 → `/another account/`) also passes against the current code, which throws "another account" on every 409. That is fine as a guard, but it is not a red test. The GET-404 variant is red only if it asserts that the message does **not** match `/another account/`, and that it names the bucket and `HTTP 409`. "never 'created'" alone passes on the current code, because the current code also throws.
5. **The race printout should not be fixed in this item.**
   - `core/setup-account.ts:36-38` prints `created:` from the input list, because `createSharedResources` returns `void` (`core/operations.ts:106`).
   - Fixing it changes the target-neutral `TargetOperations` interface, which every target and `fake-target.ts` implement, and the `SetupAccountResult.created` contract (`core/setup-account.ts:12-13`).
   - No requirement fixes the output wording (`provisioning.md` PROV-REQ-004 / PROV-AC-004 constrain only the end state and "changes nothing" on a second run). The end state in the race is the required one.
   - It is cosmetic and reachable only by a concurrent `setup-account` or a manual create between GET and POST. Record it as a known limitation and keep it out of this fix.

### Required changes
1. On the 409 → read-back → `foreign` branch, use the core wording: `${name} already exists but belongs to another account (or this account's credentials cannot read it); nothing was created`. Keep the test regex `/R2 bucket prototype-logs.*another account/`.
2. In the GET-404 variant, assert `.rejects.toThrow(/R2 bucket prototype-logs.*HTTP 409/)` and that the message does not match `/another account/`, so the variant is red on the current code. Name test 1 and this variant as the red tests. Test 2 is a guard.
3. In test 1, assert the exact request list ``[`POST /accounts/${ACCOUNT}/r2/buckets {"name":"prototype-logs"}`, `GET ${BUCKET_PATH}`]``, which is `stubApi`'s format (`account.unit.test.ts:19`). Rename the test at `account.unit.test.ts:67` so it no longer says "a creation conflict means another account holds the name".
4. Make the non-code changes the record already lists: the fake's message text, `account.ts:11-18` header, and the DEC-0270 amendment citing pass 0 check 3. The amendment must also record the race printout limitation (reason 5) as known and accepted, not fixed.
