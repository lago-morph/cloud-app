# End-to-End Scenarios

These scenarios verify the system requirements on the assembled framework, the template, and the demo app. Component acceptance criteria verify each contract in detail; these scenarios show the parts add up to the system specification. Each scenario names the system requirements it verifies; the reverse view is generated (CONVENTIONS §3).

Unless stated otherwise:
- cloud scenarios run on test stages using the authentication mock;
- each scenario records an evidence record (COMPL-REQ-003).

#### E2E-001 — New app, no cloud
Verifies: SYS-REQ-022, SYS-REQ-025, SYS-REQ-029

On a machine with no cloud credentials and networking to cloud providers blocked:
1. Scaffold a new app from the template.
2. Run `dev`; use each capability through the template's pages.
3. Run `verify`.

Pass: the app works locally and `verify` passes.

#### E2E-002 — One source, both clouds
Verifies: SYS-REQ-001, SYS-REQ-023, SYS-REQ-030

From one commit:
1. Deploy the demo to a Cloudflare test stage and an AWS test stage.
2. Run the demo smoke test on each, and locally.

Pass: all three smoke runs pass, and no source file differs between them.

#### E2E-003 — Portability is enforced
Verifies: SYS-REQ-002, SYS-REQ-004, SYS-REQ-006, SYS-REQ-011, SYS-REQ-025

In a scaffolded app, introduce, one at a time:
- an AWS SDK import;
- a Cloudflare binding read;
- raw SQL;
- a right outer join;
- a SQLite-only function;
- an `any`-typed escape;
- an edited applied migration.

Pass: `verify` fails on each, naming the rule and the skill reference to read.

#### E2E-004 — Every capability on every target
Verifies: SYS-REQ-009, SYS-REQ-011, SYS-REQ-013, SYS-REQ-014, SYS-REQ-015, SYS-REQ-016, SYS-REQ-026, SYS-REQ-028

Run the full compliance suite on local, Cloudflare, and AWS for one commit.

Pass: every applicable acceptance criterion passes on every target, and each target has a valid evidence record.

#### E2E-005 — Access levels on a deployed app
Verifies: SYS-REQ-005, SYS-REQ-017, SYS-REQ-020

On each cloud test stage, use the mock to act as anonymous, user, and admin in a browser against the demo, exercising its permissions table. Inspect every API response and the app-facing types.

Pass: each level gets exactly its permitted actions. No response or app-facing type exposes login-provider names, login-provider tokens, issuers, or email addresses.

#### E2E-006 — Production deployments have no mock
Verifies: SYS-REQ-020, SYS-REQ-027

Deploy the demo as a production stage on each cloud.

Pass: `/api/auth/mock-login` returns 404, the deployed bundle contains no mock code, and `/api/auth/login` redirects to Google with the configured client.

#### E2E-007 — Becoming an admin
Verifies: SYS-REQ-016, SYS-REQ-018

Follow only the documented steps:
1. Log in to a stage.
2. Copy the user ID from the account page.
3. Add it to the admin list in configuration.
4. Redeploy.

Pass: the user is admin after the redeploy and not before.

#### E2E-008 — Real login provider certification (guided, manual)
Verifies: SYS-REQ-019, SYS-REQ-027

On a production stage of each cloud, run `certify-auth` with the owner's dedicated Google test account.

Pass: certification records `passed`. Repeated only when SYS-REQ-027 requires it.

#### E2E-009 — Large photos
Verifies: SYS-REQ-008, SYS-REQ-014

On each target, upload a 20 MB and a 100 MB photo to a demo post from a real browser, view them, and download them.

Pass: the downloads are byte-identical to the originals. App browser code made requests only to the app's API and through framework helpers. No app code or app configuration contains storage or CORS settings.

#### E2E-010 — Schema evolution with data
Verifies: SYS-REQ-012

Deploy demo version 1 and create posts with photos. Deploy version 2, which adds a column and an index and requires a SQLite table rebuild. Deploy version 2 again.

Pass: all data survives the first upgrade, and the second deploy applies nothing.

#### E2E-011 — Logs land in the shared bucket
Verifies: SYS-REQ-007, SYS-REQ-021

On each cloud, exercise the demo, including a forced failure, then read the account's log bucket with the cloud CLI. Repeat with the log bucket made temporarily unwritable.

Pass: app and framework entries appear under the app and stage prefix with timestamps. With the bucket unwritable, the demo still works.

#### E2E-012 — Stages are isolated
Verifies: SYS-REQ-024

Deploy two test stages of the demo on each cloud, with different data. Remove one.

Pass: the other stage's data and the log bucket are intact, and nothing of the removed stage remains.

#### E2E-013 — Errors are uniform and safe
Verifies: SYS-REQ-010

Against the demo on each target, send:
- invalid input;
- an unauthenticated request;
- a forbidden request;
- a request to an unknown route;
- a request triggering an internal failure.

Pass: every response is a catalogue error with the right status. None contains stack traces, provider messages, or secret values.

#### E2E-014 — Secrets and configuration discipline
Verifies: SYS-REQ-015, SYS-REQ-016

Set the demo's secret with the CLI on each cloud, deploy, and scan:
- the repository;
- the build outputs;
- the deployed browser assets;
- the logs.

Then change a configuration value and redeploy.

Pass: the secret value appears nowhere scanned, and the configuration change takes effect only after the redeploy.

#### E2E-015 — Demo built from the skill
Verifies: SYS-REQ-029, SYS-REQ-030

Give a fresh AI agent only the skill, the template, and the demo specification, and have it build the demo.

Pass: the result meets every demo acceptance criterion. Every `FRAMEWORK-ISSUE.md` entry raised has been resolved in the skill or framework, and the build has been repeated until none remain open.

#### E2E-016 — Architecture review
Verifies: SYS-REQ-002, SYS-REQ-003, SYS-REQ-005, SYS-REQ-007

An automated scan of every app-facing contract (`docs/contracts/ts/` excluding `internal/`, and `framework.openapi.yaml`) finds no provider or protocol terms: S3, R2, D1, Aurora, Lambda, Worker, Cloudflare, AWS, Google, OIDC, OAuth, ID token, access token, issuer. A review then confirms three things:
- each component document has a portability note;
- no capability contract references another capability's adapter;
- no design adds features beyond its requirements.

Pass: the scan finds nothing, and the review is recorded with its findings resolved.
