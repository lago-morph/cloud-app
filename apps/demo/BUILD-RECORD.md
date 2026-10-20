# Build record: apps/demo (photo board)

- **Builder:** Claude Opus 5.5 (model ID `claude-opus-5-5`), running as a Claude Code subagent.
- **Date:** 2026-10-20
- **Build round:** 3 (the previous `apps/demo/` was deleted unread and rebuilt from scratch).
- **Branch:** `claude/implement-local-cloudflare-f-01c`, from `origin/claude/implement-local-cloudflare`.

## Inputs read

- `skill/SKILL.md`
- `skill/reference/`: `local-development.md`, `http-and-validation.md`, `sql-and-migrations.md`, `files.md`, `kv.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `testing.md`, `deploying.md`, `owner-tasks.md` (not read: `troubleshooting.md`)
- `skill/examples/`: `files-tickets.md`, `tests.md`, `configuration.md`, `notes-sql.md`, `admin-and-current-user.md` (not read: `endpoint-and-page.md`, `status-kv.md`, `secrets.md`; their template sources were read directly)
- `skill/templates/`: `README.md`, `production-stage.json`, `FRAMEWORK-ISSUE.md`
- `apps/template/`: every source file (`src/**`, `tests/**`, `config/**`, `index.html`, `package.json`, `tsconfig.json`, `.gitignore`, `migrations/checksums.json`); of `README.md` only its headings (then deleted from the copy)
- `docs/demo/demo-spec.md`
- Incidental, outside the allowed inputs: one `grep` over the installed package's `node_modules/@lago-morph/prototype-framework/dist/index.d.ts` that printed its single SQL export line (`defineTable, id, text, integer, number, …`), and a directory listing of that package. Nothing else of the framework, `docs/`, `packages/`, `apps/reference/`, `ai/`, `tests/` or the old demo was read. Command output (verify, generate-migration, dev, smoke) was also seen.

## What was built

Copied `apps/template` per `local-development.md` (in-repo app, no scaffolder), named `demo`, replaced the template's routes/pages/tests:

- Tables `posts` and `photos` (`size` is `number()` so files over 2 GiB fit); migration `0000_schema` generated.
- Routes: `/site`, `/banner` (admin, KV), `/preferences` (user, KV), `/posts` (paginated published list, page size from query or the user's preference), `/posts/mine`, `/admin/drafts`, `/posts/:id` (view, edit own draft, delete), `/posts/:id/publish|unpublish` (admin, logged `info`), `/posts/:id/share` and `/shared/:token` (HMAC links signed with secret `shareKey`, lifetime `shareLinkDays`), `/posts/:id/photos/upload-ticket` and finalize (JPEG/PNG, `maxPhotosPerPost`).
- Deleting a post deletes photo rows and the post atomically, then every file under `photos/<postId>/`; a failure is logged at `warn` and the post stays deleted.
- Config keys `siteTitle`, `maxPhotosPerPost`, `shareLinkDays`; `config/cloudflare/prod.json` sets `framework.users` (DEMO-REQ-011).
- Browser: front page (published list with pager, new draft, my posts, admin drafts and banner), post page (photos, edit, upload, share, publish/delete), share page, account page (user ID with copy button, posts-per-page).

## Checks

| Check | Result |
| --- | --- |
| `npx prototype-framework verify` | passed (37 tests on SQLite and on Postgres) |
| `npx prototype-framework smoke --target local` | passed, 8 tests; evidence `validation/local/iz5xn8erxm3l5ne.json` |
| Smoke on Cloudflare test stage | `blocked`: this build was instructed to make no cloud calls |
| Smoke on AWS | `not-run`: AWS phase not started |

Acceptance criteria: AC-001..005, 007, 009 (HTTP side) covered by the smoke test and local tests; AC-003 failure clause, AC-006 (config override), AC-007 expiry (fake timers), AC-008 (`logs()`; local `.logs` also showed the entries), AC-011 (stub login provider and the prod values file) by local tests. AC-010 is unfinished (cloud runs above). Open framework issue: see `FRAMEWORK-ISSUE.md` #1 (no documented browser testing; copy button and in-page rendering not automatically verified).

The app is therefore **not done**: cloud smoke runs and FRAMEWORK-ISSUE #1 remain.
