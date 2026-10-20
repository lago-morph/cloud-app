# CLI — Developer commands

The commands the owner and agents use, including the scripted pre-completion verification command (SYS-REQ-025). Also defines the repository and app layout the commands work on.

Contracts: the command table below.

## 1. Requirements

#### CLI-REQ-001 — Commands
Origin: provenance-unclear · Derives from: SYS-REQ-022, SYS-REQ-023, SYS-REQ-025

The CLI MUST provide these commands as the framework package's own binary, invoked as `npx <package> <command>` (for example `npx <package> verify`). Apps also expose them as npm scripts of the same name.

| Command | Purpose |
| --- | --- |
| `dev` | Run the app locally (LOCAL). |
| `verify` | The scripted pre-completion verification (CLI-REQ-002). |
| `generate-migration` | Generate the next migration pair from the table definitions (MIG). |
| `build --target <t> --stage <s>` | Build a deployment without deploying it. |
| `deploy --target <t> --stage <s>` | Deploy a stage (PROV). A stage named `test-*` is a test stage; every other stage is production (PROV-REQ-005). |
| `smoke --target <t> --stage <s>` | Run the app's smoke tests (`tests/smoke/**`) against a deployed test stage, or against the running `dev` server with target `local`; write evidence and print the stage's log location for the day. |
| `remove --target <t> --stage <s>` | Remove a stage (PROV). |
| `secrets set <name> --target <t> --stage <s>` | Set a secret from standard input (SEC). |
| `setup-account --target <t>` | One-time creation of the account's shared resources and settings (PROV-REQ-004). |
| `certify-auth --target <t> --stage <s>` | Guided login-provider certification (GOOGLE). |
| `reset-local` | Clear local state. |

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

**Implementation** (`src/cli/`, DEC-0199…DEC-0205). `main.ts` holds the command table; every CLI-REQ-001 command is registered, and those built in later work items (`deploy`, `remove`, `setup-account`, `certify-auth`, `secrets set --target cloudflare`) exit 1 saying which prerequisite they need. Exit statuses: 0 success, 1 failure, 2 usage error. A failure prints only its message; a usage message never repeats an argument the command did not expect, so a value typed by mistake is not printed (CLI-REQ-004).
- `build --target <t> --stage <s>` calls the build pipeline (`src/build/`). The local stage is named `local` by convention.
- `generate-migration [--name <slug>]` loads the app's tables and calls MIG's generator; it lists the new files or says nothing changed.
- `secrets set <name> --target local --stage <s>` composes SEC's `set-command.ts` (arguments, declared or framework name, value from standard input only) and writes `.dev.vars`; it prints the name and location, never the value.
- `reset-local` removes `.wrangler/` (local D1, KV and R2) and `.logs/`; sources, configuration, migrations and `.dev.vars` stay.
- `verify` runs every step and reports all of them before failing: type checking (the app lib set `APP_COMPILER_OPTIONS`, never the app's `tsconfig.json`; `src/` and `tests/` in separate programs, so test-runner types cannot make Node globals type-check in app code), the portability rules, the migration checker, the installed `zod` version against PAR-112, then the app tests (PAR-116 glob) once per dialect, each in a child process running Vitest through its Node API with the framework's options only (60 s test and hook timeouts, no cache). The output has no times or durations; it lists failing and skipped tests sorted (passing tests are only counted, since a line naming a file reads as a problem with it), so runs are comparable. A run with no passing test fails.
- `dev` builds for `local`/`local`, generates missing development secrets, applies pending migrations to the persisted local D1 through `getPlatformProxy` (a failing migration exits 1 before anything is served), starts `wrangler dev` on a loopback port (`--persist-to <app>/.wrangler/state`, `--env-file <app>/.dev.vars`, `--var FRAMEWORK_PUBLIC_ORIGIN:http://localhost:<port>`, inspector on loopback) with its output passed through LOG's capture into `.logs/`, then Vite (no app Vite configuration) on `127.0.0.1` with `/api` proxied to Wrangler (with Wrangler's own `Host`, so Wrangler's dev proxy leaves the browser's `Origin` unchanged), no CORS headers (Vite's `server.cors: false`), the SPA fallback for deep links, and a check that answers 403 unless `Host` is exactly `localhost:<port>`. It prints `http://localhost:<port>/`. It does not rebuild while running. Ctrl-C stops both processes and exits 0; Wrangler ending on its own exits 1.

**Deploy failures** are reported as PROV-REQ-002 specifies: the failed step, the failing migration file and database error where relevant, the stage's state, and the next action.

## 3. Uses

LOCAL, CHECK, PROV, MIG, SEC, GOOGLE, CORE (`connectTestStage`), COMPL (evidence records).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CLI-AC-001 | Each command in the table runs from the template app via `npx <package> <command>` and via its npm script. | CLI-REQ-001 | Local, cloud |
| CLI-AC-002 | `verify` passes on the template; it fails on a type error, a portability violation, a mismatched migration, a failing test, a Postgres-only failure, and a project with zero tests. Two consecutive runs give identical results with networking disabled. | CLI-REQ-002 | Local |
| CLI-AC-003 | Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure. | CLI-REQ-003 | Local |
| CLI-AC-004 | A scan of the output of every command in a full test run finds no test secret values. | CLI-REQ-004 | Local, cloud |
| CLI-AC-005 | `smoke` runs the template's `tests/smoke/**` against the running `dev` server and against a deployed test stage, writes an evidence record, and prints the stage's log location for the day. | CLI-REQ-001 | Local, cloud |
