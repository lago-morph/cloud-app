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
- pass `npm run verify` (the framework package's own command through the app's script, DEC-0049, DEC-0616) before declaring work done;
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
Origin: owner · Derives from: SYS-REQ-018, SYS-REQ-019 · Decision: DEC-0080 (superseded), DEC-0513, DEC-0514, DEC-0521, DEC-0522, DEC-0523, DEC-0690, DEC-0698, DEC-0703

The skill and the template's README MUST contain step-by-step instructions for the tasks the owner performs:
- finding one's user ID and adding it to the admin list, or to the optional users list (`framework.users`);
- one-time account setup;
- setting secrets;
- setting up the Google client;
- deploying and removing stages.

Amendment for release 1 (Origin: owner · Decision: DEC-0513, DEC-0514, DEC-0515): "setting up the Google client" is replaced by: setting the account's email domain with `setup-account --target cloudflare --email-domain <domain>` and the API token's email permissions; and signing up, verifying the address and signing in on a stage, including how an agent reads the mail with `mail last`. The instructions MUST write the domain as `<domain>`, never a concrete domain (MAIL-REQ-003).

Amendment (Origin: ai-proposed · Decision: DEC-0551): the token instructions describe two account API tokens: the everyday token for every command but `setup-account`, which cannot create API tokens, and the setup token for `setup-account`, each with its permission list.

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522, DEC-0523): "finding one's user ID and adding it to the admin list, or to the optional users list" is replaced by granting and revoking the `admin` role with `admins grant|revoke <email> --target <t> --stage <s>`, with `--confirm-production <s>` on a production stage, and listing admins with `admins list`. No step may tell anyone to copy a user ID into configuration, or to edit `framework.admins` or `framework.users`. The instructions MUST say that anyone who signs up and verifies their address is a user.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D2, D9, D10, §5.3 · Decision: DEC-0690, DEC-0698; when a role change takes effect: owner-approved, DEC-0703): the release-1 amendment (DEC-0513, DEC-0514, DEC-0515) and the amendment of DEC-0521…DEC-0523 above are replaced by the following. The plan-setup-wizard amendment below (DEC-0563, DEC-0601) is narrowed by its own v0.2.0 amendment. The owner's tasks are:
- the Cloudflare setup: making the bootstrap token from its link with an expiry no more than PAR-435 away, running `cloudflare-setup`, opening the admin app, doing account setup there, and making and saving the everyday token. The agent never sees the everyday token's value;
- becoming an admin: an administrator role in the owner's Cloudflare account (PAR-413). Any other member of the account is a user. A role change takes effect at the person's next sign-in (DEC-0703).

No step may tell anyone to copy a user ID into configuration, to edit `framework.admins` or `framework.users`, or to run `admins` or `mail`, which are removed. There is no email domain to set.

Amendment (Origin: owner, plan-setup-wizard §4.7 · Decision: DEC-0563, DEC-0601; supersedes DEC-0551's amendment above): the Cloudflare steps are built around two pre-filled dashboard links and one command. The instructions MUST give `npm run cloudflare-setup` as the one setup step; describe the everyday token (`prototype-framework`, for every command) and the bootstrap token (`prototype-framework-bootstrap`, made in the dashboard, used once and deleted by setup); say where the values go in a cloud session and on the command line; and say what to do on each of the setup command's stop messages. A permission list they show MUST be generated from the framework's permission list (DEC-0602).

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D9, D10, §5.3 · Decision: DEC-0697, DEC-0698): the Cloudflare steps are built around one pre-filled dashboard link, the bootstrap token's, with an expiry no more than PAR-435 away, and one command, `npm run cloudflare-setup`. The everyday token's link is replaced by the admin app: the instructions MUST say to open the admin app's URL that the command prints, sign in, do account setup, and make and save the everyday token there; the agent never sees its value. The rest of the amendment above is unchanged: where the values go, what to do on each stop message, and generated permission lists.

#### SKILL-REQ-007 — Trigger phrases and first step
Origin: owner · Derives from: SYS-REQ-029 · Decision: DEC-0594, DEC-0600, DEC-0616

The router's description MUST list the trigger phrases "set up Cloudflare", "continue prototype setup" and "continue setup", and the `/prototype-framework …` invocation. The router MUST make `npm run version-check` the first step of every session, relaying its suggestions (the newer-npm-release one once per session) and skipping it while the app is not installed, and MUST have a "Cloudflare setup" section that, on those phrases, runs `npm run cloudflare-setup` and relays its output as is.

#### SKILL-REQ-008 — The agent stays away from the token values
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0598, DEC-0599

The router MUST tell app agents never to open, print or search `.env.cloudflare` and never to echo the token variables, using the CLI instead. It MUST tell them to run `git check-ignore -q .env.cloudflare` and `git ls-files --error-unmatch .env.cloudflare` when a session starts work on the app and before every commit or push, to remind the user each time the file is not ignored or is tracked, and never to refuse to commit because of it. The template MUST carry a committed `.claude/settings.json` whose permission rules deny reading `.env.cloudflare`.

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
- **Files.** One tested example of the upload pattern: the server generates the file name (for example a record-scoped `newId()` prefix) and decides access from app records, never from names; it issues the upload ticket with an explicit content type; the browser calls `uploadFile`; a finalize route calls `head`, deletes uploads that are oversized or of the wrong type, and only then creates the visible record. The template's finalize route checks the type only and sets no size cap: uploads are limited only by PAR-234 (DEC-0539). Listings fetch fresh download tickets each time; URLs are not cached. Rule: file content reaches the browser only through `downloadUrl`; `files.get` is for server-side processing.
- **Secrets.** A tested HMAC signing and verification example using `crypto.subtle` and base64url encoding, without `Buffer`.
- **Current user** (DEC-0690). Only members of the owner's Cloudflare account can sign in. A member with an administrator role is `admin`, and any other member is `user`, which means any member of the account. An app that needs finer trust keeps its own records. There is no "user" role, and no list in configuration. Tests choose a level with the mock (`as`, `user`). Tests of real-provider levels use `stubLoginProvider` with `grantRole` and `revokeRole`, or the auth-app provider over the fake binding (auth.md §2).
- **Admin steps** (owner tasks, AUTH-REQ-005 as amended). The owner gives the person an administrator role in the Cloudflare account's dashboard (Manage Account, Members). It takes effect at the person's next sign-in, with no commit and no deploy, and the person's other open sessions follow within the role-refresh interval (PAR-425); removing the role reverses it the same way (DEC-0703). `/api/auth/me` shows a person's level and user ID.
- **Deploying.** A stage whose name starts with `test-` is a test stage: it uses `config/<target>/test.json` and the authentication mock, holds no real data, and is removed after use. Every other stage is production and needs its own committed `config/<target>/<stage>.json`.
- **Testing.** One test file under `tests/smoke/**` runs both in-process (`createTestApp`) and against a deployed test stage through `smoke --target <t> --stage <s>` (`connectTestStage()`). Time-dependent behaviour (for example share-link expiry) is tested locally with the test runner's fake timers, not in the smoke test.
- **Troubleshooting.** Copy-and-paste commands per cloud to list a day's log entries and find the entry for a `requestId` under the LOG-REQ-004 key layout. On Cloudflare this uses the dashboard or an S3-compatible CLI with a manually created read-only R2 token. "When there is no log entry": `aws logs tail` on the stage Lambda's log group, or `wrangler tail` while reproducing. It points to the `meaning` of each code in `errors.d.ts`, and covers login failures: `/?authError=login_failed` with its `requestId` (the `AUTH` log entry `login failed: <reason>`), a person who is not a member of the owner's Cloudflare account, and a session ended because the role could not be confirmed (`role refresh failed`; DEC-0694). (The AWS commands: deferred, branch `aws`.)

**Diagnostics** from CHECK name the reference to read. Each reference a diagnostic can name has a section "Check rules that send you here" listing each such rule ID and what to do.

**Implementation** (E-01, decisions DEC-0367…DEC-0372 in the [decision log](../decisions/decision-log.md)):
- References are the thirteen files named in `packages/framework/src/check/references.ts`. Each starts with its title and then a paragraph beginning "Read this when", links to at least one example, and ends with a section "Stopping condition" beginning "Stop reading when".
- `SKILL.md` carries YAML front matter (`name`, `description`), the first step (`version-check`), the hard rules as a numbered list, the "Cloudflare setup" section (SKILL-REQ-007, SKILL-REQ-008), the task map as a table, and links to every reference, example and template; the task map is the router's one list of references (DEC-0600).
- Each example is a Markdown file of whole source files copied unchanged from `apps/template` or `apps/reference`. Each copied file is a fenced block directly preceded by `<!-- example-source: <repo path> -->`. The code is type-checked and tested where it lives, by each app's `verify`; a test can compare every block with its source byte for byte, and reject any source under `apps/demo/`.
- `skill/templates/` holds the files an app agent copies and fills in: `FRAMEWORK-ISSUE.md` (the entry fields of SKILL-REQ-003) and `production-stage.json` (a schema-valid production values file). The app itself is scaffolded from `apps/template`.
- The template carries the finalize route (`src/server/routes/files.ts`, with an `uploads` table) and the HMAC helper (`src/server/signing.ts`, with `tests/signing.test.ts`); `files-tickets.md` and `secrets.md` in `skill/examples/` copy them, and the references point there (E-03).

**The template's Claude Code settings** (DEC-0599). `apps/template/.claude/settings.json`, copied into every new app, denies `Read(.env.cloudflare)` and `Edit(.env.cloudflare)`, which also cover Claude Code's file tools and the file commands it recognizes in Bash (`cat`, `head`, `tail`, `sed`), plus `grep`, `rg`, `awk`, `less`, `more`, `source` and `.` naming the file, an `echo` of the token variables, and whole-environment dumps (`env`, `printenv`, `set`, `export`, `declare -p`/`-x`, `/proc/*/environ`), also when piped into `grep`. The skill's `git check-ignore` and `git ls-files` checks match none of these. Claude Code applies these rules on a best-effort basis: they do not reach a program that opens the file itself, so the skill's rule stays the first defence.

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
| SKILL-AC-006 | Following only the documented owner steps, the owner (for the steps that need a person in a browser) and an AI-agent tester (for the rest) do the following. The owner makes a bootstrap token with an expiry no more than PAR-435 away; the agent runs `cloudflare-setup`, which bootstraps the admin app and deletes the token. The owner signs in to the admin app, does account setup, and makes and saves the everyday token; the agent never sees its value, and "continue prototype setup" then reports everything set up. The agent deploys a production stage from `skill/templates/production-stage.json`, with no admin or users list. The owner signs in to it through the auth app and is `admin`. Then the agent removes the stage. (A member's `user` level and a role change taking effect without a commit or redeploy are AUTH-AC-003's.) No step edits a values file to change a level, sets an email domain, or runs `admins` or `mail`. | SKILL-REQ-006 | Cloud (milestone) |
| SKILL-AC-007 | The router's front matter description contains "set up Cloudflare", "continue prototype setup", "continue setup" and `/prototype-framework`; the router names `npm run version-check` (or `npm exec --no -- <package> version-check`) as the first step of a session, with its newer-npm-release suggestion once per session, names no `npx prototype-framework`, and says to skip the check while the app is not installed; and its "Cloudflare setup" section runs `npm run cloudflare-setup` on those phrases and says to relay its output as is. | SKILL-REQ-007 | Local |
| SKILL-AC-008 | The router says never to open, print or search `.env.cloudflare` and never to echo `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_BOOTSTRAP_TOKEN`; it gives both git commands, when to run them (a session starting work on the app, before every commit or push), to remind the user when either finds a problem, and never to refuse a commit. The template's `.claude/settings.json` parses as JSON and its `permissions.deny` holds `Read(.env.cloudflare)`, and an app made with the starter has the same file. | SKILL-REQ-008 | Local |

## 5. Portability note

The skill teaches only the public exports and target-neutral rules. Only the owner tasks and troubleshooting have steps for each cloud (SKILL-REQ-006, §2 Troubleshooting), and the template README's list of what stays billable while idle names cloud resources. A new target adds its steps there and its entries in that README list; the router, the other references, the examples and the template's code do not change.
