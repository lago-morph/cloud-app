# CI test selection and the path map

Read this when you add, move or rename a test file, a component, a doc that a test or the build reads, or anything that CI must classify, or when you need to know which tests CI runs for a change.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.2.4 (TS-11, TS-16, TS-19).

## The path map

The committed path map is `scripts/ci/path-map.json`, created by item S3. Until it exists, CI runs as `.github/workflows/ci.yml` says, and the rules below describe the selection S3 introduces. CI's first step classifies the PR's changed files against it and selects the layers to run. The map is the single source for that selection: when you add a component, a test layer, an e2e support file or a doc that a test reads, update the map in the same change, so that the change still selects its tests.

## Triggers

- `.github/workflows/ci.yml` runs on `pull_request` only.
- `.github/workflows/release.yml` runs on a version tag.

## What a PR runs

- **Docs, specs and plans** (`docs/**`, `ai/**`, `*.md`, `retrospective/**`):
  - only the linters that apply to the changed files, and no test;
  - except for the few files that a unit or integration test, or the build, reads (for example contracts and skill text). The path map lists them in a short, reviewed list, with the tests that read them, and only those tests run;
  - the exception never selects e2e tests. The release run covers anything the list misses.
- **Unit:** the whole unit layer runs on any change to code or to unit tests.
- **Integration:**
  - a component's integration suite and its compliance criteria run when its source or its tests change, and when a component it depends on changes. The dependencies come from `docs/architecture/component-map.md`;
  - shared inputs run every component's integration tests: the lockfile, root configs, `core`, `config`, `testing`, the build and the compliance harness.
- **E2E (`e2e-api`, `e2e-ui`):**
  - runs when application behaviour changes: framework source and `bin`; the template, reference and demo apps' source, migrations and config; the starter package's source; the skill's scripts; the lockfile; and the e2e support code;
  - never runs for changes only to unit tests, integration tests, docs or specs;
  - a change only to e2e specs runs only the changed specs.
- **Linters:** the ones appropriate to the changed files.
- **Chromium** is installed only when a selected test needs a browser: `e2e-ui`, the Playwright `integration` project, and the template-pages browser test in `tests/skill/example-pages.test.ts`.

## No duplicates

- Each test file belongs to exactly one layer, and is selected at most once per run.
- A deliberate exception needs a decision-log entry with its reason.
- When you add a test file, check that exactly one layer's config collects it. For example, a `*.unit.test.ts` file under `tests/skill/` must not also be collected by the integration config.

## Release

`release.yml` runs every test once: unit, all integration (Vitest and the Playwright `integration` project), and both local e2e projects, with Chromium. Cloud passes and milestone items keep their compliance tiers (`docs/components/compliance.md` §2), because GitHub Actions has no cloud credentials.

## What agents run

CI selection does not change what an agent runs before it reports. That is test economy rules 1–9 (`ai/implementation/plan.md` §1). Rule 2 (docs-only items) now runs the linters, plus only the tests that the path map lists for the changed docs.

## Done

You can stop reading when your change's files are classified by the path map, every new test file is collected by exactly one layer, and you know which layers your PR selects.
