# Decision drafts — fix-cloudtests

### DEC-PENDING-fix-cloudtests-1 — The MIG criteria run as three self-contained blocks, and set the secret after the first Cloudflare deploy
Origin: ai-proposed · Status: accepted · Affects: MIG-AC-002, MIG-AC-003, MIG-AC-006, DEC-0277, DEC-0286, DEC-0398, `tests/compliance/criteria/mig/**`

`mig/deploys.test.ts` had two describe blocks whose tests depended on each other across IDs, so a per-ID selection (`--only`, the driver's `-t '\[<ID>\]'`) failed MIG-AC-003 and MIG-AC-006. It now has three blocks, each on its own stage, with the assertions unchanged:
- A (MIG-AC-002): the initial deployment and the no-change redeployment;
- B (MIG-AC-003): `beforeAll` deploys version 1 and loads the fixture; then the failing `unique-fail` deploy and its re-run;
- C (MIG-AC-003 preservation, MIG-AC-006): `beforeAll` deploys version 1, loads the fixture, takes a session, then runs the v2 schema-changing deploy with the writer and records its result; the two tests assert on the recorded result and the stage.

`createStage({ secrets })` takes the declared secrets. Locally it sets them with `secrets set --target local` before the first `dev` start (DEC-0277). On Cloudflare only the stage's first deploy is special: when it stops on unset secrets (DEC-0398's `secretsNotSet`), the stage runs `secrets set` for each secret, value on stdin, and deploys again, returning the combined output. No later deploy and no deploy failing for another reason is retried. `remove()` runs `remove` only if a deploy was attempted. The stage's CLI is the shared `BIN` of `core/support/repo.ts`.

Evidence: root cause `ai/implementation/root-causes/2026-10-23-cloud-test-paths.md` item 1 and its Review. Red then green: R1c was run as per-ID `-t` runs of `deploys.test.ts` on `--target local`.
- Before: MIG-AC-002 passed (2 passed); MIG-AC-003 failed 2 of 3 ("expected one local D1 database, found 0", "not being served"); MIG-AC-006 failed on "the schema-changing deploy ran (previous test)".
- After: MIG-AC-002 2 passed, MIG-AC-003 3 passed, 0 failed.

MIG-AC-006 now passes both selection-dependent assertions (the deploy ran, and writes were attempted) and fails at "writes acknowledged while the deploy ran > 0". That is its cloud-only clause: the criterion's Where is "Cloud", and locally a deployment is a `dev` restart, so no write can be acknowledged during it (DEC-0144). The assertion is unchanged and fails the same way in a whole-file local run. The local driver does not select MIG-AC-006. R1a/R1b are in `mig/support/stage.unit.test.ts`.

### DEC-PENDING-fix-cloudtests-2 — Every further cloud stage takes the shared stage guards, and releases the lock on every failure path
Origin: ai-proposed · Status: accepted · Affects: DEC-0317, DEC-0318, DEC-0361, plan §1 "Cloud usage limits", `tests/compliance/criteria/prov/support/stage.ts`, `tests/compliance/criteria/core/support/stages.ts`, `tests/compliance/criteria/mig/support/stage.ts`, `tests/compliance/e2e/**`

`takeStageRoom(databases, what)` in `prov/support/stage.ts` runs the guard sequence in a fixed order: the D1 stop (`requireCloudD1`), the cross-process `further-stage` lock, and the two-database cap (`requireDatabaseRoom`) under the lock. When the cap check throws, it releases the lock before rethrowing. It returns an idempotent release. It has no skip flag; only `withCloudStage`'s existing `held` option (for `holdStages` callers) bypasses it.
- `withCloudStage` and `holdStages` use it.
- The MIG cloud stage takes it for 2 databases before anything is copied or deployed. It releases it if any later step of `createStage` throws (account check, stage name, copy). `remove()` releases it in `finally`, even when `remove` exits non-zero.
- `withFurtherStage` replaces its own lock with `takeStageRoom(1, …)`. `scratchCopy` now runs inside the `try`, so a failed copy no longer leaks the lock, and the stage is removed only if a deploy was attempted.
- E2E-010 and E2E-012 wrap their whole body, including the `finally` removals, in `withE2EStages(2, …)` (`holdStages`). E2E-014's cloud step `setSecretThenDeploy` applies only the D1 stop before `secrets set`, because it creates no database.

Evidence: same root cause, items 1c and 2, and the Review's required change 2. The red-then-green tests are R1d, R2a–R2d and the lock-release cases in `mig/support/stage.unit.test.ts`, `core/support/stages.unit.test.ts`, `prov/support/stage.unit.test.ts` and `e2e/support/apps.unit.test.ts`. They run against a fake CLI (`criteria/_fakes/fake-cli.mjs`) and a stubbed `fetch`, with `TMPDIR` set to a scratch directory so the test lock never collides with a real run.

### DEC-PENDING-fix-cloudtests-3 — A removal made by another actor cancels the cleanup removal only when nothing is left
Origin: ai-proposed · Status: accepted · Affects: PROV-AC-006, COMPL-AC-004, `tests/compliance/criteria/prov/support/stage.ts`

`CloudStage.removedElsewhere(result, remaining)` records an out-of-band removal, so `withCloudStage`'s `finally` does not run `remove` a second time. It counts only when `result.status === 0` **and** `remaining` (the stage-resource probe after the removal) is empty. Otherwise the cleanup still runs. Taking `remaining` as a parameter enforces the Review's condition in the helper itself, not only at the call sites.
- PROV-AC-006 calls it after the no-leftovers check (`clean-machine.test.ts`, after `listStageResources`), with machine 3's `remove` result.
- COMPL-AC-004 calls it right after the first driver cleanup's `listStageResources`, with status 0 and the cleanup's log. The put-back token is still deleted by ID in the outer `finally`.

Each call saves one `remove` (20 + S Cloudflare requests).

Evidence: same root cause, item 3, and the Review's required change 1. The red-then-green tests are R3a (one `remove`), R3b (failed out-of-band removal: cleanup still runs) and R3c (exit 0 with resources left: cleanup still runs).

### DEC-PENDING-fix-cloudtests-4 — The MIG Cloudflare stage reads the D1 listing once per deploy, and `snapshot()` batches its SELECTs
Origin: ai-proposed · Status: accepted · Affects: plan §1 "Cloud usage limits" (500 requests per item), DEC-0348, `tests/compliance/criteria/mig/support/stage.ts`

`cloudflareStage.query` used to list the account's databases on every query. Now the stage's current database (the lowest `-db-<n>`) is re-read once after every deploy attempt, failed ones included. It is read after the `during` callback has settled and never from inside it. A failed re-read leaves it unset, so the next query reads it again. `databases()` still lists every time.

`snapshot()` moved to `support/stage.ts`. It makes one query for the table names, then one `queryBatch` of all the tables' SELECTs. That is a single `/query` with `{ batch: [{ sql }, …] }`, the form D-04's D1 client already relies on (`provision/cloudflare/d1/client.ts`), and `fake-d1-api.ts` implements it; it stays a DEC-0348 item-1 check for D-RUN. The result count is checked against the statement count. Locally, `queryBatch` runs each statement on the same read-only database.

Item 4's split-pass question (MIG-AC-003 and COMPL-AC-008 across two records; the Review's options (a) and (b)) is **not** decided here. It goes to the owner.

Evidence: same root cause, item 4. R4a in `mig/support/stage.unit.test.ts`: the listings are at most deploys + `databases()` calls; a query after a failed deploy goes to the database read after that deploy; a snapshot makes at most 2 `/query` calls.
