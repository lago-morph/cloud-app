# Test-change review: T7, 2026-10-31

Item: T7
Change set: branch `v0.2.0/91-fix-native-copy-fetch`, commits `0e28d03` (red tests and their `vi.mock` in `fake-d1-api.unit.test.ts`) and `e9ff320` (seeds in `native-copy.unit.test.ts`)
Author: fixer subagent for root cause `2026-10-31-native-copy-fetch-failed.md` (plan §7a.1.8 step 5)
Reviewer: independent test-change reviewer session `session_014mWQ6igSCfnb9hLBkhmiVg` (plan §7a.1.9, TS-10), 2026-10-31; wrote neither the change nor the code, changed no files

## Group: refactor-only — once-green tests seed through `prepareAll`; what they check is unchanged
Cites: ai/implementation/root-causes/2026-10-31-native-copy-fetch-failed.md (Review, binding change 2: "Change only the setup; the assertions stay as they are")
Tests:
- `packages/framework/src/provision/cloudflare/d1/native-copy.unit.test.ts` — "the restore file keeps the dump's order, so rows referencing a lossy table stay within the import's ~4 KB foreign-key deferral (A-06)" — setup only: the 61-statement seed batch (formerly lines 163–166) is built with `await prepareAll(db, [{ sql, params }, …])` instead of `[db.prepare(sql).bind(...params), …]`. Same 61 statements, same SQL, same params in the same order, one `db.batch` as before; no assertion, expected value, timeout or tag changed.
- `packages/framework/src/provision/cloudflare/d1/native-copy.unit.test.ts` — the shared helper `seedSafe`, used by every test in the file that calls it (lines 72, 108, 120, 135, 158, 164, 193, 211, 266, 281, 298, 304, 325 in the new file) — setup only: same change. The same 11 statements, each still bound (with no values where there were none: `s(sql)` gives `params: []`, so `bind()` is still called as before), in one `db.batch`.
- `packages/framework/src/provision/cloudflare/d1/fake-d1-api.unit.test.ts` — the existing tests in "fake D1 HTTP API" and "fake D1 HTTP API and the dev registry" — the file now has a `vi.mock` of `../../../targets/local/platform-proxy.js` for the new red tests. When its flag `turns.on` is off (every existing test), the mock returns the real `startPlatformProxy`'s own promise, called synchronously, so these tests run against the same real local D1 and the dev-registry guard still observes the synchronous `WRANGLER_REGISTRY_PATH` read. Their bodies are unchanged.
Verdict: accepted
Reasons:
- `refactor-only` holds: in `native-copy.unit.test.ts` only the seeds changed (`seedSafe` and the A-06 61-statement batch now go through `prepareAll`); SQL, params, order and the single `db.batch` are the same, and no `expect`, timeout, `it(` or tag line was added or removed (checked by grepping the diff); `s(sql)` gives `params: []`, so `bind()` is still called with no values; the yield comes after each item's `prepare` and `bind`, as change 2 of the root-cause review requires.
- Nothing was weakened, skipped or removed: test counts are 15 → 15 in `native-copy.unit.test.ts` and 6 → 8 in `fake-d1-api.unit.test.ts` (the 2 new tests are additions), and neither file has any `.skip`, `.todo`, `.only` or `xit`.
- The `vi.mock` leaves the existing fake tests unchanged: the diff only adds lines to that file; the mocked `startPlatformProxy` is synchronous, calls the real one straight away and returns its own promise while `turns.on` is false, so the dev-registry guard still sees the synchronous `WRANGLER_REGISTRY_PATH` read in `platform-proxy.ts:24–31` against real local D1; `turns.on` is set only in the new describe's `beforeEach` and reset in a `finally`.
- Ran `npm ci`, then vitest on both files with `vitest.unit.config.ts`: 2 files and 29 tests passed. Did not check the 13 `seedSafe` call-site line numbers one by one (minor; does not affect the verdict).

`prepareAll` (exported from `fake-d1-api.ts`) prepares each item, binds it when `params` is given, then awaits one `setImmediate`. The only difference a seed sees is an event-loop turn after each statement, which removes the long synchronous proxy-call runs the record's review measured (183 calls, 4.98 s; seedSafe 40 calls, 3.3 s under load).

The new tests ("fake D1 HTTP API yields to the event loop between synchronous proxy calls", two cases) are additions, not changes to once-green tests, and are not part of this review.
