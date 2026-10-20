# Local development

Read this when you start a new app, run an app on your machine, reset local data, set a local secret, or look at local logs. Nothing here needs a cloud account or network access to a cloud.

## Starting a new app

From a checkout of the framework repository, copy the template into an empty directory:

```sh
skill/scripts/scaffold ../my-app
cd ../my-app
```

The scaffolder copies `apps/template`, installs the framework at the template's exact version, and runs `npm install`. If the directory already has files it stops and changes nothing; pass `--force` only if you really mean to overwrite them.

Then:

1. Set the app's name in `src/app.ts` (`name: "myapp"`): lowercase letters and digits only, no hyphens, at most 20 characters (PAR-290). It is used in resource and log names.
2. Replace the template's notes, status and files code with your own, keeping the layout (`src/app.ts`, `src/server/`, `src/client/`, `src/shared/`, `tests/`, `tests/smoke/`, `config/`, `migrations/`).
3. Never change the versions of `@lago-morph/prototype-framework`, `hono`, `zod`, `typescript`, `vite` or `vitest` in `package.json`. `verify` checks the installed `zod` against the framework's pin.

## Commands

Run them in the app directory, as `npm run <command>` or `npx prototype-framework <command>`:

| Command | Does |
| --- | --- |
| `dev` | Applies pending migrations to the local database, generates missing local framework keys into `.dev.vars`, and serves the app at the printed `http://localhost:<port>/` |
| `verify` | Type checks, portability rules, migration checker, then your tests on SQLite and on Postgres. Must pass before you call work done |
| `generate-migration` | Writes the next migration pair from your tables ([sql-and-migrations.md](sql-and-migrations.md)) |
| `smoke --target local` | Runs `tests/smoke/**` against the running `dev` server ([testing.md](testing.md)) |
| `secrets set <name> --target local --stage local` | Sets a local secret from standard input ([secrets.md](secrets.md)) |
| `reset-local` | Deletes local data: `.wrangler/` (database, KV, files) and `.logs/`. Sources, `config/`, `migrations/` and `.dev.vars` stay |

`dev` does not rebuild while it runs: stop it with Ctrl-C and start it again after changing server code, configuration, secrets or migrations. A failing migration makes `dev` exit with an error naming the file, before anything is served; fix the schema, delete the undeployed migration pair, generate it again, and restart.

## What runs locally

| Capability | Local form |
| --- | --- |
| SQL and KV | Local D1 (SQLite) under Wrangler, kept in `.wrangler/` between runs |
| Files | Local R2 emulation; tickets point to a same-origin framework route |
| Secrets | `.dev.vars` (git-ignored, owner-only permissions) |
| Configuration | `config/local.json` |
| Log | `.logs/<yyyy-mm-dd>.log` ([log.md](log.md)) |
| Login | The authentication mock |

- Open the app only as `http://localhost:<port>/` exactly as printed: requests with another host name (including `127.0.0.1`) are refused with 403.
- The login button logs you in as the default mock user (level `user`). To try admin pages in your browser, run this once in the browser's developer console on the app's page, then reload:
  `await fetch("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "admin" }) })`
  This is a development aid only; app code never does this, and production stages have no mock.
- Postgres is checked by `verify` (an in-process PGlite database), not by `dev`.
- `.wrangler/`, `.logs/`, `.dev.vars` and `.framework/` (build output) are git-ignored; never commit them.

## Examples

- [examples/endpoint-and-page.md](../examples/endpoint-and-page.md): the app definition, `index.html` and the browser entry the dev server serves.
- [examples/configuration.md](../examples/configuration.md): `config/local.json`.

## Stopping condition

Stop reading when `npm run dev` serves your app at `http://localhost:<port>/`, you can log in with the mock, and `npx prototype-framework verify` passes. For deploying to a cloud, read [deploying.md](deploying.md).
