# Test-change review: T7, 2026-10-31

Item: T7
Change set: branch `v0.2.0/93a-fix-selection-e2e004` (on `v0.2.0/17-ci-no-duplicates`), commits `f9603a6` (red) and `06ec716` (green); fix of root cause `ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md`
Author: T7 fixer subagent (plan-v0.2.0 §7a.1.8 step 5)
Status: awaiting review

## Group: refactor-only — E2E-004's offline Cloudflare coverage test moves from the unit layer to the integration layer
Cites: ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md (Review, binding fix 3); DEC-0782 (`ai/implementation/decisions/v020-T7.md`)
Tests:
- `tests/compliance/harness/selection.unit.test.ts` — "[E2E-004] the Cloudflare selection covers every criterion expected there > every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)" — removed from this file (with its now-unused imports `listDriverTests`, `expectedCriteria`), replaced by a pointer comment; the file's other five tests are unchanged
- `tests/compliance/coverage/cloudflare-selection.test.ts` — the same describe and test, added: identical title (the `[E2E-004]` tag kept), body and both assertions (`listing.errors` equals `[]`; `uncovered(…)` equals `[]`); imports re-pointed from `./x.js` to `../harness/x.js`; collected by `vitest.integration.config.ts` (new include `tests/compliance/coverage/**/*.test.ts`), which builds the framework in `test:integration`; in COMPL's `integration` directories, and run by CI for criteria-only, e2e-spec, catalogue, harness, tools and shared-input changes (DEC-0783). Its limit changes too: see the `test-was-wrong` group

## Group: test-was-wrong — listing tests' limits are derived from the runners' own limits instead of fixed numbers
Cites: ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md (Evidence 4–5; Review, binding fixes 4 and 5); DEC-0784, DEC-0786
Tests:
- `tests/compliance/coverage/cloudflare-selection.test.ts` (moved, see above) — "every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)" — timeout 180 000 ms → `driverListingLimitMs("cloudflare")` = 2 × 300 000 + 30 000 = 630 000 ms (widened). The 180 s limit bounded nothing (a synchronous body cannot be interrupted) and only failed listings that completed; each runner now has its own 300 s limit with a process-group kill (`ListingTimeoutError`), and the test's limit is the ceiling those limits guarantee. No assertion changed
- `tests/compliance/e2e/E2E-004.spec.ts` — "[E2E-004] coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes" — `test.setTimeout(10 * 60_000)` → `test.setTimeout(driverListingLimitMs(t.target))`: 630 000 ms on Cloudflare (widened from 600 000), 930 000 ms on local (3 runners; widened from 600 000). Same reason; no assertion changed

## Group: behaviour-changed — the CI plan now also runs `tests/compliance/coverage` directly
Cites: DEC-0782, DEC-0783 (`ai/implementation/decisions/v020-T7.md`); plan-v0.2.0 §7a.2.4 "Change classification"; root cause 2026-10-31-selection-e2e004-under-load, binding fix 3 ("no loss of CI coverage")
Tests:
- `tests/ci-classify.unit.test.ts` — "a criteria doc runs COMPL's tagged criteria through the harness and the catalogue unit tests; no e2e ID" — renamed "… the catalogue unit tests and the Cloudflare coverage test; no e2e ID"; expected `p.direct` `[]` → `["tests/compliance/coverage"]` (COMPL is selected by the catalogue doc, and COMPL's integration directories now include the coverage directory)
- `tests/ci-classify.unit.test.ts` — "framework source: criteria IDs of the component and its dependents, e2e IDs of every spec, untagged framework suites run directly" — expected `p.direct` gains `"tests/compliance/coverage"` (KV source selects its dependent COMPL)
- `tests/ci-classify.unit.test.ts` — "an e2e spec change runs only that spec's IDs" — renamed "… runs only that spec's IDs, and the Cloudflare coverage test directly"; expected `direct: []` → `direct: ["tests/compliance/coverage"]` (the new test input for `tests/compliance/e2e/**`). `ids`, `unit`, `alsoE2e` and `chromium` expectations unchanged
