# fix-registry — decision drafts

### DEC-PENDING-fix-registry-1 — A test app never joins Wrangler's local dev registry
Origin: ai-proposed · Status: accepted · Affects: DEC-0105, `docs/contracts/ts/testing.d.ts` ("fresh local storage"), core.md §2 "Testing", `packages/framework/src/testing/test-app.ts`, `packages/framework/src/testing/test-app.unit.test.ts`

`createTestApp` starts its platform proxy with Miniflare's host-wide dev registry (`~/.config/.wrangler/registry`, or `WRANGLER_REGISTRY_PATH`) turned off. `getPlatformProxy` has no option for this, so `startPlatformProxy` sets `WRANGLER_REGISTRY_PATH=""` (which Miniflare treats as disabled) around only the synchronous `getPlatformProxy(...)` call, passes `remoteBindings: false` so that Wrangler reads the variable before its first `await`, and restores the previous value, or its absence, in `finally` before anything else runs. The proxy is still `getPlatformProxy` (DEC-0105); `remoteBindings: false` changes nothing for the generated D1 + R2 config, which has no remote bindings. `dev` and the other `getPlatformProxy` callers (`check/migrations/databases.ts`, `provision/cloudflare/d1/fake-d1-api.ts`) are unchanged; moving them to a shared helper is a separate follow-up item.

Reasons: (1) a test app has no cross-Worker bindings, and the contract promises fresh, isolated local storage; joining the registry under the fixed name `test-app` was a hidden host-wide dependency. (2) With a live foreign `test-app` entry, a `Date` faked into the past (the documented expiry-test pattern) turned Miniflare's registration retry into a 1 ms loop of `TimeoutOverflowWarning`s, and a `Date` faked into the future deleted other processes' live entries. (3) A whole-process override would leak into `wrangler dev` children; bypassing `getPlatformProxy` would go against DEC-0105.

Risk and guard: the fix depends on a Wrangler internal (the variable is read before the first `await` when remote bindings are off). The `describe("createTestApp and the dev registry")` tests fail if an upgrade moves that read, and they also assert that the variable is restored after `createTestApp`.

Evidence: `ai/implementation/root-causes/2026-10-20-testing-dev-registry.md` (diagnosis, Review, and "Fix" with the red-green table): before the fix the three tests failed (own entry written; `expected 229 to be +0` warnings; both foreign entries deleted); after it they pass, with the existing `createTestApp` tests.
Item: fix-registry.

## Parameter changes

None.
