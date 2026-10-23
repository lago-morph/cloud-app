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
