# Decision Log

Each entry records one decision, its origin (see [CONVENTIONS.md §4](../CONVENTIONS.md)), and its status. Entries are never deleted; a reversed decision gets a new entry, and the old one is marked `superseded by DEC-…`.

Statuses: `accepted` · `not-adopted` (considered or inherited, deliberately not carried forward) · `removed` (previously in scope, taken out by the owner) · `superseded`.

"Earlier spec" means the AI-assisted specification drafts of October 8–9, 2026 kept under `ai/spec/`. The owner typed none of that text, so anything inherited from it without owner confirmation is `provenance-unclear`.

Entries DEC-0001 to DEC-0029 and DEC-0036 to DEC-0050 were recorded on 2026-10-18 during the specification reorganization session, from the owner's statements in that session unless their origin says otherwise.

---

## Requirements-level decisions

### DEC-0001 — Both clouds mandatory; framework stays cloud-neutral
Origin: owner · Status: accepted · Affects: SYS-REQ-001, SYS-REQ-002

Every app runs locally, on Cloudflare, and on AWS. The purpose is to keep the framework cloud-neutral rather than conforming to Cloudflare's services and conventions, even though local development uses an emulated Cloudflare environment.

### DEC-0002 — AI-only code with built-in portability safeguards
Origin: owner · Status: accepted · Affects: SYS-REQ-004, SYS-REQ-006

Only AI agents read or write code. Built-in, executable safeguards must keep implementations close to cloud-neutral; the owner must not need to remember platform incompatibilities.

### DEC-0003 — Future providers cause contained change only
Origin: owner · Status: accepted · Affects: SYS-REQ-003

Azure and GCP are not in scope now. If they are added later, refactoring a single abstraction in a controlled way is acceptable (for example, replacing an S3-like interface that another provider does not support). Having to change large parts of the abstraction layer is what must be avoided.

### DEC-0004 — App-facing interfaces express application concepts only
Origin: owner · Status: accepted · Affects: SYS-REQ-005, SYS-REQ-017

Stated by the owner for authentication ("the abstraction should not even expose that we are using OIDC") and applied to every capability.

### DEC-0005 — Simplicity over scale
Origin: owner · Status: accepted · Affects: SYS-REQ-007, PAR-001

Target apps are not complex, low-volume, low-criticality, with no need to scale past a few simultaneous users. Abstraction and portability outrank requirements that only matter for complex or high-scale apps. Looking at logs is an acceptable alternative to making edge cases perfect. "Don't over-engineer" is a standing instruction.

The earlier spec's specific throughput figures are not adopted; the owner's qualitative statement replaces them.

### DEC-0006 — Browser calls only the app's own API
Origin: owner · Status: accepted, amended by DEC-0058 · Affects: SYS-REQ-008, SYS-REQ-014

The browser client calls services in the app's API; those services make any further calls. Cloud credentials stay in the services. "If we ever have to deal with CORS, we are doing it wrong."

Not adopted from the earlier spec: presigned URLs for direct browser-to-storage transfer, bucket CORS configuration, creation of storage credentials for URL signing, and the browser-based tests of those mechanisms. The owner described these as a derived requirement taken too far.

### DEC-0007 — Capability set
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-009

SQL, KV, files, secrets, config, current user, log, plus HTTP routing and client hosting. Config and log were added by the owner in this session.

### DEC-0008 — One error model across all interfaces
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-010

The earlier spec defined stable error codes only for HTTP. The owner directed that the error model be extended to every interface.

### DEC-0009 — SQL portability is the requirement; database choice is design
Origin: owner · Status: accepted · Affects: SYS-REQ-011

Owner's statement: SQL runs on all supported platforms, and this is enforced so the framework does not drift into something Cloudflare-centric, given that the Cloudflare emulated environment is used locally. Which databases are used and how enforcement works are design decisions delegated to the AI. A more limited SQL subset is acceptable; triggers, stored procedures, and outer joins are of no concern to the owner and may be banned.

### DEC-0010 — KV capability; SQL-backed implementation is a simplification
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-013, KV

Implementing KV as a table in the SQL database was an AI suggestion the owner agreed to as an optimization for low-volume apps. It is not a requirement; another backing store is acceptable if it meets the KV contract.

### DEC-0011 — Files abstraction uses basic S3/R2 object operations
Origin: owner · Status: accepted · Affects: SYS-REQ-014, FILES

The owner wants one abstraction that lets an app access files, not anything specific to S3. Stay with the basic operations S3 and R2 both expose. Using the S3 protocol for both clouds is an implementation simplification; a framework-defined abstraction with a small subset of S3 functionality is equally acceptable.

### DEC-0012 — Secrets by logical name; SSM SecureString on AWS
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-015, SEC

AWS secret values are stored as SSM Parameter Store SecureString parameters. Cloudflare uses Worker secrets. Local uses an ignored local file.

Not adopted from the earlier spec: AWS Secrets Manager.

### DEC-0013 — Deploy-time configuration
Origin: owner · Status: accepted · Affects: SYS-REQ-016, CFG

Non-secret configuration is declared by the app, with per-stage values committed to the repository and applied at deploy time. Configuration includes the names of secrets and where they are located. A change requires a redeploy.

Not adopted: a runtime-changeable parameter store (SSM Parameter Store / Workers KV). The owner chose not to pursue it for now.

### DEC-0014 — Current-user abstraction
Origin: owner · Status: accepted · Affects: SYS-REQ-017, AUTH

App code sees only: anonymous / logged-in user / admin, a stable opaque user ID, and an optional display name. No email. Token, issuer, expiry, and any protocol validation sit behind the abstraction; the app never checks them. Switching login provider changes a person's user ID; no account linking. Future role-based access control would be exposed as its own abstraction, not as a provider's role structure.

Not adopted from the earlier spec: exposing provider issuer and subject identifiers and optional email to app code.

### DEC-0015 — Admins listed in config by user ID
Origin: owner · Status: accepted · Affects: SYS-REQ-018, CFG, AUTH

The admin list moves from secrets to configuration and identifies admins by the same opaque user ID the app sees. Instructions must show how to find one's own ID; copy and paste is acceptable. Because configuration is deploy-time, changing admins requires a redeploy.

Not adopted from the earlier spec: an admin list stored as a secret, keyed by provider issuer and subject, with periodic refresh.

### DEC-0016 — Google first, behind a provider-neutral abstraction
Origin: owner · Status: accepted · Affects: SYS-REQ-019, AUTH, GOOGLE

The owner personally uses Google sign-in, so Google is the first real provider. The abstraction targets a generic provider interface so other sources (for example GitHub) can be added later; this is about future providers, not about handling OIDC in app logic.

Context (provenance-unclear, earlier spec): login is handled server-side partly because Google requires the client secret even when PKCE is used, and the app's session is kept independent of Google's one-hour tokens.

### DEC-0017 — Authentication mock at the abstraction layer
Origin: owner · Status: accepted · Affects: SYS-REQ-020, AUTH

Testing can replace the authentication abstraction with a mock that simply reports anonymous, user, or admin. The mock may be compiled into explicitly marked cloud test stages, never into normal builds. The implementation should be low-effort.

Not adopted from the earlier spec: a fake, always-approving OIDC provider emulating discovery, keys, authorization codes, and token exchange. The owner explicitly rejected emulating any OIDC flow.

### DEC-0018 — Minimal write-only log
Origin: owner · Status: accepted · Affects: SYS-REQ-021, LOG

Entries are (component, severity, message); timestamps are added underneath. Local writes files; each cloud account has one log bucket (S3 or R2) shared by all apps. There is no read interface; the owner reads the bucket directly with the cloud CLI or web console. The log exists for debugging and for recording failures such as being unable to reach a database. Logging must be very simple.

Not adopted: native cloud logging services, log retention or expiry rules, and per-app isolation within the shared bucket. The owner classed these as over-engineering; the owner expects only a few apps and logs holding only debugging data.

### DEC-0019 — Provisioning behind a common abstraction
Origin: owner · Status: accepted · Affects: SYS-REQ-023, PROV

The owner needs some provisioning abstraction but does not mind which tool is used, and accepts different infrastructure-as-code tools per platform as long as a common abstraction sits above them. Region and similar settings are configuration, not hard-coded.

### DEC-0020 — Compliance on all three targets defines "works"
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-026, COMPL

### DEC-0021 — Real-provider certification is a separate, rarely repeated manual test
Origin: owner · Status: accepted · Affects: SYS-REQ-027, GOOGLE

The real Google login is tested with a guided manual procedure using the owner's dedicated test account, which has no assets or permissions. It is certified independently as its own component; its interface stays simple so the certification remains valid. Manual testing happens only on major restructuring of the framework (or a substantive change to the adapter).

### DEC-0022 — Demo app has its own specification
Origin: owner · Status: accepted · Affects: SYS-REQ-030, DEMO

### DEC-0023 — TypeScript and Hono
Origin: owner-approved · Status: accepted · Affects: CORE, HTTP

AI-proposed, owner-approved.

Context (provenance-unclear, earlier spec): alternatives considered and set aside included other languages (Python judged less mature on Workers; Java unable to run on Workers) and other frameworks or platforms (Nitric, Supabase, PocketBase, Nitro).

### DEC-0024 — Queue capability removed
Origin: owner · Status: removed · Affects: SYS-REQ-009

The queue capability and everything that existed only to support it are removed completely. Do not implement it; reintroduction requires a new owner decision.

### DEC-0025 — Inbound webhook processing removed
Origin: owner · Status: removed

Processing inbound webhooks from outside services (for example, a trigger on a GitHub event) is a secondary owner requirement that is not being implemented now. It is deliberately absent from all specifications, designs, and contracts. Do not implement it or reference it in any document; reintroduction requires a new owner decision.

### DEC-0026 — No direct script or token authentication
Origin: owner · Status: not-adopted · Affects: AUTH

The earlier spec let scripts authenticate to the API by presenting provider tokens. The owner never asked for this and sees no need for scripts to call the API directly.

### DEC-0027 — Three access levels
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-017

Anonymous, user, admin. A simplification so the first implementation is not bogged down by features that may never be needed.

### DEC-0028 — Stateless sessions without revocation
Origin: owner-approved · Status: accepted · Affects: AUTH

A simplification for the first implementation. A copied valid session remains usable until it expires, even after logout.

### DEC-0029 — Documentation organization
Origin: owner-approved · Status: accepted · Affects: all documents

AI-proposed; the owner accepted the recommendations. A short system specification; one design document per component (capabilities contain per-target adapter sections); contract formats by interface kind (OpenAPI 3.1, JSON Schema, `.d.ts`); durable identifiers; one-directional child-to-parent traceability with generated reverse views; per-component acceptance criteria plus end-to-end scenarios mapped to system requirements; an explicit component dependency map; the framework's public export list as a contract; a decision log with origin tags. The owner explicitly asked for durable identifiers and explicit dependencies, and for asides never to become rules (see [CONVENTIONS.md §1](../CONVENTIONS.md)). Three parameter categories (owner, platform, ai-proposed) were confirmed by the owner, with the instruction not to overcomplicate them.

---

## Inherited requirements (provenance unclear)

These come from the earlier spec and have not been confirmed by the owner. They are kept because they appear necessary for the system to be usable. Any may be revised with a decision-log entry.

### DEC-0030 — Data-preserving migrations applied at deploy
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-012, MIG

Destructive migration procedures and zero-downtime upgrades were out of scope in the earlier spec.

### DEC-0031 — Local development needs no cloud account
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-022, LOCAL

### DEC-0032 — Isolated stages; removal touches only the stage
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-024, PROV

The shared log bucket exception follows from DEC-0018.

### DEC-0033 — One local check command as an app's definition of done
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-025, CHECK, CLI

### DEC-0034 — Evidence before claims
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-028, COMPL

The earlier spec required a recorded evidence file and forbade treating listening ports, resource lists, zero-test runs, or local results as proof of cloud behavior.

### DEC-0035 — AI skill and app template
Origin: provenance-unclear · Status: accepted · Affects: SYS-REQ-029, SKILL

The earlier spec defined four deliverables: framework package, compliance suite, AI skill with template, and demo app. It also gave a layered skill structure (router, capability references, complete examples, scaffolded templates) with size budgets (now PAR-070 to PAR-072), and a rule that an app-building agent finding a framework defect writes a reproducible issue report (`FRAMEWORK-ISSUE.md`) instead of working around the framework. The earlier spec also stated that those app-agent stop rules do not constrain the agent implementing the framework itself.

---

## Design decisions

### DEC-0036 — SST as the provisioning tool
Origin: owner-approved · Status: accepted · Affects: PROV

The owner chose not to decide which tool is used (DEC-0019) and accepted the AI recommendation.

Context (provenance-unclear, earlier spec): Terraform was considered viable; SST was chosen because one TypeScript template covers both providers. The earlier spec noted a risk that SST development had slowed, with raw Pulumi as the fallback.

### DEC-0037 — Aurora Serverless v2 PostgreSQL via the Data API on AWS
Origin: owner-approved · Status: accepted · Affects: SQL, AWS

The owner chose not to decide which databases are used (DEC-0009) and accepted the AI recommendation, which was made to meet the owner's requirements: Lambdas stay outside a VPC, so no NAT gateway is needed, and idle compute can pause. Concrete settings come from the SQL and AWS component designs.

Context (provenance-unclear, earlier spec): rejected alternatives were Aurora DSQL (migration tooling conflicts with its one-DDL-per-transaction rule), plain RDS (needs VPC Lambdas and NAT), and MySQL.

### DEC-0038 — D1 on Cloudflare; Drizzle ORM for both dialects
Origin: provenance-unclear · Status: accepted · Affects: SQL, MIG, CF

### DEC-0039 — Local target uses the Cloudflare stack
Origin: derived · Status: accepted · Affects: LOCAL

Follows from using the emulated Cloudflare environment for local development. AWS adapters are therefore not exercised locally. Postgres-dialect behavior is checked locally with PGlite (provenance-unclear). Neither replaces cloud verification.

Context (provenance-unclear, earlier spec): an exact match between local and cloud behavior was explicitly not required.

### DEC-0040 — One origin for browser client and API
Origin: ai-proposed · Status: accepted · Affects: HTTP, CF, AWS

The browser page and the API are served from the same address, so app code never deals with CORS (DEC-0006). Cross-origin configuration needed by the framework's file transfer helper is framework-internal (DEC-0058).

### DEC-0041 — SQL subset details
Origin: owner-approved · Status: accepted · Affects: SQL, CHECK

AI-proposed, owner-approved:
- Left joins are kept, because they are portable and commonly needed.
- Right and full outer joins, triggers, stored procedures, and views are not supported.
- The framework fixes where NULLs sort, because SQLite and Postgres differ.
- Case-insensitive text search folds only A–Z, because the databases fold accented letters differently.

The owner accepted these restrictions on the condition that each can be worked around naturally. For example, an app needing accent-aware search can store a lowercased copy of the text in an extra column.

### DEC-0042 — Atomic multi-write helper
Origin: provenance-unclear · Status: accepted · Affects: SQL

D1 does not offer interactive transactions, so a request that must write several rows all-or-nothing uses a framework helper that submits them as one atomic unit on every target.

### DEC-0043 — Type-safety bans in app code
Origin: ai-proposed · Status: accepted · Affects: CHECK

Using `any`, unchecked type assertions, and error-suppression comments is disallowed in app code. This is how SYS-REQ-006 keeps an agent from silencing a portability error. It is a provisional means, not a requirement in itself.

### DEC-0044 — Public Lambda Function URL behind the AWS router
Origin: ai-proposed · Status: accepted · Affects: AWS

The AWS API Lambda's Function URL accepts requests directly as well as through the CDN router. All authentication and authorization run inside the app, so bypassing the router skips only CDN-level features. The alternative, router-signed requests, breaks browser request bodies unless the client sends a body hash.

### DEC-0045 — Region, engine version, and timing values are parameters
Origin: owner · Status: accepted · Affects: PAR-060, PAR-110

The default region is a configurable setting, not hard-coded. The Aurora engine version is grouped with the other dependency pins. Timeouts and similar values are chosen in component designs and recorded as parameters only when a design uses them (DEC-0057).

### DEC-0046 — Old specification files are non-authoritative and temporary
Origin: owner · Status: accepted

The files under `ai/spec/` are kept until the owner's separate review, then deleted; they remain in git history. They are not a source of requirements. The one-shot implementation prompt will not be used. A new one will be written after the specification and design documents are reorganized.

### DEC-0047 — Where implementing-agent instructions are recorded
Origin: owner · Status: superseded by DEC-0056

Non-obvious working rules for implementing agents go in `docs/guidance/implementing-agents.md` (since removed), linked from the repository's `CLAUDE.md` so agents see it. Rules clearly based on owner statements are recorded in this log. Where provenance is unclear, the item is recorded with that marking. The guidance document was populated from the earlier one-shot prompt, so most of its rules are `provenance-unclear`.

### DEC-0048 — Single framework package with subpath exports; export list is a contract
Origin: owner-approved · Status: accepted · Affects: CORE

Subpath exports keep runtime, provisioning, and tooling code separate, so cloud bundles do not include infrastructure or development dependencies. The owner agreed the public export list is a contract.

### DEC-0049 — Repository layout and package distribution
Origin: provenance-unclear · Status: accepted · Affects: CORE, CLI, SKILL

One npm-workspace repository containing the framework package, the template, the demo, the compliance reference app, the skill, and orchestration scripts. Proposed package name `@lago-morph/prototype-framework`, initial version `0.1.0`. Installation is verified from an `npm pack` tarball rather than by publishing to a registry.

### DEC-0050 — Platform behavior observations from earlier work are unverified
Origin: provenance-unclear · Status: accepted

The earlier spec recorded probe observations: local D1 table rebuilds, Data API transaction handling in Drizzle, drizzle-kit's remote D1 migration path, and text-folding and integer-range differences between SQLite and Postgres. The raw evidence was lost. Component designs may use these observations as hypotheses to test early, never as verified facts.

---

## Owner review of stage 1 (2026-10-18)

### DEC-0051 — KV stores strings and has no expiry
Origin: owner · Status: accepted · Affects: SYS-REQ-013, KV

KV values are strings; an app that needs structure converts to and from text itself. Entries do not expire.

Not adopted from the earlier spec: JSON values and optional time-to-live on entries.

### DEC-0052 — Authentication mock scope; "production deployment"
Origin: owner · Status: accepted · Affects: SYS-REQ-020, SYS-REQ-027, AUTH

The owner expects automated end-to-end tests against apps deployed on cloud providers. Those tests run on test stages and use the authentication mock. A "production deployment" is any stage not marked as a test stage, and it never contains the mock. Fully automated tests that log in therefore cannot run against a production deployment. The real provider is covered by its certification (DEC-0021).

### DEC-0053 — Pre-completion verification is one scripted, deterministic command
Origin: owner-approved · Status: accepted · Affects: SYS-REQ-025, CHECK, CLI

After an explanation from the AI, the owner kept SYS-REQ-025 and asked that it be worded as one scripted, deterministic command. The command runs type checking, the portability rules, the migration checker, and the app's automated tests. This command is how SYS-REQ-006 is enforced on app-building agents: the skill requires them to pass it before finishing. It proves nothing about cloud behavior.

### DEC-0054 — The demo is built with the skill
Origin: owner · Status: accepted · Affects: DEMO, SKILL, SYS-REQ-030

An AI agent builds the demo app using the skill and only the framework's public exports, so building the demo also validates the skill. Consequences:
- The demo specification is written as app requirements, not implementation steps.
- The skill's examples come from the app template and the compliance reference app, never from the demo, which avoids a circular dependency.
- Gaps found while building the demo are fixed in the skill or the framework, not worked around in the demo.

### DEC-0055 — Spec-level dependencies only; implementation order belongs to the plan
Origin: owner · Status: accepted · Affects: component map, guidance

The specification records only spec-level dependencies: component A depends on B when A's requirements or contract refer to B's capability. Its purpose is impact analysis under SYS-REQ-003. Dependencies that exist only because of a design choice are listed in each component design document's "Uses" section. The order of implementation is decided in a separate implementation plan, not in the specification. The containment rule (components interact only through published contracts) is stated separately from the dependency table.

### DEC-0056 — Implementing-agent guidance file removed
Origin: owner · Status: accepted · Supersedes: DEC-0047

The owner reviewed `docs/guidance/implementing-agents.md` and found most of it generic agent discipline, which current models already follow and which isn't specific to this project. It came from the earlier AI-written one-shot prompt and spec (provenance-unclear). The file was removed.

Specific findings:
- "Work in the existing checkout; no extra worktrees" was a misapplied copy of an earlier-spec rule about the app template and skill. The owner likes worktrees, and feature branches prevent conflicts with the owner's work. The rule is not adopted.
- "Do not broaden scope after checks pass" was too vague to act on. It is not adopted.
- "App-agent rules do not bind framework implementers" belongs in the SKILL design, if anywhere.

The rules that are project-specific are kept elsewhere:
- `docs/` is authoritative: `CLAUDE.md` and DEC-0046.
- Earlier observations are unverified: DEC-0050.
- Evidence before claims: SYS-REQ-028.
- No destructive drop-and-recreate in place of a migration: the MIG design.
- Commit and push frequently: the repository's agent instructions file.

### DEC-0057 — Parameters register trimmed; spec does not reference concrete values
Origin: owner · Status: accepted · Affects: parameters register, CONVENTIONS §5

The owner judged most register entries to be noise. The register keeps only:
- the general design load (PAR-001)
- the default AWS region (PAR-060)
- the AI skill size budgets
- the dependency pins

The removed values were AI-proposed detail: HTTP, KV, files, secrets, authentication, AWS capacity and timing, and test tolerance. They may return only when a component design or contract actually uses them. Spec-level requirements and decisions do not reference concrete parameter values. For example, the session lifetime under DEC-0028 is an AUTH design detail the owner has no preference about, and Aurora settings come from the SQL and AWS designs.

### DEC-0058 — Large files move directly between browser and storage, inside the framework
Origin: owner · Status: accepted · Affects: SYS-REQ-008, SYS-REQ-014, FILES, HTTP

The owner's first planned app uploads high-resolution photos (most about 4 MB), and the owner does not want arbitrary file size limits. The AWS Lambda request limit (about 6 MB, less for binary bodies) rules out passing large files through the API. Chunking through the API was rejected: S3's minimum multipart part size exceeds what one Lambda request can carry. Queue-based approaches were rejected because their own limits are smaller.

The framework's browser-side file helper therefore moves file content directly between the browser and storage. Each transfer is authorized by the app's server, for example through short-lived signed access. App code calls only the framework helper and never sees storage services, signing, or cross-origin (CORS) configuration. The framework owns all of that. This amends DEC-0006. The principle that app code talks only to the app's own services still holds at the level of app code, but not at the level of network traffic.

---

## Component design decisions (stage 2, 2026-10-19)

These were made by the AI while writing the component designs, after the owner approved stages 2 and 3. Each may be changed by an implementer with a new entry.

### DEC-0059 — Zod for request validation
Origin: ai-proposed · Status: accepted · Affects: HTTP, PAR-112

Zod is re-exported at the framework's pinned version, so apps use exactly one validation library and AI agents know it well.

### DEC-0060 — SQL type set and result-size limit
Origin: ai-proposed · Status: accepted · Affects: SQL, PAR-215

There is no JSON column type; structured data is stored as text. `sum` and `avg` are supported, normalized to JS numbers: excluding them would force unnatural workarounds (SYS-REQ-011). A portable result-size limit, enforced on every target, keeps queries that work locally from failing only on AWS, where Data API responses are capped.

### DEC-0061 — Data API credentials live in AWS Secrets Manager
Origin: ai-proposed · Status: accepted · Affects: SQL, SEC, AWS

The RDS Data API only accepts database credentials stored in Secrets Manager. That one framework-internal secret is the exception to DEC-0012; app secrets and the other framework-internal secrets use SSM SecureString.

### DEC-0062 — File transfer mechanism
Origin: ai-proposed · Status: accepted · Affects: FILES, PAR-234

Browser transfers implement DEC-0058:
- **Single-request transfers.** One signed `PUT` or `GET` per transfer. A single upload reaches the platform maximum (PAR-234) on both clouds, so multipart uploads are not needed for photos. A signed URL may carry the temporary credential's key ID and session token, but never a signing secret.
- **Cloudflare.** Server-side operations use the R2 binding. Signed URLs use R2's S3-compatible endpoint with a stage-scoped R2 token, because the binding cannot sign.
- **Local.** Transfers use a same-origin framework route instead of Wrangler's experimental S3 endpoint.

### DEC-0063 — Configuration delivery
Origin: ai-proposed · Status: accepted · Affects: CFG

Values live in `config/<target>/<stage>.json`. Committed values are embedded in the build. Values known only after provisioning reach the runtime through Worker variables or Lambda environment variables, and only framework adapters read them.

### DEC-0064 — Secret locations and framework-internal secrets
Origin: ai-proposed · Status: accepted · Affects: SEC

Secret locations follow a convention per target (SEC-REQ-003). Framework-internal secrets use the reserved `framework` prefix and are created by the CLI or provisioning.

### DEC-0065 — Migration mechanics
Origin: ai-proposed · Status: superseded by DEC-0076 · Affects: MIG

The mechanics are:
- paired drizzle-kit histories, one per dialect;
- a ledger with checksums, plus a lock row;
- readiness based on the latest migration ID embedded in the build.

The atomic remote mechanism on Cloudflare is open (MIG-OQ-1). Candidates are the D1 HTTP batch API or a deploy-only migration route in the Worker.

### DEC-0066 — Log storage details
Origin: ai-proposed · Status: accepted · Affects: LOG

- **Entries** include the request ID when there is one, so they can be matched to error responses.
- **Local.** Worker code cannot write files under workerd, so entries are printed as marked lines and the CLI appends them to `.logs/`.
- **Cloud.** One object per entry, under an app/stage/date key layout. The shared buckets are `prototype-logs-<account-id>` on AWS and `prototype-logs` on Cloudflare.

### DEC-0067 — Authentication mechanics
Origin: ai-proposed · Status: accepted · Affects: AUTH, GOOGLE

- **User ID.** The user ID is a truncated hash of provider name and subject, so it is the same across stages and targets.
- **Session key.** There is one session signing key per stage; rotating it logs everyone out.
- **Provider per deployment.** Production deployments use Google; local development and test stages use the mock.
- **Google scopes.** Google requests only `openid profile`, because email is never used.

### DEC-0068 — App code cannot see target or test-stage flag
Origin: ai-proposed · Status: accepted · Affects: CORE

`c.var.deployment` exposes only app and stage. Exposing the target or the test-stage flag would let app code behave differently per cloud or under test. That would undermine SYS-REQ-004 and the value of testing on test stages.

### DEC-0069 — Package subpaths and command names
Origin: ai-proposed · Status: accepted · Affects: CORE, CLI, SKILL

Subpaths are `.`, `./client`, `./testing`, `./targets/*`, `./provision`, and `./check`. The scripted pre-completion verification command is named `verify`.

### DEC-0070 — Compliance suite shape
Origin: provenance-unclear · Status: accepted · Affects: COMPL

The suite consists of:
- a reference app and a shared HTTP test driver;
- Playwright for browser-level checks;
- tests tagged with acceptance-criterion IDs and a generated traceability report;
- disposable test stages named with the run ID, plus a production-stage check on each cloud.

### DEC-0071 — Demo theme: photo board
Origin: ai-proposed · Status: accepted · Affects: DEMO

The demo is a shared photo board, matching the owner's first planned app (high-resolution photo uploads). It replaces the earlier spec's notes board. The demo specification states app requirements only.

### DEC-0072 — Request-forgery protection without a token
Origin: ai-proposed · Status: accepted · Affects: AUTH, HTTP

A review found the earlier design layered three defenses: an Origin check, an HMAC token, and SameSite=Lax cookies. For a few-user app, the Origin check plus SameSite=Lax cookies is sufficient. Dropping the token removes:
- a header contract;
- a token in the `/api/auth/me` response;
- an extra round trip;
- a CloudFront forwarding rule.

The mock-login route became a POST so no framework GET changes state.

### DEC-0073 — No custom domains in this version
Origin: ai-proposed · Status: accepted · Affects: CFG, CF, AWS

Each stage's public origin is its generated URL (`workers.dev` on Cloudflare, the CloudFront domain on AWS). Supporting custom domains would require DNS and certificate provisioning that no requirement asks for.

### DEC-0074 — One shared database network per AWS account and region
Origin: ai-proposed · Status: accepted · Affects: PROV, AWS

AWS allows 5 VPCs per region by default. One VPC per stage would cap the number of stages, including disposable test stages. `setup-account` therefore creates one VPC, with no NAT gateway and no bastion host, for all stages' Aurora clusters. Like the log bucket, it is never removed by stage removal.

### DEC-0075 — AWS region is an account setting, not stage configuration
Origin: owner · Status: accepted · Affects: CFG, PROV, AWS, PAR-060

The `framework.aws` section is removed from per-stage configuration. The shared log bucket and the shared database network exist per account and region (DEC-0066, DEC-0074), so every stage must use the account's region. `setup-account` chooses the region (default PAR-060) and records it, and deploys use that recorded value. This satisfies DEC-0045: the region stays configurable and is not hard-coded.

### DEC-0076 — Schema changes replace the database, with downtime
Origin: owner · Status: accepted, amended by DEC-0078 and DEC-0079 · Supersedes: DEC-0065 · Affects: MIG, PROV, SQL, KV

These apps have one or a few users, little data, low usage, and low consequences for downtime. A cloud deploy with pending migrations therefore:
1. stops the app (deleting the Worker, or setting the Lambda's concurrency to zero);
2. copies the database into a new one;
3. applies the migrations to the copy;
4. checks it;
5. deletes the old database as soon as the check passes; no databases are left behind;
6. deploys the new version against the new database.

On failure the new database is deleted, the old one is left unchanged, and the app stays down until a deploy succeeds.

This removes several earlier pieces:
- atomic migration of a live database (MIG-OQ-1);
- special handling of table rebuilds;
- the schema-readiness check, together with `SQL.SCHEMA_NOT_READY` and PAR-211;
- the migration lock.

Local development keeps applying migrations in place.

The owner's instruction for this area: keep it simple, and do not design for high volume, large data, many users, or critical availability.

### DEC-0077 — Changes from the persona review panel
Origin: ai-proposed · Status: accepted · Affects: most component documents, contracts, parameters, scenarios

An eight-persona review panel produced 97 findings, debated them, and the panel chair consolidated them into 38 recommendations. The personas were security, AI usability, debugging, simplicity, portability, implementability, testability, and a gap check against the earlier spec. Of the recommendations, 33 were applied, 4 await the owner, and 1 was rejected. "Retired IDs" lines in the affected documents refer to this entry. The main changes:

**Deploy and migrations**
- One deploy sequence, consistent with MIG-REQ-006:
  - The CLI owns the app databases.
  - The lowest-numbered existing database is the current one; any higher-numbered leftovers are deleted.
  - The app is restarted explicitly on every deploy, followed by a health check (`/api/__framework/health`) and a check of the storage cross-origin settings.
- A closed list of supported schema changes: no type changes and no renames. Instead, add a new column, copy the values in app code, and drop the old one. Each D1 migration is sent as one batch.
- Databases are copied with each platform's native whole-database copy. Postgres databases are created with C collation.

**Resource names and removal**
- App names contain no hyphens. Resources are referred to by their exact identifiers, never by wildcards.
- The account must own its shared resources; a squatted log bucket is refused.
- Provisioning state and the account's region are kept in the cloud account, not only on the owner's machine.
- An explicit list of removal steps, so `remove` leaves nothing behind.

**Errors and logs**
- The `component` field and `FILES.TICKET_EXPIRED` are removed from the error catalogue, and `retryable` is defined.
- `HTTP.CONFLICT` is added. `HTTP.NETWORK_ERROR` now also covers responses that did not come from the app.
- Every response with status 500 or higher writes exactly one log entry.
- Rules on what log entries must never contain.
- A log key layout that can be searched by severity and request ID.

**Testing**
- `connectTestStage` and the `smoke` command let apps run their smoke tests against deployed test stages.
- `TestApp.logs()` and capability fault injection in tests.
- The SQL dialect is fixed per test process.
- A test-only stub login provider, used to test the real-provider code paths locally.

**Contracts**
- Settled typing for the SQL contract, with a narrowed user type after `requireUser`.
- Normative code layout (browser, server, shared, and test folders).
- Server code is type-checked against Web APIs only; `node:` imports are rejected.

**Verification**
- "Works" has two tiers: automated checks for every commit, plus milestone checks that are invalidated by events, never by a clock.
- One long-lived `prodcheck` stage per cloud.
- Evidence statuses are reduced to passed, failed, blocked, and not-run.
- Framework scenarios run against the reference app, not the AI-built demo.

**Removals and smaller fixes**
- The AWS secret cache (PAR-240) is removed.
- A troubleshooting guide for the owner, covering idle costs.
- The verify-script check, which could not work, is dropped.
- Control characters are banned in file names.
- The packaged-install check is added to E2E-001.
- A format for `FRAMEWORK-ISSUE.md` entries, and what the app agent does next.

Pending owner decisions:
- R-1: how to stop the app on Cloudflare without deleting the Worker and its secrets.
- R-2: restart the old app after a failed migration.
- R-3: optionally limit which logins count as users.
- R-4: identify test stages by a name prefix.

### DEC-0078 — Stopping the app on Cloudflare: turn its public address off and on
Origin: owner · Status: accepted · Amends: DEC-0076 · Affects: MIG, PROV, CF

The panel found that deleting the Worker to stop the app (DEC-0076, step 1) also deletes its secrets. The owner chose to stop a Cloudflare app by turning off the stage Worker's public address and turning it back on when the deploy finishes. The Worker itself is never deleted, so its secrets and bindings survive. AWS still stops by setting the Lambda's concurrency to zero. In both cases the CLI explicitly restarts the app; it does not rely on the provisioning tool to undo the stop.

### DEC-0079 — A failed schema-changing deploy restarts the old app
Origin: owner · Status: accepted · Amends: DEC-0076 · Affects: MIG, PROV

If a migration or check fails, the new database is deleted and the old database is left unchanged, as before. The CLI now restarts the previous version against that database and the deploy exits with failure status. The app is no longer left down until a deploy succeeds.

### DEC-0080 — Optional list of allowed users
Origin: owner · Status: accepted · Affects: SYS-REQ-017 (refinement), AUTH, CFG, SKILL, DEMO

Without a list, level `user` means any account the login provider accepts. The configuration may include an optional `framework.users` list of user IDs. When the list is present, a validated login whose ID is in neither `framework.users` nor `framework.admins` is treated as anonymous. The steps for finding and copying a user ID are the same as for admins.

### DEC-0081 — Test stages are identified by name
Origin: owner · Status: accepted · Supersedes: the `--test` flag and `framework.testStage` (PROV-REQ-005) · Affects: PROV, CFG, CLI, COMPL, AUTH

A stage is a test stage exactly when its name starts with `test-`. Test stages use `config/<target>/test.json`; every other stage is a production deployment and needs its own committed values file. The `deploy --test` flag and the `framework.testStage` setting are removed. Run-ID test stage names include enough randomness that they cannot be guessed. The optional per-stage mock-login key was not adopted.

### DEC-0082 — Old specification files deleted; first implementation phase is local and Cloudflare
Origin: owner · Status: accepted · Affects: DEC-0046, implementation planning

After the owner's review (DEC-0046), the superseded files under `ai/spec/` were deleted; they remain in git history. The owner asked for a one-shot implementation prompt covering the local and Cloudflare targets: `ai/prompts/implement-local-cloudflare.md`. AWS is implemented in a later phase. This changes the order of work only. SYS-REQ-001 (both clouds mandatory) still holds, so the framework cannot be declared working (COMPL-REQ-006) until the AWS phase passes.

---

## Implementation phase: local and Cloudflare — phase A spikes (2026-10-19)

These were recorded by AI spikes A-01…A-10 of `ai/implementation/plan.md` and integrated by item A-INT. Evidence is under `ai/implementation/spikes/<item>/`. All are `ai-proposed`; where an entry says it was taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue", it is open for owner review. Those entries (DEC-0086, DEC-0091, DEC-0096, DEC-0103, DEC-0107, DEC-0108, DEC-0109) show `owner review open` in their status line, and DEC-0101 `owner decision outstanding` (corrected by B-INT after evaluation A-EV). The smaller choices embedded in DEC-0087 (optional `keepBindings` guard), DEC-0090 (30 s poll bound), DEC-0094 (no size parameter), DEC-0099 (`maxAgeSeconds` 60), DEC-0100 (one token per stage) and DEC-0102 (no PGlite pre-check) are routine design choices (prompt §5), not owner-review items.

### DEC-0083 — Cloudflare tool authentication in the sandbox: placeholder token replaced by the proxy
Origin: ai-proposed · Status: accepted · Affects: PROV §2 "Credentials", cloudflare.md §2, CLI cloud commands (D-03, D-05), every cloud run, plan §10.6

wrangler (PAR-101) and SST/Pulumi (PAR-100, PAR-108) authenticate in this sandbox when `CLOUDFLARE_API_TOKEN` is set to a non-empty, non-secret placeholder (the spike used the literal `proxy-injected`): the proxy replaces the tool's `Authorization` header with the injected token for `api.cloudflare.com`. With the variable unset or empty, wrangler reports "not authenticated" and SST stops with "Cloudflare API not initialized". Exact environment:
- wrangler: `CLOUDFLARE_API_TOKEN=<placeholder>`, `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` (required: without it wrangler fails with a certificate mismatch / "fetch failed"), `HTTPS_PROXY` (wrangler uses it on its own; `NODE_USE_ENV_PROXY` is not needed).
- SST: `CLOUDFLARE_API_TOKEN=<placeholder>`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID`, `SST_STAGE` (or `--stage`), `HTTPS_PROXY`; `NODE_EXTRA_CA_CERTS`/`NODE_USE_ENV_PROXY` not needed (system trust store holds the proxy CA).
- The token is an Account API token, so account IDs are always passed explicitly.
The framework's preflight (PROV §2 "Credentials") keeps checking `CLOUDFLARE_API_TOKEN` by name only; in this sandbox the placeholder satisfies it. The placeholder is not a credential and must never be replaced by a real token in sandbox runs. On an owner machine the real token goes in the same variable.
Evidence: `ai/implementation/spikes/a-01/RESULT.md`, logs `w01`–`w15`, `s03`–`s07`. Fallback: none needed.

### DEC-0084 — SST state home on Cloudflare is the R2 bucket `sst-state`; stage state objects outlive `sst remove`
Origin: ai-proposed · Status: accepted · Affects: PROV §2 "State home", "Removal"; cloudflare.md "Deploy mechanics" (`setupAccount`, `remove`); PROV-AC-004; D-03

With `home: "cloudflare"`, SST 4.17.2 creates the account-wide R2 bucket `sst-state` (name fixed by SST) and keeps `app/`, `passphrase/`, `snapshot/`, `eventlog/`, `update/` objects under `<app>/<stage>` there, accessed through `api.cloudflare.com` (works with the injected token, no R2 S3 credentials). `setupAccount` therefore creates/confirms `sst-state` as the state home. `sst remove` leaves the stage's state objects (including its passphrase); the Cloudflare `remove` deletes the objects under `*/<app>/<stage>` itself (R2 object DELETE via the Cloudflare API) and never deletes the bucket (shared, PROV §2).
Evidence: `ai/implementation/spikes/a-01/RESULT.md` "State home". Fallback: none needed.

### DEC-0085 — Stage `workers.dev` addresses are reachable from the sandbox; client settings for cloud runs
Origin: ai-proposed · Status: accepted · Affects: cloudflare.md §2 (public origin), every cloud run (D-03, D-05, cloud ACs and Playwright compliance runs), plan §10.6, prompt §10

A Worker deployed with wrangler 4.149.0 (`workers_dev: true`) is reachable at `https://<worker>.<account subdomain>.workers.dev` from this sandbox, through the proxy, with no extra credentials:
- curl with sandbox defaults: 200 (CONNECT tunnel 200; the real Let's Encrypt certificate is presented).
- Node 22 `fetch` with `NODE_USE_ENV_PROXY=1`: 200 (also in a minimal environment without `NODE_EXTRA_CA_CERTS`). Cloud test clients using Node `fetch` set `NODE_USE_ENV_PROXY=1`; without it Node bypasses `HTTPS_PROXY` and only works because a transparent egress gateway intercepts direct traffic, which is not relied on.
- Playwright 1.64.1 Chromium: 200 for navigation and in-page `fetch`, with or without the `proxy` launch option; no browser proxy configuration is needed.
The first request ~1 s after `wrangler deploy` returned already succeeded, so no wait after deploy is required for reachability (on/off propagation is A-04's question). The earlier refusal mentioned in prompt §10 is explained: a made-up *account subdomain* does not resolve and the gateway answers 502 to CONNECT; a made-up Worker name on the real account subdomain returns Cloudflare's 404 through an open tunnel.
Evidence: `ai/implementation/spikes/a-02/RESULT.md`, logs `c02`, `c03`, `n01`, `n02`, `p01`. Fallback: none needed (plan fallback was "report the refused host to the owner").

### DEC-0086 — The account's `workers.dev` subdomain is already registered
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: cloudflare.md §2 (`setupAccount`), D-03/D-05

`GET /accounts/{account}/workers/subdomain` returns `success: true` with a subdomain set, so on this account `setup-account --target cloudflare` only reads and records it (the "register if none" branch is not exercised here and is tested only by unit tests with a fake API). The subdomain value contains the owner's name; it is not written into committed docs or evidence (it is computed/recorded at runtime by `setup-account`), and spike logs redact it.
Assumption (taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review): treating the subdomain as non-secret but personal — redacted in committed artefacts, not a credential.
Evidence: `ai/implementation/spikes/a-02/logs/c01-subdomain-get.txt`. Fallback: none needed.

### DEC-0087 — SST/Pulumi Worker updates keep secrets set through the Cloudflare API; no second copy, no extra mechanism
Origin: ai-proposed · Status: accepted · Affects: cloudflare.md "Deploy mechanics" (`deploy`, `setSecret`), SEC-REQ-003, PROV-REQ-002, D-03

An `sst deploy` (SST 4.17.2, provider 6.15.0) that updates the stage Worker — new script content, changed plain-text variables, a removed binding, also after `sst refresh` — keeps every `SECRET_<NAME>` set by `setSecret` through `PUT /accounts/{id}/workers/scripts/{name}/secrets`; the running Worker keeps the same value. The Cloudflare script-upload API itself keeps a script's existing `secret_text` bindings when a new upload does not declare them (verified with a direct upload without `keep_bindings`). So `deploy` needs nothing extra and never stores secrets. The SST transform `transform.worker: args => { args.keepBindings = ["secret_text", "secret_key"] }` was verified to deploy and may be added as an explicit guard (assumption: D-03 adds it, since it is harmless and makes the reliance visible; not required for correctness today).
Constraint: an upload that declares any binding with a secret's name replaces that secret permanently, so the framework must never pass a binding named `SECRET_*` through SST (CFG/framework variables must not use the `SECRET_` prefix). `sst remove` deletes the Worker and its secrets (expected).
Evidence: `ai/implementation/spikes/a-03/RESULT.md`, logs `s02`–`s07`, `c03`–`c17`, `r01`–`r02`. Result: kept. Fallback: none needed (named fallback is the mechanism observed).

### DEC-0088 — SST runs need `NODE_USE_ENV_PROXY=1` in the sandbox (amends DEC-0083)
Origin: ai-proposed · Status: accepted · Affects: DEC-0083, plan §10.6, PROV §2 "Credentials", D-03, D-05, every cloud run

SST's own Node dynamic providers (e.g. `WorkerUrl`, used by `sst.cloudflare.Worker` with `url: true`; also `kv-data`, `worker-placement`, `zone-lookup`) call `api.cloudflare.com` with Node's global `fetch`. Without `NODE_USE_ENV_PROXY=1` that fetch bypasses `HTTPS_PROXY`, the placeholder token is not replaced, and the deploy fails with Cloudflare error 9106 "Authentication failed". The SST environment is therefore A-01's plus `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21; it prints a harmless "EnvHttpProxyAgent is experimental" warning). On an owner machine with a real token the variable is harmless.
Evidence: `ai/implementation/spikes/a-03/RESULT.md` finding 2, logs `s01` (fails), `s02` (works).

### DEC-0089 — Non-browser clients probing `workers.dev` send their own User-Agent
Origin: ai-proposed · Status: accepted · Affects: C-04 `smoke`/`connectTestStage`, compliance drivers, D-RUN

Cloudflare answers requests with the default `Python-urllib` User-Agent with 403 "error code: 1010" (not the proxy). Test and smoke clients set an explicit User-Agent.
Evidence: `ai/implementation/spikes/a-03/logs/c07-diag-403.txt`.

### DEC-0090 — `stopApp`/`startApp` on Cloudflare use the script-subdomain API with `previews_enabled` pinned to false
Origin: ai-proposed · Status: accepted · Affects: DEC-0078, cloudflare.md §2 "Deploy mechanics" (`stopApp`, `startApp`), migrations.md §2 steps 1 and 6 and "Failure", D-03, MIG-AC-006

DEC-0078's assumption holds. `stopApp` is `POST /accounts/{account}/workers/scripts/{worker}/subdomain` with `{"enabled": false, "previews_enabled": false}`; `startApp` is the same call with `{"enabled": true, "previews_enabled": false}`; the state is read with `GET` on the same path. The call returns the new state synchronously. While off, the `workers.dev` URL answers HTTP 404 (`error code: 1042`). Toggling creates no Worker version or deployment: script settings, deployments and versions were identical before, while off, and after on, and the secret, a plain-text variable and a KV binding all worked after the restart.
Both fields are always sent: a body with only `{"enabled": true}` turned preview URLs on as a side effect.
Propagation observed from the sandbox: off ≤ 2.3 s, on ≤ 1.6 s (6 cycles; typically ~0.8 s; probe resolution ~0.7 s). `startApp` therefore needs no fixed wait; a caller that must see the change (tests, smoke) polls the URL for up to 30 s (assumption: simplest reasonable bound, ≫ observed; to be set as a parameter by D-03 if needed).
Evidence: `ai/implementation/spikes/a-04/RESULT.md`, logs `a01`–`a09`, `t01`–`t06a`, `c03`–`c05`. Fallback: none needed (plan fallback was "ask owner").

### DEC-0091 — A deploy may itself re-enable the route; the CLI still calls `startApp` explicitly
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: cloudflare.md §2 (`deploy`, `startApp`), migrations.md §2 step 6, D-03

With the route off, `wrangler deploy` of a config with `workers_dev: true` turned the route back on. So a stop is not held across a deploy. This is consistent with MIG §2 step 6 (deploy, then start) and with cloudflare.md's rule that the CLI calls `startApp` explicitly after every deploy. SST's Worker (URL / `WorkersScriptSubdomain`) behaviour while the route is off was not tested here.
Assumption (taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review): no design change; D-03 verifies by test that an SST deploy followed by `startApp` leaves `enabled: true, previews_enabled: false`, and that `stopApp` is never followed by a deploy before migrations finish (MIG §2 order already guarantees this).
Evidence: `ai/implementation/spikes/a-04/logs/w05-deploy-while-off.txt`, `a09-sub-after-redeploy.txt`, `c05-get-after-redeploy.txt`.

### DEC-0092 — Secret updates reach requests after a short delay
Origin: ai-proposed · Status: accepted · Affects: SEC tests (SEC-AC-001), MIG-AC-006, D-03 cloud tests

Immediately after `wrangler secret put` the Worker still served the version without the secret; a few seconds later the new version (triggered by the secret) served it. Cloud tests that set a secret and then read it poll for the expected result (bounded) instead of reading once.
Evidence: `ai/implementation/spikes/a-04/logs/c01-get-before.txt`, `c02-get-before-settled.txt`.

### DEC-0093 — A Cloudflare migration file is applied as one `POST …/d1/database/{uuid}/query` request, which is atomic
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 "Cloudflare", MIG-REQ-003, MIG-REQ-006, MIG-AC-003, D-04

The CLI applies each pending migration file to the new D1 database with one request
`POST /client/v4/accounts/{account}/d1/database/{uuid}/query` with body
`{"sql": "PRAGMA defer_foreign_keys = on;\n<file text unchanged>;\n<INSERT INTO __framework_migrations …>;"}`.
The drizzle-kit file is sent as-is (its `--> statement-breakpoint` lines are SQL comments); the migration-record
insert rides in the same request so record and schema change commit together. The spike showed one such request
is one transaction: a failing last statement (PK, NOT NULL, deferred FK at commit, syntax, missing table), a
failing middle statement (unique index over duplicates) and a 5 MB / 5,058-statement request failing last all left
schema, indexes and rows unchanged (HTTP 400, `errors[0].code` 7500, `result: []`); the valid request applied every
statement. The `{"batch": [{sql, params}, …]}` form is equally atomic and may be used where bound parameters are
needed. The prefix is required on every request (it does not persist); explicit `BEGIN`/`SAVEPOINT` are rejected by
D1 and must not appear.
Evidence: `ai/implementation/spikes/a-05/RESULT.md` (E0–E2, E4, E6, E10, E11). Fallback: none needed.

### DEC-0094 — An error or missing response from the D1 API is not proof that nothing was applied
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 "Failure", MIG-REQ-003, D-04 (also A-06's import)

A ~30 s request returned HTTP 502 `text/plain` "upstream request failed" (from the sandbox proxy chain, no
`Server: cloudflare`) while D1 had committed the whole batch. Rule: a JSON 4xx with `success: false` means
rolled back; any other outcome (5xx, non-JSON body, timeout, connection reset) is ambiguous, and the CLI reads
`__framework_migrations` on the new database to decide whether that file was applied before choosing between
continuing and the Failure path. Requests are kept well inside the observed limits: one statement < 100,000 bytes
(SQLITE_TOOBIG at 100,046), body ≤ 27 MB worked and 50 MB failed with 500, and runtime well under 30 s. Migration
files are far below these; no parameter is added (assumption: a migration file never approaches them; A-06 decides
import chunking).
Evidence: RESULT.md E5, E8, E9. Fallback: none needed.

### DEC-0095 — Supported changes need no table rebuild; a rebuild of a referenced table fails atomically on D1
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 "Supported changes", CHECK-REQ-004, D-04

drizzle-kit 0.31.11 (PAR-103) generates plain `CREATE TABLE` / `ALTER TABLE … ADD` / `ALTER TABLE … DROP COLUMN` /
`CREATE [UNIQUE] INDEX` statements for every supported change tested (new table with FK, nullable column,
static-default column, unique index, index, drop column), and these apply on D1 with rows and references preserved.
A drizzle-style rebuild of a table that other rows reference fails at commit even with
`PRAGMA defer_foreign_keys = on` (DROP TABLE's implicit delete counts violations the rename does not clear), and
drizzle's `PRAGMA foreign_keys=OFF` wrapper has no effect inside the request; the request then rolls back, so the
Failure path (old database unchanged) covers it. No design change: such rebuilds arise only from changes
CHECK-REQ-004 already refuses. Not tested: drizzle-kit's output for a table-level `unique()` constraint (tested
`uniqueIndex`) and for adding a foreign key to an existing column; D-04's tests should include one of each.
Evidence: RESULT.md E3, E7, E10. Fallback: none needed.

### DEC-0096 — Cloudflare `copyDatabase` uses the fallback page-by-page copy, not D1 export/import
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-REQ-005, MIG-REQ-006 step 2, migrations.md §2 "Cloudflare" and "Fallback copy", PROV §2 `copyDatabase`, D-04

Spike result: D1 export → import is **not** a usable whole-database copy, so the fallback named in migrations.md applies on Cloudflare. The native path fails on:
- **Large rows.** The export writes each row as one `INSERT` with inline literals, and D1 refuses statements over 100 KB (`SQLITE_TOOBIG`). Legal framework rows can exceed that: PAR-215 is 256 KiB.
- **Reference order.**
  - Tables come out in creation order, so rows that reference a table created later fail (cycles always do).
  - Inside the import API, `defer_foreign_keys` only spans about 4 KB of SQL, so a child row more than ~4 KB ahead of its parent is rolled back.
- **Request size.** A dump is too large to send as "one batch": a 5.5 MB `/query` returned 502 after 30 s.
- **Silent value loss.** A NUL in text silently truncates an import that still reports `complete`, and integers beyond 2^53 are rounded. Both are outside the portable rules, but nothing in the native path detects them.

All native failures except the NUL case were atomic and loud. With none of these present, the native copy was exact.

The CLI's Cloudflare `copyDatabase` therefore:
1. creates the new D1 database and its tables from the source's `sqlite_master`;
2. copies tables in reference order. Tables are grouped into strongly connected components of the reference graph, parents first. Rows inside a cyclic group (self-reference or mutual references) are ordered parents first, and a row cycle is never split across pages;
3. sends each page as one atomic `/query` `batch` of `PRAGMA defer_foreign_keys = on` plus multi-row `INSERT`s with at most 100 bound parameters. Pages are at most 1000 rows / ~1 MB of values; a larger row (up to D1's 2 MB) goes alone;
4. binds every value by its stored type (`CAST(? AS INTEGER)` from decimal text, JSON double, text, `unhex(?)` for blobs, `NULL`), never a JSON number for an integer, because D1 binds JSON numbers as REAL. It copies `rowid`, then indexes after the data, then `sqlite_sequence` if present;
5. runs MIG step 4's checks unchanged.

The prototype reproduced the fixture **identically**: every value with its type, rowids, schema, sequence, and an empty FK check, including a 1.9 MB row, reference cycles, unicode/control characters, NULL vs `''`, and int64/blob/NUL edge cases. It took 48.6 s for a 5 MB, 12k-row database, against ~3 s for native export + import when that works. Downtime is accepted (DEC-0076).

Assumption (owner said not to stop for questions): always use the fallback on Cloudflare, rather than trying export/import first and falling back on error. That is the simplest choice, and the native NUL failure is silent. migrations.md §2 "Cloudflare" should be updated by D-04, which owns that doc for its item, to say the copy is the fallback copy. Page limits: PAR-218 (rows and bytes per request), PAR-216, PAR-217.

Integration (A-INT): the always-fallback choice is recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review. The migrations.md rewrite stays with D-04 (plan §5).

Evidence: `ai/implementation/spikes/a-06/RESULT.md`, `logs/`, `fallback_copy.py`. Fallback applied: yes (migrations.md "Fallback copy").

### DEC-0097 — D1 HTTP API facts the Cloudflare target relies on
Origin: ai-proposed · Status: accepted · Affects: PROV §2 (Cloudflare `createDatabase`/`copyDatabase`/`dropDatabase`), migrations.md §2 "Cloudflare", D-04, A-05 (cross-check)

Observed on this account:
- `/query` accepts `{"batch":[{sql, params}, …]}`. One such request is atomic: a failing item leaves nothing applied. `PRAGMA defer_foreign_keys = on` as its first item defers FK checks to the end of the request.
- `PRAGMA foreign_keys = off` is ignored.
- At most 100 bound parameters per statement (PAR-216); SQL text at most 100,000 bytes per statement (PAR-217). A bound text parameter of ~2 MB is accepted.
- JSON `true` binds as TEXT, so booleans are sent as 0/1.
- **The account allows at most 10 D1 databases** (403, code 7406; PAR-219). A schema-changing deploy holds two databases per stage for a while. With other stages or spikes on the same account this limit can be hit, and `copyDatabase` must report that error clearly.
- The export/import signed URLs point at `<hex32>.r2.cloudflarestorage.com`, which the sandbox proxy allows. They are no longer needed under DEC-0096.

Evidence: `ai/implementation/spikes/a-06/RESULT.md` (`probe-query`, create-DB 403). Fallback: n/a.

### DEC-0098 — Cloudflare upload/download tickets: aws4fetch query signing with Content-Type bound
Origin: ai-proposed · Status: accepted · Affects: FILES §2 "Cloudflare", FILES-REQ-003, FILES-AC-003, PAR-105, PAR-233, D-02

Tickets are path-style URLs `https://<account>.r2.cloudflarestorage.com/<bucket>/<key, each segment encodeURIComponent'd>` signed with aws4fetch `AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" })`. `X-Amz-Expires` is set explicitly to PAR-233 in seconds (aws4fetch's default is 86400). Upload tickets are signed with `{ aws: { signQuery: true, allHeaders: true } }` so that `X-Amz-SignedHeaders=content-type;host`; aws4fetch treats `Content-Type` as unsignable by default, and a default-signed `image/png` ticket accepted a `text/html` upload (200), while the `allHeaders` ticket refused it (403 SignatureDoesNotMatch). Download tickets use `{ aws: { signQuery: true } }`. Observed: a ticket is reusable until expiry, refuses other keys (403), expires (403 ExpiredRequest), unsigned requests are refused (400). A 20 MiB XHR PUT with progress events and a byte-exact fetch GET worked in Chromium.
Evidence: `ai/implementation/spikes/a-07/RESULT.md` (N1–N9, B1–B2). Fallback: none needed.

### DEC-0099 — R2 bucket CORS policy shape set by provisioning
Origin: ai-proposed · Status: accepted · Affects: FILES §2 "Cross-origin configuration", FILES-REQ-004, FILES-AC-004, PROV, D-02

Provisioning sets `PUT /accounts/<account>/r2/buckets/<bucket>/cors` with `{ "rules": [{ "allowed": { "origins": ["<stage public origin>"], "methods": ["PUT","GET"], "headers": ["Content-Type"] }, "maxAgeSeconds": 60 }] }` (one rule, one origin; `exposeHeaders` not needed). It applies immediately. A preflight from the allowed origin returns 204 with that origin in `Access-Control-Allow-Origin`; from any other origin 403 without it, and Chromium blocks `fetch`/XHR transfers from that origin (no object written). `maxAgeSeconds` 60 is the only value tested; assumed adequate (simplest; not a requirement-level parameter).
Evidence: RESULT.md (N13, N14, B4–B6). Fallback: none needed.

### DEC-0100 — Stage R2 signing token: account API token with "Workers R2 Storage Bucket Item Write" on the stage bucket only
Origin: ai-proposed · Status: accepted · Affects: FILES §2 "Cloudflare", SEC (R2 signing credentials), PROV, cloudflare.md, D-02

Provisioning creates the token through `POST /accounts/<account>/tokens` (works with the sandbox's proxy-injected token) with one policy: permission group "Workers R2 Storage Bucket Item Write" (looked up by name from `GET /accounts/<account>/tokens/permission_groups`; id at test time `2efd5506f9c8494dacb1fa10a3e7d5b6`) on resource `com.cloudflare.edge.r2.bucket.<account>_default_<bucket>` = `"*"`. S3 credentials: access key ID = token `id`; secret access key = lowercase hex SHA-256 of the token `value` (returned once; stored only as the framework-internal Worker secret, never printed). Item Write includes object reads. The token was usable immediately and refused the other bucket and ListBuckets (403 AccessDenied). Removal deletes it with `DELETE /accounts/<account>/tokens/<id>`. Assumption (simplest): one token per stage, named after the stage's resources, created by provisioning; rotation is out of scope here.
Evidence: RESULT.md "How it works", N10–N12, logs/01-setup.txt, logs/04-teardown.txt. Fallback: none needed.

### DEC-0101 — R2 omits CORS headers on 403: on Cloudflare a rejected ticket reports status null (open owner item)
Origin: ai-proposed · Status: accepted (interim assumption; owner decision outstanding) · Affects: FILES-REQ-006, FILES-AC-003, client.d.ts `uploadFile`/`downloadUrl` behaviour on Cloudflare, D-02

R2 sends `Access-Control-Allow-Origin` on 200 and 404 responses but not on authentication failures (`403 SignatureDoesNotMatch`, `403 ExpiredRequest`), even for the allowed origin. In Chromium an expired or content-type-mismatched ticket therefore ends with XHR status 0 / `fetch` TypeError ("No 'Access-Control-Allow-Origin' header"), so the browser helpers can only report status null and `no response: network or cross-origin blocked`. FILES-AC-003 requires an expired ticket to fail with storage's status and `rejected by storage (HTTP n)`; that cannot be met on Cloudflare as designed. The design names no fallback.
Assumption until the owner decides (simplest, no contract change): D-02 implements tickets as in DEC-0098…DEC-0100; on Cloudflare an expired/rejected ticket yields `FILES.TRANSFER_FAILED` with status null and the `no response …` message; the evaluator records FILES-AC-003's expired-ticket clause on Cloudflare as failing with a pointer to this entry, rather than the implementation working around it. Options for the owner: (a) revise FILES-REQ-006/AC-003 to allow status null when storage's response is not readable cross-origin; (b) have the browser helper check the ticket's expiry before sending and fail as an expired ticket without a storage status (still not "storage's status"); (c) route transfers through a framework upload service (files.md §5), losing direct-to-storage transfers.
Evidence: `ai/implementation/spikes/a-07/RESULT.md` (B3, logs/03-errors.txt).

Integration (A-INT): adopted as the interim behaviour under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review. The conflict, precisely: FILES-REQ-006 (owner-approved) says `status` is storage's status "when one was received, and null otherwise"; on Cloudflare the browser receives no readable response, so status null with `no response: network or cross-origin blocked` arguably meets the requirement's wording. FILES-AC-003 ("An expired ticket fails with `FILES.TRANSFER_FAILED`, storage's status, and a `rejected by storage (HTTP n)` message", Where: Local, cloud) cannot pass on Cloudflare. A content-type-mismatched upload is still refused by storage, so that clause holds, but it too reports status null. The requirement and criterion text are unchanged; the expired-ticket clause of FILES-AC-003 on Cloudflare is recorded as failing with a pointer here until the owner chooses (a), (b), (c) or another option. Local tickets are same-origin, so the clause is unaffected locally. files.md §2 "Cloudflare" points here.

### DEC-0102 — SQL-OQ-1 resolved: local D1 enforces D1's limits; no portable limit added
Origin: ai-proposed · Status: accepted · Affects: SQL-OQ-1, sql.md §2 "Common needs" and §6, SQL-REQ-002, B-06, PAR-216, PAR-217

Measured with Wrangler 4.149.0 (Miniflare 5.20261006.1-alpha) against a remote D1 database: local D1
(`getPlatformProxy`) and remote D1 (Worker binding via Wrangler remote bindings, and the D1 HTTP API)
accept at most **100 bound parameters** per statement and at most **100,000 bytes** of SQL text per
statement, through `prepare().bind()`, `batch()` and `exec()`, and fail with the same messages
(`too many SQL variables … SQLITE_ERROR`, `variable number must be between ?1 and ?100`,
`statement too long: SQLITE_TOOBIG`). Bound values do not count toward the statement size. Because local
D1 fails exactly where Cloudflare does, the plan's fallback (portable limit, new catalogue code, new AC)
is not applied: no `errors.d.ts` change, no new SQL-AC. SQL-OQ-1 is closed; sql.md "Common needs"
should state the chunk sizes (PAR-216, PAR-217). Assumption (simplest reading, recorded rather than
asked): PGlite/Postgres accepts far more parameters, but app tests run per dialect including local D1
(DEC-0039, B-16), so the local D1 run catches an over-limit query; the framework does not add a
pre-check of its own.
Evidence: `ai/implementation/spikes/a-08/RESULT.md`, `out/local.txt`, `out/remote-binding.txt`,
`out/remote-http.txt`. Fallback: not needed.

### DEC-0103 — sql.d.ts typing approach works; three declarations revised (contract change)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-002, SQL-REQ-003, CORE (AppDefinition.tables), docs/contracts/ts/sql.d.ts, docs/contracts/ts/index.d.ts, B-05

Spike A-09 (evidence: `ai/implementation/spikes/a-09/RESULT.md`, `revised.diff`; drizzle-orm 0.45.4,
TypeScript 5.9.3 and 7.0.2). Result: the restricted Drizzle pg-core approach works — the sql.md §2.3
example type-checks unchanged, `.returning({ id })` gives `{ id: string }[]`, writes without
`returning()` give `void`, `atomic` infers per-step tuples (`[void, { id: string }[], Row[]]`),
wrong-type inserts/updates/comparisons fail, and raw/transaction/relational members are absent.
Three declarations are defective:
1. `TableDefinitions = Record<string, Table>` rejects every concrete table (index signature), so
   `defineApp({ tables })` does not compile.
2. `Table`/`Column` fix the table name to `string`; Drizzle's left-join nullability is keyed by the
   literal name, so every left-join field is typed `never`.
3. `sum`/`avg` re-export Drizzle's `SQL<string | null>`, contradicting SQL-REQ-003 (JS numbers).

Proposed change (verified: all checks pass): `Column` gains a `TableName` parameter and `Table` a
`Name` parameter carried from `defineTable<const Name>`; new `AnyTable = PgTable` with
`TableDefinitions = Record<string, AnyTable>` (export from index.d.ts); framework-declared
`sum`/`avg` returning `SQL<number | null>`. Fallback named in the plan: none — ask owner.

Integration (A-INT): adopted under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review. `revised.diff` was
applied to `docs/contracts/ts/sql.d.ts` (now identical to the spike's `fw-revised/index.d.ts`),
`AnyTable` is exported from `docs/contracts/ts/index.d.ts`, and sql.md §2.2 describes the types. The
spike's checks, rerun against the edited contract file (drizzle-orm 0.45.4; TypeScript 5.9.3 and
6.0.3), exit 0 for the §2.3 example and for every check, with no errors in the contract under
`--skipLibCheck false`. B-05 builds on the revised contract.

### DEC-0104 — Dependency pins verified; remaining pins chosen
Origin: ai-proposed · Status: accepted · Affects: PAR-100…PAR-116, B-01, CHECK, LOCAL, COMPL

Spike A-10 (evidence: `ai/implementation/spikes/a-10/RESULT.md`, `out/`) installed PAR-100…PAR-108 at
their pinned versions with Node 22.22.0 and ran each: `wrangler dev` serving a Hono + Zod + jose +
aws4fetch + Drizzle (D1) + R2 Worker, online and offline (`unshare -rn`); PGlite + drizzle-orm;
drizzle-kit generating SQLite and Postgres migrations; `sst install` resolving `@pulumi/cloudflare`
6.15.0 / `@pulumi/aws` 7.20.0; TypeScript type-check (app and framework lib sets); ESLint with
typescript-eslint type information; Vite build and dev proxy; Playwright against Vite + Wrangler;
Vitest with fake timers. Everything works together; no existing pin was replaced. Remaining pins are
the latest stable releases compatible with each other, except TypeScript: 7.0.2 is the latest, but
typescript-eslint (needed for CHECK's type-aware rules) supports only `<6.1.0`, so TypeScript is 6.0.3.
Test runner: Vitest (Vite-native, Node process per file, fake timers, runs PGlite and Miniflare
in-process); app test glob `tests/**/*.test.ts`. Playwright specs use `*.spec.ts` so the globs never
overlap. Fallback applied: none needed.

### DEC-0105 — `createTestApp` gets local Cloudflare bindings through Wrangler's `getPlatformProxy`
Origin: ai-proposed · Status: accepted · Affects: CORE (`createTestApp`), LOCAL, B-16, PAR-101

Wrangler 4.149.0 ships Miniflare `5.20261006.1-alpha`, whose constructor API differs from the
documented Miniflare 3/4 shape (the old keys are rejected). `getPlatformProxy({ configPath, persist })`
from `wrangler` gives working D1 and R2 bindings in the Node test process from the generated
`wrangler.jsonc`, with no Miniflare-specific configuration, and works offline (spike A-10, test 2/3).
Use it; if Miniflare is imported directly, pin it to exactly the version Wrangler depends on (one
workerd; PAR-117). Miniflare's type declarations import `@cloudflare/workers-types`, so the framework adds it as
a dev dependency at the matching version (PAR-118); it is never added to a `types` array, so app code stays free
of workers-types (CHECK §2).

### DEC-0106 — PGlite harness uses a database created with C collation and C ctype
Origin: ai-proposed · Status: accepted · Affects: SQL (sql.md §2 `containsText`, collation), MIG §2, B-05, B-06, B-16

PGlite 0.5.8's default database has `datcollate = C` (code-point ordering, matches D1) but
`datctype = C.UTF-8`, so `lower('ÀB')` returns `àb`; sql.md §2 assumes `lower()` folds only ASCII on
Postgres. `CREATE DATABASE <name> TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'` works in PGlite and
`PGlite.create(dir, { database: <name> })` opens it, where `lower('ÀB')` is `Àb` (spike A-10,
`out/pg-lower.txt`). The local Postgres harness therefore creates and uses such a database, matching
MIG §2 on AWS. (Alternative if that proves awkward in-memory: `containsText` applies `COLLATE "C"` to
`lower()`, which gives the same result on the default database.)

### DEC-0107 — Combined Cloudflare tool environment for sandbox runs
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEC-0083, DEC-0088, DEC-0084, PROV §2 "Credentials" and "Removal", plan §10.6, D-03, D-05, every cloud run

One statement of DEC-0083 as amended by DEC-0088, for implementers:
- **wrangler:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>` (the proxy injects the real token for `api.cloudflare.com`), `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, plus the sandbox's `HTTPS_PROXY`.
- **SST/Pulumi:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID`, `NODE_USE_ENV_PROXY=1`, `--stage` (or `SST_STAGE`), plus `HTTPS_PROXY`.
- **Framework Node code** calling Cloudflare or `workers.dev` with `fetch`: `NODE_USE_ENV_PROXY=1` (DEC-0085).
On an owner machine the real token goes in `CLOUDFLARE_API_TOKEN` and the proxy-specific variables are harmless. Removal: `sst remove` leaves the stage's state objects (including its passphrase) in the `sst-state` bucket, so the framework's Cloudflare `remove` deletes the objects under `*/<app>/<stage>` itself and never the bucket (DEC-0084).
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-01/RESULT.md`, `ai/implementation/spikes/a-03/RESULT.md`.

### DEC-0108 — Offline runs use the spike's `offline.sh` wrapper
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: plan §10.2, B-17 (`verify` offline check), B-18 / C-05 exit checks, CHECK-REQ-006 runs

Plan §10.2's offline command runs `ip link set lo up`, but `ip` (iproute2) is not installed in this sandbox. Offline runs use `unshare -rn sh <dir>/offline.sh <command…>`, where `offline.sh` brings loopback up with `ip` if present and otherwise with an ioctl through `python3 -I lo-up.py`, then runs the command. Spike A-10 ran Vitest, `wrangler dev` and Playwright + Vite offline with it. The files are `ai/implementation/spikes/a-10/scripts/{offline.sh,lo-up.py}`; B-01 copies both unchanged to `scripts/offline.sh` and `scripts/lo-up.py` at the repository root, and later items use that path. Unsetting `HTTPS_PROXY` or disabling TLS is still never a substitute.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-10/RESULT.md` "Environment", commands 3, 5, 13.

### DEC-0109 — The framework depends on `@pulumi/cloudflare` only if its code imports it
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PAR-108, B-01 (`FW/package.json`), D-03

SST 4.17.2 installs its own `@pulumi/cloudflare` 6.15.0 (PAR-108) in `.sst/platform`, and installing the package directly pulls a newer `@pulumi/pulumi` (3.270.0) than SST's (3.215.0). So the framework declares `@pulumi/cloudflare` as a dependency, at exactly PAR-108, only if framework code imports it (for example for types or a resource SST does not wrap); otherwise it relies on SST's copy and declares nothing. PAR-108 stays the pinned version either way.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-10/RESULT.md` finding 5, command 15.

---

## Implementation phase: local and Cloudflare — phase B local foundation (2026-10-19)

These were recorded by build items B-01…B-18 (with B-16a) and test-author items B-T1…B-T4 of `ai/implementation/plan.md`, and integrated by item B-INT. All are `ai-proposed`. Where two drafts recorded the same decision they were merged into one entry (named in its last line). An entry taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue" says so in its body and shows `owner review open` (or `owner decision outstanding`) in its status line; entries without that mark are routine design choices for points the documents leave open (prompt §5).

### DEC-0110 — No `./targets/aws` subpath until the AWS phase
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open, plan §11 Q3) · Affects: CORE-REQ-005, CORE-AC-005, `packages/framework/package.json`

The exports map lists `.`, `./client`, `./testing`, `./targets/local`, `./targets/cloudflare`, `./provision`, `./check`. CORE-REQ-005 says "one subpath per supported target"; AWS is not built in this phase (prompt §4), and an export pointing at placeholder code is not allowed. The AWS phase adds `./targets/aws`. CORE-AC-005's fixture importing `./targets/aws` still fails `verify` (through `allowed-imports`, and because the subpath does not resolve). Plan §11 Q3; open for owner review.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-01.

### DEC-0111 — The package ships compiled `dist/`; exports and the binary point there
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-005, CLI-REQ-001, DEC-0049, B-16, B-17, C-05

Each export has conditions `types` → `./dist/<path>.d.ts` and `default` → `./dist/<path>.js`, built by `npm run build` in the framework (`tsc -p tsconfig.build.json`, also run by `prepack`, so the `npm pack` tarball of DEC-0049 contains it). Reasons: Node does not strip TypeScript types under `node_modules`, so the CLI binary needs JavaScript; and declaration files keep app type-checking (app lib set, no `@types/node`) from compiling framework sources that use Node APIs. Framework sources use Node ESM resolution (`module: NodeNext`, `.js` import suffixes). Consumers inside the workspace (template, reference, compliance) therefore need the framework built before they type-check or run; wiring that order is B-16/B-17's. Hubs: `src/index.ts`, `src/client/index.ts`, `src/testing/index.ts`; the other subpaths point at `src/<comp>/public.ts` (`targets/local`, `targets/cloudflare`, `provision`, `check`).
Item: B-01.

### DEC-0112 — Package binary name `prototype-framework`
Origin: ai-proposed · Status: accepted · Affects: CLI-REQ-001, CLI-AC-001

`bin: { "prototype-framework": "./bin/prototype-framework.js" }`, the unscoped package name, so `npx @lago-morph/prototype-framework <command>` runs it. The bin file is plain JavaScript that imports `dist/cli/public.js` and calls `main(argv)`, which resolves to the exit status (stub: prints "not implemented yet", exits 1).
Item: B-01.

### DEC-0113 — Framework dependency set
Origin: ai-proposed · Status: accepted · Affects: PAR-100…PAR-118, DEC-0104, DEC-0105, DEC-0109, `packages/framework/package.json`

Runtime dependencies (the CLI runs them inside apps): hono, zod, drizzle-orm, drizzle-kit (`generate-migration`), wrangler (`dev`, `getPlatformProxy`), sst (`deploy`), aws4fetch, jose, PGlite (`verify`'s Postgres harness), eslint + typescript-eslint and typescript (`./check`, `verify` type-check), vite (`dev`), vitest (`verify` runs app tests), esbuild (see -5). Dev dependencies: `@cloudflare/workers-types` (PAR-118), `@types/node`, `@playwright/test`. Not declared: `miniflare` (PAR-117; nothing imports it directly yet, DEC-0105), `@pulumi/cloudflare` (DEC-0109), `@pulumi/aws` (AWS phase). Apps (`template`, `reference`) depend on the framework at exactly `0.1.0` and `zod` at exactly PAR-112, with `typescript`, `vite`, `vitest` dev dependencies (reference also `@playwright/test`). `apps/demo` is an empty stub with no dependencies (F-01 builds it from the skill). `tests/compliance` depends on the framework, zod, vitest, Playwright, TypeScript, `@types/node`. The root has only the runner tooling (TypeScript, Vitest, Playwright, `@types/node`) for its configs and the tag helper.
Item: B-01.

### DEC-0114 — esbuild pinned to Wrangler's version as a framework dependency
Origin: ai-proposed · Status: accepted · Affects: PAR-101, PAR-113, PAR-119 (new), B-16

With only the pinned packages, npm hoists drizzle-kit's `esbuild@0.25.12` to the root, which does not satisfy Vite 8.3.4's optional peer range `^0.27.0 || ^0.28.0`; npm then writes a lockfile that `npm ci` rejects ("lock file's esbuild@0.25.12 does not satisfy esbuild@0.28.2") and `npm ls` reports invalid. Declaring `esbuild` at exactly the version Wrangler 4.149.0 depends on (`0.28.2`) as a framework dependency hoists that version, leaves drizzle-kit its own nested 0.25.12, and gives one esbuild for Wrangler, Vite and the build pipeline (B-16 composes bundles with esbuild). Like PAR-117, it moves with PAR-101. Evidence: `npm ls esbuild` before/after in this item's run; `npm ci` passes after.
Item: B-01.

### DEC-0115 — App and framework TypeScript lib sets
Origin: ai-proposed · Status: accepted · Affects: CHECK §2, B-17, B-18

Root `tsconfig.app.json` is the app lib set (ES2023 + DOM + DOM.Iterable, `types: []`, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, Bundler resolution), as spike A-10. Root `tsconfig.node.json` is the framework/tooling set: the same plus `types: ["node"]` and NodeNext resolution; `@cloudflare/workers-types` is never in `types`. `packages/framework/tsconfig.json` extends the node set; `tsconfig.build.json` emits `dist/`. A scratch app using `.` and `./client` from the built package type-checked under the app set.
Item: B-01.

### DEC-0116 — Test runners per layer and the tag helper location
Origin: ai-proposed · Status: accepted · Affects: plan §10.1, §10.3, PAR-116, C-02

- Unit: `vitest.unit.config.ts` — `packages/framework/src/**/*.unit.test.ts` and `tests/**/*.unit.test.ts` (tool unit tests), forks pool.
- Integration: `vitest.integration.config.ts` — `packages/framework/test/integration/**/*.test.ts` and `tests/compliance/criteria/**/*.test.ts`; plus Playwright project `integration` for `*.spec.ts` browser criteria in the same directories. `npm run test:integration` runs both; Playwright gets `--pass-with-no-tests` because most integration suites have no browser test, while Vitest still fails on zero tests.
- E2E: Playwright project `e2e`, `tests/compliance/e2e/**/*.spec.ts` (API-only scenarios use Playwright's `request` fixture), so the layer is one runner and fails on zero tests.
- `--target`, web servers and base URLs are C-02's. `lint`, `compliance` and `verify` are stubs that print which item wires them and exit 1, so nothing reports a pass for work that does not exist.
- Tag helper: `tests/support/tags.ts` (`tag(ids, title)`, `parseTags`, `TAG_PATTERN` = the §10.3 regex), shared by framework suites and `tests/compliance` through a relative import; it refuses IDs the traceability regex would not parse. Unit-tested in `tests/support/tags.unit.test.ts`.
Item: B-01.

### DEC-0117 — Browser and test helper stubs per owning component
Origin: ai-proposed · Status: accepted · Affects: plan §3 directory map, B-03, B-11, B-12

Besides each `public.ts`, B-01 created `http/client.ts`, `auth/client.ts`, `files/client.ts` (the `./client` hub re-exports them) and `auth/testing.ts` (`mockUsers`, re-exported by the `./testing` hub), matching the owners named in `client.d.ts` and `testing.d.ts` and the plan's "browser helpers from `FW/src/<comp>/client.ts`". `connectTestStage` is stubbed in `testing/public.ts`; C-04 may move it to `testing/connect.ts` through the integrator. Components without a contract file (mig, google, check, build, targets/*, provision, evidence) have an empty `public.ts`; `cli/public.ts` has `main` for the binary. `FrameworkError` and `ERROR_CATALOGUE` in `core/errors.ts` are real (a transcription needs no stub); every other function throws `not implemented: <name>`.
Item: B-01.

### DEC-0118 — Name rules read literally; violations are `CORE.MISCONFIGURED`
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-003, CORE-AC-007, PAR-290, PAR-291, B-16, B-17

`createDeployment({ app, stage, target })` (`src/core/identity.ts`) is what the build calls. App names match `^[a-z0-9]{1,20}$`, stage names `^[a-z0-9-]{1,20}$`, exactly as worded in core.md; no extra rule (leading letter, no leading or trailing hyphen) was added because none is stated. A stage of `test-` alone is therefore valid and a test stage. A violation throws `FrameworkError("CORE.MISCONFIGURED")` whose message quotes the name and says "breaks the app-name rule: app names use lowercase letters and digits only, no hyphens, 1 to 20 characters (PAR-290)" (stage likewise), which CORE-AC-007's build part (B-16/B-15) can print. The test-stage flag is `stage.startsWith("test-")`, never taken from input. The internal `Target` type is `"local" | "cloudflare"`; the AWS phase adds `"aws"` (no AWS code in this phase). `appIdentity(deployment)` returns a frozen `{ app, stage }`, the only value placed in `c.var.deployment`.
Item: B-02.

### DEC-0119 — Core supplies a default error handler for the HTTP slot
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-004, HTTP-REQ-002, HTTP-REQ-007, LOG-REQ-005, B-03

`assembleApp`'s error-handler slot is optional; the default (`src/core/error-handler.ts`, `coreErrorHandler`) returns an `ErrorResponse` with the catalogue status (status-null codes, which never cross HTTP, map to 500); non-`FrameworkError` values become 500 `CORE.INTERNAL` with the catalogue meaning as message; a `FrameworkError` with an empty message also gets the meaning. For status ≥ 500 it writes exactly one `error` entry with component = the code's prefix (e.g. `CORE`), message `<METHOD> <path> failed with <code>\n<name>: <message>\n<stack>`; the path excludes the query string so OAuth-like query values never reach the log. Reason: CORE-REQ-004 and CORE-AC-004 are this item's, and every runtime needs a working handler before B-03 lands. B-03 may pass its own handler (404/405 mapping, `no-store`, redaction) through the slot or extend this one; helpers `errorCode`, `errorStatus`, `errorLogMessage`, `asError` are exported for that. Hono passes only `Error` instances to `onError`, so the assembler adds a middleware at the error-handler position that wraps other thrown values in `ThrownValue` and calls the same handler.
Item: B-02.

### DEC-0120 — Runtime assembler shape and deferred checks
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-002, CORE-REQ-003, core.md §2, B-03, B-04, B-09…B-12, B-16

`assembleApp(definedApp, parts)` (`src/core/assemble.ts`) returns a `Hono<RuntimeEnv>`; `RuntimeParts` = `{ deployment, createLog(c), createServices(env, deployment, log), currentUser, forgeryCheck, errorHandler?, notFound?, frameworkRoutes? }`. Middleware order: request ID (`crypto.randomUUID()`, never from headers) → `createLog` → error handler → deployment and services (`createServices` returns every `Services` member except `log`, which already exists) → current user → forgery check → framework routes (under `/api`) → app routes (under `/api`). `createServices` receives the log because LOG is created first (core.md §2) and adapters need it for `*.UNAVAILABLE` entries; this extends core.md's `createServices(env, deployment)` by one argument. Deferred checks: `deferredCheck(fn)` (`src/core/deferred.ts`) runs `fn` on first use, remembers success but not failure (a later request checks again), passes `FrameworkError` through and turns any other failure into `CORE.MISCONFIGURED` with the same message. The assembler uses it to re-check the embedded identity (name rules, and that `deployment.app` equals the definition's `name`) on the first request; `assembleApp` itself never throws for misconfiguration. `definition.routes(api)` is still called at assembly, since route registration is app code, not wiring.
Item: B-02.

### DEC-0121 — CORE-AC-001 unit fixtures cover `c.var` and config types; the import-coverage clause is left to B-T1
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-001

`src/core/types.unit.test.ts` compiles (under `npm run typecheck`) an app using only `.` exports, asserting `keyof c.var` equals `keyof RequestVars`, config and secret name and value typing, that `deployment.target` and `c.env` bindings are not visible, and a routes function in a separate declaration where a wrong config value type fails. The clause "every framework type appearing in a public signature can be imported from the subpath whose signatures use it" is not checked at unit level; it belongs to B-T1's integration fixture.
Item: B-02.

### DEC-0122 — HTTP runtime parts, 405 detection, and non-API paths
Origin: ai-proposed · Status: accepted · Affects: HTTP-REQ-001, HTTP-REQ-005, http.md §2, core.md §2, B-16

`createHttpParts(options)` (`src/http/runtime.ts`) returns `parts` for `assembleApp`'s `errorHandler`, `notFound` and `frameworkRoutes` slots, plus `attach(app)`. Hono calls the not-found handler both for unknown paths and for known paths with the wrong method; telling them apart needs the assembled app's route list, which only exists after `assembleApp` returns, so the target runtime calls `attach(app)` afterwards (without it every miss is 404, never 405). The handler indexes non-middleware routes in a Hono `TrieRouter` and answers 405 `HTTP.METHOD_NOT_ALLOWED` with `Allow` when another method matches. `frameworkRoutes` registers the `no-store` middleware (`/api/*`, so it also wraps app routes registered later) and the health route. Paths outside `/api` are served by Vite locally and the assets layer on Cloudflare and never reach the Worker; in-process (`createTestApp`) they get `HTTP.NOT_FOUND` too. Reason: no edit to CORE's assembler (not B-03's) and the smallest wiring for B-16.
Item: B-03.

### DEC-0123 — 5xx responses carry only the catalogue meaning; known secret values are redacted
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: HTTP-REQ-002, HTTP-AC-002, SEC-REQ-002, B-10, B-16, SEC-AC-002, HTTP-REQ-007, B-03, B-04

Responses below 500 keep a `FrameworkError`'s own message (app messages such as "note limit reached", validation details); responses of 500 and above give the catalogue meaning, with the detail only in the log. HTTP cannot know secret values itself, so `createHttpParts({ secretValues: (c) => Iterable<string> })` takes them from the runtime (B-16 wires SEC: e.g. every `SECRET_*` value in the Worker env); every non-empty value is replaced by `[redacted]` in the response message and the log entry. Reason: HTTP-AC-002's "an error containing a known secret value is not echoed" covers app-thrown `FrameworkError` messages, which only redaction can meet.

B-T1's draft of the same decision ("Secret values are redacted from responses and log entries"): HTTP-REQ-007 logs the underlying error's message, while SEC-REQ-002 forbids secret values in log entries and error responses, and C-01's fixture is "a route that throws an error containing the test secret value". The tests therefore require that a known secret value (one read through `c.var.secrets` in this request or set for the test app) never appears in a response — including the message of an app-thrown 4xx `FrameworkError` — nor in any log entry, even when app code put it into an error message. The framework must redact known secret values (or not return app messages).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-03, B-T1 (drafts merged).

### DEC-0124 — The log entry's route path is the matched route pattern; key and secret names come from the message
Origin: ai-proposed · Status: accepted · Affects: HTTP-REQ-007, HTTP-AC-007, LOG-REQ-005, B-09, B-10, B-11

The HTTP-REQ-007 entry is written with LOG's `logFailure` (one entry per error object, so an adapter's earlier `*.UNAVAILABLE` entry is not repeated) through a wrapper writer that prefixes `<METHOD> <route path> ` and redacts secret values: `GET /api/notes/:id failed with CORE.INTERNAL\n<name>: <message>\n<stack>`. The route path is the pattern of the last matched non-middleware route (Hono `matchedRoutes`), falling back to the plain path without query; this keeps IDs and ticket values in paths (e.g. `/api/__framework/files/*`) out of the log. "Where relevant, the missing configuration key or secret name" is carried by the error's message: CFG (`CFG.UNDECLARED_KEY`) and SEC (`SEC.MISSING`, `SEC.UNDECLARED`) must name the key or secret in their `FrameworkError` message. No extra error property was added. CORE's own `coreErrorHandler` (B-02, outside B-03's Owns) still writes with `log.write` directly; it is only the default when no HTTP handler is supplied.
Item: B-03.

### DEC-0125 — Validation details
Origin: ai-proposed · Status: accepted · Affects: HTTP-REQ-003, http.md §2

`jsonBody` rejects with `HTTP.PAYLOAD_TOO_LARGE` when `Content-Length` exceeds PAR-200 or when the streamed bytes do (reading is cancelled at the first byte over); it does not require a JSON `Content-Type` (any body that does not parse is `HTTP.INVALID_INPUT`, including an empty one). `queryParams` validates `c.req.query()` (one string per name, the first value); schemas use `z.coerce` for numbers. Messages list `body.<path>: <zod message>` / `query.<path>: …` joined by `; `.
Item: B-03.

### DEC-0126 — Health checks are supplied by the target runtime
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002, framework.openapi.yaml `/api/__framework/health`, B-16

The health route runs `options.healthChecks` (`(c) => void | Promise<void>`, each throwing a `FrameworkError` on failure) in order and answers 204, or the first failure through the error handler (so a 5xx failure leaves one log entry with the detail, and the response carries only the code and meaning). The SQL read and the list of declared and required framework secrets belong to the runtime that knows the app definition and the framework's internal secret names (B-16 wires them from SQL and SEC). The route is anonymous because the current-user middleware lets anonymous requests through.
Item: B-03.

### DEC-0127 — `api` and `ApiError` details
Origin: ai-proposed · Status: accepted · Affects: HTTP-REQ-006, client.d.ts, B-11, B-12

`ApiError`'s constructor is `(message?: string, init?: { code?, status?, requestId?, cause? })` with defaults `HTTP.NETWORK_ERROR`/null/null; `init` extends `ErrorOptions`, so the contract's inherited `Error` constructor signature still type-checks (no contract change). FILES and AUTH browser helpers construct it the same way. `api` treats a response as "valid ErrorResponse" only when its JSON body has exactly the schema's properties (`additionalProperties: false`) and a catalogue code; a "successful response" is 2xx with an empty body (resolves `undefined`) or with a JSON `Content-Type` (`application/json` or `+json`) that parses. A rejected `fetch` (or a body read failure) is `HTTP.NETWORK_ERROR`, status null, message `could not reach the API`.
Item: B-03.

### DEC-0128 — Fire-and-forget writes meet PAR-260 locally; sinks are per target
Origin: ai-proposed · Status: accepted · Affects: LOG-REQ-001, LOG-AC-001, log.md §2, B-16, D-01

`createLogWriter(context, sink)` (`src/log/writer.ts`) builds the entry and calls the target's sink inside a `try`; when the sink returns a promise the writer attaches a no-op rejection handler and does not wait. So `write` never throws, never leaves an unhandled rejection, and adds no wait at all, which is within PAR-260 for any sink, including one that never completes. No "wait up to PAR-260 for pending writes" step is built: local and test sinks are synchronous, Cloudflare (D-01) hands its R2 write to `waitUntil`, and the AWS bounded wait belongs to the AWS phase. Sinks: `workerOutputSink` (local Worker, marked lines), `createMemorySink` (`createTestApp`), `failingSink("throw" | "reject")` and `neverCompletingSink` (`src/log/test-sinks.ts`) for LOG-AC-001. How tests inject a sink into `createTestApp` is B-16's choice (no `TestAppOptions` field exists in `testing.d.ts`); B-T1's suite proposes `logWriter: "failing" | "never-completing"` (DEC-0210), which maps to `failingSink()` and `neverCompletingSink()`. `requestLogFactory(deployment, sink)` (`src/log/request.ts`) is the ready `createLog` slot value for runtimes.
Item: B-04.

### DEC-0129 — `logFailure` is the single LOG-REQ-005 hook and logs each error object once
Origin: ai-proposed · Status: accepted · Affects: LOG-REQ-005, HTTP-REQ-007, HTTP-AC-007, LOG-AC-005, B-03, B-06, B-08, B-10, B-11, B-16

`logFailure(log, thrown)` (`src/log/failures.ts`) writes one `error` entry: component = the code's prefix (`CORE.INTERNAL` for non-`FrameworkError` values), message `<METHOD> <path> failed with <code>\n<name>: <message>\n<stack>` — the same format as CORE's default error handler — with method and path taken from the request writer (omitted for a writer created outside a request). It records each logged error object in a `WeakSet` and does nothing the second time (`wasLogged`). Intended use: adapters call it when they raise `*.UNAVAILABLE`, so a failure the app catches is still logged ("every `*.UNAVAILABLE` failure"); the HTTP error handler calls it for every ≥500 response, so a failure reported by both still leaves exactly one entry (HTTP-AC-007). **Cross-item note:** CORE's default handler (`core/error-handler.ts`, B-02) currently calls `log.write` directly; B-03's handler (or the integrator for CORE's) must call `logFailure` instead once adapters start calling it, otherwise an uncaught `*.UNAVAILABLE` would leave two entries.
Item: B-04.

### DEC-0130 — Local marked-line format and `.logs/` file day
Origin: ai-proposed · Status: accepted · Affects: LOG-REQ-003, LOG-AC-003, DEC-0066, B-17

The local Worker prints `[prototype-framework:log] <entry JSON>` with `console.log` (JSON escapes line breaks, so one entry is one line). `createLogCapture({ append, other })` (`src/log/capture.ts`) takes Wrangler's output in arbitrary chunks, finds the marker anywhere in a line (Wrangler or a terminal may prefix it), validates the JSON against the entry schema (`isLogEntry`), appends it as one JSON line to `.logs/<yyyy-mm-dd>.log`, and passes every other line to `other`; `end()` handles a final unterminated line. Malformed marked lines are passed on as ordinary output. The file's day is the entry's UTC date (consistent with LOG-REQ-004's UTC key layout), not the machine's local date. The capture does no I/O; `dev` (B-17) supplies the append.
Item: B-04.

### DEC-0131 — `createTestApp` echoes every `error` entry
Origin: ai-proposed · Status: accepted · Affects: core.md §2 Testing, testing.d.ts `TestApp.logs()`, B-16

core.md and testing.d.ts say framework `error` entries are echoed to stderr. Entries do not record who wrote them (an app may also use component `CORE`), so the memory sink echoes every `error` entry, as one JSON line on stderr. Echoing an app's own `error` entries too is harmless in tests and needs no origin flag.
Item: B-04.

### DEC-0132 — Schema rules read literally; violations are `CORE.MISCONFIGURED` at import
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-001, SQL-AC-001, sql.md §2.2 "Schema checks", B-07, B-15

sql.md names the rules but not their exact form or error code. Chosen: a broken schema is wiring, so `defineTable` throws `CORE.MISCONFIGURED` (the message names the table, key and rule) when the schema module is imported. "Valid on every target" is read as: lowercase ASCII snake_case starting with a letter, single underscores between words, at most 63 characters (Postgres truncates longer identifiers), not `sqlite_…` (reserved by SQLite); SQL keywords are allowed because Drizzle and drizzle-kit always quote identifiers. Column keys are `^[a-z][a-zA-Z0-9]*$`, mapped by replacing each upper-case letter with `_` plus its lower case (an injective mapping, so two keys never share a SQL name). Indexes, unique constraints and foreign keys get explicit names (`<table>_<columns>_idx`, `_unique`, `<table>_<column>_fk`) instead of Drizzle's or drizzle-kit's defaults, so both dialects and their migration histories use the same names; a generated name over 63 characters is rejected. `id()` rejects `.nullable()`, `.unique()` and `.default()` (it is the primary key, set from `newId()`). A column default that breaks the column rule is `SQL.INVALID_VALUE` (sql.md: "checked against the same rule"). Reference action: Drizzle's default (SQLite: none given; Postgres: `no action`), which fails while referenced on both. Framework tables use an internal `defineFrameworkTable` that allows the `__framework_` prefix; anything else they need (e.g. a text primary key for `__framework_kv`) is B-07's/B-08's to add.
Item: B-05.

### DEC-0133 — Where value rules run; `id()`/`ref()` values must be lowercase UUID v4
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-004, SQL-AC-004, sql.md §2.1, §2.2 "Value checks", CHECK `framework-ids`, B-06

Each column's rule runs inside that column's Drizzle `mapToDriverValue`, so every bound value for the column is checked while the query is built: inserts, updates and also comparisons (`eq(notes.views, 2147483648)` is `SQL.INVALID_VALUE` everywhere, instead of an error on Postgres and an empty result on SQLite). Because Drizzle skips the encoder for NULL and fills omitted columns itself, `sqliteDb`/`postgresDb` wrap the Drizzle database (a small proxy) and check the rows of `insert().values()`, `update().set()` and `onConflictDoUpdate({ set })`: NULL only in nullable columns, a value for each NOT NULL column without default, no `id()` change (the table's "immutable"). The `id()` rule "UUID v4 from `newId()`" is enforced at run time as the exact form `crypto.randomUUID()` gives (lowercase, version 4, RFC variant); `ref()` values use the same rule (a ref holds an id). Consequence: looking a row up by a malformed ID is `SQL.INVALID_VALUE` (400), identically on every target. Text: unpaired surrogates are found with a code-unit regex because `String.prototype.isWellFormed` is ES2024 and the lib set is ES2023. Drizzle builds the query inside `then`, so calling `.then()` directly throws synchronously; `await` (as app code does) rejects as usual. B-06 owns the restricted handle and may fold this wrapper into it.
Item: B-05.

### DEC-0134 — Dialect per process: `PROTOTYPE_FRAMEWORK_DIALECT`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: LOCAL-REQ-003, core.md "Testing", cli.md `verify`, B-16, B-17, B-16 (`createTestApp`), B-17 (`verify`), core.md §2 "Testing", SQL-AC-001/-003…-006, KV-AC-001…-005

Same variable as the B-T2 suites assume (merged below), so there is one name. The dialect is read once per process from the environment variable `PROTOTYPE_FRAMEWORK_DIALECT` (`sqlite` by default, or `postgres`; anything else is `CORE.MISCONFIGURED`) and fixed after the first read. Worker bundles (local and Cloudflare) leave it unset and get SQLite; `verify` sets `postgres` for the second test-runner process. `defineTable` builds the table of that dialect when the schema module is imported, and keeps a dialect-neutral definition; `tableFor(table, dialect)` builds (and memoizes) the other dialect's table, resolving `ref`s to the same dialect, for `generate-migration` (B-07), which needs both histories from one process.

B-T2's draft of the same decision ("Framework suites select the SQL dialect with `PROTOTYPE_FRAMEWORK_DIALECT`"): core.md and local.md fix the dialect per test-runner process but name no mechanism; spike A-10 says "an env var selecting the dialect (B-16)". The suites assume the variable `PROTOTYPE_FRAMEWORK_DIALECT` with values `sqlite` (local D1) and `postgres` (PGlite), read when the framework is loaded. It is defined once in `test/integration/sql/support/dialect.ts`; if B-16 chooses another name, only that constant changes. One entry file per dialect (`*.sqlite.test.ts`, `*.postgres.test.ts`) sets it and then imports its suite dynamically, so dialect-specific tables are built after selection; Vitest's `forks` pool gives each file its own process, so `npm run test:integration` covers both dialects in one run. A harness check (not a criterion) in `sql.suites.ts` proves the selection took effect: a 101-parameter query must fail on local D1 (PAR-216, DEC-0102) and succeed on PGlite.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-05, B-T2 (drafts merged).

### DEC-0135 — PGlite harness: one C/C data directory per process, one instance per database
Origin: ai-proposed · Status: accepted · Affects: DEC-0106, SQL, B-16 (`createTestApp`), B-07

`openPostgres()` returns a fresh in-memory PGlite instance opened on database `app`. PGlite cannot switch databases inside one instance and an in-memory instance shares no storage, so the first call per process creates a PGlite instance, runs `CREATE DATABASE app TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`, dumps its data directory (`dumpDataDir("none")`), and every harness instance is created with `loadDataDir` from that dump. Measured here: making the dump about 2.8 s once, each fresh database about 0.5 s; `datcollate = C`, `datctype = C`, `lower('ÀB') = 'Àb'` (test `drivers.unit.test.ts`). The `COLLATE "C"` alternative in DEC-0106 is not needed.
Item: B-05.

### DEC-0136 — B-05's SQL unit tests use the real local databases and drizzle-kit
Origin: ai-proposed · Status: accepted · Affects: plan §10.1, SQL-AC-001, SQL-AC-004

The B-05 exit asks for SQL-AC-001 and SQL-AC-004 "on both dialects" at unit level, so `src/sql/databases.unit.test.ts` opens local D1 through `getPlatformProxy` (fixture `src/sql/fixtures/wrangler.jsonc`, `persist: false`; workerd runs locally, no network) and the PGlite harness, creates the schema with drizzle-kit's programmatic API (`drizzle-kit/api`, the same generator MIG uses), and compares introspected schemas (column names, SQL types per the §2.1 table, NOT NULL, primary key, defaults, named indexes and uniques, references). These remain unit-layer evidence only; the integration suites (test authors) are the criterion's evidence.
Item: B-05.

### DEC-0137 — Restricted handles at run time; result size checked on every returned result
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-002, SQL-REQ-004, SQL-REQ-006, sql.md §2.2 "Handles", "Result size", B-08, B-16

`sqliteDb(binding, options)` and `postgresDb(client, options)` return a plain frozen object with only the `PortableDb` members; `atomic`'s `WriteDb` has only `insert`/`update`/`delete`. So `batch`, `transaction`, raw `run`/`execute` and `db.query` are absent at run time as well as in the types (the portability rules remain the guard against Drizzle builder members the types hide, e.g. SQLite's `.all()`; those are not removed). Each builder made through a handle is a proxy whose `then`/`catch`/`finally`/`execute` run the query through the guard, map a driver write result without rows to `undefined` (`Array.isArray` test: Drizzle returns rows as arrays on both drivers, and a D1 result object or a PGlite result object otherwise), and check the PAR-215 size (sql.md §2.3 measure, strict "larger than"). The size is checked after the driver returns, so a write whose RETURNING rows are too large has already committed; that is the same on every target (on AWS the Data API refuses before returning, at PAR-214 > PAR-215). `atomic`'s results are measured together. B-05's `withValueRules` proxy stays underneath (row-level value rules).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0138 — `atomic` mechanics locally
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-005, SQL-AC-005, sql.md §2.2 "atomic"

D1: steps are built on a write handle over the database, checked, then submitted with Drizzle's `db.batch` (one D1 batch, which D1 runs as one transaction). PGlite: Drizzle's `transaction`; inside it all steps are built on a write handle over the transaction (with the value rules), checked, then executed in order; any error rolls back. The check: a step's return value must be a builder made by *that call's* write handle (recorded in a per-call `WeakSet`); anything else — a builder from `c.var.sql`, one captured earlier, a promise from an `async` step — rejects with `CORE.INTERNAL` (sql.md §2.2; SQL-REQ-005 only asks for "a catalogue error", and B-T2's suite accepts any catalogue code) before anything executes. Builders made on a step's handle reject with `CORE.INTERNAL` when awaited, so an `async` step cannot execute its write outside the unit (found by the unit test: awaiting the builder inside an `async` step had executed it). A handle not made by `sqliteDb`/`postgresDb` is `CORE.INTERNAL`. Empty input resolves to `[]` without touching the database (so also without a forced-outage error). The whole call runs as one guarded operation (one PAR-210 budget).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0139 — `containsText` SQL per dialect
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-003, sql.md §2.2, DEC-0106

No substring-position function exists in both dialects (`instr` is SQLite-only, `strpos`/`position(… in …)` Postgres-only), and Drizzle `sql` fragments cannot see the dialect while rendering, so `containsText` picks `instr(lower(col), ?) > 0` or `strpos(lower(col), $n) > 0` from the column's class (`SQLiteColumn` or not); a column always belongs to a table built for one dialect (B-05). The needle is folded in JS (A–Z only) instead of `lower(?)`, which Postgres cannot type for an untyped parameter. Relies on the harness database's C ctype for ASCII-only `lower()` on Postgres (DEC-0106); measured: `àpple` does not match `ÀPPLE` on both local dialects.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0140 — Failure mapping, PAR-210 locally, forced outage and logging
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-006, SQL-AC-006, LOG-REQ-005, LOG-AC-005, sql.md §2.2 "Failures", B-08, B-16

- `SQL.CONFLICT`: anywhere in the error's `cause` chain (Drizzle 0.45 wraps driver errors in `DrizzleQueryError`), SQLSTATE `23505`/`23503` or a SQLite message `UNIQUE|PRIMARY KEY|FOREIGN KEY constraint failed`. The message is generic (no values or names), because 409 messages reach the client.
- `SQL.UNAVAILABLE` (local adapters): messages `PGlite is closed`, Miniflare's `poisoned stub` (binding used after `dispose`), and connection-level ones (`Network connection lost`, `ECONNREFUSED`, `ECONNRESET`, `fetch failed`); also any operation not settled within PAR-210 (45 s; the late outcome is ignored). Observed messages: unit test "a database that cannot be reached …" in `src/sql/queries.unit.test.ts`. The Data API retry loop is AWS and not built.
- Anything else from a driver: `FrameworkError("CORE.INTERNAL")` carrying the driver message and `cause` (logged; the HTTP handler returns only the catalogue meaning for status ≥ 500), so no driver error reaches app code.
- Adapter options (`SqlAdapterOptions`, exported from `src/sql/drivers.ts`): `unavailable: true` (for `createTestApp`'s `unavailable: ["sql"]`, B-16) fails every operation with `SQL.UNAVAILABLE` without running it; `budgetMs` (tests only); `log`: when given, every `SQL.UNAVAILABLE` is written once through `logFailure` (component `SQL`). KV (B-08) should create its handle without `log` and log its own `KV.UNAVAILABLE`, so a KV outage is not logged as a SQL one.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0141 — `sum`/`avg` normalisation
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-REQ-003, sql.md §2.2

`sum(x)`/`avg(x)` are `sql\`sum(${x})\`.mapWith(toJsNumber)`: numbers pass, strings and bigints (Postgres `numeric`/`bigint`) become numbers, and an unsafe integer or non-finite value is `SQL.INVALID_VALUE`. NULL (empty or all-NULL input) stays null (Drizzle does not call the decoder for NULL). `count`/`countDistinct`/`min`/`max` stay Drizzle's (already `Number`/column-mapped).

No portable bound-parameter or statement-size limit is added (A-08, DEC-0102; PAR-216, PAR-217 are cited in sql.md "Common needs").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0142 — Migration file layout, snapshots, checksums and record format
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-REQ-001, MIG-REQ-002, MIG-AC-001, MIG-AC-002, migrations.md §2 "Generation", "Record", B-15, B-17, D-04, DEC-0224, DEC-0236

migrations.md fixes the directories and the record columns but not file names, how drizzle-kit learns the previous schema, the `checksums.json` format or the record `id`. Chosen, simplest that meets them:
- Files: `migrations/<dialect>/<nnnn>_<slug>.sql`, same base name in both dialects, `<nnnn>` = highest existing number + 1 (4 digits), `<slug>` = `schema` unless the caller names one (lowercase snake_case). Statements joined with drizzle-kit's `--> statement-breakpoint` lines.
- drizzle-kit is driven through `drizzle-kit/api` (`generateSQLiteDrizzleJson`/`generateSQLiteMigration`, `generateDrizzleJson`/`generateMigration`), so it never prompts; no drizzle config file or `_journal.json`. The previous schema is the snapshot saved with the newest file, `<dialect>/meta/<base>.json`; a newest file without a snapshot (hand-written) makes generation fail with a message. Deleting an unapplied last pair (and its snapshots) and generating again reproduces it.
- `checksums.json`: `{ "<dialect>/<file>.sql": "<sha256 hex of the UTF-8 text>" }`, keys sorted; generation only adds entries for new files, never recomputes existing ones, and drops entries of files that no longer exist. Snapshots are not checksummed (they only steer the next generation).
- Record: `id` = `<history>/<base name>` with history `framework` or `app` (so app and framework IDs never collide and an app ID contains its file base name, as the B-T2 suites assume), `dialect` = `sqlite`/`postgres`, `checksum` = the file's SHA-256 hex, `applied_at` = epoch ms (`integer` on SQLite, `bigint` on Postgres).
- Framework tables are plain Drizzle tables in `src/mig/framework.ts` (not `defineTable`: `__framework_kv.key` is text, not a UUID): `__framework_kv(key text primary key, value text not null)`, `__framework_migrations(id text primary key, dialect, checksum, applied_at not null)`. Their history `FW/migrations/{sqlite,postgres}/0000_framework_tables.sql` (+ `checksums.json`) is produced by the same engine; a unit test fails if the shipped files differ from what the engine generates. KV (B-08) uses `frameworkTables(dialect).kv`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-07.

### DEC-0143 — The generator also refuses changes to existing columns
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: migrations.md §2 "Supported changes", CHECK-REQ-004, B-15

migrations.md requires refusing drop+add diffs (tables, or columns of one table). Besides those, the engine refuses — with a message naming the add-copy-drop pattern, before writing anything — a change to an existing column's type, nullability, default or primary key, and a NOT NULL column without a static default added to an existing table. These are exactly the unsupported changes of CHECK-REQ-004; without the refusal drizzle-kit would emit a SQLite table rebuild that D1 cannot run on referenced tables (DEC-0095) and the checker would reject anyway. The checker (B-15) still has to catch them in hand-written files (CHECK-AC-004 uses hand-written pairs). Not refused (not in the whitelist, rare, left to the checker): adding a foreign key to an existing column.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-07.

### DEC-0144 — Local reading of MIG-AC-002/-003 and in-place application
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-REQ-002, MIG-REQ-003, MIG-AC-002, MIG-AC-003 (local), migrations.md §2 "Local", B-16, B-17 (`dev`), B-07

Same reading as B-T2's draft (merged below): locally a deployment is a `dev` start (or a `createTestApp` on fresh storage) that applies pending migrations in place; there is no copy and no second database. Each pending migration is applied atomically with its record row (local D1: one `batch` prefixed with `PRAGMA defer_foreign_keys = on`, the same shape as Cloudflare's DEC-0093 request; PGlite: one transaction). On failure the applier stops, leaves the database exactly as before that migration (earlier migrations of the same run stay applied — each is its own unit, as on Cloudflare), and throws `MigrationFailedError` (migration ID, file, cause, IDs applied before it); `dev` must exit non-zero and `createTestApp` must reject. "The old app answers again" = a `dev` start with the previous sources and committed migrations serves the unchanged database. With nothing pending the applier writes nothing (no record update). Following DEC-0094, an error is not taken as proof of rollback: the record is re-read and a migration found there counts as applied. Evidence: `src/mig/apply.unit.test.ts` on local D1 (getPlatformProxy) and PGlite; a mutation that runs the D1 statements one by one instead of as one batch makes the failing-migration test fail (checked once by hand, not committed).

B-T2's draft of the same decision ("MIG-AC-002/-003 local interpretation"): Locally a "deployment" is a `dev` start: it applies pending migrations in place to the persistent local D1 database (migrations.md §2 "Local"). Hence: initial deployment = first `dev` start; second deployment with no changes = another `dev` start with the same sources, which must leave the whole database (schema, every row, the migration record including applied times) byte-for-byte equal and answer the health check and the app's routes; "neither stops the app" has no separate local meaning (local deploys are `dev` restarts) and is checked as "applies nothing". A failing deployment = `dev` exits non-zero instead of serving; "unchanged" = identical database snapshot; "no new database behind" = exactly one local D1 database file; "the old app answers again" = `dev` with version 2's sources and committed migrations serves the unchanged data; the re-run path tested is "after correcting the data". `dev`'s address is the first `http://localhost:<port>` it prints (LOCAL-REQ-004) on which `/api/__framework/health` answers 204; `dev` is stopped with SIGINT to its process group. The database is read from Miniflare's SQLite file under `.wrangler/state/**/d1/` after `dev` stops (Node's `node:sqlite`). These criteria are not run on PGlite: `dev` uses local D1 only, and PGlite exists only in test processes with fresh storage.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-07, B-T2 (drafts merged).

### DEC-0145 — No checksum or order check when applying locally
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-REQ-001, B-15, B-17

The local applier does not compare recorded checksums with the files, and does not refuse a pending file that sorts before an applied one: `verify`'s migration checker (B-15) owns edit detection, and local data is disposable (`reset-local`). Recorded migrations whose files are missing (e.g. a newer version's migrations after switching back to old sources) are ignored.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-07.

### DEC-0146 — Empty values are accepted (KV-REQ-002 over KV-AC-002) — open owner item
Origin: ai-proposed · Status: accepted (interim assumption under the owner's instruction; owner decision outstanding: KV-AC-002 vs KV-REQ-002, plan §11 Q6) · Affects: KV-REQ-002, KV-AC-002, kv.md §2, DEC-0225

**Conflict, for the owner.** KV-AC-002 says "Empty, oversized, and malformed keys **and values** are rejected with the specified codes". KV-REQ-002 rejects only empty keys ("Keys MUST be non-empty …"); for values it names only malformed text (`KV.INVALID_KEY`) and more than PAR-223 bytes (`KV.VALUE_TOO_LARGE`), and the catalogue has no code meaning "empty value" (`KV.VALUE_TOO_LARGE` is "exceeds the KV value size limit"). The criterion's "empty … values" clause therefore has no specified code to be rejected with. Chosen: the requirement wins (binding, CONVENTIONS); `put(k, "")` stores the empty string and `get(k)` returns `""` (not null), as the B-T2 suite expects (DEC-0225). Neither the requirement nor the criterion text was edited. **Open owner question:** either drop "and values" from KV-AC-002's "Empty" clause, or add an empty-value rule (and a code) to KV-REQ-002.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0147 — Prefix rules: empty prefix lists every key; over PAR-220 bytes rejected
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: KV-REQ-001, KV-REQ-002, kv.md §2

KV-REQ-002 requires prefixes to be well-formed but gives no length rule; the catalogue's `KV.INVALID_KEY` meaning ("Key or prefix is empty, malformed, or too long") is read as describing the code's cases jointly, not as a requirement that prefixes be non-empty. Chosen: a prefix is well-formed text of at most PAR-220 bytes (a longer prefix can match no key, and the B-T2 suite expects `KV.INVALID_KEY`), else `KV.INVALID_KEY`; the empty prefix is allowed and lists every key (simplest; "keys starting with the prefix").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0148 — `limit` is clamped, not rejected
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: KV-REQ-003, kv.d.ts `KvListOptions.limit`, kv.md §2

No catalogue code exists for a bad page size, and kv.d.ts only names a default and a maximum. Chosen: absent or non-finite → PAR-221; otherwise `floor`, clamped to 1…PAR-222.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0149 — KV's own SQL handle and failure mapping (KV-REQ-005, LOG-REQ-005)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: KV-REQ-005, KV-AC-005, LOG-REQ-005, kv.md §2, DEC-0140, B-16

`createKv(db, { log })` (`src/kv/service.ts`) takes a handle made by `sqliteDb`/`postgresDb`. B-16 must build that handle **separately from `c.var.sql`'s**: same binding/client, with `unavailable` set when `createTestApp`'s `unavailable` contains `"sql"` **or** `"kv"`, the same `budgetMs`, and **no `log`**; and pass the request's log to `createKv`. Then: `SQL.UNAVAILABLE` (forced, PAR-210 budget, unreachable database) becomes `KV.UNAVAILABLE` with the SQL error as `cause`, written once via `logFailure` (component `KV`; the HTTP handler's later `logFailure` of the same object writes nothing), so no `SQL` entry appears for a KV outage. Any other `SQL.*` code (e.g. `SQL.RESULT_TOO_LARGE`, which the PAR choices make impossible) is a framework fault and becomes `CORE.INTERNAL`, so no SQL code surfaces from KV. `KV.*` and `CORE.*` errors pass unchanged. Evidence: `src/kv/service.unit.test.ts` ("storage that cannot be used": forced outage and a closed database, both dialects).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0150 — Cursor form; one extra row per page
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: KV-REQ-003, KV-AC-003, KV-AC-005, kv.md §2

The cursor is base64url (no padding) of UTF-8 JSON `[prefix, lastKey]`; decoding requires the canonical re-encoding to match, so an altered cursor (e.g. a character appended) is `KV.INVALID_CURSOR`. Not signed: a forged cursor can only skip ahead within its own prefix, which exposes nothing. Each page query fetches `limit + 1` rows so `nextCursor` is null exactly when nothing remains (kv.d.ts), in one query; a maximum page plus one row is 51 × (1,024 + 4,096) = 261,120 bytes ≤ PAR-215 (262,144). If PAR-220/222/223 grow, that margin must be rechecked (the unit test "a maximum page of maximum-size entries" fetches exactly this case on both dialects).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0151 — The local target reads `config/local.json` for every stage
Origin: ai-proposed · Status: accepted · Affects: CFG-REQ-002, CFG-AC-002, config.md §2, B-16, B-17

`stageConfigPath(deployment)` (`src/config/files.ts`): target `local` → `config/local.json` whatever the stage (local development has one values file, LOCAL-REQ-002); a cloud target with a `test-*` stage → `config/<target>/test.json`; any other stage → `config/<target>/<stage>.json`, with no fallback. A missing file fails with a message naming exactly that file (for a production stage, also that it needs its own committed file). Reason: config.md and local.md name only `config/local.json` for local; there is no `config/local/` directory in the design. If a local `test-*` build ever needs `test.json`, that is a change to this one function.
Item: B-09.

### DEC-0152 — Build-time configuration failures are `CORE.MISCONFIGURED`, listing every problem
Origin: ai-proposed · Status: accepted · Affects: CFG-REQ-002, CFG-AC-002, CFG-AC-006, B-16, B-17

The catalogue has only `CFG.UNDECLARED_KEY` (a runtime read). Build failures use `FrameworkError("CORE.MISCONFIGURED", message)`, as B-02 does for the name rules (DEC-0118). The message names the values file and lists every problem on its own line: schema violations as `"<path>": <reason>` or `unknown field "<path>"` (CFG-AC-006), and resolution problems as `key "<name>" is missing | must be <type> | is not declared by the app`. All problems are reported at once so the owner fixes the file in one pass. The JSON schema is mirrored in Zod (`src/config/schema.ts`, `z.strictObject` at every level, unique non-empty user IDs); a unit test checks the mirror's field set against `stage-config.schema.json`. No contract change.
Item: B-09.

### DEC-0153 — Shape of the resolved configuration and the embedded module
Origin: ai-proposed · Status: accepted · Affects: CFG-REQ-003, CFG-REQ-004, CFG-REQ-005, DEC-0063, B-10, B-12, B-16, D-01

`resolveStageConfig(deployment, { config, secrets }, read)` is the build's one call; it returns a frozen `ResolvedConfig` = `{ deployment, values, admins, users?, google?, secrets: [{ name, location }] }`. `admins` defaults to `[]`; `users` and `google` are present exactly when the file has them (no users list otherwise, AUTH-REQ-003). `generateConfigModule(resolved)` returns module source with no imports whose default export is that object as JSON data (`<`, U+2028, U+2029 escaped); the target entry point passes it to `createConfigService(resolved)`, a frozen object with only `get`, whose list values are frozen. Provisioning-derived identifiers (database, buckets, public origin) are not in `ResolvedConfig`: per config.md §2 "Delivery" only adapters read them from Worker variables, so they are D-01/D-03's, read at runtime. The build-time flag "production build does not require `framework.google`" holds: deploy preflight (PROV-REQ-002) checks it.
Item: B-09.

### DEC-0154 — Key-name rule and typed defaults
Origin: ai-proposed · Status: accepted · Affects: CFG-REQ-001, config.d.ts (comment "lowerCamelCase names")

Declared key names must match `^[a-z][a-zA-Z0-9]*$`; a default must have the key's type (an integer default must be a whole number). Both are checked at build time, failing like DEC-0152, not at declaration time, so `defineApp` and module load never throw (core.md: deferred misconfiguration).
Item: B-09.

### DEC-0155 — Secret locations computed in CFG for SEC's convention
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-003, CFG-REQ-004, CFG-AC-004, B-10

`src/config/secret-locations.ts` has `upperSnake(name)` (an underscore before each capital, then upper case: `apiKey` → `API_KEY`, `smtpURL` → `SMTP_U_R_L`) and `secretLocation(target, name)` = `SECRET_<NAME>` for local and Cloudflare (SEC-REQ-003). CFG needs the locations for the resolved configuration and B-10 has not started, so the function lives here; B-10 should import it rather than duplicate it (one convention, one place). The AWS form is added with the AWS target.
Item: B-09.

### DEC-0156 — Framework-internal secret names; the reserved prefix is a plain `framework` prefix
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-001, SEC-REQ-003, secrets.md §2, DEC-0064, B-11, B-12, B-13, B-16, D-01, D-02, D-03

`src/secrets/names.ts` defines `FRAMEWORK_SECRETS`: `frameworkSessionKey` (AUTH), `frameworkGoogleClientSecret` (GOOGLE; the name B-13 already reads, DEC-0176, so no mismatch), `frameworkR2AccessKeyId` and `frameworkR2SecretAccessKey` (FILES' R2 token as S3 credentials, created by provisioning), and `frameworkLocalTicketKey` (FILES' local transfer route; local only). Locations follow SEC-REQ-003 through CFG's `secretLocation` (e.g. `SECRET_FRAMEWORK_SESSION_KEY`). A name is reserved when it starts with `framework` (simplest reading of "reserved prefix"; `frameworks` is reserved too). `checkSecretDeclarations(names)` is the build's check of the app's declared names (lowerCamelCase `^[a-z][a-zA-Z0-9]*$` like CFG keys, no duplicates, not reserved), failing with `CORE.MISCONFIGURED` listing every problem (as DEC-0152); B-16 calls it. At runtime a reserved name is `SEC.UNDECLARED` for the app even if declared, so the check is not the only guard.
Item: B-10.

### DEC-0157 — Runtime service shape: one per request over a reader; empty is missing; store errors are not echoed
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-001, SEC-REQ-002, SEC-REQ-005, LOG-REQ-005, B-12, B-13, B-16, D-01

`createSecretsService({ declared, read, log })` (`src/secrets/service.ts`) is the app's `Services.secrets`; the runtime's `createServices` makes one per request, so the value reuse inside it is per request only (SEC-REQ-005). `read(name)` is the target's store; `envSecretReader(env, target)` reads `SECRET_<NAME>` from the Worker env for local and Cloudflare (D-01 can use it unchanged). An absent, empty, or non-string value is `SEC.MISSING` (an empty `.dev.vars` assignment or Worker secret is not a usable value); misses are not remembered, so a later read in the same request may see a value. A non-`FrameworkError` from the reader becomes `SEC.UNAVAILABLE` with a message naming only the secret, logged once with `logFailure` (DEC-0129) when a log is given; the reader's own error is not attached, so nothing it holds reaches logs or responses. No time budget is applied: there is no SEC parameter, and the local and Cloudflare readers are synchronous env lookups. Framework code uses `createFrameworkSecrets({ read, log })`, which accepts only `FRAMEWORK_SECRETS` names (AUTH's and GOOGLE's `getSecret` can be built on it).
Item: B-10.

### DEC-0158 — `secrets set` argument rules and stdin handling (SEC-AC-004 logic)
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-004, SEC-AC-004, CLI-REQ-004, B-17

`src/secrets/set-command.ts`: `parseSecretsSetArgs(args after "secrets set")` accepts exactly one positional (the name) and `--target`/`--stage` (space or `=` form, once each, target `local` or `cloudflare`). A second positional, `--value`, or any unknown option is refused with `SecretsSetUsageError`; no message repeats any argument (a value typed by mistake is never printed, CLI-REQ-004). `readSecretValue(stdin)` decodes UTF-8 across chunks and removes one trailing `\n` or `\r\n` (what `echo` adds); empty input is refused. `checkSettableName(name, declared)` accepts a declared app secret or any framework-internal name (the owner sets `frameworkGoogleClientSecret` this way; replacing the session key is allowed) and lists the settable names without repeating the input. The CLI (B-17) composes parse → load app → check name → read stdin → `setLocalSecret` for `--target local`; the stage is accepted but unused locally (one `.dev.vars`, as DEC-0151 for config).
Item: B-10.

### DEC-0159 — `.dev.vars` writing matches how Wrangler reads it
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-003, SEC-AC-003, secrets.md §2 Local, B-17

Wrangler 4.149.0 (PAR-101) loads `.dev.vars` with its bundled dotenv 16.3.1 `parse` and then dotenv-expand 12.0.2 `expand` (`node_modules/wrangler/wrangler-dist/cli.js`, `loadDotEnv`), so `$NAME` in a value would be substituted. `src/secrets/dev-vars.ts` transcribes those read rules (`readDevVars`), escapes every `$` as `\$`, and writes the value with the first quoting (`'`, `"`, `` ` ``) whose line reads back exactly; a value with a line break, or one no quoting represents (e.g. containing all three quotes and a `#`), is refused with a message naming only the location. Setting a name replaces its first assignment in place (also a multi-line quoted one), removes duplicates, keeps every other line, and normalises line endings to `\n`. `src/secrets/local.ts`: `setLocalSecret(appDir, name, value)` is local `setSecret`; `ensureDevSecrets(appDir)` (called by `dev`) adds `frameworkSessionKey` and `frameworkLocalTicketKey` when absent or empty, each 32 random bytes (PAR-253) in base64url, never changing an existing value, and returns the names generated. The file is written with mode `0600`. The unit tests check the written text with an independent transcription of Wrangler's read rules; the real Wrangler round trip is covered by B-T1's integration suite (`test/integration/secrets/cli.test.ts`).
Item: B-10.

### DEC-0160 — One target-neutral service over the store, plus a ticket issuer per target; ticket JSON shape
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-001, FILES-REQ-003, FILES-REQ-004, files.md §2, B-16, D-02

`createFilesService({ store, tickets, log? })` (`src/files/service.ts`) is the app's `Services.files`. `store` is the subset of the R2 Worker binding FILES uses (`FilesStore`: `put`, `get`, `head`, `delete`, `list` with `prefix`/`limit`/`startAfter`/`include`), so local and Cloudflare share the same code. `tickets` is the target's `TicketIssuer` (`upload(name, contentType)`, `download(name)`): `createLocalTicketIssuer` locally (DEC-0161), and D-02's SigV4 issuer on Cloudflare. Tickets are plain JSON (`src/files/tickets.ts`). Upload tickets are `{ url, method: "PUT", headers: { "Content-Type": … }, expiresAt }` and download tickets are `{ url, expiresAt }`, with `expiresAt` in epoch milliseconds (a number, so it can never equal a log timestamp string). The browser helpers read only these fields, so D-02 must issue the same shape with its signed URL. The fields are runtime-only: the contract types stay opaque brands (FILES-AC-004 type inspection passes unchanged). `createDownloadTicket` checks `head` and throws `FILES.NOT_FOUND` with the name in its message. The upload ticket's content type defaults to `application/octet-stream`; any other string, including an empty one, is used as given.
Item: B-11.

### DEC-0161 — Local tickets: HMAC-signed token in the last path segment; refusals are empty 403/404 and not logged
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-003, FILES-REQ-005, FILES-AC-003, FILES-AC-004, SEC-AC-002, CORE-REQ-006, files.md §2 Local, B-16

- **URL and token.** URL `/api/__framework/files/<token>` is relative, which is the simplest same-origin form. B-T3's harness relies on it (DEC-0231). The token is `base64url(JSON {o, n, t?, e}) "." base64url(HMAC-SHA-256)`, signed with the framework-internal secret `frameworkLocalTicketKey` (DEC-0156). It is one path segment, so names containing `/`, `..` or `%` are never rewritten by URL normalisation. Verification uses `crypto.subtle.verify` (constant time).
- **Expiry.** A ticket is valid while `Date.now() < e`, with `e` = issue time + PAR-233.
- **What the route accepts.** `src/files/local/route.ts` serves `PUT` for upload grants, which must send exactly the ticket's `Content-Type`, and `GET` for download grants. A refusal is an empty 403 with `nosniff` and `sandbox`. A download of a file that has since been deleted is an empty 404. Success is 200: an empty body for an upload, or the stored bytes with `Content-Type` and `Content-Length` for a download.
- **Attachments.** `Content-Disposition: attachment` is set for every type except `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif` and `image/bmp`, which are compared on the media type, lowercased and without parameters.
- **No logging.** Refusals are not logged, so ticket URLs never reach the log (SEC-AC-002). Any 5xx is logged by HTTP with the route pattern `/api/__framework/files/:token`, never the token (DEC-0124).
- **No CORS.** The route sends no CORS headers and answers no `OPTIONS`, so an unrelated origin's preflighted `PUT` and its `fetch` `GET` are blocked by the browser (FILES-AC-004 browser part).
- **Local only.** Locally the expired-ticket status (403) is readable same-origin, so FILES-AC-003's clause holds locally. DEC-0101 concerns Cloudflare only.
- **Local-only files.** The route, the issuer and the key's name exist only under `src/files/local/`. `src/files/local-only.unit.test.ts` checks that no shared FILES module mentions or imports them.
Item: B-11.

### DEC-0162 — `list` paging: own cursor over `startAfter`, pages filled to the limit, limit clamped
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-001, FILES-AC-001, PAR-231, PAR-232

- **Cursor.** The cursor is `base64url(JSON {p: prefix, a: lastName})` (`src/files/cursor.ts`), the same idea as KV's design. A cursor is `FILES.INVALID_CURSOR` when it is malformed, when its `a` is outside its own prefix, or when its prefix differs from the requested one. The next page lists with `startAfter: a`. Every object store can list after a key, and R2's own cursor is not used.
- **Full pages.** R2 may return short truncated pages when metadata is included. The service therefore asks again until it has `limit + 1` items (at most 1,000 per call) or the store is done. The extra item decides `nextCursor`, so an exactly full last page has a null cursor.
- **Limit.** `limit` is clamped to 1…PAR-232. A non-finite or absent limit means PAR-231. No error code exists for a bad limit, and clamping is the simplest choice.
- **Order.** Local R2 lists in code point order. Checked with `getPlatformProxy` (Wrangler 4.149.0): `p/Z` sorts before `p/a`, which sorts before `p/ä`, `p/€` and `p/😀`.
- **Prefixes.** A prefix follows the name rules except that it may be empty (`checkPrefix`). Names are also rejected when they are not well-formed Unicode (a lone surrogate).
Item: B-11.

### DEC-0163 — The local route buffers upload bodies
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-003, files.md §2 Local, B-16

Passing a Node request body stream to the local R2 binding through `getPlatformProxy` fails with "Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)". This was observed with a scratch probe against Wrangler 4.149.0 and a 3 MB `Request` body. The route therefore reads the body with `arrayBuffer()` and stores the bytes through `FilesService.put`. This applies in `createTestApp` and under `dev`. It is local only, so the limit is the machine's memory, not a framework limit. A 20 MiB upload and a byte-exact download through the route against local R2 were checked the same way. Cloudflare uploads go directly to R2 and do not pass through the Worker.
Item: B-11.

### DEC-0164 — `FILES.UNAVAILABLE` mapping and the upload-ticket reachability check
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-006, FILES-AC-006, LOG-REQ-005, B-16

- **Mapping.** The service wraps the store. Any thrown value that is not a `FrameworkError` becomes `FILES.UNAVAILABLE` with the message `file storage could not be used (<op>): <name>: <message>`. It is logged once through `logFailure` when a `log` is given (DEC-0129). The message goes to the log only, because responses of 500 and above carry the catalogue meaning (DEC-0123). A `FrameworkError` passes through unchanged.
- **No time budget.** No FILES parameter sets one, and the binding fails fast.
- **Upload tickets.** `createUploadTicket` calls `store.head(name)` before signing. It therefore fails with `FILES.UNAVAILABLE` when storage is unreachable, as B-T3's FILES-AC-006 server test expects for every server operation, and a ticket is never issued for storage that cannot take the upload. The cost is one metadata read per ticket.
- **Simulating `unavailable`.** How `createTestApp({ unavailable: ["files"] })` simulates this is B-16's choice. The simplest way is to pass a store whose methods reject (as `unreachableStore()` in `src/files/fake-store.test-support.ts` does for unit tests).
Item: B-11.

### DEC-0165 — Browser helper details
Origin: ai-proposed · Status: accepted (interim assumption; owner decision outstanding: non-ticket failure class vs FILES-REQ-006, plan §11 Q7) · Affects: FILES-REQ-003, FILES-REQ-006, client.d.ts, FILES-AC-003, FILES-AC-006

- **Upload request.** `uploadFile` sends one `XMLHttpRequest` with the ticket's method, URL and headers, and the Blob as body. It uses XHR because `fetch` reports no upload progress.
- **Progress.** Progress is reported as `{ loaded: event.loaded, total: file.size }`.
- **Content-type check.** A non-empty `Blob.type` must equal the ticket's `Content-Type`, compared case-insensitively. Browsers lowercase `Blob.type`, and the ticket's own value is what gets sent. Otherwise the upload is rejected before sending with status null and `content type does not match ticket`.
- **Failures.** Each failure is `ApiError` with `FILES.TRANSFER_FAILED` and `requestId` null. The message never includes the response body.
  - A non-2xx response gives storage's status and `rejected by storage (HTTP n)`.
  - `error`, `abort` or `timeout` after any upload progress with `loaded > 0` gives status null and `interrupted after <last loaded> bytes`.
  - The same events with no progress give status null and `no response: network or cross-origin blocked`.
- **Not a ticket.** A value that is not a ticket of the right kind fails before sending with `FILES.TRANSFER_FAILED`, status null, and `rejected before sending: not an upload ticket` (or `download`). FILES-REQ-006 lists no class for this case, and "rejected before sending" is the nearest. `downloadUrl` throws that error synchronously.
- **Download URLs.** `downloadUrl` returns the ticket's URL unchanged (relative locally).
Integration (B-INT): FILES-REQ-006 (binding) lists the failure classes a message must name, and "not a ticket" is none of them; recorded as an open owner item (plan §11 Q7). The requirement text was not edited.
Item: B-11.

### DEC-0166 — Runtime shape: `createAuthParts(options)` → `{ currentUser, forgeryCheck, routes }`
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-003, AUTH-REQ-005, AUTH-REQ-008, core.md §2, B-16, D-01

`src/auth/runtime.ts` exports `createAuthParts({ deployment, publicOrigin, framework, secret, provider?, mock?, cookies? })`. `currentUser` and `forgeryCheck` fill `assembleApp`'s slots; `routes(api)` registers `/auth/{login,callback,logout,me}` (and the mock's `/auth/mock-login`) on the framework `/api` router, so the target runtime calls it inside `frameworkRoutes` next to HTTP's. `publicOrigin` is a string or `(c) => string` supplied by the target (never request headers); `framework` is CFG's resolved `{ admins, users?, google? }`; `secret(c, name)` reads framework-internal secrets (B-16 can build it on SEC's `createFrameworkSecrets`); the session key is read only when a request carries an AUTH cookie. The provider's `getConfig` answers dotted paths below `framework` (e.g. `framework.google.clientId`, DEC-0176); `getSecret` is `secret`. `checkAuthSettings(options)` holds the wiring checks (mock only locally or on `test-` stages; local cookie settings only on the local target) and runs as a deferred check on the first request (core.md §2), so the build can also call it. All time checks use `Date.now()`, so fake `Date` timers govern them (core.md §2 "Testing").
Item: B-12.

### DEC-0167 — Cookie names and attributes
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-006, AUTH-AC-006, LOCAL-REQ-004, LOCAL-AC-004, auth.md §2

Session: `session_local` / `__Host-session`; transaction: `login_local` / `__Host-login`. Both `Path=/; Max-Age=<s>; HttpOnly; SameSite=Lax`, plus `Secure` on cloud targets; never `Domain`. Max-Age is PAR-250 (604800) and PAR-251 (600); clearing uses an empty value and `Max-Age=0`. `cookieSettings(target, "local")` on a cloud target is `CORE.MISCONFIGURED` ("cloud builds reject the local cookie settings"). Tokens are `base64url(JSON).base64url(HMAC-SHA-256)` over `<purpose>.<payload>`, purpose `session` or `login`, so neither cookie is accepted as the other; decoding is strict (canonical unpadded base64url). The key is the `frameworkSessionKey` string's UTF-8 bytes; fewer than PAR-253 bytes is `CORE.MISCONFIGURED` (message does not contain the key). Times are whole seconds.
Item: B-12.

### DEC-0168 — Failed-login handling
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-010, AUTH-AC-010, auth.md §2 "Failed login"

A missing, tampered, crossed-version or expired transaction cookie is "transaction missing or expired". Otherwise only a `FrameworkError` `AUTH.LOGIN_FAILED` from `completeLogin` is a failed login, and its message is logged as the reason (B-13 words its messages as AUTH's fixed reasons, DEC-0177); any other error propagates to the error handler (500), since it is a bug, not a refused login. The entry is `warn`, component `AUTH`, message `login failed: <reason>`, written through the request's log (so it carries `requestId`). Redirect: relative `Location: /?authError=login_failed&requestId=<id>`. Every callback response clears the transaction cookie. All `/api/auth/*` responses carry `Cache-Control: no-store`.
Item: B-12.

### DEC-0169 — Mock sessions carry their level; honoured only where the mock is installed
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-006, AUTH-REQ-009, AUTH-AC-009, auth.md §2 "Session cookie"

`/api/auth/mock-login` must give later requests the level the test chose (AUTH-REQ-009: "access level … used as given"), while real-provider sessions store no level (AUTH-REQ-003). So a mock session's signed payload has an extra `lvl` field (`user` | `admin`). The current-user middleware treats a `lvl` session as anonymous unless the mock is installed, so a mock session can never grant a level on a production deployment even if one were minted with the same key. Mock identities bypass `framework.admins` and `framework.users`. A future issued-at beyond PAR-252 (60 s) makes any session invalid; PAR-252 is reused instead of adding a parameter.
Item: B-12.

### DEC-0170 — "Carries a session" for the forgery check
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-007, AUTH-AC-007

A POST/PUT/PATCH/DELETE is checked when it sends a session cookie (valid or not — simplest and stricter) or when the mock's fixed identity (`createTestApp` `user` / `as`) is a logged-in user. Then `Origin` must equal the public origin's `URL.origin` exactly; a missing Origin is rejected. Requests without a session are not checked (the mock-login route itself can therefore be called without an Origin when no session exists).
Item: B-12.

### DEC-0171 — The mock module, its route, and login without a real provider
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-009, CORE-REQ-006, AUTH-AC-009, B-16

`src/auth/mock.ts` exports `createAuthMock({ fixedUser? })`; the target runtime passes it as `mock` only locally and on `test-` stages, so production entry points do not import it and B-16 can leave it out of production bundles. `fixedUser(c)` is `createTestApp`'s per-request identity (`user` option, `as()`); returning `undefined` lets the session decide (DEC-0229). `POST /api/auth/mock-login` validates the contract body strictly (`HTTP.INVALID_INPUT`, 400); `id` must be non-empty when given; default IDs are `mock-user` / `mock-admin` (also `mockUsers`' defaults), display name defaults to `null`; `anonymous` clears the cookie; the response is 204. Without the mock, the route is not registered (404 `HTTP.NOT_FOUND`). With the mock and no real provider (local `dev`), `GET /api/auth/login` sets a mock session for the default user and redirects to the sanitised `returnTo`, so the template's login button works locally; with neither, it is `CORE.MISCONFIGURED`.
Item: B-12.

### DEC-0172 — Stub provider behaviour
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-002, -003, -008, -010, -012, testing.d.ts `loginWithStub`, B-16, DEC-0227, DEC-0228

`src/auth/stub-provider.ts`: `createStubLoginProvider()` (id `"stub"`, as B-T3 assumed). `beginLogin` redirects to `<callbackUrl>?state=<random>&code=<random>` and returns the state as transaction state. `completeLogin` checks, in order: state equals the transaction state ("state mismatch"); an `error` parameter or no code ("provider refused"); a code already completed by this instance or a `replay` parameter ("token exchange rejected (HTTP 400, code already used)", modelling a provider's single-use code); then returns `{ subject: query.subject ?? "stub-subject", displayName: query.name ?? null }`. `stubCallbackUrl(redirectUrl, { subject, displayName?, failure? })` adds those parameters; B-16's `loginWithStub` should request `/api/auth/login`, pass the `Location` through `stubCallbackUrl`, and request the result with the transaction cookie (`failure` is `stubFailure`). The module is used only by `createTestApp`; no hub exports it.
Item: B-12.

### DEC-0173 — `returnTo` sanitising rule
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-010

Kept only when it starts with `/`, consists of printable ASCII without spaces (`\x21`–`\x7e`), has no backslash, percent-decodes, neither raw nor decoded form starts with `//` or `/\`, and resolving it against a placeholder origin stays on that origin. Anything else (including absent) becomes `/`. Query and fragment are kept. The browser `login()` default is the current `pathname + search + hash`.
Item: B-12.

### DEC-0174 — AUTH holds the canonical login-provider types; GOOGLE re-exports them
Origin: ai-proposed · Status: accepted · Affects: `internal/login-provider.d.ts`, B-13, `src/google/login-provider.ts`, B-12

`src/auth/login-provider.ts` is AUTH's transcription of the contract (unchanged). `src/google/login-provider.ts` is outside B-12's Owns line, so it still holds its own copy; the types are structurally identical. Integrator: replace GOOGLE's file body with `export type * from "../auth/login-provider.js";` (done by B-16a).

B-13's draft of the same decision ("GOOGLE carries a transcription of the login-provider contract until AUTH has one"): The framework source has no copy of `docs/contracts/ts/internal/login-provider.d.ts` yet: AUTH (B-12) owns it and runs in a later wave. Framework sources cannot import the contract file from `docs/`, because the emitted `dist/*.d.ts` would point outside the package. So `src/google/login-provider.ts` is a verbatim transcription. Once B-12 adds AUTH's copy, that file should re-export AUTH's types. Types are structural, so the two copies are compatible meanwhile. The factory is `createGoogleLoginProvider(options?)`, exported from `src/google/public.ts`, as the B-T3 suite assumes (DEC-0232). Its options `fetch` and `now` are optional, so the no-argument call works.
Items: B-12, B-13 (drafts merged).

### DEC-0175 — Browser `getCurrentUser` strips `unlistedId`
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-001, client.d.ts

`getCurrentUser()` calls `/api/auth/me` through `api` and returns only the `CurrentUser` fields, so browser app code never sees `unlistedId` (AUTH-REQ-001; auth.md: "app code never sees it"). A page that must show the unlisted ID to the person (skill/template "copy your ID") calls `api("/auth/me")` directly. `logout()` is `POST /api/auth/logout` via `api`.
Item: B-12.

### DEC-0176 — Names of the client ID key and client secret
Origin: ai-proposed · Status: accepted · Affects: GOOGLE, SEC (B-10), CFG (B-09), AUTH (B-12), `stage-config.schema.json`

- The provider calls `ctx.getConfig("framework.google.clientId")`, the dotted path of the stage-config field. AUTH's context must answer that key. A missing or empty value is `CORE.MISCONFIGURED` ("framework.google.clientId is not set").
- The provider calls `ctx.getSecret("frameworkGoogleClientSecret")`. That name uses SEC's reserved `framework` prefix in lowerCamelCase, so its upper snake case form is `FRAMEWORK_GOOGLE_CLIENT_SECRET` (env `SECRET_FRAMEWORK_GOOGLE_CLIENT_SECRET`). B-10 lists framework-internal secret names; it should use this name, or B-13's constant `GOOGLE_CLIENT_SECRET_NAME` should change to match.
Item: B-13.

### DEC-0177 — Failure messages are AUTH's fixed reasons; discovery failures are `AUTH.LOGIN_FAILED`
Origin: ai-proposed · Status: accepted · Affects: GOOGLE-REQ-001, GOOGLE-REQ-002, AUTH-REQ-010, auth.md "Failed login"

`completeLogin` throws `FrameworkError("AUTH.LOGIN_FAILED", reason)`. The reason is one of auth.md's fixed reasons, worded so that AUTH can log `err.message` as is:
- `transaction missing or expired`, for an unreadable transaction state;
- `state mismatch`, checked before anything else, and no token request follows;
- `provider refused`, for an `error` parameter or no code;
- `token exchange rejected (HTTP n)`, or `(no response)`, or `(HTTP n, no ID token)`;
- `token check failed: <check>`, where the check is `signature`, `issuer`, `audience`, `expiry`, `issued-at`, `nonce` or `subject`.

A failed or invalid discovery document is also `AUTH.LOGIN_FAILED`, with message `provider discovery failed (HTTP n | no response | invalid document)`, because the catalogue has no `AUTH.UNAVAILABLE` and adding a code is a contract change (B-02). Discovery is cached per provider instance only after it succeeds. Endpoints from discovery must be https URLs. Keys come only from discovery's `jwks_uri` (jose `createRemoteJWKSet`, given the provider's `fetch` through `customFetch`). A future `iat` beyond PAR-252 is checked explicitly, because jose checks it only when `maxTokenAge` is set. Only RS256 is accepted, since that is the algorithm Google signs ID tokens with.
Item: B-13.

### DEC-0178 — Certification library shape and record contents
Origin: ai-proposed · Status: accepted · Affects: GOOGLE-REQ-005, GOOGLE-AC-001 (cloud), GOOGLE-AC-005, `evidence.schema.json`, B-17/D-05 (`certify-auth` command), C (routine production check)

- `checkLoginRedirect({ origin, clientId, fetch? })` → `{ ok, problems[] }` is step 1 and the routine production check. "Redirects to Google" means the `Location` origin is `https://accounts.google.com`. The scope (exactly `openid profile`) and `response_type=code` are also checked.
- `certifyAuth(options, io)` refuses `test-` stages with `CORE.MISCONFIGURED`, stops at the first failed step, and always writes exactly one evidence record through `io.writeEvidence`. The record has `command` `certify-auth --target <t> --stage <s>` and two results: `GOOGLE-AC-001` (step 1) and `GOOGLE-AC-005` (all steps). A failed result's `detail` names the step and the problem. `exitStatus` is 0 only when everything passed.
- Step 3 requires level `user`, read literally: an admin test account fails. Its ID must match `u_` plus 26 base32 characters (`A–Z2–7`), letter case ignored, because auth.md does not fix the case (as DEC-0227).
- The evidence record type is declared in `src/google/certify.ts` from `evidence.schema.json`. COMPL (C-phase) may move it to `src/evidence/` and have GOOGLE import it.
- Nothing in this phase runs `certifyAuth` against a deployment: there is no production stage (prompt §4). GOOGLE-AC-001's cloud part and GOOGLE-AC-005 stay `not-run` ("Google login mocked for this phase").
Item: B-13.

### DEC-0179 — Rule engine independent of type checking, with a framework-built program
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-001, CHECK-REQ-006, check.md §2, B-17

`runPortabilityRules(appDir)` (`./check`) lints every `.ts/.tsx/.mts/.cts` file under `src/` and `tests/` with ESLint (PAR-111) using only the shipped configuration (`overrideConfigFile: true`, `allowInlineConfig: false`). Type information comes from a TypeScript program the engine creates with fixed app-lib-set options (`APP_COMPILER_OPTIONS`, identical to `tsconfig.app.json`), not from the app's `tsconfig.json`. Type errors never stop the rules, so `verify` can print both the type errors and the rule diagnostics (DEC-0238: `node:fs`, `.transaction()`, `db.query` fail both). B-17 should type-check with the same `APP_COMPILER_OPTIONS`, print `formatDiagnostics(...)`, and fail when either step reports anything. Rules resolve every reference through the type checker to its declaration (aliases, local re-exports, namespace imports, `const` copies) and classify declarations by the package that declares them (framework package root, `drizzle-orm`, `hono`, TypeScript lib files); framework declarations are recognised both in the workspace and under `node_modules`. Files under `src/` but outside `client/`, `shared/`, `server/` (e.g. `src/vite-env.d.ts`) are treated as server code; files outside `src/` and `tests/` are not app code. Only TypeScript files are app code.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-14.

### DEC-0180 — What each rule rejects (readings of check.md §1)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-001, SQL-REQ-002, CORE-REQ-005, CORE-REQ-007, check.md §2

Listed per rule in check.md §2 "What each rule takes as its construct". Readings worth review:
- `allowed-imports` uses a fixed deny list for platform SDKs and drivers (Cloudflare, AWS, SST, Pulumi, Vercel, Netlify, Google Cloud, Azure, PGlite, pg, postgres, mysql, SQLite drivers, libSQL, Neon, PlanetScale, drizzle-kit, Prisma, Kysely, Knex, TypeORM, Sequelize, MongoDB, Redis) plus every `scheme:` specifier; other npm packages are allowed. `drizzle-orm` (root) is allowed by this rule; its non-portable names are the SQL rules'. Framework subpaths follow CORE-REQ-005 literally: server code `.` only (not `./client`), tests `.` and `./testing`, shared code nothing; browser framework imports are `browser-api-only`'s. Browser code may not import server or test code even type-only; server code may not import browser or test code.
- `no-dialect-features` rejects all Drizzle SQL expressions and functions (`drizzle-orm/sql/**`) the framework does not re-export, rather than a named list; set operations (`union`, …), cross and lateral joins are rejected as "not supported" though sql.md §2.3 names only right/full joins; `groupBy` and `having` are not rejected. `min`/`max` accept `id()`/`ref()` columns (text values).
- `framework-ids` is narrow: only literal, template, call and `new` values (also through `const`) are traced; parameters and properties pass (SQL-REQ-004's run-time check covers the rest).
- `app-error-codes` judges the code by its type, so a parameter typed `ErrorCode` fails; `AUTH.UNAUTHORIZED` is rejected (not in CORE-REQ-007's table).
- `no-env-access` also covers `const { env } = process` and Hono `onError`/`notFound` by type.
- CHECK-REQ-002 "unchecked type assertions" includes non-null assertions (`x!`).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-14.

### DEC-0181 — Skill reference file names
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-003, CHECK-AC-003, SKILL-REQ-002, E-01, E-02

`src/check/references.ts` fixes the names under `skill/reference/`: `http-and-validation.md`, `sql-and-migrations.md`, `kv.md`, `files.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `local-development.md`, `deploying.md`, `testing.md`, `troubleshooting.md`, `owner-tasks.md` (skill.md §2 topics, plus the owner tasks E-02 writes). Rule → reference: `allowed-imports`, `browser-api-only`, `app-error-codes`, `no-raw-html` → `http-and-validation.md`; `no-env-access` → `configuration.md`; the six SQL rules → `sql-and-migrations.md`; type-escape bans, `no-suppression-comments` and anything else → `troubleshooting.md`. E-01/E-02 must create exactly these files; CHECK-AC-003 passes only once they exist.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-14.

### DEC-0182 — Raw-HTML sinks and suppression comments are framework rules
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-001 (last paragraph), CHECK-REQ-002, check.md §2

check.md §2 suggests "existing lint rules (for example `no-unsanitized`)". No such plugin is pinned in parameters.md and B-14 owns no `package.json`, so the shipped configuration uses its own `prototype-framework/no-raw-html` (browser code only; DOM sinks and React's `dangerouslySetInnerHTML`). Likewise `prototype-framework/no-suppression-comments` bans `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` and ESLint directive comments (typescript-eslint's `ban-ts-comment` was dropped because its `@ts-ignore` message recommends `@ts-expect-error`, which is banned too). Type escapes otherwise use typescript-eslint (PAR-111) `no-explicit-any`, `consistent-type-assertions` (`never`; `as const` stays allowed) and `no-non-null-assertion`. The rules import `@typescript-eslint/utils` types only (a dependency of the pinned `typescript-eslint`, same version); B-INT may declare it explicitly.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-14.

### DEC-0183 — Detecting app configurations that weaken framework rules
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-006, CHECK-AC-006, B-17

`checkAppLintConfig(appDir)` (also run by `runPortabilityRules`) imports the app's `eslint.config.{js,mjs,cjs,ts,mts,cts}` (default export, nested arrays flattened) and reports, as a diagnostic on that file naming the rule, every entry that sets a shipped rule to a lower severity than `error` or to different options; a plugin registered under another namespace with `meta.name: "prototype-framework"` is followed. A file that fails to load is itself a failure (rule `prototype-framework/lint-config`). `ignores` patterns and other settings of the app file are not inspected, because `verify` never uses that file for its rules.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-14.

### DEC-0184 — Supported changes are judged by each migration's schema effect, not its statements
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-004, CHECK-AC-004, MIG-REQ-001, MIG-REQ-003, migrations.md §2 "Supported changes", check.md §2

The checker applies the app history one migration at a time (framework history first, through MIG's `applyMigrations`, the same path as `dev`/`createTestApp`) to fresh local D1 (getPlatformProxy, not persisted, temporary config) and PGlite, introspects the schema after each, and diffs consecutive states per dialect. Supported: add or drop a table; add a column that is nullable or has a static default; drop a column (with its references); add or drop an index or a unique constraint. Rejected, each with a message naming the add-copy-drop pattern: a table removed and another added in one migration (rename); a column removed and another added in the same table in one migration (rename); a NOT NULL column without a default added to an existing table; a change to an existing column's type, nullability, default or primary key; a reference added to, or removed from, a column that is kept. A statement diff was rejected because drizzle-kit itself writes a supported change — dropping a `ref()` column on SQLite — as a table rebuild (`PRAGMA`, `CREATE TABLE __new_…`, `INSERT … SELECT`, `RENAME`), observed with the B-07 generator. In addition, statements that change data (`INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `TRUNCATE`, `MERGE`) are rejected, except drizzle-kit's rebuild copy `INSERT INTO __new_<t> (…) SELECT …`. A migration that fails to apply on a fresh database is reported with the database error (`migration-apply`) and that dialect's later migrations are not judged; e.g. SQLite cannot add a NOT NULL column without a default at all, so that case shows as `migration-apply` on SQLite and `migration-supported-changes` on Postgres.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-15.

### DEC-0185 — "Same logical schema": what is compared, and when
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-004, MIG-REQ-001, check.md §2

Per table: columns by SQL name with declared type, nullability, static default and primary key; non-unique indexes and unique column sets (unique constraints and unique indexes alike, by ordered column list, names ignored); references (`cols -> table(cols)` with update/delete actions). Declared types are compared by SQLite storage class (`integer` ≡ `integer`/`bigint`/`smallint`/`boolean`; `real` ≡ `real`/`double precision`/`numeric`; `text` ≡ `text`), since SQLite has no boolean or bigint; a Postgres `boolean` therefore matches any SQLite `integer`. Defaults are compared as SQL text after removing Postgres casts and wrapping parentheses (and unquoting quoted numbers of non-text columns). Framework tables are included. When both histories have the same file names, the dialects are compared after each pair and only the first diverging pair is reported (later pairs inherit it); otherwise only the final schemas are compared, when both histories applied completely.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-15.

### DEC-0186 — Checksums, layout and order
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-004, MIG-REQ-001, DEC-0142, DEC-0145

The local applier checks neither checksums nor order (DEC-0145), so the checker does, offline: every `migrations/<dialect>/*.sql` must have its SHA-256 recorded in `migrations/checksums.json` (missing entry: "not made by generate-migration"; different: "edited after it was generated"); every entry must name an existing file (a deleted, possibly applied migration); `checksums.json` must exist and be a JSON object when there are migrations. Layout: names `<nnnn>_<slug>.sql`; numbers 0000, 0001, … without gaps or repeats per dialect; the same base names in both dialects. Since checksums are keyed by file name, renumbering or inserting a file before applied ones is caught by numbering or by missing entries. The checker cannot know which migrations a cloud stage has applied; it does not compare migrations with the current table definitions (not required by CHECK-REQ-004).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-15.

### DEC-0187 — Diagnostics
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-003, CHECK-REQ-004, B-17

Diagnostics are `CheckDiagnostic`s (same layout through `formatDiagnostics`), located at line 1, column 1 of the migration file (or `migrations/checksums.json`), with rule IDs `prototype-framework/migration-checksums`, `-history`, `-apply`, `-supported-changes`, `-dialects` (`MIGRATION_CHECKS`) and reference `skill/reference/sql-and-migrations.md`. A dialect mismatch is reported once, on the SQLite file of the pair, naming both files and every difference (e.g. `column records.extra exists in postgres but not in sqlite`). These rule IDs are not ESLint rules and are not in `RULE_NAMES`/the shipped config.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-15.

### DEC-0188 — Build output layout and how the app module is loaded
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-REQ-002, cli.md §2, local.md §2, B-17, D-03, DEC-0214, DEC-0218, DEC-0240

`buildApp({ appDir, target, stage })` (`src/build/build.ts`) writes `<app>/.framework/<target>/{config.mjs, entry.mjs, worker.js}` (plus `wrangler.jsonc` locally), deleting the directory first. `config.mjs` is CFG's generated module; `entry.mjs` imports `../../src/app.ts`, `./config.mjs` and `<package>/targets/<target>`; `worker.js` is the esbuild bundle of the entry (ESM, minified, no legal comments, conditions `workerd`/`worker`/`browser`). `src/app.ts` must export the `defineApp` result as `default` or as `app`. To read the definition at build time (name, config declaration, secrets), `loadApp` bundles `src/app.ts` with esbuild for Node, keeping every import from outside the app directory external (so the app shares the caller's framework instance), imports it from `.framework/.load/` and deletes the file. Build failures are `CORE.MISCONFIGURED` with the components' messages (app/stage name rules, every values-file problem, secret declarations).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0189 — Mock and local-only code are excluded by the entry, not by flags
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-REQ-006, PROV-REQ-005, AUTH-REQ-009, CORE-AC-006, PROV-AC-005

`./targets/cloudflare` exports `createCloudflareWorker(app, config, { mock? })` and re-exports `createAuthMock`; only a test-stage entry imports and passes it. `./targets/local` (`createLocalWorker`) is the only runtime that imports the local ticket issuer, the transfer route and the mock unconditionally. The bundler marks framework modules (paths inside the package) `sideEffects: false`, so a module that only the runtime re-exports (the mock) leaves no code at all in a production bundle; `BundleResult.modules` lists only modules that contribute bytes. Not built here (phase D): the R2 log writer (D-01; until then Cloudflare entries print marked lines like local) and the SigV4 ticket signer (D-02; until then `createUploadTicket`/`createDownloadTicket` on Cloudflare fail with `CORE.MISCONFIGURED`). A production stage uses the Google provider; a test stage uses the mock, plus Google only when `framework.google` is configured.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0190 — Worker bindings, variables and the local Wrangler configuration
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: cloudflare.md §2 "Worker settings", config.md §2 "Delivery", B-17 (`dev`), D-01, D-03

Binding names: D1 `DB`, R2 `FILES`; Worker variable `FRAMEWORK_PUBLIC_ORIGIN` holds the stage's public origin (the only provisioning-derived value read in this phase; read per request, `CORE.MISCONFIGURED` when absent). Secrets are `SECRET_<NAME>` in `env` (SEC-REQ-003); every such value is redacted from responses and log entries. The local `wrangler.jsonc` is `{ name: "<app>-local", main: "worker.js", compatibility_date: "2026-10-01", d1_databases: [DB], r2_buckets: [FILES] }` with placeholder IDs; it sets no `vars` and no persist path. **For B-17:** `dev` must pass `FRAMEWORK_PUBLIC_ORIGIN=http://localhost:<vite port>` (e.g. `--var`), point Wrangler's state at `<app>/.wrangler/state` (`--persist-to`, B-T2 reads it there) and at `<app>/.dev.vars` (Wrangler reads `.dev.vars` beside the config file, which is under `.framework/local/`), and apply migrations to that state (MIG `migrateLocal` through `getPlatformProxy` with the same config and persist path) before starting Wrangler. The compatibility date is a constant in `src/build/build.ts`; no parameter was added.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0191 — Node-only imports of shared modules are replaced in Worker bundles
Origin: ai-proposed · Status: superseded by DEC-0197 · Affects: CF-REQ-003, CF-AC-003, CORE-AC-006, SQL (`sql/drivers.ts`), MIG (`mig/framework.ts`)

Two shared modules that Worker runtimes need import Node-only code at module scope: `sql/drivers.ts` imports PGlite (`@electric-sql/pglite`, `drizzle-orm/pglite`) and `mig/framework.ts` uses `node:url` with `import.meta.url` (KV imports it for the KV table). The bundler resolves those three specifiers to stand-in modules that throw if called, and defines `import.meta.url` as a fixed string, so no Node module and no Postgres harness code is in a Worker bundle, and the Worker needs no `nodejs_compat` flag. Verified: `src/build/build.unit.test.ts` (module list and import scan) and a local bundle answering requests in workerd (`unstable_startWorker`). The clean fix is in those components (see "Changes requested from other items"); once made, the stand-ins can go.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0192 — `createTestApp` migrations: committed ones from the working directory, else generated
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: testing.d.ts ("migrations applied"), B-17 (`verify`), B-16, B-07

`createTestApp` applies the framework history, then the app's: `<cwd>/migrations/` when it holds a `<dialect>/` directory (app tests run from the app root, as `verify` runs them), otherwise — when the app has tables — a history generated once per process and app definition from the table definitions by MIG's own generator into a temporary directory. So in-process tests of apps without committed migrations (the framework's own suites) still get their tables, and app tests exercise the committed files.

B-T2's draft of the same decision ("`createTestApp` applies the app's generated migrations from the working directory"): `createTestApp(app)` receives only the `DefinedApp`; the simplest reading of "fresh local storage, migrations applied" with `verify` running tests from the app root is that it applies the framework migrations and then the app's committed `migrations/<dialect>/` found from `process.cwd()`. The SQL suites therefore write a scratch app with the same tables (`sql/fixtures/schema.ts`, defined through an injected framework module so test process and CLI share one definition), run `generate-migration` there, and `chdir` into it for the test process. If `createTestApp` instead builds the schema from the definitions, the generated files are simply unused. The KV suites need no app tables and do not change directory.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-16, B-T2 (drafts merged).

### DEC-0193 — `createTestApp` behaviour the contract leaves open
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: testing.d.ts (contract changed: `logWriter`, `framework` key, `as` with the stub), DEC-0210, DEC-0226, DEC-0229

- Deployment `{ app: <definition name>, stage: "local", target: "local" }`; name rules apply (a bad name rejects with `CORE.MISCONFIGURED`); declared secret names are checked as in a build.
- `config`: the reserved key `framework` is the values file's `framework` section; all other keys are values. Both go through CFG's schema validation and resolution, so an undeclared key, a wrong type or a missing value without default rejects. The object is copied: later mutation has no effect (each call is one build).
- Secrets: `secrets` maps logical names to `SECRET_<NAME>`; fresh random `frameworkSessionKey` and `frameworkLocalTicketKey` values per test app. `unavailable: ["secrets"]` makes the app's reader fail (`SEC.UNAVAILABLE`); framework secrets keep working.
- `unavailable`: `sql` → the app's handle and KV's handle are forced unavailable; `kv` → KV's handle only (`KV.UNAVAILABLE`, no `SQL` entry); `files` → a store whose every operation rejects (`FILES.UNAVAILABLE`).
- `logWriter: "failing" | "never-completing"` (added to the contract) uses LOG's `failingSink()` / `neverCompletingSink()`; `logs()` is then empty. Otherwise the memory sink, which echoes `error` entries to stderr.
- Public origin `http://localhost:8787`. `request(path)` resolves `path` against it, adds `Origin` to state-changing requests unless `init` has one, and sends the `loginWithStub` session unless `init` sets `Cookie`; no other response cookie is kept (tests that follow the login steps by hand pass cookies explicitly).
- Without `stubLoginProvider`: the mock is installed and `user`/`as()` are its fixed identity per request (no `user` → the session decides). With it: the stub provider and no mock (no mock-login route); `user` rejects and `as()` throws, since both need the mock. `loginWithStub` requests `/api/auth/login`, passes the `Location` through `stubCallbackUrl`, requests the callback with the transaction cookie, and keeps the `session_local` cookie; if none is set (a stub failure) it rejects with the redirect it got.
- `dispose()` closes PGlite and the platform proxy; later requests reject.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0194 — The local ticket key's name lives in a local-only SEC module
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-REQ-006, CORE-AC-006, secrets.md §2, DEC-0189, DEC-0193

`FRAMEWORK_SECRETS` (`src/secrets/names.ts`, in every cloud bundle) no longer holds `localTicketKey`. `src/secrets/local-names.ts` holds `LOCAL_TICKET_KEY`, `LOCAL_FRAMEWORK_SECRETS` and `DEV_GENERATED_SECRETS`; it is imported only by the local runtime, `createTestApp`, `secrets set` and the `.dev.vars` store. `FrameworkSecretName` still includes the local name as a type. `createFrameworkSecrets({ read, log, extra })` makes `extra` names readable besides `FRAMEWORK_SECRETS`; the stage runtime passes its target's `requiredFrameworkSecrets` as `extra` (a secret the health check requires is one framework code reads), so the local target adds the ticket key without the shared runtime naming it. `secrets set` still accepts `frameworkLocalTicketKey`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16a.

### DEC-0195 — The local cookie settings are passed in by the local runtime
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: LOCAL-REQ-004, LOCAL-AC-004, AUTH-REQ-006, auth.md §2 "Session cookie"

`src/auth/local-cookies.ts` holds `LOCAL_COOKIES` (`session_local`, `login_local`, not Secure); `src/auth/cookies.ts` holds only `CLOUD_COOKIES`. `cookieSettings(target, settings = CLOUD_COOKIES)` and `AuthOptions.cookies` / `StageOptions.cookies` now take a `CookieSettings` object instead of a `"local" | "cloud"` mode; non-Secure settings on any non-local target are still CORE.MISCONFIGURED. Assumption: without settings every target, the local one included, gets the cloud settings (the safe direction); the local runtime and `createTestApp` always pass `LOCAL_COOKIES`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16a.

### DEC-0196 — SQL drivers split into a D1 module and a Node-only Postgres harness module
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-REQ-006, CF-REQ-003, SQL-REQ-006, sql.md §2 "Local drivers", DEC-0191

`src/sql/drivers.ts` is replaced by `src/sql/d1.ts` (`sqliteDb`, `SqlAdapterOptions`; Workers-compatible) and `src/sql/postgres.ts` (`postgresDb`, `openPostgres`, `POSTGRES_DATABASE`; Node only). The guard's built-in unreachable pattern no longer names PGlite; `GuardOptions.unreachable` / `normalizeError(…, unreachable)` take a driver's extra patterns, and `postgresDb` passes `/PGlite is closed/i`. Unit test: a query on a closed harness database is `SQL.UNAVAILABLE` (`src/sql/postgres.unit.test.ts`).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16a.

### DEC-0197 — The framework migrations directory moves to a Node-only MIG module; bundler stand-ins removed
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CF-REQ-003, CF-AC-003, DEC-0191

`FRAMEWORK_MIGRATIONS_DIR` moves from `src/mig/framework.ts` to `src/mig/migrations-dir.ts`, so `framework.ts` (imported by KV and the stage runtime) uses no `node:url` or `import.meta.url`. With 3 and 4, `src/build/bundle.ts` no longer replaces `@electric-sql/pglite`, `drizzle-orm/pglite` or `node:url` and no longer defines `import.meta.url`; a Node built-in reaching a Worker bundle now fails the build (esbuild cannot resolve it for the browser platform). DEC-0191 is superseded.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16a.

### DEC-0198 — The diagnostics count line names each kind of problem
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-003, CHECK-REQ-004, check.md §2 "Diagnostics", B-17

`formatDiagnostics` ends with `<n> portability problem(s)`, `<n> migration problem(s)` (rules in `MIGRATION_CHECKS`), or both joined by `, ` (portability first). No test pinned the wording (B-T4 and the integration suites do not match the count line; the B-14 unit test's `2 portability problems` still holds).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16a.

### DEC-0199 — Command table, exit statuses, commands of later items
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-REQ-001, CLI-REQ-003, CLI-REQ-004, cli.md §2

Every CLI-REQ-001 command is registered in `src/cli/main.ts`. Exit 0 = success, 1 = failure, 2 = usage error. `deploy`, `remove`, `setup-account`, `certify-auth`, `smoke` and `secrets set --target cloudflare` exit 1 with "not available yet: it requires …" naming the work item (C-04, D-05); D-05 replaces the bindings. Failures print the error's message only. Usage messages never repeat an unexpected argument (a secret typed by mistake is never echoed); `secrets set` prints the name and `SECRET_<NAME>` location only after the name was checked against the declared names, and does not print the stage argument.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0200 — `reset-local` removes `.wrangler/` and `.logs/`, keeps `.dev.vars`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: LOCAL-REQ-002, LOCAL-AC-002

"Local state" = local D1 (SQL, KV) and R2 under `.wrangler/`, and the local log. `.dev.vars` holds secrets the owner set with `secrets set`; clearing it would lose them, and `dev` regenerates only the framework's dev keys. `.framework/` is build output, not state.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0201 — `verify` runs every step and reports all of them
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-REQ-002, CLI-AC-002, DEC-0238

Order: type check, portability rules, migration checker, zod version, tests (sqlite), tests (postgres). Tests run even when a static step failed, so one run shows every problem. Diagnostics use CHECK's one-line layout (`file:line:col  error  message  rule  (read reference)`; type errors carry `TSnnnn` as the rule). No clock times or durations are printed; failing and skipped tests are listed sorted by file and name and passing tests are only counted (a line naming a file is read as a diagnostic about it, DEC-0237), so two runs on the same app print identical text (checked offline on the template: CLI-AC-002 "two consecutive runs"). A dialect run with no passing test fails ("no tests ran"); a test file that fails to load, an unhandled error, or a runner crash fails the run.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0202 — `verify`'s type check and zod check
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK §2, CHECK-AC-001, CLI-REQ-002

The type check uses `APP_COMPILER_OPTIONS` over the same files the rules lint (`src/`, `tests/`), never the app's `tsconfig.json`. `src/` and `tests/` are checked in separate programs: test files import Vitest, whose declarations reference Node's types, which would otherwise make `Buffer` type-check in server code. The zod check reads `node_modules/zod/package.json` resolved upwards from the app (Node's resolution) and compares with PAR-112 (`ZOD_VERSION`, unit-tested equal to the framework's own `zod` dependency); a missing zod fails.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0203 — `verify`'s test runs: Vitest Node API in a child per dialect, framework options only
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-REQ-002, LOCAL-REQ-003, PAR-116, CHECK-REQ-006

Each dialect runs `dist/cli/verify/test-runner-child.js` in its own process with `PROTOTYPE_FRAMEWORK_DIALECT` set; the child calls Vitest's `startVitest` with `config: false`, root = app, include = PAR-116 glob, no file-system module cache, silent, 60 s test and hook timeouts (opening PGlite the first time takes over 5 s; same values as the template's `vitest.config.ts`), and writes a summary JSON the parent formats. The app's Vitest configuration is not read, like the lint configuration (the app cannot narrow which tests run). If an app needs Vitest settings beyond these, that is a framework change.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0204 — `dev` process layout
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: local.md §2, LOCAL-REQ-002, LOCAL-REQ-004, LOG-REQ-003, MIG-REQ-003, CFG-AC-003, DEC-0190

`dev` builds for target `local`, stage `local`; runs `ensureDevSecrets`; applies migrations with `migrateLocal(d1MigrationDatabase(DB), <app>/migrations)` through `getPlatformProxy({ configPath: .framework/local/wrangler.jsonc, persist: { path: <app>/.wrangler/state/v3 } })` — the same database file `wrangler dev --persist-to <app>/.wrangler/state` uses; a `MigrationFailedError` exits 1 before serving. Ports are free loopback ports picked at start. Wrangler is a child process (`--ip 127.0.0.1`, inspector on 127.0.0.1, `--env-file <app>/.dev.vars`, `--var FRAMEWORK_PUBLIC_ORIGIN:http://localhost:<vite port>`, `--local`, metrics off); its stdout and stderr go through LOG's `createLogCapture` into `.logs/<UTC day>.log`, other lines to stderr prefixed `[wrangler]`. Vite runs in the CLI process with no app configuration file (`configFile: false`; the generated configuration cannot widen the host), on 127.0.0.1, `appType: "spa"` (deep links get the entry page), `/api` proxied to Wrangler without changing `Host`, cache in `.framework/vite`, and a first middleware that answers 403 unless `Host` is exactly `localhost:<port>`. The client root is the app root when it has `index.html`, else `src/client/`. `dev` prints `http://localhost:<port>/` after both are serving, does not rebuild while running, and on SIGINT/SIGTERM closes Vite, stops Wrangler and exits 0; Wrangler ending on its own exits 1. Wrangler's own port answers any `Host`; it is loopback-only and not printed (the Host check is enforced on the one printed origin).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0205 — Root `npm run verify`
Origin: ai-proposed · Status: superseded by DEC-0242 · Affects: plan §10.1, B-17 task line

`npm run build -w packages/framework && npm run typecheck && npm run test:unit && npm --workspace apps/template run verify`. Framework lint is not included: the root `lint` script is still a stub (not owned by B-17) and fails by design; `apps/reference` is added by C-01 when it exists.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0206 — What the template contains, one use per capability
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-REQ-004, skill.md §2 "The template", cli.md §2 "App layout", CHECK-AC-005, E-02, C-05

`apps/template` (app name `template`) is a notes app: config key `greeting` (`GET /api/hello`, anonymous); SQL table `notes` (`GET`/`POST /api/notes`, user's own rows, `requireUser`); a log entry per created note (component `notes`); KV status line per user (`GET`/`PUT /api/status`); files in `users/<id>/` via upload/download tickets (`GET /api/files`, `POST /api/files/{upload,download}-ticket`); one secret `apiKey`, checked (never returned) by an admin-only route (`GET /api/admin/secret`, `requireAdmin`). One route module per capability in `src/server/routes/`, each taking `Hono<Env>`; `src/server/env.ts` exactly as skill.md §2. The browser part is `index.html` at the app root (the Vite root, as in B-T4's base fixture) plus `src/client/main.ts` and one page module per capability under `src/client/pages/`, built with `textContent` only. `src/shared/types.ts` holds only types: the portability rules let browser code import shared code type-only (DEC-0180), so input limits live in the server's Zod schemas only. `config/local.json` and `config/cloudflare/test.json` set no values (the greeting has a default) and an empty `framework` section. Only `.`, `./client` and `./testing` are imported; nothing names a target.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-18.

### DEC-0207 — The smoke file picks its mode through the test runner's provided context
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-AC-005, skill.md §2 "Testing", testing.d.ts `connectTestStage`, C-04

`tests/smoke/smoke.test.ts` calls `connectTestStage()` when Vitest's `inject("prototypeFrameworkSmoke")` is `true`, and `createTestApp(app, …)` otherwise (so it runs in-process under `verify`). App code may not read `process.env` or `import.meta.env` (`no-env-access`), and the contract has no other switch, so the runner's provided context (PAR-116 is Vitest) is the simplest target-neutral signal. **For C-04:** `smoke` must run Vitest with `provide: { prototypeFrameworkSmoke: true }` on `tests/smoke/**`. If C-04 prefers another mechanism, only this file changes. The smoke checks avoid `logs()` (throws on a connected stage) and use a fresh random mock user per run, so they also pass on a stage that keeps data.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-18.

### DEC-0208 — Committed migrations generated with MIG's generator; app test timeouts
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-REQ-001, CLI-REQ-002, B-17

The CLI was not merged, so `migrations/` (`0000_schema` pair, snapshots, `checksums.json`) was generated by calling MIG's `generateAppMigrations` on the loaded app (the engine `generate-migration` uses); the migration checker reports nothing. `vitest.config.ts` keeps the PAR-116 glob and raises test and hook timeouts to 60 s, because the first PGlite open in a Postgres-dialect process takes over 5 s (observed: the first test timed out at the default). **For B-17:** `verify`'s test runs must either use the app's `vitest.config.ts` or apply an equivalent timeout themselves.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-18.

### DEC-0209 — The template imports `hono` types without declaring `hono`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: skill.md §2 ("route modules take `Hono<Env>`"), B-01 dependency rule, C-05

Route modules use `import type { Hono } from "hono"` as skill.md prescribes; `hono` is a framework dependency, resolved by hoisting. Adding it to `apps/template/package.json` would change the shared lockfile, which only an integrator regenerates (plan §9.2). Proposed (integrator or CORE): either declare `"hono": "4.13.13"` (PAR pin) in the template's dependencies and regenerate the lockfile, or re-export the `Hono` type from `.` so apps need no direct `hono` import. Scaffolded apps installed from a tarball depend on hoisting until then.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-18.

### DEC-0210 — LOG-AC-001 needs a log-writer injection option in `TestAppOptions`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: LOG-AC-001, `docs/contracts/ts/testing.d.ts` (owner B-16), B-04

LOG-AC-001 requires "an injected log writer that fails and one that never completes", but no public contract offers an injection point; plan B-04 already lists "failing and never-completing writer injection for tests". Proposal: add to `TestAppOptions` `readonly logWriter?: "failing" | "never-completing"` ("failing": every write rejects/throws inside the writer; "never-completing": every write returns a promise that never settles). `log/log.test.ts` uses exactly this name through an intersection type (`TestAppOptions & { logWriter?: … }`), so it type-checks today and fails until B-16 adds the option. If B-16 picks another shape, it updates the contract and this one test together (decision draft required, contract change).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0211 — How the suites reach the framework
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: all B-T1 suites, B-16, B-17, B-RUN, plan §10.1

- In-process tests import the public hubs by relative path (`src/index.ts`, `src/testing/index.ts`), which re-export exactly the contract names; they run against sources and need no build.
- Everything an app would do through the package name uses the package name and therefore the compiled `dist/` (DEC-0111): on-disk fixture apps (temp directories whose `node_modules` links to the workspace's), the CORE-AC-001 compiler fixtures, the esbuild bundle of `./client` for the browser test, and the package binary (`bin/prototype-framework.js`) for `build`, `dev` and `secrets set`.
- **Open item:** `npm run test:integration` must build the framework first (`npm run build -w packages/framework`). Without `dist/` those tests fail with a message saying so. Wiring that order is B-16/B-17's (or the integrator's, for the root script). Resolved: B-16a made root `test:integration` build the framework first.

B-T2's draft of the same decision ("How the suites reach the framework"): In-process code imports only the public hubs `src/index.ts` and `src/testing/index.ts` (the contracted names) and uses services only through a route of a `defineApp` app (`c.var.sql`, `c.var.kv`); a probe route runs a test closure inside a real request and returns its value or thrown error in memory, so `undefined`, JS types and `FrameworkError` instances are observed exactly as app code sees them. CLI behaviour is exercised through the package binary `bin/prototype-framework.js` in scratch app directories (copied from `apps/template` when present, minus sources/tests/migrations/state; `node_modules` symlinked to the workspace's). The binary loads `dist/`, so **the framework must be built (`npm run build -w packages/framework`) before `npm run test:integration`**; B-16/B-17/B-RUN wire that order. Scratch apps live in the OS temp directory and are removed after each file.

B-T4's draft of the same decision ("Suites drive the real binary on throwaway copies; the framework must be built first"): Each test copies fixture layers into a fresh OS temp directory, symlinks `node_modules` to the workspace's, and runs `node_modules/.bin/prototype-framework <command>` there (what `npx <package> <command>` resolves to). The binary and exports point at `dist/` (DEC-0111), so the harness refuses to run when `packages/framework/dist/cli/public.js` is missing or older than `src/`, naming the command `npm --workspace packages/framework run build`. The runner (B-RUN) must build before `npm run test:integration`, or B-17 wires the build into that script.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-T1, B-T2, B-T4 (drafts merged).

### DEC-0212 — Finding the `dev` origin; one `dev` at a time
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: HTTP-AC-001, HTTP-AC-006, LOG-AC-002, LOG-AC-003, CFG-AC-003, SEC-AC-001, SEC-AC-002

The dev port is not contracted. The harness starts `npx <package> dev` (the binary) in the app directory, collects every `http://localhost:<port>` printed, and uses the one that serves both `GET /` as `text/html` 200 and `GET /api/__framework/health` as a framework response (204 or JSON) — the one-origin requirement (HTTP-REQ-004, LOCAL-REQ-004). `dev` must therefore print that URL. Vitest runs files in parallel, so dev sessions are serialised by a lock directory in the OS temp directory (owner pid inside; a dead owner's lock is taken over). Stopping sends SIGINT to the process group, then SIGKILL after 15 s.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0213 — Fixture client entry page location
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: HTTP-AC-001

Where the client's `index.html` lives is not contracted (cli.md only says `src/client/` holds browser code). Fixture apps write the same page at the app root and at `src/client/index.html`. HTTP-AC-001 asserts the deep link returns 200 HTML byte-identical to `GET /` and containing the page's marker.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0214 — Entry-module export form
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: on-disk fixture apps, B-16, cli.md §2 App layout, testing.d.ts, B-18

The form of `src/app.ts`'s export is not contracted ("the value an app's entry module exports"). Fixture apps export the `defineApp` result both as `default` and as `app`.

B-T4's draft of the same decision ("App entry and test-app conventions used by fixtures"): `src/app.ts` exports the `defineApp` result both as `default` and as `app` (cli.md says only that it "holds the defineApp call"). App tests call `createTestApp(app)` and `TestApp.request` with the full path (`/api/hello`). The Vite entry page is `index.html` at the app root loading `/src/client/main.ts`. Fixture `tsconfig.json` repeats the app lib set. Route handlers live inline in `defineApp` (no `hono` import needed).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Items: B-T1, B-T4 (drafts merged).

### DEC-0215 — CFG-AC-003 local interpretation
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CFG-AC-003, B-17

"A running build" is a running `dev`; "the next build" is the next `dev` start (which builds). The test edits `config/local.json` while `dev` runs, checks the served value is unchanged after 8 s and 10 s, restarts `dev`, and expects the new value. So `dev` must not rebuild on a values-file change while running (E2E-014: "takes effect only after the rebuild").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0216 — Local stage name and build invocations
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-004, CFG-AC-006, SEC-AC-002…004

CLI-REQ-001 requires `--stage` for `build` and `secrets set`; no doc names the local stage. Tests use `--target local --stage local`, which reads `config/local.json`. Test/production stage selection (CFG-AC-002) is tested with `build --target cloudflare --stage test-<id>` and `--stage bt1prod`, which run offline (plan B-16).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0217 — "Naming" in CLI failures
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-006

A failure "names" something when the command exits non-zero and its combined stdout+stderr contains: the offending key (CFG-AC-002), the missing file as `config/<target>/<stage>.json` (CFG-AC-002), the unknown field's name (CFG-AC-006), or for the app-name rule the bad name plus one of `hyphen`, `lowercase letters and digits`, `[a-z0-9]`, `PAR-290` (CORE-AC-007).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0218 — CFG-AC-004: where the resolved configuration is observed
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CFG-AC-004, B-09, B-16

The resolved configuration is embedded in the build as a generated module (DEC-0063) under `.framework/`; its format is not contracted. The test passes when, after `build`, some file under `.framework/` contains both each declared secret's logical name and its location (`SECRET_<NAME>`, SEC-REQ-003), for a local and a Cloudflare test-stage build.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0219 — HTTP-AC-007 entry contents and fixtures
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: HTTP-AC-007, LOG-AC-005, B-03, B-04

- The log entry schema has no structured fields beyond `message`, so method, route path, code, the error's name and message, the stack (a V8 frame line `\n    at `), and the key or secret name are all asserted inside `message`. The secret is accepted by logical name or location.
- Routes have no path parameters, so "route path" and request path coincide.
- No app-reachable in-process path produces `CORE.MISCONFIGURED`, so the reference route throws `FrameworkError("CORE.MISCONFIGURED")` (a CORE code, not a capability code, so CORE-REQ-007 does not forbid it at runtime).
- "Exactly one `error` entry" counts `error` entries added to `logs()` during that request.
- LOG-AC-005: the entry's `component` is `CORE` for an uncaught error and `SQL` for `SQL.UNAVAILABLE` (LOG-REQ-005 "the failing component's code").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0220 — Other readings
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: listed per item

- HTTP-AC-002 "the request's ID": the `requestId` in the body equals `c.var.requestId` seen by app middleware for that request.
- HTTP-AC-003: the over-limit body is sent once with `Content-Length` and once streamed without it; a body of exactly PAR-200 bytes reaches the handler; malformed JSON also gives 400 `HTTP.INVALID_INPUT`.
- HTTP-AC-006: the browser runs the package's `./client` export bundled by esbuild (PAR-119) into a page on the `dev` origin; the session comes from `POST /api/auth/mock-login`; "unreachable" is a Playwright-aborted request (status `null`, `requestId` `null`); the not-from-the-app message is compared exactly.
- CORE-AC-001 "importable from the subpath whose signatures use it": `.` and `./client` must be self-contained; types in `./testing` signatures may come from `.` too, since app test files may import both (CORE-REQ-005). Checked by walking the built declarations with the TypeScript checker.
- CORE-AC-003: forged `Host`, `X-Forwarded-Host`, `Forwarded`, `X-Forwarded-Proto`/`-For` and look-alike headers are sent through `TestApp.request`.
- CORE-AC-004 scan: every quoted string of the form `<PREFIX>.<NAME>` (catalogue prefixes) and every `new FrameworkError("…")` literal in `packages/framework/src` (unit tests excluded) must be a catalogue code.
- CORE-AC-005: this suite covers the exports-map part (expected set without `./targets/aws`, DEC-0110); the `verify` part is B-T4's. CORE-AC-008: route part here, `verify` part B-T4's.
- LOG-AC-003: the log file is named after the entry's UTC date; "ignored by git" is checked with `git check-ignore --no-index` for `apps/{template,reference,demo}/.logs/…` in this repository.
- SEC-AC-002 local scope: error responses; `TestApp.logs()`; `.logs/` from `dev`; the app directory after `build --target local` and `--target cloudflare --stage test-…` (excluding `.dev.vars`, the secret store, and `.wrangler/`, emulator state); the repository via `git grep --untracked`. Ticket "URL" = every string of 16+ characters inside the ticket JSON (contents are opaque). The stub authorization code = the query values of `/api/auth/callback` reached by following same-origin `/api/` redirects from `/api/auth/login` in-process; this assumes the stub provider redirects straight to the callback (it "speaks no protocol"). "Deployed browser assets" is cloud-only (C-T1/D).
- SEC-AC-003 local: `.dev.vars` holds exactly one line `SECRET_API_KEY=<value>` (quotes allowed) after `secrets set apiKey --target local --stage local` with the value on stdin. SEC-AC-004 also checks the stdin form of the same command succeeds, so the rejection is specific to the argument forms (positional, `--value x`, `--value=x`).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T1.

### DEC-0221 — SQL-AC-001: what "rejected" and "valid name" mean
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-05, SQL-REQ-001, SQL-AC-001, SQL-AC-004

- "Rejected" = `defineTable` (or `defineApp` with the table) throws at definition time, so no database is created; any `Error` counts (no catalogue code is specified for schema errors).
- Table names must be lowercase ASCII snake_case starting with a letter, at most 63 bytes (Postgres' identifier limit: "valid on every target"), and not start with `__framework_`. Rejected fixtures: `Notes`, `notesList`, `notes-list`, `notes list`, `1notes`, `café`, `__framework_notes`, empty, 64 × `n`. Column keys must be ASCII lowerCamelCase whose snake_case name obeys the same rules (rejected: `Title`, `created_at`, `title-text`, `title text`, `ünicode`, `__frameworkX`, 64 × `a`). Index/unique entries naming a non-existent key are rejected.
- Composite primary keys, reference actions and SQL-expression defaults cannot be expressed through `sql.d.ts`; the suite asserts this at the type level (`@ts-expect-error`, enforced by `npm run typecheck`) and also forces each through with a cast and expects a run-time rejection. Auto-increment, generated and non-portable columns are forced in as Drizzle pg-core builders (`serial`, `generatedAlwaysAs`, `varchar`). Custom collations have no expression at all in the contract or in a portable builder; that clause is covered only by the absence of an API (not testable at run time).
- `.default()` values outside the column rule are rejected the same way (tagged SQL-AC-004).
- The identical-schema clause is checked by applying the generated histories to a fresh local D1 (`getPlatformProxy`) and a fresh PGlite and comparing introspected schemas: snake_case names, §2.1 physical type per dialect, NOT NULL, primary key, defaults, references with a "fail while referenced" action (`NO ACTION`/`RESTRICT`), unique sets and indexes. SQLite stores boolean defaults as 0/1 or `false`/`true`; the comparison reads both as booleans for boolean columns. The introspection harness was validated against hand-written drizzle-style DDL on real local D1 and PGlite (not committed).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T2.

### DEC-0222 — SQL-AC-003…-006: value and failure expectations
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-05, B-06, SQL-AC-003…-006

- "Identical results" locally = the same literal expectations pass in both dialect processes; floats are compared with PAR-280's tolerance. Seed IDs are fixed, valid UUID v4 text so orderings ending in `id` are known.
- `containsText` folds the needle as well as the column (ASCII only): `ÀPPLE` matches `ÀPPLE and apple`, `àpple` does not.
- Value rules (SQL-AC-004): `id()` values must be UUID v4 text (`not-a-uuid` → `SQL.INVALID_VALUE`); NULL into a NOT NULL column → `SQL.INVALID_VALUE`; wrong JS types (e.g. `"1"` for `integer`, `1` for `boolean`) → `SQL.INVALID_VALUE`; the same rules apply to `update().set()`; a multi-row insert with one bad value writes nothing; `ref` to a missing row and deleting a referenced row → `SQL.CONFLICT` (SQL-REQ-006 "reference violation").
- `atomic` with a step built on the outer handle: SQL-REQ-005/`sql.d.ts` say "a catalogue error"; sql.md §2.2 says `CORE.INTERNAL`. The test accepts any catalogue code (the binding wording) and checks nothing was written.
- `SQL.RESULT_TOO_LARGE`: "larger than PAR-215" is strict, so a result of exactly 262,144 bytes (sql.md §2.3 measure) succeeds and one byte more fails.
- The Data API retry clause of SQL-AC-006 and the Cloudflare/Data API targets of SQL-AC-003…-006 are out of scope for B-T2 (AWS code is not built; cloud parts are later phases).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T2.

### DEC-0223 — MIG-AC-001: the checker is judged through `verify`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-07, B-15, B-17, MIG-AC-001

The migration checker has no contracted entry point other than `verify` (CLI-REQ-002 step 3). The test first runs `verify` on the unedited scratch app (must exit 0; the app has one test, because `verify` fails on zero tests), then appends a comment line to the first generated SQLite migration and expects a non-zero exit whose output names the edited file (assumption: CHECK diagnostics name the offending file). `migrations/checksums.json` must be JSON and mention each migration's base name. "One new migration per dialect" = exactly one new `.sql` file in each of `migrations/sqlite/` and `migrations/postgres/`, earlier files byte-identical.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T2.

### DEC-0224 — Recognising app migrations in `__framework_migrations`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-07, MIG-REQ-002

The record's columns are `(id, dialect, checksum, applied_at)` (migrations.md §2) but the `id` format is not specified. The tests assume an app migration's `id` contains its file's base name (e.g. `0000_…`); every row is unique; rows not matching an app file are framework migrations (at least one), and all of them precede the app rows in insertion order, which follow file order.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T2.

### DEC-0225 — KV ambiguities
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-08, KV-AC-001…-005

- KV-AC-002 says "empty … values are rejected", but KV-REQ-002 only rejects empty keys; the requirement wins: `put(k, "")` is accepted and `get` returns `""`.
- A malformed or over-long prefix is rejected with `KV.INVALID_KEY` (KV-REQ-002 and the catalogue: "Key or prefix"); the empty prefix and `limit` above PAR-222 are not tested (not in any criterion; clamp vs reject is unspecified).
- `nextCursor` is null whenever no item remains, including after a full page that exhausts the prefix (kv.d.ts "Null when there are no more items").
- "Database unreachable" locally = `createTestApp(app, { unavailable: ["sql"] })`; every KV operation must then fail with `KV.UNAVAILABLE`, not `SQL.UNAVAILABLE` (KV-REQ-005).
- KV-AC-004's local part is the same KV suite passing in both dialect processes; each KV test carries both its own ID and KV-AC-004.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T2.

### DEC-0226 — `framework.admins` / `framework.users` reach `createTestApp` through `config.framework`; a rebuild is a new `createTestApp`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-003, AUTH-AC-012, CFG-AC-005, E2E-007, AUTH-AC-005; testing.d.ts (`TestAppOptions.config`), B-12, B-16

AUTH-AC-012 says "With `createTestApp` using `stubLoginProvider` and `framework.users` set to one user ID", but `TestAppOptions.config` is documented as "Config values overriding the app's defaults. A key the app did not declare makes `createTestApp` throw", and no other option carries the framework lists. Assumption: `config` also accepts the reserved key `framework`, holding the stage-config schema's `framework` object (`{ admins?, users? }`), and it is not an undeclared app key. E2E-007 and AUTH-AC-003 say the redeploy "is a rebuild" locally; the suites treat each `createTestApp` call as one build. CFG-AC-005's "only after the next build" is checked by mutating the very object passed to `createTestApp` after the build (no effect) and then building again (effect). Suggest testing.d.ts document the `framework` key (contract owner: B-16).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0227 — The stub login provider's `id` is `"stub"`; base32 case is not compared
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-002; auth.md §2 "User ID", B-12

AUTH-AC-002 requires the ID to match the specified derivation (`u_` + first 26 characters of base32(SHA-256(`<provider id>:<subject>`))), which needs the stub's provider id; no document names it. Assumed `"stub"`. auth.md does not fix the base32 alphabet's letter case, so the suite uses RFC 4648 and compares case-insensitively. "Two providers yield different IDs": locally only the stub completes a non-mock login through `createTestApp` (the Google provider cannot without Google), so the suite checks that the stub's ID is the derivation for its own provider name and differs from the derivation under `"google"`. That is the strongest local form; record it as such for the evaluator.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0228 — The stub provider redirects straight to the callback URL; the transaction cookie is the non-session cookie `/api/auth/login` sets
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-005, AUTH-AC-006, AUTH-AC-008, AUTH-AC-010; B-12 (`FW/src/auth/testing.ts`)

auth.md says the stub "speaks no protocol" but not what its `beginLogin` returns. Assumption: its `redirectUrl` is the `callbackUrl` it was given (built from the public origin) plus stub-specific query parameters, so a test can follow `/api/auth/login` → `Location` → `/api/auth/callback` in-process with `TestApp.request` and the transaction cookie. This is how the suites observe the callback URL (AUTH-AC-008), the transaction cookie's attributes (AUTH-AC-006), missing / tampered / crossed / expired transactions and `returnTo` sanitising (AUTH-AC-010). Refused and replayed callbacks use `loginWithStub(…, { stubFailure })`, since only the stub can produce them.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0229 — `TestApp` request semantics the suites rely on
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: all B-T3 AUTH and FILES tests; testing.d.ts, B-16

- `request(path)` takes the full path including `/api` (e.g. `/api/auth/me`).
- An explicit `Cookie` header in `init` is sent as given and takes precedence over any session the test app keeps.
- Without a `user` option, a session cookie from `/api/auth/mock-login` decides the current user (the mock's default anonymous identity does not override it).
- `loginWithStub` with a `stubFailure` may resolve or reject (the contract does not say); tests accept either and assert only the observable outcome (no session, log entry).
- Failed-login log entries name the fixed reasons with auth.md's words ("transaction missing or expired", "state mismatch", "provider refused", "token exchange rejected", "token check failed"), matched case-insensitively, and carry the failing request's `requestId`.
- Time checks use `Date`; tests fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`) so local storage I/O keeps running (core.md §2 "Testing" says the runner's fake timers govern session and ticket expiry).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0230 — AUTH-AC-007's missing-Origin and deployed-router clauses are not testable in-process
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-007; testing.d.ts, C-phase compliance authors

`TestApp.request` always sends the deployment's origin on state-changing requests unless `init` sets one, so a request with no `Origin` cannot be sent through it, and "through the deployed router" needs the `dev` server or a deployed stage. The B-T3 tests cover the in-process ("directly") part: wrong origins (`https://evil.example`, `null`, a look-alike host) rejected with `AUTH.REQUEST_FORGERY` for POST/PUT/PATCH/DELETE and logout, and the public origin accepted. Their titles say "in-process". The missing-Origin clause and the router part are left to the compliance criteria tests against `dev` and the test stage (C-phase), which can send raw HTTP.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0231 — FILES browser tests run the in-process app behind a local bridge; an unrelated origin is a `127.0.0.1` page with `<base href>` to the app
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-004 (browser part), FILES-AC-006 (browser part); B-11

`files/browser-harness.ts` serves the bundled `<package>/client` and forwards `/api/*` to `TestApp.request`, at `http://localhost:<port>`. Assumption: local ticket URLs are same-origin (relative, or absolute to the page's origin), as files.md §2 Local says ("a same-origin framework route"). The unrelated origin is `http://127.0.0.1:<other port>`, whose page sets `<base href="<app origin>/">` so the same ticket targets the app's transfer route cross-origin; the browser must refuse it (`uploadFile` → `FILES.TRANSFER_FAILED`, status null, `no response: network or cross-origin blocked`, nothing stored; a download `fetch` fails with `TypeError`). A same-origin control proves the tickets work. Interruption (FILES-AC-006) is the bridge pausing a transfer-route PUT after 2 MiB of a 16 MiB body, then dropping the connection; with bytes already sent, the expected class is `interrupted after n bytes` (0 < n < size) with status null. The harness mechanics were checked against Chromium with a fake app (cross-origin PUT blocked before reaching the server; upload error after ~6 MB reported by XHR progress).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0232 — The Google provider is reached as `createGoogleLoginProvider(): LoginProvider` from `FW/src/google/public.ts`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: GOOGLE-AC-001 (local), GOOGLE-AC-002, GOOGLE-AC-003; B-13

No contract names GOOGLE's factory. Assumed a no-argument `createGoogleLoginProvider()` exported from `FW/src/google/public.ts`, returning the internal `LoginProvider` (docs/contracts/ts/internal/login-provider.d.ts); the suite loads it with a dynamic import so the shared type-check stays green until B-13 adds it. Configuration and secret come only through `ProviderContext`: `getConfig` answers `framework.google.clientId` (or the enclosing `framework.google` / `framework` objects), and `getSecret` answers any name containing "google" (case-insensitive) with the client secret. Global `fetch` is stubbed (prompt §4); Google's discovery, JWKS and token endpoints answer from memory, and every other URL is recorded as unexpected and must stay empty, so nothing contacts Google (jose 6's `createRemoteJWKSet` uses global `fetch`). The client ID is obviously fake (`fake-test-client-id.invalid`) and exists only in test files.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0233 — GOOGLE-AC-002 also gets an integration form; the "never fetch token URLs" clause is tagged under it
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: GOOGLE-AC-002

GOOGLE-AC-002 names unit tests; B-13's unit tests remain its primary evidence. The B-T3 suite feeds the same hand-built tokens through the provider's `completeLogin` (expecting `AUTH.LOGIN_FAILED` for wrong signature, issuer, audience, expired, future issued-at beyond PAR-252, wrong or missing nonce), with controls that tokens inside the 60 s skew and the documented issuer `accounts.google.com` are accepted. GOOGLE-REQ-002's "MUST NOT fetch URLs taken from the token" is checked in a test tagged GOOGLE-AC-002 (a token with `jku`/`x5u` headers), because no AC names that clause.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0234 — Parts of B-T3 criteria covered elsewhere or not-run
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-005, AUTH-AC-009, GOOGLE-AC-001, FILES-AC-004, FILES-AC-006

- AUTH-AC-005: contract part only. No OpenAPI/JSON-Schema validator is a declared dependency (ajv is only transitive), so `auth/support.ts` hand-codes the `CurrentUser` and `ErrorResponse` schemas of framework.openapi.yaml; keep them in step with the YAML. Admin-list part: cloud milestone, not-run ("Google login mocked for this phase").
- AUTH-AC-009: local part (mock-login works with the identity used as given). The production-404 and "production bundles contain no mock" parts need a production build: bundle inspection is CORE-AC-006 (B-T4); the cloud production part is not-run.
- GOOGLE-AC-001: local part (redirect parameters and the token request with the client secret and PKCE verifier). The certification step-1 check against a production deployment is not-run.
- FILES-AC-004 / FILES-AC-006: the "type inspection" and "server part" tests are Vitest; the browser parts are Playwright (`files/transfers.spec.ts`, project `integration`). FILES-AC-004's forbidden vocabulary (storage services, signing, credentials, CORS, bindings) is the list in `files/app-facing-types.test.ts`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T3.

### DEC-0235 — Fixture TypeScript files carry a `.fixture` suffix
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `packages/framework/test/fixtures/**`, B-01 `packages/framework/tsconfig.json`

`packages/framework/tsconfig.json` includes `test/**/*.ts` with the framework (Node) lib set and NodeNext resolution. Fixture apps are app code (app lib set, Bundler resolution) and many fail type checking on purpose, so as `.ts` they would break `npm run typecheck`. They are stored as `*.ts.fixture`; the harness (`fixtures/support/app.ts`) strips the suffix when it copies a fixture app. The passing and failing apps were type-checked by hand against the B-01 contract stubs under the app lib set: the passing app is clean; the failing app's type errors are exactly the intended ones.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0236 — Fixture apps hold no generated migrations; the harness runs `generate-migration`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: B-07, B-17

Migrations are the framework generator's output (format, file names, `checksums.json`), which does not exist yet. After copying, the harness runs `generate-migration` once, as an owner does after defining tables; a failure there fails the test setup with the command's output. Tests that need a hand-changed history (`editMigrationKeepingChecksum`, `addHandWrittenMigration`) infer the `checksums.json` entry from the existing file's digest (sha256/sha1/sha512, hex/base64/base64url, optionally `algo:`/`algo-` prefixed) and fail with a clear harness message if the format is not recognisable; a drizzle `meta/_journal.json`, when present, gets an entry for a hand-written file.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0237 — Diagnostic layout the assertions rely on
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-REQ-003, B-14, B-17

A diagnostic about a file is found by the file's base name (fixture base names are unique) on an output line, plus any indented continuation lines (so both one-line `path:line:col message rule` and ESLint "stylish" layouts work). The rule is "named" when its name appears as a whole word, plugin prefix allowed (`x/no-raw-sql`). Type errors are recognised by `TSnnnn`. CHECK-AC-003 additionally needs, in one diagnostic (the rule line up to the next diagnostic), a skill reference written as `skill/reference/<name>.md` or `reference/<name>.md` that exists under `skill/`, and the construct (per-fixture patterns in `fixtures/support/check-catalog.ts`, matched after removing the file name, rule name and reference path).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0238 — `verify` reports every static step's diagnostics, not only the first failing step's
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CHECK-AC-001, CHECK-AC-003, SQL-AC-002, CLI-REQ-002, B-17

CHECK-AC-001 requires the rule (`allowed-imports`) to fail `node:fs` and bare `fs` imports, but under the app lib set (no `@types/node`) those also fail type checking; likewise `.transaction()`, `.batch()` and `db.query` are absent from `PortableDb` and fail type checking before `no-transactions` / `no-relational-queries` could be seen. The tests therefore require `verify`'s output to contain both the type error and the rule's diagnostic. The simplest reading: `verify` runs type checking and the portability rules and reports both before failing. All failing fixtures share one app and one `verify` run.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0239 — Postgres-only failures used for CLI-AC-002 and LOCAL-AC-003
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-AC-002, LOCAL-AC-003

Both use only supported features, so only the Postgres test process can catch them: `.limit(-1)` (SQLite: no limit; Postgres: "LIMIT must not be negative") for CLI-AC-002, and `selectDistinct` ordered by an unselected column (Postgres requires ORDER BY expressions of SELECT DISTINCT in the select list) for LOCAL-AC-003. The assertion is that `verify` fails and its output names the failing app test, which proves a test run (not a static check) failed. The output need not say which dialect failed (not specified), so "works on SQLite" is not separately asserted.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0240 — Bundle inspection reads `.framework/` and matches surviving strings
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CORE-AC-006, CF-AC-003, PROV-AC-005, LOCAL-AC-004, B-16

cli.md says `build` generates entry points under `.framework/`; the tests assume the whole build output is there and scan every file in it. Positive controls: a `.js`/`.mjs` file exists, the text contains `__framework/health` and the stage's own config marker. Modules are recognised by strings that survive bundling and minification: `mock-login` (mock); `stubLoginProvider`/`loginWithStub`/`stubFailure` (stub provider, `./testing`); `__framework/files` (local transfer route); `ticket_key`/`ticketKey`/`SECRET_*TICKET*` (local ticket key — assumes its framework-internal name contains "ticket"); `@aws-sdk`/`aws-sdk`/`amazonaws.com`; `pulumi`, `sst` specifiers or paths, `/provision/`, `setupAccount`, `listStageResources` (provisioning); `pglite`/`electric-sql`; import specifiers of `fs`, `fs/promises`, `child_process`, `worker_threads`, `cluster`, `repl`, `inspector`, `v8`, `tty`, `dgram` (with or without `node:`); tooling package specifiers or `node_modules/<pkg>/` paths (eslint, typescript, drizzle-kit, wrangler, vite, vitest, esbuild, miniflare). Comments mentioning these strings in bundled framework code would be false positives; the build should strip comments or minify.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0241 — Readings of individual criteria
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: listed IDs

- **CORE-AC-005**: the exports map must equal the CORE-REQ-005 table minus `./targets/aws` (DEC-0110, plan §11 Q3). The `./targets/aws` fixture must fail `verify` with a diagnostic naming the file (type error or `allowed-imports`).
- **CORE-AC-006**: only the Cloudflare-bundle part is covered; "the AWS bundle contains no Cloudflare-only modules" is not testable this phase (no AWS target; not-run).
- **PROV-AC-005**: run for target `cloudflare` only (stages `prod`, `prodcheck`, `mytest-1`, `test-b4t1`); the local target has no per-stage values files and AWS is not built. "Reads its own values file" is shown by a distinct `greeting` value per file appearing in exactly the matching bundle. These are local builds; nothing is deployed (prompt §4 forbids only cloud `prodcheck` stages).
- **LOCAL-AC-004 "cloud builds reject the local cookie settings"**: no knob for cookie settings is specified, so it is read as: a Cloudflare build contains the `__Host-session` cookie name and never the local `session_local` setting. Host-header rejection is tested on the printed dev port (status ≥ 400 or connection closed, with a `Host: localhost:<port>` control); loopback-only is tested on every TCP listener of the `dev` process group (from `/proc`) plus a connection attempt on each non-loopback IPv4 interface address. The dev URL is the first `http://localhost:<port>` `dev` prints.
- **LOCAL-AC-002**: the clause "each capability's local acceptance criteria pass" is the union of the other suites' results (B-T1…B-T3, C-T*); this suite covers "data survives a restart of `dev`, and the reset command clears it" for SQL, KV and files, and its title says so.
- **CLI-AC-002**: "mismatched migration" is read as dialect histories that disagree (checksums kept valid, so only the schema comparison catches it); the diagnostic must name the differing column (`extra`). "Zero tests" output must match `/no tests|zero tests|0 tests|no test files/i`. Identical offline runs compare exit codes and output after removing durations, clock times and the temp path. The template tests fail until B-18 exists.
- **CHECK-AC-003**: also covers `no-transactions` and `no-relational-queries` through DEC-0238. It can pass only once phase E writes `skill/reference/` (plan §4 C-EV note: judged at E-EV).
- **CHECK-AC-004**: unsupported changes are hand-written migration pairs (the generator refuses renames, so only hand edits can produce them) registered with valid checksums; each must fail with a diagnostic matching `/add[ ,-]+copy[ ,-]+(and )?drop/i`. Supported changes are produced by `generate-migration` one per step (add table, add nullable column, add column with static default, add index, add unique, drop index, drop unique, drop column, drop table), each must create one new file per dialect, then `verify` must pass.
- **CHECK-AC-006**: the rule's full ID is discovered from the exports of `<package>/check` (a key ending in `/no-raw-sql`, or a plugin whose `rules` has it); the app config is `eslint.config.js` setting it to `"off"` or `0`. `verify` must fail, name the rule, and name `eslint.config`. If `./check` exposes no such ID the test fails saying so.
- **SQL-AC-002**: excluded features that Drizzle cannot express without raw SQL (window functions, JSON operators, full-text search) are fixtures of `no-raw-sql`; views are a `pgView` import (`allowed-imports`). Triggers and stored procedures have no fixture: they can only be created by raw DDL, which `PortableDb` cannot execute and `no-raw-sql` already rejects. `groupBy` is assumed supported (aggregates are, and grouping is how they are used); the passing fixture uses it.
- **CHECK-AC-001** raw-HTML insertion, value import from `src/shared/` in browser code, and the type-escape fixtures of CHECK-AC-002 name no rule, so any diagnostic naming the file counts.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-T4.

### DEC-0242 — The framework lints its own source with typescript-eslint's recommended rules; root `verify` includes it
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: plan §3 B-17 task line, plan §10.1, prompt §5 ("the framework's own code must pass its own checks"), PAR-111, DEC-0205

The plan's root `verify` is "framework typecheck + framework lint + unit tests + `npx <package> verify` in the apps" (B-17 task line), so the framework lints itself. The shipped portability rules (`./check`) are written for app code (app lib set, no Node APIs) and do not fit framework code, which is Node and Worker library code. Chosen, simplest: root `eslint.config.js` applies typescript-eslint's `recommended` configuration (ESLint and typescript-eslint at PAR-111, declared as root dev dependencies) to `packages/framework/src/**/*.ts` and `packages/framework/bin/**/*.js`; in colocated `*.unit.test.ts` files `no-unused-vars` and `no-unused-expressions` are off, because those files hold type-level fixtures (values declared only for their types, expressions read only by the type checker). Root `lint` = `eslint packages/framework/src packages/framework/bin`; root `verify` = `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit && npm --workspace apps/template run verify` (`apps/reference` is added by C-01). The test-author suites and fixtures under `packages/framework/test/**` are not linted yet: they are owned by test-author items, and recommended rules report seven findings there (unused `_` names, `{}` types, one unused directive) at B-INT. C-INT may extend the scope once their owners fix them. Integration fix: two `prefer-const` findings in unit tests (`testing/test-app.unit.test.ts`, `secrets/service.unit.test.ts`) were corrected without changing behaviour.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-INT.

### DEC-0243 — Direct imports are declared: `hono` in the template, `@typescript-eslint/utils` in the framework
Origin: ai-proposed · Status: accepted · Affects: DEC-0209, DEC-0182, PAR-104, PAR-111, `apps/template/package.json`, `packages/framework/package.json`, C-05

The template's route modules import `type { Hono } from "hono"` (skill.md §2), so `apps/template/package.json` declares `hono` at exactly PAR-104 (4.13.13) instead of relying on hoisting; a scaffolded app (C-05) copies it. CHECK's rules import `@typescript-eslint/utils`, so the framework declares it at exactly the typescript-eslint version of PAR-111 (8.72.0), the version typescript-eslint itself depends on. `package-lock.json` was regenerated with `npm install`.
Item: B-INT.
