# Decision drafts — C-T2 (shared SQL/KV case sets; SQL, KV and MIG compliance criteria)

### DEC-PENDING-C-T2-1 — Shared case sets: one expectation set, three places
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-AC-003…-006, KV-AC-001…-005, COMPL-REQ-001, `apps/reference/src/server/cases/**`, `tests/compliance/criteria/{sql,kv}/`

The cases live in the reference app (`cases/sql.ts`, `cases/kv.ts`, `cases/mig.ts`, registered by `case-registry.ts` per DEC-PENDING-C-01-7) and only report what the framework did; expectations are literals in `tests/compliance/criteria/{sql,kv}/suite.ts`, derived from sql.md / kv.md / the contracts. Each suite runs three times: in-process on local D1 and on PGlite (`createTestApp(referenceApp)` + `POST /api/cases/run`, one entry file per dialect because the dialect is fixed per process, DEC-0134), and through the reference app over HTTP (`client()`: `dev` locally, the test stage on a cloud). "Identical results on every target" (SQL-AC-003, KV-AC-004) = the same literal expectations pass in every place; floats compare with PAR-280; unordered results are sorted by the case and compared as multisets. Every KV test is tagged with its own criterion and KV-AC-004.
Item: C-T2.

### DEC-PENDING-C-T2-2 — In-process runs exist only on the local target
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-001, `tests/compliance/criteria/{sql,kv}/*.{d1,pglite}.test.ts`

The in-process entry files define their tests only when `target()` is `local`. On a cloud run they would produce local results under the cloud target's evidence; defining them conditionally (rather than skipping) keeps cloud evidence to the HTTP runs, and adds no `not-run` entries. This is the one place the C-T2 tests read `target()`, and only to choose where tests exist, not what they expect.
Item: C-T2.

### DEC-PENDING-C-T2-3 — Cases are namespaced, self-cleaning and use only public, `verify`-clean app code
Origin: ai-proposed · Status: accepted · Affects: `apps/reference/src/server/cases/**`

Each case takes `{ ns }`, a random per-suite namespace (`c-t2-<16 hex>`), names its authors/keys under it and deletes what it wrote (SQL: one seed of 10 rows per suite, removed by `cleanup`; other cases in `finally`), because a cloud stage is shared by the run's criteria. Rejections are reported inside a case by catalogue code (`codeOf`/`outcome`), so one request checks many values; a non-`FrameworkError` is reported as `not-a-framework-error: …`, which no expectation accepts (SQL-REQ-006). `framework-ids` forbids literal IDs, so IDs come from `newId()` and results map them to labels; the deliberately invalid IDs of SQL-AC-004 come from the case input (left to the run-time rule, as `framework-ids` documents). Type assertions are banned in app code, so wrong-JS-type values (e.g. `1` for `boolean`) are not tested; `boolean` has no in-type boundary.
Item: C-T2.

### DEC-PENDING-C-T2-4 — Readings of SQL-AC-003…-006
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-AC-003…-006

- SQL-AC-003 "every supported feature": every §2.3 row is exercised — select/selectDistinct, insert (single and multi-row), update, delete, inner/left joins, a subquery (`inArray` over a select), a select-only CTE (`$with`/`with`), all exported comparison/boolean/null/`inArray`/`notInArray`/`between` expressions on every column type, `containsText`, every aggregate incl. `groupBy`, `asc`/`desc` on every nullable type, `limit`/`offset`, both upsert forms against declared uniques, and `returning`. Ordering totality: within a suite's data every ordering ends in a column whose values are distinct (`title`), so the order is determined.
- `containsText` "edge cases": `""`, `%`, `_`, `\`, a would-be LIKE pattern (`1%s`, `o_e`) that must not match, ASCII folding (`HELLO`, `APPLE`), non-ASCII not folded (`àpple`, `äpfel`), NULL never matching.
- SQL-AC-004: per type, values just inside and just outside each rule of sql.md §2.1 (integer ±2³¹ edges, fractions, NaN; number ±Infinity, NaN, `Number.MAX_VALUE`, `Number.MIN_VALUE`, −0 stored as 0; timestamp −1, 2⁵³, fractions, 0, `MAX_SAFE_INTEGER`; text lone/reversed surrogates, NUL, `""`, U+FFFF, U+10FFFF, an astral pair; `id`/`ref` uppercase UUID and non-UUID). Rejections must be `SQL.INVALID_VALUE` and write nothing (also for `update().set()`, comparisons and a multi-row insert with one bad row); accepted values must read back exactly.
- SQL-AC-005: the outer-handle rejection must be a catalogue code (any; SQL-REQ-005 and sql.d.ts say "a catalogue error", sql.md says `CORE.INTERNAL`, as DEC-0222) and nothing — not even the first, valid step — may be written. A committing `atomic` is checked as a control.
- SQL-AC-006: duplicate single-column and composite unique values on insert and update → `SQL.CONFLICT` (409 over HTTP); one row of 270,000 ASCII characters selected back → `SQL.RESULT_TOO_LARGE` (one oversized row, plan §1), one of 200,000 succeeds. **Not covered:** the Data API retry-loop clause (AWS adapter; not built in this phase).
Item: C-T2.

### DEC-PENDING-C-T2-5 — Readings of KV-AC-001…-005; KV-AC-002's empty-value conflict
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; owner item DEC-0146 / plan §11 Q6) · Affects: KV-AC-001…-005, DEC-0146

- KV-AC-001: list results are checked for exact key sets and code point order, incl. `%`, `_`, mixed case, a key outside the prefix that a non-literal match would include (`<ns>/pa%b` for prefix `<ns>/p/`), and code point vs UTF-16 order (U+FFFD before U+1F600).
- KV-AC-002: limits in UTF-8 bytes (a key of 1,024 bytes made of 2-byte characters is accepted; a 1,025-byte key with an astral character, only 1,023 UTF-16 units long, is rejected); malformed keys, prefixes and values are `KV.INVALID_KEY` (KV-REQ-002). **Empty values:** the test follows KV-REQ-002 (binding) and DEC-0146 — `put(k, "")` is accepted and `get` returns `""` — in its own test whose title names the conflict, so the owner's decision changes one test. A prefix over PAR-220 bytes is not asserted (DEC-0147 is an implementation choice no requirement states).
- KV-AC-003: "2.5 pages" = 10 keys in pages of 4 (sizes 4, 4, 2), not 50 keys at the default page size (plan §1 limits); a cursor is rejected with a different, a narrower and a wider prefix, and when malformed.
- KV-AC-005: the maximum page is exactly PAR-222 = 50 entries of PAR-220-byte keys and PAR-223-byte values (the criterion's own size, the only test above "tens of rows"); "database unreachable" locally = `createTestApp(…, { unavailable: ["sql"] })` and `["kv"]`, in-process only (DEC-0225).
Item: C-T2.

### DEC-PENDING-C-T2-6 — MIG criteria deploy their own stages from a scratch copy of the reference app
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-AC-002, -003, -006, DEC-0144, compliance.md "Test stages", D-RUN

`tests/compliance/criteria/mig/support/stage.ts` copies `apps/reference` (without state, tests and overlays) to a temporary directory, applies an overlay (`v1` = committed app, `versions/v2`, `versions/unique-fail`) and deploys it: locally a `dev` start (DEC-0144; after a failed start the harness serves the previous version's sources, the local reading of "the old app answers again"), on Cloudflare `deploy --target cloudflare --stage test-<random>` then `remove`. The database is read only with SELECTs: locally from Miniflare's SQLite file, on Cloudflare through the D1 HTTP API `query` endpoint of the stage's lowest-numbered `reference-<stage>-db-<n>` database (no Authorization header; the proxy injects it). Two stages, used one after the other: (1) initial deploy, unchanged redeploy, failing `unique-fail` deploy, data correction, successful re-run; (2) v1 → v2 with data, writes during the deploy, a secret and a session.
- MIG-AC-002: "creates the schema" = every app and framework table exists; "the record lists every migration once" = `__framework_migrations.id` in rowid order equals `framework/<file>` for the framework history then `app/<file>` for the app's, each in file order (DEC-0142 format); "changes no data" = every table's rows, incl. the record's applied times, are identical; "does not stop the app" = on a cloud every health probe during the deploy answers 204; locally a deployment is a `dev` restart, so only "applies nothing" is checked (DEC-0144).
- MIG-AC-003: failure = non-zero exit, same database names, every row unchanged, health 204, `schema-version` back to `v1`, dump unchanged. The re-run corrects the data (case `mig/relabelDuplicate` relabels one of the two `shared` children) and re-runs the same overlay. Preservation = same parent and child IDs and references (`note` dropped, `rank` = 0 added), no orphaned child, other tables unchanged.
- MIG-AC-006 (cloud only): at most 20 KV writes, one per 3 s, while the v2 deploy runs; at least one must be acknowledged (otherwise the check proves nothing) and every acknowledged one must be readable afterwards; exactly one stage database; `GET /api/ref/secret` returns the SHA-256 of the value set before the first deploy; `GET /api/ref/me` with the session from before answers as before.
- Not runnable until D: the Cloudflare paths depend on D-05's `deploy`/`remove`/`secrets set --target cloudflare` and were not executed here.
Item: C-T2.

### DEC-PENDING-C-T2-7 — C-01's case-runner test updated for the registered sets
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `apps/reference/tests/fixture-and-cases.test.ts` (C-01-owned), DEC-PENDING-C-01-7

C-01's test "has no sets until C-T2 registers them" asserted `GET /api/cases` = `{ sets: {} }` and failed once the registry re-exports C-T2's sets, so the reference app's `verify` (and root `verify`) failed. The only edit outside C-T2's paths: that assertion now expects the registered set names `kv`, `mig`, `sql` (its unknown-case 404 check is unchanged). Owner instruction "do not stop for questions"; C-01's owner may prefer another form.
Item: C-T2.

## Cloud usage estimate (per Cloudflare run, for D-RUN)

Rows written by C-T2's tests on Cloudflare (HTTP runs only; base-table rows, each insert/update/delete counted once):
- SQL suite: seed 10, `writes` 15, `boundaries` 6, `atomicCommit` 4, `atomicRollback` 0–4 (rolled back), `duplicateUnique` 8, `duplicateThrows` 2, `resultSize` 4, cleanup 10 → about 65.
- KV suite: basics 3, prefixes 28, limits 4, empty value 2, pages 20, max page 100 → about 157.
- MIG (two extra stages, one at a time): schema creation and migration record about 10, data fixture 8 ×2, writer ≤ 20, database copies during schema-changing deploys about 15 + 16 + 31, data correction 1, migrations about 10 → about 125.
- Total about 350 base rows; D1 also counts index entries, so up to about 700 rows written — below the 1,000-row item cap. Rows read: well under 2,000 (small selects, MIG snapshots). Cloudflare API requests from the tests themselves (MIG D1 list/query): about 100–150, plus whatever D-05's `deploy`/`remove` make for 2 stages × 3–4 deploys. D1 databases: the run's stage (1) plus at most one extra stage (2 during a schema-changing deploy) = 3 at once; D-RUN must schedule the MIG file accordingly (plan §1 "≤ 2 D1 databases at once" per item would require running `tests/compliance/criteria/mig/` alone, after the main stage is removed or with `--base-url`).

Locally (no caps): the in-process runs add the same SQL/KV rows twice more (local D1, PGlite).

## Parameter changes

None.
