# Root cause — E2E-004 coverage part and the 26 `not-run` IDs (Phase C local run)

Item: C-RUN (record `validation/local/xc3s44jl2dbmqpv.json`, commit `4ff83c4d`). Diagnosed by a diagnosing subagent (prompt §8 step 1) that did not write the code or the tests. Local only; no Cloudflare calls were made. No code or tests were changed.

## Symptom

1. `E2E-004` `failed`: `[E2E-004] coverage part …: Error: applicable on local but no tagged test in this target's suite:` followed by 35 IDs (`raw/playwright.log`, list copied in `validation/local/phase-C-run/SUMMARY.md`). Nine of them, KV-AC-001…005 and SQL-AC-003…006, are `passed` in the same record, so the coverage check and the per-criterion results disagree.
2. 26 IDs are `not-run` with `no test tagged [<ID>] ran on local`: CHECK-AC-005; CLI-AC-003; COMPL-AC-001, -002, -003, -006, -007; DEMO-AC-001…011; E2E-002; LOCAL-AC-001; PROV-AC-007; SKILL-AC-001…005. Some of these IDs have tagged tests in the repository.

These are three separate causes. Cause A explains the nine contradicting IDs. Cause B explains the seven unit-tested IDs (CLI-AC-003, COMPL-AC-001/002/003/006/007, PROV-AC-007). Cause C explains the rest (no tagged test exists).

## Evidence

E1. **Reproduction of the coverage list.** `2026-10-20-E2E-004-coverage-and-not-run.scan.mjs` (next to this record; run `node <it> <repo> validation/local/xc3s44jl2dbmqpv/raw/expected.json [all-ts]`) is a verbatim copy of `TAG_CALL`, `QUOTED_ID`, `BRACKETED` and `scanSourceTags` (`tests/compliance/tools/traceability.ts:33-49`), the `suiteFiles` filter (`tests/compliance/e2e/E2E-004.spec.ts:28-33`) and `listFiles` (`tests/compliance/e2e/support/scan.ts:559-569`). It reads the run's own `raw/expected.json` (`run: true` entries). Its output on this commit is:
   ```
   mode=as-E2E-004 files=84 expected(run)=109 untested=35
   CHECK-AC-005, CLI-AC-003, COMPL-AC-001, … KV-AC-001 … KV-AC-005, LOCAL-AC-001, PROV-AC-007, SKILL-AC-001 … SQL-AC-003 … SQL-AC-006
   ```
   This is the same 35 IDs, in the same order, as the failure message.
E2. **The same tests ran and carried the tags at run time.** `raw/vitest.json` has `tests/compliance/criteria/kv/kv.d1.test.ts` `passed` with the full name `KV shared case set (in-process local D1) [KV-AC-001][KV-AC-004] put, overwrite, get, …`. It also has `kv.pglite.test.ts` (8 tests), `kv.http.test.ts` (6), `sql.d1/pglite/http.test.ts` (12 each), and the framework's `test/integration/kv/kv.{sqlite,postgres}.test.ts` and `sql/sql.{sqlite,postgres}.test.ts`. 166 executed tests carry KV-AC-001…005, SQL-AC-003…006 or GOOGLE-AC-002 tags. `criterionResults` (`tests/compliance/harness/results.ts:332,343`) parses runtime titles with `parseTags`, so those IDs are `passed`.
E3. **Where the tags are written.** The `*.test.ts` files contain no tag for these IDs. For example, `kv.pglite.test.ts` only calls `defineKvSuite(...)` from `./suite.js` after a dynamic `import`. The tests are defined in helper modules: `tests/compliance/criteria/kv/suite.ts`, `tests/compliance/criteria/sql/suite.ts`, `packages/framework/test/integration/kv/kv.suite.ts` and `packages/framework/test/integration/sql/*.suite.ts`. They are written through a local wrapper, `const t = (id, title) => tag([id, "KV-AC-004"], …)` (`kv/suite.ts:24`) or `tag(id, …)` (`sql/suite.ts:39`), called as `it(t("KV-AC-001", …))`.
E4. **Neither the file filter nor the regexes see those tags.** `scan.mjs all-ts` widens the file set to every `.ts` file under the same roots (125 files). It still reports 29 untested, among them KV-AC-001, -002 and -003. `t("KV-AC-001", …)` is not a `tag(` call, and `tag(id, …)` / `tag([id, "KV-AC-004"], …)` has no quoted ID other than KV-AC-004. Only IDs that also appear as a literal `tag("KV-AC-005", …)` (`kv/suite.ts:129`) or in other helper files are found. So the problem is not limited to which files are scanned. A static scan cannot see titles built at run time.
E5. **The project already records this limitation.** DEC-0265 says traceability finds tests "by the runners themselves, so titles built at run time are read the way the runners name them". It adds that the source scan only supplements them. `tests/compliance/tools/report.ts:51-77` does this: a vitest collect-only run over both configs, then `playwright test --list`, then the scan. E2E-004 uses only the scan. DEC-0305 describes the coverage part as "has at least one tagged test in the files this target's run executes", which is a property of runtime titles.
E6. **Which runners the driver runs.** `tests/compliance/harness/driver.ts:200-233` runs `npx vitest run --config vitest.integration.config.ts -t <pattern>` and `npx playwright test --project integration --project e2e --grep <pattern>`. `vitest.integration.config.ts` includes only `packages/framework/test/integration/**/*.test.ts` and `tests/compliance/criteria/**/*.test.ts`. `raw/vitest.json` lists 68 files and none is a `*.unit.test.ts` (checked by a script over `testResults[].name`). `raw/` contains no unit-runner output. The run's command was `npm run compliance -- --target local`, so `--self-test` (the only path that runs `harness/self-test/`, for COMPL-AC-003) was not used.
E7. **Where the seven IDs' tagged tests are.** `grep` over `packages tests apps scripts skill` (excluding `dist`, `node_modules`) finds tests only in unit files:
   - CLI-AC-003: `FW/src/provision/core/{deploy,remove,setup-account}.unit.test.ts`.
   - PROV-AC-007: `FW/src/provision/cloudflare/account.unit.test.ts`, `core/{deploy,setup-account}.unit.test.ts`.
   - COMPL-AC-007: `core/{databases,deploy}.unit.test.ts`.
   - COMPL-AC-001: `tests/compliance/harness/{expected,catalogue}.unit.test.ts`.
   - COMPL-AC-002: `harness/catalogue.unit.test.ts`, `tools/traceability.unit.test.ts`.
   - COMPL-AC-003: `FW/src/evidence/{schema,writer}.unit.test.ts`, `harness/{results,driver}.unit.test.ts`, plus `self-test/sample.selftest.ts`.
   - COMPL-AC-006: `tools/release.unit.test.ts`.

   None is in `packages/framework/test/integration/` or `tests/compliance/criteria|e2e/`. These tests passed in `npm run test:unit` (`03-test-unit.log`: 140 files, 1407 tests passed), but that run is outside the driver and not in the record.
E8. **The documents disagree on the unit layer.**
   - The driver is meant to run only the integration and E2E layers: plan §10.1 ("`npm run compliance` — runs the integration + E2E layers"), DEC-0261 ("Locally the integration layer includes the framework's own integration suites") and compliance.md "Driver" ("runs each test runner once, selecting only the tests tagged with an expected ID").
   - Plan §10.3 says unit tests "do not count as evidence on their own unless the criterion is a unit-level criterion (e.g. GOOGLE-AC-002, COMPL-AC-002/-007)".
   - Some criteria require unit tests in their own text. COMPL-AC-002: "A unit test of the report generator …". COMPL-AC-007: "A unit test of deploy database discovery against a fake target …". PROV-AC-007 and CLI-AC-003 are stated over stubbed responses and injected failures.
   - The C-02 and C-03 exits name unit tests for COMPL-AC-002, -003, -006, -007, PROV-AC-007 and CLI-AC-003.
   - C-EV requires every Local criterion to be `passed` in an evidence record, and COMPL-REQ-006 ("works") reads only records.

   So no record can ever show these criteria passed: the requirement and the driver's design are inconsistent. GOOGLE-AC-002, the other example in §10.3, passed only because it also has integration tests (`FW/test/integration/google/provider.test.ts`, 9 tag hits).
E9. **IDs with no tagged test anywhere.** `grep` over the same trees finds 0 hits for CHECK-AC-005, LOCAL-AC-001 and E2E-002 (DEMO-* and SKILL-* likewise have no tests).
   - `raw/expected.json` has each of them as `run: true`, with no part rule.
   - The plan's C-EV places CHECK-AC-005 (demo part), E2E-002 (local part), SKILL-AC-001…004 and DEMO-AC-* in phases E/F.
   - DEC-0305 says E2E-004 is "expected to fail until every component's tests exist (SKILL, DEMO …)".
   - LOCAL-AC-001 is named for now in plan C-05 ("Needed now for E2E-001, E2E-003 and LOCAL-AC-001"). The E2E-001 test (`tests/compliance/e2e/E2E-001-E2E-003.spec.ts:76`) scaffolds an app, removes credentials, runs `dev` and `verify` under `unshare -rn`, and probes that `api.cloudflare.com` is unreachable (line 90). Its title carries only `[E2E-001]`.
   - SKILL-AC-005 is a C-05 exit item but has no tagged test.
E10. **Side finding that matters for the fix.** `tests/support/tags.unit.test.ts:17-18` contains the test `rejects the malformed ID %j` with `["[KV-AC-001]"]`, so its runtime title contains `[KV-AC-001]` (the traceability report lists it under KV-AC-001). If the driver ran the whole unit layer with the `-t` pattern from `grepPattern` (`reports.ts:102`), that test would be counted as KV-AC-001 evidence.

## Causal chain

**Cause A (test defect: E2E-004 coverage part).** E2E-004 decides "has a tagged test" from a static scan of `*.test|spec.ts` source text (E2E-004.spec.ts:28-46).
- → The shared case sets for KV and SQL (C-T2, B-T2/B-T3) define their tests in helper modules, through wrappers whose ID is a variable (E3).
- → The scan neither reads those modules nor could read the IDs in them (E1, E4).
- → KV-AC-001…005 and SQL-AC-003…006 are reported as having no tagged test.
- → Meanwhile the runners execute those tests with tagged runtime titles, and the driver records them `passed` (E2).
- → The two disagree (symptom 1, nine IDs).

The tagging is not wrong. Plan §10.3 governs the title, and `tag()` produces exactly the bracketed title. The code under test is not wrong either. The check uses a weaker source of truth than DEC-0265 and DEC-0305 call for (E5).

**Cause B (design gap, implemented faithfully by the driver).**
- The criteria and plan items make CLI-AC-003, COMPL-AC-001/002/003/006/007 and PROV-AC-007 unit-tested (E7, E8).
- → The driver spec (DEC-0261, plan §10.1) and `driver.ts:200-233` run only the integration config and the Playwright projects (E6).
- → No unit outcome reaches `criterionResults`.
- → Each of these IDs has no executed tagged test and is `not-run` (`results.ts:362-363`) (symptom 2, seven IDs).
- → E2E-004's scan, which mirrors the driver's file set and excludes `*.unit.test.ts`, also lists them (symptom 1).

Whether the driver *should* collect them: yes for unit-level criteria. Otherwise COMPL-REQ-006 and the C-EV exit check can never hold for criteria whose own text requires a unit test (E8). It must not do so for every ID (E10, and plan §10.3 "do not count as evidence on their own").

**Cause C (missing tests, not a driver defect).**
- CHECK-AC-005, E2E-002, DEMO-AC-*, SKILL-AC-001…005 and LOCAL-AC-001 have no tagged test anywhere (E9).
- → `not-run` (symptom 2), and they appear in the coverage list (symptom 1).
- For the E/F items, this is what DEC-0305 and C-EV anticipate.
- LOCAL-AC-001, and SKILL-AC-005 under C-05, are Phase C items without a tag. LOCAL-AC-001's steps are exercised by the E2E-001 test, which is tagged only `[E2E-001]`.

## Alternatives ruled out

- **Tag format or regex wrong (brackets, ID pattern):** ruled out. The runtime titles are `[KV-AC-001][KV-AC-004] …` and `parseTags` matched them (E2). The same `BRACKETED` regex finds literal tags elsewhere, for example SQL-AC-001 in `schema-identical.test.ts` (E1 output).
- **Describe-level vs test-level titles:** ruled out for the record. `parseVitestJson` joins `ancestorTitles` and the title (`reports.ts:51`), and the KV tags are on `it` titles anyway. This is not the reason the unit IDs are `not-run`: the unit config was not run at all (E6).
- **Suites invisible to Vitest because they are registered after a dynamic `import`:** ruled out for the driver. `raw/vitest.json` contains them (E2). It matters only for `vitest list` (report.ts:54 comment), which the driver does not use.
- **Case sets registered via the reference app:** these are the `kv.http`/`sql.http` tests. They ran and are tagged at run time (E2), so the reference app routing is not involved.
- **Setup failure or a crash in the driver:** ruled out. There is no `driver-error.log` in `raw/`, the record has 109 results, and Vitest reported 521 tests from 68 files.
- **The unit tests fail:** ruled out. `03-test-unit.log` shows 1407 passed. They simply are not part of the run.
- **Cloud-only or not-run rules misapplied:** ruled out. `raw/expected.json` has every one of the 26 IDs `run: true` on local, and the Where columns say Local (compliance.md table, `docs/components/*.md`).

## Proposed fix

A — E2E-004 coverage part (test fix; owner C-T4, with C-02 for the shared helper):
- Compute "tagged tests in this target's suite" from the runners' own collection, as DEC-0265 already does, instead of the source scan alone.
- Factor `listTests` out of `tests/compliance/tools/report.ts` into a module the spec can import, for example `tests/compliance/tools/listing.ts`. It does a vitest collect-only run (`-t <COLLECT_ONLY>`) over the configs the driver uses, plus `playwright test --list` over the driver's projects, with the cloud path restriction `tests/compliance/` (driver.ts:207,230).
- Keep `scanSourceTags` only as a supplement.
- Put the comparison in a pure function, for example `uncovered(expected, listed)` in `tests/compliance/harness/expected.ts`, so it can be unit-tested.
- Files: `tests/compliance/e2e/E2E-004.spec.ts`, `tests/compliance/tools/report.ts`, new `tests/compliance/tools/listing.ts`.
- Update the DEC-0305 wording ("tagged test the run's runners collect").

B — driver collects unit-level criteria (design and code fix; owner C-02; needs a decision draft):
- Add an explicit, document-backed list of unit-level criteria, for example `UNIT_LEVEL` in `tests/compliance/harness/expected.ts`. Candidates from E7/E8: COMPL-AC-002, -006, -007, PROV-AC-007, CLI-AC-003, and GOOGLE-AC-002.
- COMPL-AC-001 and COMPL-AC-003 are stated as properties of a real run ("one command runs the suite against each target", "a run started from a dirty tree records no evidence"). Whether unit tests with fakes suffice for them is a judgment for the decision/owner, not for this record. The alternative is to evidence them from the driver's own run, for example the self-test path.
- On `--target local`, the driver also runs `npx vitest run --config vitest.unit.config.ts -t <grepPattern(unit-level IDs to run)> --reporter=json …` once.
- It folds only outcomes whose tags include a unit-level ID, and only for those IDs. This keeps plan §10.3's rule and excludes E10's `[KV-AC-001]` literal from KV-AC-001.
- It saves `raw/vitest-unit.{log,json}`.
- Files: `tests/compliance/harness/driver.ts`, `expected.ts`, `driver.unit.test.ts`, `docs/components/compliance.md` ("Driver"), the plan §10.1 line, and a new decision superseding DEC-0261's first bullet.
- The E2E-004 coverage (fix A) must use the same set: unit files count only for unit-level IDs.

C — missing tags and tests (tests; owners as noted):
- LOCAL-AC-001: the C-T4 author adds `LOCAL-AC-001` to the E2E-001 test's tag (`E2E-001-E2E-003.spec.ts:76`), after the reviewer confirms that every clause is asserted. Otherwise they write a dedicated test.
- SKILL-AC-005 (C-05 exit): a tagged test is needed.
- CHECK-AC-005 template part: a tagged test is needed now, or a part rule that marks the demo part `not-run` until F (C-02 `PHASE_RULES`).
- DEMO-*, SKILL-AC-001…004 and E2E-002 stay `not-run` until E/F, as DEC-0305 anticipates. They are not defects.

## Verification plan

1. Red-green for A:
   - A unit test of `uncovered()` gives a listed test titled `KV shared case set (x) [KV-AC-001][KV-AC-004] …`, from a file that has no source tag. Against today's scan-based logic it reports KV-AC-001 as uncovered (red). With listing-based input it reports it as covered (green).
   - Re-run `scan.mjs` to confirm today's 35-ID baseline. After the fix, the E2E-004 coverage list must not contain any ID the same run records as `passed`.
2. Red-green for B in `driver.unit.test.ts`:
   - On `--target local`, the fake `run()` must receive a `vitest.unit.config.ts` call (red today).
   - A unit outcome tagged `[COMPL-AC-007]` yields `passed` for COMPL-AC-007.
   - A unit outcome tagged `[KV-AC-001]` alone leaves KV-AC-001 `not-run`.
   - On a cloud target no unit call is made.
3. C-RUN again (`npm run compliance -- --target local` from a clean tree), checked by the runner and evaluator (§7):
   - The record shows the unit-level IDs with results from `raw/vitest-unit.json`.
   - `not-run` "no test tagged" remains only for IDs with no tagged test anywhere: DEMO-*, SKILL-*, E2E-002, CHECK-AC-005, and LOCAL-AC-001 unless tagged.
   - E2E-004's coverage list equals exactly that set.
   - For every ID, the coverage list and the record agree: no ID is both listed and `passed`.

## Review

(To be written by the independent reviewer.)
