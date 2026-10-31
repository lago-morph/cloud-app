# Root cause: `native-copy.unit.test.ts` fails with `fetch failed` under machine load

Author: diagnosing subagent (plan `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.8, prompt `ai/prompts/implement-local-cloudflare.md` §8 step 1). I did not write the code or the tests. This is a diagnosis only: no code or test was changed. It needs an independent review (§8 step 2) before anyone fixes it. Local only: no Cloudflare calls were made.

**Finding in one line.** The test support is wrong; the code under test and the test are right. The fake D1 HTTP API (`packages/framework/src/provision/cloudflare/d1/fake-d1-api.ts`) prepares every statement of an import with `binding.prepare(...)`, and through Wrangler's `getPlatformProxy` each `prepare` is a **synchronous** Miniflare proxy call that blocks the Node main thread (`Atomics.wait`) until `workerd` answers. One ingest in the failing test is about 287 such calls with no event-loop turn between them; the test runs two ingests back to back. Under CPU contention the two blocks together keep one of Miniflare's pooled keep-alive sockets to `workerd` idle for more than `workerd`'s 5 s idle timeout, while undici's own 1 s keep-alive timer cannot run (its clock only advances on event-loop ticks). `workerd` closes the socket; the next async proxy call (`binding.batch(...)` of the second ingest) is written to it before the FIN is read, and fails with `TypeError: fetch failed`, cause `UND_ERR_SOCKET: other side closed`. The fake turns that into the import's error, so `importDump` throws `importing into D1 database … failed: fetch failed`. It is the same socket mechanism as `2026-10-20-CLI-AC-002-MIG-AC-001-offline-verify-fetch-failed.md`; here the main-thread block is Miniflare's synchronous proxy calls, not PGlite.

It reproduces on `origin/main` (1e0c289), the base of every v0.2.0 branch. `origin/v0.2.0/17-ci-no-duplicates` changes nothing under `packages/` and not `package-lock.json` (`git diff --quiet origin/main origin/v0.2.0/17-ci-no-duplicates -- package-lock.json packages/`), so S3 did not cause it.

## Symptom
Reported by plan item S3: `npm run test:unit` on `origin/v0.2.0/17-ci-no-duplicates` passed once (2546 tests), then failed twice in `packages/framework/src/provision/cloudflare/d1/native-copy.unit.test.ts` with "fetch failed", at load average 13–28 on the shared 4-CPU machine. The file passes alone.

Every failure I reproduced is the same test and the same line:
```
× the restore file keeps the dump's order, so rows referencing a lossy table stay within the import's ~4 KB foreign-key deferral (A-06)
Error: importing into D1 database <uuid> failed: fetch failed
 ❯ poll packages/framework/src/provision/cloudflare/d1/native-copy.ts:129:64
 ❯ importDump packages/framework/src/provision/cloudflare/d1/native-copy.ts:163:3
 ❯ packages/framework/src/provision/cloudflare/d1/native-copy.unit.test.ts:183:5
```
Line 183 is the second, correct import (`restored`), which must succeed. `native-copy.ts:129` throws because the fake's `poll` answer carries `error: "fetch failed"`: the fake's `importAction` catches whatever `binding.batch(statements)` throws and reports it as the import's error (`fake-d1-api.ts`, `ingest` branch). So the `fetch failed` is thrown inside the fake, by Miniflare's proxy client, not by the code under test.

## Evidence

Scripts and logs are in my scratchpad (`/tmp/claude-0/-home-user-cloud-app/40acaefa-30e9-5664-9b0f-2d72e2fb0b88/scratchpad/`). The scratchpad is ephemeral; the excerpts below are the record.
- `trace/trace.cjs`: a `NODE_OPTIONS=--require` preload (no repository change). It logs every `new TypeError("fetch failed", { cause })` with its cause and stack, and dumps a ring buffer of undici `diagnostics_channel` events (connect, send, response, error), socket FIN/close, and main-thread stalls (a 200 ms interval timer).
- `trace/sync-bursts.cjs`: a preload that wraps `worker_threads.receiveMessageOnPort` on the main thread (Miniflare's synchronous proxy reply path, `receiveReply`, `node_modules/miniflare/dist/src/index.js:119860–119881`) and logs every run of synchronous proxy calls longer than 300 ms with no event-loop turn in between.
- `stress.sh <label> <burners> <copies> <rounds>`, `bursts.sh <label> <burners> <copies>`: concurrent `npx vitest run --config vitest.unit.config.ts <this file>` next to `node -e 'for(;;){}'` busy loops. `full.sh`: `npm run test:unit` next to busy loops. `repro/repro.mjs`: the minimal reproduction (E4).

### E1. It reproduces on `origin/main`, only under load, always in the same test
All on a detached `origin/main` (1e0c289), after `npm ci`. The machine had 4 CPUs and other agents' load (load average 6–24) on top of what I added.

| run | added load | result |
|---|---|---|
| the file alone, 4 times | none (load 12–19 from other agents) | 4/4 passed (21 tests, 31–44 s) |
| `stress.sh s1 6 4 3` | 6 busy loops, 4 copies at once, 3 rounds | **5/12 failed**, each with 1 failed test (the one above) |
| `bursts.sh b-load 6 4` | 6 busy loops, 4 copies at once | **4/4 failed**, same test |
| `stress.sh offline 6 4 1` under `unshare -rn sh scripts/offline.sh` | 6 busy loops, 4 copies, no network | **4/4 failed**, same test, same cause |
| `stress.sh threads 6 4 1 --pool threads` | 6 busy loops, 4 copies, Vitest `threads` pool | **2/4 failed**, same test, same cause |
| full suite, see E6 | 4 busy loops | passed in this run |

### E2. The failing request: a platform-proxy call to the test's own `workerd`, on a socket idle for more than 5 s
Every traced failure (9 of 9) has the same cause, written to the loopback runtime entry of the `workerd` that `openFakeD1Api` started:
```
cause: SocketError UND_ERR_SOCKET other side closed
  {"localAddress":"127.0.0.1","localPort":38154,"bytesWritten":8603,"bytesRead":32058}
    at Socket.onHttpSocketEnd (node_modules/undici/lib/dispatcher/client-h1.js:959:22)
construct-site: TypeError: fetch failed
    at Object.processResponse (node_modules/undici/lib/web/fetch/index.js:237:16)
reqError POST http://127.0.0.1:33641/cdn-cgi/local/platform-proxy UND_ERR_SOCKET other side closed
```
The ring buffer of that process (`runs/s1/trace/trace-21372.log`), from the failing test's proxy start (times Z):
```
09:00:11.524 connected s21 → 127.0.0.1:33641         (Miniflare's runtime pool, 2 sockets)
09:00:12.508 connected s22 → 127.0.0.1:33641
  … seeding, exportDatabase: async proxy calls alternating s21/s22, every 10–50 ms …
09:00:13.525 resDone (s22)                             <- s22 idle from here
09:00:16.048 sendHeaders s21 POST /cdn-cgi/local/platform-proxy   (first ingest's batch)
09:00:16.049 main-thread stall 2423ms                  <- first ingest's prepares
09:00:16.074 resHeaders 500                            (the expected FOREIGN KEY failure of the "wrong" import)
09:00:18.595 sendHeaders s22 POST /cdn-cgi/local/platform-proxy   (second ingest's batch; s22 idle 5.07 s)
09:00:18.596 main-thread stall 2347ms                  <- second ingest's prepares
09:00:18.601 socket-end (FIN from peer) s22            <- FIN read only after the write
09:00:18.601 reqError … UND_ERR_SOCKET other side closed
```
All 9 traced failures (5 in `runs/s1`, 4 in `runs/b-load`; summarised by scratchpad `idle.mjs`) have the same shape: the failing socket was last used at the end of the export, two main-thread stalls follow (the two ingests), the second ingest's batch is written to that socket after it has been idle for **5.07–8.22 s**, and the FIN is read 0–99 ms after the write. `bytesWritten` 8603 is the second ingest's `batch` call (statement handles), the same size in every failure.

The proxy environment is not involved. `HTTPS_PROXY` and `NO_PROXY` are set in the sandbox, and `NO_PROXY` includes `localhost,127.0.0.1,::1,127.0.0.0/8`; the failing request goes from Miniflare's own `undici.Pool` straight to `http://127.0.0.1:<entry port>` (E2 trace), and the minimal reproduction fails the same way with no network at all (E4).

### E3. What blocks the main thread: Miniflare's synchronous proxy calls, about 287 per ingest
- Miniflare's proxy client runs a call synchronously unless the function is already known to return a Promise, or its arguments hold streams (`#call`, `node_modules/miniflare/dist/src/index.js:120453–120488`). The sync path posts to a `SynchronousFetcher` worker thread and waits with `Atomics.wait` on the main thread until `workerd` has answered (`#syncCall` 120489; `receiveReply` 119860). `D1Database.prepare` returns a statement, not a Promise, so every `binding.prepare(sql)` blocks the main thread for one cross-thread, cross-process round trip.
- The fake's ingest does `withDeferralLimit(lines).map((l) => binding.prepare(...))` in one synchronous `map` (`fake-d1-api.ts`, `importAction`). `withDeferralLimit` adds three probe statements per `INSERT`. The failing test's restore file has about 69 `INSERT`s (60 `children` rows among them), so one ingest is about 285 statements, and the test runs two (`wrong`, then `restored`).
- **Measured** with `sync-bursts.cjs` (each line is one burst with no event-loop turn):

  | condition | the two ingests of the failing test | other bursts in the file |
  |---|---|---|
  | file alone, load ≈ 6 (`runs/b-idle`) | 287 calls in 577 ms, 287 calls in 1071 ms | 183 calls in 362 ms; the rest < 300 ms |
  | 6 busy loops + 4 copies (`runs/b-load`), per failing process | 2480 + 3903 ms; 2363 + 3596 ms; 2825 + 3562 ms; 3121 + 4927 ms | ≤ 1528 ms |

  The two ingests are separated by only the first ingest's async `batch` and `poll` (tens of ms, on the other pooled socket). So the socket left idle at the end of the export stays idle for the sum of both bursts plus the export-to-ingest gap: about 2 s alone, more than 5 s under load. No other test in the file has a pair of bursts this large.

### E4. Minimal reproduction: synchronous proxy calls alone, nothing from the framework but the fixture config
`repro/repro.mjs`: `getPlatformProxy` with `fixtures/wrangler.jsonc` (as `startPlatformProxy` calls it), two pooled sockets (`Promise.all([q(), q()])`), then `D0.prepare(...)` in a loop for `BLOCK_MS` (the fake's pattern), then `await D0.batch(...)` in the same continuation. 4 tries each, load ≈ 3–6:

| synchronous `prepare` loop | result |
|---|---|
| 3000 ms (~1600 calls) | 0/4 failed |
| 4500 ms (~2300 calls) | 0/4 failed |
| 6000 ms (~3000 calls) | **4/4** `fetch failed`, cause `UND_ERR_SOCKET other side closed` |
| 8000 ms (~4700 calls) | **4/4** failed, same cause |
| 6000 ms, under `unshare -rn sh scripts/offline.sh` | **3/3** failed, same cause |
| 3000 ms, offline | 0/2 failed |
| 6000 ms and 8000 ms, `await new Promise((r) => setImmediate(r))` after each `prepare` | **0/8** failed |

So the failure needs only a run of synchronous proxy calls longer than about 5 s with a pooled socket idle, does not depend on the network or the agent proxy, and goes away when the event loop gets a turn between the calls, even though the total time spent in synchronous calls is the same.

### E5. Why the idle socket is not retired by the client first
- Miniflare's runtime pool sets `keepAliveTimeout: 1e3` with the comment "Close idle client sockets before workerd's 5s idle timeout" (`node_modules/miniflare/dist/src/index.js:134691`).
- undici (7.29.1) runs that timer on its fast-timer clock, which advances by 499 ms per tick "despite the actual time that has passed since the last tick … independence from … delays caused by a blocked event loop" (`node_modules/undici/lib/util/timers.js:113–123`). A 1 s keep-alive therefore needs two to three ticks, that is, event-loop turns about 0.5 s apart. During a synchronous burst there are none, and between the two ingests there is only a turn or two. Meanwhile `workerd` measures its 5 s idle timeout in wall-clock time in its own process, and sends FIN.
- When the main thread resumes, the second ingest's `batch` is issued in the same synchronous run as its prepares, before the poll phase reads the FIN, so undici writes the request to the closed connection. The request is a POST, which undici does not retry. (The earlier record's review measured the `ESTABLISHED` → `CLOSE_WAIT` transition 4.3–5.3 s after idle with `/proc`; I did not repeat that. The timing here is consistent with it: in all 9 failures the socket had been idle at least 5.07 s (E2), and in E4 4.5 s never fails while 6 s always does.)

### E6. The full unit suite
`full.sh full-main-b4-2 4`: `npm run test:unit` on `origin/main` code (checked out at this branch's first commit, which adds only this record) with 4 busy loops, load average 16–30 (other agents' suites ran too), 15 min. `native-copy.unit.test.ts` **passed** in this run; 2526 of 2527 tests passed. The one failure is unrelated to this record (`tests/compliance/harness/selection.unit.test.ts`, E2E-004 cloud selection, an assertion on the selected criteria; I did not diagnose it). So in the full suite the failure is intermittent, as S3 saw (one pass, two failures): whether it happens depends on how slow the synchronous calls are while that one test runs. An earlier full run (`full-main-b4`) was stopped by my tool's 10-minute limit before it finished and proves nothing.

The trace preload also caught one `UND_ERR_SOCKET other side closed` in another fork during that full run (`maxStall so far 16056ms`). It did not fail any test, and I could not tell which file it came from. It is the same signature; I did not diagnose it further (see the scope note under **Proposed fix**).

## Cause → symptom chain
1. The fake D1 HTTP API prepares each statement of an import (and of a `query` batch) with `binding.prepare(...)` in one synchronous loop (`fake-d1-api.ts`, `importAction` and `query`) — code.
2. Through `getPlatformProxy`, each `prepare` is a synchronous Miniflare proxy call that blocks the Node main thread until `workerd` answers — E3 (Miniflare source; burst measurements).
3. The failing test runs two ingests of ~287 synchronous calls each, back to back; under CPU contention each takes 2.3–4.9 s instead of 0.6–1.1 s, so one pooled socket stays idle for more than 5 s with almost no event-loop turn — E2 (timeline), E3 (table).
4. undici's 1 s keep-alive cannot retire the socket because its clock does not advance during the block; `workerd` closes it at its 5 s idle timeout — E5, E4 (≥ 6 s fails, ≤ 4.5 s does not).
5. The second ingest's `binding.batch(...)` is written to the closed socket before the FIN is read → `TypeError: fetch failed`, cause `UND_ERR_SOCKET other side closed` — E2, E4.
6. The fake reports it as the import's error; `poll` (`native-copy.ts:129`) throws `importing into D1 database … failed: fetch failed`; the test's `await importDump(...)` at line 183 rejects — Symptom.

## Alternatives ruled out
- **A real network request, or the agent proxy (`HTTPS_PROXY`).** The failing request goes to `127.0.0.1:<workerd entry port>` from Miniflare's own pool (E2); `NO_PROXY` covers loopback; the minimal reproduction fails the same way under `unshare -rn` (E4). The fake's signed URLs (`https://fake-d1-*.invalid/…`) never reach the network: `transfer` serves them from a `Map` in process.
- **A change in S3 (`origin/v0.2.0/17-ci-no-duplicates`).** It reproduces on `origin/main` (E1); S3 changes nothing under `packages/` and not the lockfile.
- **A defect in `native-copy.ts` or in the test.** The thrown error originates in Miniflare's proxy client inside the fake (Symptom, E2). The test's expectations are right: the correct restore must import. The same test passes whenever the block is short (E1 alone, E3 at load 6).
- **A `workerd` crash.** A crash would refuse later connections; in E2 the first ingest's call on the other socket got its answer (500, the expected FOREIGN KEY failure) during the same window, and in E4 the following tries against fresh proxies pass.
- **Dev registry interference (`2026-10-20-testing-dev-registry.md`).** `openFakeD1Api` starts its proxy through `startPlatformProxy`, outside the registry; the failing request is a platform-proxy call to the process's own entry socket (E2), and the single-process reproduction fails the same way (E4).
- **A Vitest timeout.** The test has a 60 s timeout and failed after 8–15 s with an assertion error, not a timeout.
- **"Just load."** Load only lengthens the synchronous bursts (E3). A single 6 s run of synchronous calls fails on an otherwise idle machine, every time (E4), and the same total synchronous time with event-loop turns in between never fails (E4).

## Proposed fix
In `packages/framework/src/provision/cloudflare/d1/fake-d1-api.ts` (test support only; not part of the package's public surface):
- Add one helper, for example `async function prepareAll(binding, items: { sql: string; params?: unknown[] }[]): Promise<D1StatementLike[]>`, that prepares (and binds) the statements one at a time and lets the event loop run after each (`await new Promise((r) => setImmediate(r))`).
- Use it in `importAction` (the `ingest` branch, instead of `withDeferralLimit(lines).map((l) => binding.prepare(…))`) and in `query` (instead of `items.map((i) => binding.prepare(i.sql).bind(…))`).
- Keep `binding.batch(statements)` as one call, so the import stays atomic and the deferral probe still works.
- Extend the header comment: Miniflare's `prepare`/`bind` are synchronous proxy calls, and long runs of them let `workerd` close idle pooled sockets; cite this record.

With a turn after every statement, no synchronous run is longer than one statement's round trip; the poll phase reads any FIN before the socket is reused, and undici's fast timer ticks on time, so its 1 s keep-alive retires idle sockets before `workerd`'s 5 s (E4, `yield` rows). The cost is one `setImmediate` per statement, which is negligible next to a cross-process round trip.

Not proposed:
- Retrying failed proxy calls: they are POSTs (here a whole import batch), and a retry would hide the block rather than remove it.
- Fewer statements (for example merging the three probe statements of `withDeferralLimit`): it lowers the constant only; a slower machine reaches 5 s again.
- Changing Miniflare's pool (`keepAliveTimeout`, keep-alive off): it is internal to `getPlatformProxy`, which has no option for it.
- Raising test timeouts: unrelated; the test does not time out.

Files: `packages/framework/src/provision/cloudflare/d1/fake-d1-api.ts`; test in `packages/framework/src/provision/cloudflare/d1/fake-d1-api.unit.test.ts`.

Scope note, not proven exposed: other in-process callers of `getPlatformProxy` that issue many synchronous proxy calls in a row (`mig/apply.ts` applying migrations to a proxied D1 in `createTestApp`; `check/migrations/databases.ts`) have the same hazard in principle. Their runs are short (tens of statements), and I saw no failure from them. The reviewer may want the helper to live where those can use it later, but this fix need not change them.

## Verification plan
1. **Red (unit, no timing).** In `fake-d1-api.unit.test.ts`, wrap `startPlatformProxy` with `vi.mock("../../../targets/local/platform-proxy.js", …)` so that it delegates to the real function (the file's other tests keep real D1) and, for the new test, wraps each env binding so that `prepare` records whether an event-loop turn happened since the previous `prepare` (a flag set by a `setImmediate` scheduled at each `prepare`). Ingest a dump with at least 50 `INSERT` lines through `fake.api` (or `importDump`), and assert that every `prepare` after the first was preceded by a turn. Do the same for a `query` batch of several statements. Both fail on the current code (all prepares in one synchronous run) and pass after the fix.
2. **Green.** `npx vitest run --config vitest.unit.config.ts packages/framework/src/provision/cloudflare/d1/` (all files there use the fake), then `npm run test:unit`.
3. **Stress check of the mechanism (the main evidence; a single clean run cannot prove a race is gone).** Rerun `bursts.sh` (6 busy loops × 4 concurrent copies of `native-copy.unit.test.ts`, with both preloads) and `stress.sh s 6 4 3` on the fixed code. Before the fix: 4/4 and 5/12 failed. Expect 0 failures, and no synchronous burst over 300 ms from the fake's ingests (`sync-bursts.cjs` logs none).
4. **Offline.** `unshare -rn sh scripts/offline.sh npx vitest run --config vitest.unit.config.ts packages/framework/src/provision/cloudflare/d1/native-copy.unit.test.ts` passes.
5. **Re-check (§7).** The S3 item's `npm run test:unit` on its branch, after it is rebased onto the fix.
