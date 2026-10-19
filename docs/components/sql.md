# SQL — Portable SQL

Portable schema definition, the supported query subset, value rules that make results identical on every target, and all-or-nothing writes of several rows.

Contracts: [sql.d.ts](../contracts/ts/sql.d.ts), [errors.d.ts](../contracts/ts/errors.d.ts) (`SQL.*`).

## 1. Requirements

#### SQL-REQ-001 — Portable schema
Origin: owner-approved · Derives from: SYS-REQ-011

App tables MUST be defined only with `defineTable` and the portable column types in §2.1. Columns are NOT NULL unless declared nullable. SQL-expression defaults, generated columns, auto-increment, composite primary keys, custom collations, and reference actions other than "fail while referenced" are not supported. Table and column names MUST be lowercase ASCII snake_case, valid on every target, and MUST NOT use the reserved `__framework_` prefix.

#### SQL-REQ-002 — Supported query subset
Origin: owner-approved · Derives from: SYS-REQ-011

App code MUST be limited to the query features in §2.3. The portability rules (CHECK) MUST reject anything else (DEC-0041).

#### SQL-REQ-003 — Identical results
Origin: owner-approved · Derives from: SYS-REQ-011

Every supported query MUST return the same rows, values, and order on every target, given the same data:
- `asc` sorts NULLs first and `desc` sorts NULLs last.
- Text compares by code point.
- `containsText` folds case for ASCII A–Z only.
- Aggregates return JS numbers, or null on empty input.

#### SQL-REQ-004 — Value rules
Origin: provenance-unclear · Derives from: SYS-REQ-011

Values written MUST satisfy their column's rule in §2.1; violations MUST be rejected with `SQL.INVALID_VALUE` before reaching the database. Values read MUST be returned in the documented JS types.

#### SQL-REQ-005 — All-or-nothing multi-row writes
Origin: provenance-unclear · Derives from: SYS-REQ-011

`atomic(db, steps)` MUST commit all steps or none, on every target.

#### SQL-REQ-006 — Normalized failures
Origin: owner-approved · Derives from: SYS-REQ-010

A uniqueness or reference violation MUST surface as `SQL.CONFLICT`. A database that cannot be reached within PAR-210, including while a paused database resumes, MUST surface as `SQL.UNAVAILABLE`. A result larger than PAR-215 MUST surface as `SQL.RESULT_TOO_LARGE` on every target, so a query that works locally cannot fail only on AWS. Driver-specific errors MUST NOT reach app code.

## 2. Design

### 2.1 Column types

| Helper | SQLite | Postgres | Rule |
| --- | --- | --- | --- |
| `id()` | text primary key | text primary key | UUID v4 from `newId()`; immutable |
| `text()` | text | text `COLLATE "C"` | Well-formed Unicode; no NUL |
| `integer()` | integer | integer | Signed 32-bit integral number |
| `number()` | real | double precision | Finite; negative zero stored as zero |
| `timestamp()` | integer | bigint | Non-negative safe integer, epoch milliseconds |
| `boolean()` | integer (boolean mode) | boolean | Actual boolean |
| `ref(() => t.id)` | text references | text references | Must reference an existing row; referenced rows cannot be deleted |

There is no JSON column type; structured data is stored as text (DEC-0060). `.default()` takes a static value checked against the same rule.

### 2.2 Implementation

Drizzle ORM (PAR-102) provides the query builder for both dialects (DEC-0038). The build selects the dialect per target, and `defineTable` constructs the corresponding Drizzle table. Public types are the Postgres-compatible ones. Results are normalized where drivers differ:
- `count`, `sum`, and `avg` from Postgres may arrive as strings; they are converted to numbers, and unsafe integers raise `SQL.INVALID_VALUE`.
- `boolean` and `timestamp` values are converted to their JS types.

`containsText` is implemented with `lower()` and a substring-position function, not `LIKE`. That makes `%`, `_`, and `\` literal, and both SQLite's `lower()` and Postgres `lower()` under the C collation fold only ASCII. Ordering helpers emit explicit `NULLS FIRST` / `NULLS LAST`.

**`atomic`.** On D1, the steps are built once and submitted as one batch. On the Data API, the framework opens a transaction, invokes each step factory against the transaction's handle, awaits the writes in order, and commits, rolling back on error. Builders captured from the ordinary handle are never awaited inside the transaction, because they would run outside it (an earlier observation, DEC-0050; verify early).

### 2.3 Supported query features

| Supported | Not supported |
| --- | --- |
| `select` / `selectDistinct`, `insert`, `update`, `delete` | Raw SQL and low-level execution APIs |
| Inner and left joins | Right and full outer joins |
| Subqueries; select-only common table expressions (`$with`) | Data-modifying common table expressions |
| The comparison, boolean, null, `inArray`, and `between` expressions exported by `sql.d.ts`; `containsText` | `like`/`ilike` and other dialect-specific operators |
| `count`, `countDistinct`, `min`, `max`, `sum`, `avg` | Window functions, full-text search, JSON operators |
| Ordering with the framework's `asc` / `desc`; `limit` / `offset` | Other ordering helpers |
| Upsert against a declared unique constraint; `returning` | Triggers, stored procedures, views |
| `atomic` for multi-row writes | Interactive transactions, `.batch()`, relational `db.query` |

**Result size.** A result's size is the sum of the UTF-8 byte lengths of its text values, plus 8 bytes for every other non-NULL value. Results larger than PAR-215 fail on every target.

### Local
The local D1 database runs under Wrangler. App tests can also run against PGlite (PAR-107), an in-process Postgres, to catch Postgres-dialect failures without AWS (DEC-0039). Neither proves Data API behavior.

### Cloudflare
D1 through its Worker binding.

### AWS
Aurora Serverless v2 PostgreSQL through the RDS Data API (DEC-0037), from Lambdas outside any VPC. The Data API requires the database credentials to be held in AWS Secrets Manager. Provisioning creates that one framework-internal secret there; app secrets still use SSM SecureString (DEC-0012, DEC-0061). The Data API's "database resuming" error is retried with exponential backoff and jitter until PAR-210 is exhausted, then surfaced as `SQL.UNAVAILABLE`. Aurora capacity and pause settings are PAR-212 and PAR-213. Data API responses are limited to PAR-214, which is why the portable result limit PAR-215 exists.

## 3. Uses

CFG (cluster and credentials-secret identifiers on AWS, supplied by provisioning), LOG (unavailability events).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SQL-AC-001 | A schema using every column type and option creates identical logical schemas on SQLite and Postgres; schemas with each unsupported feature or invalid name are rejected. | SQL-REQ-001 | Local |
| SQL-AC-002 | The portability rules reject a fixture for each excluded query feature and accept realistic fixtures using every supported one. | SQL-REQ-002 | Local |
| SQL-AC-003 | One query suite covering every supported feature returns identical results on local D1, PGlite, Cloudflare D1, and the Data API. It includes NULL ordering, accented and mixed-case text, `containsText` edge cases (empty needle, `%`, `_`, `\`, NULL), and empty-input aggregates. | SQL-REQ-003 | Local, cloud |
| SQL-AC-004 | Boundary values for each column type (for example 2147483647 and 2147483648 for `integer`, unpaired surrogates for `text`) are accepted or rejected identically on every target. | SQL-REQ-004 | Local, cloud |
| SQL-AC-005 | An `atomic` call whose last step violates a constraint leaves no rows from earlier steps, on every target. | SQL-REQ-005 | Local, cloud |
| SQL-AC-006 | A duplicate unique value yields `SQL.CONFLICT`; a query whose result exceeds PAR-215 yields `SQL.RESULT_TOO_LARGE` on every target. Against a paused Aurora cluster, a request either succeeds after resume or returns `SQL.UNAVAILABLE` within PAR-210. | SQL-REQ-006 | Local, cloud |

## 5. Portability note

The contract is ordinary relational SQL with a fixed type set; any managed SQLite- or Postgres-compatible database fits. A new target replaces only the driver adapter and its error mapping.
