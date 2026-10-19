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

Reviewer: independent root-cause reviewer (prompt §8 step 2); did not diagnose, write the code, or write the test. Date: 2026-10-19.

**Verdict: ACCEPTED.**

### Links checked
1. *Drizzle 0.45.4 emits no LIMIT for a negative number.* Confirmed in source and at runtime. `node_modules/drizzle-orm/pg-core/dialect.js:286` (and `sqlite-core/dialect.js:213`, `buildLimit`): `typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql\` limit ${limit}\` : void 0`. Independent probe (`/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/b17review/probe.mjs`, drizzle-orm 0.45.4 and PGlite 0.5.8 from a node_modules built from the same `package-lock.json`), output:
   ```
   pg limit(-1) {"sql":"select \"id\", \"title\" from \"items\"","params":[]} -> 2 rows
   pg limit(1)  {"sql":"select \"id\", \"title\" from \"items\" limit $1","params":[1]} -> 1 rows
   sqlite drizzle limit(-1): {"sql":"select \"id\", \"title\" from \"items\"","params":[]}
   ```
   The `limit(1)` control shows limits are otherwise sent. The SQLite builder drops it too, so neither dialect ever sees `LIMIT -1`.
2. *So the fixture's query returns every row on both dialects and its test passes on both.* Follows from 1: the fixture (`test/fixtures/cli/pg-only/src/app.ts.fixture`, `GET /items`) passes `-1` straight to `.limit()`, and the fixture test expects 2 rows. The framework SQL layer does not touch limit/offset (`grep -i "limit\|offset" src/sql/*.ts`: only PAR-215 result-size and identifier-length hits).
3. *`verify` really runs a Postgres process.* `src/cli/verify/tests.ts:87` spawns a child per dialect with `PROTOTYPE_FRAMEWORK_DIALECT: dialect`; the record's evidence 1 (LOCAL-AC-003 DISTINCT fixture failing `verify`, which can fail only on Postgres) shows it takes effect. Enough to rule out "Postgres process missing".
4. *DEC-PENDING-B-T4-7's premise is the defect.* It says `.limit(-1)` gives Postgres "LIMIT must not be negative". Postgres does reject it (record evidence 2, raw SQL), but via Drizzle the clause is never sent, so the fixture is not a Postgres-only failure.

### Alternatives
- *`verify` should catch this some other way.* Ruled out by the text. CLI-REQ-002 says `verify` runs type checking, the portability rules, the migration checker and the app's tests on both dialects, and fails if any step fails. CLI-AC-002 says it "fails on … a Postgres-only failure". LOCAL-REQ-003/LOCAL-AC-003 say the Postgres-dialect check is done by running the tests on each dialect. Nothing requires `verify` to flag a query that behaves the same on both dialects. Here the app behaves identically on both, so there is no Postgres-only failure for `verify` to find. Exiting 0 is correct.
- *A framework bug (wrapper rewriting the limit).* Ruled out by link 2 and by the plain-Drizzle probe.

### Fix
The fix is correct: it changes the fixture, which is where the cause is (a wrong test input, not a CLI defect), and it correctly re-records DEC-PENDING-B-T4-7. It does not weaken the test, because the assertions (non-zero exit, output names the fixture test) stay the same. Notes on the candidates:
- `offset(-1)` meets the requirements. The probe shows Drizzle sends it. Its guard is `offset ? …`, and -1 is truthy:
  ```
  pg limit(10).offset(-1) {"sql":"… limit $1 offset $2","params":[10,-1]} -> error: … | cause: OFFSET must not be negative
  sqlite select * from items limit ? offset ? [10,-1] -> 2 rows        (node:sqlite, not local D1)
  ```
  Pair it with a non-negative `limit`. A bare `offset` with no `limit` would make SQLite emit `offset ?` without `LIMIT`, which SQLite rejects as a syntax error, so the failure would not be Postgres-only. The SQLite result above came from `node:sqlite`, not from local D1 (Miniflare/workerd), so the D1 side still has to be probed as the record's verification plan says.
- "Text column compared with an integer" is riskier. The restricted `sql.d.ts` typing (sql.md §2.3) may reject it at type-check time. `verify` would then fail on step 1, not on a Postgres-only test failure, and the test would pass for the wrong reason. Only the test-name assertion would expose that, and only if the type error does not mention the name.

### What a corrected fixture must exhibit
1. It uses only supported, type-correct framework/Drizzle API, so type check, portability rules and the migration check all pass. Prove this with a passing `verify` run on the same app minus the failing test, or by asserting that the output has no type-check or CHECK diagnostic.
2. Drizzle sends the offending construct to the database. Show this with `toSQL()`: the clause and its parameter are present.
3. On local D1 (the real `sqlite` test process, not `node:sqlite`) the fixture test passes. On PGlite the query raises a Postgres error and the fixture test fails. Show both with a probe and record them in DEC-PENDING-B-T4-7.
4. `verify` exits non-zero and its output names the fixture test. Recommended, to keep the test as strong as "Postgres-only": also assert from the output that the `sqlite` test process passed and the `postgres` one failed. Neither the current test nor the LOCAL-AC-003 test checks this, so a fixture that fails on both dialects would also satisfy them.

## Fix

Author: test-case author (prompt §8 step 3); did not write the CLI code, the diagnosis or the review. Date: 2026-10-19. No CLI code changed.

### What changed
- `packages/framework/test/fixtures/cli/pg-only/src/app.ts.fixture`: `GET /items` now takes `limit` and `offset` query params and calls `.limit(limit).offset(offset)`. (The `/titles` route used by LOCAL-AC-003 is unchanged.)
- `packages/framework/test/fixtures/cli/pg-only-limit/` renamed to `pg-only-offset/`; its test is now `tests/negative-offset.test.ts.fixture`, `it("negative offset returns every item")`, requesting `/api/items?limit=10&offset=-1` and expecting 200 with 2 rows. Same assertions as before.
- `packages/framework/test/integration/cli/verify.test.ts`: the test is now "[CLI-AC-002] verify fails on a Postgres-only failure (negative OFFSET)". It uses the new layer and keeps the original assertions (non-zero exit, the fixture test named). It also asserts, for review point 4, that `type checking`, `portability rules`, `migration checker` and `zod version` each print `passed`; `tests (sqlite): passed (N passed, 0 failed, 0 skipped)`; `tests (postgres): 1 failed (N passed, 1 failed, 0 skipped)`; the `FAIL  tests/negative-offset.test.ts > negative offset returns every item` line appears inside the postgres section; and the summary is exactly `verify failed: tests (postgres)`.

### Evidence against the review's list
1. **Type check and CHECK steps pass.** These are asserted in the test. Control run: the same app with `offset=0` makes `verify` exit 0 with every step passed, including `tests (postgres): passed (3 passed, 0 failed, 0 skipped)`. This also shows the postgres failure comes from the negative offset alone.
2. **The clause is sent.** Probe `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/b17fix/probe.mjs` (drizzle-orm 0.45.4, wrangler 4.149.0 / miniflare 5.20261006.1-alpha via `getPlatformProxy`, the same local D1 path the migration checker uses, PGlite 0.5.8, all from the workspace `node_modules`), verbatim:
   ```
   d1 limit(10).offset(-1) toSQL {"sql":"select \"id\", \"title\" from \"items\" order by \"items\".\"created_at\" asc, \"items\".\"id\" asc limit ? offset ?","params":[10,-1]}
   d1 -> 2 rows
   d1 control limit(10).offset(1) -> 1 rows
   pg limit(10).offset(-1) toSQL {"sql":"select \"id\", \"title\" from \"items\" order by \"items\".\"created_at\" asc, \"items\".\"id\" asc limit $1 offset $2","params":[10,-1]}
   pg -> error: Failed query: select "id", "title" from "items" order by "items"."created_at" asc, "items"."id" asc limit $1 offset $2 | cause: OFFSET must not be negative
   pg control limit(10).offset(1) -> 1 rows
   ```
3. **Passes on real local D1 and fails on PGlite.** The probe above shows this directly. In `verify` itself, the sqlite test process passed 3/3 and the postgres process failed only the fixture test (output below).
4. **`verify` exits non-zero and names the test.** `verify` output with the corrected fixture:
   ```
   verify: type checking: passed
   verify: portability rules: passed
   verify: migration checker: passed
   verify: zod version: passed (4.6.7)
   verify: tests (sqlite)
   verify: tests (sqlite): passed (3 passed, 0 failed, 0 skipped)
   verify: tests (postgres)
     FAIL  tests/negative-offset.test.ts > negative offset returns every item
           expected 500 to be 200 // Object.is equality
   verify: tests (postgres): 1 failed (2 passed, 1 failed, 0 skipped)
   verify failed: tests (postgres)
   ```

### Red-green
- Red: the original test on `origin/claude/implement-local-cloudflare` (18c5207), with the framework built, failed with `verify exit 0` and both `tests (sqlite)` and `tests (postgres)` reported `passed (3 passed, 0 failed, 0 skipped)`. So it did not catch a Postgres-only failure.
- Green: the corrected test passes against the current CLI.

### Commands run
- `npm ci`; `npm run build -w packages/framework`
- `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/cli/verify.test.ts -t "negative LIMIT"` (red, before the change)
- `node <scratchpad>/b17fix/probe.mjs <repo>` (probe above)
- `npx vitest run … -t "negative OFFSET"`: passed; the same run with `offset=0` as a control: `verify exit 0` (restored afterwards)
- `npm run typecheck && npm run test:unit`: 111 files, 1201 tests passed
- `npm run build -w packages/framework`, then `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/cli/verify.test.ts`: 12/12 passed

### Open item
DEC-PENDING-B-T4-7 (`ai/implementation/decisions/B-T4.md`) still describes `.limit(-1)` and says the dialect is not separately asserted. It needs re-recording to `.limit(10).offset(-1)`, with the evidence above and the per-dialect assertions. It was left untouched because this fix was limited to the fixture, the test and this record.
