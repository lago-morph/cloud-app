# Root cause: pass 1. SST 4.17.2 resolves `--target <name>` only against the resources in the stage's previous deployment state, so step 3's `sst deploy --target Files` can never succeed on a stage's first deploy. The fake SST in the unit tests accepted every `--target`, and no spike ever ran `--target`.

Author: diagnosing subagent (prompt §8). I did not write the code under diagnosis, and I did not run pass 1. This is a diagnosis only. No framework code or test was changed, and no Cloudflare call was made. All reproduction was local (SST `home: "local"`, no provider).

Base: branch `claude/implement-local-cloudflare-diag-pass1`, from `origin/claude/implement-local-cloudflare` `6755922`. Evidence: `validation/cloudflare/pass-1/logs/deploy-1.log`, `deploy-1.sst-run1.sst.log`, `deploy-1.generated-sst.config.ts`, `inventory-sst-state-objects.json`.

A different subagent must review this record.

## Symptom
The first `deploy --target cloudflare --stage test-ycfmck8n9jis0gb` of `apps/reference` failed at step 3 (long-lived infrastructure):

```
sst deploy --stage test-ycfmck8n9jis0gb --target Files failed (exit 1):
SST 4.17.2 ready!
~  Deploy
✕  Target not found: Files
```

The generated program declares `new sst.cloudflare.Bucket("Files", …)` (and no Worker, because the stage had no database yet). Nothing was created except two SST state objects in `sst-state`: `passphrase/reference/test-ycfmck8n9jis0gb` and `update/reference/test-ycfmck8n9jis0gb/<id>`. The SST log shows the stage's state was absent ("passphrase not found, setting passphrase", then "got previous deployment"), and SST exited before running Pulumi.

## Evidence

### E1: SST's source: `--target` is looked up in the previous deployment's resources
SST `v4.17.2`, `pkg/project/run.go` (fetched from `raw.githubusercontent.com/sst/sst/v4.17.2/…`), lines 348-360:

```go
if input.Target != nil {
    for _, item := range input.Target {
        index := slices.IndexFunc(completed.Resources, func(res apitype.ResourceV3) bool {
            return res.URN.Name() == item
        })
        if index == -1 {
            return util.NewReadableError(nil, fmt.Sprintf("Target not found: %v", item))
        }
        args = append(args, "--target", string(completed.Resources[index].URN))
    }
    if len(input.Target) > 0 {
        args = append(args, "--target-dependents")
    }
}
```

`completed` comes from `getCompletedEvent` (`run.go:124`; `pkg/project/completed.go:32-58`). That function exports and decrypts the **pulled checkpoint** and returns `decrypted.Latest.Resources`. On a stage with no state, `workdir.Pull()` returns `ErrStateNotFound`, SST runs `pulumi stack init` (`run.go:99-121`), and `Resources` is empty. The program is not evaluated for this lookup. So:
- the target is matched by **URN name**, which is the component's logical name (`Files`). That form is correct; no type prefix or other form is needed;
- the resource **must already be in the stage's state**. On a first deploy no name, including a full URN, can match;
- SST then passes the full URN plus `--target-dependents` to `pulumi up`.

### E2: local reproduction with the pinned binary (no Cloudflare)
`node_modules/sst-linux-x64/bin/sst` (`sst version` → `sst 4.17.2`), app with `home: "local"`, `removal: "remove"` and two provider-free components `sst.Linkable("Files")`, `sst.Linkable("Other")`:

| Run | Result |
|---|---|
| `sst deploy --stage t1 --target Files` (new stage) | exit 1, `✕  Target not found: Files` |
| `sst deploy --stage t2 --target urn:pulumi:t2::repro::sst:sst:Linkable::Files` (new stage) | exit 1, `✕  Target not found: urn:…::Files` |
| `sst deploy --stage t1` (untargeted) | exit 0, creates `Files` and `Other` |
| `sst deploy --stage t1 --target Files` (after it) | exit 0, `✓ Complete` |
| `sst deploy --stage t1 --target Nope` | exit 1, `✕  Target not found: Nope` |
| `sst remove --stage t2` (state has only `passphrase/` and `update/`, as in pass 1) | exit 1, `✕  Stage not found` |

The failed targeted deploy on t2 left `passphrase/repro/t2` and `update/repro/t2/<id>` and no `app/repro/t2`: the same objects pass 1 left in `sst-state`. The scratch app and its local state were deleted afterwards.

### E3: the framework always targets on step 3
- `packages/framework/src/provision/cloudflare/target.ts:121-127` (`deployInfrastructure`): writes the program (bucket only when `input.database` is absent; bucket + Worker otherwise) and always calls `runSst(…, "deploy", { target: INFRASTRUCTURE_COMPONENT })`, i.e. `--target Files`.
- `packages/framework/src/provision/core/deploy.ts:83-87`: on a first deploy `current` is undefined, so step 3's program is bucket-only. The first database is created only after step 3 (`firstDatabase`, `deploy.ts:208-212`).
- DEC-0336 "Steps" and `sst.ts:19` state the design: step 3 = `sst deploy --target Files`; both are marked "unverified live (DEC-0334 item 6/10)".

### E4: why the unit tests passed
`packages/framework/src/provision/cloudflare/fake-cloud.test-support.ts:146-155`: the fake SST treats `--target` only as "do not create the Worker" (`const targeted = args.includes("--target")`) and always returns `✓ Complete`. It has no notion of the stage's SST state, so it cannot produce "Target not found". `target.unit.test.ts:95` then pins the faulty sequence `["install …", "deploy --stage test-abc --target Files", "deploy --stage test-abc"]` as the expected first deploy. The fake's `remove` likewise always succeeds, whatever the state.

### E5: the spikes never ran `--target`
`git grep -e "--target" origin/archive/implement-local-cloudflare -- ai/implementation/spikes` finds nothing. A-01 and A-03 ran only untargeted `sst install/deploy/refresh/remove` (`a-03/logs/s00…s08`). A-10 ran `sst install`/`version` offline. So `--target` semantics were never observed, and DEC-0334 item 10 deferred it to D-RUN's first deploy.

## Why the bucket is deployed first, and whether that is required
- **Required by the spec, not by the R2 token.** PROV-REQ-002 step 3 (`docs/components/provisioning.md:20`) requires the long-lived infrastructure to be created or updated "with no new app code" before migrations (step 4) and the code (step 5). On later deploys step 3 must not ship the new Worker, which is why the program declares the Worker and `--target Files` limits the run to the bucket.
- **It also makes step 5 safe.** The Worker's `FILES` binding names the bucket by a plain string (`sst.ts` bindings), not by the `Bucket` output, so Pulumi has no dependency edge between them. In a single full deploy it could create the Worker before the bucket exists. Step 3 guarantees the bucket exists first. Step 3 also sets the bucket's CORS policy (`target.ts:125-126`), which needs the bucket.
- **The R2 signing token is not a reason.** It is created in step 5 after the full deploy (`ensureFrameworkSecrets`, `target.ts:92-102`), and its scope names the bucket by string (`r2-token.ts:48`). So no change to the token flow is needed.

So step 3 must stay, but `--target` is only needed when the program declares the Worker. On a first deploy (no database) the program is bucket-only, and an untargeted `sst deploy` of it is exactly what step 3 must do.

## Chain from cause to symptom
1. DEC-0336 chose `sst deploy --target Files` for step 3 without a live or offline SST run of `--target` (E5).
2. SST 4.17.2 resolves `--target` names against the stage's existing state only (E1, E2).
3. On a first deploy the stage has no state, so SST stops with `Target not found: Files` before Pulumi runs (pass 1 log; E2 row 1).
4. The fake SST accepted any `--target`, and the unit test pinned the faulty sequence, so the offline suite was green (E4).

## Could it have been caught locally?
Yes. E2 reproduces it in seconds with the pinned binary, `home: "local"` and a provider-free component; no Cloudflare and no credentials. It was not caught because the fake modelled `--target` as always valid (E4) and the spikes never exercised it (E5).

## Proposed fix (minimal, red-green)

**Fix (green)**, `target.ts` `deployInfrastructure` only: pass `--target Files` only when the program declares the Worker, i.e. when the stage already has a database:

```ts
const worker = input.database && options.code ? { publicOrigin: stageOrigin, database: input.database, code: options.code } : undefined;
writeSstApp(dir, { stage: input.stage, ...(worker ? { worker } : {}) });
// SST 4.17.2 resolves --target in the stage's previous state only (run.go:348-357): a stage without
// a database has never passed step 3, so its program is bucket-only and is deployed untargeted.
await runSst(sst, sstRun(input.stage), "deploy", worker ? { target: INFRASTRUCTURE_COMPONENT } : {});
```

Why this is safe: the first database is created only after step 3 succeeds (`deploy.ts:83-87, 208-212`), so "the stage has a database" implies a previous step 3 put `Files` in SST's state, and `--target Files` resolves. "No database" means the program has no Worker; an untargeted run creates or keeps the bucket, and can delete only a Worker in state, which exists only if the stage's databases were deleted outside the framework (step 5 recreates it). Known limit: if the stage has a database but its SST state was lost, `--target Files` still fails with SST's clear message; `remove` then recovers (it deletes by exact name).

Alternatives considered and rejected: matching SST's output `Target not found` and retrying untargeted (text parsing); checking for `app/<app>/<stage>` in `sst-state` (an interrupted first deploy can leave state without `Files`); creating the bucket through the Cloudflare API outside SST (changes DEC-0336's ownership of the bucket and removal).

**Related second defect (same root: the fake ignores SST state): `remove` of a never-deployed stage.** With only `passphrase/` and `update/` objects, `sst remove` fails with `Stage not found` (E2 last row; SST `run.go:99-104` returns `ErrStageNotFound` for a non-deploy command when the state is absent). `removeStage` (`target.ts:184-187`) records that as a failure, so `remove` exits 1 even with no leftovers, and every re-run fails the same way. Proposed: in the `sst remove` attempt, skip `sst remove` when `sst-state` has no `app/<app>/<stage>` object (the existing `stateObjects(stage)` listing already holds the keys), since there is nothing for SST to remove.

**Tests first (red)**, all local:
1. `fake-cloud.test-support.ts`: model SST's state per stage. Keep a map stage → set of logical names deployed (`Files`, plus `Worker` when an untargeted program declares it) and add `app/<app>/<stage>` to `sst-state` only when a deploy succeeds. For `deploy … --target X` with X not in the stage's set, return `{ code: 1, output: "✕  Target not found: X" }` and add only `passphrase/` and `update/` keys (as pass 1 left). For `remove` with no `app/<app>/<stage>` key, return `{ code: 1, output: "✕  Stage not found" }`. Cite `run.go:348-357` and this record.
2. `target.unit.test.ts:90-95`, first deploy: expect `["install --stage test-abc", "deploy --stage test-abc", "deploy --stage test-abc"]` and `status: 0`. Red now: step 3 fails with `Target not found: Files`.
3. New, second deploy of the same stage: expect step 3 to be `deploy --stage test-abc --target Files`, and the Worker and its secrets unchanged after it. Green now; guards the targeted path.
4. New, `remove` after a failed first deploy (fake seeded with `passphrase/notes/test-abc` and `update/notes/test-abc/1` only): expect status 0, no leftovers, and no `remove` in `sstRuns`. Red now: status 1 with `Stage not found`.
5. Existing "a failing SST deploy fails the step" (`target.unit.test.ts:150-157`) expects the `--target Files` text on a first deploy; change its regex to `/sst deploy --stage test-abc failed \(exit 1\)/`.

Accompanying, non-code: amend DEC-0336 "Steps" (step 3 targets `Files` only when the stage has a database; a first deploy's step 3 is untargeted on a bucket-only program; `sst remove` is skipped without `app/` state), citing this record; update the `sst.ts:19` and `target.ts:8` comments.

## Leftover SST state objects of `test-ycfmck8n9jis0gb`
`passphrase/reference/test-ycfmck8n9jis0gb` and `update/reference/test-ycfmck8n9jis0gb/<id>` hold no resources (nothing reached Pulumi). Both match `isStageStateObject` (`names.ts:28-31`: `parts[1] === app && parts[2] === stage`).
- **With the current code**, `remove --target cloudflare --stage test-ycfmck8n9jis0gb` does delete them: the last attempt of `removeStage` (`target.ts:198`) deletes every stage state object regardless of earlier failures. But `sst remove` fails first with `Stage not found` (E2), so `remove` prints that failure and exits 1, while listing no leftovers. (`sst remove` also writes another `update/…` object, which the same last attempt deletes.)
- **Recommendation:** either run `remove` now and accept exit 1 if the only failure is `Stage not found` and there are no leftovers (confirm with an `sst-state` listing), or leave the objects until the fix lands and then run `remove`, which should exit 0. They are harmless to a re-run of `deploy` with the fix: SST reuses the passphrase and treats the stage as new.

## How the fix will be verified
- Red: tests 2 and 4 fail on the current code (`Target not found: Files`; `Stage not found`).
- Green: tests 1-5 and the whole `provision/cloudflare` suite pass; `npm run verify` as §7 requires.
- Local, no Cloudflare: E2's scratch app (`home: "local"`) running the generated sequence: untargeted bucket-only deploy, then full deploy, then `--target Files`, all exit 0.
- Live: pass 2's first deploy of `apps/reference` passes step 3; DEC-0334 item 10's remaining check ("a later step-3 `--target Files` run leaves the Worker and its secrets in place") runs on the second deploy.

## Review

Reviewer: independent subagent (prompt §8). I did not write the code, the diagnosis or pass 1. Base `1e6e1c1`. No Cloudflare call was made. Evidence: SST `v4.17.2` source (`pkg/project/run.go`, `completed.go`, `workdir.go`, `provider/provider.go`, `provider/cloudflare.go`), and one local run of the pinned binary (`sst 4.17.2`, `home: "local"`, provider-free `sst.Linkable` components `Files`, `FilesChild` (parent `Files`) and an optional `Worker`). Its scratch app and local state were deleted afterwards.

**Verdict: cause confirmed; deploy fix accepted with one required change (R1) and one required guard (R2); remove fix accepted with its detection made exact (R3); fake model accepted with corrections (R4).**

### Cause
Confirmed. `run.go:98-121`: `workdir.Pull()` → `PullState` → `getData("app", app, stage)`; on Cloudflare a missing `app/<app>/<stage>` object (error 10007) is `ErrStateNotFound`, and for `deploy` SST runs `pulumi stack init`. `run.go:348-360` then matches each `--target` against `completed.Resources`, the pulled checkpoint's `Latest.Resources` (`completed.go:32-58`), by `URN.Name()`, before Pulumi runs. A new stage has no resources, so no target can match. My local run agrees: after an untargeted bucket-only first deploy, `--target Files` succeeds.

### Deploy fix, per path
Local run (stage `s1`): (1) untargeted, bucket-only: creates `Files` and `FilesChild`. (2) Full deploy: creates `Worker`. (3) `--target Files` with the Worker in the program: Worker untouched. (4) `--target Files` with the program **without** the Worker: Worker kept. (5) **Untargeted with the program without the Worker: `Deleted Worker`.** So an untargeted run reconciles the whole stage stack. It never touches other stages (one Pulumi stack per app/stage) or the shared log bucket (created by API in `account.ts`, not in SST state). But it deletes any Worker in this stage's state that the program leaves out.
- **First deploy:** untargeted bucket-only, correct. The stage has no state, so nothing else can be touched. PROV-REQ-002's "no new app code" holds because the program declares no Worker.
- **Redeploy, no schema change:** the database is present, so the program declares the Worker and `--target Files` resolves (a previous step 3 put `Files` in state, since step 3 runs before `firstDatabase`). Run (3) shows the Worker is not deployed. Correct.
- **Schema-changing deploy (MIG-REQ-006):** step 3 runs with `current` (the old database) before `migrate`, targeted. That is the same as the previous path. The copy and step 5 are unchanged. Correct.
- **After a partial failure:** pass 1's state (only `passphrase/` and `update/`, no `app/`): SST treats the stage as new and reuses the passphrase, so the deploy is correct. If step 3 succeeded and then `createDatabase` or the first migration failed and the database was dropped, the next deploy has no database and no Worker, so the run is untargeted bucket-only. Correct. If step 5 failed after a database exists, the next deploy is targeted. Correct.
- **R1 (required). Decide `--target` from `input.database`, not from `worker`.** The proposed `worker ? { target } : {}` is undefined when `input.database` is set but `options.code` is absent (`code` is optional in `CloudflareTargetOptions`). Then step 3 runs untargeted on a bucket-only program and **deletes the stage's Worker with its secrets**: run (5). The CLI passes `code` today (`cli/commands/deploy.ts:87, 202`), but nothing enforces it. Throw in `deployInfrastructure` when `input.database` is set and `options.code` is not, before any SST call. Otherwise target exactly when `input.database` is set.
- **R2 (required guard). No database but the Worker exists:** the program is bucket-only and untargeted, so a Worker in SST state is deleted, together with the developer's `SECRET_*` values and the session key. The record calls this "recreated by step 5", but the secrets are not recreated. Also, step 1's secrets check was not deferred, because the Worker existed at preflight. So step 6 starts an app without its required secrets. This happens only when the databases were deleted outside the framework, or a `remove` stopped after deleting them. Before an untargeted step 3, check the Worker by exact name (the existing `exists(workerPath/settings)`). If it exists, fail step 3 with a clear message: the stage has a Worker but no database; restore the database or run `remove`. Add a red unit test for this.
- Step order is unchanged (3 → first database → 4 → 5), so PROV-REQ-002 holds. "Known limit" (database present, SST state lost): this fails with SST's clear `Target not found`, which is acceptable.
- Still unverified, carried to pass 2 (DEC-0334 item 10): whether `--target Files --target-dependents` updates the bucket **child** resource (and so the CORS-independent bucket settings). My Linkable run could not show an update of a child's inputs. The live second deploy must check this.

### Remove fix
- **Detection matches SST exactly.** SST's own test for "stage exists" is whether the single object `app/<app>/<stage>` exists (`PullState`). With that object absent, `sst remove` returns `ErrStageNotFound` without touching any resource. So skipping it in that case cannot leave anything half-removed that SST would have removed. Resources that exist without state (Worker, bucket) are still deleted by exact name in the later attempts, and the state objects are deleted last, as before.
- **R3 (required):** match the key exactly: `key === \`app/${app}/${stage}\``. Do not use `isStageStateObject`, which also matches deeper keys. Decide from a listing that succeeded. If `stateObjects` throws, record the failure and still run `sst remove`; never skip on a listing error.
- **Incomplete state object:** SST pushes `app/` partially during a deploy (`PushPartialState`), so an interrupted deploy leaves a real but partial checkpoint. Then `sst remove` runs, as today, and destroys what the checkpoint lists. Anything created but not checkpointed is covered by the exact-name Worker and bucket deletes. If `sst remove` itself fails, the failure is collected, the exact-name deletes and the state-object deletion still run, and `remove` reports the leftovers. That is the existing DEC-0084 behaviour, unchanged by this fix.
- Observed locally: after a **successful** `sst remove`, the `app/<app>/<stage>` object remains (an empty checkpoint; `Purge` is not called by `remove`). The framework's final attempt deletes it. A re-run of `remove` then skips `sst remove`. Correct.

### Fake SST (R4, required corrections to red test 1)
The proposed model (state per stage, `app/` written only on success, `Target not found`, `Stage not found`) is close enough, with these corrections:
- **A targeted run adds nothing to state.** It does not add the Worker, even when the program declares it. An untargeted run makes the state equal the program's components: it **deletes** a Worker in state that the program leaves out, and the fake must delete it from `workers`. That is what lets R2's test, and a regression test for R1, go red.
- `remove` deletes only the components in the stage's state, not by name, so the framework's exact-name fallback is exercised. On success it leaves `app/` (empty state) and adds an `update/` key.
- Every run, failed or not, adds `update/<app>/<stage>/<id>`. `passphrase/` is added on a stage's first run.
- Replace today's `snapshot/…/<n>` keys with that model. `Target not found` must also be returned when the stage has state but lacks X (state-lost case).
- Add tests: R1 (database without code: refused, no SST run); R2 (no database, Worker exists: step 3 fails, Worker and its secrets intact); R3 (listing failure: `sst remove` still attempted).

### Pass-1 leftovers in `sst-state`
`passphrase/reference/test-ycfmck8n9jis0gb` and `update/reference/test-ycfmck8n9jis0gb/<id>` hold no resources and no checkpoint (`app/` absent), so leave them until the fix lands. Do not run `remove` with the current code: it would exit 1 on `Stage not found`, add another `update/` object, and put a misleading failure in the evidence trail. After the fix is merged and green, run `remove --target cloudflare --stage test-ycfmck8n9jis0gb`. Expect exit 0, no `sst remove` run, the two objects deleted, and no leftovers. Confirm with an `sst-state` listing filtered to that stage, and record it as pass 2's first check of the R3 path. If pass 2 instead redeploys the same stage, the leftovers are harmless (SST reuses the passphrase), and the stage's final `remove` deletes them.

### Required changes before implementing
R1, R2, R3 and R4 above. Also amend DEC-0336 "Steps" with the R1 and R2 rules (target iff the stage has a database; an untargeted step 3 refuses when the Worker exists) and the exact `app/` test, citing this record.
