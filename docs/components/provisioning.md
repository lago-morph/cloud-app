# PROV — Provisioning

Creates, updates, and removes each stage's cloud resources from a target-neutral declaration. Runs deployments end to end: checks first, then database discovery, long-lived infrastructure, migrations, code, an explicit start, and a health check. Also performs the one-time account setup for the shared resources.

Contracts: [stage-config.schema.json](../contracts/schemas/stage-config.schema.json). Commands are listed in CLI.

## 1. Requirements

#### PROV-REQ-001 — Neutral declaration
Origin: owner · Derives from: SYS-REQ-023

A stage's resources MUST be derived from the app definition alone: the fixed capability set plus the declared secrets and configuration. Apps MUST contain no infrastructure-as-code and no target-specific resource declarations.

#### PROV-REQ-002 — Deployment sequence
Origin: provenance-unclear · Derives from: SYS-REQ-012, SYS-REQ-023 · Decision: DEC-0078, DEC-0079, DEC-0514, DEC-0515, DEC-0550, DEC-0553

`deploy` MUST perform these steps in order and stop at the first failure, exiting with failure status:
1. **Preflight.** Check that credentials are present and usable, without printing them; that the account's shared resources exist (on Cloudflare including the backup bucket and its lifecycle rule, DEC-0543, and the R2 signing credential, DEC-0550; every absent one is named in one message that points to `setup-account`); that the configuration is valid; that required secrets are set (on a stage's first Cloudflare deploy, once the Worker exists: §2); for production stages, that the login provider's prerequisites are present: in v0.2.0 the account's auth app and its registry, with which the stage is bound and registered (plan-v0.2.0 §3; DEC-0698 replaces DEC-0553's email-domain check); and, on AWS, that the Aurora engine version (PAR-110) is offered in the recorded region with the Data API and the minimum capacity of PAR-212. Report every missing prerequisite by name. Nothing is created before this step passes. (The AWS engine check: deferred, branch `aws`.)
2. **Find the databases.** List the stage's databases whose names match `^<app>-<stage>-db-(\d+)$` exactly. The lowest-numbered one is current. Delete any higher-numbered one, which an interrupted run left behind, and print what was removed.
3. **Long-lived infrastructure.** Create or update the stage's long-lived infrastructure only (buckets, database cluster, roles), with no new app code. If the stage has no database, create the first one.
4. **Migrate.** If migrations are pending, run MIG-REQ-006 steps 1–5.
5. **Code.** Deploy the code and bindings, wired to the resolved configuration, the secret locations, and the current database.
6. **Start.** Explicitly restart the app (`startApp`, Per-target operations), without relying on the provisioning tool to undo a stop. This step runs on every deploy, whether or not migrations ran.
7. **Health check.** Call `GET /api/__framework/health` on the stage. On a cloud target, also send one CORS preflight to the stage's storage from the stage's public origin. The health route also checks `frameworkAuthSecret` (SEC). On failure, print the error code and requestId.

Amendment (Origin: ai-proposed · Decision: DEC-0550, DEC-0551, DEC-0553): `deploy` needs no permission to create or read API tokens, and no write permission on email. On Cloudflare the preflight no longer checks the permission to create R2 API tokens; the stages' R2 signing credential is an account resource that `setup-account` creates. A production stage's email prerequisites are read with "Zone Read" and "Email Sending Read", and a refusal names the permission.

If a migration or its check fails in step 4, the CLI MUST delete the new database, restart the previous version against the unchanged database, and exit with failure status (MIG-REQ-003).

On any failure, the CLI MUST print the failed step; the failing migration file and the database error, where relevant; the stage's state (for example "previous version restarted; database db-3 unchanged"); and the next action (for example "fix and run deploy again").

Amendment (Origin: owner · Decision: DEC-0544, DEC-0545): a stage that `stop` stopped MUST stay stopped through a deploy unless `deploy` is given `--start`. Step 1 reads the stage record (§2 "Stage record"). Without `--start`, step 6 turns the app off again instead of starting it, step 7 is skipped and the output says that the stage is stopped and how to start it, and a failed migration leaves the previous version stopped. A failure at or after step 5 (the code deploy, which may turn the app on before it fails, the deferred secrets check, the runner's after-code abort) also turns the app off again, and the failure's stage state says whether that worked; when it did not, the next action is `stop` (DEC-0556). With `--start`, the record is cleared and steps 6 and 7 run as above. A deploy that copies the database MUST print which copy ran (on Cloudflare the native export/import or the row-by-row copy, with the reason).

#### PROV-REQ-003 — Removal
Origin: provenance-unclear · Derives from: SYS-REQ-024

`remove` MUST delete all of the named stage's resources, including secrets and other values the CLI created outside the infrastructure tool. It MUST NOT touch other stages or the account-level shared resources (PROV-REQ-004).

Amendment (Origin: owner · Decision: DEC-0543): before it deletes anything of a production stage (PROV-REQ-005), `remove` MUST back the stage up to the account's backup bucket: an export of each of its databases and a copy of each of its stored files. Only after both succeeded MAY it delete anything; if a backup step fails, it MUST delete nothing and exit with failure status. A test stage is removed without a backup.

#### PROV-REQ-004 — Account setup
Origin: owner · Derives from: SYS-REQ-021

`setup-account` MUST create the account's shared resources if they do not exist, and MUST change nothing if they do. On both clouds that is the shared log bucket; on AWS, also one network shared by all stages' databases (DEC-0074). Deployment MUST fail with a clear message if they are missing. A shared resource counts as existing only if this account owns it; otherwise `setup-account` and `deploy` stop with a clear message. (The AWS part: deferred, branch `aws`.)

Amendment (Origin: owner · Decision: DEC-0543): on Cloudflare the shared resources also include the backup bucket `prototype-backups`, whose lifecycle rule deletes every object PAR-311 after it was written.

Amendment (Origin: owner · Decision: DEC-0511, DEC-0514, DEC-0515): on Cloudflare the shared resources also include the email setup, all through the Cloudflare API and with no manual step. `setup-account --target cloudflare` MUST record the email domain (`--email-domain <domain>`, required while the account settings record has none) as the account settings record's single `emailDomain`; onboard that domain for Email Sending, listing the zone's sending subdomains first; and set up the mail sink of MAIL-REQ-005. It MUST check the email permissions of DEC-0515 first and name each missing one. Running it again with the same domain MUST change nothing; running it with another domain changes the record and sets up the new domain.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §5.3, §6 · Decision: DEC-0698): the email setup is removed. There is no email domain, no Email Sending onboarding, no mail sink and no email permission check, and `setup-account` takes no `--email-domain`. On Cloudflare the account setup steps run from the admin app's Account setup page (plan-v0.2.0 §5.2 page 1). The v0.1.x email resources stay until the admin app's optional cleanup removes them; nothing removes them automatically (plan-v0.2.0 §8).

Amendment (Origin: ai-proposed · Decision: DEC-0550, DEC-0551): on Cloudflare the shared resources also include the stages' R2 signing credential: the account API token `prototype-r2-signing` and its record `framework/r2-signing.json` in the state home. `setup-account` creates it when absent, after checking that the credentials carry "Account API Tokens Write" and naming that permission if not. It is the only command that needs a permission on API tokens; the owner runs it with the setup token (owner-tasks).

Amendment (Origin: owner, plan-setup-wizard §4.3, §4.4 · Decision: DEC-0563, DEC-0577, DEC-0578): `setup-account` stays, for scripts and advanced users, as the account-setup step that `cloudflare-setup` calls with the bootstrap token (SETUP-REQ-001). It runs as named, idempotent steps, each inspected before it is applied, and writes the account setup record last; DEC-0551's setup token is replaced by the dashboard-made bootstrap token.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D10, §5.2 · Decision: DEC-0697, DEC-0698): `cloudflare-setup` no longer calls `setup-account`. On Cloudflare the account setup steps run from the admin app's Account setup page, through the signed-in admin's grant (setup.md §2). `setup-account` stays for scripts and advanced users, with the same named, idempotent steps and the same setup record.

#### PROV-REQ-005 — Test stages
Origin: owner · Derives from: SYS-REQ-020 · Decision: DEC-0081

A stage MUST be treated as a test stage exactly when its name starts with `test-`. Test stages use the committed `config/<target>/test.json`. Every other stage is a production deployment and uses its own committed values file (CFG-REQ-002). A stage that is not a test stage MUST NOT contain the authentication mock (AUTH-REQ-009).

#### PROV-REQ-006 — Deployment settings are configuration
Origin: owner · Derives from: SYS-REQ-023

Region and other deployment settings MUST come from configuration or documented defaults, never from hard-coded values. The AWS region is an account setting chosen by `setup-account` (default PAR-060) and used by every stage in that account (DEC-0075). (The AWS region: deferred, branch `aws`.)

## 2. Design

SST (PAR-100) is the provisioning engine on both clouds (DEC-0036). It is driven entirely by framework code in `./provision`, which builds the SST app from the app definition, so apps never see SST. Resource lists per target are in CF-REQ-002 and AWS-REQ-003. (AWS: deferred, branch `aws`.)

**Credentials.** Cloud credentials come from the environment SST normally uses. The preflight step lists which are missing, by name only.

Amendment (Origin: owner, plan-setup-wizard §4.1, §4.2 · Decision: DEC-0563, DEC-0564, DEC-0570, DEC-0574; supersedes DEC-0551's two lists): on Cloudflare every command reads its settings from the environment first, then from `.env.cloudflare` in the project root (PAR-340), and a value in both that differs is taken from the environment with a note naming the setting; nobody exports them by hand. The owner keeps two account API tokens, both made from pre-filled dashboard links (`deepLink`) and both checked against one versioned list (`provision/cloudflare/permissions.ts`, PAR-331). The tables below are generated from it (`node scripts/permission-tables.mjs`; a unit test fails when they drift, DEC-0602).
- the **everyday token** `prototype-framework`, in `CLOUDFLARE_API_TOKEN`, for every command: `deploy`, `remove` (a production stage's backup included), `stop`, `start`, `secrets set`, `check-login`, `admins`, `mail`, and the checks of `cloudflare-setup`. It has no permission on API tokens and no zone write permission; its R2 access reads the account setup record. The file's bootstrap token is never passed to these commands (DEC-0574).
<!-- permission-table: everyday -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Account | Email Sending Read | Email Sending Read | `2d5b4b1f6c89487bb7184c2c1dcd3bf1` |
| Zone | Zone Read | Zone Read | `c8fed203ed3043cba015a93ad1616f1f` |
| Zone | Analytics Read | Analytics Read | `9c88f9c5bce24ce7af9a958ba9c504db` |
| Zone | Email Routing Rules Read | Email Routing Rules Read | `1b600d9d8062443e986a973f097e728a` |
<!-- /permission-table -->
- the **bootstrap token** `prototype-framework-bootstrap`, in `CLOUDFLARE_BOOTSTRAP_TOKEN`, made in the dashboard because the API cannot create a token that holds "Account API Tokens Write". `cloudflare-setup` uses it only when the account setup is out of date or the everyday token lacks a permission, then the token deletes itself and its line in `.env.cloudflare` is commented out (PAR-342). `setup-account` run on its own takes it in `CLOUDFLARE_API_TOKEN`, as it took DEC-0551's setup token.
<!-- permission-table: bootstrap -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | Account API Tokens Edit | Account API Tokens Write | `5bc3f8b21c554832afc660159ab75fa4` |
| Account | Email Sending Edit | Email Sending Write | `5df633d6b41c42bcaf5b4a62b9d14b64` |
| Account | Email Routing Addresses Edit | Email Routing Addresses Write | `e4589eb09e63436686cd64252a3aebeb` |
| Account | Billing Read | Billing Read | `7cf72faf220841aabcfdfab81c43c4f6` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Zone | Email Routing Rules Edit | Email Routing Rules Write | `79b3ec0d10ce4148a8f8bdc0cc5f97f2` |
| Zone | DNS Edit | DNS Write | `4755a26eedb94da69e1066d98aa820be` |
| Zone | Zone Settings Edit | Zone Settings Write | `3030687196b94b638145a3953da2b699` |
| Zone | Zone Read | Zone Read | `c8fed203ed3043cba015a93ad1616f1f` |
| Zone | Analytics Read | Analytics Read | `9c88f9c5bce24ce7af9a958ba9c504db` |
<!-- /permission-table -->

`smoke` sends no Cloudflare API request and needs no token. DEC-0551 lists the calls behind each everyday permission; the account setup's steps are in cloudflare.md `setupAccount`.

**Cloudflare setup** (`cloudflare-setup`, plan-setup-wizard §4.3; [setup.md](setup.md)). The re-runnable command that reads the state and does only what is missing: local setup, the git-ignore warnings, both tokens' checks, the account and the setup record. In v0.2.0 (DEC-0697) the bootstrap token is used only to create the two OAuth clients, store their secrets, deploy the admin app and delete itself; the account setup steps (`setup-account`'s, PROV-REQ-004) and the everyday token are done in the admin app (setup.md §2). **Account switch:** when the tokens' account differs from the project's recorded one (`CLOUDFLARE_ACCOUNT_ID`), setup says that stages on the old account keep running and offers to remove them while the old token still works, then sets up the new account as needed and updates `CLOUDFLARE_ACCOUNT_ID`. It never moves a stage between accounts.

**Errors** from these tooling commands are reported as messages with a non-zero exit status; they are not part of the runtime error catalogue.

**State home.** Each target's provisioning state, encrypted secrets and lock are kept in that target's own cloud (state home on AWS for AWS stages, on Cloudflare for Cloudflare stages). `setup-account` bootstraps it with the log bucket; it is a shared account resource that stage removal never touches. Account settings live with the shared resources, never only on the owner's machine: on AWS, the region is the log bucket's region. When `setup-account` records an AWS region, it makes the same engine check as the deploy preflight (PAR-110) and stops before creating anything if the region fails it. (The AWS parts: deferred, branch `aws`.)

**Stage resources.** `<app>-<stage>-<purpose>` is a logical name. App names contain no hyphens (PAR-290), so the app part of a name is unambiguous. Physical names are whatever the provisioning tool generates (with a unique suffix where the namespace is global) and are referenced by identifiers from stage state or the resolved configuration. On Cloudflare the names are fixed instead (DEC-0331): the Worker script `<app>-<stage>` and the R2 bucket `<app>-<stage>-files`. The stages share the account's R2 signing credential (DEC-0550); a stage deployed before DEC-0550 may still have its own token `<app>-<stage>-files-signing`. Workers scripts, R2 buckets and account API tokens are named per account, so these are unique, and every operation finds the stage's resources from the stage name alone, including from a clean machine. IAM statements, `remove` and database deletion use those exact identifiers or the anchored database pattern, never `<app>-<stage>-*` wildcards.

**Databases.** App databases are created and deleted by the CLI and are never in the provisioning tool's state; the current database is passed to it as an input. Under MIG-REQ-006's ordering, the lowest-numbered existing database is always the current one, so deploy step 2 recovers from an interrupted run without a marker or lock.

**Removal.** `remove`:
- empties the stage's R2 and S3 buckets;
- deletes the stage's legacy R2 API token, if it has one and the credentials may list tokens (DEC-0550);
- deletes the CLI-owned databases, matched by the exact database pattern;
- deletes the SSM parameters under `/<app>/<stage>/`;
- runs the provisioning tool with removal enabled: the generated provisioning configuration never retains resources, and the final Aurora snapshot is skipped;
- deletes any database-credentials secret without a recovery window, or uses an RDS-managed one.

If anything cannot be deleted, `remove` prints each leftover resource by name and exits non-zero.

**Backup before a production removal** (DEC-0543). For a stage not named `test-…` (which `remove` takes only with `--confirm-production <stage>`), `remove` first stops the app and records the stop, as `stop` does, then waits for requests already in flight (`waitForInFlight`; on Cloudflare PAR-315), so nothing writes while the stage is copied (a stop that fails because the app no longer exists, on a retry after a partial removal, does not block it; any other failed stop deletes nothing); then it writes, on Cloudflare, under `prototype-backups/<app>/<stage>/<yyyymmddThhmmssZ>/`: `database/<database name>.sql`, D1's own export of each stage database (MIG §2 "Cloudflare"); for a database with a table D1's export does not keep exactly (a NUL in a text value, where D1's import stops, or an integer beyond ±2^53, which the export rounds; DEC-0096), found by a scan before the export (each table separately, in keyset pages by rowid, or by primary key for a WITHOUT ROWID table; a table whose scan D1 refuses counts as such a table), also `database/<database name>.lossless.json`, those tables' rows read row by row (each value `null`, a string, `{"textHex": "<hex>"}` for text that is not valid UTF-8, `{"integer": "<digits>"}`, `{"real": <number>}` or `{"blob": "<hex>"}`), and `database/<database name>.restore.sql`, the one file to restore that database from: D1's export, statement by statement in its order (a trigger's `BEGIN … END` body kept whole), with those tables' `INSERT` statements replaced in place by one `INSERT` per row with literals no import misreads (text as its stored bytes, `CAST(X'…' AS TEXT)`), so every row stays as near the rows it references as in the export, within the import's foreign-key deferral of about 4 KB (A-06). The backup fails, deleting nothing, when the export's statements for such a table are not the rows read (DEC-0556, DEC-0557); `files/000001`, `files/000002`, …, each object of the stage bucket in key order with its bytes and content type unchanged, under a numbered key because a stored key may be R2's full 1024 bytes; and `manifest.json` (app, stage, time, databases and their D1 UUIDs `databaseIds`, number of files, `fileObjects` mapping each numbered object to its original key, content type and size, and `lossless` naming each database's lossless files and tables), last. It lists the prefix again and requires every object it wrote. Then the removal steps above run. If any backup step fails (the bucket missing, an export, a file read, a write, the check), nothing is deleted, the failure is printed with "nothing was deleted" and the stage is left stopped, with the `start --target <t> --stage <s>` command that serves it again, and `remove` exits 1 (DEC-0557). Secrets are not backed up. The bucket's lifecycle rule deletes the backup after PAR-311. A test stage has no backup. Before backing up, `remove` lists the stage's existing backups (`<app>/<stage>/…`; a failed listing deletes nothing either); afterwards it prints every backup of the stage, the usable ones first and newest first, and flags as "do not restore from it" a backup without a manifest (it did not finish) or one whose database UUIDs are a strict subset of an earlier backup's (written by a retry after a partial removal had deleted some of those databases); a backup from an earlier lifetime of the stage holds other databases and flags nothing. Its closing line names the backup to restore from (DEC-0556, DEC-0557).

**Restoring a removed production stage** (Cloudflare, by hand; DEC-0543):
1. `deploy --target cloudflare --stage <s>` and set the app's secrets with `secrets set`, as for a new stage; then `stop --target cloudflare --stage <s>`.
2. Replace the new, empty database with the backup's export under the current database's name, so that it stays the lowest-numbered one: `npx wrangler d1 delete <app>-<s>-db-1`, `npx wrangler d1 create <app>-<s>-db-1`, `npx wrangler d1 execute <app>-<s>-db-1 --remote --file database/<name>.sql` (the file downloaded from the backup, from the prefix `remove` named to restore from). The export is D1's own, so a row whose INSERT exceeds PAR-217 is refused and must be loaded by hand. When the manifest's `lossless` lists the database, execute `database/<name>.restore.sql` instead of `database/<name>.sql` (`--file database/<name>.restore.sql`). Its rows of the listed tables write text and blobs as hex, twice their size, so such a row's statement can exceed PAR-217 sooner than in the export; a refused row is loaded by hand, as for the export.
3. Copy each object `files/<nnnnnn>` back into `<app>-<s>-files` under the original key its `fileObjects` entry in `manifest.json` names, with that content type, with tooling that keeps each key byte for byte (an S3 client on the R2 endpoint, with an R2 API token of the owner's own: the stages' signing credential is denied on `prototype-backups`, DEC-0550; keys end in U+0001, DEC-0430).
4. `deploy --target cloudflare --stage <s> --start`: it binds the Worker to the restored database, applies any newer migrations by the usual copy, and starts the stage.

**Stage record** (DEC-0544). Each stage may have one record in the target's state home, holding whether the owner stopped it: on Cloudflare the object `framework/<app>/<stage>/stage.json` in `sst-state`, `{ "stopped": true }`; no record means "not stopped". `stop` writes it after turning the app off; `start` and `deploy --start` delete it before turning the app on. `remove` deletes it with the stage's state objects, and `listStageResources` reports it (`stage record`) while it exists.

**Test and production stages.** Whether a stage is a test stage follows from its name alone (PROV-REQ-005), so it is fixed when the deployment is built and cannot change between deploys of the same stage. There is no flag or configuration setting for it.

**First Cloudflare deploy.** Worker secrets belong to the Worker, so they can be set only once the stage's Worker exists. On a stage's first Cloudflare deploy, the preflight therefore checks everything except the Worker secrets, and the CLI checks the required secrets right after step 5 has created the Worker. If any is unset, it stops the app (`stopApp`), names the missing secrets, and exits with failure status; the owner sets them with `secrets set` and runs deploy again.

**Publishing the result.** After a successful deploy, the CLI prints the public origin. For production stages, it also prints the public origin; in v0.2.0 there is no sign-in page and no sender address (DEC-0698). There is nothing to register with a login provider (DEC-0513).

**Account settings record** (Cloudflare, DEC-0514). The JSON object `framework/account.json` in the state home bucket `sst-state`, `{ "emailDomain": "<domain>" }`, written only by `setup-account`. `deploy`, `check-login` and `mail --target cloudflare` read it on every run; nothing caches it in a committed file. In v0.2.0 (DEC-0698) `emailDomain` is no longer written or read, and only `deploy` and the setup check read the record.

Amendment (Origin: owner, plan-setup-wizard §4.4 · Decision: DEC-0577, DEC-0578): the record is also the account **setup record**, `{ "emailDomain", "setupVersion", "frameworkVersion", "appliedAt", "completedSteps" }`: the account setup version the run applied (the release's `ACCOUNT_SETUP_VERSION`), the framework version that applied it and when (ISO time), and the setup steps (cloudflare.md `setupAccount`) found done or applied. It is written last, after every step succeeded, and only when it changes; other fields of the object are kept, and a changed domain is first written alone, without the setup fields. The everyday token reads it through the R2 object API. The account's setup is current for a release when the record's `setupVersion` is at least the release's version, it names the same email domain, and every step's inspection finds it done; a record without the setup fields (written before them) or with an invalid one counts as none, so the setup is not current. A higher stored `setupVersion` is kept when an older release re-runs setup on the same domain.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §5.2 page 1, §5.3 · Decision: DEC-0698): the admin app's Account setup page writes the record, and the email domain is no longer part of it or of "current". The setup is current when `setupVersion` is at least the release's `ACCOUNT_SETUP_VERSION` and every step's inspection finds it done.

**Signing record** (Cloudflare, DEC-0550). The JSON object `framework/r2-signing.json` in `sst-state`, `{ "tokenId", "accessKeyId", "secretAccessKey", "deniedBuckets" }`: the S3 credentials of the account's R2 signing token `prototype-r2-signing`, written only by `setup-account`, and the account buckets its token is denied on. Every `deploy` copies the credentials into the stage's framework-internal Worker secrets (step 5). The token grants "Workers R2 Storage Bucket Item Write" on the account's buckets and is denied on the account buckets (`prototype-logs`, `sst-state`, `prototype-mailsink`, `prototype-backups`), so a stage's Worker secret reaches stage buckets only. A record whose `deniedBuckets` lacks one of them (a token created before the backup bucket was added) counts as absent: `deploy` stops in step 1 and `setup-account` replaces the token. Its value is never printed.

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
| `listStageBackups` | `remove` of a production stage, before `backupStage` | Lists every backup of the stage, complete or not, with its numbers of databases and files; reads only (DEC-0556). |
| `createDatabase`, `copyDatabase`, `dropDatabase` | Deploy steps 2–4 (MIG) | Manage the CLI-owned databases. `copyDatabase` reports how it copied (DEC-0545). |
| `listStageResources` | Deploy step 2, `remove`, COMPL leftover check | Lists the stage's resources by exact identifier and the stage's databases by the exact database pattern. |

**Implementation** (`src/provision/core/`, DEC-0267…DEC-0271). The deploy, remove and setup-account sequences are target-neutral (`deploy.ts`, `remove.ts`, `setup-account.ts`) and call one interface, `TargetOperations` in `operations.ts`, which each target implements; the core never branches on the target. It refines the table above:
- `setupAccount` is split into `inspectAccount` (each shared resource `owned`, `absent` or `foreign`; reads only) and `createSharedResources` (creates the absent ones and records the account settings). The core refuses before any change when one is `foreign`, creates only absent ones, and so changes nothing on a second run. The deploy preflight uses `inspectAccount` too: `foreign` and `absent` both stop the deploy, the latter telling the owner to run `setup-account`.
- `deploy` is split into `deployInfrastructure` (step 3) and `deployCode` (step 5, returns the public origin). `preflight` returns the target's missing prerequisites by name; `checkHealth` performs step 7; `listSetSecrets` returns `null` while the stage's runtime does not exist, which defers the secret check to right after step 5.
- `migrationDatabase` gives MIG's record and atomic per-file application on one database (the same `MigrationDatabase` interface the local applier uses), and `checkMigratedDatabase` is MIG step 4's check.
- `remove` is split: for a production stage the core first calls `backupStage` and stops, deleting nothing, if it throws; then it deletes the databases that match the exact pattern, then calls `removeStage` for everything else, then lists the stage's resources again and reports each leftover.
- `stop` and `start` are `stop-start.ts`: `stopApp` then `writeStageRecord({ stopped: true })`; `writeStageRecord({ stopped: false })` then `startApp` (DEC-0544).

On a stage's first database (created in step 3 of the same run) the migrations are applied in place: no app is running and there is no data, so there is nothing to stop or copy. A failure while cleaning up after a failure (deleting the new database, restarting the previous version) is printed as well but never replaces the original failure or its exit status. After a failed migration or check, the restarted previous version gets step 7's health wait (one try per second, up to 30 s); the stage state says "previous version restarted" only once it answers healthy, and otherwise "previous version restarted but not answering (<status/code>)" (DEC-0561). The database copy's line (DEC-0545) is printed as soon as the copy returns, so also when a later step fails or the `after-copy` abort stops the deploy. The runner-only abort points are `after-copy` and `after-code`, a deploy request option that the CLI sets only for the compliance runner. `fake-target.ts` is an in-memory target for unit tests.

## 3. Uses

CFG, SEC, MIG, LOG, CF, AWS, CLI.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| PROV-AC-001 | The template app deploys to both clouds with no files other than its app definition, code, and configuration values. | PROV-REQ-001 | Cloud |
| PROV-AC-002 | With one credential removed, deploy names it and stops before creating anything. On Cloudflare, deploy needs no permission on API tokens: with a credential that has no "Account API Tokens" permission at all, the preflight passes and the deploy succeeds; without the account's R2 signing credential, deploy names it and `setup-account` and stops before creating anything (DEC-0550; this clause changes shared account state, so it runs in the milestone pass and, against the fake Cloudflare API, on every automated pass, DEC-0560). A failing migration stops the deploy with failure status, the previous version answers again afterwards, and the output names the failed step, the migration file, the stage's state ("previous version restarted"), and the next action. With one declared secret unset on the deployed stage (removed by a test hook after the preflight), deploy fails at the health step and names the error code. A clean deploy passes the health check. | PROV-REQ-002 | Cloud; signing-credential clause: Cloud (milestone) |
| PROV-AC-003 | Removing one of two stages leaves the other stage and the shared resources intact, and leaves no resource, secret, or parameter of the removed stage except its log entries. | PROV-REQ-003 | Cloud (milestone) |
| PROV-AC-004 | Running `setup-account` twice changes nothing the second time, including in the state home and the account settings record. Deploying without it fails with a clear message. With a token lacking "Account API Tokens Write" while the account's R2 signing credential is absent, `setup-account` names that permission and changes nothing. | PROV-REQ-002, PROV-REQ-004 | Cloud (milestone) |
| PROV-AC-005 | A local build check: building a deployment for stages whose names do not start with `test-` (for example `prod`, `prodcheck`, `mytest-1`) never yields a bundle containing the authentication mock or the mock-login route, and these builds read their own committed values file; building one for a stage named `test-<id>` includes the mock and reads `config/<target>/test.json`. | PROV-REQ-005 | Local |
| PROV-AC-006 | After `setup-account` with a non-default region, stages deploy to that region, including a deploy from a clean machine with no local CLI state. (The region part is AWS: deferred, branch `aws`; release 1 checks the clean-machine part on Cloudflare.) | PROV-REQ-006 | Cloud (milestone) |
| PROV-AC-007 | With the cloud's response stubbed so that an existing shared log bucket belongs to another account, `setup-account` and `deploy` stop with a message naming the bucket and change nothing. | PROV-REQ-004 | Local |

COMPL-AC-007 and COMPL-AC-008 (compliance.md §4) also verify PROV-REQ-002.

## 5. Portability note

The neutral declaration does not change for a new target. Only a new provisioner is added, implementing the per-target operations (§2), and it may use a different infrastructure tool (DEC-0019).
