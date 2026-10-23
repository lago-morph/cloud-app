# Root cause: defects in the Cloudflare paths of the compliance tests (MIG stage, missing D1 guards, redundant removes, request budgets) found by the D-RUN pass-schedule estimate (2026-10-23)

Author: diagnosing subagent (prompt §8 step 1). I did not write the code or the tests under diagnosis, and I did not write the estimate. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made. No cloud test was run.

Base: `origin/claude/implement-local-cloudflare` at `dc4d748` ("plan: Cloudflare pass schedule (work in progress, estimator)"). The findings are the estimator's, in `ai/implementation/plan.md` §5 D-RUN, "Pass schedule (2026-10-23)", lines 352–473.

**Reproductions.** No cloud run is allowed, so I used local evidence only:
- E1: `vitest run --config vitest.unit.config.ts packages/framework/src/provision/cloudflare/worker.unit.test.ts packages/framework/src/cli/commands/secrets-cloud.unit.test.ts`. Result: 11/11 passed. These tests pin down that `secrets set` on a stage whose Worker does not exist fails with "Worker … does not exist yet; run deploy first" (`worker.ts:27`; `worker.unit.test.ts:37`; `secrets-cloud.unit.test.ts:59-62`).
- E2: `vitest run --config vitest.unit.config.ts packages/framework/src/provision/core/deploy.unit.test.ts -t "checks the required secrets right after step 5"`. Result: passed. This pins down that a first deploy with an unset required secret runs `deployCode`, then `stopApp`, and exits 1 naming the secret. The next deploy succeeds once the secret is set (`deploy.unit.test.ts:285-299`; `provision/core/deploy.ts:296-312`).
- E3: a vitest file with the same dependency structure as `mig/deploys.test.ts` (two describe blocks, state passed between `it`s), run with the driver's own filter `-t '\[<ID>\]'` (`harness/reports.ts:102-104`, `driver.ts:275`). The scratch files are `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/onlyexp/dep.test.ts` and `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/onlyexp/run.sh`. Output:
  - `-t [MIG-AC-002]`: 2 passed, 3 skipped.
  - `-t [MIG-AC-003]`: block 1's `beforeAll` ran. "[MIG-AC-003] failing" failed with "stage deployed by an earlier test: expected false to be true".
  - `-t [MIG-AC-006]`: block 2's `beforeAll` ran. "[MIG-AC-006] after" failed with "the schema-changing deploy ran (previous test): expected false to be true".

  So a `beforeAll` runs whenever any test of its block is selected, while the skipped earlier `it`s leave the shared state unset.

## Item 1: MIG-AC-002, -003, -006 (`tests/compliance/criteria/mig/**`)

### 1a. The tests depend on each other across IDs, so `--only` cannot split them. **Confirmed.**
- `deploys.test.ts:66-148` (block 1) deploys the stage for the first time only inside the first MIG-AC-002 `it` (`:79`). It loads the fixture and sets `loaded` only inside the second MIG-AC-002 `it` (`:91-92`). The MIG-AC-003 `it`s at `:121` and `:134` read that stage and `loaded`.
- `deploys.test.ts:150-224` (block 2): the v2 schema-changing deploy and the writer that fills `acknowledged` run inside the MIG-AC-003 `it` (`:178-191`). The MIG-AC-006 `it` asserts `deployed` (`:213`) and reads `acknowledged`.
- E3 shows the consequence: `--only MIG-AC-003` fails block 1's MIG-AC-003 tests, and `--only MIG-AC-006` fails its only test. The driver selects by tag (`-t`, `driver.ts:271-275`), so no `--only` set smaller than all three IDs works.

### 1b. The cloud `beforeAll` runs `secrets set` before the first deploy, so both blocks fail at once. **Confirmed.**
- `deploys.test.ts:72` (block 1) and `:164` (block 2) call `stage.setSecret("apiKey", …)` on a stage that was just created (`createStage()`, `:71` and `:163`) and never deployed.
- On Cloudflare, `setSecret` runs `secrets set apiKey --target cloudflare --stage <s>` (`support/stage.ts:344-346`). The CLI refuses it when the Worker does not exist (DEC-0354; `provision/cloudflare/worker.ts:27`; E1). `setSecret` then throws (`stage.ts:346`), so each block's `beforeAll` fails, and with it every test in both blocks.
- Each `afterAll` (`:74-76`, `:174-176`) then runs `remove` on a stage that was never deployed, which costs 2 × (20 + S) requests for nothing.
- Even if `secrets set` were skipped, the first `stage.deploy("v1")` would exit 1 with "required secrets are not set: apiKey" (E2). That breaks `:80` and `:166`, because `cloudflareStage().deploy` has no secret step (`stage.ts:348-360`).

### 1c. No stage lock and no database-cap (PAR-219 / DEC-0318) check, so a pass could hold 4 D1 databases. **Confirmed.**
- `support/stage.ts:315-379` (`cloudflareStage`) and `createStage` (`:382-387`) call none of `requireCloudD1`, `acquireLock("further-stage")` or `requireDatabaseRoom` (`grep` finds no use of any of them under `mig/`).
- Both MIG blocks make schema-changing deploys, which hold 2 databases each (MIG-REQ-006): `unique-fail` at `:124` and `:137`, and v2 at `:179`.
- PROV-AC-002's D1 stage takes the lock and checks room for 2 (`prov/deploy-sequence.test.ts:112`, `sharedStage(... databases: 2)` → `withCloudStage` `prov/support/stage.ts:189-195`). The D-RUN plan put it in the same pass as MIG (`plan.md:350`, DEC-0361).
- Vitest runs files in parallel processes. A MIG stage taking no lock therefore runs beside PROV-AC-002's stage: 2 + 2 = 4 test-stage databases, against the cap of 2 (plan §1, DEC-0318).
- Without `requireCloudD1`, the MIG cloud path would also use D1 while DEC-0317's stop holds, unless the operator passes `--blocked`. DEC-0361 makes the in-test guard the binding mechanism.

### Cause
- **Why it was written this way.** C-T2 wrote the MIG files at `b6a78a7` (2026-10-20 01:59). They follow the local order in DEC-0277: the secret is set *before* `dev` starts, because `dev` does not reload `.dev.vars`. The cloud branch was written to the same shape (DEC-0286).
- **The Cloudflare rule came later.** The rule that a Worker secret can be set only once the Worker exists, and that the first deploy stops on an unset secret, is provisioning.md §2 "First Cloudflare deploy". It was implemented afterwards: D-03 `70424c6` (05:08) gives the "run deploy first" refusal, and D-05 `b9e6dba` (07:11) gives `secrets set --target cloudflare`, DEC-0354. DEC-0398 then fixed the order for the driver: deploy → `secrets set` → deploy.
- **The guards came later too.** `_cloud/d1.ts` was added by D-T2 `05a784a` (04:09). `withCloudStage`'s use of the guards came with D-T1 `3f35785` (04:20). Both are later than C-T2. D-T2's ownership line says "It does not edit C-T* files; gaps found in them go back to a C-T* follow-up item" (`plan.md:338`), and no such follow-up item was created.
- **Why the order dependence was not seen.** The per-ID `-t` scan (`root-causes/2026-10-20-test-order-dependence-scan.md`) covered local integration files. The file header (`deploys.test.ts:4-6`) deliberately designs "the tests of one describe block run in order on one stage".
- **Why none of it was caught.** DEC-0286 says it: "Not runnable until D: the Cloudflare paths … were not executed here". No MIG cloud run has happened (DEC-0317; `final-report.md:284`: no `test-*` stage was created).

### Proposed fix (minimal; owner of `tests/compliance/criteria/mig/**`)
1. **Secret order, per DEC-0277 and DEC-0398.**
   - `createStage(options: { secrets: Record<string,string> })` takes the declared secrets, and the two `beforeAll`s drop `stage.setSecret(...)`.
   - Locally, `localStage` keeps DEC-0277's order: `secrets set --target local` runs before the first `dev` start.
   - On Cloudflare, `cloudflareStage.deploy()` handles only the first deploy of the stage. If the deploy exits non-zero and `secretsNotSet(output)` (`harness/node-deps.ts:115-117`, DEC-0398's recogniser) matches, it runs `secrets set <name>` for each secret, with the value on stdin, and then deploys again. It returns the second result, with the combined output.
   - It never retries later deploys, and never retries on any other failure, so the failing `unique-fail` deploy (`:124`) is never retried.
   - `remove()` runs `remove` only if a deploy was attempted.
2. **Selection per describe block, so each ID's tests are self-contained:**
   - (A) MIG-AC-002: initial deploy and no-change redeploy.
   - (B) MIG-AC-003 failing migration: v1 with the fixture, `unique-fail` fails, the data is corrected, the deploy is re-run.
   - (C) the v2 schema change, with its deploy and writer moved into C's `beforeAll`. The results are kept in variables. C has the MIG-AC-003 preservation `it` and the MIG-AC-006 `it`, and each only asserts on the recorded results.

   With this, `--only` of any single ID runs only the blocks that carry that ID, and each block deploys its own stage. The assertions stay exactly as they are.
3. **Guards, through the shared helper.**
   - In `prov/support/stage.ts`, factor the guard sequence that `withCloudStage` and `holdStages` already run (`requireCloudD1(t)` → `acquireLock("further-stage", 60 min)` → `requireDatabaseRoom(n, what)`) into one exported function, for example `takeStageRoom(databases, what): Promise<release>`. `withCloudStage` and `holdStages` then call it.
   - The MIG cloud `createStage` calls it with `databases: 2` before copying or deploying anything, and `remove()` releases it.
   - The local path takes nothing.
4. **Fewer D1 requests, without weakening (item 4):**
   - `cloudflareStage.query` lists the account's databases on *every* query (`stage.ts:363`), so each query costs 2 requests.
   - Instead, cache the current database (the lowest `-db-<n>`) after each deploy, and re-list only in `databases()`.
   - Make `snapshot()` (`deploys.test.ts:34-43`) send one `query` call holding all of its SELECTs. The D1 `/query` endpoint returns one result per statement, which `stage.ts:366` already indexes as `result[0]`. The multi-statement form must be confirmed by D-04's D1 checks (DEC-0348) or the fake before it is relied on; if it is not confirmed, keep one query per table but without the list.
   - This takes the estimator's ≈ 130 query requests down to ≈ 30.

### Red tests (local, harness fakes; no cloud)
Fakes:
- a **fake framework CLI**, a Node script under the harness, swapped in for the bin path. That means `vi.mock` of the module that exports the bin path; the fix makes `mig/support/stage.ts` take `BIN` from `core/support/repo.ts` instead of its own `FRAMEWORK_BIN`.
- The fake CLI appends each argv and stdin to a log. It refuses `secrets set` before any `deploy` (exit 1, "… does not exist yet; run deploy first"). Its first `deploy` exits 1 with "required secrets are not set: apiKey". Later deploys print `https://reference-<stage>.example.workers.dev`.
- a stubbed `fetch` (`vi.stubGlobal`) for `GET …/d1/database` and `POST …/query`, with `CLOUDFLARE_ACCOUNT_ID` and `COMPLIANCE_TARGET=cloudflare` set.

Tests:
- **R1a (order):** `createStage({secrets:{apiKey:"k…"}})` then `deploy("v1")` gives `ok: true`, and the CLI log is exactly `deploy`, `secrets set apiKey` (stdin `k…`), `deploy`. There is no `secrets set` before the first `deploy`. It fails today: `setSecret` throws at `stage.ts:346`.
- **R1b (no retry):** after R1a, a `deploy("unique-fail")` that the fake fails with an unrelated message returns `ok: false`, with no `secrets set` and no second deploy in the log.
- **R1c (selection):** `mig/deploys.selection.unit.test.ts` runs `vitest run` on `deploys.test.ts` with `-t '\[MIG-AC-00x\]'` once for each of the three IDs. It uses a config that aliases `./support/stage.js` to an in-memory fake `StageUnderTest` (versions, rows and databases kept in memory). For each ID it asserts 0 failed and ≥ 1 passed. Today it fails for MIG-AC-003 and MIG-AC-006, as E3 shows.
- **R1d (guards):**
  - With `COMPLIANCE_CLOUDFLARE_D1` unset, `createStage` rejects with the D1 stop detail (`D1_STOP_DETAIL`) and the CLI log is empty.
  - With D1 available and the stubbed list holding one `reference-test-x-db-1`, it rejects with the DEC-0318 message and the log is empty.
  - With the `further-stage` lock held by the test, it makes no CLI call until the lock is released.

  All three fail today, because the MIG stage has no guards.

## Item 2: E2E stage deploys (E2E-010, -012, -014) and C-T1's `withFurtherStage`

### Verification. **Confirmed.**
- `e2e/support/apps.ts:62-76` (`deployStage`) calls `frameworkCli` for `deploy` and `secrets set` directly. Its callers apply no guard:
  - `E2E-010.spec.ts:50,62,93`: one stage, v1 → v2 → v2, holding 2 databases during v2;
  - `E2E-012.spec.ts:54-55`: two stages at once;
  - `E2E-014.spec.ts:83-84`: `secrets set` and a redeploy of the run stage, which creates no database but uses D1.

  `grep` for `requireCloudD1|requireDatabaseRoom|acquireLock` under `tests/compliance/e2e/` finds nothing.
- Playwright runs spec files in parallel workers: `playwright.config.ts` sets no `workers` and no `fullyParallel: false`, and the driver passes no `--workers` (`driver.ts:276`). So E2E-010 and E2E-012 in one pass would hold 2 + 2 databases.
- `core/support/stages.ts:39-86` (`withFurtherStage`) takes the lock (`:48`), but calls neither `requireCloudD1` nor `requireDatabaseRoom`. Its callers are `secrets/further-stage.test.ts:33` (pass 2) and `cli/smoke.test.ts:68` (CLI-AC-005, pass 4).

### Cause
- C-T1 `0276222` (02:00) and C-T4 `b675422` (02:34) were written before the guards existed (D-T2 `05a784a`, 04:09). DEC-0361 then said "Every further stage, D-T1's own and C-T1's, takes the same cross-process further-stage lock". C-T1's helper already met that, so the rule's other half, the D1 stop and the database cap, was never carried over to C-T1 or C-T4. `_cloud/d1.ts:4-14` says every test that deploys a stage calls `requireCloudD1()`, and the plan relied on that (`plan.md:342`, `:350`: "C-T1's lock").
- D-T2 was not allowed to edit C-T* files (`plan.md:338`), and no follow-up item was opened.
- The cloud paths never ran, so nothing was blocked or caught.

### Proposed fix
Use the same shared helper as item 1 (`takeStageRoom`, or `holdStages` where the work is body-scoped):
- `withFurtherStage`: after taking the lock it already holds, call `requireCloudD1(run.target)` and `requireDatabaseRoom(1, "a further <label> stage")`, before `scratchCopy`. The cleanest form is to replace its own `acquireLock` with `takeStageRoom(1, …)`.
- E2E-010: wrap the body in `holdStages(2, "E2E-010 (v1 → v2 on its own stage)", …)`.
- E2E-012: wrap it in `holdStages(2, "E2E-012 (two stages)", …)`.

  The cross-process directory lock (`core/support/processes.ts:209-233`) works across Playwright workers the same way it does across Vitest forks. This makes the "never select E2E-010 and E2E-012 in one pass" rule safe even if it is broken by mistake.
- E2E-014: call `requireCloudD1(t.target)` before `setSecret` (0 new databases, so it needs no room check and no lock; pass 5 runs it alone on R).

Ownership: the fix item must own `tests/compliance/criteria/core/support/stages.ts`, `tests/compliance/e2e/E2E-01{0,2,4}.spec.ts` and the helper in `prov/support/stage.ts` (plan §1 Ownership).

### Red tests (local, fakes)
They use the same fake CLI and stubbed `fetch` as item 1, with `COMPLIANCE_TARGET=cloudflare` and `COMPLIANCE_STAGE=test-x`.
- **R2a:** `withFurtherStage(...)` rejects with the D1 stop detail when `COMPLIANCE_CLOUDFLARE_D1` is unset, and the CLI log is empty. Today the fake CLI's `deploy` runs.
- **R2b:** with D1 available and the stubbed list holding 2 test-stage databases, `withFurtherStage` rejects with the DEC-0318 message before any CLI call.
- **R2c:** E2E-010's and E2E-012's stage work, extracted into an exported function of `e2e/support/` (for example `withE2EStages(databases, what, body)`), shows the same two rejections. Two concurrent calls run one after the other: the second body starts only after the first resolves.
- **R2d:** the E2E-014 path rejects with the D1 stop detail before `secrets set` is logged.

## Item 3: redundant second `remove` in PROV-AC-006 and COMPL-AC-004

### Verification. **Confirmed.**
- `withCloudStage`'s `finally` runs `stage.remove()` whenever `removeAfter !== false && deployedOnce` (`prov/support/stage.ts:252-256`). `stage.remove()` is memoised (`:241-244`), but only for removals made through it.
- PROV-AC-006 removes the stage out of band, from machine 3, with the top-level `runCli([...remove...])` (`prov/clean-machine.test.ts:61`). It asserts that the removal exited 0 and that nothing is left (`:62`, `:66`), and then the `finally` runs `remove` a second time.
- COMPL-AC-004 removes the stage through `driverCleanup` (`prov/test-stages.test.ts:132`), and then the `finally` runs `remove` again.
- Each second `remove` costs 20 + S requests and proves nothing.

### Cause
- D-T1 wrote `withCloudStage` with one removal path, the stage's own `remove()`, and an unconditional cleanup in `finally` so that nothing is left behind. These two tests are the only ones whose criterion *is* a removal made by another actor (a clean machine, or the driver's cleanup), so they bypass `stage.remove()`, and the helper has no way to learn that the stage is already gone.
- For COMPL-AC-004 the comment at `test-stages.test.ts:155` ("The stage's removal may already have deleted it") shows the overlap was noticed. The put-back token is deleted by id in the outer `finally` (`:156-159`) in any case.
- It was not caught because the cloud paths never ran, and the request cost of a cleanup was counted only now (pass 7 and the PROV-AC-006 line of the estimate).

### Proposed fix
- Add `CloudStage.removedElsewhere(result: CommandResult)`. It sets the memoised `removed` result only when `result.status === 0`, so a failed out-of-band removal still gets the `finally` cleanup.
- PROV-AC-006 calls it with machine 3's `remove` result, after `:62`.
- COMPL-AC-004 calls it after `:132` when `remaining` (`:133`) is empty, using the status `0` and the cleanup's output.
- The leftover reporting and the token deletion by id stay unchanged.

### Red test (local, fakes)
`withCloudStage` is run with the fake CLI (`COMPLIANCE_CLOUDFLARE_D1=available`, stubbed D1 list empty). The body calls `deployReady()`, runs an out-of-band `remove` with the fake, and calls `stage.removedElsewhere(r)`.
- **R3a:** the CLI log holds exactly one `remove`. It fails today: the method does not exist, and without it the log holds two.
- **R3b:** when the out-of-band removal exits 1, the `finally` still runs one `remove`.

## Item 4: request budgets (> 500 Cloudflare API requests per pass at S = 60)

### Verification
I checked the estimator's arithmetic against the tests' deploy sequences and the per-operation costs in `plan.md:355-371`. The F + n·S totals match the code paths:
- COMPL-AC-008: `deploy-recovery.test.ts:41-60`, 2 × (deployReady + aborted v2 + re-run + remove);
- PROV-AC-003: `removal.test.ts`, two stages, each deployReady + remove;
- E2E-012: `E2E-012.spec.ts:54-55,86,120`;
- E2E-010: `E2E-010.spec.ts:50,62,93,104`;
- PROV-AC-002: `deploy-sequence.test.ts:117-170`, with the retry at `:160-165`;
- PROV-AC-006: as in item 3;
- MIG: block 1 has 5 deploys (`:79` → 2 with the secret, `:98`, `:124`, `:137`) and block 2 has 3, plus a D1 list for every `query`.

The cause is structural. A stage whose app answers costs `deploy, secrets set, deploy` (49 + 4S) before the test does anything. That is the CLI's required order (provisioning.md §2, DEC-0398), and every one of these criteria needs at least one such stage plus at least one further deploy or a removal. At S = 60, 69 + 5S = 369 per stage lifecycle already leaves only 131 requests for the criterion itself.

### Fewer deploys without weakening: per criterion
F + n·S after the fix, then [the largest S that fits 400 / 500]:

| Criterion | Now | Can it be reduced without weakening? | After the fix |
| --- | --- | --- | --- |
| COMPL-AC-004 | 118 + 6S (481) | **Yes:** drop the redundant `remove` (item 3) | **98 + 5S = 398** [60 / 80]: fits the 400 aim at S = 60 |
| PROV-AC-006 | 121 + 8S (601) | **Partly:** drop the redundant `remove`. Using machine 2's deploy as the post-secret deploy would save 19 + 2S more, but it drops "data written through machine 1 survives the clean-machine deploy" (`clean-machine.test.ts:43-57`). That weakens the test, so it is not proposed. | 101 + 7S = 521 [42 / 57] |
| MIG-AC-002 | part of 401 + 17S | **Yes, for requests:** query caching and batching (item 1 fix 4). Not for deploys: the initial deploy needs `deploy, set, deploy`, and the no-change redeploy must be its own deploy, with probes and no secret change. The post-secret redeploy runs with the app stopped, so "does not stop the app" cannot be observed on it. | block A ≈ 99 + 7S = 519 [43 / 57] |
| MIG-AC-006 (+ MIG-AC-003 preservation) | part of the above | Same | block C ≈ 115 + 7S = 535 [40 / 55] |
| MIG-AC-003 (failure and re-run) | part of the above | **No.** v1, a failing deploy, and a re-run are all named in the criterion. Block B alone is ≈ 155 + 8S = 635 [30 / 43]. MIG-AC-003 also spans blocks B and C. Both in one pass is ≈ 270 + 15S (1,170), and one stage with a combined overlay (v1 → `unique-fail` fails → re-run → v2) is ≈ 191 + 10S (791). | does not fit at S = 60 |
| COMPL-AC-008 | 286 + 17S (1,306) | **No.** The two abort points are two required runs. Doing both on one stage would need a third schema version, with a new `versions/v3` overlay, and saves one lifecycle (69 + 5S): 217 + 12S = 937. Split by abort point it is 140 + 8S = 620 and 146 + 9S = 686. | does not fit at S = 60 [per point 32 / 45 and 28 / 39] |
| PROV-AC-003 | 174 + 10S (774) | **No.** It needs two answering stages with data, a removal, and the kept stage's removal. | [22 / 32] |
| E2E-012 | 152 + 10S (752) | **No.** It is the same steps as PROV-AC-003. One test tagged with both IDs would save a whole pass, but it would merge a Vitest criterion into a Playwright scenario: an orchestrator decision, not a minimal fix. Neither would then fit at S = 60. | [24 / 34] |
| E2E-010 | 128 + 9S (668) | **No.** The v1 lifecycle, v2, and v2 again are all named in the scenario. | [30 / 41] |
| PROV-AC-002 | 153 + 8S (633), + 22 + 2S with the retry | **No.** The clean-deploy test already reuses `deployReady`. The retry (`:160-165`) exists because the hook's timing against the preflight is not deterministic. | [30 / 43] |

### Consequence for the schedule (for the orchestrator; not a code change)
- After the fixes in items 1 and 3:
  - COMPL-AC-004 fits pass 7 at S = 60.
  - PROV-AC-006, MIG-AC-002 and MIG-AC-006 each fit one pass of their own once the measured S is ≤ 55–57.
- MIG-AC-003 and COMPL-AC-008 can only run as split passes. DEC-0264 says "the latest record that contains an ID decides that ID", so a split ID needs a recorded decision that lets its evidence span two records, or a measured S ≤ 30 for MIG-AC-003 block B alone. This is a decision to draft, not a test change.
- None of the criteria marked "No" can be verified at S = 60 within 500 without weakening; they wait for the measured S.

### Red tests (local, fakes)
- **R4a:** run MIG blocks A, B and C against the fake CLI and the stubbed D1 `fetch`. Count `fetch` calls to `…/d1/database` (list) and `…/query` for one block. The list count must be ≤ the number of deploys + `databases()` calls, and each `snapshot()` must make exactly one `…/query` call. It fails today: the list count equals the query count (`stage.ts:363`).
- **R4b** is R3a. Item 4 needs no other red test: the remaining numbers are an estimate, measured live by D-RUN (plan §1 "Measure before and after").

## Other observations (not in the estimator's list; for the reviewer)
- `cloudflareStage`'s CLI calls rely on `NODE_USE_ENV_PROXY=1` being inherited from the driver (`stage.ts:126-131`). `prov/support/stage.ts:52` and `core/support/stages.ts:54` set it explicitly. The pass schedule exports it, so this is not a defect today.
- `withCloudStage.deployReady`, `withFurtherStage` and `deployStage` detect the secret stop by `output.includes(<secret name>)`, which is looser than DEC-0398's `secretsNotSet`. That does not cause any symptom here.

## Review

Reviewer: independent root-cause reviewer (prompt §8). I did not write the diagnosis, the code or the tests. Base `d918ccd`. No Cloudflare call was made. One local unit run: `vitest run --config vitest.unit.config.ts` on `provision/cloudflare/worker.unit.test.ts`, `cli/commands/secrets-cloud.unit.test.ts` and `provision/core/deploy.unit.test.ts`, 31/31 passed. That confirms E1 and E2 (`worker.ts:27` refuses `secrets set` before the Worker exists). I did not repeat E3. I checked the mechanism against `deploys.test.ts:66-224` instead.

### Verdict
**Accepted with the required changes below.** All four causes are confirmed against the code, and the file:line citations hold:
- `mig/deploys.test.ts:72,164`, `mig/support/stage.ts:344-360,362-368,382-387`;
- `prov/support/stage.ts:186-278`, `core/support/stages.ts:39-86`;
- `e2e/support/apps.ts:62-82`, `E2E-010/012/014.spec.ts`; `playwright.config.ts` sets no `workers`;
- `prov/clean-machine.test.ts:61,66`, `prov/test-stages.test.ts:132-133,155`;
- `tools/release.ts:86-98` (DEC-0264).

No proposed fix changes an assertion. Checked against MIG-AC-002/-003/-006 (migrations.md:101-103), COMPL-AC-004/-008 (compliance.md:80,84), PROV-AC-006 (provisioning.md:116) and E2E-010/-012/-014:
- In item 1, the secret retry happens only on the first deploy and only on `secretsNotSet`. The schema is still created by the initial deploy, and the no-change redeploy stays a separate, probed deploy.
- The A/B/C split keeps each criterion's clauses inside the blocks that carry its ID.
- Item 3 drops only a cleanup.

Three points need corrections before the fix item starts. Two are in red tests and one is in a fix.

### Required changes
1. **Item 3, PROV-AC-006: call `removedElsewhere` after `:66`, not after `:62`.** At `:62`, a machine-3 `remove` that exits 0 but leaves resources would also cancel `withCloudStage`'s cleanup, so the stage would be left over. Mark the stage removed only once `listStageResources` is empty, as the record already does for COMPL-AC-004 (`remaining` empty). Add **R3c**: exit 0 with a non-empty resource list still gives one `finally` `remove`.
2. **The guards must release the lock on every failure path.** Add red tests for each case below; none exists yet.
   - `takeStageRoom` takes the lock first. When `requireDatabaseRoom` throws, or anything else does, it must release the lock before rethrowing. `withCloudStage` already does this inside its `try`; a new helper must too.
   - The MIG `createStage` must release the lock if anything after the lock throws, such as the copy or the account check.
   - The MIG `remove()` must release the lock in `finally`, even when `remove` exits non-zero.
   - In `withFurtherStage`, `scratchCopy` (`stages.ts:49`) runs outside the `try`. A throw there leaks the lock today, and Vitest may reuse the live fork, so `acquireLock` would not reclaim the lock as stale. Move the copy, and the new room check, inside the `try`.
   - The helper exposes no skip flag to MIG or E2E. The `held` flag is for `holdStages` callers only.
   - For E2E-010 and E2E-012, `holdStages` wraps the whole body, including the `finally` removals.
3. **The red-test isolation and accuracy fixes:**
   - **R1d and R2c (lock):** set `TMPDIR` to a scratch directory in the test, so the test's `further-stage` lock never collides with a real run on the same machine. `os.tmpdir()` reads `TMPDIR` on each call. Today R1d must hold the lock *and* call `deploy`, because `createStage()` makes no CLI call. Assert that the log is still empty after a bounded wait.
   - **R1c (selection):** the in-memory `StageUnderTest` fake would also need to fake `stage.user()`'s HTTP client for fixture load/dump, `cases/run`, KV, `me`, `secret` and `schema-version`, which amounts to a second reference app. The local target reproduces the same defect for real and runs no cloud: block 1's MIG-AC-003 `it`s call `stage.user()` before any `dev` start (`localStage.current()`, `stage.ts:234-236`), and MIG-AC-006 hits `deployed === false`. So the simpler and stronger R1c is: run `deploys.test.ts` with `-t '\[MIG-AC-00x\]'` per ID on `--target local`, and assert 0 failed and ≥ 1 passed. It fails today for -003 and -006.
   - **R4a:** `snapshot()` must first list the tables, so it makes ≤ 2 `…/query` calls, not exactly 1. Assert the no-list caching separately, so the red test does not depend on the multi-statement form, which is still unconfirmed (DEC-0348).
   - **Query caching:** refresh the cached current database after *every* deploy attempt, failed ones included, and never from inside the `during` callback.
4. **Item 4: correct the single-pass condition, and name the simpler option.**
   - **Correction.** "A measured S ≤ 30 for MIG-AC-003 block B alone" is wrong. Block B does not contain the preservation clause, so under DEC-0264 its record is not evidence for MIG-AC-003 as a whole. One record can carry the whole ID in two ways:
     - blocks B and C in one pass, at 270 + 15S ≤ 500, so S ≤ 15;
     - the combined-overlay single stage, at 191 + 10S ≤ 500, so S ≤ 30.
   - **The DEC-0264 reading is sound.** `release.ts:89` and `:98` take the newest record containing the ID. With split passes, a passing later part masks a failing earlier part, for MIG-AC-003 and for COMPL-AC-008's abort points alike. COMPL-AC-008 is milestone-only, and invalidations cannot fix this: they only invalidate older records.
   - **The simpler path.** Two decisions are possible:
     - (a) an owner exception to §1's 500-request cap (applied per pass, DEC-0361) for these two single-stage passes, with the rows and two-database caps unchanged. That keeps one record per ID, and needs no evaluator or record-format change.
     - (b) a DEC-0264 amendment. `release.ts` would then need a notion of parts, for example the latest result per test title, which changes the rule for every ID; for example, a stale pass of a renamed test would persist.

     Recommend drafting (a) first, after S is measured in pass 1, and (b) only if the owner refuses (a). MIG-AC-002 and MIG-AC-006 alone are unaffected: the selection by block keeps their records whole.

### Guards: bypass check
The guards hold once the changes above are in:
- **MIG:** the D1 stop runs before the lock, and the cap check runs under the lock. MIG passes have no run stage, so 0 + 2 ≤ 2.
- **`withFurtherStage`:** room is checked for 1 database (R + 1 ≤ 2).
- **E2E:** E2E-010 and E2E-012 use `holdStages(2)`. The lock works across Playwright workers through the same tmpdir directory and the per-process pid. E2E-014 calls only `requireCloudD1`, which is enough because it creates no database.

Remaining limits, by design and not defects:
- The lock is per machine.
- `requireDatabaseRoom` checks the account, then the test acts, so the check is not atomic. Both rely on the operator running one pass at a time (plan §5 "Every pass").
