# MIG — Migrations

Applies schema changes to deployed apps while preserving their data: versioned, ordered migrations recorded in a ledger, applied on deployment and when local development starts.

Contracts: none app-facing. Migrations are generated files in the app repository. The migration checker's rules are part of CHECK.

## 1. Requirements

#### MIG-REQ-001 — Generated, paired, immutable migrations
Origin: provenance-unclear · Derives from: SYS-REQ-011, SYS-REQ-012

Each schema change MUST be captured as a migration generated from the app's table definitions, once per SQL dialect, and committed to the repository. Migration files MUST NOT be edited by hand. A migration that has been applied anywhere MUST NOT change; a checksum enforces this.

#### MIG-REQ-002 — Ordered, recorded, repeatable application
Origin: provenance-unclear · Derives from: SYS-REQ-012

Deployment, and the start of local development, MUST apply pending migrations in order: framework migrations first, then app migrations. Each migration MUST apply atomically, and its application MUST be recorded in a ledger in the same database. Running again with nothing pending MUST change nothing.

#### MIG-REQ-003 — Data preserved
Origin: provenance-unclear · Derives from: SYS-REQ-012

Applying migrations MUST preserve existing rows. A change that cannot be applied safely MUST be rejected before anything is applied. Dropping and recreating data MUST NOT be used as a substitute for a migration mechanism that fails.

#### MIG-REQ-004 — One run at a time
Origin: provenance-unclear · Derives from: SYS-REQ-012

At most one migration run MAY be active per stage database; a second run MUST fail without applying anything.

#### MIG-REQ-005 — Schema readiness
Origin: owner-approved · Derives from: SYS-REQ-012

A deployment whose database has not yet reached the schema its build expects MUST answer requests that use SQL or KV with `SQL.SCHEMA_NOT_READY` instead of running against the older schema.

## 2. Design

**Generation.** drizzle-kit (PAR-103) generates two histories, `migrations/sqlite/` and `migrations/postgres/`, from the same table definitions. Framework tables (`__framework_kv`, `__framework_migrations`) have their own pair of histories shipped in the package. The migration checker (CHECK) verifies three things:
- Applying either history yields the same logical schema: tables, columns, types, nullability, defaults, indexes, uniqueness, and references.
- Only portable changes are used.
- Checksums of applied migrations are unchanged.

**Supported changes.** Creating and dropping tables, adding columns (nullable or with a default), dropping columns, and creating and dropping indexes and unique constraints. Changes SQLite can only make by rebuilding a table are allowed in the generated rebuild pattern only. The rebuild runs as one atomic unit, and row counts and reference integrity are checked before commit. Because references never cascade (SQL-REQ-001), a rebuild cannot silently delete referencing rows (DEC-0050).

**Ledger.** `__framework_migrations(id, dialect, checksum, applied_at)`. A lock row in the same table serializes runs. A lock left behind by a crashed run is cleared only by an explicit CLI option, after the operator has confirmed no run is active.

**Readiness.** The build embeds the ID of the latest migration. Each runtime instance reads the ledger before its first SQL or KV use. If the database is behind, the instance answers `SQL.SCHEMA_NOT_READY` and re-checks at most every PAR-211.

### Local
`dev` and `createTestApp` apply both histories to their local databases: local D1, and PGlite when the Postgres dialect is selected.

### Cloudflare
Migrations must run atomically against the remote D1 database. The pinned drizzle-kit's remote D1 path sends one statement per HTTP call, which loses atomicity for rebuilds (DEC-0050); it is not used. Two candidate mechanisms exist:
- the D1 HTTP API's batch execution, if it proves atomic for a whole migration;
- otherwise, a framework-internal migration route in the deployed Worker that applies the migration through the D1 binding's batch interface. Only the deploy process can call this route, authenticated with a per-deploy secret.

Which one is used is decided by testing early (open question MIG-OQ-1).

### AWS
Each migration runs inside one Data API transaction. Deployment waits for the database to resume (PAR-210) before starting.

## 3. Uses

SQL (dialects, Drizzle tables), PROV and CLI (invocation during deploy and dev), SEC (per-deploy migration credential on Cloudflare), LOG.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| MIG-AC-001 | Generating from a changed schema produces one new migration per dialect; editing an applied migration makes the checker fail. | MIG-REQ-001 | Local |
| MIG-AC-002 | Initial deployment creates the schema; a second deployment with no changes applies nothing; the ledger lists every migration once. | MIG-REQ-002 | Local, cloud |
| MIG-AC-003 | With parent and child rows present, an incremental migration (including a SQLite table rebuild) preserves every row and reference. A deliberately failing migration leaves the schema and data unchanged. | MIG-REQ-003 | Local, cloud |
| MIG-AC-004 | Two concurrent runs against one stage: exactly one applies, and the other fails without changes. | MIG-REQ-004 | Local, cloud |
| MIG-AC-005 | With the database one migration behind the build, an SQL route returns 503 `SQL.SCHEMA_NOT_READY`; after migration, it succeeds without a redeploy. | MIG-REQ-005 | Local, cloud |

## 5. Open questions

- **MIG-OQ-1:** Which atomic remote mechanism to use on Cloudflare (see Cloudflare section). Resolve by testing the D1 HTTP batch API first.

## 6. Portability note

Migrations are plain SQL per dialect plus a ledger table. A new target with a supported dialect needs only a runner that can apply one migration atomically.
