# Test-change review: T7, 2026-10-31

Item: T7
Change set: branch `v0.2.0/93a-fix-selection-e2e004` (on `v0.2.0/17-ci-no-duplicates`), commits `f9603a6` (red) and `06ec716` (green); fix of root cause `ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md`
Author: T7 fixer subagent (plan-v0.2.0 §7a.1.8 step 5)
Reviewer: independent test-change reviewer session `session_014mWQ6kQBTdVHW8Szb6YrnG` (fresh remote session, read-only; wrote neither the change nor the code), 2026-10-31, at `ee01ff0`. Its verdicts and reasons below are transcribed from its transcript; the change it required for the `refactor-only` group is applied in the bullet marked "(added after review)".

## Group: refactor-only — E2E-004's offline Cloudflare coverage test moves from the unit layer to the integration layer
Cites: ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md (Review, binding fix 3); DEC-0782 (`ai/implementation/decisions/v020-T7.md`)
Tests:
- `tests/compliance/harness/selection.unit.test.ts` — "[E2E-004] the Cloudflare selection covers every criterion expected there > every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)" — removed from this file (with its now-unused imports `listDriverTests`, `expectedCriteria`), replaced by a pointer comment; the file's other five tests are unchanged
- `tests/compliance/coverage/cloudflare-selection.test.ts` — the same describe and test, added: identical title (the `[E2E-004]` tag kept), body and both assertions (`listing.errors` equals `[]`; `uncovered(…)` equals `[]`); imports re-pointed from `./x.js` to `../harness/x.js`; collected by `vitest.integration.config.ts` (new include `tests/compliance/coverage/**/*.test.ts`), which builds the framework in `test:integration`; in COMPL's `integration` directories, and run by CI for criteria-only, e2e-spec, catalogue, harness, tools and shared-input changes (DEC-0783). Its limit changes too: see the `test-was-wrong` group
- `tests/compliance/coverage/cloudflare-selection.test.ts` — same test — the kept `[E2E-004]` tag now has an effect (added after review): in the unit layer it counted for nothing (E2E-004 is not in UNIT_LEVEL); in the integration layer the local driver selection (integration config, no path filter) runs it as local E2E-004 evidence, and a local listing's `uncovered()` counts it for E2E-004. Kept on purpose (DEC-0782): it checks part of E2E-004's own claim (the Cloudflare coverage part, offline), so it can only make E2E-004's local result stricter; E2E-004.spec.ts still evidences E2E-004 on every target, and the Cloudflare selection never collects this file
Verdict: accepted-with-changes
Reasons:
- Line-by-line comparison: the title (with the `[E2E-004]` tag), the body, both assertions, the env scrub and the `listDriverTests("cloudflare", …)` call are identical; only import paths and the limit changed (the limit is in the `test-was-wrong` group). `selection.unit.test.ts` loses only the two unused imports; its other five tests are untouched.
- Exactly one layer collects it: `vitest list --filesOnly` finds `tests/compliance/coverage` 0 times in the unit config and once in the integration config; `classify.mjs --check-duplicates` exits 0. It is outside `tests/compliance/criteria`, so the Cloudflare driver run never collects it.
- Change required (applied above): the move is not purely a refactor of what the tag does — in the integration layer the local selection runs it as local E2E-004 evidence. DEC-0782 justifies this; the record had to say so, citing DEC-0782.

## Group: test-was-wrong — listing tests' limits are derived from the runners' own limits instead of fixed numbers
Cites: ai/implementation/root-causes/2026-10-31-selection-e2e004-under-load.md (Evidence 4–5; Review, binding fixes 4 and 5); DEC-0784, DEC-0786
Tests:
- `tests/compliance/coverage/cloudflare-selection.test.ts` (moved, see above) — "every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)" — timeout 180 000 ms → `driverListingLimitMs("cloudflare")` = 2 × 300 000 + 30 000 = 630 000 ms (widened). The 180 s limit bounded nothing (a synchronous body cannot be interrupted) and only failed listings that completed; each runner now has its own 300 s limit with a process-group kill (`ListingTimeoutError`), and the test's limit is the ceiling those limits guarantee. No assertion changed
- `tests/compliance/e2e/E2E-004.spec.ts` — "[E2E-004] coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes" — `test.setTimeout(10 * 60_000)` → `test.setTimeout(driverListingLimitMs(t.target))`: 630 000 ms on Cloudflare (widened from 600 000), 930 000 ms on local (3 runners; widened from 600 000). Same reason; no assertion changed
Verdict: accepted
Reasons:
- Both widened limits are derived and bounded, not masks, and not stand-alone raises (binding fix 5): they land with real per-runner bounds (300 s process-group kill, `ListingTimeoutError`). A hung or overslow runner now fails as a named synchronous throw, which the runners report before any test-timer check (record, Review experiment 2), so 630 s and 930 s are ceilings the child limits guarantee (`runnerSelection(target).length × 300 s + 30 s`).
- 300 s per child is sized from the record's worst complete child (254 s); it adds a bound where there was none. E2E-004.spec.ts's 600 s → 630/930 s cannot mask anything either: Playwright cannot preempt a synchronous body, so 600 s bounded nothing.
- No assertion changed. The unit test pins `driverListingLimitMs` to its formula, so the limit cannot drift from the shared constant. The 30 s overhead is an estimate, not a measurement; it is small and errs toward failing, so it masks nothing.

## Group: behaviour-changed — the CI plan now also runs `tests/compliance/coverage` directly
Cites: DEC-0782, DEC-0783 (`ai/implementation/decisions/v020-T7.md`); plan-v0.2.0 §7a.2.4 "Change classification"; root cause 2026-10-31-selection-e2e004-under-load, binding fix 3 ("no loss of CI coverage")
Tests:
- `tests/ci-classify.unit.test.ts` — "a criteria doc runs COMPL's tagged criteria through the harness and the catalogue unit tests; no e2e ID" — renamed "… the catalogue unit tests and the Cloudflare coverage test; no e2e ID"; expected `p.direct` `[]` → `["tests/compliance/coverage"]` (COMPL is selected by the catalogue doc, and COMPL's integration directories now include the coverage directory)
- `tests/ci-classify.unit.test.ts` — "framework source: criteria IDs of the component and its dependents, e2e IDs of every spec, untagged framework suites run directly" — expected `p.direct` gains `"tests/compliance/coverage"` (KV source selects its dependent COMPL)
- `tests/ci-classify.unit.test.ts` — "an e2e spec change runs only that spec's IDs" — renamed "… runs only that spec's IDs, and the Cloudflare coverage test directly"; expected `direct: []` → `direct: ["tests/compliance/coverage"]` (the new test input for `tests/compliance/e2e/**`). `ids`, `unit`, `alsoE2e` and `chromium` expectations unchanged
Verdict: accepted
Reasons:
- The three edited expectations each only add `tests/compliance/coverage` to `direct`, as DEC-0782/0783 imply; `ids`, `unit`, `alsoE2e` and `chromium` are unchanged, and every other `ci-classify` change is an addition.
- Independently re-checked with the CLI: a KV criteria file selects only KV in the harness plus `tests/compliance/coverage` directly; a criteria README runs it directly; `tests/compliance/criteria/compl/support.unit.test.ts` does not run it; a change under `apps/demo` puts E2E-004 in `--only` and the harness runs it through the integration config.
- Missing from the record: none (the new `listing.unit.test.ts` and the new `ci-classify` describe block are new tests, not changes to once-green tests).
