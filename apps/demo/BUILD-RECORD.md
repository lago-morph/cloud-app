# Build record

- **Builder:** Claude Opus 5.5 (model ID `claude-opus-5-5`), as best I know, running as a Claude Code agent.
- **Date:** 2026-10-20.
- **Branch:** `claude/implement-local-cloudflare-f-01`, from `origin/claude/implement-local-cloudflare`.

## Inputs read

Only these, nothing else in the repository about how the framework works:

- `skill/SKILL.md`
- `skill/reference/`: `local-development.md`, `http-and-validation.md`, `sql-and-migrations.md`, `files.md`, `kv.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `testing.md`
- `skill/examples/`: `admin-and-current-user.md`, `configuration.md`, `notes-sql.md`, `tests.md` (skimmed; the template parts duplicate `apps/template`)
- `skill/templates/`: `README.md`, `FRAMEWORK-ISSUE.md`, `production-stage.json`
- `skill/scripts/scaffold` and `skill/scripts/scaffold.mjs` (to see what the scaffolder does)
- `apps/template/**` (all sources, tests, config, `README.md`, `package.json`, `.gitignore`)
- `docs/demo/demo-spec.md`

Also looked at, not to learn the framework: the root `package.json` workspaces list and the `package-lock.json` entry for `apps/demo` (to decide how to install), and the existing `apps/demo/package.json`.
Not read: `skill/reference/deploying.md`, `troubleshooting.md`, `owner-tasks.md`, and the other examples.

## How it was built

- `apps/demo` was already a workspace member, so instead of `skill/scripts/scaffold` (which vendors a tarball and would change the root lock file) I followed the template README's in-repository steps (`npm ci`, `npm run build -w packages/framework`) and copied `apps/template` into `apps/demo`, keeping the pins unchanged.
- The migration was made with `npx prototype-framework generate-migration --name schema`.
- Observed by running (not from documentation): the in-process download ticket is `{ url }`, and `/api/auth/me` returns `{ level, id, displayName }`.

## Results

- `npx prototype-framework verify`: **passed**. Type checking, portability rules, migrations and zod version all pass; 41 tests pass on SQLite and 41 on Postgres.
- `npx prototype-framework smoke --target local` against `dev`: **8 passed, 0 failed**. The local log shows `info` entries for publish, unpublish and delete (DEMO-AC-008 local). The evidence record went to the repo-root `validation/`, so it was moved out of the repository (FRAMEWORK-ISSUE 5).
- No cloud calls were made, and no cloud is claimed (FRAMEWORK-ISSUE 1, 2).
- Not exercised in a real browser: the account page's copy button (DEMO-AC-009 copy clause) and the DOM rendering of `<script>` titles. The client sets only `textContent`, which the `no-raw-html` rule checks.
- DEMO-AC-006: the title comes from the `siteTitle` config key and is served by `/api/site`. It is tested with a config override; the rebuild itself was not done.

## Unfinished requirements

- DEMO-REQ-010 / DEMO-AC-010 and the cloud column of every acceptance criterion: blocked by FRAMEWORK-ISSUE 1 (and 2 for DEMO-AC-003). The app is therefore not done on any cloud.
- `config/cloudflare/prod.json` sets `framework.users` (empty) and a placeholder Google client ID. The owner fills in the IDs and the client ID.
