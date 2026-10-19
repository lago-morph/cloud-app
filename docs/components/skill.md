# SKILL — AI skill and app template

Guidance for AI agents that build apps on the framework, plus the app template and a scaffolder. The skill is how app-building agents learn the framework's contracts and rules without reading the framework's source.

Contracts: none app-facing. Size budgets are PAR-070 to PAR-072.

## 1. Requirements

#### SKILL-REQ-001 — Layered structure
Origin: provenance-unclear · Derives from: SYS-REQ-029

The skill MUST consist of:
- a router (`SKILL.md`, at most PAR-070) that states the hard rules and maps tasks to references;
- one reference per capability and workflow (each at most PAR-071);
- complete working examples (each at most PAR-072);
- templates applied by the scaffolder.

#### SKILL-REQ-002 — Read only what the task needs
Origin: provenance-unclear · Derives from: SYS-REQ-029

The router MUST map common tasks to the references they need: adding an endpoint, storing data, handling files, adding an admin page, testing, deploying, and diagnosing a failing request or deploy. Each reference MUST open with "read this when" and end with a stopping condition.

#### SKILL-REQ-003 — Hard rules for app agents
Origin: provenance-unclear · Derives from: SYS-REQ-006, SYS-REQ-025, SYS-REQ-028

The router MUST require app agents to:
- use only the framework's public exports;
- never insert user text as HTML;
- pass `npx <package> verify` (the framework package's own command, DEC-0049) before declaring work done;
- claim an app works on a cloud only after the app's smoke test has passed on a deployed stage there (SYS-REQ-028);
- never change framework version pins;
- record a suspected framework defect in a reproducible `FRAMEWORK-ISSUE.md` instead of working around the framework. Each entry MUST state the task attempted, the contract or reference consulted, a minimal reproduction, the observed code or diagnostic, and the workaround not taken;
- after recording an entry, stop work on the blocked requirement, continue only work that does not depend on it, report the issue and the unfinished requirements to the user, and not declare the app done.

These rules govern app agents only; agents implementing the framework fix framework defects directly (DEC-0056).

#### SKILL-REQ-004 — Tested examples
Origin: provenance-unclear · Derives from: SYS-REQ-029

Every example and template MUST type-check and pass `verify` in the framework's own CI. Examples MUST come from the template or the compliance reference app, never from the demo (DEC-0054).

#### SKILL-REQ-005 — Safe scaffolding
Origin: provenance-unclear · Derives from: SYS-REQ-029

The scaffolder MUST NOT overwrite existing files unless explicitly told to.

#### SKILL-REQ-006 — Owner tasks documented
Origin: owner · Derives from: SYS-REQ-018, SYS-REQ-019 · Decision: DEC-0080

The skill and the template's README MUST contain step-by-step instructions for the tasks the owner performs:
- finding one's user ID and adding it to the admin list, or to the optional users list (`framework.users`);
- one-time account setup;
- setting secrets;
- setting up the Google client;
- deploying and removing stages.

## 2. Design

**Layout.** `skill/SKILL.md`, `skill/reference/`, `skill/examples/`, `skill/templates/`, `skill/scripts/scaffold`.

**References** cover:
- HTTP and validation;
- SQL and migrations;
- KV;
- files;
- secrets;
- configuration;
- current user;
- log;
- local development;
- deploying;
- testing;
- troubleshooting.

Specific content the references carry:
- **HTTP and validation.** Guards are applied per route (`requireUser()` or `requireAdmin()` on the route itself), so the handler sees a `LoggedInUser`. Where a guard is applied with `use()`, handlers obtain the user with `requireCurrentUser(c)`. Route modules take `Hono<Env>` from `src/server/env.ts` (see the template). Response types are declared once in `src/shared/` and passed to `api<T>` in browser code. Codes apps throw follow CORE-REQ-007: missing or private resource → `HTTP.NOT_FOUND`; visible but not changeable → `AUTH.FORBIDDEN`; bad input → `HTTP.INVALID_INPUT`; state or limit → `HTTP.CONFLICT`; never `SQL.*`/`KV.*`/`FILES.*`/`SEC.*`/`CFG.*`.
- **Files.** One tested example of the upload pattern: the server generates the file name (for example a record-scoped `newId()` prefix) and decides access from app records, never from names; it issues the upload ticket with an explicit content type; the browser calls `uploadFile`; a finalize route calls `head`, deletes uploads that are oversized or of the wrong type, and only then creates the visible record. Listings fetch fresh download tickets each time; URLs are not cached. Rule: file content reaches the browser only through `downloadUrl`; `files.get` is for server-side processing.
- **Secrets.** A tested HMAC signing and verification example using `crypto.subtle` and base64url encoding, without `Buffer`.
- **Current user.** Without a users list, level `user` means any account the login provider accepts, not a person this app trusts. To admit only known people, list their user IDs in `framework.users` in the stage's values file; then a login on neither `framework.users` nor `framework.admins` is anonymous, so `requireUser()` refuses it with 401. Admins need not be repeated in `framework.users`. The mock ignores both lists, so tests of list membership use the stub login provider (`createTestApp` with `stubLoginProvider`, then `loginWithStub`).
- **Copy-ID steps** (owner tasks, AUTH-REQ-005). The same steps serve both lists: the person logs in on a production stage and opens `/api/auth/me`; they copy `id`, or `unlistedId` if the users list currently makes them anonymous; the owner adds it to `framework.admins` or `framework.users` in `config/<target>/<stage>.json`, commits, and deploys again.
- **Deploying.** A stage whose name starts with `test-` is a test stage: it uses `config/<target>/test.json` and the authentication mock, holds no real data, and is removed after use. Every other stage is production and needs its own committed `config/<target>/<stage>.json`.
- **Testing.** One test file under `tests/smoke/**` runs both in-process (`createTestApp`) and against a deployed test stage through `smoke --target <t> --stage <s>` (`connectTestStage()`). Time-dependent behaviour (for example share-link expiry) is tested locally with the test runner's fake timers, not in the smoke test.
- **Troubleshooting.** Copy-and-paste commands per cloud to list a day's log entries and find the entry for a `requestId` under the LOG-REQ-004 key layout. On Cloudflare this uses the dashboard or an S3-compatible CLI with a manually created read-only R2 token. "When there is no log entry": `aws logs tail` on the stage Lambda's log group, or `wrangler tail` while reproducing. It points to the `meaning` of each code in `errors.d.ts`, and covers login failures (`redirect_uri_mismatch`: register the callback URL printed by deploy).

**Diagnostics** from CHECK name the reference to read.

**The template** (`apps/template/`) is the smallest app that uses every capability once, with tests. It is the starting point the scaffolder copies. It depends on an exact framework version, not a range. Its `src/server/env.ts` exports `config`, `secrets` and `type Env = AppEnv<typeof config, (typeof secrets)[number]>`; route modules take `Hono<Env>`. Its README lists what stays billable while idle (Aurora storage, the credentials secret, shared resources, leftover test stages) and how to remove each, and notes that on AWS public routes that read the database keep Aurora awake.

## 3. Uses

CORE (export list), CHECK, CLI, and the contracts of every capability.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SKILL-AC-001 | A size check confirms every document is within its budget, and a link check confirms the router links to every reference and each reference links to its examples. | SKILL-REQ-001 | Local |
| SKILL-AC-002 | Every reference opens with "read this when" and ends with a stopping condition; the router covers each listed task. | SKILL-REQ-002 | Local |
| SKILL-AC-003 | The router states each hard rule, including the `FRAMEWORK-ISSUE.md` entry contents and the next action after recording an entry. | SKILL-REQ-003 | Local |
| SKILL-AC-004 | CI type-checks and runs every example and the template. No example file is derived from `apps/demo/`. | SKILL-REQ-004 | Local |
| SKILL-AC-005 | Scaffolding into a directory with existing files stops without changing them. | SKILL-REQ-005 | Local |
| SKILL-AC-006 | Following only the documented owner steps, a tester sets up an account, deploys with a `framework.users` list that omits them and is anonymous after login, adds their ID to `framework.users` and becomes `user`, then becomes admin, and removes the stage. | SKILL-REQ-006 | Cloud (milestone) |
