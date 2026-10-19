# A-08 — Does local D1 enforce D1's bound-parameter and statement-size limits? (SQL-OQ-1)

Date: 2026-10-19. Node v22.22.0, Wrangler 4.149.0 (PAR-101; ships Miniflare 5.20261006.1-alpha, per A-10).
Cloud resource: one D1 database `spike2djg358e-a08-limits` (region ENAM), created and deleted in this spike.

## Question

sql.md §6 SQL-OQ-1: D1 limits bound parameters per statement and statement size, so a long `inArray`
list or multi-row insert could pass `verify` and fail only on Cloudflare. Does local D1
(wrangler/Miniflare) enforce the same limits as remote D1?

## Verdict

**Yes — local D1 enforces exactly the same limits, with the same error messages, as remote D1.**

| Limit | Local D1 (getPlatformProxy) | Remote D1, Worker binding (`remote: true`) | Remote D1, HTTP API `/query` |
| --- | --- | --- | --- |
| Bound parameters per statement (max accepted) | **100** | **100** | **100** |
| 101 anonymous `?` | `D1_ERROR: too many SQL variables at offset 207: SQLITE_ERROR` | same | HTTP 400, code 7500, same message |
| Numbered `?101` | `variable number must be between ?1 and ?100 at offset 7: SQLITE_ERROR` | same | same |
| `IN (…)` with 100 / 101 params | ok / too many SQL variables | same | same |
| Multi-row insert, 2 params/row, 50 / 51 rows | ok / too many SQL variables | same | same |
| Statement length (max accepted) | **100,000 bytes** | **100,000 bytes** | **100,000 bytes** |
| 100,001-byte statement | `D1_ERROR: statement too long: SQLITE_TOOBIG` | same | HTTP 400, code 7500, same message |
| Same limits through `batch()` and `exec()` | enforced | enforced | n/a |
| One bound text value of 100,001 / 1,000,000 bytes in a short statement | ok / ok | ok / ok | ok / ok |

The statement-size limit applies to the SQL text only; bound values do not count toward it. Both limits
match Cloudflare's documented D1 limits (100 bound parameters per query; 100,000-byte SQL statement).
The maxima were found by binary search (1…40,000 params; 100…2,000,000 bytes), so they are exact.

**Consequence.** The plan's fallback ("add a portable limit, a catalogue code and an AC") is **not
needed**: an app whose tests run against local D1 hits the same failure locally as on Cloudflare.
Remaining gap (recorded in the decision draft, not acted on): PGlite/Postgres allows far more
parameters (65,535) and longer statements, so a query tested **only** against PGlite could still pass
locally and fail on D1; the per-dialect local test runs (DEC-0039, B-16 runs the suite once per dialect)
cover this because the local D1 run fails.

## Setup and exact commands

All from `ai/implementation/spikes/a-08/` (throwaway; own `package.json`, only `wrangler@4.149.0`).
Probe logic is shared (`probe-lib.mjs`): each case runs one statement and records ok/error; the
boundary cases are exact, then a binary search finds the largest accepted parameter count
(`SELECT ?,?,…`) and statement length (`SELECT 'xx…x' AS s`, ASCII, exact UTF-8 byte count).

```
npm install --prefix ai/implementation/spikes/a-08          # wrangler 4.149.0
node probe-local.mjs | python3 -I redact.py > out/local.txt # local: getPlatformProxy, wrangler.local.jsonc, persist:false
./wr.sh d1 create spike2djg358e-a08-limits                  # A-01 environment (placeholder token replaced by the proxy)
D1_ID=<uuid> ./remote.sh http    > out/remote-http.txt      # D1 HTTP API POST …/d1/database/<uuid>/query {sql,params}
D1_ID=<uuid> ./remote.sh binding > out/remote-binding.txt   # getPlatformProxy with d1 binding `remote: true`
./wr.sh d1 delete spike2djg358e-a08-limits -y
```

Environment (`wr.sh`, `remote.sh`): exactly A-01's wrangler environment — `CI=1`,
`CLOUDFLARE_API_TOKEN=proxy-injected` (non-secret placeholder; the proxy replaces the Authorization
header), `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, `HTTPS_PROXY` — plus
`NODE_USE_ENV_PROXY=1` for the HTTP-API probe's Node `fetch`. The HTTP probe sends no Authorization
header itself. Output is filtered through `redact.py` (account ID, 32-hex IDs, ANSI codes); the
database UUID is replaced by `<d1-uuid>`.

The remote-binding run ("⎔ Establishing remote connection...") uses Wrangler's remote bindings: binding
calls are executed by a real D1 Worker binding on Cloudflare, i.e. what a deployed Worker sees. It needed
no `workers.dev` route and the proxy refused no host for it.

## Raw output excerpts (full: `out/`)

Local (`out/local.txt`):
```
select-anon-params n=100: ok
select-anon-params n=101: ERR D1_ERROR: too many SQL variables at offset 207: SQLITE_ERROR
select-numbered-?k n=101: ERR D1_ERROR: variable number must be between ?1 and ?100 at offset 7: SQLITE_ERROR
statement-bytes n=100000: ok
statement-bytes n=100001: ERR D1_ERROR: statement too long: SQLITE_TOOBIG
bound-text-bytes n=1000000: ok
=> {"max":100,"firstErr":"D1_ERROR: too many SQL variables at offset 207: SQLITE_ERROR"}
=> {"max":100000,"firstErr":"D1_ERROR: statement too long: SQLITE_TOOBIG"}
exec bytes n=100001: ERR D1_EXEC_ERROR: Error in line 1: SELECT 'x…(99987 x)' AS s: statement too long: SQLITE_TOOBIG
```
Remote, Worker binding (`out/remote-binding.txt`):
```
⎔ Establishing remote connection...
select-anon-params n=101: ERR D1_ERROR: too many SQL variables at offset 207: SQLITE_ERROR
statement-bytes n=100001: ERR D1_ERROR: statement too long: SQLITE_TOOBIG
== summary {"maxParams":100,"maxBytes":100000}
```
Remote, HTTP API (`out/remote-http.txt`):
```
select-anon-params n=101: ERR HTTP 400 7500: too many SQL variables at offset 207: SQLITE_ERROR
statement-bytes n=100001: ERR HTTP 400 7500: statement too long: SQLITE_TOOBIG
== summary {"maxParams":100,"maxBytes":100000}
```

## Notes for later items

- B-06: the two failures surface as a generic `D1_ERROR` (`SQLITE_ERROR` / `SQLITE_TOOBIG`); there is
  no portable code for them and none is added. Chunking guidance in sql.md "Common needs" can now cite
  the numbers (proposed PAR-216/PAR-217): ≤ 100 bound parameters and ≤ 100,000 bytes of SQL per
  statement (e.g. ≤ 50 rows of a 2-column insert).
- The proxy status showed one relay failure during this spike, for a host belonging to a concurrent
  spike (A-02's `…-nosuchsub.workers.dev`), not to this one.

## Leftover cloud resources

None. `wrangler d1 delete` → "Deleted 'spike2djg358e-a08-limits' successfully."; afterwards `d1 list`
shows no `spike2djg358e` database and the account has no Workers scripts (`GET …/workers/scripts` →
`[]`; the remote-bindings session left no script). Other spikes' resources (e.g. `spikepmyh4f7i-a05-probe`)
were not touched. Local only (not committed): `node_modules/`, `~/.config/.wrangler/`.

## Fallback

Not applied: local D1 enforces the limits, so the plan's fallback (portable limit + catalogue code + AC)
is not needed.
