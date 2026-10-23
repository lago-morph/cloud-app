# A-06 — Do D1 export and import produce a full copy?

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

Date: 2026-10-19. Python 3.13 `urllib` straight to the D1 HTTP API on `api.cloudflare.com` through `HTTPS_PROXY`. The proxy injects the token; this spike never sends an `Authorization` header (A-01). No wrangler: the design uses the D1 HTTP API from the CLI.
Every cloud resource was a D1 database named `spikecmmrxula-a06-…`. Wrangler/SST were not needed.

## Question

migrations.md §2 "Cloudflare" says the copy is "a D1 export of the current database, imported into the new one as one batch prefixed with `PRAGMA defer_foreign_keys = on`". Does that copy every row and every value exactly: NULLs, unicode, large text, and rows in foreign-key order? What are the API steps, and how long do they take? If the native copy is unusable, the named fallback applies: "Fallback copy: page-by-page table copy, parents first, pages within D1 limits".

## Verdict

**Native export → import is not a usable whole-database copy. Fallback applied, and it works.**

The native copy fails in four ways (evidence below):

1. **Large rows fail.** The export writes each row as one SQL `INSERT` with inline literals. D1 refuses any statement over 100 KB (`statement too long: SQLITE_TOOBIG`), in the import API and in `/query` alike. A 99,163-byte line imported; a 150,163-byte line failed. Framework text columns have no per-value limit below that: PAR-215 allows results up to 256 KiB, so legal app data can break the copy.
2. **Foreign-key order is not guaranteed.**
   - The dump emits tables in creation order, each with its rows. A table whose rows reference a table created *later* fails with `no such table: main.cyc_b` or `FOREIGN KEY constraint failed`. Reference cycles hit this every time.
   - Inside the **import API**, `PRAGMA defer_foreign_keys=TRUE` only covers a window of about 4 KB of SQL. A child row inserted before its parent passed when the two rows were 3.7 KB apart and failed at 5.5 KB: "D1 DB was reset and rolled back to its last known good state because the application left the database in a state where constraints were violated". A self-referencing table whose rows were later re-pointed at newer rows would hit this.
3. **"One batch" `/query` can't carry a real dump.** A 5.5 MB, 40k-statement `/query` request returned **HTTP 502 after 30 s**. A 13.6 KB one worked, and inside one `/query` request deferral does cover child-before-parent order.
4. **Silent losses in values the framework doesn't allow** (informative):
   - Integers beyond 2^53 are rounded in the dump: `9223372036854775807` → `9223372036854776000`, which comes back as a REAL; `9007199254740993` → `…992`.
   - `-0.0` → `0`.
   - A NUL byte inside text **silently truncates the import** at that statement. The import reported `complete` while the rest of the file (5 rows, `sqlite_sequence`, both indexes) was never applied.

When none of these apply, the native copy *is* exact. Framework-shaped tables with unicode, control characters, `''`/`NULL`/`'NULL'`, 32-bit and safe-integer edge values, awkward reals, `sqlite_sequence` and indexes all came through bit-for-bit (run `clean`). Native failures were atomic: the target was left empty.

**Fallback copy (prototype `fallback_copy.py`): IDENTICAL** to the source on every table: schema, row count, and the hash of every value with its type in rowid order. That includes the 1.9 MB row, reference cycles, child-before-parent self-references, int64 extremes, blobs, NUL in text, `-0.0`, `sqlite_sequence` and `PRAGMA foreign_key_check` (empty). Run `fb2`.

## Fixture (`fixture.py`, source `spikecmmrxula-a06-src`, file_size 5,128,192 bytes)

| Table | Rows | What it exercises |
| --- | --- | --- |
| `z_parent` | 2024 | text PK, NOT NULL / nullable; `''` vs NULL; int32 bounds, 2147483648, 9007199254740991; reals 0.1, 1e308, 5e-324, 1/3, π, 2.0, -2.5e-10; 16 unicode/control strings in `note`; unique index |
| `a_child` (sorts before its parent) | 5000 | NOT NULL reference to `z_parent`, index |
| `m_grandchild` | 5000 | three-level chain, nullable second reference |
| `self_ref` | 3 | `s2 → s1` inserted before `s1`; `s3 → s3` |
| `cyc_a` / `cyc_b` | 2 / 1 | references between two tables, `cyc_a` created first |
| `big_text` | 7 | 50 KB, 99 KB, 150 KB, 200 KB (half `'` to escape), 625 KB (250k multibyte chars), 1 MB, 1.9 MB |
| `__framework_kv` | 17 | emoji ZWJ, RTL, combining, zero-width/BOM, astral, U+10FFFF, quotes/backslash, CR/LF/tab, `; -- /* */`, `''`, `'NULL'`, `\x01\x07\x1b\x7f`, NULL value |
| `__framework_migrations` | 2 | record-table shape |
| `x_extras` (non-portable, informative) | 5 | AUTOINCREMENT + deleted row (`sqlite_sequence`=6), blobs (incl. empty and 3000 bytes), ±2^63 edges, 2^53+1, -0.0, max double, NUL inside text, affinity conversions |

**Fingerprint** (`fixture.fingerprint`): for each table, the row count plus a sha256 over every column's `typeof` and exact value in rowid order. Integers, text and blobs are compared as `hex()`; reals as their JSON double. Also compared: `sqlite_master` (type, name, sql), `sqlite_sequence`, and `PRAGMA foreign_key_check`.

## API steps and timings (this account, colo IAD)

| Step | Request | Observed |
| --- | --- | --- |
| Create DB | `POST /accounts/$ID/d1/database {"name"}` → `result.uuid` | ~1 s. **Account limit: 10 databases** (`403 code 7406 "System limit reached: databases per account (10)"`, shared with concurrent spikes). |
| Export | `POST …/database/$UUID/export {"output_format":"polling"}`, re-POST with `current_bookmark` until `status: complete`; `result.result.signed_url` | 5.6 MB dump: complete on the 1st poll, **1.37 s**. Download **0.58 s** from `<hex32>.r2.cloudflarestorage.com` (a Cloudflare-owned bucket, not this account's; reachable through the proxy, no credentials). |
| Dump format | — | `PRAGMA defer_foreign_keys=TRUE;`, then per table in creation order `CREATE TABLE` + one `INSERT INTO "t" ("c",…) VALUES(…);` per row; `DELETE FROM sqlite_sequence; INSERT INTO "sqlite_sequence" …`; indexes last. Newlines inside text come out as `replace(replace('…\n…','\r',char(13)),'\n',char(10))`. NUL is written raw. Excerpt: `logs/dump-excerpt.txt`. |
| Import | `POST …/import {"action":"init","etag":md5}` → `upload_url`; `PUT` the file (ETag matched) to `<hex32>.r2.cloudflarestorage.com`; `{"action":"ingest","etag","filename"}`; `{"action":"poll","current_bookmark"}` | 1.47 MB / 12,059 statements: upload **~1.0 s**, ingest **~1.2 s** (`sql_duration_ms` 266). Failures come back on `ingest` as `result.error`, sometimes with `status` null. |
| One-batch `/query` | `POST …/query {"sql": "PRAGMA defer_foreign_keys = on;\n" + dump}` | 5.5 MB → **502 after 30.4 s**. 1.47 MB → refused at the NUL row (`unrecognized token: "'nul"`). 13.6 KB → OK. |
| Fallback copy | `POST …/query {"batch":[{"sql":"PRAGMA defer_foreign_keys = on"},{"sql":"INSERT … VALUES (…),(…)","params":[…]},…]}` per page; reads with `/raw` | Whole fixture: **48.6 s** data + 1.7 s indexes/sequence. 17 write pages + 3 schema/index/sequence batches, 79 read requests. Page limits: 1000 rows / 1,000,000 value bytes, a bigger row alone in its page. |

## Experiments (logs in `logs/`, all redacted: account ID, UUIDs, 32-hex IDs and signed URLs removed)

Driver: `run.py <step>` with `A06_STATE` (UUIDs, in the scratchpad, not committed) and `A06_DUMP` (path of the SQL file). `A06_DROP=1` deletes the target after an import.

| Run (log) | Input | Method | Result |
| --- | --- | --- | --- |
| `setup` | fixture | `/query` | source built; fingerprint recorded |
| `export` | source | export API | 5,595,025 bytes, 12,076 lines; longest line 1,900,057 bytes |
| `import-api-dst1` | full dump | import API | `FOREIGN KEY constraint failed`; target left with only `_cf_KV` (atomic) |
| `import-api-vself` | `self_ref` rows only (child first, adjacent) | import API | complete |
| `import-api-vorder` | `p`,`c` tables, 1 child row before 1 parent row | import API | complete |
| `import-api-vcyc` | `cyc_a`/`cyc_b` lines | import API | `no such table: main.cyc_b` |
| `import-api-vnocyc` | full dump minus `self_ref`/`cyc_*` | import API | `statement too long: SQLITE_TOOBIG` |
| `import-api-vnobig` | full dump minus `big_text` rows | import API | `FOREIGN KEY constraint failed` (cycle) |
| `import-api-vb099k` / `vb150k` | one 99,163 / 150,163-byte INSERT | import API | complete / `SQLITE_TOOBIG` |
| `import-api-vorder{2,10}`, `vo40x1`, `vo50x1` | N children then N parents (≤3.7 KB) | import API | complete |
| `import-api-vorder{50,100,1000,5000,big}`, `vo{20,30,40}x100`, `vo50x2000` | same, ≥5.5 KB | import API | "D1 DB was reset and rolled back … FOREIGN KEY constraint failed" |
| `import-api-plain` + `compare-plain` | full dump minus `big_text`/`self_ref`/`cyc_*` lines | import API | reported **complete with `num_queries` 12051 of 12059**: stopped silently at the NUL row; `x_extras` empty, both indexes missing |
| `import-api-clean` + `compare-clean` | `plain` minus the NUL row | import API | complete; **every included framework-shaped table identical**, `sqlite_sequence` and indexes identical; `x_extras` differs (int64 rounding) |
| `import-batch-b-a06dump` | full dump | one `/query` | 400 `no such table: main.cyc_b` |
| `import-batch-b-vplain` | `plain` | one `/query` | 400 `unrecognized token: "'nul"` (NUL ends the SQL) |
| `import-batch-b-vorder50` | 50 children before 50 parents, 13.6 KB | one `/query` | OK (deferral spans the whole request) |
| `import-batch-b-vorderbig` | 20,000 + 20,000 rows, 5.5 MB | one `/query` | **HTTP 502 after 30.4 s** (an upstream answer; the proxy's `recentRelayFailures` held nothing from this spike) |
| `probe-query` | scratch DB | `/query` | `PRAGMA foreign_keys = off` **ignored** (orphan insert still fails; `foreign_keys` stays 1). `batch` body with params works and is **atomic** (failing 2nd item leaves nothing). Deferral within a `batch` lets a child go first. A 1.9 MB (and a 2.1 MB) bound text param is accepted. JSON params bind **numbers as REAL** (`typeof(1)='real'`, 2^53+1 → real) and **`true` as TEXT**. NUL via a param is stored exactly (hex `610062`). Limit: 100 params per statement (101 → `too many SQL variables`). |
| `fallback-fb1` + `compare-fb1` | source | fallback, no rowid | all values identical; `self_ref` rowid order differed (parents were inserted first) |
| `fallback-fb2` + `compare-fb2` | source | fallback, copying rowid | **IDENTICAL** (every table, schema, `sqlite_sequence`, FK check) |

Variant files were made from the dump with `grep -a -v` (e.g. `grep -a -v '"big_text"\|self_ref\|cyc_' dump > v_plain.sql`, `grep -a -v "'nul" v_plain.sql > v_clean.sql`), plus small Python generators of `N` child `INSERT`s followed by `N` parent `INSERT`s with `pad` bytes per row.

## Fallback design as prototyped (`fallback_copy.py`)

1. Read `sqlite_master` from the source and create the tables in the new DB in one batch. Creation order is fine, since SQLite allows references to tables that don't exist yet.
2. Group tables into strongly connected components of the reference graph (`PRAGMA foreign_key_list`) and copy the groups parents first.
   - An acyclic table streams by rowid. A size probe (`length(CAST(c AS BLOB))`) sizes each page.
   - A cyclic group (a self-reference, or tables that reference each other) first reads rowid, primary key and reference columns for every row, builds the row reference graph, and emits its row SCCs parents first. A row SCC never spans two pages.
3. Every page is **one atomic `batch`** of `PRAGMA defer_foreign_keys = on` plus multi-row `INSERT`s with at most 100 bound parameters each. Every value is a parameter, so the SQL text stays tiny. Limits: 1000 rows / ~1 MB of values per page; a single larger row (up to D1's 2 MB) goes alone.
4. Exact values: read `typeof(c)` and the value in text form (`CAST(c AS TEXT)` for integers, `hex(c)` for blobs), then bind by type: `CAST(? AS INTEGER)`, the JSON double, the string, `unhex(?)`, or a literal `NULL`. Never let a JSON number stand for an integer (probe E5d). The hidden `rowid` is copied too, so even unordered scans match.
5. Create indexes after the data; copy `sqlite_sequence` if present.
6. MIG step 4's checks still apply afterwards.

## Leftover cloud resources

**None.** `run.py leftovers`: `remaining spikecmmrxula-a06* databases: []`. Each throwaway target was deleted right after its import (`A06_DROP=1`), and source, `fb2` and the earlier targets were deleted by `run.py cleanup` and by hand (logged). The account's D1 list afterwards held only another spike's `spikepmyh4f7i-a05-probe`. Not touched.
Local only, not committed: the dump and variants in the session scratchpad.

## Proxy

No host was refused for this spike. `api.cloudflare.com` and the export/import signed-URL hosts `<hex32>.r2.cloudflarestorage.com` were all reachable. The only entry in `recentRelayFailures` belongs to A-02 (`spikemkmteluy-a02-worker.spikemkmteluy-nosuchsub.workers.dev`).
