# D-T1 / D-T2 — decision drafts (test-case authors, phase D)

Items D-T1 (`tests/compliance/criteria/{cf,prov}/`) and D-T2 (`tests/compliance/criteria/_cloud/**`) of `ai/implementation/plan.md`. Written from the criteria, `cloudflare.md`, `provisioning.md`, `compliance.md`, the harness API, `apps/reference/ROUTES.md` and the decision log, not from D-01…D-05 (built in parallel). **No Cloudflare call was made while writing these tests**; the only executions were offline (`unshare -rn`), which showed every D1-dependent test reporting the DEC-0317 detail and the two offline clauses passing.

## Which tests need D1

Every deploy creates and migrates the stage's D1 database, so every test that deploys a stage needs D1. Each such test calls `requireCloudD1()` (`_cloud/d1.ts`) first. It reports `PREREQUISITE MISSING: D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset` (recorded `blocked`) unless the operator sets `COMPLIANCE_CLOUDFLARE_D1=available` after confirming the reset.

| Test (file › clause) | IDs | Needs D1 | D1 dbs held | Pass |
| --- | --- | --- | --- | --- |
| `cf/one-origin` › client, assets, API one origin; unknown `/api` paths → JSON 404 | CF-AC-001 | yes (run stage only) | 0 own | main |
| `cf/stage-resources` › two stages disjoint, both log | CF-AC-002 | yes | 1 + run stage | main |
| `prov/template-deploy` › template files, deploy | PROV-AC-001 | yes | 1 | main |
| `prov/deploy-sequence` › credential removed | PROV-AC-002 | **no** (creates nothing) | 0 | no-run-stage |
| `prov/deploy-sequence` › credential lacks R2-token permission | PROV-AC-002 | **no** (blocked: see 5) | 0 | no-run-stage |
| `prov/deploy-sequence` › clean deploy health; failing migration; secret removed after preflight | PROV-AC-002 | yes | 2 | no-run-stage |
| `prov/removal` › remove one of two stages | PROV-AC-003 | yes | 2 | milestone, no run stage |
| `prov/setup-account` › deploy without setup-account | PROV-AC-004 | **no** (blocked unless fresh account) | 0 | milestone |
| `prov/setup-account` › setup-account twice | PROV-AC-004 | **no** (R2 buckets only) | 0 | milestone |
| `prov/clean-machine` › redeploy and remove from clean machines | PROV-AC-006 | yes | 1 | milestone |
| `prov/test-stages` › naming, run IDs differ | COMPL-AC-004 | **no** (no cloud call) | 0 | main |
| `prov/test-stages` › interrupted run cleanup; token left behind | COMPL-AC-004 | yes | 1 | main |
| `prov/test-stages` › cleanup never removes prodcheck | COMPL-AC-004 | **no** (no cloud call) | 0 | main |
| `prov/deploy-recovery` › abort after-copy / after-code, re-run | COMPL-AC-008 | yes | 2 | milestone, no run stage |

The `_cloud` hooks (secrets, log bucket, stage-resource probe) never read or write D1.

## Usage estimates (plan §1 "Cloud usage limits")

The basis is unmeasured, so D-RUN must replace it with its before/after readings. A first deploy of the reference or template app writes ≈ 50 D1 rows: the framework and app migrations plus their `__framework_migrations` records, counted generously for DDL. It reads ≈ 20 rows. Its Cloudflare API requests (SST/Pulumi plus framework operations) are ≈ 60. A redeploy with no pending migration writes 0 rows, reads ≈ 10 and makes ≈ 40 requests. A schema-changing deploy (copy plus migration) writes ≈ 40 rows, reads ≈ 40 and makes ≈ 60 requests. A remove makes ≈ 25 requests. The hooks' read-only R2 token costs 4–5 requests once per test process, and a stage probe costs ≈ 5 requests. S3-endpoint reads (log keys, state home) count as R2 operations, not Cloudflare API requests.

| Test | D1 rows written | D1 rows read | Cloudflare API requests |
| --- | --- | --- | --- |
| CF-AC-001 | 0 | 0 | 0 (≈ 12 HTTP to the stage) |
| CF-AC-002 | ≈ 55 (deploy 50, KV put+delete with index ≈ 4) | ≈ 30 | ≈ 105 |
| PROV-AC-001 | ≈ 40 | ≈ 25 | ≈ 90 |
| PROV-AC-002 (no-D1 clauses) | 0 | 0 | ≈ 16 |
| PROV-AC-002 (D1 clauses) | ≈ 110 (deploy 50, fixture 8 rows + index ≈ 16, copy ≈ 40 dropped) | ≈ 100 | ≈ 230 |
| PROV-AC-003 | ≈ 105 | ≈ 50 | ≈ 200 |
| PROV-AC-004 | 0 | 0 | ≈ 45 |
| PROV-AC-006 | ≈ 52 | ≈ 35 | ≈ 135 |
| COMPL-AC-004 | ≈ 50 | ≈ 25 | ≈ 120 |
| COMPL-AC-008 | ≈ 260 (2 stages × first deploy 50 + 2 copies/migrations 40 each) | ≈ 150 | ≈ 420 |

**Per run of these tests**, excluding the run stage and other authors' tests:
- **Main pass:** CF-AC-001, CF-AC-002, PROV-AC-001, COMPL-AC-004. ≈ 145 rows written, ≈ 80 read, ≈ 315 API requests.
- **No-run-stage pass with the MIG criteria:** PROV-AC-002. ≈ 110 written, ≈ 100 read, ≈ 245 API requests.
- **Milestone pass:** PROV-AC-003, -004, -006 and COMPL-AC-008. ≈ 420 written, ≈ 235 read, ≈ 800 API requests.

**Total:** ≈ 675 D1 rows written, ≈ 415 read, ≈ 1,360 API requests. Each pass stays under 1,000 rows written. The milestone pass's API estimate exceeds the 500-per-item cap, so D-RUN-M should run COMPL-AC-008 in a pass of its own, after the other three (≈ 420 and ≈ 380 requests), and stop if a measurement passes the cap. No test generates data in loops or probes a limit.

## Parameter changes

None.

## Decisions

### DEC-PENDING-D-T-1 — Cloud test hooks: Cloudflare API without credentials, R2 reads through a short-lived read-only token
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: D-T2, DEC-0279, LOG-AC-004, SEC-AC-005, PROV-AC-002, E2E-011, E2E-012

`_cloud/index.ts` exports `cloudHooks(target)` with C-T1's `CloudHooks` interface (`core/support/stores.ts`). `_cloud/logs.ts` exports `listLogEntries`, and `_cloud/stage-resources.ts` exports `listStageResources`, both with DEC-0279's signatures.
- **Secrets.** The stage's Worker script is found by name (DEC-PENDING-D-T-2). `GET` and `DELETE /accounts/{a}/workers/scripts/{script}/secrets[/SECRET_<NAME>]` read and delete its secrets. That makes the store a test hook outside the framework.
- **Logs and state home.** One account API token per test process gets only "Workers R2 Storage Bucket Item Read" on `prototype-logs` and `sst-state` (DEC-0100's mechanism). It expires after 30 min and is deleted on `beforeExit`. Before creating one, the hook deletes its own expired or older-than-1-h tokens (`compliance-r2read-*`). Listing and reading go through R2's S3 endpoint with a SigV4 signer of its own: no undeclared dependency, and it was checked offline against aws4fetch. So polling a log key costs no Cloudflare API requests, which the 500-per-item cap needs. Bucket existence uses `GET /accounts/{a}/r2/buckets/{name}` (404 means absent).
- **Credentials.** No `Authorization` header is sent while a proxy is configured (plan §10.6). Without a proxy, `CLOUDFLARE_API_TOKEN` is sent as a bearer token and never printed. Every API request is counted per process and the count is printed on exit, so runs are countable.

### DEC-PENDING-D-T-2 — The stage-resource probe matches by name and includes the state home
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: D-T2, CF-AC-002, PROV-AC-003, COMPL-AC-004, E2E-012

Physical names are what SST generates (PROV §2), so the probe treats a resource as the stage's when its name contains both the app name and the stage name as delimited parts. This covers the Worker, the R2 bucket, the R2 API token, and the objects in `sst-state`. A run's stage carries 15 random characters, so no other stage can match.
- Databases use PROV-REQ-002's exact pattern.
- State-home objects are included because the Cloudflare `remove` must delete them (DEC-0084), and PROV-AC-003 says "no resource … of the removed stage".
- Log entries are excluded.
- Output strings are `database <name>`, `Worker <name>`, `R2 bucket <name>`, `R2 API token <id>` and `state object sst-state/<key>`.

If D-03 names the Worker, bucket or token without the stage name, the probe finds nothing and the tests that expect one resource per kind fail. A follow-up would then match on D-03's recorded identifiers.

### DEC-PENDING-D-T-3 — D1 stop and two-database cap are enforced inside the tests
Origin: ai-proposed · Status: accepted · Affects: DEC-0317, DEC-0318, D-RUN, D-RUN-M

`requireCloudD1()` blocks by default and passes only with `COMPLIANCE_CLOUDFLARE_D1=available`. The operator sets that variable once the reset is confirmed and the caps can be met. That way no D1 use happens by accident while DEC-0317 holds.

`requireDatabaseRoom(n)` counts the account's test-stage databases with one API request. It blocks when creating `n` more would hold more than two at once. Every further stage, D-T1's own and C-T1's, takes the same cross-process `further-stage` lock.

Consequences for D-RUN and D-RUN-M:
- PROV-AC-002's D1 clauses hold two databases (the failing migration's copy), so PROV-AC-002 belongs in the no-run-stage pass together with MIG-AC-002/-003/-006. Its record then holds all of its clauses (DEC-0264: the latest record decides an ID).
- PROV-AC-003 and COMPL-AC-008 hold two databases each, so they run in a milestone pass with no run stage.
- CF-AC-002 and COMPL-AC-004 fit the main pass: the run stage plus one further stage.

### DEC-PENDING-D-T-4 — Readings of CF-AC-001, CF-AC-002, PROV-AC-001
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CF-AC-001, CF-AC-002, PROV-AC-001

- **CF-AC-001:**
  - `/` and a random deep link answer the same HTML entry page.
  - Every script, stylesheet and modulepreload the page loads is on the stage's origin and answers 200 with a type other than HTML.
  - `/api/ref/deployment` answers JSON on that origin.
  - These paths each answer 404 with a JSON content type and a schema-valid `ErrorResponse` with code `HTTP.NOT_FOUND`: `/api`, a random path, a nested path, `/api/ref/<random>`, `/api/__framework/<random>`, and a POST.
- **CF-AC-002:** the run stage and one further stage are checked in two ways.
  - The probe shows one database, Worker, bucket and token per stage, with none shared.
  - Behaviourally:
    - A KV value and a file written on B are absent on A.
    - Upload tickets carry different SigV4 access keys and buckets.
    - The secret values differ by digest.
    - Deleting B's secret through the store makes B answer `SEC.MISSING` while A's value is unchanged.
  - Both stages' entries appear in `prototype-logs` under their own prefixes. The run stage's secret value is not needed, so the test does not depend on `COMPLIANCE_SECRET_API_KEY`.
- **PROV-AC-001 (Cloudflare):**
  - Every committed file of `apps/template` is the app definition, code, generated migrations, configuration values or standard package/tool metadata. No file is IaC, and no source or dependency names SST, Pulumi, wrangler, CDK or similar tools.
  - A scratch copy of exactly those files deploys and answers `/` and health 204.
  - The deploy leaves no new file outside the directories in the template's `.gitignore`.

### DEC-PENDING-D-T-5 — Readings of PROV-AC-002
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-AC-002, D-05

- **"One credential removed":** `CLOUDFLARE_API_TOKEN` is removed from the deploy's environment, on a stage never deployed before. The deploy must exit non-zero and name the variable. Afterwards the independent probe must find nothing of the stage.
- **"Lacks the permission to create R2 API tokens":** the test needs an operator-supplied restricted token (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`) and a machine without the sandbox proxy. The proxy replaces every Authorization header (DEC-0083), so this clause is `blocked` in this sandbox.
- **"Failing migration":** the fixture is loaded, then the `unique-fail` overlay is deployed. The output must name the migrate step, `0001_unique_label`, "previous version restarted" and a next action. Afterwards `schema-version` must be v1, the fixture dump unchanged, and one database left.
- **"Secret removed by a test hook after the preflight":** the deploy prints no progress before step 7 is known, so the hook deletes `apiKey` at the first output that shows a later step, or 20 s into the deploy. If the deploy still stopped at the preflight, the secret is set again and the test retries once at 45 s. The output must then name the health step and `SEC.MISSING`.
- A defective preflight could create a database despite a missing credential, so these stopped deploys also take the further-stage lock and check the database cap.

### DEC-PENDING-D-T-6 — PROV-AC-004 and PROV-AC-006 (Cloudflare part)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-AC-004, PROV-AC-006, plan §11 Q2

- **PROV-AC-004 idempotence:** after one `setup-account`, the test snapshots the account. The snapshot covers:
  - existence of the shared log bucket and the state home;
  - both buckets' settings, CORS and lifecycle;
  - every state-home object (key, ETag, last-modified, size);
  - every non-log-entry object of the log bucket;
  - a digest of the workers.dev subdomain.

  The snapshot must be identical after a second run.
- **PROV-AC-004 "deploying without it":** this needs an account where `setup-account` never ran. The test never deletes shared resources, so the clause runs only with `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1` and an absent log bucket; otherwise it is `blocked`.
- **PROV-AC-006 (Cloudflare part):** each "clean machine" is a fresh scratch copy (committed files only) with a fresh, empty HOME and XDG directories. Machine 1 deploys and writes a KV value. Machine 2 redeploys the same stage: it must succeed, keep the same single database and still see the value. Machine 3 removes the stage and nothing is left. The region part stays not-run ("AWS phase not started").

### DEC-PENDING-D-T-7 — Readings of COMPL-AC-004 and COMPL-AC-008
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-AC-004, COMPL-AC-008, D-05

- **COMPL-AC-004, naming:** the expected form `test-[a-z0-9]{PAR-291 − 5}` is read from parameters.md. It is checked for:
  - the run's stage;
  - the driver's generator and `newTestStage()`, each called twice, all distinct;
  - the stages of committed Cloudflare evidence records, all distinct.
- **COMPL-AC-004, interrupted run:** a deployed further stage is put in a temporary pending list. The real driver (`runCompliance`) then runs with real CLI stage operations and its real leftover check; only the test runners and the evidence writer are stubbed. Every resource still present afterwards must be named in the captured record's leftovers.
- **COMPL-AC-004, token left behind:** the stage's R2 API token is then re-created under its exact name and policies. A second driver cleanup whose removal skips the token must list the new token's ID among the leftovers. The token is deleted afterwards.
- **COMPL-AC-004, `prodcheck`:** a recording fake for the cloud operations shows that the driver never removes or checks `prodcheck`.
- **COMPL-AC-008:** two stages, one per abort point, are deployed at v1. Each is then deployed at v2 with the abort point, which must exit non-zero. A re-run must exit 0 and leave one database, health 204 and `schema-version` v2. The abort point's CLI form is D-05's; the assumption is the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT=after-copy|after-code`. If D-05 chooses another form, one constant in `prov/deploy-recovery.test.ts` changes.

### DEC-PENDING-D-T-8 — Gaps left to other items
Origin: ai-proposed · Status: accepted · Affects: D-05, D-RUN, C-02 driver, DEC-0277

- **apiKey driver extension not done.** The plan's "From phase C" block hands D-T2 a driver extension that generates the reference app's `apiKey` and sets it on the run stage. That block also passes the key as `COMPLIANCE_SECRET_API_KEY` and redacts it. The brief for this item limited edits to `{cf,prov}/`, `_cloud/` and this file, so `tests/compliance/harness/**` was not edited. Until an item does that edit, the SEC/HTTP/CORE criteria that need the value stay `blocked` on Cloudflare.
- **Driver leftover check still a stub.** `tests/compliance/harness/node-deps.ts` `targetOperations()` rejects until it is wired to D-03's Cloudflare `TargetOperations`. Until then COMPL-AC-004's token clause fails ("leftover check failed"), correctly.
- **C-T4 hook signatures already match.** `listLogEntries` and `listStageResources` match C-T4's expected signatures (`e2e/support/cloud.ts`), so no C-T4 follow-up is needed.
