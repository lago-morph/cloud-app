# Decision drafts — fix-pass1

### DEC-PENDING-fix-pass1-1 — Step 3 targets `Files` only when the stage has a database; `sst remove` runs only when SST has the stage's state (amends DEC-0336 "Steps")
Origin: ai-proposed · Status: accepted · Affects: DEC-0336, DEC-0334 item 10, DEC-0084, PROV-REQ-002, PROV-REQ-003, `packages/framework/src/provision/cloudflare/target.ts`, `sst.ts`, `fake-cloud.test-support.ts`

Pass 1's first deploy of `apps/reference` failed at step 3 with `✕  Target not found: Files`. SST 4.17.2 resolves `--target <name>` only against the resources in the stage's previous deployment state (`pkg/project/run.go:348-360`). A stage's first deploy has no state, so DEC-0336's `sst deploy --target Files` could never succeed on it. A stage without `app/<app>/<stage>` in `sst-state` is also unknown to `sst remove`, which then fails with `Stage not found`.

Amended steps:
- **Step 3 (`deployInfrastructure`)** decides from `input.database`:
  - with a database, the program declares the bucket and the Worker, and the run is `sst deploy --target Files`. The first database is created only after a step 3 succeeded, so `Files` is in SST's state. If the built Worker code is absent, step 3 is refused before any SST run: an untargeted run on a bucket-only program would delete the Worker with its secrets (R1);
  - without a database (a first deploy), the program is bucket-only and the run is an untargeted `sst deploy`. An untargeted run makes the stage's SST state equal the program, so it would delete a Worker in that state. If the Worker `<app>-<stage>` exists (checked by exact name), step 3 is refused: "the stage has a Worker `<app>-<stage>` but no database; … restore the database or run remove" (R2).
- **Removal:** `sst remove` is skipped only when a successful listing of `sst-state` lacks the exact key `app/<app>/<stage>`. If the listing fails, the failure is recorded and `sst remove` still runs. After a successful `sst remove`, the `app/` object it leaves behind (an empty checkpoint) is deleted, so a re-run of `remove` skips `sst remove`. The exact-name Worker and bucket deletes and the final deletion of the stage's state objects are unchanged (DEC-0084) (R3).
- Step order is unchanged (3 → first database → 4 → 5), so PROV-REQ-002's "no new app code" in step 3 holds.

Known limit, accepted: a stage with a database whose SST state was lost fails step 3 with SST's own `Target not found: Files`; `remove` recovers it.

The unit tests' fake SST now models SST's per-stage state (R4): `app/` marks a stage SST knows; `--target X` must be in that state; a targeted run adds nothing; an untargeted run makes the state equal the program; `remove` deletes only components in state and fails with `Stage not found` without `app/`; every run writes `update/<app>/<stage>/<id>`, and a stage's first run writes `passphrase/`. The old `snapshot/` keys are gone.

Still unverified live, carried to pass 2 (DEC-0334 item 10): a later `--target Files` step 3 leaves the Worker and its secrets in place, and whether `--target Files --target-dependents` updates the bucket's child resource. The pass-1 leftovers (`passphrase/` and `update/` objects of `test-ycfmck8n9jis0gb`) should be removed with the fixed `remove`, which should exit 0 without running `sst remove`.

Evidence: `ai/implementation/root-causes/2026-10-23-pass1-sst-target-not-found.md` (diagnosis and Review, R1–R4); `packages/framework/src/provision/cloudflare/target.unit.test.ts` (the first-deploy sequence, R1, R2 and both R3 remove tests failed before the fix; the second-deploy targeted test guards the targeted path).

## Parameter changes

None.
