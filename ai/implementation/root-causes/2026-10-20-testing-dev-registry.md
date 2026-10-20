# Root cause: `createTestApp` joins the host-wide Miniflare dev registry under the fixed name `test-app`, so test apps interfere across processes, and a faked `Date` turns that into a 1 ms retry loop or the deletion of other processes' entries

Author: diagnosing subagent (prompt §8 step 1). I did not write the code, the tests, or the record that found the problem. This is a diagnosis only: no code or test was changed. Local runs only, with no Cloudflare calls. I ran no full suites.

Branch `claude/implement-local-cloudflare-diag-registry`, from `origin/claude/implement-local-cloudflare` `37542a3`. Installed: wrangler `4.149.0`, miniflare `5.20261006.1-alpha` (`node_modules/miniflare/package.json`).

Trigger: `2026-10-20-test-order-dependence-scan.md`, Review section ("Required follow-up" 1). That reviewer found the cause. I checked each of its claims again against the installed code and with my own runs. A different reviewer must review this record.

Scratch files, outside the repo: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/registry/`. That folder holds `e0.sh`, `e1.sh`, `e2.mjs`, `e3.mjs`, and the logs `e0.log`, `e1.log`, `e2.log`, `e3.log`. Every experiment used a private registry directory. None of them named the host registry, `~/.config/.wrangler/registry`.

## Symptom
`packages/framework/test/integration/auth/sessions.test.ts` passes (7/7), but on some runs it writes hundreds of lines like this:

```
(node:<pid>) TimeoutOverflowWarning: <n> does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
```

The order scan saw 127–435 per run on seeds 1, 2, 3 and 5, and none on `base` or seed 4. No assertion fails.

## Evidence

### E1: reproduction (one run of the affected file only, load 0.24)
Script: `e1.sh`. Setup:
- `CLOUDFLARE_*` variables unset.
- `WRANGLER_REGISTRY_PATH=<scratch>/reg1`.
- A foreign entry, `reg1/test-app` = `{"instanceId":"foreign-process"}`, was written at 22:09:57.476Z, just before the run.
- `NODE_OPTIONS=--trace-warnings`.

Command: `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth/sessions.test.ts`

Results:
- `Tests 7 passed (7)`, `Duration 9.97s`, with **281** `TimeoutOverflowWarning`s.
- All 281 stacks contain `DevRegistry.registerWorker (node_modules/miniflare/dist/src/index.js:131124)`. The first call comes from `DevRegistry.register` (`:131093`), from `#registerWorkers` (`:134835`), from `#assembleAndUpdateConfigInternal`.
- Delays, counted with `uniq -c`:

  | Delay (ms) | Count | Computed delay = entry mtime + 90 000 − faked "now" |
  |---|---|---|
  | 20167887477 | 121 | faked now 2026-03-01T12:00Z gives 20167887476 |
  | 20081487477 | 158 | faked now 2026-03-02T12:00Z (the future-dated test) gives 20081487476 |
  | 19562787477, 19563387477 | 1 each | 2026-03-08 12:00 ∓ 5 min (the two expiry checks in the expired-session test) |

  Each computed value is 1 ms below the observed one because the mtime's sub-millisecond part is 476.718 ms.
- The planted entry was unchanged after the run (mtime and content).

### E0: control (same file, empty private registry, nothing planted)
Script: `e0.sh`. Results: `Tests 7 passed (7)`, `Duration 8.40s`, **0** warnings. During the run the test app's own `test-app` entry was written to the private registry, and it was removed at dispose. So the warnings need a live foreign entry under the same name. They do not depend on test order.

### E2: `getPlatformProxy` alone, one case per Node process (`e2.mjs`, `e2.log`)
Every case uses a private registry. Each case starts the proxy from a config like the test app's (D1 + R2), uses both bindings, waits 300 ms, and disposes. In the faked cases `Date.now` is replaced.

| Case | Registry before | During the app's life | After dispose | Warnings |
|---|---|---|---|---|
| `baseline`: name `test-app`, real clock | `{}` | `test-app` written | `{}` | 0 |
| `past-planted`: live foreign `test-app`, `Date.now` = 2026-03-01 | `test-app` | unchanged | unchanged | **392 in ~1 s** |
| `past-unique`: same, but a unique Worker name | `test-app` | `test-app` plus the app's own unique entry | `test-app` | 0 |
| `unnamed`: config with no `name` | `{}` | `{}` | `{}` | 0 |
| `future-other`: live foreign `someone-elses-worker`, `Date.now` = 2027-01-01, name `test-app` | `someone-elses-worker` | **`{}`: foreign entry deleted** | `{}` | 0 |
| `future-other-unique`: as above, unique name | `someone-elses-worker` | **`{}`** | `{}` | 0 |
| `future-other-unnamed`: as above, no name | `someone-elses-worker` | **`{}`** | `{}` | 0 |
| `empty-env`: `WRANGLER_REGISTRY_PATH=""`, planted `test-app`, past clock | `test-app` | unchanged | unchanged | 0 |
| `future-other-empty-env`: `WRANGLER_REGISTRY_PATH=""`, future clock | `someone-elses-worker` | unchanged | unchanged | 0 |

The bindings worked in every case (`bindings ok: true`).

### E3: the proposed fix's mechanism, outside the repo (`e3.mjs`, `e3.log`)
Setup:
- `WRANGLER_REGISTRY_PATH` = a private registry, standing in for the host one, with live foreign `test-app` and `someone-elses-worker` entries.
- The proxy is started with `WRANGLER_REGISTRY_PATH=""` only around the synchronous `getPlatformProxy(...)` call. The prior value is restored before the returned promise is awaited.

| Mode | Clock | Env restored after the call | Warnings | Registry unchanged |
|---|---|---|---|---|
| `sync`: `remoteBindings: false` | real / past / future | yes / yes / yes | 0 / 0 / 0 | yes / yes / yes |
| `default`: `remoteBindings` not passed | real / past / future | yes / yes / yes | 0 / **394** / 0 | yes / yes / **no (both entries deleted)** |

So the scoped override works only with `remoteBindings: false`. Without it, wrangler reads the variable after an `await`, by which point the restored value is back (see link 2).

### Code (installed versions)
- `packages/framework/src/testing/test-app.ts:84`: the proxy config's Worker name is always `"test-app"`, and the file is written once per process (`:76-91`).
- `test-app.ts:217`: `getPlatformProxy({ configPath: proxyConfigPath(), persist: false })`.
- `node_modules/wrangler/wrangler-dist/cli.js`:
  - `:376408-376438` is `getPlatformProxy`. It is `readConfig` (synchronous), then `await maybeStartOrUpdateRemoteProxySession2(...)` only `if (config2.configPath && options.remoteBindings !== false)`, then `await getMiniflareOptionsFromConfig(...)`, then `new miniflare.Miniflare(...)`.
  - `:376440-376538` is `getMiniflareOptionsFromConfig`. It contains no `await`, and it returns `{ ..., unsafeDevRegistryPath: getRegistryPath() }` (`:376537`).
  - `:25329-25334` and `:25148-25169`: `getRegistryPath` returns `process.env.WRANGLER_REGISTRY_PATH` whenever the key is present, **including `""`**. It reads the value on every call. Otherwise it returns `<global config>/registry`, which is `~/.config/.wrangler/registry`.
  - `cli.d.ts:3393-3437`: `GetPlatformProxyOptions` is `environment`, `configPath`, `envFiles`, `persist` and `remoteBindings`. **It has no registry option and no way to pass Miniflare worker options** such as `unsafeRegisterWorker`.
  - `:185543-185545`: `maybeStartOrUpdateRemoteProxySession` returns `null` when the config has no remote bindings. So `remoteBindings: false` changes nothing for the test app's D1 + R2 config, which has no `remote: true`.
- `node_modules/miniflare/dist/src/index.js`:
  - `:89439`: the shared option `unsafeDevRegistryPath: z.string().optional()`.
  - `:131052-131054`: `isEnabled()` is `registryPath !== undefined && registryPath !== ""`.
  - `:134777-134779`: `#registerWorkers` returns at once when the registry is disabled. `:134585-134587` and `:134623`: the debug-port socket is opened only when it is enabled.
  - `:89344`, `:132165`, `:134809`: a per-worker `unsafeRegisterWorker`, default `true`. `getPlatformProxy` cannot set it.
  - `:131103-131130` is `registerWorker`:
    1. If the entry's file is stale (`mtime < Date.now() − staleMs`), it is unlinked (`:131111-131115`).
    2. Else, if the entry belongs to another instance, `setTimeout(retry, Math.max(1, mtime + staleMs − Date.now()))` runs, and the retry calls `registerWorker` again (`:131116-131129`).
    3. Otherwise, it writes its own entry and a 10 s heartbeat `utimesSync(..., new Date(), new Date())` (`:131135-131168`).

    `WORKER_STALE_MS` is 90 000 (`:130935`).
  - `:131093` and `:131170-131180`: `register()` always ends with `refresh()`, and `onUpdate` is always set (`:133287-133294`). So `refresh()` runs `getWorkerRegistry(registryPath)` (`:131225-131256`). That reads **every** entry in the directory and unlinks every entry whose mtime is older than `Date.now() − 90 s`, whoever owns it.
  - `:131021-131030` and `:131007-131017`: `unregisterWorkers()` and `dispose()` clear the retry timers and remove only this instance's own entries.
- `~/.config/.wrangler/registry` exists on this host (created 2026-10-19). Earlier runs that did not set `WRANGLER_REGISTRY_PATH` used the host registry.

### Does a test app need the dev registry? No.
- What the registry is for: other local Miniflare/wrangler sessions in other processes. They use it for service bindings, Durable Objects bound by `script_name`, and queue consumers in other Workers, and to advertise this Worker to those sessions (`:134172`, `:134389-134401`, `:134809-134833`). It is also used for shared-storage election (`:89476-89481`, used only with `unsafeEnableSharedStorage`).
- What the test app declares: only `DB` (D1) and `FILES` (R2) (`test-app.ts:83-88`). No service, Durable Object or queue binding. Its config is never served as a Worker (`script: ""`, `cli.js:376521`), so nothing in another process could call it.
- The contract asks for isolation:
  - `docs/contracts/ts/testing.d.ts:93`: "In-process app with **fresh local storage**".
  - `docs/components/core.md` §2 "Testing" (l. 74): "runs app code in the test runner's Node process against fresh local storage … the runner's fake timers also govern framework time checks".
  - `skill/reference/testing.md:16,28`: "fresh, empty storage". App developers are told to use `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime(…)` for expiry tests.
- Nothing in the docs or the framework's source mentions the dev registry (grep for `registry` across `docs/`, `skill/` and `packages/framework/src`).
- Joining a host-wide directory is therefore a hidden dependency that the contract does not allow. And the documented fake-`Date` usage is exactly what makes it misbehave.

### Does local `dev` legitimately use it?
- `dev` runs `wrangler dev` as a child process (`src/cli/dev/runtime.ts:61-66`, args from `src/cli/dev/plan.ts:32-46`). That is wrangler's normal local-development path, and joining the registry is wrangler's default there. It uses the real clock and a per-app name (`<app>-local`, `src/build/build.ts:96`).
- The generated dev config also declares only D1 and R2 (`build.ts:94-107`). So `dev` does not *need* the registry today, but there it is ordinary wrangler behavior, not a defect. **This record does not propose changing it.**
- `dev`'s migration step (`runtime.ts:50-58`) opens a `getPlatformProxy` under the same `<app>-local` name and disposes of it before `startWorker` runs (`src/cli/commands/dev.ts:55,67`). Dispose removes its entry (`:131021-131030`), so it does not collide with the `wrangler dev` child.

## Causal chain
1. **`createTestApp` joins the host registry under a fixed name.** It calls `getPlatformProxy` with a config named `test-app` (`test-app.ts:84,217`). `getPlatformProxy` always passes `unsafeDevRegistryPath: getRegistryPath()` (`cli.js:376537`), and that defaults to `~/.config/.wrangler/registry` (`:25329-25334`). Miniflare then writes `<registry>/test-app` and heartbeats it (`:131135-131168`).
   - Evidence: E0 and the E2 `baseline` row show the entry being written and removed at dispose.
2. **There is no option to opt out.** `GetPlatformProxyOptions` has no registry or worker option (`cli.d.ts:3393-3437`). The only input is the `WRANGLER_REGISTRY_PATH` variable, read in `getMiniflareOptionsFromConfig`. That read is synchronous inside the `getPlatformProxy(...)` call only when `remoteBindings: false` skips the earlier `await` (`cli.js:376414-376424`).
   - Evidence: E3 `sync` versus `default`.
3. **Every test app in every process uses the same entry name.** That covers the 47 test files that call `createTestApp` (framework integration, compliance criteria, `apps/*/tests`), every vitest fork (`vitest.integration.config.ts`: `pool: "forks"`, files in parallel), and every agent worktree on the host. So a second process's test app finds a foreign `test-app` entry that is not stale. It then schedules a retry for up to 90 s later (`:131116-131129`).
   - Evidence: E1 and the E2 `past-planted` row. The retry needs only a live foreign entry, not a faked clock.
4. **A clock faked into the past turns the retry into a 1 ms loop.**
   - The retry delay is `mtime + 90 s − Date.now()`. With `Date` faked about 233 days in the past (`sessions.test.ts:98-100,112-118`), the delay is about 2.0×10¹⁰ ms, which exceeds 2³¹−1.
   - Node clamps it to 1 ms and emits `TimeoutOverflowWarning`. The retry finds the same entry, which is still not stale by the faked clock, and schedules again.
   - Each iteration does `statSync` and a read of the entry, plus `refresh()`, which reads the whole registry. The loop ends when the app is disposed (`:131021-131025`) or when `Date` is real again.
   - Evidence: E1's delays match the formula to the millisecond for each faked "now" in the file. E2 `past-planted` gives 392 warnings in about 1 s.
5. **A clock faked into the future deletes other processes' live entries.** `refresh()` runs on every registration and unlinks every entry that looks stale by `Date.now()` (`:131241-131247`). With `Date` faked ahead, every real entry looks stale, including another project's live `wrangler dev` session (another name) and other test apps.
   - Evidence: E2 `future-other`. `someone-elses-worker` was deleted.
   - No current test fakes a future clock while it creates a test app. The skill (`testing.md:28`) allows it for app developers.
6. **Symptom.** In `sessions.test.ts`, whether warnings appear depends only on whether some other process had a live `test-app` entry from the last 90 s when the two clock tests created their apps (E1 versus E0). That explains why the order scan saw warnings on some seeds and not others. On a shared host, other forks and other agents were running test apps.

## Alternatives ruled out
- **A timer from a previous test's undisposed app (the scan's first hypothesis).** The app is created inside each clock test, after `Date` is faked (`sessions.test.ts:101,116`). `afterEach` disposes the earlier apps (`:27-30`). Every stack trace's first frame is the current app's own `#registerWorkers` (E1). Ruled out.
- **A timer in undici or PGlite.** All 281 stacks contain `DevRegistry.registerWorker` (E1). With an empty registry the count is 0 (E0). Ruled out.
- **Test order.** E1 and E0 run the same file in the same order. The only difference is a planted entry, and the warnings appear only with it. Ruled out as a cause; order matters only through the timing of other processes.
- **The loop affects other `createTestApp` users** (the follow-up the reviewer asked for):
  - *Across processes:* in the past-clock loop, the only writes in the path are skipped. A foreign entry is unlinked only when it is stale, and under a past clock nothing is. Own entries are written only after a successful registration, which never happens while the loop runs. E1 left the planted entry byte-for-byte and mtime unchanged. So the loop does not change other processes' registries. (Link 5 is a separate effect, of a *future* clock.)
  - *In the same process:* the timer belongs to the Miniflare instance created under the faked clock. It is cleared at that app's dispose (`:131021-131025`), and other test apps in the fork have their own `DevRegistry`. The cost is CPU and file-system reads on the shared event loop. At load 0.24 the file's test time was 4.6 s with the loop (E1, 46 % of 9.97 s) against 4.5 s without it (E0, 54 % of 8.40 s), so no measurable effect.
  - I did not run it under load. Plan rule 8 limits repeat runs under load to cases where timing is the claimed cause, and it is not claimed here. Under heavy load the loop's share of CPU could grow. That remains a plausible but unmeasured risk, not part of this chain.
- **Fix by unique Worker name** (reviewer option b). It removes the past-clock loop (E2 `past-unique`). But the app still writes into `~/.config` and opens the debug socket. And a future clock still deletes other processes' entries (E2 `future-other-unique`). Rejected.
- **Fix by omitting `name`.** No entry is registered (E2 `unnamed`), but the registry stays enabled. `refresh()` still runs, and a future clock still deletes foreign entries (E2 `future-other-unnamed`). Rejected.
- **Set `WRANGLER_REGISTRY_PATH=""` for the whole process** (for example at module load). That changes the environment of every later child process. `dev` tests spawn `wrangler dev` with `{ ...process.env }` (`runtime.ts:64`), so it would silently change `dev`'s behavior under test. Rejected.
- **Bypass `getPlatformProxy`** and call `new Miniflare` without `unsafeDevRegistryPath`, or with `unsafeRegisterWorker: false`. It would work, but it means importing Miniflare directly, which DEC-0105 avoids. It needs a version pin (PAR-117), and it is a larger change than the defect needs. Not chosen.
- **Change `sessions.test.ts`** (scan proposals 1 and 2). The test follows `core.md` §2 "Testing" as written. The defect is in the harness. Rejected (agrees with the scan's Review).

## Proposed fix (red-green, `packages/framework/src/testing/test-app.ts` only)
Start the platform proxy with the dev registry turned off. Do it only for the synchronous part of the `getPlatformProxy` call, so no other code sees the changed variable:

```ts
/**
 * A test app never joins Miniflare's host-wide dev registry (~/.config/.wrangler/registry): it has
 * no cross-Worker bindings, and joining it makes test apps in different processes interfere
 * (2026-10-20-testing-dev-registry.md). getPlatformProxy has no option for this; Wrangler reads
 * WRANGLER_REGISTRY_PATH (an empty value disables the registry) synchronously inside the call
 * when remote bindings are off, so the override is restored before anything else runs.
 */
function startPlatformProxy(configPath: string) {
  const had = Object.hasOwn(process.env, "WRANGLER_REGISTRY_PATH");
  const prior = process.env.WRANGLER_REGISTRY_PATH;
  process.env.WRANGLER_REGISTRY_PATH = "";
  try {
    return getPlatformProxy<{ DB: AnyD1Database & D1Like; FILES: FilesStore }>({ configPath, persist: false, remoteBindings: false });
  } finally {
    if (had) process.env.WRANGLER_REGISTRY_PATH = prior;
    else delete process.env.WRANGLER_REGISTRY_PATH;
  }
}
```

Then line 217 becomes `const proxy = await startPlatformProxy(proxyConfigPath());`.
- `remoteBindings: false` is required, not optional (E3 `default`). It changes nothing else for this config (`cli.js:185543-185545`). It also ensures a test app never opens a remote-binding session.
- The name `test-app` can stay, because it is no longer published anywhere.
- The fix depends on a wrangler internal: the variable is read before the first `await`. The red test below guards against that changing. If a wrangler upgrade moves the read, the test fails instead of the defect coming back silently.
- Docs: add one sentence to `core.md` §2 "Testing": "A test app does not join Wrangler's local dev registry, so test apps in different processes never interact." The implementer owns that doc for the item (plan §1, "Docs in sync").

**Same pattern elsewhere (out of this fix's scope; recorded for the orchestrator).** Two other framework callers of `getPlatformProxy` join the registry under fixed names:
- `src/check/migrations/databases.ts:54-67`, `"migration-checker"`, which runs in app developers' `check`/`verify`;
- `src/provision/cloudflare/d1/fake-d1-api.ts:55` (fixture name `"d1-unit-tests"`), which is unit tests only.

In those callers, two processes at once give each other a 90 s retry timer. A faked clock would give the same loop or deletion. No current test fakes `Date` around them. A follow-up item could move `startPlatformProxy` to a shared module and use it in all three places. That is not needed for this symptom.

## Red test (fails today, deterministic, never touches the host registry)
In `packages/framework/src/testing/test-app.unit.test.ts`, add a new `describe` (the 60 s timeout as in the existing block). Setup for each test:
- Create a scratch registry with `mkdtempSync`, and point the variable at it with `vi.stubEnv("WRANGLER_REGISTRY_PATH", dir)` (cleanup: `vi.unstubAllEnvs()`, `vi.useRealTimers()`, `rmSync`). So today's code registers *there* and never in `~/.config`.
- Plant two live foreign entries with fresh real-time mtimes:
  - `test-app` = `{"instanceId":"foreign-process"}`;
  - `someone-elses-worker` = `{"instanceId":"foreign-process"}`.
- Record `readdirSync` plus each file's `mtimeMs` and content.
- Count `TimeoutOverflowWarning`s with `process.on("warning", …)`, and remove the listener in cleanup.

Three cases (one `it.each`, or three `it`s):
1. **Real clock; only `someone-elses-worker` planted** (no foreign `test-app`). `createTestApp(app)`. Make one request (`/api/hello`), wait 50 ms of real time, take a registry snapshot while the app is live, then dispose. Assert the snapshot is identical to the planted one (no entry of the app's own, no changed mtime). *Today:* deterministic failure, because the app writes `<dir>/test-app` (E0, E2 `baseline`). With a foreign `test-app` planted, today's code would only schedule a retry and write nothing, so this case plants none.
2. **Clock faked into the past.** `vi.useFakeTimers({ toFake: ["Date"] })`, `vi.setSystemTime(new Date("2026-03-01T12:00:00Z"))`, then create, request, wait 50 ms of real time (timers are not faked) and dispose. Assert `warnings === 0`, and the registry is unchanged. *Today:* the first `registerWorker` call already schedules an overflowing timeout, so at least one warning is certain. E1 saw 281 and E2 392 in about 1 s.
3. **Clock faked into the future.** As in case 2, with `new Date("2027-01-01T00:00:00Z")`. Assert both planted entries still exist with their mtimes. *Today:* both are deleted (E2 `future-other`).

Why this is deterministic:
- The planted entries' mtimes are real time, written immediately before the test.
- The faked clocks are fixed dates months away. Today's code reads only the scratch directory.
- After the fix, the registry is disabled (`isEnabled()` is false), so no registry file is read or written at all.

Nothing depends on other processes or on the host's `~/.config`.

## Verification plan
1. **Red.** With only the test added, the new tests fail (cases 1 and 3 on the registry assertions, case 2 on the warning count). Run `npx vitest run --config vitest.unit.config.ts packages/framework/src/testing/test-app.unit.test.ts`.
2. **Green.** With the fix, the same file passes, including all the existing `createTestApp` tests.
3. **Re-check of the original symptom** (§8 step 4). Run `sessions.test.ts` alone with `WRANGLER_REGISTRY_PATH` set to a scratch registry and a planted foreign `test-app` entry (`e1.sh`). Expect `Tests 7 passed (7)`, **0** warnings, and the planted entry unchanged.
4. **Plan §1 "Test economy" rule 1.** Run `vitest related packages/framework/src/testing/test-app.ts`, then `npm run typecheck` and `npm run lint`. The fix touches no CLI, `dev` or network code, so it needs no offline run (rule 4).

## Review
