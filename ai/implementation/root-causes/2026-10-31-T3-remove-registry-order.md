# Root cause: a production `remove` deletes the stage's databases before it clears the stage's entry in the auth app's registry, while DEC-0725 puts the clear before anything is deleted

Author: item T3 (the test author who found it; it also diagnosed, see "Process note"), 2026-10-31. Branch `v0.2.0/96-fix-remove-registry-first`, on T3's `v0.2.0/84-integration-provision` (PR #138), which is on `v0.2.0/71n-path-map-after-removals` (#134, `60b5e8e`).

## Symptom
T3's PROV integration suite has a test "removing the production stage of two backs it up first, clears its registry entry, …" (`packages/framework/test/integration/provision/production.test.ts`). Its ordering assertion fails:

```
AssertionError: the registry entry is cleared before anything is deleted:
… d1 DELETE /accounts/0123…/d1/database/<prod stage database UUID>
… (the registry query comes two lines later)
expected 29 to be less than 27
```

Everything else in that test passes. The backup is complete before any delete, the entry is gone at the end, and no resource is left.

## Evidence
1. **The requirement.** DEC-0725 (`ai/implementation/decisions/v020-F.md`, accepted), "Remove": *"The first step of `removeStage` on a production stage (after the production backup, before anything is deleted), so nobody new signs in to a stage being removed; it also deletes the app's outstanding codes (`unregisterApp`). … A failure is reported with the other removal failures; the rest is still removed."* PROV-REQ-003 and provisioning.md §2 don't order the clear. DEC-0725 is the only text that does.
2. **The event log** of the run (support.ts records every Cloudflare API call in order), from the production `runRemove` on:
   - indexes 0–21: the stop, the backup (`bytes PUT …/prototype-backups/…`, `manifest.json` last) and its re-listing;
   - 22–26: reads (Worker settings, bucket, tokens, state objects, the D1 listing);
   - **27: `d1 DELETE …/d1/database/<uuid>`**, the stage database `reference-prod-db-1`;
   - 28: `GET …/workers/scripts/prototype-auth/settings` (finding the registry);
   - **29–30: `d1 POST …/d1/database/<registry uuid>/query`**, the `unregisterApp` statements;
   - 31 on: the bucket emptied (`DELETE …/objects/…`), the SST removal, the state objects.
3. **The core sequence.** `packages/framework/src/provision/core/remove.ts` `runRemove`:
   - for a production stage, it runs the backup;
   - then it lists the stage's databases and calls `ops.dropDatabase` for each (lines 72–84);
   - only then does it call `ops.removeStage(stage)` (line 87).

   provisioning.md §2 "Implementation" documents the same order: *"then it deletes the databases that match the exact pattern, then calls `removeStage` for everything else"*.
4. **The Cloudflare target.** `packages/framework/src/provision/cloudflare/target.ts` `removeStage` (lines 343–356) starts with `// First, so nobody new signs in …` and calls `if (production(stage)) await attempt(() => authApp.unregister(workerName(stage)))`. The clear is first *within `removeStage`*. But `removeStage` is not the first deleting call of a removal: the core has already deleted the databases (3).
5. **Why no existing test saw it.** F's unit test `cloudflare/lifecycle.unit.test.ts:205–214` does run `runRemove` (corrected after review, reason 2). But it records the auth-app calls and the database calls in two separate arrays, so it never asserts the order between them. The criteria test `criteria/prov/auth-app-fake.test.ts` runs `runRemove` but checks only the end state (`isRegistered` false).

## Causal chain
1. DEC-0725 requires the registry clear before anything of the stage is deleted. Evidence 1.
2. F put the clear at the start of the Cloudflare target's `removeStage`, assuming `removeStage` is where removal starts deleting. Evidence 4: the code comment says "First".
3. The target-neutral core deletes the stage's databases before it calls `removeStage`. Evidence 3: code and provisioning.md §2.
4. So on every production `remove`, the databases are deleted while the stage is still registered. The registry is cleared afterwards. Evidence 2: the event log, indexes 27 vs 29.
5. Only the inside of `removeStage` was tested, so nothing caught the order. Evidence 5.

## Alternatives ruled out
- **The test misreads the log.** Index 27 is a `DELETE` on a D1 UUID different from the registry's (the registry's queries are at 29–30). `runRemove` deletes exactly the stage databases `matchStageDatabases` finds (`<app>-<stage>-db-<n>`). The test stage's database is still there afterwards (`stageDatabases(world, TEST)` is unchanged).
- **The fake reorders calls.** The world's `api` wrapper records synchronously before forwarding each call. `runRemove` awaits each step in sequence, and there is no concurrency in that path.
- **DEC-0725 means "first within `removeStage`" only.** Its wording is "before anything is deleted", and its reason ("nobody new signs in to a stage being removed") applies from the first delete. A stage whose database is gone but which is still registered is the state it rules out. The test stage is not affected, because it has no registry entry (DEC-0725 "Which stages").
- **Impact is nil because the app is stopped first.** A production `remove` stops the app before the backup, so a sign-in cannot complete during the window. The auth app still accepts `/start` for that app and issues codes until the clear, which DEC-0725 also wants gone first. The window also grows when a database delete is slow or fails: a failed delete is recorded, removal goes on, and the registry is cleared later anyway. So the defect is in order only, and minor in effect. But it contradicts an accepted decision, and no test held it.

## Proposed fix
Move the clear out of `removeStage` into a step the core runs before it deletes anything:
- `TargetOperations` (`core/operations.ts`) gains an optional `unregisterStage?(stage): Promise<void>`. It takes the stage out of account-level registrations before anything of it is deleted (Cloudflare: the auth app's registry, DEC-0725).
- `runRemove` calls it right after the production backup (or first, for a test stage), before listing and deleting the databases. A failure is recorded like the other removal failures, and removal continues (DEC-0725's failure rule).
- The Cloudflare target implements `unregisterStage` with the existing production guard (`if (production(stage)) await authApp.unregister(workerName(stage))`). `removeStage` no longer calls it.
- Targets without an auth app (the in-memory `FakeTarget`) leave the hook out.

This fixes the cause (the step sat in the wrong layer) rather than the symptom. The alternative, reordering the core so `removeStage` runs before the database deletes, would contradict provisioning.md §2's documented order and change every target's removal.

## Verification plan
1. **Red.** On this branch, without the fix, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/provision/production.test.ts` fails exactly the ordering assertion. Recorded above.
2. **Green.** With the fix, the whole PROV suite passes. So do F's `cloudflare/lifecycle.unit.test.ts` (updated if it asserts `removeStage` calls `unregister`; a `test-was-wrong` change only if its expectation contradicts DEC-0725), `criteria/prov/auth-app-fake.test.ts` through the harness, and `npm run test:unit`.
3. **Failure rule.** A unit test of `runRemove` with an `unregisterStage` that throws: the failure is reported, the databases and the rest are still removed, and the exit status is 1.

## Similar cases (§7a.1.8 step 4)
Searched after the review, before the fix. The question was where a target hook's "first", "last", "before" or "after" depends on the order in which the core calls it.

- **`deployCode`, registry write** (`target.ts:282`, "before step 6 starts it"). This holds: `runDeploy` calls `startApp` only after `deployCode` returns, as do the after-code abort and the deferred secrets check (`core/deploy.ts`). PR #138's order test checks code < start.
- **`backupStage`, PAR-315 wait** (`target.ts:305`, "after the route was turned off"). This holds: `runRemove` stops the stage (`stopForBackup`) before it calls `backupStage`. `lifecycle.unit.test.ts` "after turning the route off, remove waits PAR-315" checks it.
- **`deployCode`, Worker-secret deletes before the Secrets Store binding** (`target.ts:277`). This happens inside one target call, so the core's order cannot break it.
- **`removeStage`, legacy signing token and SST removal.** Neither carries an order claim against the core's database deletes. PROV §2 orders only "databases, then `removeStage`".
- **`stop-start.ts` and deploy's `stopAgain`.** Each calls one target operation, then writes or clears the record, as provisioning.md §2 says. No hook there claims an order.
- **`setupAccount`, setup record last** (`target.ts:225`). This happens inside one target call.

No other case was found, so no new item is needed.
## Process note
§7a.1.2 wants a separate diagnoser. In this run, the T3 test author found the failure and wrote this record itself; it did not write the code under test. That is disclosed here, as A disclosed for `2026-10-31-A-workerd-fetch-redirect-error`. The review below is by a separate session that wrote neither.

## Review (round 1)
Reviewer: an independent Claude Code remote session, `session_014mWQ6mgT34ZYNMLcZbvCmx`, 2026-10-31, before any fix. It ran `npm ci` and reproduced the failure once: 1 failed and 2 passed, the failure being the ordering assertion (`expected 29 to be less than 27`). It checked each link against `core/remove.ts`, `cloudflare/target.ts` and provisioning.md §2.

**Verdict: accepted-with-changes.**
1. **major**: update the specification in the same fix. In provisioning.md §2 "Implementation", the `remove` bullet must read: backup (production) → `unregisterStage` where the target has it (a failure is recorded and removal goes on) → database deletes → `removeStage`. DEC-0725 says "the first step of `removeStage`", so amend it or add a follow-up decision naming the new hook in `runRemove`, with `core/{operations,remove}.ts` in its Affects line.
2. **minor**: Evidence 5 is factually wrong. `lifecycle.unit.test.ts:205–214` does run `runRemove`. It misses the order because the auth-app calls and the database calls are recorded in separate arrays. Strengthen that test to assert the order across the two recorders (`strengthened`, not `test-was-wrong`).
3. **minor**: the fix shape is right (the step was in the wrong layer). An optional `unregisterStage?` fits. Keep the `production(stage)` guard in the Cloudflare implementation. Check that `withD1` in `d1/deploy-d1.unit.test.ts` forwards it; `FakeTarget` needs no change.
4. **minor**: call the hook only after a successful backup, so a failed backup still leaves the registry alone (`lifecycle.unit.test.ts:216`). Give the failure its own label, e.g. `clearing the stage's sign-in registration`. Keep the assertion that a failed clear still removes the rest and exits 1. Add the core unit test of Verification plan step 3 to `core/remove.unit.test.ts`. The hook is idempotent on a retry.
5. **minor**: for similar cases, also check `stop-start.ts` and deploy's `stopAgain`.

## Response (round 1)
- **1 (major), accepted.** The fix also changes provisioning.md §2 "Implementation". DEC-0725's draft is item F's file, so instead of editing it, the follow-up decision **DEC-0780** (T7's range, as T3's brief says for a fix's decision) is recorded in `ai/implementation/decisions/v020-T3.md`: *the clear runs in `runRemove` through the optional `TargetOperations.unregisterStage`, after a production backup succeeded and before any delete*. Its Affects line names `core/{operations,remove}.ts` and `cloudflare/target.ts`. I2 integrates it with DEC-0725.
- **2, accepted.** Evidence 5 is corrected here. `lifecycle.unit.test.ts` runs `runRemove`, but it records the auth-app calls and the database calls in separate arrays, so the order between them was never asserted. The fix strengthens that test with one shared sequence. This is recorded as `strengthened` in `test-reviews/2026-10-31-T3.md`.
- **3, accepted.** `withD1` (deploy-d1) forwards every property it does not override through `Reflect.get`, so the optional hook passes through. `FakeTarget` is unchanged.
- **4, accepted.** The hook runs only after a successful backup, with its own failure label. The core unit test is added.
- **5, done.** See "Similar cases" above.
