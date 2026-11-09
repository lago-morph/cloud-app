# kubecon-planner: build guide

How to create the app in `/home/user/cloud-app/kubecon-planner/` on `@lago-morph/prototype-framework` (repo version `0.2.0-rc01`) and deploy it to Cloudflare. This guide gives file paths. It does not copy their contents. Researched 2026-11-09.

## 0. Facts that decide the approach

- **`0.2.0-rc01` is not on npm.** The registry has `0.1.0`, `0.1.1` (`latest`) and `0.0.0-stage`. So `npm create @lago-morph/prototype-app@latest` would make a 0.1.1 app, which uses the old password sign-in. Do not use it. Build the app from this checkout.
- **Root workspaces** (`/home/user/cloud-app/package.json`) list `packages/*` (three), `apps/template`, `apps/reference`, `apps/demo` and `tests/compliance`. A new top-level `kubecon-planner/` is **not** a workspace, and nothing picks it up by default:
  - root `tsconfig.json` includes only `*.config.ts`, `tests/support/**` and `tests/skill/**`;
  - `eslint.config.js` covers only `packages/framework/**`;
  - `vitest.unit.config.ts`, `vitest.integration.config.ts` and `playwright.config.ts` use explicit include lists.
  So root `typecheck`, `lint`, `test:*` and `verify` do not see the app. The one exception: a bare `npx vitest run` at the root (`vitest.config.ts`, default include) would pick up the app's `tests/**/*.test.ts`. Never run vitest from the root for the app.
- **CI:** `scripts/ci/classify.mjs` treats any non-doc file under `kubecon-planner/` as code. It sets `unit.all`, so a push runs the framework's full unit layer, but no app test. That costs time but breaks nothing.
- `kubecon-planner/data/raw/` already holds untracked files. The directory is not empty, so the scaffolder needs `--force` (see 1).

## 1. Scaffold it as a standalone, non-workspace app (recommended)

Run these from the repo root (`/home/user/cloud-app`):

1. `npm ci`. `npm pack` of the framework runs its `prepack`, which builds it with tsc. That needs the root devDependencies. `node_modules` is not installed yet.
2. `skill/scripts/scaffold kubecon-planner --force`. Sources: `skill/scripts/scaffold`, `skill/scripts/scaffold.mjs`. The script:
   - copies `apps/template` without its build or local-state directories;
   - packs `packages/framework` into `kubecon-planner/vendor/lago-morph-prototype-framework-0.2.0-rc01.tgz`;
   - rewrites the dependency to `file:vendor/<tgz>`;
   - runs `npm install` inside the app.

   `--force` is safe here: it adds files and deletes nothing, so `data/` and this guide stay.

   npm treats a directory that is not a listed workspace as its own project root. The app gets its own `node_modules` and `package-lock.json`, and the root lockfile is untouched.
3. Rename the app. The scaffolder keeps the template's name.
   - `kubecon-planner/package.json` `name`: for example `kubecon-planner`.
   - `kubecon-planner/src/app.ts` `name`: lowercase letters and digits only, at most 20 characters (PAR-290), for example `kubeconplanner`. The name becomes part of every Worker, D1 and R2 resource name and of the stage URL `https://kubeconplanner-<stage>.<subdomain>.workers.dev`.
   - `kubecon-planner/index.html` `<title>`.
4. **Commit gotcha:** the root `.gitignore` has `*.tgz`, so `vendor/*.tgz` is ignored. A fresh clone or a new sandbox would then fail `npm install`. Do one of these:
   - force-add the tarball with `git add -f kubecon-planner/vendor/*.tgz`;
   - re-run the scaffold step after each fresh checkout (it overwrites the template files, so it is only safe before you have changed them).

   Force-adding is the better choice. Never commit `node_modules/`, `.wrangler/`, `.logs/`, `.dev.vars`, `.framework/` or `.env.cloudflare`. The copied `kubecon-planner/.gitignore` and the root `.gitignore` both cover them.
5. Do **not** change the version pins of `hono`, `zod`, `typescript`, `vite`, `vitest`, `@playwright/test` or `fast-check` (SKILL.md hard rule 5). After a framework change in the repo, re-pack the tarball and reinstall it. Do not edit `vendor/` by hand.

Not recommended: the in-repo workspace path (copy `apps/template` and add it to root `workspaces`). That is the documented way for an in-repo app (`skill/reference/local-development.md`, "Starting a new app"; DEC-0276). It edits root `package.json` and `package-lock.json`, which are "shared" CI inputs that select every component's tests. It also ties the app to the framework's install. The standalone scaffold keeps the app isolated.

## 2. The app API: where to read

Start with `/home/user/cloud-app/skill/SKILL.md`: hard rules, task map, "Done means". Then read only the references you need:

| Topic | Reference | Template code to copy from |
| --- | --- | --- |
| Layout, what may import what, routes, Zod validation, error codes, browser `fetch` helpers | `skill/reference/http-and-validation.md` | `apps/template/src/server/routes/*.ts`, `src/shared/types.ts` |
| SQL tables, queries, migrations | `skill/reference/sql-and-migrations.md` | `apps/template/src/server/schema.ts`, `migrations/{sqlite,postgres}/` |
| KV (small values by key, at most 4 KB per value) | `skill/reference/kv.md` | `apps/template/src/server/routes/status.ts` |
| Signed-in user, `requireUser()`, `requireAdmin()` | `skill/reference/current-user.md` | `apps/template/src/server/routes/admin.ts` |
| Files (upload and download tickets) | `skill/reference/files.md` | `apps/template/src/server/routes/files.ts` |
| Per-stage config, secrets, log | `skill/reference/configuration.md`, `secrets.md`, `log.md` | `apps/template/src/server/env.ts`, `config/` |
| Worked examples (whole files, tested in CI) | `skill/examples/*.md` (`notes-sql`, `status-kv`, `endpoint-and-page`, `admin-and-current-user`, `tests`, and others) | |

How the pieces fit:

- **App definition:** `src/app.ts` makes one `defineApp({ name, config, secrets, tables, routes })` call. `routes(api)` registers Hono handlers on `api`, which is mounted at `/api`, so `api.get("/notes")` serves `/api/notes`. Handlers get `c.var.sql`, `c.var.kv`, `c.var.files`, `c.var.log`, `c.var.user`, plus config and secrets.
- **Imports:** only `@lago-morph/prototype-framework` (server), `/client` (browser), `/testing` (tests), `hono` and `zod`. No Node built-ins or platform SDKs; `verify` enforces this.
- **Tables:** `defineTable(...)` in `src/server/schema.ts`, listed in `tables` in `app.ts`. Then `npm run generate-migration` writes the SQLite and Postgres migration pair plus `migrations/checksums.json`. Never edit a migration that has been deployed. SQL is a portable subset: no raw SQL, no transactions, no JSON column type. Store JSON as `text()` and validate it with Zod when you read it.
- **Per-user data:** add an `ownerId: text()` column set from `c.var.user.id` (an opaque `u_…` ID). Filter by it on every read and write, and never trust a user ID sent by the browser. Template pattern: `notes` in `apps/template/src/server/schema.ts` and `src/server/routes/notes.ts`. For small per-user settings, KV keys such as `prefs:<userId>` work.
- **Frontend:**
  - `index.html` loads `/src/client/main.ts` (Vite);
  - pages live in `src/client/pages/*.ts`, DOM helpers in `src/client/dom.ts`;
  - request and response types shared with the server go in `src/shared/`, which the client imports with `import type` only;
  - set `textContent` and never `innerHTML` (hard rule 2).
- **Static conference data:** `data/raw/` holds Sessionize JSON. There is no Node `fs` at runtime, so the app cannot read that directory directly. Either bundle the data as a TS or JSON module under `src/`, or load it into SQL through an admin route. KV values are limited to 4 KB, which is too small for the whole dataset.

## 3. Run locally and test

Run these in `kubecon-planner/` (sources: `skill/reference/local-development.md`, `skill/reference/testing.md`):

- `npm run version-check`: the skill's first step in each session. It changes nothing.
- `npm run dev`: applies migrations to local D1/SQLite in `.wrangler/`, writes local keys to `.dev.vars`, and serves at the printed `http://localhost:<port>/`.
  - Use exactly `localhost`; `127.0.0.1` gets 403.
  - The login button signs you in as the mock user (level `user`). For admin, use the console snippet in `local-development.md`.
  - `dev` does not hot-reload server code: restart it after changes.
- If the template's `apiKey` secret stays declared in `src/server/env.ts`, set it locally with `npm run secrets -- set apiKey --target local --stage local`. Better: remove secrets the app does not need.
- `npm run verify`: type checks, portability lint, migration checks, then every `tests/**/*.test.ts` twice (SQLite and PGlite Postgres), then Playwright `e2e-api` against a `dev` server it starts (`kubecon-planner/playwright.config.ts`). It must pass before any work counts as done.
- `npm run test:e2e:ui`: browser tests in `tests/e2e/ui/`. Run it whenever a page changes. It needs Chromium (`npx playwright install chromium` once).
- `npm run smoke -- --target local`: `tests/smoke/**` against a running `dev` server.
- `npm run reset-local`: wipes local data.
- Test layout: `tests/*.test.ts` holds in-process tests (`createTestApp`, `t.as(mockUsers.user("alice"))`). Also test that one user cannot see another's data. See `apps/template/tests/` and `skill/reference/testing/{e2e,fuzzing,test-changes,failures}.md`.
- This repo's `CLAUDE.md` also requires the `testing-standards` skill (`.claude/skills/testing-standards/SKILL.md`) for any code or test change.

## 4. Deploying to Cloudflare with the existing token

Read-only checks run on 2026-11-09: plain GET and HEAD calls to the Cloudflare API, printing only names, booleans and status codes. No token value or account ID was printed.

| Check | Result |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An **account** API token (not a user token), active, **no expiry**, sees 1 account. `CLOUDFLARE_BOOTSTRAP_TOKEN` is not set. |
| Account API tokens (names) | `admin`, `prototype-r2-signing`, `Read-all`. No `prototype-framework` everyday token, no bootstrap token. |
| Workers | `demo-test-…`, `prototype-mailsink`, `reference-prodcheck`. **No `prototype-admin`, no `prototype-auth`.** |
| R2 | `sst-state`, `prototype-logs`, `prototype-backups`, `prototype-mailsink`, plus stage buckets. D1: 2 databases (limit 10). |
| Setup record `sst-state/framework/account.json` | `setupVersion: 1`, `frameworkVersion: "0.1.0"`, steps including `signing-record`. **0.2.0 needs `ACCOUNT_SETUP_VERSION = 2`** (`packages/framework/src/provision/cloudflare/permissions.ts`). |
| Network | `api.cloudflare.com`, the R2 storage host and `*.workers.dev` are all reachable from this sandbox (existing stages answer `/api/__framework/health` with 204). |

**Conclusion: the account was set up by 0.1.0. The 0.2.0 bootstrap, admin app and auth app flow has not been done.**

- **`npm run cloudflare-setup` with only `CLOUDFLARE_API_TOKEN`** (code: `packages/framework/src/provision/cloudflare/cloudflare-setup.ts`):
  - Cloud side, it is read-only: token verify, account list, one read per permission, setup-record read and network HEADs. A write guard allows no token PUT, and allows a DELETE only of the bootstrap token's own ID or of its own `prototype-r2-signing` tokens.
  - Local side, it runs `npm install`, generates `.dev.vars` and adds the `.gitignore` line.
  - It will stop with exit 1: "This needs the admin app: the account's setup is at version 1, and this release needs version 2". It will then point to the bootstrap link. It was not run here: running it needs the root `npm ci` and an app directory, and the outcome follows from the code and the state above.
- **`deploy --target cloudflare --stage test-…`** (`packages/framework/src/provision/cloudflare/target.ts` `preflight`, `packages/framework/src/provision/core/deploy.ts`):
  - For a `test-` stage, preflight checks only that the token verifies, then that the shared resources exist (buckets, subdomain, backup lifecycle, signing record). It does not check the setup version or the auth app.
  - All of these resources exist, so a test-stage deploy with only the current token **should work**. This is unverified, and the `0.2.0` signing-credential handling (Secrets Store versus the 0.1 record) is the main risk.
  - Test stages use the mock login only: there is no real sign-in.
- **A production stage (`prod`, or any name that does not start with `test-`) needs the auth app** (`prototype-auth`), so the 0.2.0 owner flow must run first (`skill/reference/owner-tasks.md` §2, `QUICKSTART.md`):
  1. The owner makes a short-lived (at most 1 day) bootstrap token from the link `cloudflare-setup` prints, and puts it in `CLOUDFLARE_BOOTSTRAP_TOKEN` (environment settings, then a new session).
  2. `npm run cloudflare-setup` deploys the admin app and deletes the bootstrap token.
  3. The owner signs in to the admin app, runs **Account setup** (which deploys the auth app and bumps the setup version) and makes the **Everyday token** `prototype-framework`.
  4. The owner stores that token in `CLOUDFLARE_API_TOKEN`, replacing the admin token.
  5. Re-run `npm run cloudflare-setup`. It should then say "everything is set up".
  6. Add `config/cloudflare/prod.json` from `skill/templates/production-stage.json`, commit it, and deploy (`skill/reference/deploying.md` §3).
- Command sequence for a test stage (`skill/reference/deploying.md` §2):
  1. `STAGE=test-kp1`
  2. `npm run verify`
  3. `NODE_USE_ENV_PROXY=1 npm run deploy -- --target cloudflare --stage "$STAGE"`. A first deploy stops if a declared secret is missing: set it with `secrets set … --target cloudflare --stage "$STAGE"` and deploy again.
  4. Commit.
  5. `NODE_USE_ENV_PROXY=1 npm run smoke -- --target cloudflare --stage "$STAGE"`
  6. `npm run remove -- --target cloudflare --stage "$STAGE"` when done.

## 5. Gotchas

- **Never put the owner's main admin token in `CLOUDFLARE_BOOTSTRAP_TOKEN`.** It has no expiry, and setup deletes a bootstrap token with no expiry, or one that expires more than 1 day out, at once. To be safe, the owner can add that token's ID to `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (comma-separated). Setup never updates or deletes a listed ID. The setup also wants the bootstrap token and the everyday token to be two different tokens.
- Using the admin token as the everyday token works for commands, but it gives every command full account rights. The designed everyday token `prototype-framework` has 4 permissions (`QUICKSTART.md` table).
- Never print, open or grep `.env.cloudflare`, `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` (SKILL.md "Cloudflare setup"). The deny rules in `kubecon-planner/.claude/settings.json` apply only when Claude Code is started in `kubecon-planner/`, not at the repo root.
- **Node:** engines pin `22.22.0` exactly. This sandbox has `v22.23.4`; npm only warns (EBADENGINE), and the CLI does not enforce the version. Behind the sandbox's HTTPS proxy, prefix cloud commands with `NODE_USE_ENV_PROXY=1`.
- **Sign-in:** on production stages only members of the Cloudflare account can sign in. Level `user` means any member; `admin` means the roles "Super Administrator - All Privileges" or "Administrator". Invite people under Manage Account → Members (a read-only role is enough). `test-` stages and local runs use the mock only.
- **Stage names:**
  - at most 20 characters, lowercase letters, digits and hyphens;
  - `test-*` stages use `config/cloudflare/test.json`, hold no real data and should be removed after use;
  - any other name is a production stage that needs a committed `config/cloudflare/<stage>.json`;
  - names that clash with account resources (for example `prototype-mailsink`) are refused.
- **`smoke` inside this monorepo:**
  - it refuses to run if any tracked file in the whole repo differs from HEAD;
  - it writes its evidence to `/home/user/cloud-app/validation/<target>/`, at the git top level, next to the framework's own records, not inside `kubecon-planner/`. Commit that file with the run.
- **Free plan:** at most 10 D1 databases per account (2 used now; a schema-changing deploy briefly uses 2 per stage) and about 100k D1 rows written per day. Keep test data small.
- A framework defect goes into `kubecon-planner/FRAMEWORK-ISSUE.md` (template: `skill/templates/FRAMEWORK-ISSUE.md`). Never patch or work around framework code (hard rules 6 and 7).
- `0.2.0-rc01` is a release candidate. When `0.2.0` or a later rc is published to npm, switch the dependency from `file:vendor/…` to the exact npm version (`npm run upgrade`, `npm run version-check`).
