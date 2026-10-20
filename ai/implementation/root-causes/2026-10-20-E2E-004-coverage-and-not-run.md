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

Independent reviewer (prompt §8 step 2). It did not diagnose this failure or write the code or tests. Local only; no Cloudflare calls. No code or tests changed. Checked on `origin/claude/implement-local-cloudflare` with the run's record `validation/local/xc3s44jl2dbmqpv.json` and its `raw/`.

**Verdict: Cause A ACCEPTED. Cause B ACCEPTED, with the conditions below. Cause C REJECTED in part:** the SKILL-AC-005 finding is wrong. The rest of C (LOCAL-AC-001, CHECK-AC-005, the E/F IDs) is ACCEPTED. The SKILL-AC-005 part of E9 and of Cause C must be corrected before that ID is fixed. A and B may go to step 3 now.

### Cause A — E2E-004 coverage from a source scan (ACCEPTED)

- Reproduced. `node …scan.mjs . validation/local/xc3s44jl2dbmqpv/raw/expected.json` prints `files=84 expected(run)=109 untested=35`. That is the same 35 IDs, in the same order, as the failure message in `raw/playwright.json`.
- `E2E-004.spec.ts:28-46` is exactly what the record says. It uses `scanSourceTags` over `*.test|spec.ts` text only. The KV and SQL tags are built at run time (`t(id, …)` / `tag(id, …)` with a variable ID), so no regex over the source can see them (E3, E4).
- The record shows these IDs `passed` from runtime titles (E2). The contradiction is therefore in the check, not in the tags.
- Building coverage from the runners' own listing is consistent with what E2E-004 needs:
  - E2E-004's pass condition is "every applicable criterion passes"; a criterion with no test that runs cannot pass.
  - DEC-0305 defines the in-run part as "a tagged test in the files this target's run executes".
  - DEC-0265 already says tests are found "by the runners themselves".
  - A listing is the correct proxy. A source scan is a weaker one.
- Condition: the listing must use **exactly the driver's selection**. That means the same configs, the same Playwright projects, the cloud path restriction, and (after fix B) the unit config only for unit-level IDs. One shared helper should define the selection for both, so the two cannot drift apart again.

### Cause B — unit-level criteria never reach the record (ACCEPTED, conditions)

- Confirmed: `driver.ts:200-233` runs only `vitest.integration.config.ts` and the Playwright `integration`/`e2e` projects. `vitest.integration.config.ts` includes no `*.unit.test.ts` file.
- No COMPL-REQ text says in so many words that "the driver collects unit tests". It follows from the documents together:
  - COMPL-REQ-003/-006 and C-EV: "works" is read only from evidence records.
  - COMPL-AC-002, COMPL-AC-007 and GOOGLE-AC-002 require a unit test in their own text.
  - Plan §10.3 names unit-level criteria as an exception that does count as evidence.
  - So unless unit outcomes reach a record, those criteria can never be `passed`. The record's reasoning holds.
- An explicit, document-backed ID list run through the unit config is the simplest correct fix:
  - Moving the tests into the integration layer would break the convention that unit tests sit next to the code (plan §10.1).
  - Duplicating them would add a second copy that can drift.
  - Running the whole unit layer under the normal pattern would be wrong. A count over `*.unit.test.ts` titles finds bracketed tags for about 40 IDs, for example 21 × `[KV-AC-001]`, 20 × `[CHECK-AC-001]` and `[X-AC-001]`. Most are fixtures, among them the `["[KV-AC-001]"]` case in `tests/support/tags.unit.test.ts:17`.
  - So folding **must** be restricted to the unit-level list, and only for IDs on it. The `-t` pattern is only a filter, not a guard: a unit test's title can carry several IDs.
- Conditions on the fix:
  1. List membership must be justified in a decision from each criterion's text, not from where its tests happen to live today. The current candidates are COMPL-AC-002, COMPL-AC-007 and GOOGLE-AC-002, whose text names a unit test. PROV-AC-007 and CLI-AC-003 are stated over stubbed or injected failures, which is acceptable if the decision says so.
  2. Keeping COMPL-AC-001 and COMPL-AC-003 off the list until the decision is right. Both are properties of a real run, and §10.3 says unit tests do not count on their own.
  3. compliance.md "Driver" says the driver "runs each test runner once". Two Vitest invocations contradict that, so the text must change in the same decision that supersedes DEC-0261's first bullet. The alternative is a single Vitest invocation using two projects.
  4. The verification items in the record (red on today's driver; `[KV-AC-001]` from a unit file leaves KV-AC-001 `not-run`; no unit call on a cloud target) are sufficient and must all be present.

### Cause C — missing tags and tests (REJECTED in part)

- **SKILL-AC-005: the record is wrong.**
  - E9 says SKILL-* "have no tests" and C says SKILL-AC-005 "has no tagged test". But `skill/scripts/scaffold.unit.test.ts:80` is `it("[SKILL-AC-005] scaffolding into a directory with existing files stops without changing them", …)`.
  - It was added in C-05 (`21bfdeb`), before the run commit `4ff83c4d`.
  - `vitest.unit.config.ts` includes `skill/scripts/**/*.unit.test.ts` (C-INT `5753050`), so `npm run test:unit` runs it.
  - It is invisible for two reasons. The driver never runs the unit config, which is Cause B's mechanism. And `skill/` is outside E2E-004's scan roots.
  - Required fix: SKILL-AC-005's text ("Scaffolding into a directory with existing files stops without changing them") is a behavioural criterion, not a unit-level one. The unit test drives `scaffold()` with a fake `install`, so under §10.3 it does not count on its own.
  - Either add an integration-layer test that runs the real `skill/scripts/scaffold` entry point into a non-empty directory and checks the tree and exit status, tagged `[SKILL-AC-005]`. It needs no network, because the scaffolder stops before installing.
  - Or put SKILL-AC-005 on the unit-level list with a decision saying why. The first option is preferred.
  - Either way, the record must be amended so that SKILL-AC-005 is no longer counted under C.
- **LOCAL-AC-001: ACCEPTED; the E2E-001 test is as strong as the criterion.** The criterion has four clauses, and the test covers each one in `E2E-001-E2E-003.spec.ts:76-136`:
  - "No credentials present": `noCredentials` strips `CLOUDFLARE_|CF_|AWS_|GOOGLE_|…|SST_` and `COMPLIANCE_`, and sets an empty `HOME`.
  - "Networking to cloud providers blocked": every step after scaffolding runs under `unshare -rn`, which allows no network at all and is stronger than the criterion. Line 90 asserts that `api.cloudflare.com` is unreachable.
  - "A freshly scaffolded app runs": `beforeAll` scaffolds a fresh app, and `dev` serves it through the template pages (7 steps, all `ok`).
  - "Passes verify": `verify` exits 0.
  - Scaffolding itself is online (the npm registry is needed for its pinned dependencies). The criterion does not require scaffolding to be offline.
  - So adding `LOCAL-AC-001` to that test's tag (`tag(["E2E-001", "LOCAL-AC-001"], …)`) is correct, not a weakening. No dedicated test is needed.
- **CHECK-AC-005: ACCEPTED.** There is no tagged test. The template part is already exercised by E2E-001's `verify` on a scaffolded template. The fix is a tagged test of the template part plus a C-02 part rule that marks the demo part `not-run` until phase F.
- **DEMO-AC-*, SKILL-AC-001…004, E2E-002: ACCEPTED.** None has a tagged test (grep confirms). They are phase E/F items, which DEC-0305 anticipates, and they are not defects.

### Alternatives

All alternatives the record lists are adequately ruled out by the cited evidence. The extra alternative found here (a tag that exists but sits outside the scanned layers) applies only to SKILL-AC-005, as described above.

### What the fixes must do

1. **A:** E2E-004 coverage comes from the runners' own listing with the driver's exact selection, from one shared helper. No ID may be both "uncovered" and `passed` in the same run.
2. **B:** the driver runs the unit config for a decision-backed unit-level list on local only. It folds only those IDs, keeps the raw output, and updates the compliance.md "Driver" text and DEC-0261.
3. **C:**
   - Tag the E2E-001 test also `[LOCAL-AC-001]`.
   - Add an integration-layer `[SKILL-AC-005]` test that runs the real scaffolder.
   - Add a CHECK-AC-005 template-part test and a demo part rule.
   - Correct E9 and Cause C of this record for SKILL-AC-005.
4. **Re-check:** a C-RUN from a clean tree in which the only "no test tagged" IDs are DEMO-*, SKILL-AC-001…004 and E2E-002, and E2E-004's coverage list equals exactly that set.

## Cause C (revised)

Revised by a diagnosing subagent (prompt §8 step 1) after the Review rejected Cause C in part. Like the original, it did not write the code or the tests. Local only; no Cloudflare calls. No code or tests changed. The original E9 and Cause C above are kept for history. Where they disagree with this section, this section replaces them. Checked on `origin/claude/implement-local-cloudflare` at `7416a75`, against the run record `validation/local/xc3s44jl2dbmqpv.json` and its `raw/`.

### E9 (corrected)

`grep -rnE <ID>` over `packages tests apps scripts skill` (`*.ts`, `*.mjs`; excluding `node_modules` and `dist`) gives these results.

| ID | Hits | Where |
|---|---|---|
| SKILL-AC-001…004 | 0 | — |
| **SKILL-AC-005** | **1** | `skill/scripts/scaffold.unit.test.ts:80`, `it("[SKILL-AC-005] scaffolding into a directory with existing files stops without changing them", …)` |
| LOCAL-AC-001 | 0 | — |
| CHECK-AC-005 | 0 | — |
| E2E-002 | 0 | — |
| DEMO-AC-001…011 | 1 | `tests/compliance/harness/catalogue.unit.test.ts:87` only. It checks that `DEMO-AC-011` is in the catalogue and is not a test of the criterion. |

The original E9 was wrong about SKILL-AC-005: a tagged test exists. The run's own traceability report confirms this. `validation/local/phase-C-run/traceability.md:141` lists that test under SKILL-AC-005, next to the record result `not-run: no test tagged [SKILL-AC-005] ran on local`.

The test is invisible to the record and to E2E-004 for two reasons:

- **The driver never runs the unit config.** `vitest.unit.config.ts:6` includes `skill/scripts/**/*.unit.test.ts`, so `npm run test:unit` runs it. The driver runs only `vitest.integration.config.ts` and the Playwright projects (E6). This is Cause B's mechanism.
- **The file is outside E2E-004's scan.** `suiteFiles` (`E2E-004.spec.ts:29-33`) scans only `tests/compliance` and `packages/framework/test/integration`, and it drops `*.unit.test.ts` files.

Every `run: true` entry for these IDs in `raw/expected.json` has `parts: [""]` and `notRunParts: []`. There is no part rule for any of them, CHECK-AC-005 included.

### Per ID

#### SKILL-AC-005 — "Scaffolding into a directory with existing files stops without changing them." (skill.md:101, Where: Local; C-05 exit)

**Existing test:** `scaffold.unit.test.ts:80`. It imports `scaffold()` from `scaffold.mjs` and calls it with these fakes:

- a fixture template under `tmpdir()`, not `apps/template`;
- a fake tarball file;
- `version: "0.1.0"`;
- a fake `install` that only records its argument.

The target holds `src/app.ts` and `notes.txt`. The test asserts that the call rejects with `/not empty/`, that the target tree is byte-identical afterwards, and that `install` was not called.

**Is it as strong as the criterion?** No.

- The criterion is about the user-facing action, scaffolding with the real `skill/scripts/scaffold` command. The test does not run that command, and it uses neither the real template nor the real pack step.
- Under the real command, more happens before or around `scaffold()`:
  - it parses `argv` (`[--force]`);
  - it runs `npm pack` in `packages/framework` (with `prepack`);
  - it checks the version against the real template pin;
  - it turns the rejection into `exit 1`.
- None of that is exercised. A regression in any of those steps would not be caught. Examples: writing into the target before the check, or treating an unknown flag as `--force`.
- Plan §10.3 says unit tests do not count as evidence on their own unless the criterion is a unit-level one. The criterion's text names no unit test or fake, so it is not unit-level. I agree with the Review.

**Missing:** a test in the layer the driver runs, tagged `[SKILL-AC-005]`, that runs the real entry point.

**Proposed fix (test author; owner C-T4 or the C-05 test author):**

- Add `tests/compliance/criteria/skill/scaffold.test.ts`. `vitest.integration.config.ts` already includes `tests/compliance/criteria/**/*.test.ts`, so the driver and E2E-004 pick it up with no other change.
- Steps:
  1. Make a temporary target containing a clashing file (`src/app.ts` with `mine`) and a non-clashing file (`notes.txt`).
  2. Snapshot the target: paths, contents and mtimes.
  3. Run `node skill/scripts/scaffold <target>` with no `--force`, as E2E-001 already does in its `beforeAll`.
  4. Assert exit status 1.
  5. Assert that stderr names the target and says nothing was changed.
  6. Assert that the snapshot is unchanged, with no `vendor/`, `package.json` or `node_modules`.
- It needs no network: `npm pack` builds locally, and the refusal comes before `npm install`. It can run under `unshare -rn` to prove that.
- Keep the unit test. It remains useful, but it is not the criterion's evidence.
- Do not put SKILL-AC-005 on Cause B's unit-level list.

#### LOCAL-AC-001 — "With networking to cloud providers blocked and no credentials present, a freshly scaffolded app runs and passes the verification command." (local.md:60, Where: Local)

**Existing test:** the `E2E-001` test, `tests/compliance/e2e/E2E-001-E2E-003.spec.ts:76-136`, tagged only `tag("E2E-001", …)`. It covers each clause of the criterion:

| Clause | Where the test covers it |
|---|---|
| No credentials present | `noCredentials()` (lines 38-48) drops `CLOUDFLARE_`, `CF_`, `AWS_`, `GOOGLE_`, `GCLOUD`, `CLOUDSDK_`, `AZURE_`, `SST_` and `COMPLIANCE_`. It also sets an empty `HOME` for every later step. |
| Networking blocked | Every step after scaffolding runs in `offline()`, which is `unshare -rn` plus `scripts/offline.sh`. That allows no network at all, which is stronger than "cloud providers blocked". Lines 90-91 assert that `fetch('https://api.cloudflare.com/…')` fails. |
| Freshly scaffolded | `beforeAll` (line 65) runs the real `skill/scripts/scaffold` into a new temp directory. |
| Runs | `dev` serves the template pages, and lines 116-122 require exactly 7 steps, all `ok`, with status 0. |
| Passes verify | `verify()` exits 0 (lines 133-135). |

Scaffolding itself is online, because it needs the npm registry. The criterion does not require scaffolding to be offline: its conditions apply to the steps that run the app and verify it. So the test is as strong as the criterion, and stronger on network blocking. Nothing is missing except the tag.

**Proposed fix:** change line 76 to `tag(["E2E-001", "LOCAL-AC-001"], "…")`. `tag()` accepts an array, as `kv/suite.ts:24` shows. No new test is needed.

#### CHECK-AC-005 — "The template and demo pass all rules." (check.md:100, Where: Local; CHECK-REQ-005: "the template and demo code MUST pass")

**Template part, existing test:** `packages/framework/test/integration/cli/verify.test.ts:58-67`, tagged `tag("CLI-AC-002", "verify passes on the template")`.

- It copies `apps/template` (`FixtureApp.copyOf`), runs `verify` and asserts exit 0. This file is in the driver's integration config, and it ran.
- `verify` applies all CHECK rules, as check.md §2 describes:
  - the portability rules from the shipped configuration only (`runPortabilityRules`, check.md:67);
  - the migration checker;
  - the zod version check (check.md:61);
  - the check that the app lint configuration does not weaken the rules (check.md:86).
- E2E-001's `verify` on a scaffolded copy is a second instance of the same check.
- So the template part has a test as strong as the criterion, but the test carries only `[CLI-AC-002]`.
- B-EV (`ai/implementation/evaluations/B.md:119`) judged the template part `passed` from B-RUN exit-check logs, which are outside the driver. That is why C-RUN has no record of it.

**Demo part, existing test:** none, and none is possible yet. `apps/demo/` contains only `package.json`. Plan C-EV assigns "CHECK-AC-005 (demo part)" to F-EV.

**Missing:**

1. The `[CHECK-AC-005]` tag on the template test.
2. A part rule, so that the record says "template part passed; demo part not-run until F" instead of judging the whole criterion. With the tag but no rule, the whole criterion would be recorded `passed` from the template alone. That would overstate the evidence.

**Proposed fix:**

- **Test author:** change the template test's tag to `tag(["CLI-AC-002", "CHECK-AC-005"], "verify passes on the template")`. Running `verify` on the template checks exactly the template part.
- **C-02:** add `{ id: "CHECK-AC-005", targets: ["local"], mode: "automated", part: "demo part", detail: "demo built in phase F (plan C-EV)" }` to `PHASE_RULES` (`tests/compliance/harness/expected.ts:38`).
- The F-phase demo test then adds its own `[CHECK-AC-005]` test, which runs `verify` on `apps/demo`, and removes the rule.
- The C-EV evaluator decides whether the tagged template test should be named in the evidence record's part. That is a judgment for §7, not for this record.

#### E2E-002 — "One source, both clouds" (e2e-scenarios.md:23, Where: Local, cloud)

**Existing test:** none.

**As strong as the criterion?** There is no test to compare.

**Missing:** the whole scenario. It needs the demo, whose smoke test (DEMO-REQ-010) does not exist yet.

**Proposed fix:** none in phase C.

- Plan C-EV assigns "E2E-002 (local part)" to F, and F-RUN runs the smoke on local and Cloudflare. Plan §8.2 marks the AWS stage `not-run`.
- `not-run` ("no test tagged") is the expected outcome now. C-EV does not judge it.
- The F test author writes it.

#### SKILL-AC-001…004 (skill.md:97-100, Where: Local)

**Existing tests:** none.

**As strong as the criterion?** There is no test to compare.

**Missing:** the tests, and also what they check: `skill/` holds only `scripts/`. The router, the references and the examples are written in phase E.

**Proposed fix:** none in phase C. Plan C-EV assigns them to E-EV, and the E test authors write them. `not-run` is expected now and is not a defect.

#### DEMO-AC-001…011 (demo-spec.md:76-86, Where: Local, or Local and cloud)

**Existing tests:** none. The only hit is the catalogue unit test, which checks that the ID is in the catalogue and is not a test of the criterion.

**As strong as the criterion?** There is no test to compare.

**Missing:** the demo itself (`apps/demo/` holds only `package.json`), its smoke test, and the local-only tests named at demo-spec.md:72. Those cover DEMO-AC-006, DEMO-AC-011, the failure clause of DEMO-AC-003 and the expiry clause of DEMO-AC-007.

**Proposed fix:** none in phase C. These belong to phase F. `not-run` is expected now and is not a defect.

### Causal chain (revised)

- **Two IDs are untagged, though they have tests as strong as the criterion:** LOCAL-AC-001 (E2E-001's test) and the template part of CHECK-AC-005 (`verify.test.ts:58`). Their tests run in the driver, but under other IDs' tags. So `criterionResults` finds no title containing the ID → `not-run` (symptom 2). The source scan finds no literal tag either → they appear in the coverage list (symptom 1). Also, the CHECK-AC-005 demo part has no part rule (`raw/expected.json`: `notRunParts: []`).
- **SKILL-AC-005 has a tagged test that is too weak:** a unit test with fakes, in a layer the driver does not run and E2E-004 does not scan. → `not-run` and listed. Cause B does not fix it: B folds only criteria that are unit-level by their own text, and SKILL-AC-005 is not one.
- **Not built yet:** E2E-002, SKILL-AC-001…004 and DEMO-AC-001…011 have no test because their components are built in phases E and F. → `not-run`, as plan C-EV and DEC-0305 anticipate. These are not defects.

### Fix summary for C

1. Tag the E2E-001 test also `[LOCAL-AC-001]`.
2. Add a `[SKILL-AC-005]` integration-layer test that runs the real `skill/scripts/scaffold` into a non-empty directory and checks the exit status, the message and an unchanged tree.
3. Tag `verify passes on the template` also `[CHECK-AC-005]`, and add the C-02 `PHASE_RULES` part rule for the demo part.
4. Nothing for E2E-002, SKILL-AC-001…004 or DEMO-AC-*.

### Verification for C

- **Red, after fixes A and B and before C:** a C-RUN shows LOCAL-AC-001, SKILL-AC-005 and CHECK-AC-005 as `not-run: no test tagged`, and they appear in E2E-004's coverage list.
- **Green, after C:** a C-RUN from a clean tree shows all of the following:
  - LOCAL-AC-001 `passed`, from the E2E-001 test.
  - SKILL-AC-005 `passed`, from the new integration test.
  - CHECK-AC-005 `passed` for the template part, with the demo part `not-run` and detail "demo built in phase F".
  - The only remaining "no test tagged" IDs are E2E-002, SKILL-AC-001…004 and DEMO-AC-001…011, and E2E-004's coverage list equals exactly that set.
- **Check that the new SKILL-AC-005 test is not vacuous:** remove the non-empty check in `scaffold.mjs` temporarily. The test must fail on the changed tree or on the exit status. Then restore the check.
- The evaluator (§7) confirms that each new tag's test asserts every clause of the criterion it now names.

## Review (revised C)

Independent reviewer (prompt §8 step 2). It did not diagnose this failure, write the revision, or write the code or tests. Local only; no Cloudflare calls. No code or tests changed. Checked on `origin/claude/implement-local-cloudflare` at `0f11f1e`, against `docs/components/{skill,local,check}.md`, `ai/implementation/plan.md` and the run record `validation/local/xc3s44jl2dbmqpv` with its `raw/`.

**Verdict: Cause C (revised) ACCEPTED, with one condition on the SKILL-AC-005 test (below).** The corrected E9 fixes the defect the earlier Review found. Each per-ID finding matches the code and the criterion text. Fix C may go to step 3.

### SKILL-AC-005 — ACCEPTED, with a condition

- E9 is now correct. `skill/scripts/scaffold.unit.test.ts:80` carries the tag. It calls `scaffold()` with a fixture template, a fake tarball and a fake `install`. `vitest.integration.config.ts` includes neither `skill/**` nor any `*.unit.test.ts` file.
- The record's reasons why that test is weaker than the criterion hold against `skill/scripts/scaffold`:
  - argv parsing: an unknown flag gives exit 2; `--force` is detected with `args.includes`;
  - `npm pack` with `prepack` (`npm run build`);
  - the version is read from the real tarball and compared with the real template pin;
  - a rejection becomes `exit 1` and is printed as `scaffold: …` on stderr.
  
  None of these runs in the unit test. skill.md:101 names no unit test or fake, so under plan §10.3 the unit test is not evidence. Keeping SKILL-AC-005 off Cause B's list is right.
- The proposed test is placed correctly. `tests/compliance/criteria/**/*.test.ts` is in `vitest.integration.config.ts`, so the driver and the listing from fix A both see it. Plan E-T1 names `tests/skill/`, but no runner config includes that directory, and C-05's exit (plan.md:251) needs SKILL-AC-005 now. The placement in the record is the one that works.
- For the case it builds, the proposed test is as strong as the criterion:
  - It asserts exit status 1.
  - It asserts a stderr message that names the target and says nothing was changed. This matters because `scaffold.mjs` checks the version pin *before* emptiness, and a pin mismatch also exits 1. Only the message tells the two apart.
  - It asserts that paths, contents and mtimes are unchanged.
  - It asserts that no `vendor/`, `package.json` or `node_modules` was created.
- **Condition: the fixture is not enough for the criterion.** The criterion says a directory *with existing files* stops unchanged. The proposed fixture always includes a file that clashes with the template (`src/app.ts`). So a regression that refuses only on clashes, and still copies the template beside the user's files, would refuse on this fixture and pass. The test must also run on a target that holds only files the template does not have, for example `notes.txt` plus a dotfile such as `.keep`, and assert the same four things. The vacuity check should then remove the non-empty check, as the record says, and also try a clash-only variant of it.
- The claim that the test "can run under `unshare -rn`" is plausible: `npm pack` of a local folder plus `tsc` needs no registry, and the refusal happens before `npm install`. It is not demonstrated in the record, though. Treat it as optional until the fix's red run shows it.

### LOCAL-AC-001 — ACCEPTED (clause by clause)

local.md:60 against `E2E-001-E2E-003.spec.ts`:

- **"No credentials present":** `noCredentials()` (lines 34-45) drops the cloud and `COMPLIANCE_` prefixes. `offline()` passes it with an empty `offlineHome` as `HOME` (line 53). This applies to every step after scaffolding.
- **"Networking to cloud providers blocked":** `offline()` is `unshare -rn sh scripts/offline.sh …`. Lines 90-91 assert that `fetch('https://api.cloudflare.com/client/v4/')` fails inside the namespace. This is stronger than the criterion.
- **"Freshly scaffolded":** `beforeAll` (lines 59-67) runs the real `skill/scripts/scaffold` into a new `mkdtemp` directory and requires status 0.
- **"Runs":** `secrets set` and the template-pages script run offline. Lines 116-119 require 7 steps, all `ok`, status 0, plus the request-scoped log entry.
- **"Passes the verification command":** `verify()` runs offline and must exit 0 (lines 132-134).
- Scaffolding uses the network, but the criterion's conditions are on running and verifying the app. LOCAL-REQ-001 ("running, testing, and verifying … MUST need no … network access to cloud services") reads the same way. `tag()` (`tests/support/tags.ts:18`) accepts an array, and this file imports it through `../harness/index.js`. So the proposed fix, a tag on line 76, is sufficient. The run's `raw/playwright.json` shows the `[E2E-001]` test passing.

### CHECK-AC-005 template part — ACCEPTED (clause by clause); demo part not-run until F — ACCEPTED

check.md:100 "The template and demo pass all rules" (CHECK-REQ-005), template part, against `packages/framework/test/integration/cli/verify.test.ts:58-67`:

- **"The template":** `FixtureApp.copyOf(apps/template)`.
- **"All rules":** `verifyCommand` (`src/cli/commands/verify.ts`) runs each of these, and any diagnostic fails it:
  - `portabilityRules` = `check.runPortabilityRules` (`cli/wiring.ts:54`). That is `lintAppFiles` with the shipped configuration only, plus `checkAppLintConfig`, the CHECK-REQ-006 weakening check (`check/engine.ts:81-82`).
  - `migrationChecker` = `runMigrationChecker`.
  - The zod-version check.
  - Type checking.
- **"Pass":** `expect(result.code).toBe(0)`. `raw/vitest.json` records `[CLI-AC-002] verify passes on the template` `passed` in this run.
- So `tag(["CLI-AC-002", "CHECK-AC-005"], …)` (same `tag()` signature) is correct and does not weaken anything.
- The demo part: `apps/demo/` is only a `package.json`, and plan.md:265/380 assigns "CHECK-AC-005 (demo part)" to F-EV.
- The proposed rule `{ id: "CHECK-AC-005", targets: ["local"], mode: "automated", part: "demo part", … }` fits `expectedCriteria` (`harness/expected.ts:62-71`). It gives `run: true, parts: [""]` and a `not-run` result `demo part: …` (`results.ts:88`). `checkRules` accepts it, because CHECK-AC-005 applies to local in the automated tier. AUTH-AC-009's rule already sets the precedent.
- Note for §7: the passed result will carry part `""` (whole), not "template part". The record correctly leaves that judgment to the evaluator. The evaluator must not read that result as covering the demo.

### E2E-002, SKILL-AC-001…004, DEMO-AC-* — ACCEPTED

- plan.md:265 (C-EV) explicitly defers SKILL-AC-001…004, DEMO-AC-*, CHECK-AC-005 (demo part) and E2E-002 (local part) to E-EV and F-EV. plan.md:345/355/357/374/380 assign their tests and judgment to E and F.
- `skill/` holds only `scripts/`, and `apps/demo/` holds only `package.json`.
- `not-run` ("no test tagged") is the expected state, not a defect.

### Causal chain and verification

- Each link is backed by evidence:
  - an untagged test that runs gives no title match, so the ID is `not-run` and is listed;
  - a tagged unit test is outside both the driver's selection and the scan;
  - components not yet built have no tests.
- No alternative remains open.
- The verification plan is sufficient once it includes the condition above: a SKILL-AC-005 run on a target with only non-clashing files.

## Fix (C)

Test author (prompt §8 step 3), who did not write the scaffolder, the diagnosis or the reviews. Local only; no Cloudflare calls. Branch `claude/implement-local-cloudflare-fix-c3c` from `origin/claude/implement-local-cloudflare`. Only test files changed; no assertion changed in an existing test; `PHASE_RULES` / `expected.ts` not touched (another fix edits driver files).

### Changes

1. **New `tests/compliance/criteria/skill/scaffold.test.ts`, two `[SKILL-AC-005]` tests** (local target only, `isLocal()`; included by `vitest.integration.config.ts`). Each runs the real `node skill/scripts/scaffold <target>` (no `--force`) and asserts: exit status 1; stderr contains `scaffold: target directory <target> is not empty` and `nothing was changed` (which tells the refusal apart from a version-pin mismatch, which also exits 1); no `Scaffolded` on stdout; a snapshot of every path, kind, content and mtime is unchanged; no `vendor/`, `package.json` or `node_modules` was created. Fixtures (the Review's condition):
   - **clash:** `src/app.ts` (`mine`, also in the template) and `notes.txt`;
   - **no clash:** only `notes.txt`, `.keep` and `mine/plan.md`, none of which the template has.
   The unit test in `skill/scripts/scaffold.unit.test.ts` is kept and unchanged.
2. **`tests/compliance/e2e/E2E-001-E2E-003.spec.ts:76`:** `tag("E2E-001", …)` → `tag(["E2E-001", "LOCAL-AC-001"], …)`.
3. **`packages/framework/test/integration/cli/verify.test.ts:59`:** `tag("CLI-AC-002", …)` → `tag(["CLI-AC-002", "CHECK-AC-005"], …)`.

### Red / green (the new SKILL-AC-005 tests)

Temporary local mutations of `skill/scripts/scaffold.mjs`, never committed; the file was restored from a copy and `git status` was clean afterwards.

| `scaffold.mjs` variant | clash fixture | no-clash fixture |
|---|---|---|
| refuses only when a top-level target entry also exists in the template (clash-only) | passed | **failed**: `exit 0`, expected 1 (the template was copied beside the user's files) |
| non-empty check removed (`if (false)`) | **failed**: `exit 0` | **failed**: `exit 0` |
| real (committed) | passed | passed |

So the clash fixture alone (the original proposal and the unit test's fixture) would not catch the clash-only regression; the no-clash fixture does.

### Open for C-02 (driver files; not done here)

CHECK-AC-005 now carries the template test's tag, so without a part rule the whole criterion is recorded `passed` from the template alone. C-02 must add `{ id: "CHECK-AC-005", targets: ["local"], mode: "automated", part: "demo part", detail: "demo built in phase F (plan C-EV)" }` to `PHASE_RULES` (`tests/compliance/harness/expected.ts`), as the revised Cause C proposes. Until then the evaluator must not read the CHECK-AC-005 result as covering the demo.

### Results

- `npm run verify`: exit 0, 1407 unit tests passed. Two earlier attempts failed on unrelated unit tests (PGlite/KV) that timed out at 5 s while the shared machine had a load average of about 20 on 4 cores. The failing tests differed between the two runs, and none of them are files this fix touches.
- `npm run compliance -- --target local --only SKILL-AC-005,LOCAL-AC-001,CHECK-AC-005,E2E-001 --out <scratch>` from a clean tree at `c1c5ba9`: exit 0, "105 not-run, 4 passed". SKILL-AC-005 passed (both tests, about 33 s and 36 s), LOCAL-AC-001 and E2E-001 passed (the E2E-001 test, 4.6 min), and CHECK-AC-005 passed. CHECK-AC-005 is recorded as a whole criterion with part `""`, because the C-02 demo-part rule above is not there yet. This was an informational run outside the repository; its record is not committed.
