# ADR: Distribute the skill as an npm package installed by a setup script

- **ID**: ADR-e79a890cc8
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-27
- **Source retrospective**: ../2026-10-27-51.md
- **PRs covered**: #30, #31

## Context

The framework is meant to be driven by Claude, and mostly by Claude in a cloud sandbox. The skill was shipped two ways in v0.1.0:
- as a Claude Code plugin through a marketplace file;
- as a copy committed into each starter-made app.

Research showed that cloud sessions don't install plugins. A live test showed that an environment setup script writing to `~/.claude/skills` does make the skill available, in a repository with no committed copy. That repository was `cloud-experiments`; I cloned it and found nothing under `.claude/`.

The owner did not want the setup script to auto-upgrade. They did want the skill to notice when it's older than the app's framework and suggest an upgrade.

## Decision

The prototype-framework skill ships as its own npm package, versioned with the framework, and cloud sessions get it from an environment setup script that unpacks a pinned version into ~/.claude/skills, while starter-made apps also keep a committed copy.

- **The package** `@lago-morph/prototype-framework-skill` contains only `skill/`. It's bundled at pack time by `scripts/bundle.mjs`, which reuses the starter's skip list and checks that the `plugin.json` version matches.
- **The setup script** runs `npm pack @lago-morph/prototype-framework-skill@<version>` and extracts the result into `~/.claude/skills/`. The version is pinned and never `latest`.
- **The version check:** the skill's first step compares its own version with the app's framework version and says which to update. `npm run upgrade` updates both.

## Alternatives considered

- **Plugin only:** doesn't load in cloud sessions.
- **The committed copy only:** works per repository, but goes stale and needs every repository to carry it.
- **The setup script installs `latest` on every start:** rejected by the owner. Silent upgrades change behaviour under a running project.
- **The setup script clones the GitHub repository:** this needs network access to GitHub and a ref to pin. An npm tarball is versioned, small and immutable.

## Consequences

- **Easier:** one setup script per environment gives every new session the skill, in any repository. Upgrades are explicit.
- **Harder:**
  - three packages are now released together, and the release check and CI pack all three;
  - two copies can disagree, which is why the version check exists;
  - the owner edits the setup script to move versions.

## References

- [`../2026-10-27-51.md`](../2026-10-27-51.md): the source retrospective.
- `packages/prototype-framework-skill/README.md`: the setup-script snippet.
- `ai/implementation/plan-setup-wizard.md`: the skill distribution and the version check.
- `docs/RELEASING.md`: the three packages.
- PRs the decision was made in: #30, #31.
