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

Each run on each target MUST write an evidence record conforming to the schema. Criteria not executed are recorded as `unrun`, `skipped`, or `blocked`, never as `passed`.

#### COMPL-REQ-004 — Disposable cloud runs
Origin: provenance-unclear · Derives from: SYS-REQ-024

Cloud runs MUST use test stages named with the run ID, MUST always attempt to remove them afterwards, and MUST record any leftover resources in the evidence record.

#### COMPL-REQ-005 — Production checks
Origin: owner · Derives from: SYS-REQ-020, SYS-REQ-027

The suite MUST also deploy a production stage of the reference app on each cloud. On it, it MUST check that the mock is absent (AUTH-AC-009) and that the login redirect is correct (GOOGLE automatic check).

#### COMPL-REQ-006 — Definition of "works"
Origin: owner-approved · Derives from: SYS-REQ-026, SYS-REQ-027

The framework works only when all of the following hold for the same commit:
- every acceptance criterion and end-to-end scenario has passed on every applicable target;
- GOOGLE's certification is current (DEC-0021).

## 2. Design

**Reference app.** `apps/reference/` exposes small routes exercising each capability feature. It uses only the public exports, like any app.

**Two layers of tests.** HTTP-level tests run from the driver in `tests/compliance/` against a base URL. Browser-level tests (file transfers, cookies) use Playwright. SQL dialect tests also run in-process against local D1 and PGlite.

**Time limits.** Each cloud wait has a bounded timeout derived from the platform behavior it waits for, such as database resume (PAR-210). Floating-point comparisons use PAR-280.

## 3. Uses

Every capability and target component, CLI, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| COMPL-AC-001 | One command runs the suite against each target, and the per-target lists of executed criteria match the criteria's "Where" columns. | COMPL-REQ-001 | Local, cloud |
| COMPL-AC-002 | The traceability report lists every `*-AC-*` and `E2E-*` ID in the documents. Removing a test's tag makes its criterion show as untested. | COMPL-REQ-002 | Local |
| COMPL-AC-003 | Evidence records validate against the schema. A run with a deliberately skipped criterion records it as skipped. | COMPL-REQ-003 | Local, cloud |
| COMPL-AC-004 | After a cloud run that is interrupted mid-way, the next cleanup removes the stages, or the evidence lists them as leftovers. | COMPL-REQ-004 | Cloud |
| COMPL-AC-005 | The production-stage checks run on both clouds. | COMPL-REQ-005 | Cloud |
| COMPL-AC-006 | The release report for a commit says "works" only when every applicable criterion and scenario passed on every target and the certification is current. A commit with one unrun criterion, or with an expired certification, is reported as not working. | COMPL-REQ-006 | Local |
