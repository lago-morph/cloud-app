# Root cause: MIG-AC-002 no-change deploy, `dev` exits 1 because workerd dies at startup with a fatal exception in `Server::run`. The signature matches a port-bind failure (`EADDRINUSE`) from `dev`'s pick-then-release port selection. It is not caused by fix-registry or fix-registry-2.

Author: diagnosing subagent (prompt §8 step 1). I did not write the code or the tests, and I did not record the failing run. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: branch `claude/implement-local-cloudflare-diag-mig002`, from `origin/claude/implement-local-cloudflare` `abc4f8c`. The code under test is `760e7b7`; `abc4f8c` adds only evidence. Installed versions: wrangler `4.149.0`, workerd `2026-10-06` (BuildID `0b5d187affc3a718243e030d8759e08dd16993a9`, not stripped). Node `v22.22.0`, 4 CPUs.

Scratch files are outside the repo, in `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/mig002diag/`:
- scripts: `eport.mjs`, `erace.mjs`, `overlap.py`, `workerd-wrap.sh` and `../run.sh`;
- logs: `run1.log`, `run2.log`, `run3.log`, `eport/case-*.log`, `workerd-capture/`.

A different subagent must review this record.

## Symptom
The full local compliance run `r5nndia2aediccu` (at `760e7b7`) failed one test: `tests/compliance/criteria/mig/deploys.test.ts:109`, "[MIG-AC-002] a second deployment with no changes …". The message, from `raw/vitest.json`, is cut to the last 1500 characters by the test (`result.output.slice(-1500)`):

```
AssertionError: no-change deploy failed (status 1): cloud-app/…/workerd-linux-64/bin/workerd@5a404cd …/workerd@2159d90 …/workerd@215cd18 …/workerd@21430f2 …/workerd@2143108 …/workerd@5b18586 …/workerd@2143154 /lib/x86_64-linux-gnu/libc.so.6@2a1c9 /lib/x86_64-linux-gnu/libc.so.6@2a28a …/workerd@2143024
[wrangler] If you think this is a bug then please create an issue at …
[wrangler] Note that there is a newer version of Wrangler available (4.151.3). …
[wrangler] 🪵  Logs were written to "/root/.config/.wrangler/logs/wrangler-2026-10-20_23-05-37_327.log"
dev failed: wrangler exited with status 1 before serving
```

The other five tests in the file passed. That includes the next test, which serves the same stage again.

## Evidence

### What the test starts locally
- `stage.deploy("v1")` in `support/stage.ts:226-246` runs these steps:
  1. `dev.stop()`: SIGINT to the previous `dev`'s process group, then waits for close.
  2. It starts `node prototype-framework.js dev` on the scratch copy of `apps/reference`.
- `dev` (`src/cli/commands/dev.ts:50-67`) runs in this order:
  1. `build`.
  2. `ensureDevSecrets`.
  3. `migrate`: its own `getPlatformProxy`, disposed before the next step (`runtime.ts:50-58`).
  4. `freePort()` three times: client, worker and inspector ports. Each `freePort()` listens on `127.0.0.1:0`, reads the port and closes the socket (`runtime.ts:27-37`).
  5. Spawn `wrangler dev --port <worker> --inspector-port <inspector> …` (`plan.ts:32-46`).
- Wrangler then starts two workerd processes. One is a proxy whose entry socket is the explicit `--port`; the other is the user Worker, with `entry=127.0.0.1:0`, `--inspector-addr=127.0.0.1:0` and `--debug-port=127.0.0.1:0`. All of these bind on loopback. The argument lists come from my instrumented runs (`workerd-capture/*.args`), for example `serve … --socket-addr=entry=127.0.0.1:39525 …`.
- So between `freePort()` and workerd's `bind()`, the chosen worker and inspector ports are free for any process to take. That window lasts about 1–2 s: Node and wrangler startup, reading the config, and printing the bindings.

### F1: the visible stack is workerd's top-level fatal-exception path (symbolized with `addr2line` on the installed binary)
`5a404cd` = `run_serve`, `2159d90` = `workerd_cli::run_command`, `215cd18` = `workerd_cli::main`, `21430f2`/`2143108` = Rust `lang_start`, `5b18586` = `lang_start_internal`, `2143154` = `main`, `2143024` = `_start`. The frames above `run_serve` were cut off by the 1500-character slice.

### F2: a deliberate port collision gives the same output, frame for frame (`eport.mjs`, `eport/case-*.log`)
Setup: a scratch copy of `apps/reference`, built by one `dev` start. I then ran `wrangler dev` with exactly `dev`'s arguments, with the chosen port held by another socket:

| Port held | Held by | Exit | workerd stderr (first line) |
|---|---|---|---|
| `--port` | listening socket | 1 | `*** Fatal uncaught kj::Exception: rust/cxx/kj-rs-io/ffi.rs:209: failed: bind(): Address already in use (os error 98)` |
| `--port` | local end of a connected outbound socket | 1 | same |
| `--inspector-port` | listening socket | 1 | same |
| `--inspector-port` | local end of a connected outbound socket | 1 | same |
| none (control) | – | 130 (stopped by me after "Ready") | none |

In every collision case:
- The stack is `22abd7b 21b780b 5ad181e 5ad15fe 21b5ca6` followed by **exactly the ten frames visible in the failure**, in the same order: `5a404cd 2159d90 215cd18 21430f2 2143108 5b18586 2143154 libc@2a1c9 libc@2a28a 2143024`.
- `22abd7b` symbolizes to `workerd::server::Server::run(...) [clone .resume]`.
- Wrangler prints the fatal error, then "The Workers runtime failed to start … Runtime stderr: <the same text>", then "If you think this is a bug …", "Note that there is a newer version …" and "Logs were written to …". So the output's tail has the same shape as the failure.
- Miniflare's `ERR_ADDRESS_IN_USE` mapping (`miniflare/dist/src/index.js:116950`) looks for `Address already in use; toString() = `. This workerd's Rust bind error does not contain that text, so the raw stack is printed instead of wrangler's friendly message.

### F3: "the named log shows no error" is expected for this failure
The failed run's log (`wrangler-2026-10-20_23-05-37_327.log`) stops at the bindings table header (`23:05:38.148Z`), and its mtime is 23:05:38.

My forced bind failure's log (`wrangler-2026-10-20_23-51-32_026.log`) also stops in the bindings table, with no error. Wrangler loses its pending log-file writes when it exits on this error.

For comparison, the log of the successful initial deploy of the same test (`…23-05-28_048.log`) continues to "Starting local server" and `reloadComplete`.

So the crash happened within about 1 s of wrangler's start, before workerd reported its ports. That matches miniflare's `ERR_RUNTIME_FAILURE` path (`index.js:116961-116968`), which is taken only when workerd exits before announcing its ports and has written to stderr.

### F4: the code `dev` runs is unchanged between the passing and failing commits
`git diff --stat 26128b1 760e7b7 -- packages apps tests package.json package-lock.json` touches only these files:
- `check/migrations/databases.ts`
- `provision/cloudflare/d1/fake-d1-api.ts`
- `targets/local/platform-proxy.ts` (new)
- `testing/test-app.ts`
- their unit tests

`platform-proxy.ts` is imported only by those three modules. `dev` imports none of them:
- `runtime.ts` uses `wrangler`'s `getPlatformProxy` directly;
- the migration checker is loaded only by `verify` (`cli/wiring.ts:61`, `cli/commands/verify.ts:117`).

A local "deploy" is a `dev` start (DEC-0144). So the migration checker and the new platform-proxy helper do not run in the no-change deploy. The `dev` process and its wrangler and workerd children run byte-identical framework code, with the same wrangler and workerd, at both commits.

### F5: no OOM or kernel event at the failure time
`dmesg` (ring buffer from uptime 27675 s; the failure was at about 73920 s) has no OOM-killer, `segfault` or `killed` lines. The step logs' 1-minute load was 1.26 → 2.90. A SIGKILL from the OOM killer would leave workerd's stderr empty, and it would not produce a kj stack.

### F6: reproduction, the driver's path, `--only MIG-AC-002` (`npm run compliance -- --target local --only MIG-AC-002 --out <scratch>`)
This runs the integration vitest with `-t` matching `[MIG-AC-002]`: `deploys.test.ts` (2 tests) and `mig/deploy-local.test.ts` (1 test). Setup was the same as final-local-3: `npm ci`, the framework build, and dummy secrets.

| Run | Instrument | Start (UTC, load) | Result | No-change test |
|---|---|---|---|---|
| 1 (`1huitjqbqlv1ckj`) | none | 23:46:37, 0.37 | 3 passed, exit 0 | passed, 9075 ms |
| 2 (`znsz96ry7twifn7`) | `MINIFLARE_WORKERD_PATH=workerd-wrap.sh`, which records each workerd's arguments and full stderr | 23:53:13, 0.22 | 3 passed, exit 0; 15 workerd starts, no fatal line | passed |
| 3 (`ptqkpbcjvtktcdg`) | same | 23:56:21, 0.62 | 3 passed, exit 0; 15 workerd starts, no fatal line | passed |

The registry was empty after every run. **The failure did not reproduce in isolation.** In the failing full run, the test took 18404 ms: the failed start, then the harness restarting the previous version.

### F7: what ran beside it in the failing run (`overlap.py` on `raw/vitest.json`)
`deploys.test.ts` ran from 23:05:21 to 23:06:37. Files that overlapped it:
- `http/errors` (to 23:05:33);
- `files/server-operations` (23:05:33–23:05:50; `createTestApp` per test, each starting Miniflare and workerd on port-0 sockets);
- `files/app-facing-types` (23:05:36–23:05:39);
- `mig/deploy-local` (from 23:05:39; its own `dev` starts with `freePort()`);
- `core/types`, `cli/verify`;
- the driver's own run-stage `dev`, alive for the whole run.

Wrangler logs show several other instances starting between 23:05:33 and 23:05:37 (`…23-05-33_390`, `…23-05-35_112`). In the isolated runs (F6), none of these were present.

### F8: how often the kernel hands a freed port to another port-0 bind (`erace.mjs`)
Each trial calls `freePort()` (the same code), then opens K unrelated `listen(127.0.0.1:0)` sockets.

| Trials | K | Freed port taken | Rate per freed port |
|---|---|---|---|
| 2000 | 50 | 13 | 0.65 % |
| 2000 | 10 | 2 | 0.10 % |

That is about 1.3·10⁻⁴ per unrelated port-0 bind. Each `dev` start leaves two ports that workerd must bind, so its risk grows with the number of port-0 sockets other processes open during its ~1–2 s window. F2 shows that the local end of an outbound connection also blocks the bind.

## Causal chain
1. **`dev` picks the Worker and inspector ports by binding port 0 and releasing the socket, and workerd binds them about 1–2 s later.** Evidence: `runtime.ts:27-37`, `dev.ts:63-67`, the timestamps in F3, and the explicit `entry=127.0.0.1:<port>` arguments in `workerd-capture/*.args`.
2. **In that window, another socket on the host can take the port.** In the full run, many processes open loopback port-0 sockets and outbound connections at the same time (F7). The kernel does hand a freed port to a later port-0 bind (F8), and an outbound connection's local port blocks the bind too (F2).
   - Not proven for this run: which socket held the port. No per-port record of the run exists.
3. **workerd then throws `bind(): Address already in use` inside `Server::run`, prints a kj fatal with this exact frame chain, and exits before announcing ports.** Wrangler reports `ERR_RUNTIME_FAILURE` with the raw stack and exits 1. Its log file is cut off in the bindings table. Evidence: F2 (frame-identical tail, same wrangler output shape) and F3.
   - **Not proven:** that the first, cut-off line in the failing run was `bind(): Address already in use`. The ten visible frames are the common path of *any* fatal kj exception or crash signal that ends `Server::run` on the main thread (F1). They show that workerd died at startup in its main event loop. On their own they do not show that the error was a bind failure.
4. **`dev` sees wrangler exit before the port accepts, and returns status 1 with "wrangler exited with status 1 before serving"** (`runtime.ts:87-89`). The test asserts `result.ok` and fails, keeping only the last 1500 characters. Evidence: the failure message.

## Alternatives ruled out (and what is not)
- **fix-registry, fix-registry-2, the platform-proxy helper, the migration checker or the fake D1 API — ruled out.** None of them runs in a local deploy (F4).
  - Their only effect on the host during the run is on *other* test processes: test apps no longer join the registry. A Miniflare instance with the registry off also does not open its `--debug-port` socket (miniflare `index.js:134585-134587, 134623`, cited in `2026-10-20-testing-dev-registry.md`). That leaves fewer port-0 sockets, not more.
  - The registry was empty and `dev` still joins it as before. There is no registry change in `dev`'s path.
- **Out-of-memory kill — ruled out.** There is no OOM line in dmesg, and a SIGKILL leaves no kj stack (F5).
- **A deterministic config or app error — ruled out.** The same stage served with the same sources 8 s earlier, and again 10 s later (test 1, and test 2's restart). It also passed in runs 1–3, in `q3qgbyunuxaz1fw` and in `emckebxm5x3kxd1`.
- **SIGSEGV or another crash signal inside workerd — not ruled out.** kj's handler prints `*** Received signal …` with a main-thread stack that can end in the same frames. dmesg shows no `segfault` line, but kj handles the signal itself, so the kernel may not log it. The cut-off first line is the only evidence that would tell the two apart.
- **A port collision, but on a socket other than `--port` or `--inspector-port`** (e.g. a port-0 socket): the kernel does not hand out a port that is in use, so a port-0 bind cannot fail this way. Only the two explicitly passed ports are exposed.

**What is unknown, and what would settle it:** the first line of workerd's stderr in the failing run. It would be settled by the full `dev` output of a failing occurrence. Two ways to get it: the test keeps it (fix part 2), or a full run under `MINIFLARE_WORKERD_PATH=<scratch>/mig002diag/workerd-wrap.sh`, which stores every workerd's full stderr and arguments (used in runs 2 and 3; adds no network and changes no code). Its `.args` files also give the colliding port.

## Proposed fix
1. **`dev`: close the pick-then-release window** (`packages/framework/src/cli/dev/runtime.ts` `startWorker`, and `src/cli/commands/dev.ts`). If wrangler exits before serving and its output contains `Address already in use`, choose fresh ports with `freePort()` and start wrangler again, at most 3 attempts. Any other early exit is reported as today.
   - Red test (unit, `dev.unit.test.ts` with fake deps): a `startWorker` that fails once with the F2 text, then serves. Today `dev` returns failure; after the fix it serves on the second set of ports, and a non-bind early exit still fails at once.
   - Integration red test: `freePort` injected to return, on the first call, a port held by a listening socket. Today `dev` exits 1; after the fix it serves.
   - The client port (Vite, `strictPort: true`) has the same window. Treat it the same way, with Vite's `EADDRINUSE`.
2. **Test diagnostics (test author):** `tests/compliance/criteria/mig/support/stage.ts` should keep the evidence a failure needs. On a failed deploy, the assertion message should carry the first `*** ` fatal line (or "Runtime stderr:" block) of the output, plus its tail, instead of only `slice(-1500)`. This does not weaken the assertion. It makes link 3 provable if the failure ever recurs.

## Verification plan
- Red-green for part 1 as above. Then `vitest related` on the changed files, `npm run typecheck`, `npm run lint`, the CLI/dev integration suite, and `--only MIG-AC-002` once on local, as plan §1 "Test economy" item 1 allows. The change touches `dev`, so also an offline run (§1 item 4).
- The next phase-end full local compliance run, under the `MINIFLARE_WORKERD_PATH` wrapper if the runner agrees, so that any workerd fatal is kept in full. Pass: MIG-AC-002 passes. If any `dev` start hits a bind collision, the retry shows in its output and the run still passes. If a fatal that is not a bind failure appears, this record goes back to step 1 with that line.

## Review
