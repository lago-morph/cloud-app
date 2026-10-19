# Decision drafts — B-T2 (test cases: sql, mig, kv)

Suites: `packages/framework/test/integration/{sql,kv,mig}/`. Written from sql.md, kv.md, migrations.md, the contracts (`sql.d.ts`, `kv.d.ts`, `core.d.ts`, `testing.d.ts`, `errors.d.ts`, `framework.openapi.yaml`), DEC-0102…DEC-0106 and PAR-210…PAR-223, PAR-280; not from any implementation. Taken under the owner's "make an assumption and continue" instruction; each entry is open for review by the implementers named.

### DEC-PENDING-B-T2-1 — Framework suites select the SQL dialect with `PROTOTYPE_FRAMEWORK_DIALECT`
Origin: ai-proposed · Status: accepted · Affects: B-16 (`createTestApp`), B-17 (`verify`), LOCAL-REQ-003, core.md §2 "Testing", SQL-AC-001/-003…-006, KV-AC-001…-005

core.md and local.md fix the dialect per test-runner process but name no mechanism; spike A-10 says "an env var selecting the dialect (B-16)". The suites assume the variable `PROTOTYPE_FRAMEWORK_DIALECT` with values `sqlite` (local D1) and `postgres` (PGlite), read when the framework is loaded. It is defined once in `test/integration/sql/support/dialect.ts`; if B-16 chooses another name, only that constant changes. One entry file per dialect (`*.sqlite.test.ts`, `*.postgres.test.ts`) sets it and then imports its suite dynamically, so dialect-specific tables are built after selection; Vitest's `forks` pool gives each file its own process, so `npm run test:integration` covers both dialects in one run. A harness check (not a criterion) in `sql.suites.ts` proves the selection took effect: a 101-parameter query must fail on local D1 (PAR-216, DEC-0102) and succeed on PGlite.

### DEC-PENDING-B-T2-2 — `createTestApp` applies the app's generated migrations from the working directory
Origin: ai-proposed · Status: accepted · Affects: B-16, B-07, testing.d.ts ("migrations applied")

`createTestApp(app)` receives only the `DefinedApp`; the simplest reading of "fresh local storage, migrations applied" with `verify` running tests from the app root is that it applies the framework migrations and then the app's committed `migrations/<dialect>/` found from `process.cwd()`. The SQL suites therefore write a scratch app with the same tables (`sql/fixtures/schema.ts`, defined through an injected framework module so test process and CLI share one definition), run `generate-migration` there, and `chdir` into it for the test process. If `createTestApp` instead builds the schema from the definitions, the generated files are simply unused. The KV suites need no app tables and do not change directory.

### DEC-PENDING-B-T2-3 — How the suites reach the framework
Origin: ai-proposed · Status: accepted · Affects: B-16, B-17, B-RUN, plan §10.1

In-process code imports only the public hubs `src/index.ts` and `src/testing/index.ts` (the contracted names) and uses services only through a route of a `defineApp` app (`c.var.sql`, `c.var.kv`); a probe route runs a test closure inside a real request and returns its value or thrown error in memory, so `undefined`, JS types and `FrameworkError` instances are observed exactly as app code sees them. CLI behaviour is exercised through the package binary `bin/prototype-framework.js` in scratch app directories (copied from `apps/template` when present, minus sources/tests/migrations/state; `node_modules` symlinked to the workspace's). The binary loads `dist/`, so **the framework must be built (`npm run build -w packages/framework`) before `npm run test:integration`**; B-16/B-17/B-RUN wire that order. Scratch apps live in the OS temp directory and are removed after each file.

### DEC-PENDING-B-T2-4 — SQL-AC-001: what "rejected" and "valid name" mean
Origin: ai-proposed · Status: accepted · Affects: B-05, SQL-REQ-001, SQL-AC-001, SQL-AC-004

- "Rejected" = `defineTable` (or `defineApp` with the table) throws at definition time, so no database is created; any `Error` counts (no catalogue code is specified for schema errors).
- Table names must be lowercase ASCII snake_case starting with a letter, at most 63 bytes (Postgres' identifier limit: "valid on every target"), and not start with `__framework_`. Rejected fixtures: `Notes`, `notesList`, `notes-list`, `notes list`, `1notes`, `café`, `__framework_notes`, empty, 64 × `n`. Column keys must be ASCII lowerCamelCase whose snake_case name obeys the same rules (rejected: `Title`, `created_at`, `title-text`, `title text`, `ünicode`, `__frameworkX`, 64 × `a`). Index/unique entries naming a non-existent key are rejected.
- Composite primary keys, reference actions and SQL-expression defaults cannot be expressed through `sql.d.ts`; the suite asserts this at the type level (`@ts-expect-error`, enforced by `npm run typecheck`) and also forces each through with a cast and expects a run-time rejection. Auto-increment, generated and non-portable columns are forced in as Drizzle pg-core builders (`serial`, `generatedAlwaysAs`, `varchar`). Custom collations have no expression at all in the contract or in a portable builder; that clause is covered only by the absence of an API (not testable at run time).
- `.default()` values outside the column rule are rejected the same way (tagged SQL-AC-004).
- The identical-schema clause is checked by applying the generated histories to a fresh local D1 (`getPlatformProxy`) and a fresh PGlite and comparing introspected schemas: snake_case names, §2.1 physical type per dialect, NOT NULL, primary key, defaults, references with a "fail while referenced" action (`NO ACTION`/`RESTRICT`), unique sets and indexes. SQLite stores boolean defaults as 0/1 or `false`/`true`; the comparison reads both as booleans for boolean columns. The introspection harness was validated against hand-written drizzle-style DDL on real local D1 and PGlite (not committed).

### DEC-PENDING-B-T2-5 — SQL-AC-003…-006: value and failure expectations
Origin: ai-proposed · Status: accepted · Affects: B-05, B-06, SQL-AC-003…-006

- "Identical results" locally = the same literal expectations pass in both dialect processes; floats are compared with PAR-280's tolerance. Seed IDs are fixed, valid UUID v4 text so orderings ending in `id` are known.
- `containsText` folds the needle as well as the column (ASCII only): `ÀPPLE` matches `ÀPPLE and apple`, `àpple` does not.
- Value rules (SQL-AC-004): `id()` values must be UUID v4 text (`not-a-uuid` → `SQL.INVALID_VALUE`); NULL into a NOT NULL column → `SQL.INVALID_VALUE`; wrong JS types (e.g. `"1"` for `integer`, `1` for `boolean`) → `SQL.INVALID_VALUE`; the same rules apply to `update().set()`; a multi-row insert with one bad value writes nothing; `ref` to a missing row and deleting a referenced row → `SQL.CONFLICT` (SQL-REQ-006 "reference violation").
- `atomic` with a step built on the outer handle: SQL-REQ-005/`sql.d.ts` say "a catalogue error"; sql.md §2.2 says `CORE.INTERNAL`. The test accepts any catalogue code (the binding wording) and checks nothing was written.
- `SQL.RESULT_TOO_LARGE`: "larger than PAR-215" is strict, so a result of exactly 262,144 bytes (sql.md §2.3 measure) succeeds and one byte more fails.
- The Data API retry clause of SQL-AC-006 and the Cloudflare/Data API targets of SQL-AC-003…-006 are out of scope for B-T2 (AWS code is not built; cloud parts are later phases).

### DEC-PENDING-B-T2-6 — MIG-AC-001: the checker is judged through `verify`
Origin: ai-proposed · Status: accepted · Affects: B-07, B-15, B-17, MIG-AC-001

The migration checker has no contracted entry point other than `verify` (CLI-REQ-002 step 3). The test first runs `verify` on the unedited scratch app (must exit 0; the app has one test, because `verify` fails on zero tests), then appends a comment line to the first generated SQLite migration and expects a non-zero exit whose output names the edited file (assumption: CHECK diagnostics name the offending file). `migrations/checksums.json` must be JSON and mention each migration's base name. "One new migration per dialect" = exactly one new `.sql` file in each of `migrations/sqlite/` and `migrations/postgres/`, earlier files byte-identical.

### DEC-PENDING-B-T2-7 — MIG-AC-002/-003 local interpretation
Origin: ai-proposed · Status: accepted · Affects: B-07, B-17 (`dev`), MIG-AC-002, MIG-AC-003 (local)

Locally a "deployment" is a `dev` start: it applies pending migrations in place to the persistent local D1 database (migrations.md §2 "Local"). Hence: initial deployment = first `dev` start; second deployment with no changes = another `dev` start with the same sources, which must leave the whole database (schema, every row, the migration record including applied times) byte-for-byte equal and answer the health check and the app's routes; "neither stops the app" has no separate local meaning (local deploys are `dev` restarts) and is checked as "applies nothing". A failing deployment = `dev` exits non-zero instead of serving; "unchanged" = identical database snapshot; "no new database behind" = exactly one local D1 database file; "the old app answers again" = `dev` with version 2's sources and committed migrations serves the unchanged data; the re-run path tested is "after correcting the data". `dev`'s address is the first `http://localhost:<port>` it prints (LOCAL-REQ-004) on which `/api/__framework/health` answers 204; `dev` is stopped with SIGINT to its process group. The database is read from Miniflare's SQLite file under `.wrangler/state/**/d1/` after `dev` stops (Node's `node:sqlite`). These criteria are not run on PGlite: `dev` uses local D1 only, and PGlite exists only in test processes with fresh storage.

### DEC-PENDING-B-T2-8 — Recognising app migrations in `__framework_migrations`
Origin: ai-proposed · Status: accepted · Affects: B-07, MIG-REQ-002

The record's columns are `(id, dialect, checksum, applied_at)` (migrations.md §2) but the `id` format is not specified. The tests assume an app migration's `id` contains its file's base name (e.g. `0000_…`); every row is unique; rows not matching an app file are framework migrations (at least one), and all of them precede the app rows in insertion order, which follow file order.

### DEC-PENDING-B-T2-9 — KV ambiguities
Origin: ai-proposed · Status: accepted · Affects: B-08, KV-AC-001…-005

- KV-AC-002 says "empty … values are rejected", but KV-REQ-002 only rejects empty keys; the requirement wins: `put(k, "")` is accepted and `get` returns `""`.
- A malformed or over-long prefix is rejected with `KV.INVALID_KEY` (KV-REQ-002 and the catalogue: "Key or prefix"); the empty prefix and `limit` above PAR-222 are not tested (not in any criterion; clamp vs reject is unspecified).
- `nextCursor` is null whenever no item remains, including after a full page that exhausts the prefix (kv.d.ts "Null when there are no more items").
- "Database unreachable" locally = `createTestApp(app, { unavailable: ["sql"] })`; every KV operation must then fail with `KV.UNAVAILABLE`, not `SQL.UNAVAILABLE` (KV-REQ-005).
- KV-AC-004's local part is the same KV suite passing in both dialect processes; each KV test carries both its own ID and KV-AC-004.

## Parameter changes

None.
