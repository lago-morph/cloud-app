# Scan: integration tests that fail alone or in another order (2026-10-20)

Author: diagnosing subagent (prompt §8 step 1). I did not write the tests or the code. This is a diagnosis only: no test or code was changed. Local runs only, with no Cloudflare calls.

Branch `claude/implement-local-cloudflare-diag-order`, from `origin/claude/implement-local-cloudflare` `9673867`.

Trigger: `2026-10-20-SEC-AC-002-depends-on-sec-ac-001.md`, Review point 7. A grep found module-level mutable state in 20 integration and criteria test files. The review asked whether any of that state is written by one tagged test and read by a test with a different tag.

## Result
**No test failed in any run.** That covers 103 shuffled or normal-order file runs and 46 single-tag runs. I found no test that depends on another test's state. The `cli.test.ts` fix (`e043933`) holds: seeds 1 and 2 and each tag alone pass.

Two limits apply to this result:
- The scan is partial. 55 of the 84 files were not run (see "Coverage").
- One test file showed order-related noise without failing (see "Observation").

## Setup
- `npm ci`
- `npm run build -w packages/framework`
- Set the DEC-0277 prerequisite in `apps/reference`: `npm run secrets -- set apiKey --target local --stage local`, with a random 40-character value on stdin.
- Start the reference app's `dev` server myself (`npx prototype-framework dev` in `apps/reference`). This mirrors `startReferenceDev` in `tests/compliance/harness/node-deps.ts`. It served `http://localhost:45723`. I stopped it after the runs.
- Every run had this environment:
  - `COMPLIANCE_TARGET=local`
  - `COMPLIANCE_BASE_URL=http://localhost:45723`
  - `COMPLIANCE_RUN_ID=orderscan`
  - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` removed. This guards against cloud calls.
- **Criteria files** (`tests/compliance/criteria/**`) ran with `-t <pattern>`. The pattern is what the driver uses on local: `grepPattern()` over the IDs that `expectedCriteria(catalogue, "local", "automated")` marks as run, 109 IDs. So only tests that are runnable on local were selected.
- **Framework integration files and `tests/skill/**`** ran unfiltered. A grep found no Cloudflare API use in them. Their `--target cloudflare` builds are offline.
- The host was shared with other sessions (load average 8–11), and I ran one suite at a time.

## Commands
Per file, one at a time:

```
npx vitest run --config vitest.integration.config.ts <file> [--sequence.shuffle --sequence.seed=<n>] [-t <local-ID pattern>]   # seed run
npx vitest run --config vitest.integration.config.ts <file> -t '\[<ID>\]'                                                       # single-tag run
```

- **Seed runs:** `base` means the normal order, with no shuffle.
- **Single-tag runs:** one run for every ID the file carries. For criteria files, only IDs that run on local.
- Scripts and raw output are in scratch, outside the repo: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/order/`. That folder holds `scan.mjs`, `single.mjs`, `results.jsonl`, `narrowed.out`, `single.jsonl`, and the per-run logs and JSON.

## Coverage, and the scope change during the run
1. I started a full scan: all 84 files, `base` plus seeds 1–5. It was running at about 1 minute per run, and some files take far longer: `migration-checker` takes about 7 minutes per run, `cli/verify` about 12. At that rate the scan would have taken about 10 more hours.
2. The orchestrator narrowed the scope twice. Under the owner-approved test-economy rules, I was to finish the file in progress, then run only the 20 files in `stateful.txt` with seeds 1 and 2 plus each tag alone. Runs already done were not repeated.

What ran:

| Set | Files | Runs |
|---|---|---|
| Full scan before narrowing (`base` + seeds 1–5) | 11 files: `auth/*` (7), `build/cloudflare-bundles`, `check/migration-checker`, `check/portability-rules`, `check/rules-not-switchable` | 66 |
| `cli/verify.test.ts` (in progress when narrowed) | 1 | `base`, 1, 2 |
| Stateful set, seeds 1 and 2 | the other 17 `stateful.txt` files | 34 |
| Single-tag `-t` runs | all 20 `stateful.txt` files | 46 (one per ID per file) |

That is 29 files run under shuffle, and all 20 stateful files run under shuffle and with each tag alone.

**Not scanned (55 files):**
- `packages/framework/test/integration/`: `core/package`, `files/app-facing-types`, `files/server-operations`, `kv/kv.postgres`, `kv/kv.sqlite`, `local/dev`, `mig/generate`, `sql/schema-identical`, `sql/sql.postgres`, `sql/sql.sqlite`.
- `tests/skill/`: all 4 files. Only `structure.test.ts` was smoke-checked once, in normal order: 3 passed.
- `tests/compliance/criteria/`: the other 41 files. Many are cloud-only (`prov/*`, `cf/stage-resources`, `mig/deploys`, `secrets/further-stage`). On local, their tests are not selected.

None of the 55 matched the module-level-state grep. A read of the shared-fixture SQL and KV suites (`queries.suite.ts`, `kv.suite.ts`) showed this:
- The `beforeAll` app is used only by read-only tests.
- The writing tests are in a separate `describe` with `beforeEach`.

So this is a lower-risk set. It is still unverified by runs.

## Matrix: file × seed
`p`/`f`/`s` = passed / failed / skipped tests. `—` = not run (see Coverage). Every run exited 0.

| File | base | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| `packages/framework/test/integration/auth/admin-and-users-lists.test.ts` | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 |
| `packages/framework/test/integration/auth/current-user.test.ts` | p=7 f=0 s=0 | p=7 f=0 s=0 | p=7 f=0 s=0 | p=7 f=0 s=0 | p=7 f=0 s=0 | p=7 f=0 s=0 |
| `packages/framework/test/integration/auth/forgery.test.ts` | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 |
| `packages/framework/test/integration/auth/login-flow.test.ts` | p=13 f=0 s=0 | p=13 f=0 s=0 | p=13 f=0 s=0 | p=13 f=0 s=0 | p=13 f=0 s=0 | p=13 f=0 s=0 |
| `packages/framework/test/integration/auth/routes-contract.test.ts` | p=4 f=0 s=0 | p=4 f=0 s=0 | p=4 f=0 s=0 | p=4 f=0 s=0 | p=4 f=0 s=0 | p=4 f=0 s=0 |
| `packages/framework/test/integration/auth/sessions.test.ts` | p=7 f=0 s=0 | p=7 f=0 s=0 † | p=7 f=0 s=0 † | p=7 f=0 s=0 † | p=7 f=0 s=0 | p=7 f=0 s=0 † |
| `packages/framework/test/integration/auth/user-id.test.ts` | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 | p=3 f=0 s=0 |
| `packages/framework/test/integration/build/cloudflare-bundles.test.ts` | p=16 f=0 s=0 | p=16 f=0 s=0 | p=16 f=0 s=0 | p=16 f=0 s=0 | p=16 f=0 s=0 | p=16 f=0 s=0 |
| `packages/framework/test/integration/check/migration-checker.test.ts` | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 | p=6 f=0 s=0 |
| `packages/framework/test/integration/check/portability-rules.test.ts` | p=106 f=0 s=0 | p=106 f=0 s=0 | p=106 f=0 s=0 | p=106 f=0 s=0 | p=106 f=0 s=0 | p=106 f=0 s=0 |
| `packages/framework/test/integration/check/rules-not-switchable.test.ts` | p=2 f=0 s=0 | p=2 f=0 s=0 | p=2 f=0 s=0 | p=2 f=0 s=0 | p=2 f=0 s=0 | p=2 f=0 s=0 |
| `packages/framework/test/integration/cli/verify.test.ts` | p=12 f=0 s=0 | p=12 f=0 s=0 | p=12 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/config/build.test.ts` | — | p=12 f=0 s=0 | p=12 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/config/config.test.ts` | — | p=3 f=0 s=0 | p=3 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/config/dev.test.ts` | — | p=1 f=0 s=0 | p=1 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/core/build.test.ts` | — | p=3 f=0 s=0 | p=3 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/core/runtime.test.ts` | — | p=4 f=0 s=0 | p=4 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/core/types.test.ts` | — | p=4 f=0 s=0 | p=4 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/google/provider.test.ts` | — | p=11 f=0 s=0 | p=11 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/http/dev-paths.test.ts` | — | p=2 f=0 s=0 | p=2 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/http/errors.test.ts` | — | p=11 f=0 s=0 | p=11 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/log/dev-files.test.ts` | — | p=3 f=0 s=0 | p=3 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/log/log.test.ts` | — | p=5 f=0 s=0 | p=5 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/mig/deploy-local.test.ts` | — | p=3 f=0 s=0 | p=3 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/secrets/cli.test.ts` | — | p=4 f=0 s=0 | p=4 f=0 s=0 | — | — | — |
| `packages/framework/test/integration/secrets/secrets.test.ts` | — | p=5 f=0 s=0 | p=5 f=0 s=0 | — | — | — |
| `tests/compliance/criteria/cli/commands.test.ts` | — | p=3 f=0 s=0 | p=3 f=0 s=0 | — | — | — |
| `tests/compliance/criteria/files/private-storage.test.ts` | — | p=0 f=0 s=1 ‡ | p=0 f=0 s=1 ‡ | — | — | — |
| `tests/compliance/criteria/files/server-operations.test.ts` | — | p=6 f=0 s=0 | p=6 f=0 s=0 | — | — | — |

† All tests passed, but stderr was flooded with `TimeoutOverflowWarning` (see "Observation").

‡ Its only test is `[FILES-AC-005]`, which is not run on local, so the local-ID filter skips it. No single-tag run was made for it.

## Single-tag runs (`-t '\[<ID>\]'`, each ID alone per file)
All 46 runs passed with `f=0`. For each file, the IDs run alone (passed tests in brackets):
- `build/cloudflare-bundles`: CF-AC-003 (4), CORE-AC-006 (4), LOCAL-AC-004 (4), PROV-AC-005 (4)
- `check/migration-checker`: CHECK-AC-004 (6)
- `cli/verify`: CHECK-AC-005 (1), CLI-AC-002 (8), CORE-AC-005 (2), CORE-AC-008 (1), LOCAL-AC-003 (1)
- `config/build`: CFG-AC-002 (6), CFG-AC-004 (2), CFG-AC-006 (3)
- `config/config`: CFG-AC-001 (3)
- `config/dev`: CFG-AC-003 (1)
- `core/build`: CORE-AC-007 (2)
- `core/runtime`: CORE-AC-001, -003, -004, -008 (1 each)
- `core/types`: CORE-AC-001 (4)
- `google/provider`: GOOGLE-AC-001 (2), -002 (8), -003 (1)
- `http/dev-paths`: HTTP-AC-001 (2)
- `http/errors`: HTTP-AC-001 (1), -002 (2), -003 (2), -007 (6)
- `log/dev-files`: LOG-AC-002 (1), LOG-AC-003 (2)
- `log/log`: LOG-AC-001 (2), -002 (1), -005 (2)
- `mig/deploy-local`: MIG-AC-002 (1), MIG-AC-003 (2)
- `secrets/cli`: SEC-AC-001, -002, -003, -004 (1 each)
- `secrets/secrets`: SEC-AC-001 (3), SEC-AC-002 (2)
- criteria `cli/commands`: CLI-AC-001 (2), CLI-AC-004 (1)
- criteria `files/server-operations`: FILES-AC-001 (4), FILES-AC-002 (2)

## Why the shared state is benign (code reading)
For each of the 20 files with module-level state, I checked who writes it and who reads it:
- **Fixtures created in `beforeAll`.** `cloudflare-bundles` builds `apps` once. `core/types` creates one `app`. `cli/commands.test.ts` fills `results` and `smokeDevOutputs` in a `describe`-level `beforeAll`. `mig/deploy-local` uses one `dir` per `describe`. Vitest runs a suite's `beforeAll` whenever any of its tests is selected, so a `-t` selection or a shuffle still provisions the state. No tagged test writes state that another reads.
- **Memoised start on first use.** `log/dev-files` and `http/dev-paths` have `server()`/`devStart ??= …`, and `secrets/cli` has `exercised()`. Whichever test runs first provisions the state. Each test then reads only what it produced itself, or what the memo produced. For example, LOG-AC-002 waits for its own request ID's entry.
- **Per-test slot cleared in `afterEach`.** `config/build`, `config/config`, `core/build`, `core/runtime`, `http/errors`, `log/log` and `secrets/secrets` each have `let app`/`apps` that each test sets and `afterEach` disposes.
- **Read-only shared values.** `google/provider` uses `keys`, set in `beforeAll`. `files/server-operations` and `private-storage` use clients that are created lazily, with `prefixes` used only for cleanup.

## Observation: `auth/sessions.test.ts` writes a burst of `TimeoutOverflowWarning` on some runs (not a failure)
**Symptom.** In the full scan:
- Seeds 1, 2, 3 and 5 wrote logs of 17–55 kB.
- `base` and seed 4 wrote about 1.4 kB.
- The extra text is repeated `(node:<pid>) TimeoutOverflowWarning: <n> does not fit into a 32-bit signed integer. Timeout duration was set to 1.` Counts per run: seed 1: 435, seed 2: 140, seed 3: 127, seed 5: 154, `base` and seed 4: 0.
- All 7 tests passed in every run (`Tests 7 passed (7)`). These are not failures.

**Evidence.**
1. **The overflowing delay matches the faked clock.** Seeds 1–3 logged 20,049,889,121–20,049,913,254 ms (232.06 days). Seed 5 logged 20,136,339,380 ms (233.06 days), exactly one day more.
   - Real time was about 2026-10-20 13:23Z.
   - Two tests fake `Date` with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(...)`. The "expired session" test, l. 97–109, starts at `2026-03-01T12:00Z`. The "future-dated" test, l. 111–120, sets `2026-03-01T12:00Z + 1 day`, then returns to `2026-03-01T12:00Z`.
   - `2026-10-20 13:23Z − 2026-03-02 12:00Z` ≈ 232.06 days, and `− 2026-03-01 12:00Z` ≈ 233.06 days.
   - So some real (not faked) `setTimeout` computes its delay as *a deadline in real time* minus `Date.now()` while `Date` is faked about 232 days in the past. The delay exceeds 2³¹−1 ms. Node clamps it to 1 ms, and the timer refires in a tight loop until the test's `afterEach` calls `vi.useRealTimers()` (l. 27–29).
2. **It is timing-dependent, not order-determined.**
   - I reran seed 1 once with the verbose reporter, and seeds 1–3 once each with `NODE_OPTIONS=--trace-warnings`. All reruns: 7 passed, 0 warnings. The host was quieter then.
   - The scan reporter prints tests in declaration order, so it does not show the executed order. The verbose rerun of seed 1 showed: session cookie → logout → stub-provider → tampered → transaction → future-dated → expired. The warnings need a real-time timer to be pending while `Date` is faked, for example from a previous test's not-yet-disposed app or a dependency's keep-alive. Whether that happens depends on timing, so the stack could not be captured.
3. A grep of `packages/framework/src` and `test/integration/auth` found no `setTimeout` whose delay is derived from `Date.now()`. The timer is likely in a dependency (undici, miniflare or PGlite). This is not confirmed.

**Dependency.** This is not a dependence on another test's *state*. The clock is faked for the whole process (`toFake: ["Date"]` replaces the global `Date`), so any real-time timer pending in that worker sees a wrong time. Today no assertion depends on it. But a timer that fires early (clamped to 1 ms) could, under load, make an unrelated timeout or keep-alive in the same file misbehave.

**Proposed fix** (test change, owner: the B-T1 auth test author). Do not weaken any assertion. File: `packages/framework/test/integration/auth/sessions.test.ts`.
1. Before faking the clock in the two clock tests, make sure nothing real-time is pending: await `disposeAll()` at the start of those tests, or run each in its own `describe` with `beforeEach(disposeAll)`.
2. Alternatively, make the faked time close to real time: use `Date.now()` as `start` instead of the fixed `2026-03-01T12:00Z`. The expiry offsets stay unchanged. The overflow then cannot occur.
3. Check that the fix worked by running seeds 1–5 under load and asserting that stderr contains no `TimeoutOverflowWarning`.

This needs an independent review (§8 step 2) before any change. Option 2 also removes the warning without explaining which timer was pending, so a reviewer may want the `--trace-warnings` stack first. It can be captured under load with `NODE_OPTIONS=--trace-warnings` over repeated seeded runs.

## Still open
- The 55 files not scanned (Coverage). The highest-value next step is the shuffle runs for `kv/*`, `sql/*`, `files/server-operations` (framework) and `local/dev`.
- The `sessions.test.ts` observation above, which needs review and possibly a fix.
- No processes were left running. The `dev` server, scan, and wait loops were all stopped.

## Review (independent reviewer, prompt §8 step 2, 2026-10-20)

**Verdict: ACCEPTED-WITH-CHANGES.**
- The scan's main finding is accepted, with its stated limits: no test depends on another test's state in the 29 files scanned.
- The `sessions.test.ts` observation is a **real defect**. Its cause differs from the hypothesis in this record, and the proposed fix 1 would not remove it. The changes required are below.
- The reviewer did not write this record, the tests, or the code. Branch `claude/implement-local-cloudflare-rc-final-review`, from `origin/claude/implement-local-cloudflare` `7f8c5c0`.
- One local reproduction was run, of that one test file only. There were no Cloudflare calls and no full suites.

### Main result (order dependence): accepted
- The tables and the single-tag runs support "no failure in any run", and the record states the coverage gap (55 of 84 files) itself.
- The code reading in "Why the shared state is benign" matches `auth/sessions.test.ts`. Its only module state is `created` in `auth/support.ts:69`, which `newApp` fills (l. 71–75) and `afterEach` → `disposeAll` (`sessions.test.ts:27-30`, `support.ts:77-80`) empties after every test.
- The open coverage (the `kv/*`, `sql/*`, `files/server-operations` and `local/dev` shuffles) stays open, as the record says.

### The `TimeoutOverflowWarning` observation: real defect, cause found
**Where the timer is.** Miniflare's dev registry, `DevRegistry.registerWorker` (`node_modules/miniflare/dist/src/index.js:131103-131130`, miniflare `5.20261006.1-alpha`, wrangler `4.149.0`). The registry and the framework's test app interact as follows:
- `createTestApp` starts the platform proxy with `getPlatformProxy({ configPath: proxyConfigPath(), persist: false })` (`packages/framework/src/testing/test-app.ts:217`). The config has the fixed Worker name `"test-app"` (`test-app.ts:84`).
- `getPlatformProxy` always passes `unsafeDevRegistryPath: getRegistryPath()` (`node_modules/wrangler/wrangler-dist/cli.js:376537`). By default that is the host-wide `~/.config/.wrangler/registry` (env override `WRANGLER_REGISTRY_PATH`, `cli.js:25330`). That directory is shared by every process on the machine, including other vitest forks and other agents' worktrees.
- When `registerWorker` finds a `test-app` entry from another Miniflare instance whose file is not stale, it retries after `Math.max(1, stats.mtime.getTime() + staleMs - Date.now())` ms (`index.js:131118-131128`). `staleMs` is `WORKER_STALE_MS` = 90 s (`index.js:130935`). The staleness test, `mtime < Date.now() - staleMs` (`index.js:131111`), also reads `Date.now()`.
- In the two clock tests, `Date` is faked to March 2026 (`sessions.test.ts:98-100,104,107,112-118`). The file's `mtime` is real time (October), so the delay is about 232 days, which exceeds 2³¹−1 ms. Node clamps it to 1 ms and warns. The retry runs `registerWorker` again, which finds the same entry and schedules again, so it loops every 1 ms.
- Because the faked clock is far in the past, the foreign entry never looks stale, so the loop lasts until `Date` is real again, or until the app is disposed.

**Reproduction (one run of `sessions.test.ts` only, load 0.2).**
- Setup:
  - `WRANGLER_REGISTRY_PATH` was a private scratch directory, so the host registry was untouched.
  - A foreign entry, `test-app` = `{"instanceId":"foreign-process"}`, was written there just before the run.
  - `NODE_OPTIONS=--trace-warnings` was set, and the Cloudflare variables were unset.
- Command: `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth/sessions.test.ts`.
- Result: `Tests 7 passed (7)`, with 241 `TimeoutOverflowWarning`s.
- All 241 stacks have `setTimeout` ← `DevRegistry.registerWorker (index.js:131124)`. The first call comes from `DevRegistry.register` ← `Miniflare #registerWorkers` ← `#assembleAndUpdateConfigInternal`, and the later calls from the retry timer itself.
- The delays identify the faked clock exactly. Each one is the entry's `mtime` (22:03:22.950Z) + 90 s minus the faked "now":

  | Delay (ms) | Count | Faked "now" | Matches |
  |---|---|---|---|
  | 20167492951 | 112 | 2026-03-01 12:00 | `start` / `now` |
  | 20081092951 | 127 | 2026-03-02 12:00 | future-dated issue time |
  | 19562392951 / 19562992951 | 1 each | 2026-03-08 12:00 ± 5 min | the two expiry checks |

- The scan's own numbers fit the same formula: 232.06 and 233.06 days at about 13:23Z real time.

**Corrections to this record's analysis.**
1. The timer is not from "a previous test's not-yet-disposed app". The app is created inside each clock test, after `Date` is faked (`sessions.test.ts:101,116`). `afterEach` has already disposed of the previous apps. So **proposed fix 1 (`disposeAll` before faking) would not remove it.**
2. "Timing-dependent" is more exact as "depends on whether another live Miniflare instance has registered `test-app` in the shared registry within the last 90 s":
   - `vitest.integration.config.ts` runs files in parallel forks;
   - 16 test files call `createTestApp`;
   - other agents ran on the same host.

   That explains warnings in some runs and none in others.
3. The record attributed it to "undici, miniflare or PGlite": it is miniflare. It is triggered by the framework's test harness: the fixed name, plus the host-wide registry that a test app never uses.

**Is it a real defect?** Yes. It is a low-severity defect in the framework's test harness (`src/testing/test-app.ts`), not in `sessions.test.ts`.
- **Why it is a defect:**
  - Every test app joins a host-wide dev registry under one fixed name. So test runs in different processes interfere with each other through files under `~/.config`.
  - Under a faked `Date`, that interference becomes a 1 ms busy loop of synchronous `statSync` and read calls in the test process.
  - Without a faked clock, it still leaves a 90 s registration-retry timer for each app.
  - It is also a hidden cross-process dependency of a "fresh local storage" test app (`test-app.ts:3-4`).
- **Why it is low severity:**
  - No assertion depends on it, and all 7 tests pass. The loop stops at dispose, and the process exited cleanly in 9.9 s.
  - `createTestApp` is a contracted public API (`<package>/testing`), so app developers' tests that fake `Date` hit the same loop.
- **The test itself is correct.** Faking only `Date` is what `core.md` §2 "Testing" prescribes for session expiry (header, `sessions.test.ts:6-7`). Do **not** apply proposed fix 2 (moving `start` to `Date.now()`). It would hide the harness defect by changing a correct test, and it would not remove the cross-process registry dependency.

### Required follow-up (§8 steps 1, 3 and 4)
1. **Record.** A diagnosing subagent writes a root-cause record for "`createTestApp` registers in the host-wide Miniflare dev registry under a fixed name". It may reuse the evidence above.
   - It must still rule out one alternative: that the 1 ms loop affects other `createTestApp` users under load.
   - Because this reviewer found the cause, a *different* reviewer must review that record.
2. **Fix, red-green, in `packages/framework/src/testing/test-app.ts`.** The test app's platform proxy should not take part in the host-wide dev registry. Two ways to do that:
   - give it a private registry, for example a `WRANGLER_REGISTRY_PATH` scoped to the app's temporary directory, if `getPlatformProxy` can be given one without changing the process environment for other code;
   - or give each test app a unique Worker name.

   The record should choose between them with evidence. Changing `process.env` affects other code running in the same process.
3. **Red test.** Put it in `testing/test-app.unit.test.ts`, or in an integration test if it needs workerd:
   - plant a fresh foreign `test-app` entry in a scratch registry (`WRANGLER_REGISTRY_PATH`);
   - fake `Date` to a past date, and create and use a test app;
   - assert that no `TimeoutOverflowWarning` is emitted (`process.on("warning")`) and that no foreign registry entry is touched.
4. **No change to `sessions.test.ts` assertions or its fixed clock.**
5. **Re-check.** Run `sessions.test.ts` alone, with a foreign entry planted as above. Expect 7 passed and 0 warnings.
