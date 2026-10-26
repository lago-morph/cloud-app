# SQL and migrations

Read this when you define or change a table, write a query, need several writes to succeed or fail together, generate a migration, or a `verify` diagnostic names this file (`no-raw-sql`, `no-dialect-features`, `framework-order`, `no-transactions`, `no-relational-queries`, `framework-ids`, or a `migration-*` check).

The same query must return the same rows on SQLite (local, Cloudflare D1) and Postgres (AWS), so only a portable subset is allowed. `verify` runs your tests on both dialects.

## Tables

Define tables in `src/server/schema.ts` with `defineTable(name, columns, options?)` and list each one in `tables` in `src/app.ts`.

| Helper | Holds |
| --- | --- |
| `id()` | The primary key: lowercase UUID v4 text from `newId()`. Exactly one per table. Never set it to anything else, never update it. |
| `text()` | Unicode text without NUL; compared by code point |
| `integer()` | Signed 32-bit whole number |
| `number()` | Finite double |
| `timestamp()` | Epoch milliseconds (use `now()`) |
| `boolean()` | `true` / `false` |
| `ref(() => other.id)` | The `id` of a row in another table (UUID v4 text); that row cannot be deleted while referenced |

- Columns are NOT NULL unless you call `.nullable()`. `.default(value)` takes a static value only. `.unique()` makes one column unique.
- Options: `{ indexes: [["ownerId", "createdAt"]], uniques: [["postId", "label"]] }`, listing column keys.
- Table names are lowercase snake_case (`notes`, `share_links`), not starting with `__framework_` or `sqlite_`. Column keys are lowerCamelCase (`createdAt` becomes `created_at`).
- There is no JSON type: store structured data as text (`JSON.stringify`) and validate it with Zod when you read it.
- Rows keyed by a user-supplied value: `id()` plus a unique `text()` column. Join tables: `id()` plus a `uniques` entry over their two `ref` columns.
- A value that breaks its column's rule is refused before the database with 400 `SQL.INVALID_VALUE`, for writes and for comparisons alike: `eq(notes.id, "no-such-note")` is 400 `SQL.INVALID_VALUE`, not "no row", because the value is not a UUID. Validate IDs from requests with `z.uuid()` first ([http-and-validation.md](http-and-validation.md)).

## Queries

Use `c.var.sql` (type `PortableDb`) and the expressions exported by `@lago-morph/prototype-framework`.

| Allowed | Not allowed |
| --- | --- |
| `select`, `selectDistinct`, `insert`, `update`, `delete` | Raw SQL (Drizzle's `sql` template), `execute`, `run`, `all`, `get`, `values`, `$client` |
| Inner and left joins | Right, full and cross joins, lateral joins, `union` and other set operations, `.for(…)` |
| Subqueries; `$with` for select-only common table expressions | Common table expressions that insert, update or delete |
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`, `isNull`, `isNotNull`, `inArray`, `notInArray`, `between`, `containsText` | `like`, `ilike`, `exists` and other Drizzle operators |
| `count`, `countDistinct`; `min`/`max` on text, integer, number, timestamp; `sum`/`avg` on integer and number | Window functions, full-text search, JSON operators, other aggregate types |
| The framework's `asc` and `desc`; `limit`, `offset` | Drizzle's own `asc`/`desc` or any other ordering |
| Upsert against a declared unique constraint; `.returning({ … })` | `.transaction()`, `.batch()`, `db.query.*` |

Results:

- `asc` puts NULLs first, `desc` puts NULLs last. Text sorts by code point. `containsText(column, needle)` is a literal, case-insensitive (ASCII A–Z only) substring match.
- End every paginated order with the `id` column (`orderBy(desc(notes.createdAt), desc(notes.id))`) so the order is total and identical on every target.
- `count`, `countDistinct`, `sum`, `avg` return JS numbers; every aggregate except the counts returns null on empty input.
- A write without `.returning()` resolves to nothing. To learn which rows a write changed, use `.returning({ id: t.id })` and check its length.
- A `select` result larger than 256 KiB (PAR-215, text bytes plus 8 bytes per other value) fails with `SQL.RESULT_TOO_LARGE` on every target: always `limit` lists and select only the columns you need. A write's `returning` rows are never refused for their size, because the write has already been saved; ask `returning` only for the columns you need, such as `id`.
- Split long `inArray` lists and multi-row inserts into chunks of at most 100 bound parameters (PAR-216) per statement; local D1 enforces this, so `verify` catches it.
- A uniqueness or reference violation is 409 `SQL.CONFLICT`. An unreachable database (45 s budget, PAR-210) is 503 `SQL.UNAVAILABLE`. Let these propagate; never throw `SQL.*` yourself.

Common needs within the subset:

- Instead of arithmetic in SQL, read the row, compute in JS, and write it back; to detect a concurrent change, add the old value to the update's `where` and check `.returning({ id })`.
- Compute fallbacks for NULL, lowercased text and sums across columns in JS after selecting.

## Several writes at once

`atomic(db, steps)` commits all steps or none. Each step is a synchronous function that builds one write on the handle it receives:

`await atomic(c.var.sql, [(w) => w.insert(parents).values({ … }), (w) => w.insert(children).values({ … })])`

Build every write on the step's own `w`, never on `c.var.sql`; do not `await` inside a step, and do not read in a step. Read first, decide in JS, then call `atomic`. It resolves to one result per step (the RETURNING rows, or `undefined`). See `loadEvolution` in [examples/notes-sql.md](../examples/notes-sql.md).

## Migrations

1. Change the tables in `src/server/schema.ts`.
2. Run `npm run generate-migration` (or `npm run generate-migration -- --name <slug>`). It writes a pair of files, `migrations/sqlite/<nnnn>_<slug>.sql` and `migrations/postgres/<nnnn>_<slug>.sql`, plus snapshots under `meta/`, and records their checksums in `migrations/checksums.json`.
3. Commit all of them. Never edit a generated file. A migration that was never deployed to any cloud stage may be deleted (both files, their `meta/` snapshots) and generated again.
4. `npm run verify` checks both histories give the same schema and that only supported changes are used.

Supported changes: add a table; add a column that is nullable or has a static default; drop a column; drop a table; add or drop an index or a unique constraint.

Not supported: renaming a table or column, changing a column's type, nullability, default or primary key, adding a NOT NULL column without a static default to an existing table. Use **add-copy-drop** instead:

1. A migration adds the new column (nullable, or with a static default).
2. App code writes both columns, and an admin route (or a read-modify-write on access) copies old values into the new column.
3. Once every row is copied and nothing reads the old column, a later migration drops it.

`generate-migration` refuses a change that both removes and adds tables, or both removes and adds columns of one table: generate the drop and the add as separate migrations.

Locally, `dev` and `createTestApp` apply pending migrations. On a cloud, `deploy` applies them: it stops the app, copies the database, migrates and checks the copy, then switches to it; the app is unavailable meanwhile, and a failure leaves the old database and version running (see [deploying.md](deploying.md)).

## Check rules that send you here

- `prototype-framework/no-raw-sql`: raw SQL or a low-level execution API. Rewrite with the query builder and "Common needs" above.
- `prototype-framework/no-dialect-features`: a query feature outside the "Allowed" column, or an aggregate on the wrong column type. Use the allowed form or compute in JS.
- `prototype-framework/framework-order`: ordering not made by the framework's `asc`/`desc`. Import `asc`/`desc` from `@lago-morph/prototype-framework`.
- `prototype-framework/no-transactions`: `.transaction()` or `.batch()`. Use `atomic`.
- `prototype-framework/no-relational-queries`: `db.query` or `relations`. Write the join with `select … innerJoin/leftJoin`.
- `prototype-framework/framework-ids`: an `id()` value that is not `newId()`, or an update of an `id()` column. Generate IDs with `newId()`; keep user-chosen keys in a unique `text()` column.
- `prototype-framework/migration-checksums`: a migration file was edited, or not made by `generate-migration`. Restore the generated file; for an undeployed migration, delete it and generate again.
- `prototype-framework/migration-history`: file names are not `<nnnn>_<slug>.sql` numbered from 0000 without gaps, or the two dialects differ in file names. Only `generate-migration` should create files.
- `prototype-framework/migration-apply`: a migration fails to apply; the message has the database error.
- `prototype-framework/migration-supported-changes`: an unsupported change. Use add-copy-drop.
- `prototype-framework/migration-dialects`: the two histories give different schemas. Regenerate the undeployed pair.

## Examples

- [examples/notes-sql.md](../examples/notes-sql.md): a table, guarded insert and list routes, the generated migrations, and `atomic` with a join.

## Stopping condition

Stop reading when your tables use only the helpers above, your queries use only the allowed column, a migration pair has been generated and committed for every schema change, and `npm run verify` passes on both dialects.
