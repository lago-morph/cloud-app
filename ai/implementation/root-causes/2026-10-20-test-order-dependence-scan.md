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
