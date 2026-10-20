# Root cause: CLI-AC-002 (offline repeat `verify`) and MIG-AC-001 (verify before the edit): `verify failed: fetch failed` at the migration checker

Author: diagnosing subagent (prompt §8 step 1). I did not write the code or the tests. This is a diagnosis only: no code or test was changed. It needs an independent review (§8 step 2) before anyone fixes it. Local only: no Cloudflare calls were made.

**Finding in one line.** The code is wrong; the tests are right. The migration checker replays both dialects at the same time (`Promise.all`, `packages/framework/src/check/migrations/checker.ts:38`). PGlite's start-up is synchronous WASM work, and it blocks the Node main thread for several seconds while the local D1 replay is using its keep-alive HTTP connections to `workerd`. When the block lasts longer than `workerd`'s idle timeout, `workerd` closes an idle socket. When the thread resumes, undici reuses that dead socket for the next D1 proxy call before it has read the FIN. The call fails with `TypeError: fetch failed` (cause `UND_ERR_SOCKET: other side closed`), which escapes `runMigrationChecker`, so `verify` prints `verify failed: fetch failed`. Whether this happens depends on timing and machine load. It is not caused by the network being off, and not by any change since Phase B.

## Symptom
C-RUN (`validation/local/phase-C-run/SUMMARY.md`, record `validation/local/xc3s44jl2dbmqpv.json`, raw `validation/local/xc3s44jl2dbmqpv/raw/vitest.json`, log `validation/local/phase-C-run/04-compliance-local.log` lines 2840–2900):

- **CLI-AC-002** `two consecutive verify runs with networking disabled give identical results` (`packages/framework/test/integration/cli/verify.test.ts:77`): the first offline run exited 0 (the assertion on line 76 passed). The second printed `verify: migration checker` and then `verify failed: fetch failed`, with exit 1.
- **MIG-AC-001** `editing a generated migration makes the checker fail …` (`packages/framework/test/integration/mig/generate.test.ts:64`): the unedited control `verify` printed the same lines. This run was **not** offline (`runCli` spawns the CLI directly).

`verify failed: <message>` comes from the CLI's top-level catch (`packages/framework/src/cli/main.ts:72`, `${name} failed: ${describeFailure(error)}`), not from `verify`'s own step summary, which would read `verify failed: migration checker`. So `runMigrationChecker` threw. `describeFailure` prints only `error.message`, which is why the cause is not shown.

## Evidence

### E1. Nothing relevant changed between Phase B and Phase C
- Phase B run 2 was commit `812015c`; C-RUN was `4ff83c4`. `git diff --stat 812015c 4ff83c4` over `packages/framework/src/check/migrations`, `src/mig`, `src/cli/commands/verify*`, `package-lock.json`, `scripts/`, the two test files and their helpers shows only `test/fixtures/support/app.ts` (one eslint comment removed) and `verify.test.ts`. The `verify.test.ts` changes are a comment and a stronger assertion in the CORE-REQ-005 test, neither in the failing test. The lockfile is unchanged, so wrangler 4.149.0 and miniflare 5.20261006.1-alpha are the same.
- What did change is the run: Phase C ran **68** Vitest files (521 tests, now including `tests/compliance/criteria/**`) under the compliance driver, which also keeps the reference app's `dev` running. Phase B ran **36** files (389 tests). The same tests took about twice as long in C. For example, `verify passes on the template` took 57 s / 56 s in B (run 2 / run 1) and 98 s in C. `two consecutive verify runs …` took 118 s / 107 s in B and 131 s in C. `verify fails on a Postgres-only failure` took 37 s / 29 s in B and 207 s in C.
- The proxy warning (`Proxy environment variables detected …`) is printed in the passing Phase B offline logs too (`validation/local/phase-B/run-2/12-offline-verify-run1.log`). It is not new.

### E2. The failure is not specific to these tests, and does not need the network to be off
- Offline `verify` of `apps/template` in place (`unshare -rn sh scripts/offline.sh npm --workspace apps/template run verify`) passed. So did the failing test run alone (`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/cli/verify.test.ts -t "networking disabled"`, 1 passed). Running the checker 3 times offline also passed.
- I ran the full local compliance driver again (`npm run compliance -- --target local`, 05:21–06:18Z, with the diagnostic preload below). The symptom appeared in a **different, online** test: `portability-rules.test.ts` › `passing fixtures` (CHECK-AC-001, CHECK-AC-002, SQL-AC-002 share one `verify` run) printed `verify: migration checker` and then `verify failed: fetch failed`. In that run, CLI-AC-002 and MIG-AC-001 passed. (The driver refused to write an evidence record because I had committed during the run. The raw output is my scratchpad log `compliance-full1.log`.)

### E3. The thrown error: undici `fetch failed`, cause `UND_ERR_SOCKET other side closed`, on the D1 platform-proxy connection to the local `workerd`
**Instrumentation.** A `NODE_OPTIONS=--require` preload in the scratchpad, `trace/fetch-trace.cjs` and then `trace/fetch-trace2.cjs`. It changes no repository code. It wraps the global `TypeError` in a `Proxy` whose construct trap logs every `new TypeError("fetch failed", { cause })` with its cause. v2 also keeps a ring buffer of undici `diagnostics_channel` events (`client:connected`, `client:sendHeaders`, `request:headers`, `request:trailers`, `request:error`), socket FIN/close events, and main-thread event-loop stalls (a 200 ms interval timer). The ring buffer is dumped when the error is constructed.

**In the full driver run (E2), the failing `verify` process** (`/tmp/b-t4-app-Ije73A`, the portability-rules passing fixture) logged one `fetch failed`, during the migration checker step (05:31:12Z, about 100 s after the process started; type checking and the portability rules had finished):
```
cause: {"name":"SocketError","code":"UND_ERR_SOCKET","message":"other side closed",
        "socket":{"localAddress":"127.0.0.1","localPort":55774,"bytesWritten":1271,"bytesRead":328}}
    at Socket.onHttpSocketEnd (node_modules/undici/lib/dispatcher/client-h1.js:959:22)
construct-site: … node_modules/undici/lib/web/fetch/index.js:237   (Miniflare's `undici` package, main thread)
```
`bytesWritten` > `bytesRead` on a socket that had already carried a response is the pattern of an earlier request completing, then a new request being written to a connection the peer has closed.

**Reproduced with a full timeline.** I ran 6 copies of the real `runMigrationChecker` (dist, on `apps/template`) at the same time, 8 runs each, next to 6 CPU-burner processes (`stress.sh st2 6 6 8`). 1 of 48 runs threw. Its stack ends in the checker's own D1 introspection:
```
TypeError: fetch failed
    at async fetch4 (node_modules/miniflare/dist/src/index.js:90260)
    at async ProxyClientBridge.dispatchFetch (…/miniflare/dist/src/index.js:134947)
    at async #parseAsyncResponse (…/miniflare/dist/src/index.js:120281)
    at async rows (packages/framework/dist/check/migrations/databases.js:54)
    at async introspectSqlite (…/databases.js:60)
    at async replay (…/checker.js:41)
    at async Promise.all (index 0)
    at async runMigrationChecker (…/checker.js:28)
  [cause]: SocketError: other side closed  remoteAddress 127.0.0.1 remotePort 34905 (workerd's runtime entry)
```
The v2 ring buffer for that thread shows the sequence (times in Z):
```
06:43:45.255 connected s1(36820->34905)
06:43:45.256 sendHeaders s1 POST /cdn-cgi/local/platform-proxy  (D1 proxy call)
06:43:45.268 resDone s1
06:43:45.722 connected s2(36836->34905)
06:43:45.722 sendHeaders s2 POST /cdn-cgi/local/platform-proxy
06:43:45.742 resDone s2                              <- s2 idle from here
06:43:45.981 sendHeaders s1 POST /cdn-cgi/local/platform-proxy   (in flight)
06:44:33.311 resHeaders s1 200                       <- handled only after the stall
06:44:33.564 sendHeaders s2 POST /cdn-cgi/local/platform-proxy   <- reuses s2, idle for 47.8 s
06:44:33.565 main-thread stall 47343ms
06:44:33.604 socket-end(FIN from peer) s1
06:44:33.605 socket-end(FIN from peer) s2           <- FIN was already waiting; read after the write
06:44:33.605 reqError s2 POST /cdn-cgi/local/platform-proxy UND_ERR_SOCKET other side closed
```
So the main thread was blocked for 47 s. During that time `workerd` closed both idle keep-alive sockets. Miniflare's runtime pool uses `keepAliveTimeout: 1e3` "to close idle client sockets before workerd's 5s idle timeout" (`node_modules/miniflare/dist/src/index.js:134691`), but that timer cannot fire while the thread is blocked. When the thread resumed, s1's response was handled first. Its continuation (the next D1 `.all()`) wrote to s2 before s2's FIN was read.

### E4. Minimal reproduction (wrangler `getPlatformProxy` + the checker's D1 config, nothing from the framework)
Scratchpad `repro.mjs`:
```js
const proxy = await getPlatformProxy({ configPath /* name migration-checker, one D1 binding DB */, persist: false });
const q = () => proxy.env.DB.prepare("SELECT 1 AS x").all();
await Promise.all([q(), q()]);           // two keep-alive sockets
const inFlight = q();                     // a request in flight when the thread blocks
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
await inFlight; await q();                // next call in the same continuation
```
| main thread blocked | result (5 tries each) |
|---|---|
| 0 ms | 0/5 failed |
| 3000 ms | 0/5 failed |
| 7000 ms | 3/5 `fetch failed: UND_ERR_SOCKET other side closed` |
| 10000 ms | 3/5 failed |
| 10000 ms, under `unshare -rn sh scripts/offline.sh` | 2/5 failed (same cause) |

So the failure is the same with and without networking, and needs a main-thread block of more than about 5 s while D1 is in use.

### E5. What blocks the main thread in the checker: PGlite start-up, which runs concurrently with the D1 replay
- `runMigrationChecker` runs `Promise.all([replay("sqlite", root), replay("postgres", root)])` (`checker.ts:38`). `replay("postgres")` calls `openCheckDatabase("postgres")` → `openPostgres()` (`packages/framework/src/sql/postgres.ts:53`). That function runs `PGlite.create()` for the C-collation template, then `CREATE DATABASE`, `dumpDataDir`, and a second `PGlite.create({ loadDataDir })` (`postgres.ts:36–55`). All of this is WASM on the main thread, while `replay("sqlite")` is talking to `workerd`.
- **Measured** in a fresh process each time (scratchpad `pgstall.mjs`; load average about 12 on 4 CPUs from other agents, no extra burners): `openPostgres` took 8174 / 7922 / 8450 ms, with a **longest main-thread stall of 6262 / 6024 / 6515 ms**. After that, applying the framework migrations and introspecting stalled 0 ms. Each `verify` is a fresh process, so every `verify` pays this cost.
- **Parallel vs sequential, same load, same time** (scratchpad `mc2.mjs`, the checker's `replay` copied; `stress2.sh e1 6 6`: 3 processes "parallel" as in the code, 3 processes "sequential" = sqlite replay, close it, then postgres; 6 runs each; 6 burners):

  | mode | runs | failures | longest main-thread stall while the D1 replay was open |
  |---|---|---|---|
  | parallel (`Promise.all`, as in `checker.ts`) | 18 | 1 (`fetch failed`, `UND_ERR_SOCKET other side closed`) | 28.4 / 29.6 / 29.2 s in each process's first run (PGlite's first open); ≤ 0.8 s afterwards |
  | sequential | 18 | 0 | ≤ 1.6 s |

  The long stalls during the D1 replay happen only when PGlite opens at the same time. They come from the first open in a process, which is the only open in a `verify`.

### E6. Why it showed up in C and not in B
The chance of failure depends on two things: how long PGlite's start-up blocks, which grows with CPU contention (about 6 s at load 12, about 29 s under extra burners, E5), and whether a D1 request is in flight with another socket idle at that moment. C-RUN ran about twice as many test files as Phase B, with longer test durations (E1), so these windows were longer and more common. One failure per run, in different tests each time (E2), is what a load-dependent race looks like. Load is not the cause. It is the condition that lets the race in the code show.

## Cause → symptom chain
1. `runMigrationChecker` overlaps the D1 replay and the PGlite replay (`checker.ts:38`) — E5 (code).
2. PGlite's start-up blocks the Node main thread for seconds: ≥ 6 s at this machine's normal load, ~29 s under contention — E5 (pgstall, e1).
3. While the thread is blocked, `workerd` closes idle platform-proxy keep-alive sockets, and undici's 1 s client keep-alive timer cannot run — E3 (FINs read only after the 47 s stall; Miniflare's own comment on workerd's 5 s idle timeout), E4 (≥ 7 s block fails, 3 s does not).
4. On resume, the next D1 proxy call (`introspectSqlite` → `rows` → `.all()`) is written to a closed socket before its FIN is read → `TypeError: fetch failed`, cause `UND_ERR_SOCKET other side closed`. Undici does not retry a POST — E3 (timeline, stack), E4.
5. `replay` does not catch it (it catches only `MigrationFailedError`), so `runMigrationChecker` rejects → `verify`'s `staticStep` rejects → `runCommand` catch prints `verify failed: fetch failed`, exit 1 (`main.ts:72`) — E3 stack, Symptom.
6. In the tests: the CLI-AC-002 second offline run and the MIG-AC-001 control run hit this, so their `toBe(0)` / `toBe(first.code)` assertions fail — Symptom.

## Alternatives ruled out
- **"Under no-network the checker makes a real network request."** Not the cause. The one external request is Miniflare's `Request.cf` download (`https://workers.cloudflare.com/cf.json`). Under `unshare -rn` it goes to the agent proxy (`127.0.0.1:38381`, from `HTTPS_PROXY`, through Wrangler's `EnvHttpProxyAgent`) and gets `ECONNREFUSED`. I traced it in the e2e-scaffold offline `verify` runs. But Miniflare's `setupCf` catches it and uses a placeholder (`node_modules/miniflare/dist/src/index.js` around 78689–78703). The offline in-place `verify` and the offline checker runs passed before `node_modules/.mf/cf.json` existed (it was first written at 05:21Z). The failing request in E3 goes to `workerd` on loopback (`/cdn-cgi/local/platform-proxy`, remote port = the runtime entry), and it fails the same way online (E2, E3, E4).
- **Remote bindings / remote proxy session.** `getPlatformProxy` starts one only for bindings marked remote (`maybeStartOrUpdateRemoteProxySession`, `wrangler-dist/cli.js:185543`, returns null when there are none). The checker's config has one local D1 binding.
- **Code or dependency change since Phase B.** None in the code path (E1).
- **The tests are wrong.** No. CLI-REQ-002 requires `verify` to pass on a valid app, and to give the same result twice with networking off. MIG-AC-001's control run must pass for the edit to be judged. In both failing runs the app was valid, and the same tests pass when the race does not occur.
- **The dev registry (all checker instances register the worker name `migration-checker` in `~/.config/.wrangler/registry`).** The failing request is a platform-proxy call to the process's own `workerd` entry socket (E3), not a registry or service-binding request. The minimal reproduction (E4) uses one instance and fails the same way.
- **workerd crash.** A crash would refuse later connections. In E3, s1's request got its 200 response after the stall, and in E4 the following tries on the same proxy succeed.
- **"Just load."** Load lengthens the stall (E5), but a single 7 s main-thread block reproduces the failure on an otherwise idle proxy (E4). The block comes from the checker's own design (E5).

## Proposed fix
In `packages/framework/src/check/migrations/checker.ts`, `runMigrationChecker`: run the two replays **one after the other** (for example `const sqlite = await replay("sqlite", root); const postgres = await replay("postgres", root);`). Then the D1 platform proxy is disposed (`db.close()` in `replay`'s `finally`) before PGlite starts, and no D1 keep-alive socket exists while PGlite blocks the thread. Order matters only for speed, and either order removes the overlap. The cost is a few seconds per `verify` (E5: PGlite open ~8 s at current load). Keep `checker.ts`'s header comment in step with the change. If the order of diagnostics is specified anywhere, it is unchanged, because results are pushed sqlite then postgres in both cases.

Not proposed: retrying failed D1 proxy calls. They are POSTs that may carry migration statements, so a retry could apply a statement twice, and it would hide the overlap rather than remove it.

Files: `packages/framework/src/check/migrations/checker.ts`; test in `packages/framework/src/check/migrations/checker.unit.test.ts`.

## Verification plan
1. **Red (unit).** In `checker.unit.test.ts`, mock `./databases.js` so that `openCheckDatabase` records open and close events per dialect. Assert that the sqlite database is closed before the postgres database is opened, or more generally that the two are never open at the same time. This fails on the current code (`Promise.all` opens both) and passes after the fix.
2. **Green.** Make the change, then run `npm run test:unit`, and `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/check/migration-checker.test.ts packages/framework/test/integration/mig/generate.test.ts packages/framework/test/integration/cli/verify.test.ts` (CHECK-AC-004 must still pass, since its diagnostics are unchanged).
3. **Stress check of the mechanism.** Rerun scratchpad `stress.sh` (6 burners × 6 concurrent `runMigrationChecker` × 8 runs, with the v2 trace) on the fixed `dist`. Expect 0 of 48 `fetch failed`, and no main-thread stall over ~2 s while a D1 database is open. Before the fix: 1/48 (`st2`), and 1/18 in `e1` parallel mode.
4. **Re-check (§7).** The test runner reruns `npm run compliance -- --target local` (full), and CLI-AC-002, MIG-AC-001, CHECK-AC-001/002 and SQL-AC-002 must not fail with `fetch failed`. A single clean run cannot prove a race is gone, so step 3 is the main evidence.

## Notes for the reviewer
- Separate from this record: my full driver run also failed CHECK-AC-003 (known), and `tests/compliance/criteria/mig/deploys.test.ts` (MIG-AC-002/003), which passed in C-RUN. I did not diagnose those.
- Evidence scripts (scratchpad `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/`): `trace/fetch-trace.cjs`, `trace/fetch-trace2.cjs`, `trace/with-trace*.sh`, `mc.mjs`, `mc2.mjs`, `repro.mjs`, `pgstall.mjs`, `idle.mjs`, `stress.sh`, `stress2.sh`, `run-full.sh`. The traces are in `trace/full1/trace-26244.log` (E2/E3 driver run) and `trace/st2/trace-20617.log` (E3 timeline). The scratchpad is ephemeral. The excerpts above are the record.
