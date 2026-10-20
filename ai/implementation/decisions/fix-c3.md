# fix-c3 decision drafts — unit-level criteria in the driver; E2E-004 coverage from the runners' listing

Fix of root cause `ai/implementation/root-causes/2026-10-20-E2E-004-coverage-and-not-run.md`, causes A and B (accepted by its Review). Local only; no Cloudflare calls.

### DEC-PENDING-fix-c3-1 — The driver also runs the unit layer on local, for an explicit list of unit-level criteria only
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-003, COMPL-REQ-006, COMPL-AC-002, COMPL-AC-006, COMPL-AC-007, GOOGLE-AC-002, PROV-AC-007, CLI-AC-003, plan §10.1, §10.3, compliance.md "Driver", DEC-0261 (supersedes its first bullet's "each runs once" for the local unit layer)

Plan §10.3 says unit tests count as evidence only for unit-level criteria, and C-EV / COMPL-REQ-006 read "works" only from evidence records. Before this decision the driver ran only `vitest.integration.config.ts` and the Playwright `integration`/`e2e` projects, so no record could ever show a unit-level criterion `passed` (root cause, cause B).

Rule:
- `UNIT_LEVEL` in `tests/compliance/harness/expected.ts` is the list. On `--target local`, the driver runs `npx vitest run --config vitest.unit.config.ts -t <tag pattern of the unit-level IDs it runs>` once, after the integration Vitest run and before Playwright, and keeps `raw/vitest-unit.{log,json}`. It skips the call when no unit-level ID is to be run (`--only`, `--blocked`). Cloud runs never run the unit layer.
- A unit test's outcome is folded only into the unit-level IDs its title carries (`selection.ts` `scopeTests`; `TestOutcome.ids`). The `-t` pattern is a filter, not this guard: a unit title may carry several IDs, and unit files hold fixture literals such as `"[KV-AC-001]"` in `tests/support/tags.unit.test.ts` (about 40 IDs appear bracketed in unit titles).
- The selection (which configs, paths, projects, and which IDs each may evidence) is defined once, `runnerSelection` in `tests/compliance/harness/selection.ts`, and read by the driver and by E2E-004 (DEC-PENDING-fix-c3-2).

Membership is decided from each criterion's text, not from where its tests live:

| ID | Why unit-level (criterion text) |
| --- | --- |
| COMPL-AC-002 | "A unit test of the report generator shows a criterion whose test has lost its tag as untested." Names a unit test. |
| COMPL-AC-007 | "A unit test of deploy database discovery against a fake target …". Names a unit test. |
| GOOGLE-AC-002 | "Unit tests feeding the validator hand-built tokens reject …". Names unit tests; plan §10.3's own example. |
| PROV-AC-007 | "With the cloud's response stubbed so that an existing shared log bucket belongs to another account …". Stated over a stubbed cloud response, which only a unit test with a fake cloud can produce locally. |
| CLI-AC-003 | "Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup …". Stated over injected failures (fakes), which is a unit test's setting. |
| COMPL-AC-006 | "The release report for a commit says 'works' only when … A commit with one `not-run` automated criterion, or with a certification invalidated by a recorded entry, is reported as not working …". Stated over constructed inputs to a pure report function (a commit with a chosen set of records and invalidations); real commits in that state cannot be produced by a run. |

Not on the list:
- COMPL-AC-001 ("One command runs the suite against each target, and the per-target lists … match …") and COMPL-AC-003 ("Evidence records validate … A run with a deliberately omitted criterion records it … A run started from a working tree with a modified tracked file records no evidence") are properties of a real run. Their unit tests with fakes do not count on their own (§10.3). They need integration-layer evidence from the driver itself (for example the self-test path, `--self-test`, for COMPL-AC-003, and a run-level check for COMPL-AC-001); until then they stay `not-run` and E2E-004's coverage part lists them. Open for the owner of C-02.
- SKILL-AC-005 ("Scaffolding into a directory with existing files stops without changing them") is behavioural; its integration test belongs to cause C of the record (Review: an integration-layer test of the real scaffolder is preferred).
- Any other ID: its unit tests may carry tags but are not evidence.

`selection.unit.test.ts` checks that every listed ID is a Local criterion of the catalogue.

Wording change, compliance.md "Driver": "runs each test runner once" → "runs each selected test layer once (on local also the unit layer, for the unit-level criteria only)". Plan §10.1 `npm run compliance` line likewise.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause B).

### DEC-PENDING-fix-c3-2 — E2E-004's coverage part lists the driver's exact selection through the runners
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-004, DEC-0305, DEC-0265

DEC-0305's coverage part ("has at least one tagged test in the files this target's run executes") was implemented as a regex scan of `*.test|spec.ts` sources, which cannot see titles built at run time (the KV and SQL shared case sets tag through `t(id, …)` / `tag(id, …)` in helper modules), so IDs the same run recorded `passed` were reported uncovered (root cause, cause A).

Rule: the coverage part lists, without running a test body, exactly the invocations of `runnerSelection` for the target (`tests/compliance/tools/listing.ts` `listDriverTests`: a Vitest run whose name filter matches nothing, per config; `playwright test --list` over the driver's projects and paths), scopes each listed test to the IDs it may evidence (`scopeTests`; unit-layer tests only for unit-level IDs), and reports the expected IDs no listed test carries (`uncovered`, `selection.ts`). No source scan supplements it, so the check cannot count a tag the driver would not run. Listing problems (load errors, non-zero exits) are appended to the failure message. The listing writes its Playwright JSON to its own file, never the run's `PLAYWRIGHT_JSON_OUTPUT_NAME`. The traceability report uses the same listing executor (`listSelection`) with every layer and keeps its source scan as a supplement (DEC-0265). DEC-0305's wording becomes "has at least one tagged test that the run's runners collect with the driver's selection".
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause A).

Parameter changes: none.
