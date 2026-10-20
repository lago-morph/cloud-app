# COMPL — Compliance suite

One contract test suite and a reference app, run identically on every target; evidence recording; and the definition of when the framework "works".

Contracts: [evidence.schema.json](../contracts/schemas/evidence.schema.json).

## 1. Requirements

#### COMPL-REQ-001 — One suite, every target
Origin: owner-approved · Derives from: SYS-REQ-026

A single test suite MUST verify each component's acceptance criteria against the reference app on local, Cloudflare, and AWS. Cloud runs use test stages. The same tests MUST run on every target where a criterion applies, with no per-target expectations except those a criterion states.

#### COMPL-REQ-002 — Traceability
Origin: owner-approved · Derives from: SYS-REQ-026

Each test MUST be tagged with the acceptance-criterion or scenario IDs it covers. A generated report MUST list each criterion and scenario with its tests and results, and MUST flag any that have no tests.

#### COMPL-REQ-003 — Evidence
Origin: provenance-unclear · Derives from: SYS-REQ-028

Each run on each target MUST write an evidence record conforming to the schema. Each result is `passed`, `failed`, `blocked` (a prerequisite was missing), or `not-run`; a criterion not executed is never recorded as `passed`. A `blocked` or `not-run` result MUST state the reason in `detail`. When a failure came from an HTTP response, its `detail` MUST include the observed status, error code, and requestId. The runner MUST refuse to record evidence from a working tree that differs from the recorded commit.

#### COMPL-REQ-004 — Disposable cloud runs
Origin: provenance-unclear · Derives from: SYS-REQ-024 · Decision: DEC-0081

Cloud runs MUST use test stages named `test-<run ID>`, where the run ID contains enough randomness that the stage's name and public address cannot be guessed. They MUST always attempt to remove those stages afterwards, and MUST record any leftover resources in the evidence record. The leftover check MUST cover every resource in PROV's removal list, including the stage's R2 API token. The production-check stage (§2) is exempt from this requirement (naming and removal).

#### COMPL-REQ-005 — Production checks
Origin: owner · Derives from: SYS-REQ-020, SYS-REQ-027

The suite MUST also deploy a production stage of the reference app on each cloud. On it, it MUST check that the mock is absent (AUTH-AC-009) and that the login redirect is correct (GOOGLE automatic check).

#### COMPL-REQ-006 — Definition of "works"
Origin: owner-approved · Derives from: SYS-REQ-026, SYS-REQ-027

The framework works for a commit only when both of the following hold:
- every automated acceptance criterion and end-to-end scenario has passed on every applicable target for that commit;
- the latest record of each milestone item exists, passed, and has not been invalidated. GOOGLE's certification is a milestone item (DEC-0021).

The milestone items are GOOGLE-AC-005, E2E-007 (cloud part), E2E-008, E2E-015, E2E-016 (review part), SKILL-AC-006, AUTH-AC-005 (admin-list part), and the stage-lifecycle and account criteria E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006, and COMPL-AC-008. A milestone item MUST be run again after major restructuring of the framework, after a change to PROV, MIG, CF, AWS, or adapter code, or when an invalidation entry naming it is recorded. A milestone record MUST NOT be invalidated by elapsed time. The release report MUST list the commits that touched GOOGLE or login-provider interface files since the last certification.

## 2. Design

**Reference app.** `apps/reference/` exposes small routes exercising each capability feature. It uses only the public exports, like any app. Framework-level scenarios run against it, not against the demo. Its fixtures include:
- a route that throws a plain `Error`;
- a route that writes a log entry;
- a route that sets two cookies;
- committed version 1 and version 2 schemas, and a data fixture, for E2E-010 and MIG-AC-003. The change between them uses only the supported changes listed in MIG §2.

**Two layers of tests.** HTTP-level tests run from the driver in `tests/compliance/` against a base URL. Browser-level tests (file transfers, cookies) use Playwright. SQL dialect tests also run in-process against local D1 and PGlite.

**Comparisons.** Query results without a total ordering are compared as multisets. Floating-point comparisons use PAR-280.

**Time limits.** Each cloud wait has a bounded timeout derived from the platform behavior it waits for, such as database resume (PAR-210).

**Tiers.** Automated criteria and scenarios run for every commit. Milestone items (COMPL-REQ-006) run only when an event invalidates their latest record, never on a clock. Invalidation entries are lines in `validation/invalidations.md`, each with the date, the affected item IDs, and the reason.

**Test stages.** A run's test stages are named `test-<run ID>` (PROV-REQ-005). The run ID is generated from a cryptographically secure random source and fills the rest of the stage name allowed by PAR-291 with lowercase letters and digits; a stage-lifecycle criterion that needs further stages generates a further random ID of the same form for each. Each run uses one test stage per cloud for every criterion that does not concern stage lifecycle. Stage-lifecycle criteria create and remove their own stages. The leftover check looks for each resource of PROV's removal list by its exact name, using `listStageResources` (per-target operations: PROV §2). The driver calls the framework's own Cloudflare operations in its process, wired as `remove` wires them, so behind a proxy the driver itself is started with `NODE_USE_ENV_PROXY=1`; without it, or without credentials, the check fails before any request and the evidence records that failure as a leftover (DEC-0357).

**Production-check stage.** Each cloud has one long-lived production stage of the reference app named `prodcheck`. Its committed values file, `config/<target>/prodcheck.json`, names a dedicated test OAuth client. The owner sets its client secret once and registers its callback once. The suite redeploys it on every run, and compliance cleanup never removes it. It serves COMPL-REQ-005, E2E-006, and certification (E2E-008), including E2E-007's cloud part.

**Testers.** Every criterion in which a tester follows documented steps is performed by an AI agent, except the real Google login, which the owner performs.

**Driver.** `npm run compliance -- --target <local|cloudflare|aws> [--stage <test-…>] [--milestone] [--base-url <url>] [--only <ID,…>] [--blocked <ID,…|*>=<reason>]…` (`tests/compliance/harness/`) refuses to start from a working tree whose tracked files differ from HEAD. It derives the expected IDs for the target and tier from the Where columns and lines, plus this phase's not-run rules. It builds and type-checks, then starts `dev` for the reference app or deploys one `test-<run ID>` stage. On a stage it deploys, it then generates a random value (32 letters and digits) for the reference app's test secret `apiKey`, holds it in memory only, sets it with `secrets set apiKey --target <cloud> --stage <stage>` (value on standard input), and deploys again: the first deploy of a new stage stops on the unset secret with the app stopped. The tests receive the value in `COMPLIANCE_SECRET_API_KEY`; the evidence writer, the raw output, the driver's own output and the live echo of the test runners replace it with `<test-secret>` (DEC-0277, D-07). Locally the value stays where the operator set it, `apps/reference/.dev.vars`. It runs each selected test layer once, selecting only the tests tagged with an expected ID: the integration layer and the Playwright projects, and on local also the unit layer for the unit-level criteria only, whose unit test outcomes count only for those IDs (DEC-0319). It writes one record through the evidence writer (`<package>/src/evidence/`, shared with `smoke`). On a cloud it removes the stage and runs the leftover check. Results are recorded, not judged. A criterion with a failing tagged test is `failed`, with the first failure line in `detail`. A criterion whose test reported a missing prerequisite, or which the operator named with `--blocked`, is `blocked` with the reason. One with no executed tagged test is `not-run`, and each skipped tagged test adds a `not-run` entry. Stages a run could not remove are kept in a local pending list, and the next cloud run removes them first. A leftover, a leftover check that could not run, a `dev` that did not stop, or a pending-stage list that could not be updated makes the run exit non-zero, keeping any earlier non-zero status (CLI-REQ-003). Only `test-` stages are ever removed. The traceability and release reports are `node tests/compliance/tools/report.mjs traceability|release`. Decisions: DEC-0259…DEC-0266, DEC-0319, DEC-0320.

**Deploy recovery.** A runner-only abort point lets the suite stop a deploy after the database copy or after the code deploy (PROV-REQ-002 step 5), so a re-run can be checked.

## 3. Uses

Every capability and target component, CLI, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| COMPL-AC-001 | One command runs the suite against each target, and the per-target lists of executed criteria and scenarios match the criteria's "Where" columns and the scenarios' "Where" lines. Milestone items are compared only in milestone runs. | COMPL-REQ-001 | Local, cloud |
| COMPL-AC-002 | The traceability report lists every `*-AC-*` and `E2E-*` ID in the documents. A unit test of the report generator shows a criterion whose test has lost its tag as untested. | COMPL-REQ-002 | Local |
| COMPL-AC-003 | Evidence records validate against the schema. A run with a deliberately omitted criterion records it as `not-run` with a reason. A deliberately failing HTTP check records the status, code, and requestId in `detail`. A run started from a working tree with a modified tracked file records no evidence. | COMPL-REQ-003 | Local, cloud |
| COMPL-AC-004 | Every test stage a cloud run creates is named `test-` followed by a random run ID of the specified length and alphabet, and two runs' IDs differ. After a cloud run that is interrupted mid-way, the next cleanup removes the stages, or the evidence lists them as leftovers. A stage whose R2 API token is deliberately left behind is reported with that token as a leftover. Cleanup never removes `prodcheck`. | COMPL-REQ-004 | Cloud |
| COMPL-AC-005 | The production-stage checks run on the `prodcheck` stage of both clouds after it is redeployed. | COMPL-REQ-005 | Cloud |
| COMPL-AC-006 | The release report for a commit says "works" only when every automated criterion and scenario passed on every applicable target for that commit and every milestone item has a valid record. A commit with one `not-run` automated criterion, or with a certification invalidated by a recorded entry, is reported as not working. The report lists the commits that touched GOOGLE or login-provider interface files since the last certification. | COMPL-REQ-006 | Local |
| COMPL-AC-007 | A unit test of deploy database discovery against a fake target shows that the lowest-numbered existing stage database is taken as current and every higher-numbered one is deleted and reported. | PROV-REQ-002 | Local |
| COMPL-AC-008 | On each cloud, a deploy stopped at the abort point after the database copy, and one stopped after the code deploy, are each followed by a successful re-run that leaves the stage with one database and the app answering. | PROV-REQ-002 | Cloud (milestone) |

## 5. Portability note

The suite is one set of tests for every target (COMPL-REQ-001): the Where columns select the criteria that apply, and per-target expectations exist only where a criterion states them. A new target adds its value to the driver's `--target` and to the evidence schema's `target` enumeration (component map §1), brings its own `prodcheck` stage and values file (COMPL-REQ-005) and its own component's criteria, and its leftover check uses that target's `listStageResources` (PROV §2). Existing tests do not change.
