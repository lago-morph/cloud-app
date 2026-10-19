# CLI — Developer commands

The commands the owner and agents use, including the scripted pre-completion verification command (SYS-REQ-025). Also defines the repository and app layout the commands work on.

Contracts: the command table below.

## 1. Requirements

#### CLI-REQ-001 — Commands
Origin: provenance-unclear · Derives from: SYS-REQ-022, SYS-REQ-023, SYS-REQ-025

The CLI MUST provide these commands. Apps expose them as npm scripts of the same name.

| Command | Purpose |
| --- | --- |
| `dev` | Run the app locally (LOCAL). |
| `verify` | The scripted pre-completion verification (CLI-REQ-002). |
| `generate-migration` | Generate the next migration pair from the table definitions (MIG). |
| `build --target <t> --stage <s>` | Build a deployment without deploying it. |
| `deploy --target <t> --stage <s> [--test]` | Deploy a stage (PROV). |
| `remove --target <t> --stage <s>` | Remove a stage (PROV). |
| `secrets set <name> --target <t> --stage <s>` | Set a secret from standard input (SEC). |
| `setup-account --target <t>` | One-time creation of the shared log bucket (PROV). |
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
- `tests/` holds the app's tests.
- `config/` holds the per-stage configuration values.
- `migrations/sqlite/` and `migrations/postgres/` hold the generated migrations.

`build` generates the target entry points under a git-ignored `.framework/` directory.

## 3. Uses

LOCAL, CHECK, PROV, MIG, SEC, GOOGLE.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CLI-AC-001 | Each command in the table runs from the template app via its npm script. | CLI-REQ-001 | Local, cloud |
| CLI-AC-002 | `verify` passes on the template; it fails on a type error, a portability violation, a mismatched migration, a failing test, a Postgres-only failure, and a project with zero tests. Two consecutive runs give identical results with networking disabled. | CLI-REQ-002 | Local |
| CLI-AC-003 | Injected failures in each command, including a failure during cleanup, yield non-zero exit statuses that reflect the original failure. | CLI-REQ-003 | Local, cloud |
| CLI-AC-004 | A scan of the output of every command in a full test run finds no test secret values. | CLI-REQ-004 | Local, cloud |
