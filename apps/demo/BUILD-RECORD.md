# Build record — demo (photo board)

- **Builder:** Claude Opus 5.5 (model ID `claude-opus-5-5`), as best I know, running as a Claude Code subagent.
- **Date:** 2026-10-20
- **Build round:** 4
- **Branch:** `claude/implement-local-cloudflare-f-01d` (from `origin/claude/implement-local-cloudflare`)
- **How built:** the previous `apps/demo/` was deleted without being read, and the app was rebuilt from scratch by copying `apps/template` as `skill/reference/local-development.md` ("Starting a new app", app inside the framework repository) prescribes.

## Inputs read

Only these, and nothing else in the repository about how the framework works:

- `docs/demo/demo-spec.md` (whole file).
- `skill/SKILL.md` (whole file).
- `skill/reference/`: `local-development.md`, `http-and-validation.md`, `sql-and-migrations.md`, `files.md`, `kv.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `testing.md`, `deploying.md` (whole files). Not read: `troubleshooting.md`, `owner-tasks.md`.
- `skill/examples/`: only the parts copied from `apps/reference` (the template parts duplicate files read directly): `notes-sql.md` (from the template schema to the end, including `evolution.ts`), `configuration.md` (reference `env.ts` and `config/local.json`), `admin-and-current-user.md` (reference `levels.ts`), `tests.md` (reference `tests/support.ts`), `secrets.md` (reference `encoding.ts`).
- `skill/templates/`: `README.md`, `FRAMEWORK-ISSUE.md`, `production-stage.json`.
- `apps/template/`: every file except the Postgres migrations and the `meta/` snapshots (`package.json`, `.gitignore`, `README.md`, `tsconfig.json`, `index.html`, `config/local.json`, `config/cloudflare/test.json`, all of `src/`, all of `tests/`, `migrations/sqlite/*.sql`, `migrations/checksums.json`).
- Incidentally, as the local-development steps required: the `workspaces` list of the root `package.json` and the `apps/demo` entry of the root `package-lock.json` (to confirm the workspace exists), and the output of `npm ci`, `npm run build -w packages/framework`, `tsc`, `generate-migration`, `verify`, `secrets set`, `dev` and `smoke`. `git status` printed the old demo's file names when staging the deletion; their contents were not read.

## What was built

| Requirement | Where | Tests |
| --- | --- | --- |
| DEMO-REQ-001 Posts | `src/server/routes/posts.ts`, `src/server/posts.ts`, `posts` table | `tests/app.test.ts` "posts", smoke |
| DEMO-REQ-002 Who may do what | guards + `loadVisiblePost` / `loadOwnDraft` | "permissions", smoke |
| DEMO-REQ-003 Photos | `src/server/routes/photos.ts` (ticket → upload → finalize), `deletePost` | "photos" (20 MB JPEG, max, delete, warn on cleanup failure), smoke |
| DEMO-REQ-004 Banner | `src/server/routes/site.ts` (KV `site:banner`) | "site banner", smoke |
| DEMO-REQ-005 Preference | `src/server/preferences.ts`, `/api/preferences` (KV `pref:<userId>:pageSize`) | "posts-per-page preference", smoke |
| DEMO-REQ-006 Configuration | `siteTitle`, `maxPhotosPerPost`, `shareLinkDays` in `src/server/env.ts`; `/api/site` | "configuration" (config override stands in for a rebuild with a changed values file) |
| DEMO-REQ-007 Share links | `src/server/routes/share.ts`, template `signing.ts`, secret `shareKey` | "share links" (altered, expired with fake timers), smoke |
| DEMO-REQ-008 Log | `posts` info entries for publish/unpublish/delete; `photos` warn on cleanup failure | "permissions", "photos" |
| DEMO-REQ-009 Account page | `src/client/pages/account.ts` (ID + copy button) | "account" (API side; the clipboard is page-only behaviour, testing.md) |
| DEMO-REQ-010 Everywhere | one source; `tests/smoke/smoke.test.ts` | smoke |
| DEMO-REQ-011 Users list | `config/cloudflare/prod.json` sets `framework.users` | `tests/config.test.ts`, "users list" (stub login provider) |

`config/cloudflare/prod.json` comes from `skill/templates/production-stage.json`; it holds the sender name only; admins get the `admin` role with `admins grant` after they sign up (DEC-0521, DEC-0523).

## Checks

| Check | Result |
| --- | --- |
| `npx prototype-framework verify` | passed (type checking, portability rules, migration checker, zod version, tests on SQLite and Postgres) |
| `npx prototype-framework smoke --target local` | see "Smoke runs" below |
| Smoke on Cloudflare (`test-*` stage) | `blocked`: no cloud calls are allowed in this build round (task rule: local only) |
| Smoke on AWS | `not-run`: AWS phase not started |

Requirements that need a cloud run (DEMO-AC-001…005, 007, 008, 009, 010 on cloud) are unfinished for the clouds, as listed above.

## Smoke runs

- `smoke --target local --stage local` against `npm run dev`, commit `97dd0d7`: 7 passed, 0 failed. Evidence: `validation/local/g7586p3q4x45qyc.json` (repository root). The local log `.logs/2026-10-20.log` held the `posts` `info` entries for publish, unpublish and delete (DEMO-AC-008, local).

## Framework issues

None found: everything the spec needed was covered by the skill and the template, so no `FRAMEWORK-ISSUE.md` was created. Notes, not defects:

- DEMO-AC-005 "survives logout and login" is exercised as a fresh session for the same user ID (`t.as(mockUsers.user(id))`), because testing.md says disposing an in-process test app disposes all of them, so an explicit logout mid-test is not available in-process.
- DEMO-AC-006 (rebuild with a changed title) is tested through `createTestApp`'s `config` override of `siteTitle`, which is what the values file feeds at build time.
- DEMO-AC-011 (only listed people can post) is retired with DEMO-REQ-011 (DEC-0522): every signed-up user can post.
