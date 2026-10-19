# MIG — Migrations

Applies schema changes to deployed apps while preserving their data. Migrations are versioned and ordered, and each database records which ones it has. On the cloud, a deploy that changes the schema takes the app offline, builds a new migrated copy of the database, checks it, deletes the old database, and deploys the new version. Downtime during such deploys is accepted (DEC-0076).

Contracts: none app-facing. Migrations are generated files in the app repository. The migration checker's rules are part of CHECK.

## 1. Requirements

#### MIG-REQ-001 — Generated, paired, unedited migrations
Origin: provenance-unclear · Derives from: SYS-REQ-011, SYS-REQ-012

Each schema change MUST be captured as a migration generated from the app's table definitions, once per SQL dialect, and committed to the repository. Migration files MUST NOT be edited by hand once generated.

#### MIG-REQ-002 — Recorded migrations
Origin: provenance-unclear · Derives from: SYS-REQ-012

Each database MUST record which migrations it has, framework migrations first, then app migrations, in order. A deploy with no pending migrations MUST change no data and cause no downtime.

#### MIG-REQ-003 — Data preserved
Origin: owner · Derives from: SYS-REQ-012

A schema-changing deploy MUST preserve all existing data, except data a migration explicitly drops (a dropped table or column). If any migration or check fails, the deploy MUST stop with an error and leave the existing database unchanged; the app stays stopped until a deploy succeeds.

#### MIG-REQ-006 — Copy, migrate, check, replace
Origin: owner · Derives from: SYS-REQ-007, SYS-REQ-012

On cloud targets, a deploy with pending migrations MUST:
1. stop the running app;
2. copy the current database into a new one;
3. apply the pending migrations to the new database;
4. check it;
5. delete the old database as soon as the check passes;
6. deploy the new version using the new database.

The app is unavailable while this happens. After a successful deploy, no database other than the current one remains for the stage.

## 2. Design

**Generation.** drizzle-kit (PAR-103) generates two histories, `migrations/sqlite/` and `migrations/postgres/`, from the same table definitions. Framework tables (`__framework_kv`, `__framework_migrations`) have their own pair of histories shipped in the package. `generate-migration` records each new file's checksum in a committed `migrations/checksums.json`. The checker (CHECK) uses it to catch edited files offline, and verifies that both histories yield the same logical schema.

**Record.** `__framework_migrations(id, dialect, checksum, applied_at)` in each database.

**Schema-changing cloud deploy** (PROV runs these as one step):
1. **Stop the app.** On Cloudflare, delete the stage's Worker. On AWS, set the HTTP Lambda's concurrency to zero.
2. **Copy.** Create a new database: a new D1 database on Cloudflare, or a new database inside the stage's existing Aurora cluster on AWS. Copy every table into it page by page, parent tables before the tables that reference them.
3. **Migrate.** Apply the pending migrations to the new database. Nothing is live, so statements need not be atomic. On failure, delete the new database and stop.
4. **Check.** Every table that was not explicitly dropped has the same row count as before, references are intact, and the record lists every migration. On failure, delete the new database and stop.
5. **Delete** the old database.
6. **Deploy** the new version, bound to the new database (PROV), which restarts the app.

Databases are named `<app>-<stage>-db-<n>`, where `<n>` increases with each schema-changing deploy; the resolved configuration names the current one (CFG). Deploys are run by the owner from one place; the provisioning tool's own state locking prevents overlapping runs.

### Local
`dev` and `createTestApp` apply pending migrations in place: D1's batch call is atomic, and local data is disposable.

### Cloudflare
Copying and migrating use the D1 HTTP API from the CLI.

### AWS
Copying and migrating use the Data API from the CLI. Deployment first waits for the cluster to resume (PAR-210).

## 3. Uses

SQL (dialects, table definitions), PROV and CLI (invocation during deploy and dev), CFG (current database name), LOG.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| MIG-AC-001 | Generating from a changed schema produces one new migration per dialect; editing a generated migration makes the checker fail. | MIG-REQ-001 | Local |
| MIG-AC-002 | Initial deployment creates the schema. A second deployment with no changes neither changes data nor stops the app. The record lists every migration once. | MIG-REQ-002 | Local, cloud |
| MIG-AC-003 | With parent and child rows present, a schema change that adds, drops, and changes columns preserves every row and reference not explicitly dropped. A deliberately failing migration stops the deploy, leaves the existing database unchanged and no new database behind, and a re-run after fixing the migration succeeds. | MIG-REQ-003 | Local, cloud |
| MIG-AC-006 | After a successful schema-changing deploy, the stage has exactly one database, and requests made during the deploy failed rather than writing to the old database. | MIG-REQ-006 | Cloud |

## 5. Portability note

Migrations are plain SQL per dialect plus a record table. A new target needs only a way to create a database, copy rows, and run SQL from the CLI.

Retired IDs: MIG-REQ-004, MIG-REQ-005, MIG-AC-004, MIG-AC-005, MIG-OQ-1 (DEC-0076).
