# ADR: CI limits only the browser test by changed paths

- **ID**: ADR-ea04ca4a23
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-27
- **Source retrospective**: ../2026-10-27-51.md
- **PRs covered**: #48

## Context

Most of this repository's PRs change only plans, docs or evidence, but every one paid for a full CI run, including about 10 minutes to install Playwright's Chromium. The owner found this "really annoying".

The first patch skipped all checks for documentation-only changes. The owner rejected that: "We can run all other tests every time with no filtering". Only the browser cost was the problem.

The owner also asked which files the browser test can actually see. Skill text, contracts, docs, `.github` and `.claude` can't change what the template's pages render.

## Decision

CI runs every check on every change except the Chromium browser test, which with its Playwright install runs only when a path the browser loads changed or no base commit is usable.

- **The scope step** diffs against the PR base, or the push's `before` commit. It sets `browser=true` only when a changed path matches:
  ```
  ^(apps/template/|packages/framework/)|^(tests/skill/example-pages\.test\.ts|tests/compliance/e2e/support/template-pages\.ts|package-lock\.json)$
  ```
  With no usable base (a new branch, or a zero SHA), it runs.
- **What always runs:**
  - build, typecheck, lint and unit tests;
  - the template and reference app verify;
  - the skill tests, including the no-browser "each copied index.html" check;
  - the npm create test;
  - package contents.
- **The release workflow** always installs the browser.

## Alternatives considered

- **Skip all checks for docs-only changes** (`7bd9bfc`): rejected by the owner. The cheap checks catch real breakage, such as manifest versions and the skill examples, and cost little.
- **GitHub `paths-ignore` on the whole workflow:** the same flaw. It also leaves required checks pending.
- **Cache the Playwright browser:** not chosen yet. It would cut the cost, but doesn't avoid the install on cache misses or lockfile bumps, and adds cache-key upkeep. It can be combined later.

## Consequences

- **Easier:** docs and plan PRs finish in about 8 minutes, and the first run on main passed in 8 m 23 s with both browser steps skipped.
- **Harder:** the path list must be kept right. A new file the browser loads that is outside those paths would skip the browser test silently. The skill's example-to-template check (no browser) guards the main way that could happen.
- **Who changes it:** the owner, since this session's GitHub credential can't push workflow files. Changes travel through `.github/workflows-patch/`.

## References

- [`../2026-10-27-51.md`](../2026-10-27-51.md): the source retrospective.
- `.github/workflows/ci.yml` on main at `14b7cca`.
- PR the decision was made in: #48.
