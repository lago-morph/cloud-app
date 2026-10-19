# SQL — Portable SQL

Portable schema definition, the supported query subset, value rules that make results identical on every target, and all-or-nothing writes of several rows.

Contracts: [sql.d.ts](../contracts/ts/sql.d.ts), [errors.d.ts](../contracts/ts/errors.d.ts) (`SQL.*`).

## 1. Requirements

#### SQL-REQ-001 — Portable schema
Origin: owner-approved · Derives from: SYS-REQ-011

App tables MUST be defined only with `defineTable` and the portable column types in §2.1. Columns are NOT NULL unless declared nullable. SQL-expression defaults, generated columns, auto-increment, composite primary keys, custom collations, and reference actions other than "fail while referenced" are not supported. Table and column names MUST be lowercase ASCII snake_case, valid on every target, and MUST NOT use the reserved `__framework_` prefix. Column object keys MUST be lowerCamelCase; the framework maps each key to its snake_case SQL name (Drizzle casing). The keys of the app's `tables` record are informative only. Every table MUST have exactly one `id()` column, which is its primary key.

#### SQL-REQ-002 — Supported query subset
Origin: owner-approved · Derives from: SYS-REQ-011

App code MUST be limited to the query features in §2.3. The portability rules (CHECK) MUST reject anything else (DEC-0041).

#### SQL-REQ-003 — Identical results
Origin: owner-approved · Derives from: SYS-REQ-011

Every supported query MUST return the same rows and values on every target, given the same data, and the same order whenever its ordering is total (it ends in a unique column):
- `asc` sorts NULLs first and `desc` sorts NULLs last.
- Text compares by code point.
- `containsText` folds case for ASCII A–Z only.
- `min` and `max` return the column's type; `count`, `countDistinct`, `sum`, and `avg` return JS numbers. Every aggregate other than `count` and `countDistinct` returns null on empty input.

#### SQL-REQ-004 — Value rules
Origin: provenance-unclear · Derives from: SYS-REQ-011

Values written MUST satisfy their column's rule in §2.1; violations MUST be rejected with `SQL.INVALID_VALUE` before reaching the database. Values read MUST be returned in the documented JS types. Writes without `returning` MUST resolve to no value (`void`) on every target; `.returning({ id })` is the portable way to detect which rows a write affected.

#### SQL-REQ-005 — All-or-nothing multi-row writes
Origin: provenance-unclear · Derives from: SYS-REQ-011

`atomic(db, steps)` MUST commit all steps or none, on every target. Before executing anything, and on every target, it MUST reject with a catalogue error any step whose write was not built on the handle passed to it.

#### SQL-REQ-006 — Normalized failures
Origin: owner-approved · Derives from: SYS-REQ-010

A uniqueness or reference violation MUST surface as `SQL.CONFLICT`. A database that cannot be reached within PAR-210, including while a paused database resumes, MUST surface as `SQL.UNAVAILABLE`. A result larger than PAR-215 MUST surface as `SQL.RESULT_TOO_LARGE` on every target, so a query that works locally cannot fail only on AWS. Driver-specific errors MUST NOT reach app code.

## 2. Design

### 2.1 Column types

| Helper | SQLite | Postgres | Rule |
| --- | --- | --- | --- |
| `id()` | text primary key | text primary key | UUID v4 from `newId()`; immutable |
| `text()` | text | text | Well-formed Unicode; no NUL |
| `integer()` | integer | integer | Signed 32-bit integral number |
| `number()` | real | double precision | Finite; negative zero stored as zero |
| `timestamp()` | integer | bigint | Non-negative safe integer, epoch milliseconds |
| `boolean()` | integer (boolean mode) | boolean | Actual boolean |
| `ref(() => t.id)` | text references | text references | Must reference an existing row; referenced rows cannot be deleted |

There is no JSON column type; structured data is stored as text (DEC-0060). `.default()` takes a static value checked against the same rule.

On Postgres, code-point text ordering comes from the database's C collation: every database is created with C collation and copies inherit it (MIG §2, AWS), so no per-column `COLLATE` is needed, including for `__framework_kv`. The local PGlite database is created with `LC_COLLATE 'C'` and `LC_CTYPE 'C'`: PGlite's default database orders by code point but folds non-ASCII in `lower()` (DEC-0106).

### 2.2 Implementation

Drizzle ORM (PAR-102) provides the query builder for both dialects (DEC-0038). The build selects the dialect per target, and `defineTable` constructs the corresponding Drizzle table with snake_case casing, so lowerCamelCase column keys become snake_case SQL names. Public types are the Postgres-compatible ones. `Table` and `Column` carry the table's literal name from `defineTable`, so Drizzle types left-join fields as nullable; the `tables` record accepts any defined table (`AnyTable`); `sum` and `avg` are typed as JS numbers to match the normalization below (DEC-0103). Results are normalized where drivers differ:
- `count`, `sum`, and `avg` from Postgres may arrive as strings; they are converted to numbers, and unsafe integers raise `SQL.INVALID_VALUE`.
- `boolean` and `timestamp` values are converted to their JS types.

`containsText` is implemented with `lower()` and a substring-position function, not `LIKE`. That makes `%`, `_`, and `\` literal, and both SQLite's `lower()` and Postgres `lower()` under the C collation fold only ASCII. The function is `instr` on SQLite and `strpos` on Postgres, chosen from the column's dialect; the needle is folded in JS (A–Z only) and bound as a parameter, so an empty needle matches every non-NULL value (DEC-0139). Ordering helpers emit explicit `NULLS FIRST` / `NULLS LAST`.

**Handles.** `PortableDb` and `WriteDb` are restricted at run time too: plain objects exposing only their contract members (`select`, `selectDistinct`, `insert`, `update`, `delete`, `$with`, `with`; `WriteDb` only the three writes), so raw execution, `batch`, `transaction` and `db.query` are absent. Every builder made through a handle is wrapped: awaiting it or calling `execute()` runs the query through the adapter's guard (failure mapping and budget below), turns a write result without rows into `undefined`, and checks the result size (DEC-0137).

**`atomic`.** On D1, the steps are built once and submitted as one batch. On the Data API, the framework opens a transaction, invokes each step factory against the transaction's handle, awaits the writes in order, and commits, rolling back on error. Builders captured from the ordinary handle are never awaited inside the transaction, because they would run outside it (an earlier observation, DEC-0050; verify early). So, on every target, `atomic` first checks that each step's write was built on the handle passed to it, and otherwise rejects with `CORE.INTERNAL` before executing anything. Locally, PGlite follows the Data API path: inside the transaction all steps are built first, checked, then executed in order. A builder made on a step's handle cannot be executed by app code (awaiting it rejects with `CORE.INTERNAL`), so an `async` step cannot run its write early. A handle not made by the framework is `CORE.INTERNAL`; empty input resolves to `[]` without touching the database (DEC-0138).

**Writes.** Drivers return different result shapes for writes without `returning`; the framework discards them, so such writes resolve to `void` everywhere.

**Failures.** Each operation (one query, or one whole `atomic` call) runs through a guard. A `FrameworkError` passes through. Otherwise the driver error's cause chain is inspected: Postgres SQLSTATE `23505`/`23503` or SQLite `UNIQUE`/`PRIMARY KEY`/`FOREIGN KEY constraint failed` is `SQL.CONFLICT` (generic message); a closed PGlite instance, a disposed local D1 binding, or a connection-level failure is `SQL.UNAVAILABLE`; anything else is `CORE.INTERNAL`, whose message (logged, never returned for status 500) carries the driver's message. An operation that has not settled within PAR-210 is `SQL.UNAVAILABLE` too. A forced outage (`createTestApp`'s `unavailable: ["sql"]`) makes every operation `SQL.UNAVAILABLE` without running it. Every `SQL.UNAVAILABLE` is logged once through `logFailure` when the adapter is given the request's log (DEC-0140).

**Result size** is checked on every result the handle returns: select rows, RETURNING rows, and the per-step results of `atomic` (all together). A write's RETURNING result that is too large fails after the write has committed, on every target alike (DEC-0137).

**Schema checks.** `defineTable` checks the definition when the schema module is imported and throws `CORE.MISCONFIGURED` naming the table and the broken rule: table names match `^[a-z][a-z0-9]*(_[a-z0-9]+)*$`, are at most 63 characters (the Postgres identifier limit) and do not start with `sqlite_`; column keys match `^[a-z][a-zA-Z0-9]*$` and each upper-case letter becomes `_` plus its lower case (`createdAt` → `created_at`), at most 63 characters; every column is made by a framework helper; exactly one `id()`; options are only `indexes` and `uniques`, whose entries list known keys, without repeats, and no unique column set is declared twice. `id()` takes no `.nullable()`, `.unique()` or `.default()`. Indexes, unique constraints and foreign keys get explicit names (`<table>_<columns>_idx`, `<table>_<columns>_unique`, `<table>_<column>_fk`), which must also fit in 63 characters. A `ref` resolves lazily (so tables may reference each other) and must return another table's `id()` column (DEC-0132).

**Value checks.** Each column's rule runs where Drizzle binds a value for that column, so a value that breaks it raises `SQL.INVALID_VALUE` while the query is built, before the database sees it, for writes and for comparisons alike. Drizzle binds no value for NULL and fills omitted columns itself, so the drivers also check the rows given to `insert().values()`, `update().set()` and an upsert's `set`: NULL only in nullable columns, a value for every NOT NULL column without a default, and no change to an `id()` column. `id()` and `ref()` values must be lowercase UUID v4 text, the form `newId()` makes (DEC-0133).

**Dialect per process.** The dialect is read once per process from `PROTOTYPE_FRAMEWORK_DIALECT` (`sqlite`, the default, or `postgres`); Worker bundles leave it unset. `defineTable` builds the table for that dialect and keeps a dialect-neutral definition, from which the other dialect's table is built on demand for migration generation (DEC-0134).

**Local drivers.** Local D1 is used through its Worker binding (Wrangler's `getPlatformProxy` in Node, DEC-0105), PGlite in-process. The D1 driver (`src/sql/d1.ts`) is the only driver module a Worker runtime imports; the PGlite harness (`src/sql/postgres.ts`) is Node-only and hands the guard its own unreachable-database message, so no Worker bundle names it (DEC-0196). Each PGlite harness database is an in-memory instance loaded from a data directory made once per process, holding an empty database created from `template0` with `LC_COLLATE 'C'` and `LC_CTYPE 'C'` (DEC-0106, DEC-0135).

### 2.3 Supported query features

| Supported | Not supported |
| --- | --- |
| `select` / `selectDistinct`, `insert`, `update`, `delete` | Raw SQL and low-level execution APIs |
| Inner and left joins | Right and full outer joins |
| Subqueries; select-only common table expressions (`$with`) | Data-modifying common table expressions |
| The comparison, boolean, null, `inArray`, and `between` expressions exported by `sql.d.ts`; `containsText` | `like`/`ilike` and other dialect-specific operators |
| `count`, `countDistinct`; `min` / `max` on `text`, `integer`, `number`, and `timestamp` columns; `sum` / `avg` on `integer` and `number` columns | Other aggregate argument types; window functions, full-text search, JSON operators |
| Ordering with the framework's `asc` / `desc`; `limit` / `offset` | Other ordering helpers |
| Upsert against a declared unique constraint; `returning` | Triggers, stored procedures, views |
| `atomic` for multi-row writes | Interactive transactions, `.batch()`, relational `db.query` |

`no-dialect-features` (CHECK) enforces the aggregate argument types, with failing fixtures for `max(boolean)` and `sum(text)`.

**Result size.** A result's size is the sum of the UTF-8 byte lengths of its text values, plus 8 bytes for every other non-NULL value. Results larger than PAR-215 fail on every target.

**Example** (informative). Define, insert, select with `where`, `orderBy` and `limit`, update, delete. This example is also a passing fixture for the portability rules (CHECK-REQ-005).

```ts
import { defineTable, id, text, integer, timestamp, ref, newId, now, eq, and, gte, desc, type PortableDb } from "<package>";

export const notebooks = defineTable("notebooks", { id: id(), name: text().unique() });
export const notes = defineTable("notes", {
  id: id(),
  notebookId: ref(() => notebooks.id),
  title: text(),
  body: text().nullable(),
  views: integer().default(0),
  createdAt: timestamp(),
}, { indexes: [["notebookId", "createdAt"]] });

export async function example(db: PortableDb, notebookId: string, since: number) {
  const noteId = newId();
  await db.insert(notes).values({ id: noteId, notebookId, title: "First", createdAt: now() });

  const recent = await db
    .select({ id: notes.id, title: notes.title, body: notes.body })
    .from(notes)
    .where(and(eq(notes.notebookId, notebookId), gte(notes.createdAt, since)))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(20);

  const renamed = await db
    .update(notes)
    .set({ title: "Renamed" })
    .where(eq(notes.id, noteId))
    .returning({ id: notes.id });
  const found = renamed.length === 1;

  await db.delete(notes).where(eq(notes.id, noteId));
  return { recent, found };
}
```

**Common needs** (informative). How to meet frequent needs within the subset:
- Paginated queries end their ordering with `desc(t.id)` (or `asc(t.id)`), so the order is total and identical on every target.
- Instead of in-SQL arithmetic, read the row, compute the new value in JS, and write it back; to detect a concurrent change, add the old value to the update's `where` and check `.returning({ id })`.
- Compute derived values (fallbacks for NULL, lowercased text, sums across columns) in JS after selecting.
- Rows keyed by a user-supplied value use `id()` plus a unique `text()` column holding that value.
- Join tables use `id()` plus a `uniques` entry over their two reference columns.
- Split long `inArray` lists and multi-row inserts into chunks of at most PAR-216 bound parameters and PAR-217 bytes of SQL per statement. Local D1 enforces both, so `verify` catches an oversized statement (DEC-0102).

### Local
The local D1 database runs under Wrangler. App tests can also run against PGlite (PAR-107), an in-process Postgres, to catch Postgres-dialect failures without AWS (DEC-0039). Neither proves Data API behavior.

### Cloudflare
D1 through its Worker binding.

### AWS
Aurora Serverless v2 PostgreSQL through the RDS Data API (DEC-0037), from Lambdas outside any VPC. The Data API requires the database credentials to be held in AWS Secrets Manager. Provisioning creates that one framework-internal secret there; app secrets still use SSM SecureString (DEC-0012, DEC-0061). The Data API's "database resuming" error is retried with exponential backoff and jitter until PAR-210 is exhausted, then surfaced as `SQL.UNAVAILABLE`. The retry loop takes its clock and its error source as inputs, so it is tested locally with an injected error. Aurora capacity and pause settings are PAR-212 and PAR-213. Data API responses are limited to PAR-214, which is why the portable result limit PAR-215 exists.

## 3. Uses

CFG (cluster and credentials-secret identifiers on AWS, supplied by provisioning), LOG (unavailability events).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SQL-AC-001 | A schema using every column type and option creates identical logical schemas on SQLite and Postgres, with lowerCamelCase keys mapped to snake_case SQL names; schemas with each unsupported feature or invalid name, and tables with no or two `id()` columns, are rejected. | SQL-REQ-001 | Local |
| SQL-AC-002 | The portability rules reject a fixture for each excluded query feature, including `max(boolean)` and `sum(text)`, and accept realistic fixtures using every supported one, including the §2.3 example. | SQL-REQ-002 | Local |
| SQL-AC-003 | One query suite covering every supported feature returns identical results on local D1, PGlite, Cloudflare D1, and the Data API. It includes NULL ordering, accented and mixed-case text, `containsText` edge cases (empty needle, `%`, `_`, `\`, NULL), empty-input aggregates, `min` / `max` result types, and writes with and without `returning` (without it, the write resolves to `undefined`; `.returning({ id })` lists exactly the affected rows). | SQL-REQ-003, SQL-REQ-004 | Local, cloud |
| SQL-AC-004 | Boundary values for each column type (for example 2147483647 and 2147483648 for `integer`, unpaired surrogates for `text`) are accepted or rejected identically on every target. | SQL-REQ-004 | Local, cloud |
| SQL-AC-005 | An `atomic` call whose last step violates a constraint leaves no rows from earlier steps, on every target. An `atomic` call with a step whose write was built on the outer handle is rejected before any step executes, on every target. | SQL-REQ-005 | Local, cloud |
| SQL-AC-006 | A duplicate unique value yields `SQL.CONFLICT`; a query whose result exceeds PAR-215 yields `SQL.RESULT_TOO_LARGE` on every target. Locally and deterministically, with a "database resuming" error injected into the Data API adapter on every attempt, the retry loop gives up at PAR-210 and returns `SQL.UNAVAILABLE`. | SQL-REQ-006 | Local, cloud |

## 5. Portability note

The contract is ordinary relational SQL with a fixed type set; any managed SQLite- or Postgres-compatible database fits. A new target replaces only the driver adapter and its error mapping.

## 6. Open questions

- **SQL-OQ-1 — D1 bound-parameter and statement-size limits.** Resolved by DEC-0102: local D1 enforces the same limits (PAR-216, PAR-217) with the same errors, so no portable limit, catalogue code or criterion is added. Original question: D1 limits the bound parameters per statement and the statement size, so a long `inArray` list or multi-row insert could pass `verify` and fail only on Cloudflare. Early spike: check whether local D1 enforces the same limits. If it does not, add a portable limit enforced on every target, with one catalogue code and an acceptance criterion using one more bound parameter than D1 allows.
