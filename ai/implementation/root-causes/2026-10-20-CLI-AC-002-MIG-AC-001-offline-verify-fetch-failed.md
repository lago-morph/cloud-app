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

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this or write the code or tests. I changed no code or tests. Local only: no Cloudflare calls. My own experiments ran on this branch's code (`npm ci`, `npm run build -w packages/framework`, commit `origin/claude/implement-local-cloudflare`), with scripts in the scratchpad `rc2/` folder (`a.mjs`, `poll.cjs`, `checker-par.js`/`checker-seq.js` = the built `checker.js` with only the `Promise.all` line changed and a flag set while the sqlite replay is opening or open, `mc.mjs`, `stress.sh`, `cta.mjs`). Machine: 4 CPUs, load average 9–21 from other agents during the runs.

**Verdict: ACCEPTED.**

### Each link, checked
1. **Minimal reproduction (E4).** The diagnoser's `repro.mjs` against my install: 7 s block, 2/5 tries `fetch failed`, cause `UND_ERR_SOCKET other side closed`. My own copy with a socket poller: 2/4 failed at 7 s. The precondition is narrower than "any D1 call after a block": with only idle pooled sockets and the next call issued right after the block (same continuation, or after one `setImmediate`), 0/3 failed at 7–8 s, and with a 30 ms pause between pooling and the in-flight request, 0/5 failed at 3–8 s. The failure needs a request **in flight across the block** whose response continuation issues the next call before the event loop reads the FIN on another pooled socket. The checker's replay is exactly that chain (`introspectSqlite` → `rows` → sequential `.all()` calls), so the narrowing supports the record.
2. **Is the socket closed by workerd's idle timeout?** Yes. `poll.cjs` reads the client process's socket states from `/proc` in a separate process while the Node main thread is blocked: the pooled sockets to workerd's runtime port go from `ESTABLISHED` to `CLOSE_WAIT` (peer FIN received, client has not closed) between 4.3 s and 5.3 s after they went idle, in every try. The client cannot close anything while blocked, so the close is the peer's ~5 s idle timeout (as Miniflare's own comment at `index.js:134691` says), not a client-side or crash close.
3. **Does PGlite's start-up block the thread while D1 is in use, in the real checker?** Yes. `mc.mjs`, one checker run per fresh process like `verify`: parallel (current code) longest stall while the D1 replay was opening or open 7.1 s / 8.2 s at load ~9. Under `stress.sh 6 4` (4 parallel-mode and 4 sequential-mode processes at once, 6 rounds, same load for both): **parallel 2/24 threw** `fetch failed` / `UND_ERR_SOCKET other side closed`, D1-time stalls 11.3–32.2 s; **sequential 0/24 threw**, D1-time stalls 0.29–0.92 s, while the same processes' overall longest stall (PGlite, after D1 was disposed) was 17–22 s. So sequential replay does not just shrink the window inside the checker; it removes the PGlite stall from the D1 period entirely. What remains during D1 (< 1 s) is far below workerd's 5 s timeout, and undici's own 1 s keep-alive timer can run.
4. **Write to a closed socket → `fetch failed`, not retried, escapes `replay`.** Confirmed by the failures above and by reading `checker.ts` (`replay` rethrows anything that is not `MigrationFailedError`) and `main.ts:72`.

### Other code paths
- **`createTestApp`, Postgres dialect** (`test-app.ts:215–218`) does open `getPlatformProxy` (D1 + R2) and then, in a process's first call, the long PGlite start-up while the proxy's sockets are pooled. `cta.mjs` reproduces that order, with and without three extra pooled sockets made just before PGlite, then issues R2/D1 calls right after: **0/24 failed** although every run had a 15–19 s stall with sockets idle. Nothing is in flight across the block there, so the precondition of link 1 is not met. No test calls `createTestApp` concurrently (grep: no `Promise.all` over it among 77 uses). Not exposed today; it would become exposed if a test overlapped an in-flight proxy call with another app's first PGlite open.
- **`dev`**: its process opens `getPlatformProxy` only to migrate (`cli/dev/runtime.ts:48–56`) and never loads PGlite. The app runs in a separate wrangler process. Not exposed.
- **Compliance driver**: it runs the tests in Vitest forks (`pool: "forks"`) and `dev` as a child process. Its exposure is the checker (inside `verify` runs and in tests that call `runMigrationChecker`) and `createTestApp` above. The fix covers the first.
- **`verify`**: type checking and the portability rules block the thread too, but they run before the checker step, while no proxy is open (`verify.ts:115–117`).

### Alternatives
- **Retry once on a stale pooled socket / disable keep-alive in the D1 proxy client.** The pool is Miniflare's internal `ProxyClientBridge` dispatcher. `getPlatformProxy` has no option to configure it, so either change means patching or wrapping a dependency's internals. A retry is also unsafe for these POSTs in general (a migration statement could run twice), and it would hide the overlap rather than remove it. I agree with the record's rejection.
- **PGlite in a worker thread.** This would remove main-thread blocking everywhere, including `createTestApp`. But it changes the Postgres harness that `createTestApp` and the tests share, and it is not needed: in the checker, the overlap itself is the cause, and removing it is enough (link 3). It could be useful hardening later, not part of this fix.
- **"Just load."** Ruled out, as in the record: load only lengthens the stall. With sequential replay at the same load, the D1-time stall stays < 1 s.

### D-03's unexplained socket error
D-03's root-cause record (`2026-10-20-D-03-unit-timeouts-under-load.md`) noted `TypeError: fetch failed … SocketError: other side closed` from Miniflare's local proxy during `introspectSqlite` in `checker.unit.test.ts` (CHECK-AC-004 supported changes) under load. That has the same signature and the same code path: `runMigrationChecker` → parallel replay, where the first replay in a Vitest fork pays PGlite's template creation while the D1 replay runs. This cause explains it. That line in the D-03 record can be closed by this fix, and its re-check should be included.

### What the fix must include
1. In `runMigrationChecker`, run the replays one after the other, so that the D1 platform proxy is fully disposed (`replay`'s `finally` has completed) before any PGlite work starts, or the other way round. No D1 call may be made while PGlite is opening. Keep the diagnostics order (sqlite, postgres, comparison). Update the header comment of `checker.ts`, and `docs/components/check.md` only if it states anything about concurrency (it does not today).
2. A red-first unit test in `checker.unit.test.ts` that mocks `openCheckDatabase` and asserts that the two dialects' databases are never open at the same time (open/close event order). It must fail on the current `Promise.all`. A timing-based test is not acceptable.
3. No retries, no swallowed `fetch failed`, and no test changes beyond the new test.
4. Re-check: the record's verification steps 2–4, plus the stress check (step 3, or my `rc2/stress.sh` on the rebuilt `dist`: expect 0 throws and D1-time stalls < 2 s), plus `checker.unit.test.ts` in `npm run test:unit` (D-03's symptom).
5. Optional, separate from this fix: `describeFailure` in `main.ts` could print `error.cause` too, which would have made this symptom diagnosable from the CLI output alone.
