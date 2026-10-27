# Changelog

All notable changes to the published packages and the Claude Code plugin from this repository. They are released together at one version:

- `@lago-morph/prototype-framework` (npm)
- `@lago-morph/create-prototype-app` (npm; run as `npm create @lago-morph/prototype-app`)
- `@lago-morph/prototype-framework-skill` (npm)
- the `prototype-framework` Claude Code plugin (marketplace `lago-morph`, this repository)

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/); before 1.0.0, a minor version may make breaking changes.

## [0.1.1] - 2026-10-27

### Added

- `npm run cloudflare-setup` (`prototype-framework cloudflare-setup`): one re-runnable Cloudflare setup. It runs the local setup first, warns about git, finds the tokens (environment first, then `.env.cloudflare`), checks the account, plan and email domain, and runs the missing account setup steps. It checks the everyday token's permissions once and adds missing ones in place, keeping the value, then deletes the bootstrap token. It finishes with a network check. Both tokens come from pre-filled dashboard links, and no token value is ever printed. See `QUICKSTART.md`.
- `.env.cloudflare`: every Cloudflare command reads the tokens from the environment or this file (mode 600). Commands and `verify` warn, but never fail, when the file is not git-ignored or is tracked.
- `npm create @lago-morph/prototype-app my-app` now installs dependencies, sets random local secrets, adds `.env.cloudflare` to `.gitignore` and makes a first commit.
- `version-check` (changes nothing; suggests upgrades) and `upgrade [<version>]` (`npm run upgrade`: moves the app to a framework release, refreshes its skill copy and runs `verify`).
- `@lago-morph/prototype-framework-skill`: the skill alone, for a cloud environment's setup script. The framework package also ships `skill/`.
- The skill: trigger phrases ("set up Cloudflare", "continue prototype setup"), `npm run version-check` first, and a Cloudflare setup section. The template's `.claude/settings.json` denies reading `.env.cloudflare`.
- `QUICKSTART.md`: local in one line, Cloudflare in one command.

### Changed

- `setup-account` runs as named steps that are checked first and applied only when missing, and records the account setup version in the account's setup record.

### Upgrading

- Run `npm run cloudflare-setup` once on each Cloudflare account. It upgrades the account's setup record, which needs the bootstrap token once, from the link it prints.

## [0.1.0] - 2026-10-26

First public release. Release 1 targets local development and Cloudflare (DEC-0508). AWS is deferred to a later release (branch `aws`).

### Added

- Framework: one app definition (`defineApp`) served locally and on Cloudflare Workers, with SQL tables and generated migrations (SQLite locally, D1 on Cloudflare), key-value storage, files with signed upload and download tickets, typed configuration and secrets, a structured log, and login with three access levels (anonymous, user, admin; mock login locally and in test stages, Google login for production stages).
- Framework entry points: `@lago-morph/prototype-framework` (server), `/client` (browser), `/testing` (tests).
- Command line tool `prototype-framework`: `dev`, `verify`, `build`, `generate-migration`, `deploy`, `smoke`, `remove`, `secrets`, `setup-account`, `certify-auth`, `reset-local`.
- `npm create @lago-morph/prototype-app <dir>`: copies the template app, names it after the folder, pins the framework at the matching release and copies the Claude Code skill into `.claude/skills/`.
- Claude Code plugin `prototype-framework`: the framework skill (`/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`).

### Status

- Local development is verified.
- The Cloudflare commands have run against a simulated Cloudflare; see `apps/template/README.md` for what is verified on a real account.
- Google login has not been run against Google.

[0.1.1]: https://github.com/lago-morph/cloud-app/releases/tag/v0.1.1
[0.1.0]: https://github.com/lago-morph/cloud-app/releases/tag/v0.1.0
