---
name: testing-standards
description: The framework repository's testing standards. Use for every change to code or tests in this repository, and whenever a test, build, deploy or spike fails, or a once-green test would change. Holds the rules that always apply, and points to one resource file per workflow.
---

# Testing standards (framework repository)

These are the lasting text of the v0.2.0 testing standards (`ai/implementation/plan-v0.2.0-testing-auth.md` §7a, TS-1…TS-21). They apply to this repository. Apps built with the framework get the same standards through the product skill (`skill/`), not through this file.

## Rules that always apply

1. **Separate roles.** Each role is its own subagent, and none is the author of the code under test:
   - **implementer**;
   - **test-case author**, who writes from the requirements, criteria, contracts and scenarios, not from the implementation;
   - **test runner**, who records results only and changes nothing;
   - **evaluator**, whose verdict is the only pass. It flags skipped tests, assertions weaker than the criterion, and wrong tags;
   - **diagnoser**;
   - **root-cause reviewer**, who never reviews a record whose cause it found itself;
   - **test-change reviewer** (rule 8);
   - **skill reviewer** (rule 10).
2. **Unit tests use red/green/refactor**, one behaviour at a time. Before writing code, confirm that the test fails for the expected reason. Unit tests need no network. Every fix is red-green: first a test that reproduces the failure and fails, then the fix.
3. **Integration tests use real local dependencies** instead of mocks of them: Miniflare/workerd, PGlite, the file system, and local stand-ins such as mock-oauth2-server. On Cloudflare, they run on a `test-` stage where a criterion's Where column says Cloud.
   - Use fakes only for external platforms that have no local stand-in, such as the fake Cloudflare APIs in `tests/compliance/criteria/_fakes/`. A run against fakes only is not evidence for a criterion whose Where column says Cloud.
   - Every framework component has a comprehensive integration suite, under `packages/framework/test/integration/<component>/` or in its compliance criteria. A missing suite is a gap, and the plan turns it into a test-author item.
4. **E2E covers every user-facing and operator-facing flow**: its happy path, its expected errors, and its edge cases. A feature is not done until all three are covered end to end.
   - Every new or changed flow adds or extends its e2e tests in the same work, and its E2E scenario in `docs/acceptance/e2e-scenarios.md`. Agents keep the scenarios current without owner approval, with a decision draft and an independent review (`resources/e2e-scenarios.md`).
   - E2E is API-first. Most e2e tests drive the HTTP API, the CLI, or both. They go in the Playwright project `e2e-api`.
   - Playwright UI tests, in project `e2e-ui`, cover only what a browser alone shows: page rendering, sign-in pages, file transfer in the page, and cookies. Each flow has at most a few of them, and the rest of its cases are API tests.
   - A test that uses only HTTP (Playwright's `request` fixture or a plain HTTP client) does not launch a browser.
   - Before writing the tests for a criterion or a scenario, list its edge cases and cover each one that applies (`resources/edge-cases.md`).
5. **State the test impact of every change.**
   - Every brief has a "Tests" section that lists: the unit, integration and e2e tests to add, change or remove; the E2E scenarios affected; and the fuzz targets affected.
   - Every framework plan has a "Tests" section and an "E2E" section for each work item.
   - The implementer makes these test changes in the same work, without being asked. The test author covers the criteria and the scenarios.
   - The item's report lists the test impact, and every test change by reason code (`resources/test-change-review.md`).
6. **Never skip, delete or weaken a test to get a pass.** If a test is wrong, that is a root-cause finding (rule 7).
7. **Every failure outside red/green gets an evidence-based root cause before anything changes.** This covers unit regressions, every integration and e2e failure, and failed builds, deploys and spikes. "Probably", "flaky" and "timing" are not causes without evidence. Follow `resources/failure-diagnosis.md`.
8. **An independent reviewer approves every change to a once-green test** before it merges. That includes changed expected results, removals, skips, wider tolerances or timeouts, and changed tags, in any layer. Follow `resources/test-change-review.md`.
9. **Kept practices** stay as they are:
   - tagging (`ai/implementation/plan.md` §10.3);
   - evidence and milestone invalidation (`ai/implementation/plan.md` §10.5, `docs/components/compliance.md`);
   - test economy rules 1–9 and the cloud usage limits (`ai/implementation/plan.md` §1);
   - offline runs with `unshare -rn sh scripts/offline.sh`. Never simulate offline by unsetting `HTTPS_PROXY` or by disabling TLS (`ai/implementation/plan.md` §10.2);
   - the 30 s unit timeout under load (`vitest.unit.config.ts`).
10. **A skill-reviewer subagent reviews every change to a skill that can affect testing**, before the change is committed. This covers changes to `.claude/skills/testing-standards/**`, to the product skill's testing references, and to `skill/SKILL.md`'s hard rules or its definition of done. The reviewer checks two things:
    - **Quality:** no rule that protects test quality is removed, loosened or made ambiguous.
    - **Progressive disclosure:**
      - `SKILL.md` holds only the rules that always apply, plus pointers to specific files;
      - each reference file starts with "Read this when…" and ends with a stopping condition;
      - the product skill stays within PAR-070…072.

    Put its verdict and its reasons in the commit message, or in the PR description for a batch of commits.
11. **Fuzzing is local, limited and targeted.** Fuzz only reviewed targets, with a small run and a fixed seed, in the unit or integration layer, and never against a cloud stage (`resources/fuzzing.md`).
12. **CI selects tests from the path map** (`scripts/ci/path-map.json`). A change that adds a component, a test file or a doc that a test reads keeps the map current (`resources/ci-path-map.md`).

## When to read a resource

Read only the file that matches your situation:

| Situation | File |
|---|---|
| A test, build, deploy or spike failed outside red/green, or you diagnose, review or fix such a failure | `resources/failure-diagnosis.md` |
| You change, remove, skip or re-tag a once-green test, or you review such a change | `resources/test-change-review.md` |
| You are about to write the tests for a criterion, a scenario or a flow | `resources/edge-cases.md` |
| You add, change or retire an E2E scenario, or you review such a change | `resources/e2e-scenarios.md` |
| You consider, write or review a fuzz target, or fuzzing found a failure | `resources/fuzzing.md` |
| You add, move or rename a test file, a component, or a doc that a test reads, or you need to know what CI runs for a change | `resources/ci-path-map.md` |
