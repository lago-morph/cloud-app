# Dual-Cloud Prototyping Framework — System Specification

This is the top-level statement of what the framework is and what it must achieve. It is deliberately short. How each part works is in the component design documents; interface shapes are in `docs/contracts/`; tunable values are in the [parameters register](../parameters/parameters.md); the reasons and origins of decisions are in the [decision log](../decisions/decision-log.md).

Read [CONVENTIONS.md](../CONVENTIONS.md) first: only identified requirements (`SYS-REQ-…`, `<AREA>-REQ-…`) and contract files are binding.

## 1. Purpose

The framework lets AI agents build small web applications — a browser client plus a server API — whose single source runs locally and deploys to both Cloudflare and AWS. Application code sees a small set of capabilities (SQL, key-value storage, files, secrets, configuration, the current user, logging) and never sees which cloud it runs on.

Release scope (informative; DEC-0508, owner, 2026-10-24): the first release targets local and Cloudflare. The AWS target is deferred to a later release; its design and code are kept on the branch `aws`, and everything in these documents about it is marked "deferred (branch `aws`)".

Login in release 1 (informative; DEC-0509, DEC-0513, owner): the real login provider is email and password, run in the app's own deployment, with verification emails. Google sign-in is dropped from release 1; its design is kept retired in `docs/components/google.md` and its code on the branch `google`.

The applications are prototypes and personal tools: low criticality, low volume, a few simultaneous users. The framework's value is portability and safety for AI-written code, not performance or scale.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Owner | The person directing this project. The owner does not write or read code. |
| App | An application built on the framework. |
| Target | A place an app runs: `local`, `cloudflare`, or `aws` (`aws` deferred to a later release, DEC-0508). |
| Stage | One named deployment of an app on a cloud target (for example `dev`, `test-1234`), with its own resources and configuration values. |
| Test stage | A stage explicitly marked as being for automated testing. |
| Production deployment | Any stage that is not a test stage. |
| Capability | A service the framework offers to app code (SQL, KV, files, …). |
| Adapter | The target-specific implementation of a capability. |
| App code | Code written for a specific app, as opposed to framework code. |

## 3. Requirements

### 3.1 Portability and neutrality

#### SYS-REQ-001 — One source, every target
Origin: owner · Decision: DEC-0001, DEC-0508

The same app source MUST run locally, on Cloudflare, and on AWS without modification. Both cloud targets are mandatory for every app.

Amendment for release 1 (Origin: owner · Decision: DEC-0508): release 1 targets local and Cloudflare. In release 1, "every target" means local and Cloudflare, and Cloudflare is the one mandatory cloud target. AWS is a later release; this requirement's AWS clause is deferred (branch `aws`) and binds again when that release starts.

Note (informative): this is source portability. Each target has its own data; nothing is replicated, migrated, or failed over between targets.

#### SYS-REQ-002 — Cloud neutrality
Origin: owner · Decision: DEC-0001

Framework abstractions MUST NOT be shaped around one provider's services or conventions. In particular, using an emulated Cloudflare environment for local development MUST NOT make the abstractions Cloudflare-centric.

Note (informative; DEC-0508): with one cloud target in release 1 this requirement is unchanged. It is what lets the deferred AWS target return without reshaping the abstractions.

#### SYS-REQ-003 — Contained change
Origin: owner · Decision: DEC-0003

Each capability MUST sit behind its own interface, with dependencies between components declared explicitly. Adding a provider (for example Azure or GCP) or replacing a backing service MAY require refactoring an individual capability's abstraction, but MUST NOT require changes across large parts of the abstraction layer.

#### SYS-REQ-004 — Platform-blind app code
Origin: owner · Decision: DEC-0002

App code MUST use only framework capabilities and standard Web APIs. It MUST NOT import provider SDKs, read platform bindings or environment variables, or use provider-specific features.

#### SYS-REQ-005 — Application concepts only
Origin: owner · Decision: DEC-0004

Every app-facing interface MUST express application concepts and MUST NOT expose provider or protocol concepts (for example: no buckets, tokens, issuers, or provider names in app-facing types).

#### SYS-REQ-006 — Enforced, not remembered
Origin: owner · Decision: DEC-0002

AI agents are the only authors and readers of code. Every platform incompatibility MUST be absorbed by the framework, stated as a documented rule, or caught by an executable check. Portability rules MUST be enforced by automated checks that app code cannot trivially bypass. Nothing may depend on the owner remembering a platform detail.

#### SYS-REQ-007 — Simplicity over scale
Origin: owner · Decision: DEC-0005

The framework targets low-criticality, low-volume apps with a few simultaneous users. Where simplicity, portability, or abstraction conflict with performance, scale, or feature completeness, simplicity, portability, and abstraction win. Rare edge cases MAY be handled by logging them rather than engineering them away.

### 3.2 Application model

#### SYS-REQ-008 — Browser talks only to its own API
Origin: owner · Decision: DEC-0006, DEC-0058

An app consists of a browser client and a server HTTP API. App browser code MUST communicate only with the app's own API and with framework-provided browser helpers, and MUST NOT call cloud provider services directly. Provider credentials MUST exist only on the server side. A framework browser helper MAY move file content directly between the browser and storage, provided the app's server authorizes each transfer and any cross-origin configuration it needs is owned by the framework and invisible to apps.

#### SYS-REQ-009 — Capability set
Origin: owner-approved · Decision: DEC-0007

The framework MUST provide server-side app code with exactly these capabilities: SQL, KV, files, secrets, config, current user, and log; plus HTTP routing for the API and hosting of the browser client.

#### SYS-REQ-010 — Uniform error model
Origin: owner-approved · Decision: DEC-0008

Every failure that a framework interface surfaces to app code or over HTTP MUST carry a stable code from a single framework error catalogue. Codes are the contract; human-readable messages are not. Errors MUST NOT expose secret values or provider internals.

### 3.3 Capabilities

#### SYS-REQ-011 — Portable SQL
Origin: owner · Decision: DEC-0009

SQL used by app code MUST behave the same on every target, and the framework MUST enforce this so apps cannot drift toward the dialect of any one target, including the local environment. Which databases are used, and how portability is enforced, are design decisions. The supported SQL MAY be a restricted subset, provided its limits can be worked around naturally — without contortions such as special tables to emulate a missing feature.

#### SYS-REQ-012 — Schema evolution
Origin: provenance-unclear · Decision: DEC-0030

Apps MUST evolve their database schema through framework-managed migrations that are applied during deployment and preserve existing data.

#### SYS-REQ-013 — Key-value storage
Origin: owner-approved · Decision: DEC-0010, DEC-0051

The framework MUST provide key-value storage of string values, supporting get, put, delete, and listing by key prefix.

#### SYS-REQ-014 — Files
Origin: owner · Decision: DEC-0011, DEC-0058

The framework MUST provide server-side storage of named binary files supporting the basic operations common to S3 and R2: write (whole-file create or replace), read, read metadata, delete, and list by name prefix. The framework MUST also let the browser client upload and download files, such as high-resolution photos, without app-visible size limits imposed by the framework or by request-size limits of the compute platform.

#### SYS-REQ-015 — Secrets
Origin: owner-approved · Decision: DEC-0012

Server code MUST read secret values by logical name. Secret values MUST NOT be stored in the repository and MUST NOT be sent to the browser.

#### SYS-REQ-016 — Configuration
Origin: owner · Decision: DEC-0013

An app MUST declare its non-secret configuration; per-stage values are committed to the repository and fixed at deploy time, so a change takes effect on the next deployment. Configuration includes the logical names of the app's secrets and where they are located.

#### SYS-REQ-017 — Current user
Origin: owner · Decision: DEC-0014

Every request MUST be classified as anonymous, logged-in user, or admin. App code sees only that level, a stable opaque user ID, and an optional display name. App code MUST NOT see email addresses, provider identities, protocol details, or tokens; all authentication handling, including validation, happens behind the abstraction. A user ID is stable for a person and login provider; signing in through a different provider yields a different user ID.

#### SYS-REQ-018 — Admins (by role, amended; formerly by configuration)
Origin: owner · Decision: DEC-0015 (superseded), DEC-0521 (superseded), DEC-0522 (superseded), DEC-0690, DEC-0703

Admins MUST be designated in configuration by user ID. The framework MUST provide documented steps by which a user can see their own user ID so it can be copied into configuration.

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522; the operator command, its confirmation and the next-request rule: ai-proposed, DEC-0523, DEC-0524): admins are no longer designated in configuration. The text above is replaced by the following:
- Admins MUST be designated by the role `admin`, stored with the person's account in the stage's own database. The only role defined is `admin`; a new account has no roles, and there is no "user" role.
- Any account whose email address is verified MUST be level `user`, and an admin is a user whose roles include `admin`. An account whose address is not verified MUST NOT be `user` or `admin`.
- A change of roles MUST take effect on the person's next request, with no new login and no deploy.
- The framework MUST provide an operator command that grants, revokes and lists the `admin` role by email address on any stage. On a production stage the command MUST require an explicit confirmation.
- Configuration MUST NOT hold admin or user lists.

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0690; when a role change takes effect: ai-proposed, DEC-0703, pending owner approval of wording): sign-in is through Cloudflare (SYS-REQ-019 as amended by DEC-0691), and roles come from the owner's Cloudflare account. The original text and the amendment above (DEC-0521…DEC-0524) are replaced by the following:
- Anyone who is not a member of the owner's Cloudflare account MUST NOT be able to sign in.
- A member whose account role is an administrator role MUST be level `admin`. Any other member MUST be level `user`. Anyone not signed in is `anonymous`.
- The role names that count as administrator are a parameter.
- A role change in the Cloudflare account MUST take effect at the person's next sign-in, not necessarily on the next request. A role refresh MUST keep each session's level in step with the role recorded at the person's latest sign-in. The refresh interval is a parameter (DEC-0703).
- If a refresh cannot confirm the role after its retries, the person MUST be signed out. The number of retries and the delay between them are parameters.
- Configuration MUST NOT hold admin or user lists.

#### SYS-REQ-019 — Login provider
Origin: owner · Decision: DEC-0016, DEC-0509, DEC-0513, DEC-0691

Google MUST be supported as a real login provider. App code MUST NOT be able to tell which provider or protocol is in use, and additional providers (for example GitHub) MUST be addable behind the abstraction without app changes.

Amendment for release 1 (Origin: owner · Decision: DEC-0509, DEC-0511, DEC-0513): in release 1 the real login provider MUST be email and password, run by the framework itself in the app's deployment, with each email address verified before its first login. Google is not supported in release 1 (its code is kept on the branch `google`). The rest of this requirement is unchanged: app code MUST NOT be able to tell which provider is in use, and further providers MUST be addable behind the abstraction without app changes.

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0691): the original text and the release-1 amendment above are replaced by the following. The real login MUST be sign-in with Cloudflare, through the account's shared auth app, and it MUST be limited to members of the owner's Cloudflare account. Email and password login is removed. Google is not supported (DEC-0513 still holds; its code is kept on the branch `google`). Unchanged: app code MUST NOT be able to tell which provider is in use, and further providers MUST be addable behind the abstraction without app changes.

#### SYS-REQ-020 — Mockable authentication
Origin: owner · Decision: DEC-0017, DEC-0052

The authentication abstraction MUST be replaceable by a mock that reports a chosen access level, so automated tests — including end-to-end tests against deployed cloud test stages — run without a real login. The mock MAY be present only locally and in test stages; production deployments MUST NOT contain it.

#### SYS-REQ-021 — Log
Origin: owner · Decision: DEC-0018

The framework MUST provide a write-only log taking a component, a severity, and a message. The framework adds timestamps. Locally, entries go to files; on each cloud, entries go to a single log bucket per cloud account shared by all apps, which the owner reads directly with the cloud's CLI or web console. A failed log write MUST NOT fail the operation that attempted it. Logging MUST stay minimal.

### 3.4 Development, deployment, and verification

#### SYS-REQ-022 — Local development without cloud
Origin: provenance-unclear · Decision: DEC-0031

An app MUST be runnable and testable locally without any cloud account or network access to cloud services.

#### SYS-REQ-023 — Neutral provisioning
Origin: owner · Decision: DEC-0019

An app MUST declare the resources it needs in a target-neutral form; each target realizes that declaration with its own provisioning tooling, which MAY differ between targets. Deployment settings such as cloud region MUST be configuration, not hard-coded.

#### SYS-REQ-024 — Isolated stages
Origin: provenance-unclear · Decision: DEC-0032

Each stage MUST have its own app resources. Removing a stage MUST remove only that stage's resources and MUST NOT remove the shared log bucket.

#### SYS-REQ-025 — Scripted pre-completion verification
Origin: owner-approved · Decision: DEC-0033, DEC-0053

The framework MUST provide one scripted, deterministic command that an app must pass before work on it is considered done. The command runs, locally and with no network or cloud dependency: (1) type checking, (2) the portability rules, (3) the migration checker, and (4) the app's automated tests.

#### SYS-REQ-026 — Compliance on every target
Origin: owner-approved · Decision: DEC-0020, DEC-0508, DEC-0512, DEC-0692

A single compliance suite MUST verify each capability's contract identically on all three targets. The framework is considered working only when the suite passes on all three targets and the provider certification (SYS-REQ-027) is current.

Amendment for release 1 (Origin: owner · Decision: DEC-0508): release 1 targets local and Cloudflare, so in release 1 "all three targets" reads "local and Cloudflare". The framework is considered working for release 1 when the suite passes on local and Cloudflare and the provider certification is current. AWS is a later release: AWS criteria are deferred (branch `aws`), and the release report (COMPL-REQ-006) does not count them as missing.

Amendment for release 1 (Origin: owner · Decision: DEC-0512): "the provider certification (SYS-REQ-027) is current" reads "the provider check (SYS-REQ-027 as amended) passed for that commit".

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0692): "the provider check (SYS-REQ-027 as amended) passed for that commit" reads "the automated part of the provider check (SYS-REQ-027 as amended by DEC-0692) passed for that commit, and the latest once-per-release real sign-in record is current".

#### SYS-REQ-027 — Provider certification
Origin: owner · Decision: DEC-0021, DEC-0512, DEC-0692

Each real login provider adapter MUST be certified by a guided manual test using a dedicated test account. Re-certification is required only after major restructuring of the framework or a substantive change to that adapter. All automated verification, including on cloud test stages, uses the authentication mock (SYS-REQ-020); the real provider is verified only by this certification.

Amendment for release 1 (Origin: owner · Decision: DEC-0512): the guided manual certification is replaced by an automated provider check. The real login provider MUST be verified by an automated check, needing no manual step, on a production deployment with real email delivery, and that check MUST run on every compliance run on each cloud. Automated verification on cloud test stages still uses the authentication mock (SYS-REQ-020) for access levels; the provider's own behaviour is also verified locally and on test stages without real email delivery.

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0692): with sign-in through Cloudflare, a person has to sign in on Cloudflare's own login page, so a real sign-in cannot be fully automated. The original text and the release-1 amendment above are replaced by the following:
- Once per release, the owner MUST sign in for real through the auth app. This is a milestone item (COMPL-REQ-006): an occasional check that needs a person.
- Every compliance run on each cloud MUST check automatically the parts that need no person: the app sends people to the auth app's sign-in address with its own app ID and its registered return URL.
- Automated verification on cloud test stages MUST keep using the authentication mock (SYS-REQ-020).

#### SYS-REQ-028 — Evidence before claims
Origin: provenance-unclear · Decision: DEC-0034

No claim that the framework or an app works on a target may be made without recorded results of checks actually executed on that target.

#### SYS-REQ-029 — AI-guided app development
Origin: provenance-unclear · Decision: DEC-0035

The framework MUST ship guidance for AI agents (a skill) and an app template, structured so that an agent working on one task reads only the material relevant to that task.

#### SYS-REQ-030 — Demo application
Origin: owner-approved · Decision: DEC-0022

A demo app MUST exercise every capability on every target. It is specified separately in `docs/demo/`.

## 4. Scope boundaries (informative)

Not part of this version: Azure and GCP targets (but see SYS-REQ-003); access levels beyond anonymous/user/admin; linking one person's identities across login providers; sharing or moving data between targets; production operations such as backups, monitoring, and revocable sessions.

## 5. Structure and acceptance

The framework is divided into the components in the [component map](../architecture/component-map.md), which also defines how their requirements depend on one another.

Each component document carries its own requirements and acceptance criteria, deriving from and verifying the requirements above. End-to-end scenarios (`E2E-…`) in `docs/acceptance/` verify the system requirements on the assembled framework and the demo app.
