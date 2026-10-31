# CLI — Developer commands

The commands the owner and agents use, including the scripted pre-completion verification command (SYS-REQ-025). Also defines the repository and app layout the commands work on.

Contracts: the command table below.

## 1. Requirements

#### CLI-REQ-001 — Commands
Origin: provenance-unclear · Derives from: SYS-REQ-018, SYS-REQ-022, SYS-REQ-023, SYS-REQ-025, SYS-REQ-027 · Decision: DEC-0512, DEC-0513, DEC-0514, DEC-0523, DEC-0544 (owner: `stop`, `start`, `deploy --start`), DEC-0584, DEC-0594, DEC-0595, DEC-0597, DEC-0698

The CLI MUST provide these commands as the framework package's own binary, invoked as `npx <package> <command>` (for example `npx <package> verify`). Apps also expose them as npm scripts of the same name.

| Command | Purpose |
| --- | --- |
| `dev` | Run the app locally (LOCAL). |
| `verify` | The scripted pre-completion verification (CLI-REQ-002). |
| `generate-migration` | Generate the next migration pair from the table definitions (MIG). |
| `build --target <t> --stage <s>` | Build a deployment without deploying it. |
| `deploy --target <t> --stage <s> [--start]` | Deploy a stage (PROV). A stage named `test-*` is a test stage; every other stage is production (PROV-REQ-005). A stage that `stop` stopped stays stopped unless `--start` is given (PROV-REQ-002). |
| `smoke --target <t> --stage <s>` | Run the app's smoke tests (`tests/smoke/**`) against a deployed test stage, or against the running `dev` server with target `local`; write evidence and print the stage's log location for the day. |
| `remove --target <t> --stage <s> [--confirm-production <s>]` | Remove a stage (PROV). A production stage only with `--confirm-production` repeating its name, and only after its backup succeeded (PROV-REQ-003). |
| `stop --target <t> --stage <s>` | Stop a stage: its address stops answering; code, data and secrets stay. Recorded, so `deploy` leaves it stopped (PROV §2 "Stage record"). |
| `start --target <t> --stage <s>` | Start a stopped stage. |
| `secrets set <name> --target <t> --stage <s>` | Set a secret from standard input (SEC). |
| `setup-account --target <t> [--region <r>]` | One-time creation of the account's shared resources and settings (PROV-REQ-004); `--region` chooses the AWS account's region (PROV-REQ-006). `--region` and the AWS target: deferred, branch `aws`; release 1's `setup-account` takes `--target`. On Cloudflare the admin app's Account setup page runs these steps in v0.2.0 (SETUP §2). |
| `cloudflare-setup [--switch-account]` | The re-runnable Cloudflare setup: the local setup first, then the tokens. With a bootstrap token it bootstraps the admin app (the OAuth clients, their secrets, the admin app's deploy) and deletes the token; without one it checks the account setup and the everyday token that the admin app makes, doing only what is missing; prints what the user must do next (DEC-0584, DEC-0697). |
| `check-login --target <t> --stage <s>` | The automated part of the provider check on a production stage: `/api/auth/login` sends people to the auth app's `/start` with the stage's app ID and its registered return URL (SYS-REQ-027 as amended; AUTH-AC-011, E2E-008). |
| `reset-local` | Clear local state. |
| `version-check` | Compare the app's installed framework, its committed skill copy, the cloud setup script's skill copy and npm's latest release, and print what to do; changes nothing (DEC-0594). |
| `upgrade [<version>]` | Move the app to a framework release (default: the latest): pins, `npm install`, the committed skill copy, `verify`, whether Cloudflare setup needs re-running, and the pinned setup script (DEC-0595). |

`certify-auth` (the guided Google certification) is retired with GOOGLE (DEC-0513); `check-login` replaces it (DEC-0512). In v0.2.0, `mail` and `admins` are removed (DEC-0698): the framework sends no email, and roles come from the Cloudflare account (SYS-REQ-018 as amended).

#### CLI-REQ-002 — `verify`
Origin: owner-approved · Derives from: SYS-REQ-025

`verify` MUST run locally, deterministically, and with no network or cloud dependency:
1. type checking;
2. the portability rules (CHECK);
3. the migration checker (CHECK);
4. the app's automated tests on both SQL dialects.

It MUST fail if any step fails or if no tests ran.

#### CLI-REQ-003 — Honest exit status
Origin: provenance-unclear · Derives from: SYS-REQ-028

Every command MUST exit with non-zero status when it fails, including partial failures. When cleanup also fails, it MUST keep the original failure's status.

#### CLI-REQ-004 — No secret output
Origin: owner-approved · Derives from: SYS-REQ-015

No command may print a secret value.

#### CLI-REQ-005 — `admins` (retired)
Origin: ai-proposed · Derives from: SYS-REQ-015, SYS-REQ-018 · Decision: DEC-0521, DEC-0523, DEC-0698

Status: retired in v0.2.0 (DEC-0698). Roles come from the owner's Cloudflare account (SYS-REQ-018 as amended by DEC-0690), so there is no operator command for them. The former text is in git history.

#### CLI-REQ-006 — Git-ignore warnings, never failures
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0572, DEC-0598

Every command that reads `.env.cloudflare`, and `verify`, MUST print a prominent warning on every run when `.env.cloudflare` exists but is not ignored by git, and when it is tracked; the tracked warning MUST say that the tokens are in the repository's history and how to replace them. The warnings MUST NOT change any command's exit status, and an error while checking MUST NOT fail the command.

## 2. Design

**Repository layout** (DEC-0049): one npm-workspace repository.

| Path | Contents |
| --- | --- |
| `packages/framework/` | The framework package. |
| `apps/template/` | Minimal app. |
| `apps/demo/` | Demo app (DEMO). |
| `apps/reference/` | Compliance reference app (COMPL). |
| `tests/compliance/` | Compliance test driver. |
| `skill/` | The skill (SKILL). |
| `validation/` | Evidence records. |

**App layout.**
- `src/app.ts` holds the `defineApp` call.
- `src/server/` holds API code.
- `src/client/` holds browser code.
- `tests/` holds the app's tests; `tests/smoke/` holds the smoke tests that `smoke` runs, which also run in-process.
- `config/` holds the per-stage configuration values.
- `migrations/sqlite/` and `migrations/postgres/` hold the generated migrations.

`build` generates the target entry points under a git-ignored `.framework/` directory.

**`verify` test runs.** `verify` runs the whole app test suite once per supported dialect, each in its own process. The test runner and test file glob are PAR-116.

**`smoke`.** The tests reach the stage through `connectTestStage()` ([testing.d.ts](../contracts/ts/testing.d.ts)). The base URL comes from a record, never a guess (DEC-0272):
- With `--target local`, it is the origin of the running `dev` server. While `dev` runs, it records `{ origin, pid }` in the git-ignored `.framework/local/dev-server.json`, and removes the file when it stops. A missing or malformed record, or one whose process has ended, means no `dev` server is running, and `smoke` says to start `npm run dev`. `--stage` may be left out and can only be `local`.
- On a cloud, it is the stage's recorded deploy output `.framework/<target>/stages/<stage>.json` (`{ publicOrigin }`), written by `deploy`. `--stage` is required and must start with `test-`.

Anything else is refused before any request is sent. `smoke` first checks that the tracked files match HEAD, because the evidence record names a commit; if they differ, it exits 1 and lists the files. It then runs Vitest in its own process on `tests/smoke/**/*.test.ts`, without the app's Vitest config, and passes the connection to `connectTestStage()` (DEC-0273). The evidence record is written to `validation/<target>/<runId>.json`, with one result per test and one failed result per file-level failure. `smoke` prints the day's log location and exits 0 only when at least one test ran, every test passed, nothing failed outside a test, and the record was written (DEC-0275).

**Implementation** (`src/cli/`, DEC-0199…DEC-0205). `main.ts` holds the command table; every CLI-REQ-001 command is registered. Exit statuses: 0 success, 1 failure, 2 usage error. A failure prints only its message; a usage message never repeats an argument the command did not expect, so a value typed by mistake is not printed (CLI-REQ-004).
- `build --target <t> --stage <s>` calls the build pipeline (`src/build/`). The local stage is named `local` by convention.
- `generate-migration [--name <slug>]` loads the app's tables and calls MIG's generator; it lists the new files or says nothing changed.
- `secrets set <name> --target local --stage <s>` composes SEC's `set-command.ts` (arguments, declared or framework name, value from standard input only) and writes `.dev.vars`; it prints the name and location, never the value.
- The cloud commands (`src/cli/commands/{deploy,remove,setup-account,secrets-cloud,smoke-cloud,check-login}.ts`, D-05) refuse target `local` and an invalid stage name (exit 2). Behind an HTTPS proxy they stop with exit 1, before any request, unless the process was started with `NODE_USE_ENV_PROXY=1` (DEC-0085, DEC-0107); `smoke` on a cloud target makes the same check.
- `deploy --target <t> --stage <s>` builds the stage (`build`), builds the client's static assets with Vite (framework options only) into `.framework/<target>/client/`, then runs PROV's deploy sequence. On success it prints the public origin, records it in `.framework/<target>/stages/<stage>.json` for `smoke` and `check-login`, and for a production stage prints the sign-in page URL and the sender address (PROV §2, "Publishing the result"). The runner-only abort point is the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT` (`after-copy` | `after-code`), never an option. `deploy` never creates the account's shared resources (DEC-0349…-4).
- `remove --target <t> --stage <s>` removes a test stage as named; a production stage only with `--confirm-production <s>` repeating its name, and only after the backup to `prototype-backups` succeeded; a failed backup deletes nothing and exits 1 (DEC-0543). It prints the backup's location and items. With no leftovers it deletes the stage's recorded deploy output (DEC-0350).
- `stop --target <t> --stage <s>` and `start --target <t> --stage <s>` (DEC-0544) take only those two options, refuse target `local` and an invalid stage name (exit 2), make the HTTPS proxy check, and need no confirmation on a production stage. `stop` turns the app off (`stopApp`), then writes the stage record; `start` deletes the record, then turns the app on (`startApp`). Each failure says what state the stage is in and exits 1.
- `deploy … --start` (a flag without a value) starts a stage that `stop` stopped; without it, the deploy of a stopped stage leaves it stopped, skips the health check and says so. A schema-changing deploy prints `copied database <old> into <new>: <method>` (DEC-0545).
- `setup-account --target <t>` is the only command that creates the account's shared resources; with target `local` it says there is nothing to set up. `--region <r>` is accepted only with `--target aws` (otherwise exit 2): a new account's log bucket is created there, and a region other than an existing log bucket's is refused, naming both. (`--region`: deferred, branch `aws`; in release 1 `--target` accepts `local` and `cloudflare`, DEC-0508.)
- `secrets set <name> --target cloudflare --stage <s>` writes the stage's Worker secret `SECRET_<NAME>` through PROV's `setSecret`; the stage's Worker must exist (its first deploy). With `--target aws` it writes the SSM SecureString parameter `/<app>/<stage>/secrets/<name>`, which needs no deployed Function. (The AWS part: deferred, branch `aws`.)
- The cloud commands take their target's PROV operations from one per-target factory (`src/cli/commands/operations.ts`): Cloudflare's D-03 operations, or AWS's (`aws-operations.ts`: the AWS `TargetOperations` on the account operations). `deploy --target aws` hands the build's Lambda code (`.framework/aws/bundle`, `index.handler`) and the client's assets to the stage program, and runs the Postgres migration histories. On AWS, the SDK clients and the child processes (SST, Pulumi, the Go provider) get `SSL_CERT_FILE` from `NODE_EXTRA_CA_CERTS` (unless set) and `HTTPS_PROXY`/`https_proxy` (and `NO_PROXY`/`no_proxy`) set alike; the SDK clients use the proxy-aware request handler. (The AWS factory and everything here about AWS: deferred, branch `aws`; release 1 registers Cloudflare only.)
- `smoke --target aws` prints the S3 log bucket `prototype-logs-<account-id>` with the day's LOG-REQ-004 prefix `<app>/<stage>/<yyyy>/<mm>/<dd>/`, and the Lambda's CloudWatch log group `/aws/lambda/<app>-<stage>-http`. The account ID is redacted in the evidence record; if it cannot be read, `<account-id>` is printed with the reason. Deferred (branch `aws`).
- `check-login --target cloudflare --stage <s>` runs the automated part of the provider check on a production stage (DEC-0692): with no sign-in, it checks that `/api/auth/login` redirects to the auth app's `/start` with the stage's app ID, a `return` equal to the stage's registered callback URL, and a `state` (AUTH-AC-011). Base URL from the recorded deploy output. It needs no input, prints no token, and writes one evidence record (subdomain redacted). Test stages and target `local` are refused before any request. Item B implements it.
- **Cloudflare settings** (DEC-0570, DEC-0574). Every command with `--target cloudflare` takes `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_BOOTSTRAP_TOKEN` (v0.2.0: no `CLOUDFLARE_EMAIL_DOMAIN`, DEC-0697) from the environment first, then from `.env.cloudflare` in the app's folder (PAR-340), with a note naming any setting set differently in both (never a value); only `cloudflare-setup` gets the file's bootstrap token. Each prints CLI-REQ-006's warnings to standard error before it runs; `verify` prints them before its first step and again before its verdict. Outside a git repository the commands print nothing about git (the not-a-repository warning is `cloudflare-setup`'s).
- `cloudflare-setup [--switch-account]` (SETUP; DEC-0584…DEC-0590, DEC-0697) runs the local setup, prints the git warnings (and adds the `.gitignore` line, DEC-0572), and then the steps of setup.md §2, stopping with the exact link or command whenever the user must act. It reads the environment and `.env.cloudflare` itself, the bootstrap token included, and asks nothing on standard input: `--email-domain` answers the domain question and `--switch-account` confirms an account switch. It exits 0 only when the account is set up, the everyday token current and every host reachable; 1 for every stop that needs the user and for a failure; 2 for a usage error (DEC-0588). It calls `setup-account`'s steps (cloudflare.md `setupAccount`) with the bootstrap token, never updates or deletes a token PAR-361 names (DEC-0589), and never prints a token value, an account ID, a zone ID or the `workers.dev` subdomain (SETUP-REQ-007, DEC-0590).
- `setup-account --target cloudflare` (v0.2.0: no `--email-domain`, DEC-0698) runs on the account setup's named steps and writes the setup record last (provisioning.md §2 "Account settings record"; DEC-0577, DEC-0578); its options, output and exit statuses are unchanged.
- `reset-local` removes `.wrangler/` (local D1, KV and R2), and `.logs/`; sources, configuration, migrations and `.dev.vars` stay.
- `verify` runs every step and reports all of them before failing: type checking (the app lib set `APP_COMPILER_OPTIONS`, never the app's `tsconfig.json`; `src/` and `tests/` in separate programs, so test-runner types cannot make Node globals type-check in app code), the portability rules, the migration checker, the installed `zod` version against PAR-112, then the app tests (PAR-116 glob) once per dialect, each in a child process running Vitest through its Node API with the framework's options only (60 s test and hook timeouts, no cache). The output has no times or durations; it lists failing and skipped tests sorted (passing tests are only counted, since a line naming a file reads as a problem with it), so runs are comparable. A run with no passing test fails.
- `dev` builds for `local`/`local`, generates missing development secrets, applies pending migrations to the persisted local D1 through `getPlatformProxy` (a failing migration exits 1 before anything is served), then starts Vite (no app Vite configuration) on `127.0.0.1` port 0 and takes its bound port as `<port>`, with `/api` proxied to Wrangler (with Wrangler's own `Host`, so Wrangler's dev proxy leaves the browser's `Origin` unchanged; `/api` answers 503 until Wrangler's port is known), no CORS headers (Vite's `server.cors: false`), the SPA fallback for deep links, and a check that answers 403 unless `Host` is exactly `localhost:<port>`. If Vite's bind fails with `EADDRINUSE`, it starts Vite again, at most 3 attempts in all. It then starts `wrangler dev` on a loopback port that Wrangler binds itself (`--port 0`, inspector on loopback port 0, `--persist-to <app>/.wrangler/state`, `--env-file <app>/.dev.vars`, `--var FRAMEWORK_PUBLIC_ORIGIN:http://localhost:<port>`) with its output passed through LOG's capture into `.logs/`, reads the Worker's real port back from Wrangler's `DEV_SERVER_READY` message (or its `Ready on` line), and points the `/api` proxy at it (DEC-0417). It prints `http://localhost:<port>/`. It does not rebuild while running. Ctrl-C stops both processes and exits 0; Wrangler ending on its own exits 1.

**Deploy failures** are reported as PROV-REQ-002 specifies: the failed step, the failing migration file and database error where relevant, the stage's state, and the next action.

## 3. Uses

LOCAL, CHECK, PROV, MIG, SEC, AUTH (`check-login`: the auth-app redirect), CORE (`connectTestStage`), COMPL (evidence records).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CLI-AC-001 | Each command in the table, `version-check`, `upgrade` and `cloudflare-setup` included, runs from the template app via `npx <package> <command>` and via its npm script. | CLI-REQ-001 | Local, cloud |
| CLI-AC-002 | `verify` passes on the template; it fails on a type error, a portability violation, a mismatched migration, a failing test, a Postgres-only failure, and a project with zero tests. Two consecutive runs give identical results with networking disabled. | CLI-REQ-002 | Local |
| CLI-AC-003 | Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure. | CLI-REQ-003 | Local |
| CLI-AC-004 | A scan of the output of every command in a full test run finds no test secret values. | CLI-REQ-004 | Local, cloud |
| CLI-AC-005 | `smoke` runs the template's `tests/smoke/**` against the running `dev` server and against a deployed test stage, writes an evidence record, and prints the stage's log location for the day. | CLI-REQ-001 | Local, cloud |
| CLI-AC-008 | In a git repository holding `.env.cloudflare`: with the file not ignored, and again with it tracked (and listed in `.gitignore`), `deploy --target cloudflare` (against the fake Cloudflare API) and `verify` each print the matching warning, set off by rule lines, on every run; the tracked warning names `git rm --cached .env.cloudflare`. Each exit status equals that of the same run with the file ignored and untracked. Outside a git repository, and when the git check itself fails, they print no git warning and their exit status is unchanged. | CLI-REQ-006 | Local |

Retired criteria (DEC-0698). They are kept here for the record, outside any criteria table, so the compliance catalogue no longer reads them.

| Retired ID | Former criterion | Former Where | Replaced by |
| --- | --- | --- | --- |
| CLI-AC-006 | Against the reference app's local D1 (`--target local`): after a sign-up and verification through `dev`, `admins grant <address>` exits 0 and prints the account's user ID, which equals `/api/auth/me`'s `id`. The next request with the person's existing session shows `admin`, with no new login and no restart. `admins list` shows the address with `admin`. `admins revoke <address>` makes the next request `user`, and the `role` column is NULL afterwards. A second grant, and a revoke of a non-admin, change nothing and exit 0. An unknown address and an unverified account each exit 1 and change nothing. The output of every run, scanned with the test passwords, the stored password hash and every verification token and session cookie of the test, contains none of them. | Local | none: `admins` is removed; roles come from the Cloudflare account (AUTH-AC-003, DEC-0690) |
| CLI-AC-007 | On a Cloudflare test stage, after sign-up, verification through the test-mail route and sign-in, `admins grant <address> --target cloudflare --stage <test stage>` gives `admin` on the next request, and `admins revoke` gives `user` again, both through the D1 HTTP API. `admins grant <address> --target cloudflare --stage prodcheck` without `--confirm-production prodcheck`, or with another name, exits 2 and sends no request to the D1 API (a recorded fetch shows none); `admins list` likewise. The output of every run contains no password, hash, token or API credential. | Cloud | none: `admins` is removed; roles come from the Cloudflare account (AUTH-AC-003, DEC-0690) |

## 5. Portability note

The command table (CLI-REQ-001) does not change for a new target: `--target <t>` selects it, and the cloud commands call PROV's per-target operations (PROV §2). A new target adds its `--target` value and its build and deploy wiring: the target entry point that `build` generates, and the cloud commands' calls for that target. `verify`, `dev`, `generate-migration` and `reset-local` are local and offline, so they do not change.
