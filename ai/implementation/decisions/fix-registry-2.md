# fix-registry-2 — decision drafts

### DEC-PENDING-fix-registry-2-1 — One registry-free platform-proxy helper for the framework's in-process tools
Origin: ai-proposed · Status: accepted · Affects: DEC-0105, DEC-PENDING-fix-registry-1, core.md §2 "Testing", `packages/framework/src/targets/local/platform-proxy.ts` (new), `packages/framework/src/testing/test-app.ts`, `packages/framework/src/check/migrations/databases.ts`, `packages/framework/src/provision/cloudflare/d1/fake-d1-api.ts`, and their unit tests

The scoped `WRANGLER_REGISTRY_PATH=""` override of DEC-PENDING-fix-registry-1 moves out of `test-app.ts` into one shared helper, `startPlatformProxy<Env>(configPath)` in `src/targets/local/platform-proxy.ts`. It calls `getPlatformProxy({ configPath, persist: false, remoteBindings: false })` with the dev registry turned off only for the synchronous part of the call, and restores the previous value, or its absence, before any `await`. Three callers use it: `createTestApp`, the migration checker's local D1 (`check/migrations/databases.ts`, Worker name `migration-checker`, loaded lazily with `await import(...)` as `wrangler` was before), and the fake D1 HTTP API (`provision/cloudflare/d1/fake-d1-api.ts`, fixture name `d1-unit-tests`). `dev` (`src/cli/dev/*`) is unchanged: there, joining the registry is ordinary `wrangler dev` behaviour.

Placement: the helper is the local target's emulated storage (LOCAL, local.md introduction: "local emulations of storage"), so it lives under `src/targets/local/`. It is an internal Node-only module, not on the `./targets/local` subpath (`public.ts`), and no Worker entry point imports it. `src/testing/` was the other option the plan named, but it is CORE's `./testing` harness, and the migration checker runs in app developers' `check` and `verify`, not in tests. CHECK's and PROV's design docs (§3 "Uses") do not list LOCAL; the integrator may add it to check.md §3 (PROV's only user is test support, `fake-d1-api.ts`).

Reasons: (1) all three callers have no cross-Worker bindings, and each used a fixed Worker name, so two processes at once gave each other a 90 s registration retry, and a faked `Date` would give the 1 ms loop or the deletion of other processes' entries (root cause, Review §4). (2) One copy of a Wrangler-internal dependency, not three. (3) The checker is unchanged in behaviour: `remoteBindings: false` selects nothing for its D1-only config (`cli.js:185543-185545`).

Risk and guard: as in DEC-PENDING-fix-registry-1, the helper depends on Wrangler reading the variable before its first `await`. Each caller has its own guard test, which fails if an upgrade moves the read: `describe("createTestApp and the dev registry")` (`test-app.unit.test.ts`, kept unchanged), `describe("sqlite check database and the dev registry")` (`databases.unit.test.ts`) and `describe("fake D1 HTTP API and the dev registry")` (`fake-d1-api.unit.test.ts`). The two new tests use a scratch registry through `vi.stubEnv` with two live foreign entries, and assert that no entry is written while the instance is live or after it closes, that the foreign entries survive, and that the variable equals the stubbed path after the open resolves. Neither caller runs under fake timers anywhere in the repository (grep for `useFakeTimers` and `setSystemTime`), so they use the real clock.

Evidence: red, before the callers changed: each new test failed with the caller's own entry in the registry (`d1-unit-tests`, then `migration-checker`, each with `instanceId` and `debugPortAddress`). Green, after: the three files pass (31 tests). `~/.config/.wrangler/registry` was empty throughout.
Item: fix-registry-2.

## Parameter changes

None.
