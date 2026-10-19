# Root cause: CLI-AC-002 "verify fails on a Postgres-only failure (negative LIMIT)" — verify exits 0

Author: B-17 implementer (diagnosis only; no fix applied). Needs independent review (prompt §8) before any change.

## Symptom
`packages/framework/test/integration/cli/verify.test.ts` › "[CLI-AC-002] verify fails on a Postgres-only failure (negative LIMIT)" fails: `verify` exits 0. Its output shows the fixture test `tests/negative-limit.test.ts > negative limit returns every item` passing in both the `sqlite` and the `postgres` test process (run of 2026-10-19, B-17 branch, framework built from it).

## Evidence
1. The Postgres test process really uses the Postgres harness: in the same run, "[LOCAL-AC-003] … SELECT DISTINCT ordered by an unselected column makes verify fail" **passed** — that failure only occurs in the `postgres` process (`PROTOTYPE_FRAMEWORK_DIALECT=postgres`, PGlite). So dialect selection by `verify` works.
2. Probe `/tmp/…/scratchpad/probe/neg-limit.mjs` (PGlite PAR-107, drizzle-orm 0.45.4 PAR-102 from the workspace `node_modules`), output verbatim:
   ```
   raw literal LIMIT -1 -> error: LIMIT must not be negative
   raw param LIMIT $1=-1 -> error: LIMIT must not be negative
   drizzle SQL: {"sql":"select \"title\" from \"items\"","params":[]}
   drizzle -> 2 rows
   ```
3. The fixture (`test/fixtures/cli/pg-only/src/app.ts.fixture`, route `GET /items`) calls Drizzle's `.limit(c.req.valid("query").limit)` with `-1`.

## Causal chain
- Drizzle's pg-core query builder emits **no LIMIT clause** for a negative limit (evidence 2: generated SQL has no `limit`, params empty).
- So on PGlite the query is `select … from items`, which returns every row — exactly what the test expects on SQLite too (evidence 2: 2 rows).
- So the fixture test passes on both dialects, no step fails, and `verify` correctly exits 0.
- PostgreSQL itself does reject a negative LIMIT (evidence 2, raw queries), which is what DEC-0239 assumed; the assumption missed that Drizzle never sends it.

## Alternatives ruled out
- `verify` not running the Postgres process, or not setting the dialect: ruled out by evidence 1 (and the output lists a `tests (postgres)` run).
- The framework's SQL layer rewriting the limit: `grep limit src/sql/*.ts` finds no limit handling; the probe uses plain Drizzle without the framework and shows the same behaviour.

## Proposed fix (not applied; test-author item B-T4 owns the fixture)
The fixture needs a different supported, Postgres-only failure that Drizzle actually sends, e.g. comparing a text column with an integer-typed value in a way SQLite accepts and Postgres rejects, or `offset(-1)` if Drizzle sends it (to be probed the same way). Re-record DEC-0239. No CLI change.

## Verification plan
Probe the replacement query with the script above on PGlite (must error) and local D1 (must succeed), then rerun the test: `verify` must exit non-zero and name the fixture test.

## Review
(to be written by the reviewer)
