# End-to-End Scenarios

These scenarios verify the system requirements on the assembled framework, the template, the reference app, and the demo app. Component acceptance criteria verify each contract in detail; these scenarios show the parts add up to the system specification. Each scenario names the system requirements it verifies; the reverse view is generated (CONVENTIONS §3).

Unless stated otherwise:
- framework-level scenarios run against the reference app (`apps/reference/`); E2E-002 and E2E-015 use the demo;
- cloud scenarios run on test stages using the authentication mock;
- each scenario records an evidence record (COMPL-REQ-003).

Each scenario's "Where" line names the targets it runs on, as the "Where" column does for component criteria. "Milestone" marks a milestone item (COMPL-REQ-006).

#### E2E-001 — New app, no cloud
Verifies: SYS-REQ-022, SYS-REQ-025, SYS-REQ-029
Where: Local
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On a machine with no cloud credentials and networking to cloud providers blocked:
1. Scaffold a new app from the template. It installs the framework from an `npm pack` tarball at an exact version, and imports every public subpath.
2. Run `dev`; use each capability through the template's pages.
3. Run `verify`.

Pass: the app works locally and `verify` passes.

#### E2E-002 — One source, both clouds
Verifies: SYS-REQ-001, SYS-REQ-023, SYS-REQ-030
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

From one commit:
1. Deploy the demo to a Cloudflare test stage and an AWS test stage. (The AWS stage: deferred, branch `aws`.)
2. Run the demo smoke test on each (`smoke`), and locally.

Pass: all three smoke runs pass, and no source file differs between them.

#### E2E-003 — Portability is enforced
Verifies: SYS-REQ-002, SYS-REQ-004, SYS-REQ-006, SYS-REQ-011, SYS-REQ-025
Where: Local
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

In a scaffolded app, introduce, one at a time:
- an AWS SDK import;
- a Cloudflare binding read;
- a `node:fs` import;
- a use of `caches.default`;
- raw SQL;
- a right outer join;
- a SQLite-only function;
- an `any`-typed escape;
- an edited applied migration.

Pass: `verify` fails on each, naming the rule and the skill reference to read, except that non-Web-API globals such as `caches.default` may instead fail by type checking (CHECK §2).

#### E2E-004 — Every capability on every target
Verifies: SYS-REQ-009, SYS-REQ-011, SYS-REQ-013, SYS-REQ-014, SYS-REQ-015, SYS-REQ-016, SYS-REQ-026, SYS-REQ-028
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Run the full compliance suite on local, Cloudflare, and AWS for one commit. (Release 1: local and Cloudflare; AWS is deferred (branch `aws`, DEC-0508).)

Pass: every applicable acceptance criterion passes on every target, and each target has a valid evidence record.

#### E2E-005 — Access levels on a deployed app
Verifies: SYS-REQ-005, SYS-REQ-017, SYS-REQ-020
Where: Cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On each cloud test stage, use the mock to act as anonymous, user, and admin in a browser against the reference app, exercising its protected routes. Inspect every API response and the app-facing types.

Pass: each level gets exactly its permitted actions. No response or app-facing type exposes login-provider names, login-provider tokens, issuers, or email addresses.

#### E2E-006 — Production deployments have no mock
Verifies: SYS-REQ-020, SYS-REQ-027
Where: Cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Redeploy the `prodcheck` stage (COMPL §2) on each cloud.

Pass: `/api/auth/mock-login` and `/api/__framework/test-mail` return 404, the deployed bundle contains no mock or mail-capture code, and `/api/auth/login` redirects to the framework's sign-in page on the stage's public origin (DEC-0513).

#### E2E-007 — Becoming an admin
Verifies: SYS-REQ-018
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Follow only the documented steps (DEC-0521, DEC-0523, DEC-0526):
1. Sign up and sign in to a stage: sign up, read the verification mail with `mail last`, verify, and sign in. Check that `/api/auth/me` shows level `user`, and that an admin-only reference route answers 403 `AUTH.FORBIDDEN`.
2. Grant the role: `admins grant <address> --target <t> --stage <s>`, adding `--confirm-production <s>` on a production stage.
3. Send the next request with the same session: no new login, no deploy.
4. Revoke the role with `admins revoke`, and send one more request.

Locally this runs through `dev` and the reference app's local D1, with `--target local`. On each cloud it runs on the `prodcheck` stage, with a sink address `sink+<run ID>@t.<domain>` (DEC-0527), the mail read from the sink, and `--confirm-production prodcheck`. It is automated on every cloud run, with no owner step and no commit.

Pass:
- the user is `user` before the grant;
- `admin` (the admin-only route answers 200) on the first request after it;
- `user` again on the first request after the revoke;
- the account has no role stored afterwards.

#### E2E-008 — Real login provider check (automated)
Verifies: SYS-REQ-019, SYS-REQ-027
Where: Cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On the `prodcheck` stage of each cloud, after it is redeployed, run `check-login` (PWD §2): sign-up with real email delivery to the mail sink, refusal before verification, verification, sign-in, password reset, and the sign-in rate limit, all over HTTP (DEC-0512).

Pass: `check-login` exits 0 and its evidence record shows every step passed. Runs on every cloud compliance run.

#### E2E-009 — Large photos
Verifies: SYS-REQ-008, SYS-REQ-014
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On each target, upload a 20 MB and a 100 MB photo through the reference app from a real browser, view them, and download them.

Pass: the downloads are byte-identical to the originals. App browser code made requests only to the app's API and through framework helpers. No app code or app configuration contains storage or CORS settings.

#### E2E-010 — Schema evolution with data
Verifies: SYS-REQ-012
Where: Cloud (milestone)
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Deploy reference app version 1 and load its data fixture, including files. Deploy version 2, which adds a defaulted column, adds an index, and drops a column. Deploy version 2 again.

Pass: all data not explicitly dropped survives the first upgrade, the stage is left with one database, and the second deploy applies nothing and causes no downtime.

#### E2E-011 — Logs land in the shared bucket
Verifies: SYS-REQ-007, SYS-REQ-021
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On each cloud, exercise the reference app, including its route that throws a plain `Error`. Find that request's entry by its requestId in the account's log bucket, using only commands copied from the skill's troubleshooting reference. On AWS, repeat with the stage role denied writes to the log bucket, a stage-scoped deny that leaves the shared bucket untouched. Locally, repeat with an injected failing log writer.

Pass: app and framework entries appear under the app and stage prefix with timestamps, and the forced error's entry is found by its requestId. With log writes failing, the app still works.

#### E2E-012 — Stages are isolated
Verifies: SYS-REQ-024
Where: Cloud (milestone)
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Deploy two test stages of the reference app on each cloud, with different data. Remove one.

Pass: the other stage's data and the shared resources are intact, and nothing of the removed stage remains except its entries in the shared log bucket.

#### E2E-013 — Errors are uniform and safe
Verifies: SYS-REQ-010
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Against the reference app on each target, send:
- invalid input;
- an unauthenticated request;
- a forbidden request;
- a request to an unknown route;
- a request to the route that throws a plain `Error`.

Pass: every response is a catalogue error with the right status. None contains stack traces, provider messages, or secret values.

#### E2E-014 — Secrets and configuration discipline
Verifies: SYS-REQ-015, SYS-REQ-016
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Set the reference app's secret with the CLI on each cloud, deploy, and scan:
- the repository;
- the build outputs;
- the deployed browser assets;
- the logs.

Locally, change a configuration value and rebuild.

Pass: the secret value appears nowhere scanned, each deployed stage reports exactly its committed configuration values, and the local configuration change takes effect only after the rebuild.

#### E2E-015 — Demo built from the skill
Verifies: SYS-REQ-029, SYS-REQ-030
Where: Local, cloud (milestone)
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Give a fresh AI agent only the skill, the template, and the demo specification, and have it build the demo. Record the agent's model and inputs.

Pass: the result of the last attempt meets every demo acceptance criterion. Every `FRAMEWORK-ISSUE.md` entry raised has been resolved in the skill or framework, and the build has been repeated until none remain open.

#### E2E-016 — Architecture review
Verifies: SYS-REQ-002, SYS-REQ-003, SYS-REQ-005, SYS-REQ-007
Where: Local; review: milestone
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

An automated scan of every app-facing contract (`docs/contracts/ts/` excluding `internal/`, and `framework.openapi.yaml`) finds no provider or protocol terms. The scan uses case-sensitive whole-word matching over identifiers, string literals, and comments. Its term list is kept in one file: S3, R2, D1, Aurora, Lambda, Worker, Cloudflare, AWS, Google, OIDC, OAuth, ID token, access token, issuer, Better Auth, scrypt, Email Service. A review, a milestone checklist item, then confirms three things:
- each component document has a portability note;
- no capability contract references another capability's adapter;
- no design adds features beyond its requirements.

Pass: the scan finds nothing, and the review is recorded with its findings resolved.

## Retired scenarios

A retired scenario is kept here for the record, outside any `####` heading and with no `Where:` line, so the compliance catalogue no longer expects it. Its ID is never reused (CONVENTIONS §2, §4). None is retired yet.

| Retired ID | Former scenario | Former Where | Reason or replacement |
| --- | --- | --- | --- |
