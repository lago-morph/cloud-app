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
Origin: owner · Status: accepted · Supersedes: DEC-0065 · Affects: MIG, PROV, SQL, KV

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
