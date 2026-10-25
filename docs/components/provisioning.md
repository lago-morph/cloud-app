# PROV — Provisioning

Creates, updates, and removes each stage's cloud resources from a target-neutral declaration. Runs deployments end to end: checks first, then database discovery, long-lived infrastructure, migrations, code, an explicit start, and a health check. Also performs the one-time account setup for the shared resources.

Contracts: [stage-config.schema.json](../contracts/schemas/stage-config.schema.json). Commands are listed in CLI.

## 1. Requirements

#### PROV-REQ-001 — Neutral declaration
Origin: owner · Derives from: SYS-REQ-023

A stage's resources MUST be derived from the app definition alone: the fixed capability set plus the declared secrets and configuration. Apps MUST contain no infrastructure-as-code and no target-specific resource declarations.

#### PROV-REQ-002 — Deployment sequence
Origin: provenance-unclear · Derives from: SYS-REQ-012, SYS-REQ-023 · Decision: DEC-0078, DEC-0079, DEC-0514, DEC-0515

`deploy` MUST perform these steps in order and stop at the first failure, exiting with failure status:
1. **Preflight.** Check that credentials are present and usable, without printing them, including, on Cloudflare, the permission to create R2 API tokens; that the configuration is valid; that required secrets are set (on a stage's first Cloudflare deploy, once the Worker exists: §2); for production stages, that the login provider's prerequisites are present: the account settings record names an email domain whose Email Sending entry is verified, and the credentials carry the email permissions of DEC-0515; and, on AWS, that the Aurora engine version (PAR-110) is offered in the recorded region with the Data API and the minimum capacity of PAR-212. Report every missing prerequisite by name. Nothing is created before this step passes. (The AWS engine check: deferred, branch `aws`.)
2. **Find the databases.** List the stage's databases whose names match `^<app>-<stage>-db-(\d+)$` exactly. The lowest-numbered one is current. Delete any higher-numbered one, which an interrupted run left behind, and print what was removed.
3. **Long-lived infrastructure.** Create or update the stage's long-lived infrastructure only (buckets, database cluster, roles), with no new app code. If the stage has no database, create the first one.
4. **Migrate.** If migrations are pending, run MIG-REQ-006 steps 1–5.
5. **Code.** Deploy the code and bindings, wired to the resolved configuration, the secret locations, and the current database.
6. **Start.** Explicitly restart the app (`startApp`, Per-target operations), without relying on the provisioning tool to undo a stop. This step runs on every deploy, whether or not migrations ran.
7. **Health check.** Call `GET /api/__framework/health` on the stage. On a cloud target, also send one CORS preflight to the stage's storage from the stage's public origin. The health route also checks `frameworkAuthSecret` (SEC). On failure, print the error code and requestId.

If a migration or its check fails in step 4, the CLI MUST delete the new database, restart the previous version against the unchanged database, and exit with failure status (MIG-REQ-003).

On any failure, the CLI MUST print the failed step; the failing migration file and the database error, where relevant; the stage's state (for example "previous version restarted; database db-3 unchanged"); and the next action (for example "fix and run deploy again").

Amendment (Origin: owner · Decision: DEC-0544, DEC-0545): a stage that `stop` stopped MUST stay stopped through a deploy unless `deploy` is given `--start`. Step 1 reads the stage record (§2 "Stage record"). Without `--start`, step 6 turns the app off again instead of starting it, step 7 is skipped and the output says that the stage is stopped and how to start it, and a failed migration leaves the previous version stopped. With `--start`, the record is cleared and steps 6 and 7 run as above. A deploy that copies the database MUST print which copy ran (on Cloudflare the native export/import or the row-by-row copy, with the reason).

#### PROV-REQ-003 — Removal
Origin: provenance-unclear · Derives from: SYS-REQ-024

`remove` MUST delete all of the named stage's resources, including secrets and other values the CLI created outside the infrastructure tool. It MUST NOT touch other stages or the account-level shared resources (PROV-REQ-004).

Amendment (Origin: owner · Decision: DEC-0543): before it deletes anything of a production stage (PROV-REQ-005), `remove` MUST back the stage up to the account's backup bucket: an export of each of its databases and a copy of each of its stored files. Only after both succeeded MAY it delete anything; if a backup step fails, it MUST delete nothing and exit with failure status. A test stage is removed without a backup.

#### PROV-REQ-004 — Account setup
Origin: owner · Derives from: SYS-REQ-021

`setup-account` MUST create the account's shared resources if they do not exist, and MUST change nothing if they do. On both clouds that is the shared log bucket; on AWS, also one network shared by all stages' databases (DEC-0074). Deployment MUST fail with a clear message if they are missing. A shared resource counts as existing only if this account owns it; otherwise `setup-account` and `deploy` stop with a clear message. (The AWS part: deferred, branch `aws`.)

Amendment (Origin: owner · Decision: DEC-0543): on Cloudflare the shared resources also include the backup bucket `prototype-backups`, whose lifecycle rule deletes every object PAR-311 after it was written.

Amendment (Origin: owner · Decision: DEC-0511, DEC-0514, DEC-0515): on Cloudflare the shared resources also include the email setup, all through the Cloudflare API and with no manual step. `setup-account --target cloudflare` MUST record the email domain (`--email-domain <domain>`, required while the account settings record has none) as the account settings record's single `emailDomain`; onboard that domain for Email Sending, listing the zone's sending subdomains first; and set up the mail sink of MAIL-REQ-005. It MUST check the email permissions of DEC-0515 first and name each missing one. Running it again with the same domain MUST change nothing; running it with another domain changes the record and sets up the new domain.

#### PROV-REQ-005 — Test stages
Origin: owner · Derives from: SYS-REQ-020 · Decision: DEC-0081

A stage MUST be treated as a test stage exactly when its name starts with `test-`. Test stages use the committed `config/<target>/test.json`. Every other stage is a production deployment and uses its own committed values file (CFG-REQ-002). A stage that is not a test stage MUST NOT contain the authentication mock (AUTH-REQ-009).

#### PROV-REQ-006 — Deployment settings are configuration
Origin: owner · Derives from: SYS-REQ-023

Region and other deployment settings MUST come from configuration or documented defaults, never from hard-coded values. The AWS region is an account setting chosen by `setup-account` (default PAR-060) and used by every stage in that account (DEC-0075). (The AWS region: deferred, branch `aws`.)

## 2. Design

SST (PAR-100) is the provisioning engine on both clouds (DEC-0036). It is driven entirely by framework code in `./provision`, which builds the SST app from the app definition, so apps never see SST. Resource lists per target are in CF-REQ-002 and AWS-REQ-003. (AWS: deferred, branch `aws`.)

**Credentials.** Cloud credentials come from the environment SST normally uses. The preflight step lists which are missing, by name only. On Cloudflare the one API token carries, besides the Workers, D1, R2, API-token and workers.dev permissions, the email permissions of DEC-0515: account Email Sending Write and Email Routing Addresses Write; zone Email Routing Rules Write, DNS Write, Zone Settings Write and Zone Read, for the email domain's zone.

**Errors** from these tooling commands are reported as messages with a non-zero exit status; they are not part of the runtime error catalogue.

**State home.** Each target's provisioning state, encrypted secrets and lock are kept in that target's own cloud (state home on AWS for AWS stages, on Cloudflare for Cloudflare stages). `setup-account` bootstraps it with the log bucket; it is a shared account resource that stage removal never touches. Account settings live with the shared resources, never only on the owner's machine: on AWS, the region is the log bucket's region. When `setup-account` records an AWS region, it makes the same engine check as the deploy preflight (PAR-110) and stops before creating anything if the region fails it. (The AWS parts: deferred, branch `aws`.)

**Stage resources.** `<app>-<stage>-<purpose>` is a logical name. App names contain no hyphens (PAR-290), so the app part of a name is unambiguous. Physical names are whatever the provisioning tool generates (with a unique suffix where the namespace is global) and are referenced by identifiers from stage state or the resolved configuration. On Cloudflare the names are fixed instead (DEC-0331): the Worker script `<app>-<stage>`, the R2 bucket `<app>-<stage>-files` and the R2 signing token `<app>-<stage>-files-signing`. Workers scripts, R2 buckets and account API tokens are named per account, so these are unique, and every operation finds the stage's resources from the stage name alone, including from a clean machine. IAM statements, `remove` and database deletion use those exact identifiers or the anchored database pattern, never `<app>-<stage>-*` wildcards.

**Databases.** App databases are created and deleted by the CLI and are never in the provisioning tool's state; the current database is passed to it as an input. Under MIG-REQ-006's ordering, the lowest-numbered existing database is always the current one, so deploy step 2 recovers from an interrupted run without a marker or lock.

**Removal.** `remove`:
- empties the stage's R2 and S3 buckets;
- deletes the stage's R2 API token;
- deletes the CLI-owned databases, matched by the exact database pattern;
- deletes the SSM parameters under `/<app>/<stage>/`;
- runs the provisioning tool with removal enabled: the generated provisioning configuration never retains resources, and the final Aurora snapshot is skipped;
- deletes any database-credentials secret without a recovery window, or uses an RDS-managed one.

If anything cannot be deleted, `remove` prints each leftover resource by name and exits non-zero.

**Backup before a production removal** (DEC-0543). For a stage not named `test-…` (which `remove` takes only with `--confirm-production <stage>`), `remove` first writes, on Cloudflare, under `prototype-backups/<app>/<stage>/<yyyymmddThhmmssZ>/`: `database/<database name>.sql`, D1's own export of each stage database (MIG §2 "Cloudflare"); `files/<key>`, each object of the stage bucket with its bytes and content type unchanged; and `manifest.json` (app, stage, time, databases, number of files), last. It lists the prefix again and requires every object it wrote. Then the removal steps above run. If any backup step fails (the bucket missing, an export, a file read, a write, the check), nothing is deleted, the failure is printed with "nothing was deleted; the stage is unchanged", and `remove` exits 1. Secrets are not backed up. The bucket's lifecycle rule deletes the backup after PAR-311. A test stage has no backup.

**Restoring a removed production stage** (Cloudflare, by hand; DEC-0543):
1. `deploy --target cloudflare --stage <s>` and set the app's secrets with `secrets set`, as for a new stage; then `stop --target cloudflare --stage <s>`.
2. Replace the new, empty database with the backup's export under the current database's name, so that it stays the lowest-numbered one: `npx wrangler d1 delete <app>-<s>-db-1`, `npx wrangler d1 create <app>-<s>-db-1`, `npx wrangler d1 execute <app>-<s>-db-1 --remote --file database/<name>.sql` (the file downloaded from the backup). The export is D1's own, so a row whose INSERT exceeds PAR-217 is refused and must be loaded by hand.
3. Copy the objects under `files/` back into `<app>-<s>-files` with tooling that keeps each key byte for byte (an S3 client on the R2 endpoint; keys end in U+0001, DEC-0430).
4. `deploy --target cloudflare --stage <s> --start`: it binds the Worker to the restored database, applies any newer migrations by the usual copy, and starts the stage.

**Stage record** (DEC-0544). Each stage may have one record in the target's state home, holding whether the owner stopped it: on Cloudflare the object `framework/<app>/<stage>/stage.json` in `sst-state`, `{ "stopped": true }`; no record means "not stopped". `stop` writes it after turning the app off; `start` and `deploy --start` delete it before turning the app on. `remove` deletes it with the stage's state objects, and `listStageResources` reports it (`stage record`) while it exists.

**Test and production stages.** Whether a stage is a test stage follows from its name alone (PROV-REQ-005), so it is fixed when the deployment is built and cannot change between deploys of the same stage. There is no flag or configuration setting for it.

**First Cloudflare deploy.** Worker secrets belong to the Worker, so they can be set only once the stage's Worker exists. On a stage's first Cloudflare deploy, the preflight therefore checks everything except the Worker secrets, and the CLI checks the required secrets right after step 5 has created the Worker. If any is unset, it stops the app (`stopApp`), names the missing secrets, and exits with failure status; the owner sets them with `secrets set` and runs deploy again.

**Publishing the result.** After a successful deploy, the CLI prints the public origin. For production stages, it also prints the sign-in page URL (`<public origin>/api/auth/sign-in`) and the sender address. There is nothing to register with a login provider (DEC-0513).

**Account settings record** (Cloudflare, DEC-0514). The JSON object `framework/account.json` in the state home bucket `sst-state`, `{ "emailDomain": "<domain>" }`, written only by `setup-account`. `deploy`, `check-login` and `mail --target cloudflare` read it on every run; nothing caches it in a committed file.

### Per-target operations

This section is informative. It collects the operations each target implements for the CLI and the runtime, so that the per-target stop, restart, database, secret and leftover handling is described in one place. MIG, SEC, LOG account setup and COMPL refer to it. Each target describes its implementation under "Deploy mechanics" in [cloudflare.md](cloudflare.md) and [aws.md](aws.md).

| Operation | Used by | What it does |
| --- | --- | --- |
| `createServices` | Runtime | Builds a request's capability services from the platform bindings. |
| `setupAccount` | `setup-account` | Creates or confirms the account's shared resources and state home, checks that the account owns them, and records the account settings (PROV-REQ-004). |
| `deploy` | `deploy` steps 3 and 5 | Runs the provisioning tool for the long-lived infrastructure, then for the code and bindings, with the current database as an input. |
| `remove` | `remove` | Performs the removal steps above (PROV-REQ-003). |
| `setSecret` | `secrets set`, deploy | Writes one secret value to its SEC-REQ-003 location. |
| `stopApp`, `startApp` | MIG-REQ-006 step 1, deploy step 6, failed migration (MIG-REQ-003), `stop`, `start` | Stops the app before a database copy without deleting its code, secrets or bindings; restarts it after every deploy and after a failed migration or check (DEC-0078), unless the stage is recorded as stopped (DEC-0544). |
| `readStageRecord`, `writeStageRecord` | Deploy step 1 and 6, `stop`, `start` | Reads and writes the stage record (DEC-0544). |
| `backupStage` | `remove` of a production stage | Writes the stage's backup before anything is deleted; deletes nothing (DEC-0543). |
| `createDatabase`, `copyDatabase`, `dropDatabase` | Deploy steps 2–4 (MIG) | Manage the CLI-owned databases. `copyDatabase` reports how it copied (DEC-0545). |
| `listStageResources` | Deploy step 2, `remove`, COMPL leftover check | Lists the stage's resources by exact identifier and the stage's databases by the exact database pattern. |

**Implementation** (`src/provision/core/`, DEC-0267…DEC-0271). The deploy, remove and setup-account sequences are target-neutral (`deploy.ts`, `remove.ts`, `setup-account.ts`) and call one interface, `TargetOperations` in `operations.ts`, which each target implements; the core never branches on the target. It refines the table above:
- `setupAccount` is split into `inspectAccount` (each shared resource `owned`, `absent` or `foreign`; reads only) and `createSharedResources` (creates the absent ones and records the account settings). The core refuses before any change when one is `foreign`, creates only absent ones, and so changes nothing on a second run. The deploy preflight uses `inspectAccount` too: `foreign` and `absent` both stop the deploy, the latter telling the owner to run `setup-account`.
- `deploy` is split into `deployInfrastructure` (step 3) and `deployCode` (step 5, returns the public origin). `preflight` returns the target's missing prerequisites by name; `checkHealth` performs step 7; `listSetSecrets` returns `null` while the stage's runtime does not exist, which defers the secret check to right after step 5.
- `migrationDatabase` gives MIG's record and atomic per-file application on one database (the same `MigrationDatabase` interface the local applier uses), and `checkMigratedDatabase` is MIG step 4's check.
- `remove` is split: for a production stage the core first calls `backupStage` and stops, deleting nothing, if it throws; then it deletes the databases that match the exact pattern, then calls `removeStage` for everything else, then lists the stage's resources again and reports each leftover.
- `stop` and `start` are `stop-start.ts`: `stopApp` then `writeStageRecord({ stopped: true })`; `writeStageRecord({ stopped: false })` then `startApp` (DEC-0544).

On a stage's first database (created in step 3 of the same run) the migrations are applied in place: no app is running and there is no data, so there is nothing to stop or copy. A failure while cleaning up after a failure (deleting the new database, restarting the previous version) is printed as well but never replaces the original failure or its exit status. The runner-only abort points are `after-copy` and `after-code`, a deploy request option that the CLI sets only for the compliance runner. `fake-target.ts` is an in-memory target for unit tests.

## 3. Uses

CFG, SEC, MIG, LOG, CF, AWS, CLI.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| PROV-AC-001 | The template app deploys to both clouds with no files other than its app definition, code, and configuration values. | PROV-REQ-001 | Cloud |
| PROV-AC-002 | With one credential removed, deploy names it and stops before creating anything. On Cloudflare, with a credential that lacks the permission to create R2 API tokens, deploy names that permission and stops before creating anything. A failing migration stops the deploy with failure status, the previous version answers again afterwards, and the output names the failed step, the migration file, the stage's state ("previous version restarted"), and the next action. With one declared secret unset on the deployed stage (removed by a test hook after the preflight), deploy fails at the health step and names the error code. A clean deploy passes the health check. | PROV-REQ-002 | Cloud |
| PROV-AC-003 | Removing one of two stages leaves the other stage and the shared resources intact, and leaves no resource, secret, or parameter of the removed stage except its log entries. | PROV-REQ-003 | Cloud (milestone) |
| PROV-AC-004 | Running `setup-account` twice changes nothing the second time, including in the state home, the account settings record and the email setup. Deploying without it fails with a clear message. With a token lacking one email permission of DEC-0515, `setup-account` and a production stage's `deploy` name that permission and change nothing. | PROV-REQ-002, PROV-REQ-004 | Cloud (milestone) |
| PROV-AC-005 | A local build check: building a deployment for stages whose names do not start with `test-` (for example `prod`, `prodcheck`, `mytest-1`) never yields a bundle containing the authentication mock or the mock-login route, and these builds read their own committed values file; building one for a stage named `test-<id>` includes the mock and reads `config/<target>/test.json`. | PROV-REQ-005 | Local |
| PROV-AC-006 | After `setup-account` with a non-default region, stages deploy to that region, including a deploy from a clean machine with no local CLI state. (The region part is AWS: deferred, branch `aws`; release 1 checks the clean-machine part on Cloudflare.) | PROV-REQ-006 | Cloud (milestone) |
| PROV-AC-007 | With the cloud's response stubbed so that an existing shared log bucket belongs to another account, `setup-account` and `deploy` stop with a message naming the bucket and change nothing. | PROV-REQ-004 | Local |

COMPL-AC-007 and COMPL-AC-008 (compliance.md §4) also verify PROV-REQ-002.

## 5. Portability note

The neutral declaration does not change for a new target. Only a new provisioner is added, implementing the per-target operations (§2), and it may use a different infrastructure tool (DEC-0019).
