# End-to-End Scenarios

These scenarios verify the system requirements on the assembled framework, the template, the reference app, and the demo app. Component acceptance criteria verify each contract in detail; these scenarios show the parts add up to the system specification. Each scenario names the system requirements it verifies; the reverse view is generated (CONVENTIONS §3).

Unless stated otherwise:
- framework-level scenarios run against the reference app (`apps/reference/`); E2E-002 and E2E-015 use the demo;
- cloud scenarios run on test stages, which sign in with the authentication mock only; the scenarios that name the production-check stage `prodcheck` (COMPL §2) run there instead, where there is no mock and sign-in goes through the account's auth app;
- the real sign-in is the owner's, once per release, in each scenario's `live sign-in` part (a milestone part); automated runs never sign in on Cloudflare's own page;
- locally, `dev` signs in with the mock only. A scenario part that needs the real sign-in path runs the reference app's production bundle and the auth app's Worker under local workerd, with mock-oauth2-server as the OAuth issuer and the fake Cloudflare API for `/user` and `/memberships` (plan-v0.2.0 §4.3, §7a.1.4);
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

Pass: the Cloudflare and local smoke runs pass, and no source file differs between them. (The AWS smoke run: deferred, branch `aws`.)

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

#### E2E-005 — Access levels, and nothing of the login provider exposed
Verifies: SYS-REQ-005, SYS-REQ-017, SYS-REQ-020
Where: Local, cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On each cloud test stage, and locally under `dev`, use the mock to act as anonymous, user, and admin in a browser against the reference app, exercising its protected routes. Locally, also sign in through the auth app (mock-oauth2-server as the issuer, the fake Cloudflare API for `/user` and `/memberships`) as a member with a non-administrator role and as one with an administrator role, whose identities carry an email address, and exercise the same routes over HTTP. Inspect every API response, including those of the sign-in redirects and the callback, and the app-facing types.

Pass: each level gets exactly its permitted actions, through the mock and through the auth app. No response or app-facing type exposes login-provider names, login-provider tokens, issuers, or email addresses; in particular, neither signed-in member's email address appears in any app response.

#### E2E-006 — Production deployments have no mock
Verifies: SYS-REQ-020, SYS-REQ-027
Where: Cloud
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

Redeploy the `prodcheck` stage (COMPL §2) on each cloud.

Pass: `/api/auth/mock-login` returns 404, the deployed bundle contains no mock code, and `/api/auth/login` redirects to the auth app's `/start`, carrying the app ID `<app>-prodcheck` and the return URL `<public origin>/api/auth/callback` of the stage's public origin (DEC-0667).

#### E2E-007 — Role from membership
Verifies: SYS-REQ-018
Where: Local; live sign-in: cloud (milestone)
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

A person's level comes from their membership of the owner's Cloudflare account (SYS-REQ-018 as amended by DEC-0690). Locally, with the reference app's production bundle, the auth app, mock-oauth2-server and a fake memberships API:
1. A member whose roles include no administrator role signs in through `/api/auth/login`: `/api/auth/me` shows level `user`, and an admin-only reference route answers 403 `AUTH.FORBIDDEN`.
2. A member with an administrator role (PAR-413) signs in: level `admin`, and the admin-only route answers 200.
3. With both sessions kept, the first member is promoted to an administrator role, the second is demoted, and a third signed-in member is removed from the account, all in the fake memberships API. Until the role-refresh interval (PAR-425) has passed, each session keeps its level. On the first request after it, the first is `admin`, the second `user`, and the third's session ends and the request is handled as anonymous (401 `AUTH.UNAUTHENTICATED` on a user-only route).
4. Someone with no accepted membership of the account is refused: the app's callback signs no one in.

Live sign-in (milestone, once per release; plan-v0.2.0 §7 "Live", steps 3 and 4): the owner's real sign-in to `prodcheck` (E2E-008) shows level `admin`, and, if the owner can invite one, a member with no administrator role signs in there and is shown `user`.

Pass: each step shows the level stated; a role change takes effect at the role refresh and not before, with no new sign-in, no deploy and no command; nobody outside the account gets a session.

#### E2E-008 — Sign-in through the auth app on the production stage
Verifies: SYS-REQ-019, SYS-REQ-027
Where: Cloud; live sign-in: cloud (milestone)
Origin: ai-proposed (reviewed by the owner before 2026-10-31)

On the `prodcheck` stage of each cloud, after it is redeployed, run `check-login` (DEC-0670), over HTTP only and with no Cloudflare credential:
1. `GET /api/auth/login`, sent with a forged host, redirects to the auth app's `/start` with exactly the app ID `<app>-prodcheck`, the return URL `<public origin>/api/auth/callback` taken from the deployment rather than the forged host, and a state;
2. the app's callback, given that state and a bogus code, signs no one in;
3. the auth app's `/start` accepts the redirect, which shows the return URL is registered for the app ID, and sends the browser on to Cloudflare's authorization endpoint with PKCE.

Live sign-in (milestone, once per release; plan-v0.2.0 §7 "Live", step 3): the owner follows the same redirect in a browser, signs in on Cloudflare's own login page, and lands back on `prodcheck` signed in.

Pass: on every cloud compliance run, `check-login` exits 0 and its evidence record shows E2E-008 passed; the live sign-in's latest record passed and has not been invalidated (COMPL-REQ-006).

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

On each cloud, exercise the reference app, including its route that throws a plain `Error`. Find that request's entry by its requestId in the account's log bucket, using only commands copied from the skill's troubleshooting reference. On AWS (deferred, branch `aws`, DEC-0508), repeat with the stage role denied writes to the log bucket, a stage-scoped deny that leaves the shared bucket untouched. Locally, repeat with an injected failing log writer.

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

An automated scan of every app-facing contract (`docs/contracts/ts/` excluding `internal/`, and `framework.openapi.yaml`) finds no provider or protocol terms. The scan uses case-sensitive whole-word matching over identifiers, string literals, and comments. Its term list is kept in one file: S3, R2, D1, Aurora, Lambda, Worker, Cloudflare, AWS, Google, OIDC, OAuth, ID token, access token, refresh token, PKCE, issuer, Better Auth, scrypt, Email Service, Secrets Store. A review, a milestone checklist item, then confirms three things:
- each component document has a portability note;
- no capability contract references another capability's adapter;
- no design adds features beyond its requirements.

Pass: the scan finds nothing, and the review is recorded with its findings resolved.

## Retired scenarios

A retired scenario is kept here for the record, outside any `####` heading and with no `Where:` line, so the compliance catalogue no longer expects it. Its ID is never reused (CONVENTIONS §2, §4). No scenario is retired. v0.2.0 rewrote E2E-005…E2E-008 in place for sign-in through the auth app and removed their password, mail and `admins` clauses: E2E-005's mock-only cloud run, E2E-006's test-mail route and sign-in page, E2E-007's sign-up, `mail last` and `admins grant`/`revoke` steps on `prodcheck`, and E2E-008's eight password and mail steps of `check-login` (DEC-0753, DEC-0754).

| Retired ID | Former scenario | Former Where | Reason or replacement |
| --- | --- | --- | --- |
