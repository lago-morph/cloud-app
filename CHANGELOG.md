# Changelog

All notable changes to the published packages and the Claude Code plugin from this repository. They are released together at one version:

- `@lago-morph/prototype-framework` (npm)
- `@lago-morph/create-prototype-app` (npm; run as `npm create @lago-morph/prototype-app`)
- `@lago-morph/prototype-framework-skill` (npm)
- the `prototype-framework` Claude Code plugin (marketplace `lago-morph`, this repository)

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/); before 1.0.0, a minor version may make breaking changes.

## [0.2.0-rc01] - 2026-11-02

First release candidate of 0.2.0, published to the npm dist-tag `next` (`latest` stays at 0.1.1). It holds the whole release so far. Try it with `npm create @lago-morph/prototype-app@0.2.0-rc01 my-app`, or move an app with `npm run upgrade -- 0.2.0-rc01`.

0.2.0 replaces sign-in by email and password with sign-in with Cloudflare. It is a breaking release (before 1.0.0, a minor version may make breaking changes). **Password accounts and sessions are dropped, and Cloudflare setup must be run again** (see "Upgrading an app made with 0.1.x").

### Added

- **Sign-in with Cloudflare.** On Cloudflare, people sign in with their Cloudflare account through the account's **auth app**, one per account, which signs people in for all its apps; the apps hold no Cloudflare credential. Only members of the account can sign in. A member with the account role "Super Administrator - All Privileges" or "Administrator" is the app's admin; any other member is a user. Locally and on `test-` stages the authentication mock signs people in, as before.
- **The admin app**, deployed by `cloudflare-setup` with a one-time bootstrap token. Sign in to it with Cloudflare (an administrator role is needed). Its pages: **Account setup** (deploys the auth app and creates the account's shared buckets and the file-ticket signing credential), **Everyday token** (makes the everyday token `prototype-framework`, or brings an existing one to the new permission list in place, and shows a new value once, to you and not to the agent), **Status** (registered apps and recent sign-ins), and an optional **Clean up v0.1.x email**. It keeps no token and no state.
- A production deploy registers the stage's sign-in return address with the auth app; `remove` clears it first.
- The file-ticket signing credential is kept in Cloudflare Secrets Store and bound to each stage at deploy. Where the account offers no Secrets Store, it is kept as before and copied into Worker secrets.
- `./testing`: `createTestApp` can sign people in through a fake auth app (`authAppLoginProvider`, `loginWithAuthApp`, `authApp`) and has a test clock.
- The template: an e2e layer with Playwright (`npm run test:e2e:api`, `npm run test:e2e:ui`; `npm run verify` now also runs the `e2e-api` tests) and a fuzz helper with `fast-check`, each with an example test. `@playwright/test` and `fast-check` are pinned dev dependencies.
- The skill: testing references for end-to-end tests, fuzzing, failing tests and test changes (`skill/reference/testing/`); "done" now includes every flow tested end to end.

### Changed

- `npm run cloudflare-setup` now does only the bootstrap: it checks the bootstrap token, creates the account's two OAuth clients (admin and sign-in) with their secrets in Secrets Store, deploys the admin app, prints its address and deletes the bootstrap token as its last step. The account setup and the everyday token are the admin app's pages. Re-run, it checks everything and gives the next step. It no longer asks for an email domain (`--email-domain` is gone), needs no domain on Cloudflare DNS and no Workers Paid plan.
- The bootstrap token holds exactly four permissions (Workers Scripts, OAuth Client, Secrets Store and Account API Tokens, all Edit). A bootstrap token with no expiry, or with more than 1 day left, is deleted at once without being used.
- The everyday token holds exactly four permissions: Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit and Secrets Store Read. The email and zone permissions are gone. The permission list and the account setup are now version 2, so `npm run upgrade` says that setup must be run again.
- Sessions last 12 hours (were 7 days). A role change or removal takes effect at the person's next sign-in; a session they already have keeps its role until it ends.
- `deploy` no longer needs, reads or binds an email domain: a 0.1.x stage loses its `EMAIL` binding and `FRAMEWORK_MAIL_FROM` on its next deploy.
- `check-login` checks the real sign-in path of a production stage up to the auth app: the app's redirect, a refused bogus callback, then the auth app's acceptance.
- When a release needs Cloudflare setup again, `npm run upgrade` now points to a new bootstrap token and then the admin app's two pages.
- The template's share links accept only the canonical spelling of a signature.

### Removed

- Sign-in by email and password: the password pages and endpoints, and Better Auth. Framework migration 0004 drops the old sign-in and test-mail tables; it runs with the app's migrations on the next `dev` or `deploy`, and the app's own data stays.
- The `mail` command, the mail sink and the email domain and Email Service setup; `./testing`'s `TestApp.mail`.
- The `admins` command: admins are now the account's members with one of its two administrator roles. The template's `mail` and `admins` scripts are removed.

### Upgrading an app made with 0.1.x

1. Run `npm run upgrade -- 0.2.0-rc01` (or `npm run upgrade -- next`). It pins the framework, refreshes the skill copy, runs `verify` and says that Cloudflare setup needs re-running.
2. Remove the `mail` and `admins` scripts from `package.json` if they are still there. Optionally copy the template's e2e and fuzz files, its `test:e2e:api` and `test:e2e:ui` scripts and its `@playwright/test` and `fast-check` dev dependencies.
3. Run Cloudflare setup again, once per account: make a new bootstrap token with an expiry of 1 day or less and run `npm run cloudflare-setup`, which deploys the admin app. Open the admin app, sign in with Cloudflare, and use its **Account setup** and then its **Everyday token** page. If the Everyday token page makes a new token instead of updating yours, save the new value in place of the old one. Then run `npm run cloudflare-setup` again to check.
4. Everyone signs in again, with Cloudflare. The admin app's **Clean up v0.1.x email** page removes the old email resources if you want it to; it never does so on its own.

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

- The skill and docs run the framework through `npm run <command>` or `npm exec --no -- prototype-framework <command>`, never `npx prototype-framework`: an unscoped `npx` name could fetch an unrelated package.
- The everyday Cloudflare token now also needs "Email Routing Rules Read" (zone), so it can check the whole account setup by itself.

### Upgrading an app made with 0.1.0

1. Set `@lago-morph/prototype-framework` to `0.1.1` in `package.json` and run `npm install`.
2. Add the template's new npm scripts to `package.json`: `"cloudflare-setup": "prototype-framework cloudflare-setup"`, `"version-check": "prototype-framework version-check"` and `"upgrade": "prototype-framework upgrade"`. Or run them as `npm exec --no -- prototype-framework <command>`. Optionally copy the template's `.claude/settings.json`, which stops Claude Code from reading `.env.cloudflare`.
3. Run `npm run cloudflare-setup` once for each Cloudflare account. It needs the bootstrap token once, from the link it prints: it upgrades the account's setup record and adds "Email Routing Rules Read" to the existing everyday token in place. `deploy` and the other commands keep working without this step.

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

[0.2.0-rc01]: https://github.com/lago-morph/cloud-app/releases/tag/v0.2.0-rc01
[0.1.1]: https://github.com/lago-morph/cloud-app/releases/tag/v0.1.1
[0.1.0]: https://github.com/lago-morph/cloud-app/releases/tag/v0.1.0
