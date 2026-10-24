# Decision drafts — g-f1

Evidence: `packages/framework/src/sql/data-api-fake.test-support.ts` (the fake; its header lists every fidelity gap) and `packages/framework/src/sql/data-api-fake.unit.test.ts` (54 self-tests, including drizzle `aws-data-api/pg` CRUD and transactions). All of it is offline, and no AWS endpoint was contacted.

### DEC-PENDING-g-f1-1 — The Data API fake is a pre-check, never evidence
Origin: ai-proposed · Status: accepted · Affects: SQL-AC-003…006, KV-AC-001…005, MIG-AC-002/003/006, COMPL-AC-008 (AWS runs), the evaluator, `FW/src/sql/data-api-fake.test-support.ts`

A test that passes against `DataApiFake` shows only that the code path works against an in-process model of the Data API built on PGlite. It is never AWS evidence: sql.md §2 "Local" says PGlite does not prove Data API behavior, and plan-aws §2 says a pre-check must not be counted. So:
- The evaluator records no AWS criterion as passed on the strength of the fake. An AWS run of a criterion needs the live phase L.
- Evidence files and RESULT notes that cite the fake call it a "pre-check".
- Every behaviour of the fake that was not confirmed against AWS is marked "assumed" in the file header. The live phase confirms or corrects each one, and a correction changes the fake, not the adapter's expectations alone.

Reason: the fake shares Postgres with Aurora, but its error shapes, response-size accounting, parameter typing, concurrency and database operations are modelled from the SDK types, drizzle's session and the G-S1 findings, not from observed Data API responses.

### DEC-PENDING-g-f1-2 — The fake's assumed Data API shapes, for G-02 to code against and L to confirm
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: SQL-REQ-006, SQL-AC-006, G-02, phase L

- **SQL errors** are `BadRequestException` by default, or `DatabaseErrorException` with the `sqlErrorException` option. The SDK marks `BadRequestException` deprecated, so the real service may use either. The message is `ERROR: <message>[\n  Detail: <detail>]; SQLState: <code>`, and there is no pg `code` field. So the adapter (G-02) classifies by the SQLSTATE parsed from the message, under either exception name.
- **Resuming** is `DatabaseResumingException`, matched by `name`. `resume({ calls })` and `resume({ untilMs })`, with an injected clock, drive the retry loop's tests.
- **Response size** is `BadRequestException` "Database returned more than the allowed response size limit" when the JSON response is over PAR-214. For a write, the statement has already run.
- **Parameters**: an unhinted string binds as varchar, an integer as int8 and a double as float8. So SQL that needs an int4 argument (`repeat(text, :n)`) must cast it.
- **Concurrency**: statements on one database are serialised while a transaction is open. `CommitTransaction` after a failed statement is refused and rolls back.
- **Databases**: `CREATE DATABASE … TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`, `CREATE DATABASE "<new>" TEMPLATE "<old>"` and `DROP DATABASE … WITH (FORCE)` are executed by Postgres itself. Each database is its own PGlite instance. A copy is refused (55006) while a transaction is open on its source. Whether the real Data API leaves a pooled connection open stays the migrations.md "Early spike" question for phase L.

## Parameter changes

None. `@aws-sdk/client-rds-data` is added to `packages/framework` as a devDependency at exactly 3.1153.0, the PAR-111 value from DEC-PENDING-g-s1-1. G-01 or G-02 moves it to `dependencies` when the runtime adapter needs it, at the same version.
