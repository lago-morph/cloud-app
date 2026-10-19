# A-05 — D1 HTTP API: one migration file as one atomic, `PRAGMA defer_foreign_keys = on`-prefixed request

Date: 2026-10-19. Python 3 `urllib` through `HTTPS_PROXY` (system trust store holds the proxy CA); no
`Authorization` header sent (the proxy injects the token for `api.cloudflare.com`, A-01). Account ID from
`$CLOUDFLARE_ACCOUNT_ID`. drizzle-kit 0.31.11 / drizzle-orm 0.45.4 (PAR-103 / PAR-102, A-10 pins).
Databases created: `spikepmyh4f7i-a05-probe`, `spikepmyh4f7i-a05-drizzle`, `spikepmyh4f7i-a05-uniq` — all deleted.

## Question

`migrations.md` §2 "Cloudflare": each migration file is sent to the new D1 database through the D1 HTTP API
as **one batch prefixed with `PRAGMA defer_foreign_keys = on`**. Is one such request one transaction — does a
failing **last** statement leave nothing applied? What request shape works, and what size limits apply?

## Verdict

**Atomic: yes.** One `POST /client/v4/accounts/{account}/d1/database/{uuid}/query` request is one
transaction. In every failure case tried (last statement failing on primary key, NOT NULL, deferred foreign
key at commit, syntax error, missing table; a unique index over duplicate rows in the middle; a ~5 MB request
with 5,058 statements failing on the last) the database was unchanged afterwards — schema, indexes and rows —
in both request forms. The same request with a valid last statement applied every statement (positive
control). Real drizzle-kit migration files work sent unmodified. **Fallback: none needed.**

Caveats that bind the implementation (D-04):
1. **An error response is not always "nothing applied".** A request running past ~30 s got HTTP 502
   `text/plain` "upstream request failed" (no `Server: cloudflare` header, so produced by the sandbox proxy
   chain, not the Cloudflare API) — **but the batch had committed** (E8/E9). Put the `__framework_migrations`
   insert in the same request; after any non-JSON, 5xx or timed-out response, read the record to decide.
2. **Explicit transactions are rejected**: `BEGIN TRANSACTION` / `SAVEPOINT` → 400 (E4). drizzle-kit files
   contain none.
3. **`PRAGMA defer_foreign_keys = on` is necessary but not sufficient for a table rebuild of a referenced
   table.** It makes child-before-parent order and dropping a parent together with its child work, but a
   drizzle-style rebuild (`CREATE __new_x; INSERT … SELECT; DROP x; ALTER … RENAME`) of a table that has child
   rows fails at commit (and rolls back cleanly); drizzle's `PRAGMA foreign_keys=OFF` wrapper is a no-op inside
   the request (E3). drizzle-kit 0.31.11 generates **no** rebuild for the changes migrations.md supports
   (E10: add table with FK, nullable column, default column, unique index, index, drop column → plain
   `CREATE`/`ALTER`), so this only matters for unsupported changes, which then fail atomically.
4. The pragma does not persist: the next request sees `defer_foreign_keys = 0`, `foreign_keys = 1` (E3), so
   every request must carry the prefix.

## Request shape (both work, both atomic)

```
POST https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/<uuid>/query
Content-Type: application/json

A) {"sql": "PRAGMA defer_foreign_keys = on;\n<migration file text>;\n<INSERT INTO __framework_migrations …>;"}
B) {"batch": [{"sql": "PRAGMA defer_foreign_keys = on"}, {"sql": "<stmt 1>", "params": [...]}, …]}
```
- Success: HTTP 200, `success: true`, `result[]` one entry per statement (`results`, `meta.changes`,
  `meta.changed_db`, …). Empty statements (`;;`) are skipped.
- Failure: HTTP 400, `success: false`, `errors: [{code: 7500, message: "<SQLite message>"}]`, `result: []`.
  Deferred-FK failure at commit reads "D1 DB was reset and rolled back to its last known good state because the
  application left the database in a state where constraints were violated: FOREIGN KEY constraint failed".
- Form A accepts the drizzle-kit file text unchanged: `--> statement-breakpoint` lines are SQL comments.
  Form B needs the file split on the breakpoint marker; it allows bound `params`. `/raw` returns rows as
  arrays and behaves the same for multi-statement SQL (probe only).

## Size and time limits observed (remote D1, this account)

| Limit | Observed | Log |
| --- | --- | --- |
| One statement's length | 99,045 bytes OK; 100,046 bytes → 400 "statement too long: SQLITE_TOOBIG" (D1's 100 KB limit) | e5 |
| Request body | 27.0 MB (300 × 90 kB inserts) OK in 5.5 s; 50.4 MB → **500** "internal error; reference = …", nothing applied | e5, e8 |
| Statements per request | 100,000 small inserts OK (16.8 s); 20,000 OK (3.1 s) | e5, e8 |
| Wall time per request (as seen from the sandbox) | ~30 s: 200,000 inserts (9.7 MB) → **502** "upstream request failed" at 30.3 s / 33.1 s, **yet committed** (200,000 rows present immediately after) | e8, e9 |
| Typical latency | 0.5–0.8 s for small requests | e1 |

Migration files are far below every limit; these numbers matter more to A-06's one-batch import.

## Commands

Scripts in this directory (`d1.py` client with redaction; experiments write `logs/<id>.txt`):
```
python3 -I experiments.py <uuid-file> e0 e1s e1b e2 e3 e4 e5 e6 e7   # E0–E7 on spikepmyh4f7i-a05-probe
python3 -I upper.py <uuid-file>                                     # E8
python3 -I timeout_probe.py <uuid-file> 200000                      # E9
SCHEMA_VERSION=1 npx drizzle-kit generate --name v1                 # drizzle/0000_v1.sql
SCHEMA_VERSION=2 npx drizzle-kit generate --name v2                 # drizzle/0001_v2.sql
python3 -I drizzle_apply.py <uuid-file>                             # E10 on spikepmyh4f7i-a05-drizzle
python3 -I unique_dup.py                                            # E11, own database
```
Baseline for E1–E7 (`reset`): `parent(id PK, name NOT NULL)` row 1, `child(id PK, parent_id NOT NULL
REFERENCES parent)` row 1→1; D1 enforces foreign keys (`PRAGMA foreign_keys` = 1).

## Experiments and raw output (excerpts; full redacted logs in `logs/`)

**E0 positive control** (`e1-atomic-{string,batch}-none`): PRAGMA, `CREATE TABLE m_new`, insert, `ALTER TABLE
parent ADD COLUMN extra … DEFAULT 'd'`, `CREATE INDEX`, insert parent 2, update parent 1, delete child 1,
insert parent 3 → HTTP 200; after: `m_new`, `parent_name_idx`, parent rows 1 ('changed'), 2, 3 with `extra`,
child empty.

**E1 same request, last statement fails** (`e1-atomic-{string,batch}-<kind>`), each: HTTP 400, after = before
(`schema: [child, parent]`, `parent: [{id 1, 'p1'}]` with no `extra` column, `child: [{1→1}]`, no `m_new`, no index):
```
pk          UNIQUE constraint failed: parent.id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)
notnull     NOT NULL constraint failed: parent.name: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)
fk_deferred D1 DB was reset and rolled back to its last known good state because the application left the
            database in a state where constraints were violated: FOREIGN KEY constraint failed: …
syntax      near "VALUSE": syntax error at offset 30: SQLITE_ERROR
missing     no such table: no_such_table: SQLITE_ERROR
```

**E2 child before parent** (`e2-…`): without prefix → 400 "FOREIGN KEY constraint failed"; with prefix → 200,
both rows present, `foreign_key_check: []`.

**E3 rebuild of referenced table `parent`** (`e3-…`): no prefix → 400 FK failed; with prefix → 400 "D1 DB was
reset and rolled back …"; drizzle wrapper `PRAGMA foreign_keys=OFF … =ON` → 400 FK failed. All left the database
unchanged. Next request: `defer_foreign_keys: 0`, `foreign_keys: 1`.

**E4** `BEGIN TRANSACTION … COMMIT` and `SAVEPOINT s1 … RELEASE s1` → 400 "To execute a transaction, please use
the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or
SAVEPOINT statements. …"; nothing applied.

**E5/E8/E9 limits**: see table above.

**E6** ~5.3 MB, 5,058 statements (56 × 90 kB + 5,000 small inserts) + failing last → 400 UNIQUE in 1.4 s, both
forms; `blob_t rows after: 0`.

**E7 supported-change shapes on referenced `parent`, PRAGMA-prefixed** (`e7-…`), all 200 with
`foreign_key_check: []` unless noted: add nullable + `NOT NULL DEFAULT 0` column; add `REFERENCES` column to
child; drop a column of `parent`; create/drop unique index and index; `DROP TABLE parent; DROP TABLE child`
(wrong order — works thanks to the prefix); child then parent; `DROP TABLE parent` alone with child rows →
400 rolled back (correct); rebuild of the *referencing* table `child` → 200; rebuild of `parent` with child rows
copied out, deleted and re-inserted around it → 200.

**E10 real drizzle-kit files** (`e10-drizzle-files`; files in `drizzle/`): `0000_v1.sql` + record insert →
200, 4 statements. Seeded parent 1, 2 and child 1→1, 2→2 (`legacy='old'`). `0001_v2.sql` (new table `tag` with FK,
`ADD nickname`, `ADD score … DEFAULT 0 NOT NULL`, unique index, index, `DROP COLUMN legacy`) + record + failing
duplicate-PK insert → 400; after: no `tag`, no indexes, `child` still has `legacy`, record lists only `0000_v1.sql`.
Same file without the failing line → 200, 8 statements; after: `tag`, both indexes, new columns, `legacy` gone,
rows preserved, record lists both files.

**E11** (MIG-AC-003 shape, `e11-…`): duplicate `name` rows; PRAGMA, `DROP COLUMN legacy`, `CREATE TABLE extra`,
`CREATE UNIQUE INDEX parent_name_uq` (fails), `ADD COLUMN later` → 400 "UNIQUE constraint failed: parent.name";
after = before (`legacy` still there, no `extra`).

## Proxy

No host refused. `recentRelayFailures` listed only another spike's `workers.dev` host, none for
`api.cloudflare.com`. The 502 in E8/E9 is a response deadline on a ~30 s request, not a host refusal; it was not
worked around.

## Leftover cloud resources

None. `GET …/d1/database` after cleanup lists no `spikepmyh4f7i-*` database (only another spike's `spikecmmrxula-a06-*`).
Local only, not committed: `node_modules/` (gitignored).
