# Dual-Cloud Prototyping Framework — System Specification

This is the top-level statement of what the framework is and what it must achieve. It is deliberately short. How each part works is in the component design documents; interface shapes are in `docs/contracts/`; tunable values are in the [parameters register](../parameters/parameters.md); the reasons and origins of decisions are in the [decision log](../decisions/decision-log.md).

Read [CONVENTIONS.md](../CONVENTIONS.md) first: only identified requirements (`SYS-REQ-…`, `<AREA>-REQ-…`) and contract files are binding.

## 1. Purpose

The framework lets AI agents build small web applications — a browser client plus a server API — whose single source runs locally and deploys to both Cloudflare and AWS. Application code sees a small set of capabilities (SQL, key-value storage, files, secrets, configuration, the current user, logging) and never sees which cloud it runs on.

The applications are prototypes and personal tools: low criticality, low volume, a few simultaneous users. The framework's value is portability and safety for AI-written code, not performance or scale.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Owner | The person directing this project. The owner does not write or read code. |
| App | An application built on the framework. |
| Target | A place an app runs: `local`, `cloudflare`, or `aws`. |
| Stage | One named deployment of an app on a cloud target (for example `dev`, `test-1234`), with its own resources and configuration values. |
| Test stage | A stage explicitly marked as being for automated testing. |
| Production deployment | Any stage that is not a test stage. |
| Capability | A service the framework offers to app code (SQL, KV, files, …). |
| Adapter | The target-specific implementation of a capability. |
| App code | Code written for a specific app, as opposed to framework code. |

## 3. Requirements

### 3.1 Portability and neutrality

#### SYS-REQ-001 — One source, every target
Origin: owner · Decision: DEC-0001

The same app source MUST run locally, on Cloudflare, and on AWS without modification. Both cloud targets are mandatory for every app.

Note (informative): this is source portability. Each target has its own data; nothing is replicated, migrated, or failed over between targets.

#### SYS-REQ-002 — Cloud neutrality
Origin: owner · Decision: DEC-0001

Framework abstractions MUST NOT be shaped around one provider's services or conventions. In particular, using an emulated Cloudflare environment for local development MUST NOT make the abstractions Cloudflare-centric.

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
Origin: owner · Decision: DEC-0006

An app consists of a browser client and a server HTTP API. Browser code MUST communicate only with the app's own API and MUST NOT call cloud provider services directly. Provider credentials MUST exist only on the server side. Browser-to-API communication MUST NOT depend on cross-origin (CORS) configuration.

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
Origin: owner · Decision: DEC-0011

The framework MUST provide server-side storage of named binary files supporting the basic operations common to S3 and R2: write (whole-file create or replace), read, read metadata, delete, and list by name prefix.

#### SYS-REQ-015 — Secrets
Origin: owner-approved · Decision: DEC-0012

Server code MUST read secret values by logical name. Secret values MUST NOT be stored in the repository and MUST NOT be sent to the browser.

#### SYS-REQ-016 — Configuration
Origin: owner · Decision: DEC-0013

An app MUST declare its non-secret configuration; per-stage values are committed to the repository and fixed at deploy time, so a change takes effect on the next deployment. Configuration includes the logical names of the app's secrets and where they are located.

#### SYS-REQ-017 — Current user
Origin: owner · Decision: DEC-0014

Every request MUST be classified as anonymous, logged-in user, or admin. App code sees only that level, a stable opaque user ID, and an optional display name. App code MUST NOT see email addresses, provider identities, protocol details, or tokens; all authentication handling, including validation, happens behind the abstraction. A user ID is stable for a person and login provider; signing in through a different provider yields a different user ID.

#### SYS-REQ-018 — Admins by configuration
Origin: owner · Decision: DEC-0015

Admins MUST be designated in configuration by user ID. The framework MUST provide documented steps by which a user can see their own user ID so it can be copied into configuration.

#### SYS-REQ-019 — Login provider
Origin: owner · Decision: DEC-0016

Google MUST be supported as a real login provider. App code MUST NOT be able to tell which provider or protocol is in use, and additional providers (for example GitHub) MUST be addable behind the abstraction without app changes.

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
Origin: owner-approved · Decision: DEC-0020

A single compliance suite MUST verify each capability's contract identically on all three targets. The framework is considered working only when the suite passes on all three targets and the provider certification (SYS-REQ-027) is current.

#### SYS-REQ-027 — Provider certification
Origin: owner · Decision: DEC-0021

Each real login provider adapter MUST be certified by a guided manual test using a dedicated test account. Re-certification is required only after major restructuring of the framework or a substantive change to that adapter. All automated verification, including on cloud test stages, uses the authentication mock (SYS-REQ-020); the real provider is verified only by this certification.

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
