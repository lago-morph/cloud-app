# Component Map

This document defines the framework's components, what each is responsible for, and how their requirements depend on one another. Component codes are durable identifiers (see [CONVENTIONS.md](../CONVENTIONS.md)).

## 1. Organization

Each **capability** component (SQL, KV, FILES, …) owns its portable contract and its adapters, one per target. Each **target** component (LOCAL, CF, AWS) owns that runtime's entry points and platform constraints. Adding a target therefore means a new target component plus a new adapter in each capability, without changing app-facing capability contracts (SYS-REQ-003). It does change the few places that enumerate targets: the `./targets/<target>` subpaths (CORE-REQ-005), the `target` enumerations in the log-entry and evidence schemas, the SEC-REQ-003 storage table, and the targets COMPL-REQ-001 runs on. Release 1 has the LOCAL and CF targets; AWS is deferred (branch `aws`, DEC-0508).

**Containment rule:** components interact only through each other's published contracts.

## 2. Components

### Foundation

| Code | Name | Responsibility |
| --- | --- | --- |
| [`CORE`](../components/core.md) | App contract | The services and context shapes passed to app code; app definition; deployment identity (app, stage, target); structure of the framework error catalogue; the framework's public export list. |
| [`HTTP`](../components/http.md) | HTTP and hosting | API routing, request and response handling, the HTTP error format, request size limits, serving the browser client from the same deployment as the API, and the browser-side helper for calling the API. |

### Capabilities

| Code | Name | Responsibility |
| --- | --- | --- |
| [`SQL`](../components/sql.md) | Portable SQL | Portable schema definition, the supported query subset, and all-or-nothing writes of several rows. |
| [`MIG`](../components/migrations.md) | Migrations | Applying schema changes to deployed apps while preserving their data. |
| [`KV`](../components/kv.md) | Key-value | The KV capability. |
| [`FILES`](../components/files.md) | Files | The files capability, including the browser helper for uploading and downloading files. |
| [`CFG`](../components/config.md) | Configuration | Config declaration, per-stage values, secret names and locations. |
| [`SEC`](../components/secrets.md) | Secrets | The secrets capability. |
| [`LOG`](../components/log.md) | Log | The write-only log capability and the shared per-account log bucket. |
| [`AUTH`](../components/auth.md) | Current user | Access levels, user identity, login and logout, the login-provider interface, the auth-app provider (sign-in with Cloudflare through the account's shared auth app, DEC-0691), and the authentication mock. |
| [`PWD`](../components/password.md) | Email and password login provider | Retired in v0.2.0 (DEC-0696): sign-in is through Cloudflare (AUTH). The document is kept for the record. |
| [`MAIL`](../components/mail.md) | Outgoing email | Retired in v0.2.0 (DEC-0696): the framework sends no email. The document is kept for the record. |
| [`GOOGLE`](../components/google.md) | Google login provider | Retired (DEC-0513): not in release 1; the document is kept for the record and the code is on the branch `google`. |

### Targets

| Code | Name | Responsibility |
| --- | --- | --- |
| [`LOCAL`](../components/local.md) | Local target | Running apps locally, including the local authentication mode. |
| [`CF`](../components/cloudflare.md) | Cloudflare target | Running apps on Cloudflare. |
| [`AWS`](../components/aws.md) | AWS target | Running apps on AWS. Deferred to a later release — deferred (branch `aws`). |

### Tooling and delivery

| Code | Name | Responsibility |
| --- | --- | --- |
| [`PROV`](../components/provisioning.md) | Provisioning | Target-neutral resource declaration, per-target provisioning, deploy and remove, stage isolation, one-time setup of the shared log bucket. |
| [`SETUP`](../components/setup.md) | Cloudflare setup | The re-runnable `cloudflare-setup` command: the tokens' sources and checks, the bootstrap (the two OAuth clients, their secrets in Secrets Store, the admin app's deploy, and the bootstrap token's self-deletion), the check of the account setup record and the everyday token made in the admin app, the git warnings and the network check (DEC-0697). |
| [`CHECK`](../components/check.md) | Static checks | Portability rules for app code and the migration checker. |
| [`CLI`](../components/cli.md) | Developer commands | `dev`, the scripted pre-completion verification command (SYS-REQ-025), `build`, `deploy`, `remove`. |
| [`COMPL`](../components/compliance.md) | Compliance suite | One contract test suite run identically on all targets; evidence recording. |
| [`SKILL`](../components/skill.md) | AI skill and template | Guidance for app-building agents, the app template, the scaffolder. |
| [`DEMO`](../demo/demo-spec.md) | Demo app | The demo application, specified in `docs/demo/`. An AI agent builds it using SKILL and only the framework's public exports, which also validates SKILL. |

## 3. Dependencies

A component **depends on** another when its requirements or contract refer to the other's capability. Dependencies that exist only because of a design choice are not listed here; each component's design document lists what its implementation uses. When a component's requirements or contract change, the requirements of the components that depend on it must be re-checked.

Every app-facing component depends on CORE; that dependency is not repeated below.

| Component | Depends on | Why |
| --- | --- | --- |
| SQL, KV, CFG, LOG | — | |
| HTTP | LOG | Server errors are recorded in the log (HTTP-REQ-007). |
| FILES | HTTP | Browser uploads and downloads are authorized through the app's API (SYS-REQ-008, SYS-REQ-014). |
| MIG | SQL | Migrations change the SQL schema (SYS-REQ-012). |
| SEC | CFG | Configuration holds secret names and locations (SYS-REQ-016). |
| AUTH | HTTP, CFG | Login and logout are HTTP routes; a session's level comes from the role the account's auth app confirms through the `AUTH` service binding, at sign-in and at each role refresh (SYS-REQ-018, SYS-REQ-019). |
| LOCAL, CF, AWS | All capability components | Each target provides every capability (SYS-REQ-001). (AWS: deferred, branch `aws`.) |
| PROV | CFG, SEC, MIG, LOG, CF, AWS, HTTP, AUTH | Deployment supplies configuration and secret locations, applies migrations, and sets up the shared log bucket (SYS-REQ-012, SYS-REQ-021, SYS-REQ-023); it calls the HTTP health route and checks the login provider's prerequisites (PROV-REQ-002); on Cloudflare it binds the stage to the auth app and writes and clears the stage's return URL in the auth app's registry (plan-v0.2.0 §3). |
| SETUP | PROV, CF, CLI | Bootstraps the account's admin app with the bootstrap token, checks the account setup that the admin app does, and runs the local setup and git checks the CLI shares (SYS-REQ-022, SYS-REQ-023). |
| CHECK | SQL, MIG | Enforces SQL portability and checks migrations (SYS-REQ-011, SYS-REQ-025). |
| CLI | LOCAL, CHECK, PROV, MIG, SEC, PWD, MAIL, CORE, COMPL | Local development, the verification command, deploy and remove, migration generation, setting secrets, the real-provider check `check-login`, reading mail with `mail`, and granting the admin role with `admins` (SYS-REQ-018, SYS-REQ-022, SYS-REQ-025, SYS-REQ-027); `smoke` uses CORE's `./testing` and writes COMPL evidence (CLI-REQ-001). |
| COMPL | All capability and target components | Verifies every contract on every target (SYS-REQ-026). |
| SKILL | CORE, CLI, CFG, PROV, PWD, SETUP | Guides use of the public exports and the verification command, and documents the owner's configuration, deployment, email-domain and sign-up tasks (SYS-REQ-018, SYS-REQ-029). |
| DEMO | SKILL | Built using the skill (DEC-0054). |

The order in which components are implemented belongs to the implementation plan, not to this document (DEC-0055).
