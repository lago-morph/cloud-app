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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); refined by DEC-0312 · Affects: HTTP-AC-001

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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); CLI-AC-002 fixture superseded by DEC-0311 · Affects: CLI-AC-002, LOCAL-AC-003

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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); lint scope extended by DEC-0315 · Affects: plan §3 B-17 task line, plan §10.1, prompt §5 ("the framework's own code must pass its own checks"), PAR-111, DEC-0205

The plan's root `verify` is "framework typecheck + framework lint + unit tests + `npx <package> verify` in the apps" (B-17 task line), so the framework lints itself. The shipped portability rules (`./check`) are written for app code (app lib set, no Node APIs) and do not fit framework code, which is Node and Worker library code. Chosen, simplest: root `eslint.config.js` applies typescript-eslint's `recommended` configuration (ESLint and typescript-eslint at PAR-111, declared as root dev dependencies) to `packages/framework/src/**/*.ts` and `packages/framework/bin/**/*.js`; in colocated `*.unit.test.ts` files `no-unused-vars` and `no-unused-expressions` are off, because those files hold type-level fixtures (values declared only for their types, expressions read only by the type checker). Root `lint` = `eslint packages/framework/src packages/framework/bin`; root `verify` = `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit && npm --workspace apps/template run verify` (`apps/reference` is added by C-01). The test-author suites and fixtures under `packages/framework/test/**` are not linted yet: they are owned by test-author items, and recommended rules report seven findings there (unused `_` names, `{}` types, one unused directive) at B-INT. C-INT may extend the scope once their owners fix them. Integration fix: two `prefer-const` findings in unit tests (`testing/test-app.unit.test.ts`, `secrets/service.unit.test.ts`) were corrected without changing behaviour.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-INT.

### DEC-0243 — Direct imports are declared: `hono` in the template, `@typescript-eslint/utils` in the framework
Origin: ai-proposed · Status: accepted · Affects: DEC-0209, DEC-0182, PAR-104, PAR-111, `apps/template/package.json`, `packages/framework/package.json`, C-05

The template's route modules import `type { Hono } from "hono"` (skill.md §2), so `apps/template/package.json` declares `hono` at exactly PAR-104 (4.13.13) instead of relying on hoisting; a scaffolded app (C-05) copies it. CHECK's rules import `@typescript-eslint/utils`, so the framework declares it at exactly the typescript-eslint version of PAR-111 (8.72.0), the version typescript-eslint itself depends on. `package-lock.json` was regenerated with `npm install`.
Item: B-INT.

## Implementation phase: local and Cloudflare — phase C local compliance (2026-10-20)

These were recorded by build items C-01…C-05, test-author items C-T1…C-T4 and the phase-B follow-up B-T5 of `ai/implementation/plan.md`, and integrated by item C-INT, which added DEC-0311…DEC-0318 itself. All are `ai-proposed` except DEC-0317, which records an owner direction. Where two drafts recorded the same decision they were merged into one entry (named in its last line). An entry taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue" says so in its body and shows `owner review open` (or `owner decision outstanding`) in its status line. Entries without that mark are routine design choices for points the documents leave open (prompt §5). No parameter changed in phase C.

### DEC-0244 — CHECK-AC-003 covers 15 rules; type-escape rule IDs are matched by bare name
Origin: ai-proposed · Status: accepted · Affects: CHECK-AC-003 (flag F2); `test/fixtures/support/check-catalog.ts`, `check/portability-rules.test.ts`

"Every rule's diagnostic" is read as every rule check.md §2 ("Shipped configuration") lists as shipped: the ten CHECK-REQ-001 rules, `no-raw-html`, `no-suppression-comments`, and typescript-eslint's `no-explicit-any`, `consistent-type-assertions` and `no-non-null-assertion`. The last three are matched as whole tokens, so `@typescript-eslint/no-explicit-any` satisfies `no-explicit-any`; the test does not fix the plugin prefix. Representatives: `html-inner` (construct `innerHTML`), `te-ts-ignore` (`@ts-ignore`), `te-any-param` (`any`), `te-as-unknown-as` (`as` or "type assertion"), and a new fixture `te-non-null` (construct "non-null"). For `consistent-type-assertions`, a message naming the construct's kind ("type assertions") is accepted as naming the construct, since the cast has no identifier of its own. `te-non-null` is not added to `TYPE_ESCAPE_FIXTURES` (CHECK-AC-002 does not list non-null assertions). An untagged control asserts the representative set equals the 15 rules. The five new tests fail until E-01/E-02 create `skill/reference/*.md`, for the same reason as the existing ten (B evaluation §3); they are judged at E-EV.
Item: B-T5.

### DEC-0245 — CFG-AC-004 reads the generated resolved-configuration module
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-004 (flag F3); `config/build.test.ts`

Following config.md §2 "Delivery" (DEC-0063), the test locates, under `.framework/`, the generated JavaScript modules that have no imports and a default export, imports each, and keeps those whose default export has the `ResolvedConfig` shape (`deployment`, `values`, `secrets`). It requires exactly one such module for the built target and stage (by `deployment.target`/`deployment.stage`), and its `secrets` to equal exactly the declared secrets as `{ name, location }` (`SECRET_<NAME>` locally and on Cloudflare, SEC-REQ-003). The file name is not fixed. A module whose import throws (e.g. a Worker bundle) is skipped as not plain data.
Item: B-T5.

### DEC-0246 — LOCAL-AC-004's non-loopback probe must run, with a positive control
Origin: ai-proposed · Status: accepted · Affects: LOCAL-AC-004 (flag F5); `local/dev.test.ts`

The test now fails if the machine has no non-loopback address (non-internal IPv4, or IPv6 other than link-local), instead of passing with zero probes. A wildcard listener started by the test must be reachable on every probed address (positive control), so "not reachable" is not an artefact of the probe. The number of probes must equal addresses × dev listeners and be > 0. Consequence: `test:integration` must run where a non-loopback interface exists. The sandbox has `eth0` 192.0.2.2, so it runs there. It cannot run inside `unshare -n`, which only the template's `verify` (not the integration layer) uses for the offline exit check.
Item: B-T5.

### DEC-0247 — Type-only assertions are compiled inside the Vitest run
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-004, AUTH-AC-001 (flag F7); new helper `test/fixtures/support/typecheck.ts`

A new tagged test in each file runs the TypeScript compiler API with `packages/framework/tsconfig.json`'s options on the test file (and, for AUTH, `support.ts`, whose reference routes read the ID with no assertion), and requires zero diagnostics in those files. Unused `@ts-expect-error` (TS2578) and failing `expectTypeOf` calls would show up there. Negative controls in the same program, as in-memory probe files, must produce errors on exactly the expected lines. For FILES these are reading `url`/`headers`/`expiresAt`, treating a ticket as a string, and `keyof Ticket = "url"`. For AUTH they are reading `.id` on an un-narrowed `CurrentUser`, an extra field, a missing field, and an `id` key on the anonymous member. So the Vitest status now carries the type evidence; the `tsc` step remains as well.
Item: B-T5.

### DEC-0248 — CORE-AC-005's `./targets/aws` fixture must fail on `allowed-imports`
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-005 (flag F8); `cli/verify.test.ts`

CORE-REQ-005 says the portability rules must reject imports outside a subpath's allowed importers, and check.md assigns that to `allowed-imports`. So the test requires a diagnostic for `aws-runtime.ts` that names `allowed-imports` and contains `targets/aws`. An unresolved-module type error alone no longer satisfies it.
Item: B-T5.

### DEC-0249 — HTTP-AC-007 compares the logged error name and message with the caught error's own
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-007 (flag F12); `core/harness/reference-app.ts`, `http/errors.test.ts`

The contract does not fix `FrameworkError.name`, so the test does not hard-code names. The reference app gains a `/api/caught/:what` route that performs the same failing operation as each logged route (plain `Error`, `CORE.MISCONFIGURED`, the undeclared config key, the missing secret, SQL with `unavailable: ["sql"]`) inside `try/catch`, and returns the caught error's `name` and `message`. The entry of the uncaught request must contain that name as a whole token (so "Error" is not satisfied by "FrameworkError") and that exact message, in addition to the existing method, route, code, stack and key/secret-name checks.
Item: B-T5.

### DEC-0250 — Reference app layout and route list
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL §2, C-T1…C-T4, D-RUN, `apps/reference/ROUTES.md`

`apps/reference` (app name `reference`) follows the template's layout: `src/app.ts` exports the `defineApp` result as `default` and `app`; one route module per area in `src/server/routes/` (`ref`, `levels`, `errors`, `kv`, `files`, `fixture`, `cases`); `index.html` at the app root with `src/client/`; `src/shared/types.ts` types only. The route list, with the criteria each route serves, is `apps/reference/ROUTES.md`; tests address the app only through it. Capability routes (`/api/kv/*`, `/api/files/*`, `/api/fixture/*`, `/api/cases/*`) require a logged-in user, since cloud test stages are publicly reachable; fixtures and error routes are anonymous unless the code needs a level. KV and FILES routes pass keys, names and cursors to the framework unchanged (no prefix), so the framework's own rejections are observable.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0251 — Error routes raise capability codes by causing them
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: HTTP-AC-002, HTTP-AC-007, CORE-AC-008, CORE-REQ-007, `app-error-codes`, DEC-0219

"A reference route per catalogue code with a status" is one literal route `/api/errors/<CODE>` per code (no path parameter, so the HTTP-REQ-007 route path equals the request path). App code may throw only the four CORE-REQ-007 codes (`app-error-codes` fails `verify` otherwise), so every other code is produced by doing what causes it: `CORE.MISCONFIGURED` by calling `defineTable` with an invalid table name inside the handler (DEC-0132); `CFG.UNDECLARED_KEY` and `SEC.UNDECLARED` by reading an undeclared name through the general `ConfigService<ConfigDeclaration>` / `SecretsService<string>` types, to which the app's typed services are assignable without a type assertion; `SQL.CONFLICT` by a duplicate unique `authors.name`; `SQL.INVALID_VALUE` by `integer` 2³¹; `SQL.RESULT_TOO_LARGE` by one 300,000-character row (one oversized row, plan §1 limits); `KV.*`/`FILES.*` invalid inputs directly; outage codes (`*.UNAVAILABLE`, `SEC.MISSING`) by a plain read that fails only under `createTestApp`'s `unavailable` option or a missing value, and otherwise answers 200 `{ raised: false }`. `AUTH.LOGIN_FAILED` has no route: app code may not throw it and the framework's callback answers failed logins with a redirect (DEC-0168). DEC-0219's fixture (B-T1) throws `FrameworkError("CORE.MISCONFIGURED")` directly; the reference app cannot, since `app-error-codes` rejects it.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0252 — Secret fixture routes never return the value
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SEC-AC-001, SEC-AC-002, SEC-AC-005, HTTP-AC-002

The app declares one secret, `apiKey` (the test secret). Every declared secret is required by the health check and the deploy preflight, so no "never set" secret is declared; `SEC.MISSING` is observed where `apiKey` has no value. `GET /api/ref/secret` returns only the SHA-256 of the value, so SEC-AC-001's "is returned" is checked by digest and no response ever contains the value. `GET /api/ref/throw-secret` (plain `Error`, 500) and `/throw-secret-app` (`HTTP.CONFLICT`, 409) throw errors whose messages contain the value, for HTTP-AC-002's no-echo clause (DEC-0123 redaction).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0253 — Route modules take the router type derived from `AppDefinition`; no `hono` import
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEC-0209, DEC-0243, `apps/reference/package.json`, `package-lock.json`

The template imports `type { Hono } from "hono"` and declares `hono` (DEC-0243). Declaring it in `apps/reference/package.json` would change the shared lockfile, which only an integrator regenerates. The reference app instead types its route modules with `Api = Parameters<AppDefinition<typeof config, Secret>["routes"]>[0]` (in `src/server/env.ts`), which is the same `Hono<AppEnv<…>>`, and imports nothing from `hono`. If the integrator prefers the template's form, declare `hono` 4.13.13 here, regenerate the lockfile and switch the alias to `Hono<Env>`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0254 — Version 1/2 schemas as overlays; a failing overlay for MIG-AC-003
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL §2 ("committed version 1 and version 2 schemas"), E2E-010, MIG-AC-002, MIG-AC-003, C-T2, C-T4, D-RUN-M

An app has one schema at a time, so the committed app is version 1, and every version-dependent part (the `parents`/`children` tables, the fixture load and dump, `SCHEMA_VERSION`) lives in `src/server/evolution.ts`. Overlays under `apps/reference/versions/<name>/` hold a replacement `src/server/evolution.ts` and the complete `migrations/` tree, generated with `generate-migration` from a copy of the app; a test applies one by copying the app, replacing `migrations/` and that file, then deploying (locally: the next `dev` start). `v2` adds `children.rank` (default 0), an index on `children(parentId, rank)`, and drops `parents.note`, a table with child rows (MIG §2 supported changes only; the drop and the add are on different tables, so the generator accepts one migration). `unique-fail` adds a unique constraint on `children.label`, which the data fixture violates (two children labelled `shared`) — the "data-dependent failing migration" of MIG-AC-003, provided here because C-T2 does not own `apps/reference`. Overlay files are outside `src/`, so the app's own `verify` does not check them; checked manually in scratch copies: the `v2` copy passes `verify` (both dialects), a `dev` start of `v2` over a v1 `dev` state holding the fixture keeps every row and file (dump shown below), and `unique-fail` makes `dev` exit before serving with the migration named and the database unchanged.

Evidence (local, scratch copies): v2 dump after upgrade `{"version":"v2","parents":[{"name":"alpha"},{"name":"beta"},{"name":"gamma"}],"children":[…5 rows, "rank":0…],"files":[…2 files, sha256 unchanged…]}`; unique-fail: `dev: migration app/0001_unique_label (…/0001_unique_label.sql) failed and was not applied; the database is unchanged by it: D1_ERROR: UNIQUE constraint failed: children.label`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0255 — Data fixture shape and the fixture routes
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-010, MIG-AC-003, MIG-AC-006

The data fixture (`src/server/fixture-data.ts`) is 3 parents, 5 children and 2 files under `fixture/` (one text, one with all 256 byte values). `id()` values must come from `newId()` (`framework-ids`), so `POST /api/fixture/load` generates IDs and `GET /api/fixture/dump` compares by content: parents by name, children by parent name and label, files by name, size, content type and SHA-256. Load inserts all rows with one `atomic` call and refuses a second load with `HTTP.CONFLICT`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0256 — Shared case sets: interface and registry handover
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: C-T2 (owner of `apps/reference/src/server/cases/**`), SQL-AC-003…-006, KV-AC-004

A case is `(services: { sql, kv, files, log }, input: unknown) => Promise<unknown>`; a set is a record of named cases (`src/server/case-types.ts`). `POST /api/cases/run { set, name, input? }` answers `{ outcome: "value", value }` or `{ outcome: "undefined" }`, or the framework's `ErrorResponse` for a thrown error; `GET /api/cases` lists the sets. The route reads its sets from `src/server/case-registry.ts`, which ships empty, because C-01 may not create files under `src/server/cases/**` and a missing module would fail `verify`. **For C-T2:** export `caseSets: CaseSets` from `src/server/cases/index.ts` and replace the registry's body with `export { caseSets } from "./cases/index";` (ownership of that one file passes to C-T2 for this edit). Case tables `authors`, `posts` (every column type, nullable and defaulted columns, a reference), `tags` (composite unique, index) are in `src/server/schema.ts` with committed migrations; changing them needs a new migration from C-01's owner.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-01.

### DEC-0257 — Configuration values per stage file
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-001, CFG-AC-003, E2E-014

Keys `greeting` (string), `pageSize` (integer), `featureOn` (boolean), `tags` (string list), one per type, all with defaults. `config/local.json` sets `greeting` to `Hello from local` and `config/cloudflare/test.json` to `Hello from a test stage`, so a test can tell which committed file a deployment uses; both have an empty `framework` section. No `prodcheck.json` (prompt §4).
Item: C-01.

### DEC-0258 — Root `verify` includes the reference app
Origin: ai-proposed · Status: accepted · Affects: root `package.json` `verify` script, plan §3 "Phase B outcomes", DEC-0205

The root `verify` script now ends with `npm --workspace apps/reference run verify`, as plan §3 assigns to C-01; this is the only edit outside `apps/reference/**`.
Item: C-01.

### DEC-0259 — Evidence writer: embedded schema, own validator, clean-tree rule
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-003, COMPL-AC-003, `packages/framework/src/evidence/`, C-04 (`smoke`)

`FW/src/evidence/` embeds `evidence.schema.json` as a constant, and a unit test keeps it identical to the contract file. It validates records with a small interpreter for the keywords the contract uses. An unknown keyword throws, so a later schema change cannot be silently ignored. This adds no dependency. `writeEvidence` validates the record after redaction. It refuses, writing nothing, when HEAD is not the recorded commit or when any tracked file is modified, staged or deleted. Untracked files do not count, because they include the run's own output. It never overwrites a record, and raw output names must stay under `validation/<target>/<runId>/raw/`. Redactions apply to the record and to the raw output. The driver also checks the tree before it runs anything (exit status 2).
Item: C-02.

### DEC-0260 — Run IDs
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-004, COMPL-AC-004, PAR-291

A run ID is 15 characters from `[a-z0-9]`, which fills PAR-291's 20 characters after `test-`. The characters come from `crypto.getRandomValues`, using rejection sampling: bytes ≥ 252 are discarded, so there is no modulo bias. `testStageName` refuses an ID of any other form. Stage-lifecycle criteria get further stages from the harness's `newTestStage()`, which uses the same form.
Item: C-02.

### DEC-0261 — How the driver records results (it records; the evaluator judges)
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-003, COMPL-AC-001, COMPL-AC-003

- Tests are selected by the plan §10.3 tag regex. Vitest gets `-t`, Playwright gets `--grep`, and each runs once. Locally the integration layer includes the framework's own integration suites. On a cloud only `tests/compliance/` runs.
- Each expected ID gets results in this order of precedence: failed (first failure line of each failing test, capped), then blocked, then passed. With no executed tagged test it is `not-run` ("no test tagged [ID] ran on <target>"). Each skipped tagged test adds a `not-run` entry. Each not-run part rule adds its own `not-run` entry. A milestone result names its part in `detail`.
- `blocked` has two sources. A test calls `prerequisiteMissing(detail)` (marker `PREREQUISITE MISSING: `), or the operator passes `--blocked <ID,…>=<reason>`. `--blocked '*=<reason>'` blocks every criterion the run would execute. In that case nothing is deployed or run. This is for an unavailable platform prerequisite, for example: Cloudflare D1 unavailable because the Phase A spikes exhausted the account's daily row limit (owner direction).
- When setting up the target fails (build, `dev`, deploy), no tests run. Every criterion it would have run is then `not-run` with "setting up the target failed: <first line>", not `blocked`. Such a failure may be a defect of the framework under test, so the record keeps the reason and the evaluator decides.
- `--only` marks the other expected IDs `not-run` ("not selected for this run (--only)"). A whole-suite run is the default.
Item: C-02.

### DEC-0262 — Expected criteria per target and tier
Origin: ai-proposed · Status: accepted · Affects: COMPL-AC-001, plan §8

The catalogue is read from `docs/**/*.md`: criterion table rows (last cell = Where) and `#### E2E-nnn` headers with their `Where:` line. "cloud" means Cloudflare and AWS, except in `cloudflare.md` and `aws.md`. `(milestone)` marks the milestone tier, and a `<part>:` label names a part. Text the parser cannot read makes it throw. This phase's not-run rules are data (`PHASE_RULES`). Every AWS item is "AWS phase not started". The plan §8.1 items, including the planner-added CLI-AC-001 on cloud, are "Google login mocked for this phase". A unit test checks every rule against the real documents.
Item: C-02.

### DEC-0263 — Cloud stage handling and leftovers
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-004, COMPL-AC-004, D-03, D-05

One `test-<run ID>` stage per cloud run is deployed and removed through the framework CLI (`deploy`/`remove` in `apps/reference`, `NODE_USE_ENV_PROXY=1`). Before deploying, the stage is added to a gitignored pending list, `.framework/compliance/pending-stages.json`. It leaves the list only when the leftover check finds nothing. The next cloud run removes the stages still listed first, so a run interrupted mid-way is cleaned up next time, or its stages appear as leftovers. The leftover check calls the target's PROV `listStageResources`. It matches databases by the exact stage pattern and lists every other resource by kind and exact identifier, the R2 API token included. Only `test-` stages are ever removed or checked, so `prodcheck` is never touched. The Cloudflare `TargetOperations` arrive with D-03. Until then the check fails, and the failure is recorded as a leftover entry (`leftover check failed: …`), never as "no leftovers". The account's `workers.dev` subdomain, taken from the deployed origin, is redacted (DEC-0086).
Item: C-02.

### DEC-0264 — Release report and invalidations
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-006, COMPL-AC-006, `validation/invalidations.md`

A record whose command contains `--milestone` is milestone evidence. Any other record is automated evidence for its commit only. For each target, the latest record that contains an ID decides that ID. "Works" requires every automated entry of every applicable target to be `passed` for the commit. It also requires every milestone item's latest milestone record to be passed and not invalidated. An invalidation line is `- <YYYY-MM-DD | ISO time> | <IDs> | <reason>`. A date alone means the end of that UTC day. An entry invalidates records that finished at or before it, and elapsed time never does. The commits touching `packages/framework/src/google/`, `packages/framework/src/auth/login-provider.ts` or `docs/contracts/ts/internal/login-provider.d.ts` since the commit of the last valid GOOGLE-AC-005 record are listed. With no certification, the whole history is listed.
Item: C-02.

### DEC-0265 — Traceability report
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-002, COMPL-AC-002

Tests are found by the runners themselves, so titles built at run time are read the way the runners name them. For Vitest, a run whose name filter matches nothing collects every file without running any test body. Playwright uses `--list`. A scan of the test sources adds bracketed tags and `tag(...)` calls, for suites a listing cannot see. Each catalogue ID is listed with its tests and its latest result per target. IDs with no test are flagged **UNTESTED**, and tags that name no defined ID are flagged too.
Item: C-02.

### DEC-0266 — Harness tooling: launcher, HTTP client, Playwright, self-test, root scripts
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: plan §9.2, §10.1, DEC-0085, DEC-0089, PAR-119, PAR-210, PAR-270, PAR-280

- `run.mjs` / `tools/report.mjs` bundle the TypeScript entry point with esbuild into the gitignored `.framework/compliance/` and import it. Node's type stripping does not resolve the sources' `.js` specifiers.
- The HTTP client sends `User-Agent: prototype-framework-compliance/0.1.0` (DEC-0089). It sends `Origin` on state-changing requests, keeps a cookie jar per client, follows no redirects, and bounds each request at PAR-270. Logins go through `/api/auth/mock-login`. `expectStatus`/`expectError` throw messages naming the method, path, status, code and requestId, which go into `detail`. Waits are `waitFor` with bounds from PAR-210 (database resume), DEC-0090 (route toggle) and PAR-270.
- Playwright specs import `test`/`expect` from `harness/playwright.ts`. It overrides the `baseURL` and `userAgent` fixtures from the driver's environment, and the `request` fixture uses both (checked). The root `playwright.config.ts` is unchanged.
- The driver runs `npm run typecheck` before the tests and keeps its output as raw evidence (`typecheck.log`). This answers B-EV F7: some assertions are checked only by the compiler. A failed typecheck makes the exit status non-zero, but the tests still run.
- `npm run compliance -- --self-test` runs one tagged sample test (`harness/self-test/`) through the full driver. It writes its record under `.framework/compliance/self-test/validation/local/`, outside `validation/`, because it is not compliance evidence.
- Root `package.json`: the `compliance` script placeholder (`scripts/not-wired.mjs compliance C-02`, written by B-01 for this item) now runs `tests/compliance/harness/run.mjs`. `typecheck` also checks `tests/compliance/harness/tsconfig.json`, which covers the harness, the tools, and `tests/compliance/{criteria,e2e}`. This is the smallest change that wires the command, and it was taken under the owner's instruction not to stop for questions.
The root `package.json` edit was outside C-02's Owns line.
Item: C-02.

### DEC-0267 — PROV per-target operations interface (`TargetOperations`)
Origin: ai-proposed · Status: accepted · Affects: PROV §2 "Per-target operations", D-03, D-04, D-05, the AWS phase

The informative table of PROV §2 becomes one TypeScript interface, `TargetOperations` in `packages/framework/src/provision/core/operations.ts`, which the target-neutral core calls and each target implements (Cloudflare: D-03, D-04; AWS later, without changing the core). Refinements of the table: `setupAccount` = `inspectAccount` + `createSharedResources`; `deploy` = `deployInfrastructure` (step 3) + `deployCode` (step 5, returns the public origin); added `preflight` (target's missing prerequisites by name), `listSetSecrets` (`null` while the stage's runtime does not exist), `migrationDatabase` (MIG's `MigrationDatabase`, so the core reuses `applyMigrations`), `checkMigratedDatabase` (MIG step 4), `checkHealth` (step 7, incl. the storage CORS preflight on a cloud), `removeStage` (all removal except databases); `listStageResources` returns resources by identifier plus every listed database, and the core keeps only exact matches of `^<app>-<stage>-db-(\d+)$`. `createServices` stays in the target runtimes. Operations fail by throwing; messages must not contain credential or secret values. Reason: the simplest split that lets the core own sequencing, discovery, failure reporting and idempotence while the target owns every cloud call.
Item: C-03.

### DEC-0268 — A stage's first database is migrated in place
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002 step 3–4, MIG-REQ-006, migrations.md §2

When step 3 creates the stage's first database, step 4 applies the migrations to it in place (file by file, atomically) instead of stop/copy/migrate/check/delete: there is no running app to stop and no data to preserve, and on a first Cloudflare deploy the Worker does not exist yet, so `stopApp` could not run. A failing migration deletes that database and reports "no version deployed". MIG-REQ-006 applies to every later deploy with pending migrations.
Item: C-03.

### DEC-0269 — Deploy failure handling details
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002, MIG-REQ-003, CLI-REQ-003

- A failure of `stopApp`, `copyDatabase`, a migration, the check, or the deletion of the old database takes MIG-REQ-003's failure path: delete the new database if it exists (found by its exact name), `startApp`, exit 1. The old database is unchanged in every one of these cases (the app was stopped, so nothing wrote to it).
- A failure after the old database is deleted (step 5 or 6) leaves the new database current; the next deploy finds it by step 2.
- Cleanup failures (deleting the new database, restarting, stopping after the first-deploy secret check) are printed as `cleanup also failed: …` and reflected in the stage state ("previous version NOT restarted", "new database … left behind"), but the failed step, message and exit status stay those of the original failure.
- Step 1 runs every check (credentials, shared resources, configuration, secrets, production Google client ID and client secret) and reports all problems; a check that throws is reported as a problem rather than ending the preflight.
- Runner-only abort points are a request option `abortAt: "after-copy" | "after-code"`, set by the CLI only for the compliance runner (wiring is D-05's). An abort exits 1 without cleanup, so the re-run exercises step 2's recovery.
Item: C-03.

### DEC-0270 — Ownership of the Cloudflare shared log bucket
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; unverified against the live API, verify in D-03/D-RUN) · Affects: PROV-REQ-004, PROV-AC-007, cloudflare.md `setupAccount`, D-03

R2 bucket names are scoped to an account, so the bucket `prototype-logs` is read through this account's path `GET /accounts/{account}/r2/buckets/prototype-logs`: success → owned; HTTP 404 → absent; HTTP 403 → foreign (it exists but this account does not own it, or its credentials cannot see it — the message says both). Creation is `POST /accounts/{account}/r2/buckets {"name":"prototype-logs"}`; HTTP 409 → foreign. Any other answer is an error naming the bucket and the HTTP status. The status codes were not observed against the live API (this item is offline); D-03/D-RUN confirm them. Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.

**To verify in phase D:** D-03 and D-RUN must confirm the 404/403/409 readings against the live R2 API before `setup-account` relies on them; until then this entry is unverified.
Item: C-03.

### DEC-0271 — The fake target and the Cloudflare API seam
Origin: ai-proposed · Status: accepted · Affects: COMPL-AC-007, PROV-AC-007, CLI-AC-003, D-03, D-05

`provision/core/fake-target.ts` is an in-memory `TargetOperations` with per-operation failure injection, used by the core's unit tests and available to D-05's command tests. `provision/cloudflare/account.ts` takes a `CloudflareApi` function (method, path relative to `/client/v4`, JSON body → status and JSON body), so it never handles credentials; D-03 supplies the real one (authentication, `NODE_USE_ENV_PROXY=1`, DEC-0107). Its colocated unit test `account.unit.test.ts` is treated as part of the owned file (plan §3: colocated unit tests are implementer-owned).
Item: C-03.

### DEC-0272 — How `smoke` finds the base URL: recorded dev origin and recorded deploy output
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-REQ-001 `smoke`, CLI-AC-005, testing.d.ts `connectTestStage`, `dev` (B-17), D-05 `deploy`

`dev` picks a free port each start, so `smoke --target local` cannot guess it. While it runs, `dev` records `{ origin, pid }` in `<app>/.framework/local/dev-server.json` (git-ignored) and removes the file when it stops. `smoke` treats a missing or malformed record, or one whose process has ended, as "no running dev server" and says to start `npm run dev`. On a cloud the base URL is the stage's recorded deploy output `<app>/.framework/<target>/stages/<stage>.json` (`{ publicOrigin }`), written by `deploy` (D-05). The helpers `recordDevServer`/`clearDevServer`/`recordDeployOutput` are in `src/cli/commands/smoke.ts`. With `--target local`, `--stage` may be left out and can only be `local`. On a cloud, `--stage` is required and must start with `test-`. Anything else is refused before any request is sent.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-04.

### DEC-0273 — How the connection reaches `connectTestStage`
Origin: ai-proposed · Status: accepted · Affects: DEC-0207, testing.d.ts `connectTestStage`

`smoke` runs Vitest (PAR-116) in its own process through the Node API, on `tests/smoke/**/*.test.ts`. As in `verify`, the app's Vitest config is not read, and tests and hooks get 60 s timeouts. The run gets `provide: { prototypeFrameworkSmoke: true }` (DEC-0207) and the Vitest `env` option `PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION={"target","stage","baseUrl"}`. Framework code may read the environment; app code may not (`no-env-access`). Called outside a smoke run, `connectTestStage()` rejects and says which command to run.
Item: C-04.

### DEC-0274 — `connectTestStage` behaviour
Origin: ai-proposed · Status: accepted · Affects: testing.d.ts `connectTestStage`, DEC-0089

- It connects with `GET /api/auth/me`, expecting 200. Health is not used because it fails when a declared secret is missing, and that should show up as the smoke test's own failure, not as a failed connection.
- Every request sends `User-Agent: prototype-framework-smoke/0.1.0` and follows no redirect. State-changing requests carry the stage's origin in `Origin` unless the caller sets one.
- `as(user)` returns a test app with its own cookie jar. It logs in through `POST /api/auth/mock-login` once, on its first request. An anonymous identity sends no login.
- `dispose()` sends `POST /api/auth/logout` only for an identity that logged in, then refuses further requests. Stage data is kept.
- `logs()` throws. `loginWithStub` rejects.
- Failures say `<METHOD> <path> answered HTTP <n>, error code <code|(none)>, requestId <id|(none)>`. When there is no answer, the message names the method, the URL and the cause.
Item: C-04.

### DEC-0275 — Smoke evidence and exit status
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-005, COMPL-REQ-003, DEC-0086

`smoke` checks first that the tracked files match HEAD, because the record names a commit. If they differ, it exits 1 and lists the files. The record goes through `src/evidence` to `validation/<target>/<runId>.json` in the git repository that holds the app. It has one result per test (`smoke: <file> > <name>`; skipped tests are `not-run` with "skipped") and one `failed` result per file-level failure, with the first error line as `detail`. Raw output is `smoke.log` (what was printed) and `tests.json`. The account's `workers.dev` subdomain is redacted (DEC-0086). Exit 0 only when at least one test ran, every test passed, nothing failed outside a test, and the record was written. The log location printed for the day is `.logs/<yyyy-mm-dd>.log` locally and `R2 bucket prototype-logs, keys under <app>/<stage>/<yyyy>/<mm>/<dd>/` on Cloudflare, with the UTC date (LOG-REQ-003, LOG-REQ-004).
Item: C-04.

### DEC-0276 — Scaffolder form and no-overwrite rule
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-005, SKILL-AC-005, E2E-001, LOCAL-AC-001, docs/components/skill.md §2

`skill/scripts/scaffold <new-app-dir> [--force]` is a Node script (logic in `skill/scripts/scaffold.mjs`, unit-tested in `skill/scripts/scaffold.unit.test.ts`). It:
1. runs `npm pack` in `packages/framework` (whose `prepack` builds `dist/`) into a temporary directory;
2. refuses when the tarball's version differs from the template's exact pin of `@lago-morph/prototype-framework`;
3. refuses, before writing anything, when the target directory exists and is not empty, unless `--force` is given (then template files overwrite same-named files; other files are left alone). Refusing on any existing entry, rather than only on name clashes, is the simplest rule that satisfies "stops without changing them";
4. copies `apps/template` without `node_modules`, `dist`, `.framework`, `.wrangler`, `.logs`, `.dev.vars` and Playwright output;
5. copies the tarball to `<app>/vendor/<tarball>` and sets the dependency to `file:vendor/<tarball>`, so the app's lockfile records that exact tarball;
6. runs `npm install` in the new app (needs the npm registry for the other pinned dependencies; `verify` afterwards runs offline).

Not done (left to the app agent or phase E): renaming the package or the `defineApp` name `template`, writing a `.gitignore`. Scaffolding into a workspace member of this repository (e.g. `apps/demo`) is not supported by this minimal form: the `file:vendor` rewrite and `npm install` assume a standalone directory.

Evidence: unit tests green (5); a throwaway app scaffolded into a temp dir outside the repo passed `npm run verify` under `unshare -rn sh scripts/offline.sh` (type checking, portability rules, migration checker, zod version, 14 tests on sqlite and on postgres).

C-INT added `apps/template/.gitignore`, which the scaffolder copies (DEC-0316).
Item: C-05.

### DEC-0277 — Run prerequisites: the test secret's value
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SEC-AC-001, SEC-AC-002, HTTP-AC-002, CORE-AC-002, C-RUN, D-RUN, C-02 driver

Criteria that need the reference app's test secret `apiKey` to have a known value read it from its SEC-REQ-003 location: locally `SECRET_API_KEY` in `apps/reference/.dev.vars` (`dev` does not reload `.dev.vars` while running, so the runner sets it *before* the run with `npm run secrets -- set apiKey --target local --stage local` in `apps/reference`, value on stdin; a long random value of letters and digits). A cloud store cannot be read back, so on a cloud the runner sets the value on the run stage and passes it to the tests in `COMPLIANCE_SECRET_API_KEY` (the driver does not do this yet: a D item must add it, or the runner exports it). Without a value (or one under 12 characters) the tests report a missing prerequisite (`blocked`), never pass. CORE-AC-002's health check reports `SEC.MISSING` the same way.

C-INT: the driver passing `COMPLIANCE_SECRET_API_KEY` on a cloud run is assigned to D-T2/D-05 in the plan (§5 "From phase C").
Integrator note: done by D-07; see DEC-0398.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T1.

### DEC-0278 — Clauses that change a stage run on scratch copies and further stages
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-003, SEC-AC-001, SEC-AC-003, SEC-AC-005, LOG-AC-004, CLI-AC-001, CLI-AC-004, CLI-AC-005, COMPL-REQ-003

The driver records evidence only from an unmodified working tree, so no test edits a tracked file. Clauses that edit committed files or need a deployment without the secret run on a scratch copy of the app outside the repository (`node_modules` linked to the workspace's), with its own `dev`: CFG-AC-003 (edit `config/local.json` while `dev` runs, then restart), SEC-AC-001 "without a value" (a copy with no `.dev.vars` value), SEC-AC-003 local (`secrets set` into the copy's `.dev.vars`), CLI-AC-001/-004/-005 (template copy; a git repository of its own so `smoke` can record evidence from a clean tree there). Scratch `dev` sessions are serialised by a cross-process lock. On a cloud, clauses that set or delete secrets or remove a stage run on one further `test-<random>` stage (`newTestStage()`) deployed from a scratch copy and removed in `finally`, serialised across files by a lock (at most one further stage at a time; with the run stage that is ≤ 2 D1 databases, plan "Cloud usage limits"). A further stage's first deploy that stops naming unset secrets is followed by `secrets set` and a second deploy (PROV §2). One file (`secrets/further-stage.test.ts`) holds SEC-AC-001 (cloud missing clause), SEC-AC-003 (cloud), SEC-AC-005, LOG-AC-004 (removal clause), CLI-AC-004 (cloud) on one shared further stage; CLI-AC-005 deploys the template to its own further stage.
Item: C-T1.

### DEC-0279 — Cloud test hooks D-T2 provides under `tests/compliance/criteria/_cloud/`
Origin: ai-proposed · Status: accepted (C-T4 part: assumption under the owner's instruction; owner review open) · Affects: D-T2, LOG-AC-002, LOG-AC-004, LOG-AC-005, SEC-AC-002, SEC-AC-003, SEC-AC-005, E2E-011, E2E-012, E2E-014

**Criteria tests (C-T1).** Cloud stores are reached through `tests/compliance/criteria/_cloud/index.ts` (D-T2 owns it), which must export `cloudHooks(target: string): CloudHooks | Promise<CloudHooks>` with the interface in `core/support/stores.ts`: `deleteSecret({app, stage}, name)`, `secretLocations({app, stage})` (e.g. `["SECRET_API_KEY"]`), `logBucketExists()`, `listLogKeys(prefix)`, `readLogObject(key)`. The module is loaded at run time; while it is absent the tests report a missing prerequisite. Stored-entry lookups by request ID read only the objects whose key ends with `-<requestId>.json`; SEC-AC-002 reads all of the run stage's entries for today and yesterday.

**E2E tests (C-T4).** Log-bucket listing and the stage-resource probe belong to D-T2 (`tests/compliance/criteria/_cloud/**`). The E2E tests load them at run time and report a missing prerequisite (`blocked`) while they do not exist:
- `_cloud/logs.ts` exporting `listLogEntries({ target, app, stage, day }): Promise<{ key: string; body: string }[]>` — every object under `<app>/<stage>/<day>/` (`day` = `yyyy/mm/dd`) in the account's shared log bucket, with its body;
- `_cloud/stage-resources.ts` exporting `listStageResources({ target, app, stage }): Promise<string[]>` — every resource of PROV's removal list still present for the stage, as the driver's leftover strings (`database <name>`, `<kind> <id>`).
If D-T2 chooses other names, a C-T4 follow-up adapts `support/cloud.ts` (plan: "gaps found in them go back to a C-T* follow-up item"). The D1 database probe (PROV-REQ-002's exact pattern) and the shared-bucket existence check use the Cloudflare API directly (`support/cloud.ts`, no Authorization header; the proxy injects the token). Cloud log waits use `CLOUD_WAITS.requestMs` (an entry is written within its request's lifetime, PAR-270); waiting for a newly set secret uses `CLOUD_WAITS.routeToggleMs`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T1, C-T4 (merged: C-T1-3 and C-T4-7).

### DEC-0280 — Readings of criteria
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: the IDs named

- **CORE-AC-002:** per target: `apps/reference/src` is unmodified (git status empty), `build --target <t> --stage <s>` of a copy succeeds, and the run's deployment serves `/`, `/api/ref/deployment` = `{app, stage}` and health 204. The AWS part is the AWS phase.
- **CORE-AC-003:** forwarding headers (`X-Forwarded-*`, `Forwarded`, `X-Original-Host`, `X-Host`) must leave `deployment` identical; a forged `Host` may be refused before the app (local `dev` answers 403 unless Host is exact; a cloud routes by Host), and when the app answers, the identity is unchanged.
- **HTTP-AC-002:** "the request's ID" is checked as a UUID unique to each response (the request ID is never read from request headers, core.md §2, so there is no client-side ID to compare); its log correlation is LOG-AC-002. `AUTH.LOGIN_FAILED` (400) has no route (DEC-0168, ROUTES.md) and is listed as an explicit exclusion, so any new catalogue code without a route fails the test. The `*.UNAVAILABLE` codes and `SEC.MISSING` are raised in-process with `createTestApp` locally (as ROUTES.md drives those routes); on a cloud `SEC.MISSING` is checked on the further stage after deleting the secret; the `*.UNAVAILABLE` codes have no cloud trigger, so HTTP-AC-002's cloud evidence does not cover them.
- **HTTP-AC-003:** "before the handler runs" = a body of exactly PAR-200 bytes reaches the echo handler (200) while PAR-200 + 1 is 413 `HTTP.PAYLOAD_TOO_LARGE`; and the KV write route given an oversized or schema-invalid body answers the framework's code (not `KV.VALUE_TOO_LARGE`) and stores nothing. Bodies are sent with `Content-Length` (no chunked case).
- **HTTP-AC-004:** Playwright loads `/` and a deep link on the deployed client; every request to `/api` is same-origin, no `OPTIONS` request is seen, and the page loads nothing cross-origin.
- **LOG-AC-001:** the criterion's case is in-process ("on Cloudflare only the local case applies"), so the test runs `createTestApp` with `logWriter: "failing"` / `"never-completing"` on every target the criterion runs on; growth = median of three requests minus the in-memory writer's median, ≤ PAR-260.
- **LOG-AC-004:** the outside-request clause is reported `blocked`: no reference route and no app-facing API writes an entry outside a request (see DEC-0314).
- **LOG-AC-005, SEC-AC-002 (stub code), CFG-AC-005 (stub login), HTTP-AC-002 (outage codes):** clauses the criterion states "locally" are registered only on local runs (a test that is not registered adds no `not-run` entry on a cloud).
- **CFG-AC-003:** on every target `/api/ref/config` equals the committed file for the target and stage over the declared defaults listed in ROUTES.md. "Next build" locally = the next `dev` start (dev builds at start and does not rebuild while running).
- **CFG-AC-004, CFG-AC-005 (deployed lists):** the resolved configuration is read from the build output (`.framework/<target>/`, the generated module with no imports whose default export holds `deployment` and `secrets`; its file name is not contracted): the run's own build output when it is for the run's stage, else a fresh `build` of a copy. With the authentication mock a deployed stage cannot show its admin/users lists through a login (the mock's level is used directly, AUTH-REQ-009), so "reports exactly its committed `framework.admins` and `framework.users`" is checked on the deployment's resolved configuration.
- **SEC-AC-001:** "is returned" is checked by the SHA-256 that `/api/ref/secret` returns (the reference app never returns the value).
- **SEC-AC-002:** the repository scan is `git grep --untracked` (tracked and untracked, not ignored, files); the build output is the app's `.framework/` (or a fresh build); browser assets are the entry page and every same-origin script, style and static import reachable from it (≤ 200); stored entries are the deployment's entries of today and yesterday (UTC). The session-cookie and ticket-URL needles come from a session and two tickets created by the test.
- **SEC-AC-005:** asserted as written: the *next* request after `secrets set`, and after the deletion, must show the change. DEC-0092 observed a short delay after a Cloudflare secret update, so this may fail on Cloudflare; it is not weakened (SEC-AC-003's cloud test polls, as DEC-0092 says).
- **CLI-AC-001:** both forms are `npx --no @lago-morph/prototype-framework <command>` and `npm run --silent <command> -- …` in a template copy. Local commands must succeed (`dev`: serves the client on its printed origin; `smoke`: against a running `dev`). `deploy`, `remove`, `setup-account`, `certify-auth` are run with `--target local` so a local run creates no cloud resources: "runs" there means the package dispatches them (no unknown-command answer, not status 127) and both forms give the same status. Their real (cloud) runs are CLI-AC-001's cloud part, which is not-run in this phase.
- **CLI-AC-004:** locally, every output of the CLI-AC-001 runs (both forms, `dev` and `smoke` included) is scanned for the test secret set there and for the framework's generated development secrets in `.dev.vars`; on a cloud, the outputs of the further stage's deploy, `secrets set` and `remove`. The driver's own raw output is scanned by the runner (plan §10.6).
- **CLI-AC-005:** `smoke` must exit 0, write exactly one schema-valid record (`validateEvidence`) under the copy's `validation/<target>/` with `exitStatus` 0 and no non-passed result, and print the log location for the day: locally `.logs/<yyyy-mm-dd>.log`, on a cloud `<app>/<stage>/<yyyy>/<mm>/<dd>/`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T1.

### DEC-0281 — Shared case sets: one expectation set, three places
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-AC-003…-006, KV-AC-001…-005, COMPL-REQ-001, `apps/reference/src/server/cases/**`, `tests/compliance/criteria/{sql,kv}/`

The cases live in the reference app (`cases/sql.ts`, `cases/kv.ts`, `cases/mig.ts`, registered by `case-registry.ts` per DEC-0256) and only report what the framework did; expectations are literals in `tests/compliance/criteria/{sql,kv}/suite.ts`, derived from sql.md / kv.md / the contracts. Each suite runs three times: in-process on local D1 and on PGlite (`createTestApp(referenceApp)` + `POST /api/cases/run`, one entry file per dialect because the dialect is fixed per process, DEC-0134), and through the reference app over HTTP (`client()`: `dev` locally, the test stage on a cloud). "Identical results on every target" (SQL-AC-003, KV-AC-004) = the same literal expectations pass in every place; floats compare with PAR-280; unordered results are sorted by the case and compared as multisets. Every KV test is tagged with its own criterion and KV-AC-004.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0282 — In-process runs exist only on the local target
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-001, `tests/compliance/criteria/{sql,kv}/*.{d1,pglite}.test.ts`

The in-process entry files define their tests only when `target()` is `local`. On a cloud run they would produce local results under the cloud target's evidence; defining them conditionally (rather than skipping) keeps cloud evidence to the HTTP runs, and adds no `not-run` entries. This is the one place the C-T2 tests read `target()`, and only to choose where tests exist, not what they expect.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0283 — Cases are namespaced, self-cleaning and use only public, `verify`-clean app code
Origin: ai-proposed · Status: accepted · Affects: `apps/reference/src/server/cases/**`

Each case takes `{ ns }`, a random per-suite namespace (`c-t2-<16 hex>`), names its authors/keys under it and deletes what it wrote (SQL: one seed of 10 rows per suite, removed by `cleanup`; other cases in `finally`), because a cloud stage is shared by the run's criteria. Rejections are reported inside a case by catalogue code (`codeOf`/`outcome`), so one request checks many values; a non-`FrameworkError` is reported as `not-a-framework-error: …`, which no expectation accepts (SQL-REQ-006). `framework-ids` forbids literal IDs, so IDs come from `newId()` and results map them to labels; the deliberately invalid IDs of SQL-AC-004 come from the case input (left to the run-time rule, as `framework-ids` documents). Type assertions are banned in app code, so wrong-JS-type values (e.g. `1` for `boolean`) are not tested; `boolean` has no in-type boundary.
Item: C-T2.

### DEC-0284 — Readings of SQL-AC-003…-006
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SQL-AC-003…-006

- SQL-AC-003 "every supported feature": every §2.3 row is exercised — select/selectDistinct, insert (single and multi-row), update, delete, inner/left joins, a subquery (`inArray` over a select), a select-only CTE (`$with`/`with`), all exported comparison/boolean/null/`inArray`/`notInArray`/`between` expressions on every column type, `containsText`, every aggregate incl. `groupBy`, `asc`/`desc` on every nullable type, `limit`/`offset`, both upsert forms against declared uniques, and `returning`. Ordering totality: within a suite's data every ordering ends in a column whose values are distinct (`title`), so the order is determined.
- `containsText` "edge cases": `""`, `%`, `_`, `\`, a would-be LIKE pattern (`1%s`, `o_e`) that must not match, ASCII folding (`HELLO`, `APPLE`), non-ASCII not folded (`àpple`, `äpfel`), NULL never matching.
- SQL-AC-004: per type, values just inside and just outside each rule of sql.md §2.1 (integer ±2³¹ edges, fractions, NaN; number ±Infinity, NaN, `Number.MAX_VALUE`, `Number.MIN_VALUE`, −0 stored as 0; timestamp −1, 2⁵³, fractions, 0, `MAX_SAFE_INTEGER`; text lone/reversed surrogates, NUL, `""`, U+FFFF, U+10FFFF, an astral pair; `id`/`ref` uppercase UUID and non-UUID). Rejections must be `SQL.INVALID_VALUE` and write nothing (also for `update().set()`, comparisons and a multi-row insert with one bad row); accepted values must read back exactly.
- SQL-AC-005: the outer-handle rejection must be a catalogue code (any; SQL-REQ-005 and sql.d.ts say "a catalogue error", sql.md says `CORE.INTERNAL`, as DEC-0222) and nothing — not even the first, valid step — may be written. A committing `atomic` is checked as a control.
- SQL-AC-006: duplicate single-column and composite unique values on insert and update → `SQL.CONFLICT` (409 over HTTP); one row of 270,000 ASCII characters selected back → `SQL.RESULT_TOO_LARGE` (one oversized row, plan §1), one of 200,000 succeeds. **Not covered:** the Data API retry-loop clause (AWS adapter; not built in this phase).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0285 — Readings of KV-AC-001…-005; KV-AC-002's empty-value conflict
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; owner item DEC-0146 / plan §11 Q6) · Affects: KV-AC-001…-005, DEC-0146

- KV-AC-001: list results are checked for exact key sets and code point order, incl. `%`, `_`, mixed case, a key outside the prefix that a non-literal match would include (`<ns>/pa%b` for prefix `<ns>/p/`), and code point vs UTF-16 order (U+FFFD before U+1F600).
- KV-AC-002: limits in UTF-8 bytes (a key of 1,024 bytes made of 2-byte characters is accepted; a 1,025-byte key with an astral character, only 1,023 UTF-16 units long, is rejected); malformed keys, prefixes and values are `KV.INVALID_KEY` (KV-REQ-002). **Empty values:** the test follows KV-REQ-002 (binding) and DEC-0146 — `put(k, "")` is accepted and `get` returns `""` — in its own test whose title names the conflict, so the owner's decision changes one test. A prefix over PAR-220 bytes is not asserted (DEC-0147 is an implementation choice no requirement states).
- KV-AC-003: "2.5 pages" = 10 keys in pages of 4 (sizes 4, 4, 2), not 50 keys at the default page size (plan §1 limits); a cursor is rejected with a different, a narrower and a wider prefix, and when malformed.
- KV-AC-005: the maximum page is exactly PAR-222 = 50 entries of PAR-220-byte keys and PAR-223-byte values (the criterion's own size, the only test above "tens of rows"); "database unreachable" locally = `createTestApp(…, { unavailable: ["sql"] })` and `["kv"]`, in-process only (DEC-0225).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0286 — MIG criteria deploy their own stages from a scratch copy of the reference app
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: MIG-AC-002, -003, -006, DEC-0144, compliance.md "Test stages", D-RUN

`tests/compliance/criteria/mig/support/stage.ts` copies `apps/reference` (without state, tests and overlays) to a temporary directory, applies an overlay (`v1` = committed app, `versions/v2`, `versions/unique-fail`) and deploys it: locally a `dev` start (DEC-0144; after a failed start the harness serves the previous version's sources, the local reading of "the old app answers again"), on Cloudflare `deploy --target cloudflare --stage test-<random>` then `remove`. The database is read only with SELECTs: locally from Miniflare's SQLite file, on Cloudflare through the D1 HTTP API `query` endpoint of the stage's lowest-numbered `reference-<stage>-db-<n>` database (no Authorization header; the proxy injects it). Two stages, used one after the other: (1) initial deploy, unchanged redeploy, failing `unique-fail` deploy, data correction, successful re-run; (2) v1 → v2 with data, writes during the deploy, a secret and a session.
- MIG-AC-002: "creates the schema" = every app and framework table exists; "the record lists every migration once" = `__framework_migrations.id` in rowid order equals `framework/<file>` for the framework history then `app/<file>` for the app's, each in file order (DEC-0142 format); "changes no data" = every table's rows, incl. the record's applied times, are identical; "does not stop the app" = on a cloud every health probe during the deploy answers 204; locally a deployment is a `dev` restart, so only "applies nothing" is checked (DEC-0144).
- MIG-AC-003: failure = non-zero exit, same database names, every row unchanged, health 204, `schema-version` back to `v1`, dump unchanged. The re-run corrects the data (case `mig/relabelDuplicate` relabels one of the two `shared` children) and re-runs the same overlay. Preservation = same parent and child IDs and references (`note` dropped, `rank` = 0 added), no orphaned child, other tables unchanged.
- MIG-AC-006 (cloud only): at most 20 KV writes, one per 3 s, while the v2 deploy runs; at least one must be acknowledged (otherwise the check proves nothing) and every acknowledged one must be readable afterwards; exactly one stage database; `GET /api/ref/secret` returns the SHA-256 of the value set before the first deploy; `GET /api/ref/me` with the session from before answers as before.
- Not runnable until D: the Cloudflare paths depend on D-05's `deploy`/`remove`/`secrets set --target cloudflare` and were not executed here.

A schema-changing deploy of a MIG stage holds two databases while the run stage holds a third; how D-RUN stays within the cap of two is DEC-0318.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0287 — C-01's case-runner test updated for the registered sets
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `apps/reference/tests/fixture-and-cases.test.ts` (C-01-owned), DEC-0256

C-01's test "has no sets until C-T2 registers them" asserted `GET /api/cases` = `{ sets: {} }` and failed once the registry re-exports C-T2's sets, so the reference app's `verify` (and root `verify`) failed. The only edit outside C-T2's paths: that assertion now expects the registered set names `kv`, `mig`, `sql` (its unknown-case 404 check is unchanged). Owner instruction "do not stop for questions"; C-01's owner may prefer another form.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T2.

### DEC-0288 — Browser transfers use the published `<package>/client`, bundled and added to a page of the app's origin
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-003, FILES-AC-004 (browser part), FILES-AC-006 (browser part); `tests/compliance/criteria/files/browser.ts`

FILES-AC-003 needs `uploadFile` and `downloadUrl` called with tickets the test chooses (another name's, another content type's, an expired one), and needs `ApiError.status`, which the reference page's status text does not show. The reference page exposes no helpers. So the test bundles the installed package's `./client` entry (what an app imports) with esbuild into an IIFE (`window.fw`) and adds it to the reference app's own page with `page.addScriptTag`. The page is on the target's origin (`dev`, or the stage), so the browser treats the transfers exactly as an app's. Tickets are requested by a logged-in Node client from the reference app's ticket routes, as app server code would hand them out, and passed into the page unchanged. esbuild is not declared in `tests/compliance/package.json` (C-T3 does not own it); it resolves from the root `node_modules` (framework dependency, PAR-119). If a cloud stage's page ever sends a Content-Security-Policy that blocks inline scripts, the injection fails visibly; Playwright's `bypassCSP` would then be the fix (not set now, since `dev` sends none). Not a missing route: the scenario-level flow through the app's own page is E2E-009.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0289 — Ticket fields are read only through the documented ticket shape
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-003, FILES-AC-005, E2E-009

Where a criterion is about what a ticket permits, the tests read `url`, `method`, `headers` and `expiresAt`, the shape files.md §2 "Shared runtime shape" documents (DEC-0160). App code never does; the type inspection (FILES-AC-004) checks that app-facing types expose none of these.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0290 — "A ticket for one name cannot write another": the ticket's URL edited to name another file is refused
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-003

The test uploads with an upload ticket for `…/one.txt` (it writes that name and nothing else), then rewrites the ticket URL wherever it carries the name — plainly, percent-encoded, or inside a base64url JSON segment (a signed token) — to `…/two.txt`, sends each rewritten URL with the ticket's method and headers from the page, and expects each to be refused, `two.txt` absent and `one.txt` unchanged. It requires at least one rewrite to be possible, so the clause cannot pass vacuously.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0291 — "An upload with a different content type is rejected": a raw `fetch` from the page
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-003

`uploadFile` always sends the ticket's content type, so the mismatched upload is a plain `fetch` `PUT` to the ticket URL with `Content-Type: image/png` from the app's page. It passes when the request does not succeed (a refused status, or a network/CORS error on a cloud) and nothing is stored; a control upload with the ticket's own type then works.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0292 — FILES-AC-003's expired-ticket clause waits for a real expiry (PAR-233)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-003; `expired-ticket.spec.ts`

No contract option or reference route issues a shorter-lived ticket, and the expiry is checked by storage (R2 on Cloudflare), so the clock cannot be moved. The test uses the ticket once (control), waits until its `expiresAt` plus 30 s (bounded: the lifetime must not exceed PAR-233 + 1 min; test timeout PAR-233 + 5 min), and asserts the clause as written: `FILES.TRANSFER_FAILED`, a numeric status ≥ 400, `rejected by storage (HTTP n)`, no storage error body in the message, nothing written. It is in its own spec file so the wait overlaps the other specs. On Cloudflare it is expected to fail (DEC-0101); it is not skipped or weakened. A test-only short ticket lifetime would make the run 15 minutes shorter; that would be a framework change (not requested).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0293 — FILES-AC-004 browser part: a `127.0.0.1` page is the unrelated origin, against `dev`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-004; B-EV flag F6

Per F6 the browser part runs against `dev` (the driver's local target), not a harness. The unrelated origin is a page served by the test at `http://127.0.0.1:<port>` with `<base href="<app origin>/">`, so relative (local) ticket URLs target the app's storage cross-origin; on a cloud the ticket URLs are absolute anyway. A same-origin control precedes it. Outcomes are soft assertions, so the evidence shows the upload and the download result together.
Observed on `dev` (informational, 2026-10-20): the upload from `http://127.0.0.1:<port>` **succeeds**. `dev`'s HTTP server answers the preflight for `/api/__framework/files/*` with `Access-Control-Allow-Origin: <the requesting loopback origin>` (it does so for `http://127.0.0.1:1234`, not for `http://evil.example`), i.e. any page on a loopback origin, such as another local dev server, can use the app's tickets. This is the dev-server path F6 asked to check; the test reports it as a failure. Origin of the header (Vite's default `server.cors`, which allows loopback origins) is for a diagnoser to confirm.

Since fixed (root-cause record `ai/implementation/root-causes/2026-10-20-FILES-AC-004-dev-vite-default-cors-allows-loopback.md`, commit `69ae283`): `dev` runs Vite with `server.cors: false`, so the loopback page is refused and the test passes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0294 — FILES-AC-006: server part in-process; browser part through a cutting proxy against `dev`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-006

Server part: a running `dev` cannot be given unreachable storage, so the reference app runs in-process with `createTestApp(…, { unavailable: ["files"] })` and every `/api/files/*` route (put, get, head, delete, list, both ticket kinds) must answer 503 `FILES.UNAVAILABLE`. Browser part: the page on `dev` is opened in a context whose proxy is a small forwarding HTTP proxy run by the test (`bypass: "<-loopback>"`, since Chromium never proxies loopback otherwise); it drops the connection of every upload `PUT` to the ticket's path after 2 MiB, and the upload is throttled to 4 MiB/s (CDP) so the cut lands mid-body. Chromium retries a reset request a few times; each attempt is cut. Expected: `FILES.TRANSFER_FAILED`, status null, `interrupted after n bytes` with 0 < n < 16 MiB, nothing stored. Both parts are Local only (Where), so the driver selects them only on `local`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0295 — FILES-AC-005: the stage's storage as a stranger finds it
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-005 (Cloud)

The storage address comes from a ticket URL with its query string (where a signed URL carries its signature) removed. Unsigned `GET` of the file, of a sibling name, of the storage root and of the first path segment (bucket, path-style), and an unsigned `PUT`, must each get a 4xx without the file's bytes or name in the body, and the file must be unchanged. Cloud only: locally the signature is part of the path, so the test is not meaningful there and the driver does not select it.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0296 — FILES-AC-004 type inspection walks the published declarations, and the contracts
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-AC-004

The TypeScript checker walks the FILES exports (and `Services.files`) of the package's `exports` `types` files for `.` and `./client`, and of `docs/contracts/ts/{index,client}.d.ts` (bundler resolution, since the contracts use extensionless imports), collecting member, parameter, type and string-literal names; none may match the storage/signing/credential vocabulary, and `UploadTicket` / `DownloadTicket` must have no property besides the brand. A non-vacuity check requires the walk to have reached `createUploadTicket`, `createDownloadTicket`, `contentType`, `onProgress` and `nextCursor`. B-T3 inspects the sources; this inspects what an app installs.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0297 — AUTH-AC-006: per-target cookie names; the transaction cookie and the "Locally" clauses in-process
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-006

"As specified" is AUTH-REQ-006 plus auth.md §2: names `session_local` / `login_local` locally and `__Host-session` / `__Host-login` on cloud targets; HttpOnly, SameSite=Lax, Path=/, no Domain, cloud also Secure; lifetime PAR-250 (session) and PAR-251 (transaction) from Max-Age or Expires (±60 s). These are the per-target expectations the criterion states, so the tests branch on the target for them. A `test-` stage and local `dev` have no real login provider, so their `/api/auth/login` sets the session directly (DEC-0171) and no transaction cookie: on the target the test checks every cookie the login flow sets. The transaction cookie itself is checked with the stub login provider, which exists only in-process (`createTestApp(…, { stubLoginProvider: true })`), together with the "Locally, expired and future-dated" clauses (fake `Date`, as B-T3 did). Those in-process tests are registered only when the target is `local` (not skipped elsewhere), so a cloud run neither runs nor records them. Consequence for evaluators: on a cloud test stage the transaction-cookie attributes are not observed; that is only possible on a stage with a real provider (prodcheck: not-run, Google login mocked).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0298 — AUTH-AC-007: missing and wrong Origin through the deployed router with raw HTTP; directly in-process
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-007; DEC-0230

Through the deployed router (`dev` locally, the stage on a cloud): a POST with a session and no `Origin` (also `/api/auth/logout`, which must leave the session intact), with wrong origins (`https://evil.example`, `null`, a look-alike host, the same host with the other scheme, another port, a trailing slash), and with the public origin (the base URL's origin). Directly: in-process (local only), wrong and correct origins.
Observed on `dev` (informational, 2026-10-20): `Origin: https://localhost:<dev port>` (other scheme) is **accepted** through `dev` but refused by the worker when sent to it directly, so `dev`'s front server appears to rewrite or drop `Origin` before the forgery check. The test reports this as a failure; a diagnoser should confirm the mechanism.

Since fixed (root-cause record `ai/implementation/root-causes/2026-10-20-AUTH-AC-007-wrangler-proxy-rewrites-origin-scheme.md`, commit `69ae283`): `dev` proxies `/api` with `changeOrigin: true`, so wrangler no longer rewrites the `Origin` scheme and the test passes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0299 — AUTH-AC-009: only the test-stage part
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-009

On the target (local or `test-` stage): chosen level, ID used as given (including characters a derived ID never has) and display name appear in `/api/auth/me`, `c.var.user` and the guards; a fixed default ID per level; `anonymous` logs out. The production 404 is not-run (Google login mocked, plan §8.1). "Production bundles contain no mock module" is a bundle inspection (CORE-AC-006 build part, B-T4) and is not checked or tagged here.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0300 — E2E-009: BMP photos through the reference app's page; request and source checks
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-009

The photos are uncompressed 24-bit BMPs of at least 20 MB and 100 MB (decimal), generated on disk for the run and removed afterwards (one item per size the scenario names). Upload through `file-input` + `upload` until `upload-status` is `Uploaded.`; view: the item's `preview` reaches the photo's natural dimensions; download: the item's `download` link, observed through Playwright's `download` event, saved and compared by size and SHA-256. "Requests only to the app's API and through framework helpers": every page request is a ticket URL the app's ticket routes returned, a same-origin `/api/*` request outside `/api/__framework/`, or a same-origin GET loading the page or its client code; each photo went to storage by exactly one PUT to an upload-ticket URL, and `/api/files/content` was never called. "No storage or CORS settings": the reference app's code and configuration files (excluding tests, generated migrations and the version overlays) contain none of the storage/CORS vocabulary.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0301 — No missing reference routes
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: C-01 `apps/reference/ROUTES.md`

Every route these tests use is in ROUTES.md (`/files/*`, `/levels/*`, `/ref/me`, the framework's `/api/auth/*`). Not needed but would help: a way to issue a short-lived ticket on test stages (DEC-0292).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T3.

### DEC-0302 — Target-specific parts are defined only on their targets
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-007, E2E-011, E2E-014, COMPL-REQ-001

Where a scenario states different steps per target (E2E-007 local in-process part; E2E-011 local failing-writer part; E2E-014 cloud scan part and local rebuild part), the test for one target's part is defined only when `target()` is that target (`if (target().target === "local") test(...)`), not skipped elsewhere: the driver turns each skipped tagged test into a `not-run` entry, which would misstate a part that does not apply. Shared parts (E2E-011's entry lookup, E2E-014's committed-values check) run on every target and branch only on where the target stores its entries.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0303 — E2E-001: offline namespace after scaffolding; capabilities through the template's pages
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-001, LOCAL-AC-001

Scaffolding (`skill/scripts/scaffold`) needs the npm registry for the template's other pinned dependencies (DEC-0276), so it runs with cloud credentials removed from the environment (`CLOUDFLARE_*`, `CF_*`, `AWS_*`, `GOOGLE_*`, `GCLOUD*`, `CLOUDSDK_*`, `AZURE_*`, `SST_*`) but with the proxy. Every later step runs under `unshare -rn sh scripts/offline.sh` (no network at all, stronger than "cloud providers blocked"), with the same credentials removed and `HOME` an empty directory; the test first shows `api.cloudflare.com` is unreachable there. Because the browser must reach `dev` inside the namespace, `support/template-pages.ts` (run by Node with type stripping) starts `dev` and Chromium inside it and prints one result line. "Imports every public subpath" = every key of the installed package's `exports` map imports in Node and type-checks (`tsc --strict --skipLibCheck`, Bundler resolution). "Each capability through the template's pages": CFG (heading shows `greeting` set in `config/local.json`), AUTH (Log in / Log out; admin via mock-login), SQL (Notes), KV (Status, kept after reload), FILES (upload, list, download same bytes), SEC (Admin "Check secret" after `secrets set apiKey`), LOG (the note's entry in `.logs/`). Selectors are the template pages' visible texts (the template has no test IDs). The scaffolded app lives in the OS temp directory and is removed afterwards.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0304 — E2E-003: violations, expected rules and references
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-003, CHECK-REQ-003

E2E-001 and E2E-003 share one scaffolded app (one spec file, serial). Each violation is one new file under `src/server/` (or the edited `migrations/sqlite/0000_schema.sql`), restored after its `verify` (run offline). Pass per violation: `verify` exits non-zero and a diagnostic line names the file, the rule ID and `(read skill/reference/<file>.md` per check.md §2 "Diagnostics" and DEC-0181: AWS SDK import and `node:fs` → `prototype-framework/allowed-imports` + `http-and-validation.md`; `c.env.DB` → `no-env-access` + `configuration.md`; raw `sql` → `no-raw-sql`, `rightJoin` → `no-dialect-features`, edited migration → `migration-checksums`, all + `sql-and-migrations.md`; `any` → `@typescript-eslint/no-explicit-any` + `troubleshooting.md`. `caches.default` may instead fail type checking (a TS error line naming the file). "A SQLite-only function" has no Drizzle helper, so it is `strftime` through Drizzle's `sql` template; either `no-dialect-features` or `no-raw-sql` counts. The test fails while the skill reference files do not exist only if `verify` stops printing them; their existence is CHECK-AC-003's (E-01).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0305 — E2E-004: in-run coverage part; the pass part is read from the run's own record
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-004, COMPL-REQ-006

E2E-004's pass condition is a property of a whole run's evidence record, which is written after every test finishes, so no test of that run can observe it (running the suite recursively would double cloud usage). The tests check what a run can: (a) coverage — every criterion the driver expects to run on this target and tier (`expectedCriteria`) has at least one tagged test in the files this target's run executes (`tests/compliance/**`, plus `packages/framework/test/integration/**` locally; driver.ts limits cloud runs to `tests/compliance/`); (b) the evidence writer's schema matches the contract's required fields and properties and rejects invalid records. Titles say "coverage part" / "record part". The evaluator judges E2E-004 itself from that run's record (every other applicable result `passed`, record schema-valid). Expected to fail until every component's tests exist (SKILL, DEMO criteria in phases E/F; other C-T* items until merged).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0306 — E2E-005: browser fetches from the app page; exposure detectors
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-005

The browser logs in via `/api/auth/mock-login` and calls ROUTES.md's protected routes with `fetch` from the app's own page (`/`), so cookies and `Origin` are the browser's. Permitted actions per level: `/levels/anyone` all; `/levels/user` (GET, POST), `/levels/current`, `/kv/value`, `/files/head` user and admin; `/levels/admin` (GET, POST) admin only; refusals 401 `AUTH.UNAUTHENTICATED` (anonymous) / 403 `AUTH.FORBIDDEN` (user). Every `/api` response's body and headers (except `Set-Cookie`, which carries the framework's own session) is checked for the words google, oidc, oauth, openid, issuer, iss, email, id token, access token, refresh token, jwt (camel/snake case split, case-insensitive), email addresses and JWT-shaped strings. "App-facing types" = the shipped declaration files of `.`, `./client`, `./testing` (CORE-REQ-005's app-importable subpaths) and every declaration file they import; identifiers and string literals are checked with the same detector, comments are not (they are documentation, not types).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0307 — E2E-013/E2E-014 secret checks without printing values
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-013, E2E-014, SEC-REQ-002, CLI-REQ-004

E2E-013 finds the secret `apiKey` in responses through its digest (`GET /api/ref/secret` → SHA-256; every substring of each short response text is hashed), so it needs no copy of the value and runs on every target; locally it also checks every `.dev.vars` value (≥ 8 characters). E2E-014 sets a fresh value with `secrets set apiKey` (standard input) — on a cloud on the run's stage, then deploys that stage again; locally in a copy of the reference app under the git-ignored `.framework/e2e/` (the tree stays clean). Scans: repository = `git ls-files` plus untracked non-ignored files; build outputs = the app's `.framework/` (LOCAL §2 "Build output"); browser assets = everything reachable from `/` (same origin, outside `/api`, ≤ 300 files); logs = `.logs/` locally, the stage's entries of the day in the shared bucket on a cloud. `.wrangler/` (local runtime state) and `.dev.vars` (the local secret store itself) are not scanned. Assertion messages name where a value was found, never the value. Local "rebuild" = restarting `dev`, which builds (DEC-0215); the served value is checked unchanged for 10 s after the edit.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0308 — E2E-010 and E2E-012 stage handling
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-010, E2E-012, D-RUN-M

Each scenario creates its own `test-<random>` stages (`newTestStage()`) and removes them in `finally`; each deploy runs from its own copy of the app under `.framework/e2e/` so concurrent deploys never share a build directory. The first Cloudflare deploy of a stage stops when `apiKey` is unset (provisioning.md "First Cloudflare deploy"); the helper then sets a fresh value and deploys again. E2E-010: v2 = the `versions/v2/` overlay; "applies nothing" = the stage keeps the same single database (a schema-changing deploy copies to a new one, MIG-REQ-006) and the dump is unchanged; "no downtime" = every probe of `/api/ref/schema-version` (no database rows) during the second v2 deploy answers 200, one per second. E2E-012: the kept stage holds the migration fixture plus its own KV value and file; the removed stage its own KV value and file and one log entry, which must remain after removal. Data per scenario: tens of rows (fixture 3 + 5 rows, 2–3 files, 1–2 KV keys), within the plan's cloud usage limits.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0309 — E2E-016 scan details
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-016

Scanned: `docs/contracts/ts/**/*.ts` except `internal/`, and `docs/contracts/http/framework.openapi.yaml`. TypeScript files are tokenised with the TypeScript scanner (identifiers, string and template literals, comments); the YAML file line by line. Case-sensitive whole-word matching; in identifiers a word boundary is also a camel-case boundary (`getS3Client`, `OAuthToken`), a lower-case term also matches its capitalised camel-case form (`tokenIssuer`), and multi-word terms also match their identifier spellings (`idToken`, `IDToken`, `access_token`). A test checks `terms.txt` equals the scenario's list, and positive/negative controls check the scanner. The scan test also runs in a local milestone run, where the driver records E2E-016's "review" part from it; the review itself is F-04's `validation/reviews/E2E-016.md` (the evaluator must not read the scan as the review).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0310 — In-process reference app from Playwright
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-007, E2E-011

The in-process parts import `apps/reference/src/app.ts` at run time (its `app` export, DEC-0214) and call `createTestApp` with the working directory set to `apps/reference` (restored afterwards), so the committed migrations apply. E2E-007's "copy the user ID from the account page" reads `/api/auth/me`, the account page's data (framework.openapi.yaml); "redeploy" is a second `createTestApp` with `framework.admins` (testing.d.ts: each call is one build).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T4.

### DEC-0311 — CLI-AC-002's Postgres-only fixture is `.limit(10).offset(-1)` (corrects DEC-0239)
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-002, DEC-0239, `packages/framework/test/fixtures/cli/pg-only/`, `packages/framework/test/fixtures/cli/pg-only-offset/`, `packages/framework/test/integration/cli/verify.test.ts`

DEC-0239 describes the CLI-AC-002 fixture as `.limit(-1)` and says the failing dialect is not separately asserted. Both stopped being true with commit `29db99e` (B-EV flag F11). Drizzle ORM 0.45.4 (PAR-102) sends no LIMIT clause for a negative number on either dialect, so `.limit(-1)` returned every row on SQLite and on Postgres, and `verify` correctly exited 0 (root-cause record `ai/implementation/root-causes/2026-10-19-B-17-negative-limit-not-pg-only.md`, reviewed and accepted). The fixture's `GET /items` now calls `.limit(limit).offset(offset)` and its test requests `?limit=10&offset=-1`. Drizzle sends `limit ? offset ?` with `[10, -1]`. Local D1 returns every row, and PGlite raises "OFFSET must not be negative" (probe output in the record). A bare `offset` without `limit` would not work: SQLite would then reject the query too. The test keeps the original assertions (non-zero exit, the fixture test named). It now also asserts that type checking, the portability rules, the migration checker and the zod check each pass, that `tests (sqlite)` passed, that `tests (postgres)` has exactly one failure whose `FAIL` line is the fixture test inside the postgres section, and that the summary is `verify failed: tests (postgres)`. DEC-0239's LOCAL-AC-003 fixture (`selectDistinct` ordered by an unselected column) is unchanged.
Item: C-INT (correction; the fix was made under the §8 root-cause procedure).

### DEC-0312 — HTTP-AC-001's byte identity holds only for entry pages with absolute script URLs (refines DEC-0213)
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-001, HTTP-REQ-001, DEC-0213, `packages/framework/test/integration/core/harness/harness.ts`, skill (E-01)

DEC-0213's test requires the deep-link response to be byte-identical to `GET /`. That holds only when the entry page loads its scripts with absolute URLs. Vite's dev server (PAR-113) serves the SPA fallback for a path other than `/` and rewrites relative script URLs against `base` (`./main.ts` → `/main.ts`). It must do this, or the script would resolve under the deep path. So a page with relative URLs differs from `/` in that one attribute, and it still loads correctly (root-cause record `ai/implementation/root-causes/2026-10-19-HTTP-AC-001-deep-link-relative-script-src.md`, reviewed and accepted). The fixture page now loads `/src/client/main.ts`, as `apps/template/index.html` does (commit `3d57cc0`), and every assertion is kept. Consequences: the framework must not be changed to undo Vite's rewrite, because relative-URL pages work on deep links only because of it. Any test that compares the deep-link page with `/` byte for byte uses absolute script URLs. Skill examples (E-01) show the template's absolute form.
Item: C-INT (correction).

### DEC-0313 — Downloads are saved under the file's name
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; not yet implemented) · Affects: FILES-REQ-003, files.md §2 (Local, Cloudflare), `packages/framework/src/files/local/route.ts`, D-02

Observed in phase C: a local download is saved under the ticket token (the last segment of the ticket URL), because the local route sends a bare `Content-Disposition: attachment`. files.md does not say what name a download gets. The simplest reasonable behaviour is chosen. A storage response to a download ticket names the file with `filename*=UTF-8''<percent-encoded file name>` (RFC 6266/8187) in its `Content-Disposition`. That is `attachment; filename*=…` for every content type except raster images, which stay `inline; filename*=…` as they are now. The whole file name is used and nothing is interpreted as a path (FILES-REQ-002); browsers replace `/` and other unsafe characters when they save the file. There is no app-facing change and no new option. Locally the `/api/__framework/files/*` route adds the parameter. On Cloudflare the download ticket signs R2's `response-content-disposition` query parameter with the same value (the S3 GetObject override). D-02's tests confirm that R2 honours it on a presigned GET. If it does not, Cloudflare keeps the default name and this entry is revised. C-INT changes no code. The local change is a small follow-up to the FILES local route (B-11's paths), and the Cloudflare part belongs to D-02 (plan §5 "From phase C"). The implementing item updates files.md.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-INT.

### DEC-0314 — LOG-AC-004 "written outside a request": the design has no such writer; the clause stays blocked pending the owner
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner decision outstanding, plan §11 Q8) · Affects: LOG-AC-004, LOG-REQ-002, LOG-REQ-004, `docs/components/log.md`, `tests/compliance/criteria/log/keys.test.ts`, D-01

Finding from log.md and the contracts: the design expects no mechanism that writes an entry outside a request. Each target runtime creates one writer per request, right after the request ID (log.md §2 "Writer and sinks"). The only app-facing API is the per-request `LogService` (`log.d.ts`). The entry schema's `requestId` is "present when written during an HTTP request". No framework path writes without one. There are no scheduled handlers, and queues were removed. CORE's deferred configuration checks run inside the first request. On Cloudflare each write is the request's `waitUntil`. LOG-REQ-004's "random value when it has none" is therefore a defensive key rule with no producer in this phase. No fixture, background hook or app-facing API is added for it, because no requirement asks for one (prompt §3: don't over-engineer). This replaces C-T1's note asking C-01 for a fixture. Consequences: C-T1's test for that clause keeps reporting `blocked` (never passed, never skipped). D-01 implements the key builder's no-request-ID branch and unit-tests it: an entry without `requestId` gets a key ending in `-<random>.json`, and two such entries differ. That unit test is the only evidence for the rule. Owner item (plan §11 Q8): drop the clause from LOG-AC-004 and keep LOG-REQ-004's rule, or name the source of out-of-request entries.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-INT.

### DEC-0315 — The framework lint covers the test-author suites (extends DEC-0242)
Origin: ai-proposed · Status: accepted · Affects: DEC-0242, root `package.json` `lint`, `eslint.config.js`, `packages/framework/test/**`

Root `lint` is now `eslint packages/framework/src packages/framework/bin packages/framework/test`. The seven findings DEC-0242 left under `packages/framework/test/**` were cleared without changing any test's behaviour. Two were `_`-prefixed unused names (a stub parameter, a field dropped by a rest pattern). For test files, the config sets `no-unused-vars` with `argsIgnorePattern`/`varsIgnorePattern` `^_` and `ignoreRestSiblings`. Four were `{}` used as the empty configuration declaration in the framework's generics (`DefinedApp<{}, never>`, `RequestVars<{}, never>`, `AppEnv<{}, never>`). Replacing it with `object` or `Record<string, never>` would change the type arguments, so for test files `no-empty-object-type` allows object types. The last was an unused `eslint-disable-next-line no-control-regex` directive. It was removed from `test/fixtures/support/app.ts`, because the root config does not enable ESLint's core rules, so the directive disabled nothing. `tests/compliance/**` and `skill/scripts/**` are still not linted.
Item: C-INT.

### DEC-0316 — The template ships a `.gitignore`; scaffolder tests run in the root unit layer
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-005, DEC-0276, `apps/template/.gitignore`, `vitest.unit.config.ts`, `skill/scripts/scaffold.unit.test.ts`

`apps/template/.gitignore` lists `node_modules/`, `dist/`, `.framework/`, `.wrangler/`, `.logs/`, `.dev.vars` and Playwright output. Inside this repository the root `.gitignore` already covered them. A scaffolded app lives outside the repository, so without this file it could commit `.dev.vars`. The scaffolder copies every template file outside its skip list, `.gitignore` included. A new scaffolder unit test checks the copy and the real template file's entries. The scaffolder still does not rename the app, and still leaves `vendor/` (the framework tarball) tracked on purpose (DEC-0276). `npm run test:unit` now also runs `skill/scripts/**/*.unit.test.ts`. Before, only `skill/scripts/vitest.config.ts` ran them.
Item: C-INT.

### DEC-0317 — Cloudflare D1 is not used until its daily limit has reset and the caps are met
Origin: owner (direction of 2026-10-20, relayed to C-INT by the orchestrator) · Status: accepted · Affects: plan §1 "Cloud usage limits", D-RUN, D-RUN-M, E-RUN, F-03, DEC-0261

Phase A spikes wrote about 1.22 million D1 rows on 2026-10-19 against the free plan's 100,000 rows written per day. Cloudflare D1 must not be used until the daily limit has reset and the plan's per-item and per-run caps can be met. Until then, every criterion and scenario that needs D1 on Cloudflare is recorded `blocked` with detail "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset". This uses the driver's `--blocked <IDs>=<reason>` (or `*=<reason>`, which deploys nothing), DEC-0261. Unit tests against stubbed Cloudflare APIs are unaffected.
Item: C-INT (recording an owner direction).

### DEC-0318 — Phase D cloud runs hold at most two D1 databases at once
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: plan §1 "Cloud usage limits", §5 D-RUN and D-RUN-M, DEC-0263, DEC-0268, DEC-0278, DEC-0286, DEC-0308, MIG-AC-002, MIG-AC-003, MIG-AC-006, E2E-010, E2E-012, PAR-219

C-T2's estimate per Cloudflare run is about 350 base rows written, up to about 700 with index entries, under 2,000 rows read, and about 100–150 API requests from the MIG tests, plus those of 2 stages × 3–4 deploys and removals. That is within the caps. The databases are the problem. A run stage holds one D1 database. A stage's first deploy migrates in place (DEC-0268), and so does a redeploy without pending migrations, so each holds one database. A schema-changing deploy copies (MIG-REQ-006) and holds two. The MIG file (DEC-0286), E2E-010 (v1 → v2 on its own stage) and E2E-012 (a kept and a removed stage) therefore reach three databases alongside the run stage, which breaks the plan §1 cap of two. Rule: D-RUN and D-RUN-M run in passes, each holding at most two databases.
1. **Main pass:** `npm run compliance -- --target cloudflare --only <every expected ID except MIG-AC-002, MIG-AC-003, MIG-AC-006>`. It uses the run stage plus at most one further stage at a time (DEC-0278's lock; further stages deploy the committed schema, so one database each).
2. **MIG pass,** after the main pass has removed its stage: `--only MIG-AC-002,MIG-AC-003,MIG-AC-006` with no run stage. The MIG tests deploy their own stages and do not use the run stage, so the pass gives the driver `--base-url` and nothing else is deployed. If D-05 or D-RUN find that the driver needs a real base URL, D-05 adds a `--no-stage` form instead (decided in D). The MIG stages are used one after the other (DEC-0286).
3. **Milestone (D-RUN-M):** E2E-010 and E2E-012 run as separate passes, each with no run stage (`--base-url`, as above), and the other milestone items run in a pass of their own. D-T1's stage-lifecycle tests (PROV-AC-*) follow the same rule.
Before each pass, D-RUN checks the account's database count (PAR-219) and the day's D1 usage, then records both readings (plan §1). D1 use waits for DEC-0317 in any case.
Item: C-INT.

## Implementation phase: local and Cloudflare — phase C follow-ups, phase D Cloudflare, phase E skill (2026-10-20)

Entries DEC-0319 to DEC-0391 were integrated by the C/D/E integrator from the drafts of items fix-c3, C-T5, D-01…D-06, D-T1/D-T2, E-01…E-03, E-T1 and fix-e1 (plan §10.4), and DEC-0391 from the C-EV evaluation. No Cloudflare call was made by any of these items: everything cloud-side is verified offline against fakes and is confirmed live by D-RUN once the D1 stop (DEC-0317) ends. No parameter changed.

### DEC-0319 — The driver also runs the unit layer on local, for an explicit list of unit-level criteria only
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-003, COMPL-REQ-006, COMPL-AC-002, COMPL-AC-006, COMPL-AC-007, GOOGLE-AC-002, PROV-AC-007, CLI-AC-003, plan §10.1, §10.3, compliance.md "Driver", DEC-0261 (supersedes its first bullet's "each runs once" for the local unit layer)

Plan §10.3 says unit tests count as evidence only for unit-level criteria, and C-EV / COMPL-REQ-006 read "works" only from evidence records. Before this decision the driver ran only `vitest.integration.config.ts` and the Playwright `integration`/`e2e` projects, so no record could ever show a unit-level criterion `passed` (root cause, cause B).

Rule:
- `UNIT_LEVEL` in `tests/compliance/harness/expected.ts` is the list. On `--target local`, the driver runs `npx vitest run --config vitest.unit.config.ts -t <tag pattern of the unit-level IDs it runs>` once, after the integration Vitest run and before Playwright, and keeps `raw/vitest-unit.{log,json}`. It skips the call when no unit-level ID is to be run (`--only`, `--blocked`). Cloud runs never run the unit layer.
- A unit test's outcome is folded only into the unit-level IDs its title carries (`selection.ts` `scopeTests`; `TestOutcome.ids`). The `-t` pattern is a filter, not this guard: a unit title may carry several IDs, and unit files hold fixture literals such as `"[KV-AC-001]"` in `tests/support/tags.unit.test.ts` (about 40 IDs appear bracketed in unit titles).
- The selection (which configs, paths, projects, and which IDs each may evidence) is defined once, `runnerSelection` in `tests/compliance/harness/selection.ts`, and read by the driver and by E2E-004 (DEC-0320).

Membership is decided from each criterion's text, not from where its tests live:

| ID | Why unit-level (criterion text) |
| --- | --- |
| COMPL-AC-002 | "A unit test of the report generator shows a criterion whose test has lost its tag as untested." Names a unit test. |
| COMPL-AC-007 | "A unit test of deploy database discovery against a fake target …". Names a unit test. |
| GOOGLE-AC-002 | "Unit tests feeding the validator hand-built tokens reject …". Names unit tests; plan §10.3's own example. |
| PROV-AC-007 | "With the cloud's response stubbed so that an existing shared log bucket belongs to another account …". Stated over a stubbed cloud response, which only a unit test with a fake cloud can produce locally. |
| CLI-AC-003 | "Injected failures in `deploy`, `remove` and the compliance runner, including a failure during cleanup …". Stated over injected failures (fakes), which is a unit test's setting. |
| COMPL-AC-006 | "The release report for a commit says 'works' only when … A commit with one `not-run` automated criterion, or with a certification invalidated by a recorded entry, is reported as not working …". Stated over constructed inputs to a pure report function (a commit with a chosen set of records and invalidations); real commits in that state cannot be produced by a run. |

Not on the list:
- COMPL-AC-001 ("One command runs the suite against each target, and the per-target lists … match …") and COMPL-AC-003 ("Evidence records validate … A run with a deliberately omitted criterion records it … A run started from a working tree with a modified tracked file records no evidence") are properties of a real run. Their unit tests with fakes do not count on their own (§10.3). They need integration-layer evidence from the driver itself (for example the self-test path, `--self-test`, for COMPL-AC-003, and a run-level check for COMPL-AC-001); until then they stay `not-run` and E2E-004's coverage part lists them. Open for the owner of C-02.
- SKILL-AC-005 ("Scaffolding into a directory with existing files stops without changing them") is behavioural; its integration test belongs to cause C of the record (Review: an integration-layer test of the real scaffolder is preferred).
- Any other ID: its unit tests may carry tags but are not evidence.

`selection.unit.test.ts` checks that every listed ID is a Local criterion of the catalogue.

Wording change, compliance.md "Driver": "runs each test runner once" → "runs each selected test layer once (on local also the unit layer, for the unit-level criteria only)". Plan §10.1 `npm run compliance` line likewise.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause B).

### DEC-0320 — E2E-004's coverage part lists the driver's exact selection through the runners
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-004, DEC-0305, DEC-0265

DEC-0305's coverage part ("has at least one tagged test in the files this target's run executes") was implemented as a regex scan of `*.test|spec.ts` sources, which cannot see titles built at run time (the KV and SQL shared case sets tag through `t(id, …)` / `tag(id, …)` in helper modules), so IDs the same run recorded `passed` were reported uncovered (root cause, cause A).

Rule: the coverage part lists, without running a test body, exactly the invocations of `runnerSelection` for the target (`tests/compliance/tools/listing.ts` `listDriverTests`: a Vitest run whose name filter matches nothing, per config; `playwright test --list` over the driver's projects and paths), scopes each listed test to the IDs it may evidence (`scopeTests`; unit-layer tests only for unit-level IDs), and reports the expected IDs no listed test carries (`uncovered`, `selection.ts`). No source scan supplements it, so the check cannot count a tag the driver would not run. Listing problems (load errors, non-zero exits) are appended to the failure message. The listing writes its Playwright JSON to its own file, never the run's `PLAYWRIGHT_JSON_OUTPUT_NAME`. The traceability report uses the same listing executor (`listSelection`) with every layer and keeps its source scan as a supplement (DEC-0265). DEC-0305's wording becomes "has at least one tagged test that the run's runners collect with the driver's selection".
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause A).

### DEC-0321 — COMPL-AC-001 and COMPL-AC-003 are compliance-level, evidenced by nested real runs of the command in a clone
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-AC-001, COMPL-AC-003, DEC-0319, `tests/compliance/criteria/compl/`

Both criteria are stated over runs of the one command, so they are not unit-level and stay off `UNIT_LEVEL`. Their tests (`tests/compliance/criteria/compl/{targets,evidence}.test.ts`, integration layer, selected by the driver like every other criterion) run the real `npm run compliance -- …` as a child process:
- in a throwaway `git clone --shared` of HEAD with the installed `node_modules` linked in (untracked, excluded), so a test can commit a deliberate case or modify a tracked file without touching the working tree the enclosing run records from;
- with `--out <temp dir>`, no `COMPLIANCE_*`/`CLOUDFLARE_*`/`AWS_*` variables, and a dead proxy, so a nested run can make no cloud call;
- never recursing into the real suites: a nested run either blocks every ID (`--blocked '*=…'`, so it lists and records without starting `dev`, deploying or running a test) or uses `--self-test` (only `harness/self-test/`).
Each record a nested run writes is checked against `docs/contracts/schemas/evidence.schema.json` by a small checker in the test support (independent of the writer's own validator).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T5.

### DEC-0322 — How each clause is read
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-AC-001, COMPL-AC-003

COMPL-AC-001:
- "One command runs the suite against each target": the same command with `--target local|cloudflare|aws` writes a record for that target and commit. "Per-target lists of executed criteria and scenarios" = the IDs in that record's results; a blocked-everything run lists what the run would execute, and that a full run executes exactly that list is shown by the enclosing run's own record and E2E-004's coverage part. The test does not execute a cloud run (prohibited here; also the enclosing cloud run is that evidence).
- The oracle reads the Where columns/lines itself ("cloud" = both clouds, except in cloudflare.md/aws.md; a segment naming no target inherits the first segment's targets), and compares both ways (nothing extra, nothing missing) per target and tier. Phase not-run rules (AWS, Google mocked) change a result's status, not membership, so IDs still match the Where texts.
- "Milestone items are compared only in milestone runs": no milestone-only item appears in any automated run, and the union of the three milestone runs' lists equals COMPL-REQ-006's named list.

COMPL-AC-003:
- "Validate against the schema": records of a self-test run and of a list-only run conform to the contract.
- "A deliberately omitted criterion": read two ways, both tested: (a) its only test removed from the suite (committed in the clone; `--self-test`) → `not-run` with a reason; (b) left out with `--only` → every omitted local ID `not-run` with a reason, none `passed`.
- "A deliberately failing HTTP check": a self-test case committed in the clone uses the harness client (`expectStatus`) against a local server answering 503 with an ErrorResponse carrying a random code and requestId; the record's `failed` detail must contain all three.
- "Started from a working tree with a modified tracked file": `docs/README.md` modified in the clone → non-zero exit and no file at all under `--out`, both for `--self-test` and for a list-only local run; control: after reverting, the same clone records.
- Where "cloud": the clauses are properties of the driver and writer, which are target-independent; on a cloud run these tests run the same local nested runs (a nested cloud run would deploy). The cloud HTTP-failure path uses the same `HttpCheckError` message. Open for the owner if a cloud-specific check is wanted.

Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C-T5.

### DEC-0323 — Cloudflare log writer: `LOGS` binding, per-request sink, fallback without the binding
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: LOG-REQ-001, LOG-REQ-004, LOG-AC-001, LOG-AC-002, LOG-AC-004, LOG-AC-005, DEC-0128, DEC-0189, DEC-0314, cloudflare.md §2 "Runtime", log.md §2 "Cloudflare", D-03, D-T2

The shared log bucket `prototype-logs` is bound to the stage Worker as the R2 binding `LOGS` (`BINDINGS.logs`). `r2LogSink` (`src/log/cloudflare/sink.ts`) writes each entry as one object: the body is the entry's JSON, `httpMetadata.contentType` is `application/json`, and the key comes from `logObjectKey` (`src/log/cloudflare/keys.ts`): `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json` from the entry's UTC time, with `<id>` the request ID or, when there is none, `crypto.randomUUID()` (the only evidence for LOG-REQ-004's random-value rule is `keys.unit.test.ts`, DEC-0314). The write promise has its rejection swallowed and is handed to the request's `ctx.waitUntil`; the sink returns nothing, so the writer never waits (DEC-0128). A synchronous throw from the binding or from `waitUntil` is dropped. The sink needs the request's env and execution context, so `StageOptions` gained an optional `requestSink(c)` that replaces the static `sink` per request (the local runtime and `createTestApp` are unchanged). Without a `LOGS` binding (a misconfigured Worker), entries are printed as the local marked lines (`workerOutputSink` format) rather than failing anything, since LOG-REQ-001 forbids a log write from failing the caller and the lines still show in the Worker's logs. This replaces B-16's interim stub (DEC-0189). Verified offline: unit tests with fake buckets; the runtime against Wrangler's local R2 (`getPlatformProxy`); a real `build --target cloudflare --stage test-x` bundle under local workerd writing to `LOGS`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-01.

### DEC-0324 — Provisioning-derived identifiers reach the Cloudflare runtime as bindings; one framework variable
Origin: ai-proposed · Status: accepted · Affects: config.md §2 "Delivery", DEC-0153, DEC-0190, DEC-0087, cloudflare.md §2, D-03

config.md §2 lists the database, bucket and log-bucket identifiers and the public origin as values delivered at deployment time. On Cloudflare the adapters use bindings, not identifiers, so the database (`DB`), stage bucket (`FILES`) and log bucket (`LOGS`) identifiers are delivered as the targets of those bindings. The only Worker variable is the plain-text `FRAMEWORK_PUBLIC_ORIGIN` (DEC-0190), which the runtime reads per request. No variable repeats a binding's identifier, because nothing would read it. `cloudflareWorkerSettings` refuses a public origin that is not `https://<host>[:port]` with no path, and `checkWorkerSettings` refuses any variable or binding named `SECRET_*` with `CORE.MISCONFIGURED` (DEC-0087: declaring one would replace the Worker secret). D-03 must build the SST Worker from these settings and must not add bindings of its own with that prefix.
Item: D-01.

### DEC-0325 — Stage Worker settings as target data, verified under local workerd
Origin: ai-proposed · Status: accepted · Affects: CF-REQ-001, CF-AC-001, cloudflare.md §2 "Worker settings", D-03, D-05

`src/targets/cloudflare/settings.ts` is plain data that no Worker bundle imports. `cloudflareWorkerSettings({ workerName, bundle, assetsDirectory, publicOrigin, database: { id, name }, filesBucket })` returns the Worker name, main module, compatibility date (`COMPATIBILITY_DATE` of `build.ts`, shared with local `dev`), and `assets: { directory, notFoundHandling: "single-page-application", runWorkerFirst: ["/api", "/api/*"] }`, plus the D1/R2 bindings and variables. `wranglerWorkerConfig(settings)` gives the same settings in Wrangler's form (`workers_dev: true`, `assets.not_found_handling`, `assets.run_worker_first`), which the unit test runs under local workerd with a real Cloudflare test-stage bundle. Observed with Wrangler 4.149.0: `/api`, `/api/<x>` and deeper paths reach the Worker (unknown ones are JSON `HTTP.NOT_FOUND` 404s); `/`, `/notes/42` and `/apix` serve the entry page; `/assets/app.js` serves the asset. The Worker name, the assets directory (the built client) and the bucket name are inputs: D-03/D-05 choose them. Not verified on Cloudflare (no cloud calls in D-01); D-RUN's CF-AC-001 confirms it on a test stage.
Item: D-01.

### DEC-0326 — No separate Cloudflare secrets module; the Worker env reader is SEC's
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-003, SEC-REQ-005, DEC-0157, plan D-01 "Owns" (`FW/src/secrets/cloudflare/**`)

Worker secrets appear in the Worker env as `SECRET_<NAME>`, exactly as `.dev.vars` values do locally, so `envSecretReader(env, "cloudflare")` (DEC-0157) is already the Cloudflare reader. No `src/secrets/cloudflare/` code was added: it would duplicate it. The Cloudflare runtime's tests show reading `SECRET_<NAME>`, a new value on the next request (no cache across requests), an empty or deleted secret as `SEC.MISSING`, and a secret in an error message absent from the response and from the stored R2 log object. Setting values (`PUT …/workers/scripts/{name}/secrets`) is D-03's `setSecret`, which uses `secretLocation("cloudflare", name)` from `config/secret-locations.ts`.
Item: D-01.

### DEC-0327 — Cloudflare ticket issuer, signer and wiring helper
Origin: ai-proposed · Status: accepted · Affects: FILES §2 "Cloudflare", FILES-REQ-003, FILES-REQ-004, DEC-0098, DEC-0160, DEC-0189, D-01, D-05

`src/files/cloudflare/` implements DEC-0098 as specified. `presignUrl` wraps aws4fetch 1.0.20 (`service: "s3"`, query signing, `allHeaders: true`, explicit `X-Amz-Expires`, injectable signing time). `allHeaders` is used for downloads too: a download passes no headers, so it signs `host` only, the same as `{ signQuery: true }`. `createCloudflareTicketIssuer({ accountId, bucket, credentials, now? })` issues the DEC-0160 JSON shape, with `expiresAt` = signing time + PAR-233 and `X-Amz-Expires` = PAR-233 / 1000. `createWorkerTicketIssuer({ accountId, bucket }, frameworkSecret)` is the `StageOptions.tickets` value for Cloudflare: it reads `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey` on each ticket, so a rotated secret takes effect at once and a missing one fails with the secrets component's own error. The account ID and bucket name are deployment-time settings that D-01 delivers to the Worker; D-02 does not choose their variable names. It works offline. The tests check the signer against the published SigV4 presigned-GET example (exact signature), and every ticket against an independent SigV4 reference built from the specification with `node:crypto` (`sigv4-reference.test-support.ts`). That reference also reproduces the published example.
Evidence: `packages/framework/src/files/cloudflare/{sign,tickets}.unit.test.ts`. Not yet verified live (D1 stop, DEC-0317); D-RUN verifies it.
Item: D-02.

### DEC-0328 — Names with `.` / `..` segments on R2 URLs
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: FILES-REQ-002, FILES-REQ-003, files.md §2 "Cloudflare"

WHATWG URL parsing, used by aws4fetch, Workers and browsers, resolves `.` and `..` path segments, even when they are percent-encoded. With per-segment encoding, a ticket for `x/../y` would address `y`, and a ticket for `../up.txt` would address `/up.txt` outside the bucket path. That is unit-tested: the test failed before the fix. Fix (simplest): when any segment of the name is `.` or `..`, the issuer encodes the whole name, every `/` as `%2F`. Other names keep the per-segment form that A-07 verified. Assumption, not verified live: R2 decodes `%2F` in the path into `/` in the key, as S3 does, and canonicalises the path from the decoded key, as aws4fetch does. D-RUN checks it with one ticket for a `x/../y` name. A name that is exactly `.` or `..` cannot be put in any path-style or virtual-hosted URL. For such a name, `createUploadTicket`/`createDownloadTicket` on Cloudflare throw `FILES.INVALID_NAME`: "cannot be transferred by the browser on this target". Server operations on such names still work. This is a target difference in a corner case that FILES-REQ-002 allows. Owner: accept it, or forbid the names `.` and `..` in FILES-REQ-002 on every target.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-02.

### DEC-0329 — Download names on Cloudflare, and the content type the issuer needs
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEC-0313, files.md §2 "Download names", `src/files/service.ts` (B-11's), D-RUN

DEC-0313 is implemented with one helper, `downloadDisposition(name, contentType)` in `src/files/cloudflare/disposition.ts`. The local route imports it: a shared FILES module would be the natural home, but D-02 does not own one. The helper builds `attachment|inline; filename*=UTF-8''<RFC 8187 value-chars>` and percent-encodes `'`, `(`, `)`, `*` and `/` too. The Cloudflare download ticket signs it as `response-content-disposition`. aws4fetch serialises the query in form encoding, so the space after `;` is sent as `+`. Assumed (S3 behaviour): R2 decodes `+` as a space when it checks the signature. D-RUN confirms R2 honours the override and accepts the signature with one presigned GET. If it does not, DEC-0313 says Cloudflare keeps the default name and the entry is revised. Choosing `inline` for raster images needs the file's content type. `TicketIssuer.download(name)` does not pass it, so the Cloudflare issuer takes an optional second argument and defaults to `attachment`. `<img src>` ignores `Content-Disposition`, so images still display. Needed elsewhere: in `src/files/service.ts` `createDownloadTicket`, pass the `head` result's content type: `options.tickets.download(name, infoOf(head).contentType)`, and widen `TicketIssuer.download` to `(name, contentType?)`. Until then, Cloudflare names raster images `attachment`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-02.

### DEC-0330 — Storage CORS preflight for deploy's health step; CORS policy helper
Origin: ai-proposed · Status: accepted · Affects: provisioning.md step 7, DEC-0099, FILES-REQ-004, D-03

`bucketCorsPolicy(publicOrigin)` returns the DEC-0099 body: one rule, `maxAgeSeconds` 60, no `exposeHeaders`. It refuses with `CORE.MISCONFIGURED` any value that is not exactly one origin (a path, a trailing slash, a wildcard, no scheme). `bucketCorsPath(accountId, bucket)` is `/accounts/<a>/r2/buckets/<b>/cors`. D-03 sends them through its `CloudflareApi`. `checkStorageCors({ accountId, bucket, publicOrigin, fetch? })` sends one `OPTIONS` to `https://<account>.r2.cloudflarestorage.com/<bucket>/__framework-cors-check`, with `Origin`, `Access-Control-Request-Method: PUT` and `Access-Control-Request-Headers: content-type`, and no credentials. It returns `{ ok: true }` only for a 2xx whose `Access-Control-Allow-Origin` equals the origin exactly (a `*` fails). Otherwise it returns `{ ok: false, status, message }` in the shape of PROV's `HealthOutcome`, naming the status and the ACAO value. It never reads storage's body and never throws (an unreachable host becomes `ok: false`). The tests replay A-07's recorded answers, N13 (204 with ACAO) and N14 (403 without). From Node it needs `NODE_USE_ENV_PROXY=1` behind the sandbox proxy (plan §10.6).
Item: D-02.

### DEC-0331 — Cloudflare stage resources have fixed names
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV §2 "Stage resources", CF-REQ-002, PROV-AC-003, PROV-AC-006, DEC-0263, `provision/cloudflare/names.ts`

On Cloudflare the stage's Worker script is `<app>-<stage>`, its R2 bucket `<app>-<stage>-files`, and its R2 signing token `<app>-<stage>-files-signing`. These are not generated names. PROV §2 says physical names are "whatever the provisioning tool generates (with a unique suffix where the namespace is global)". Workers scripts, R2 buckets and account API tokens are named per account, not globally, and app names have no hyphens (PAR-290), so the fixed names are unique. With PAR-290 and PAR-291 every name fits the 63-character limits. Reason: every operation (stop, start, secrets, removal, the leftover check) finds the stage's resources from the stage name alone, with no SST outputs or local state. That includes a deploy from a clean machine (PROV-AC-006). They are still referenced only by exact name, never by a wildcard. `remove` and the leftover check match SST state objects as `<kind>/<app>/<stage>` exactly, or below it, so `test-a` never matches `test-ab`.
**Change needed elsewhere:** provisioning.md §2 "Stage resources" should say that on Cloudflare the names are fixed as above. cloudflare.md "Deploy mechanics" should name them. Neither doc is owned by D-03.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-03.

### DEC-0332 — The real `CloudflareApi` sends `CLOUDFLARE_API_TOKEN` as a bearer token
Origin: ai-proposed · Status: accepted · Affects: DEC-0083, DEC-0107, DEC-0271, plan §10.6, D-05, `provision/cloudflare/api.ts`

`createCloudflareApi({ token })` sends `Authorization: Bearer <CLOUDFLARE_API_TOKEN>` to `https://api.cloudflare.com/client/v4<path>`, as wrangler and SST do. On an owner machine that is the real token. In the sandbox it is the non-secret placeholder, which the proxy replaces (DEC-0083). Plan §10.6's "never send an Authorization header yourself" means agents in the sandbox, who must not send real credentials. The framework only passes on whatever the variable holds. Messages never contain the token or a request body. A non-JSON answer (e.g. the proxy's 502 `text/plain`) is returned as text and quoted in errors, up to 200 characters. Node's `fetch` uses `HTTPS_PROXY` only when the process starts with `NODE_USE_ENV_PROXY=1` (DEC-0085). The variable cannot be set from inside the process, so the CLI process must already have it (D-05).
Item: D-03.

### DEC-0333 — The `workers.dev` subdomain is a shared account resource, read from Cloudflare on every deploy
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-REQ-004, PROV §2 "State home" ("account settings live with the shared resources"), cloudflare.md §2, DEC-0086, `provision/cloudflare/account.ts`

`inspectAccount` reports three shared resources: `R2 bucket prototype-logs`, `R2 bucket sst-state` (SST's state home, DEC-0084; same 404/403/409 readings as the log bucket, DEC-0270), and `workers.dev subdomain`. The subdomain is `owned` when `GET /accounts/{id}/workers/subdomain` returns a non-empty `result.subdomain`. It is `absent` on HTTP 404 or an empty value. It is never `foreign`, because it is a setting of the account itself, and any other answer is an error. Cloudflare holds the subdomain, so "recording" it means it is read again on every deploy (`accountSubdomain`) and never stored on the owner's machine. When it is absent, `setup-account` registers `pf-<first 12 characters of the account ID>` with `PUT /accounts/{id}/workers/subdomain {"subdomain": …}`. If that fails, the error names the subdomain and asks the owner to register one in the dashboard and run `setup-account` again. The name is deterministic, so a repeat run tries the same name. It is the simplest name that contains nothing personal. On this account the subdomain already exists (DEC-0086), so registration runs only in unit tests.
**Change needed elsewhere:** cloudflare.md §2 could say which name is registered (D-01 owns that doc in this wave).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-03.

### DEC-0334 — Readings not yet verified against the live API: D-RUN verifies them first
Origin: ai-proposed · Status: accepted (unverified; verify in D-RUN under the plan §1 caps) · Affects: DEC-0270, DEC-0263, PROV-REQ-004, PROV-AC-003, PROV-AC-004, D-RUN

D-03 made no Cloudflare calls. Before `setup-account` and deploy rely on the readings below, D-RUN confirms each one once, with a few `curl` requests through the proxy (no Authorization header) and no D1 involvement. Each mismatch is a root-cause item (prompt §8) for a D-03 follow-up. Until a reading is confirmed, a failure it causes is reported as a failure or a leftover, never as success (DEC-0263). Estimated cost: under 30 API requests.

1. **DEC-0270, log bucket and state home ownership.** `GET /accounts/$ID/r2/buckets/prototype-logs`: expect 200 `success: true` once it exists. `GET /accounts/$ID/r2/buckets/<never-created name>`: expect **404**; the fake uses code 10006, "The specified bucket does not exist.". `POST /accounts/$ID/r2/buckets {"name":"prototype-logs"}` while it exists: expect **409**; the fake uses code 10004. **403 foreign cannot be produced with one account.** R2 bucket names are scoped to an account, so another account's bucket of the same name is invisible rather than refused. In practice "foreign" means "this credential cannot see it". DEC-0270's 403 reading stays unverified unless a second account is available. Owner item: confirm the 403 reading can stay an assumption.
2. **workers.dev subdomain.** `GET /accounts/$ID/workers/subdomain` → 200 with `result.subdomain` (seen in A-02 `c01`). The answer for an account without one (assumed: 404, code 10007) and `PUT …/workers/subdomain` cannot be tried on this account without changing its subdomain. Leave them unverified and do not try them.
3. **R2 object listing paging.** `GET …/r2/buckets/<b>/objects?per_page=1000`: check that `result_info` has `cursor` and `is_truncated` (the cursor names are assumed; A-01 used only one page).
4. **Token listing paging.** `GET /accounts/$ID/tokens?per_page=50&page=1`: check that `result_info.total_pages` exists.
5. **Worker endpoints.** `GET …/workers/scripts/<missing>/secrets` and `…/settings`: expect 404 (code 10007). `DELETE …/workers/scripts/<name>?force=true` on a stage Worker: expect 200.
6. **The generated SST program** (DEC-0336), on D-RUN's first deploy. Check that `sst install` and `sst deploy --target Files` create only the bucket `<app>-<stage>-files`. Check that the full `sst deploy` creates the Worker `<app>-<stage>` (transform `scriptName`) with: the bindings `DB` (D1 id), `FILES`, the log bucket binding, the plain-text variables, `FRAMEWORK_PUBLIC_ORIGIN`, the static assets, and route `enabled: true, previews_enabled: false`. Check that a later step-3 `--target Files` run leaves the Worker and its secrets in place, and that SST accepts an `sst-state` bucket that `setup-account` created. **D1 note:** a deploy creates one D1 database through D-04, so this check waits for the D1 stop (DEC-0317) to end. Until then the deploy-dependent criteria stay `blocked`.
7. **R2 token creation permission** (DEC-0335): see there.
Per-run cost of D-03's parts (for D-RUN's estimate). Cloudflare API requests sent by the framework, counted on the in-memory fake; SST/Pulumi's own requests come on top and were not measured (estimated 30–60 per SST run):
- `setup-account` with everything present: 3 (creating: up to 6);
- first deploy of a stage: about 23, plus 2 SST runs (step 3 and step 5) and 1 `sst install`;
- redeploy: about 16, plus 2 SST runs;
- `secrets set`: 1;
- remove: about 20, plus 1 SST run;
- step 7 retries: up to about 30 `workers.dev` requests, only when the stage is unhealthy.
D-03's own code writes and reads no D1 rows and creates no D1 databases; databases are created and copied by the core through D-04 (DEC-0348 has its estimate).
Item: D-03.

### DEC-0335 — Preflight checks the token permission by reads only
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-REQ-002 step 1, PROV-AC-002, `provision/cloudflare/r2-token.ts`, D-T1

Cloudflare has no request that answers "may this credential create a token?" without creating one, and step 1 must create nothing. The preflight therefore reads `GET /accounts/$ID/tokens/permission_groups` and `GET /accounts/$ID/tokens?per_page=50&page=1`, the two reads that token creation itself needs. If either is refused, it reports "the Cloudflare API token lacks the permission to create R2 API tokens (Account API Tokens: Edit): HTTP …". Before that, it checks the credential variables by name (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the token with `GET /accounts/$ID/tokens/verify`. A token that can read tokens but not edit them passes the preflight, and step 5's token creation then fails, naming the token. That is accepted as the simplest available check.
**Open question (owner / D-T1):** in the sandbox the proxy replaces every `Authorization` header to `api.cloudflare.com` with the injected token, so a deploy cannot use a restricted credential. If so, PROV-AC-002's "credential that lacks the permission to create R2 API tokens" clause cannot be run live from this sandbox, and its unit test (`r2-token.unit.test.ts`, `target.unit.test.ts`) is the only evidence.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-03.

### DEC-0336 — The SST app generated for a Cloudflare stage
Origin: ai-proposed · Status: accepted (unverified live; DEC-0334 item 6) · Affects: PROV-REQ-001, PROV-REQ-002 steps 3 and 5, cloudflare.md §2, DEC-0036, DEC-0084, DEC-0087, DEC-0088, DEC-0091, DEC-0107, `provision/cloudflare/sst.ts`

- **Where:** `<app>/.framework/provision/cloudflare/sst.config.ts` plus a minimal `package.json`, rewritten on every deploy and remove. It is outside `.framework/<target>/`, which `build` replaces. SST's platform (`.sst/platform`) is installed with `sst install` when it is missing.
- **Program:** `removal: "remove"` (never retains), `home: "cloudflare"`, provider `cloudflare` 6.15.0 (PAR-108). `sst.cloudflare.Bucket("Files")` with a transform giving the fixed bucket name. When there is a database: `sst.cloudflare.Worker("Worker", { handler: <built bundle>, url: true, assets: { directory }, environment: <framework variables + FRAMEWORK_PUBLIC_ORIGIN> })`. Its transform sets `scriptName`, compatibility date and flags, and `keepBindings: ["secret_text", "secret_key"]` (DEC-0087's guard), and appends the bindings `DB` (the current D1 database, an input never in SST's state), `FILES` and the shared log bucket. Every input is embedded as JSON, never as code. A `SECRET_*` variable or binding name is refused (DEC-0087).
- **Steps:** step 3 runs `sst deploy --stage <s> --target Files`, which deploys the long-lived bucket only, then sets the bucket's CORS policy. Step 5 runs a full `sst deploy`. Removal runs `sst remove` on a bucket-only program.
- **Environment:** DEC-0107's SST environment (`CLOUDFLARE_API_TOKEN` as given, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, `NODE_USE_ENV_PROXY=1`), plus `SST_TELEMETRY_DISABLED=1` (offline runs showed SST posting telemetry) and `CI=1`. The binary is the pinned `sst` package's platform binary. A failing SST run fails the step, quoting its last 25 output lines.
- **Fallback** if SST's Worker component cannot take the prebuilt bundle or the assets settings: raw Pulumi `cloudflare.WorkersScript` and `WorkersScriptSubdomain` in the same program (cloudflare.md permits raw Pulumi where SST lacks a feature).
- **Static-asset settings:** D-01 owns the static-asset settings (run Worker first for `/api`, `/api/*`; SPA fallback). They are not in the program yet, because SST's `assets` option was not seen offline. D-RUN/D-01 add them through the Worker transform (`args.assets.config`) once the shape is confirmed. Recorded as an open item.
The static-asset open item is closed by DEC-0356 (SST's Worker `assets` option; `@internal` in SST 4.17.2, to be confirmed live).
Item: D-03.

### DEC-0337 — Seam to D-04's D1 operations: `CloudflareDatabases`
Origin: ai-proposed · Status: accepted · Affects: D-04, D-05, `provision/cloudflare/databases.ts`

The Cloudflare target takes D-04's database operations as one object, `databases`. Its type, `CloudflareDatabases` in `provision/cloudflare/databases.ts`, is D-04's `D1DatabaseOperations` (branch `claude/implement-local-cloudflare-d-04`, `d1/operations.ts`), declared structurally so that D-03 does not depend on `d1/**` before the merge: `Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase">` plus `listDatabases()`, every D1 database of the account by name and UUID. `StageDatabase.id` is the D1 UUID. The target forwards its five database methods unchanged. `listStageResources` takes its databases from `listDatabases()`, and the core keeps only exact pattern matches. D-04's module imports `CloudflareApi` from `../account.js`, which still re-exports it. D-05 wires it: `createCloudflareTarget({ …, databases: d1DatabaseOperations({ api, accountId }) })`. Until that is wired, `unwiredDatabases()` fails every call with "the Cloudflare D1 database operations are not wired into this CLI (D-04)".
Item: D-03.

### DEC-0338 — Seam to D-02's FILES provisioning parts
Origin: ai-proposed · Status: accepted · Affects: D-02, D-05, DEC-0099, PROV-REQ-002 steps 3 and 7

`createCloudflareTarget({ files })` takes `bucketCors(origin)`, the body of `PUT /accounts/$ID/r2/buckets/<bucket>/cors` (DEC-0099's one rule for the stage's public origin). It also takes `storagePreflight({ accountId, bucket, origin })`, deploy step 7's CORS preflight. Both are D-02's (plan: "the bucket CORS policy definition … health-step CORS preflight helper"). D-05 adapts D-02's exports to this shape. Step 3 sets the CORS policy right after the bucket deploy. The public origin is known before the Worker exists, because it is built from the fixed Worker name and the account subdomain.
Item: D-03.

### DEC-0339 — Framework-internal secrets are created by `deployCode`
Origin: ai-proposed · Status: accepted · Affects: SEC §2 "Framework-internal secrets", DEC-0100, AUTH (session key, PAR-253), FILES, `provision/cloudflare/target.ts`

Worker secrets need the Worker, so these are set right after step 5's SST deploy and before the core's first-deploy secret check and step 6:
- `frameworkSessionKey`: 32 random bytes in base64url (PAR-253), generated only when it is absent. A redeploy keeps the existing one, so sessions survive.
- `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey`: the stage's R2 signing token (DEC-0100), one per stage. It is created only when either secret is absent. A token that exists without its secrets (e.g. after an interrupted deploy) is deleted and replaced, because Cloudflare shows a token's value only once.
Values are written only to the Worker's secrets and never printed. This assumes D-01's Cloudflare runtime requires exactly these three framework secrets (`requiredFrameworkSecrets`) for the health check.
Item: D-03.

### DEC-0340 — Health check on Cloudflare retries for up to 30 s
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002 step 7, DEC-0089, DEC-0090, DEC-0092, PROV-AC-002

Step 7 sends `GET <public origin>/api/__framework/health` with `User-Agent: prototype-framework/0.1.0` (DEC-0089). After a 204 it runs FILES' storage preflight. Any failure is retried once a second, for at most 30 s (DEC-0090's bound), because a just-started route answers 404 `error code: 1042` for up to ~2 s and a new secret takes a few seconds to reach requests (DEC-0092). The last failure is then reported, with status, error code and requestId when the stage sent an `ErrorResponse`. A genuinely failing stage (PROV-AC-002's unset secret) therefore fails after about 30 s, at most about 30 requests to `workers.dev` (none to the Cloudflare API). No parameter added: the simplest choice. If cloud runs need a different bound, it becomes a PAR.
Item: D-03.

### DEC-0341 — Cloudflare removal order, fallbacks and the leftover listing
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-003, PROV §2 "Removal", cloudflare.md `remove`, `listStageResources`, DEC-0084, DEC-0263, PROV-AC-003, COMPL-AC-004

`removeStage` attempts every step and throws all failures together:
1. empty the stage bucket (R2 object listing and deletion through `api.cloudflare.com`);
2. delete the signing token, found by its exact name;
3. `sst remove`;
4. if the Worker or the bucket still exists (SST failed, or its state was lost), delete it by exact name: `DELETE …/workers/scripts/<name>?force=true`, `DELETE …/r2/buckets/<name>`;
5. delete the stage's SST state objects in `sst-state`, which `sst remove` leaves behind (DEC-0084).
The core deletes the databases before these steps.

An error answer to a delete is not proof that the delete failed: A-03 `c19` saw a 502 on a delete that happened. So after the deletes, the keys are listed again, and only keys still present count as failures.

`listStageResources` reports the Worker, the bucket, the token (by token id) and each SST state object (kind `SST state object`, by key), plus every D1 database through D-04. The leftover check after `remove` therefore covers PROV-AC-003's "no resource … of the removed stage". The shared buckets and other stages are never touched. Log entries stay in the shared log bucket by design.
Item: D-03.

### DEC-0342 — Interface of the Cloudflare database operations (for D-03)
Origin: ai-proposed · Status: accepted · Affects: PROV §2 per-target operations, D-03, `provision/cloudflare/d1/operations.ts`

`packages/framework/src/provision/cloudflare/d1/operations.ts`:

```ts
export interface D1Options {
  readonly api: CloudflareApi;            // from ../account.ts; D-03's real client (auth/proxy per DEC-0107)
  readonly accountId: string;
  readonly limits?: Partial<CopyLimits>;  // tests only; defaults PAR-216 / PAR-218
}
export type D1DatabaseOperations =
  Pick<TargetOperations, "createDatabase" | "copyDatabase" | "dropDatabase" | "migrationDatabase" | "checkMigratedDatabase">
  & { listDatabases(): Promise<ListedDatabase[]> };   // every D1 database of the account, all pages
export function d1DatabaseOperations(options: D1Options): D1DatabaseOperations;
```

D-03 builds its `TargetOperations` as `{ ...d1DatabaseOperations({ api, accountId }), target: "cloudflare", dialect: "sqlite", … }`
and fills `StageResources.databases` from `listDatabases()`. `StageDatabase.id` is the D1 UUID (the Worker binding's
`database_id`). Contract with `CloudflareApi`: it resolves `{ status, body }` with `body` the parsed JSON object, or
something that is not a JSON object (a string, `undefined`) for a non-JSON answer; it throws when no answer arrives
(timeout, reset). The module never sees a credential, and its messages contain none.
Item: D-04.

### DEC-0343 — A migration file is sent in the `batch` form, its record row with bound values
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 "Cloudflare", DEC-0093, MIG-REQ-003

DEC-0093 allows both request forms. The CLI uses `{"batch": [{"sql": "PRAGMA defer_foreign_keys = on"}, <each statement
of the file, split at drizzle-kit's breakpoints exactly as the local applier does>, {"sql": "INSERT INTO
\"__framework_migrations\" (…) VALUES (?, ?, ?, CAST(? AS INTEGER))", "params": [id, "sqlite", checksum, "<applied_at>"]}]}`.
Reason: the record values are bound, not quoted into SQL, and the request has the same shape as the local D1 batch
(DEC-0144); `applied_at` is cast because D1 binds JSON numbers as REAL (A-06 E5d). Evidence:
`provision/cloudflare/d1/migration-database.unit.test.ts`.
Item: D-04.

### DEC-0344 — The fallback copy as implemented: few requests for small databases
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 "Cloudflare", DEC-0096, PAR-216, PAR-218, MIG-REQ-006

The A-06 prototype (`fallback_copy.py`) is ported with these changes, all to keep a low-volume app's copy cheap:
- metadata is read in three requests for the whole database (`sqlite_master`; every `PRAGMA table_info` and
  `PRAGMA foreign_key_list` in one batch; every table's `count(*)` and value bytes in one batch);
- a table, or a reference cycle, that fits one page is read whole, and several such reads share one request up to a
  page's rows/bytes; only larger tables use the per-page size probe and rowid range, and only larger cycles the
  row-level ordering (iterative Tarjan, so a long chain cannot overflow the stack);
- table DDL rides in the first write page, indexes/triggers/views and `sqlite_sequence` in the last, so a database
  that fits one page is copied with 1 create + 3 metadata reads + 1 value read + 1 write;
- reads use `/query` with aliased columns (`t<k>`, `v<k>`) instead of `/raw`;
- a table with more than 99 columns (100 with the rowid) is refused with a clear message instead of a statement
  over PAR-216 (portable apps never get near it);
- on any failure `copyDatabase` deletes the new database itself before throwing (the core's cleanup by name stays as
  a second line).
Evidence: `provision/cloudflare/d1/copy.unit.test.ts` (identical fingerprint incl. child-before-parent tables,
self-reference and mutual cycles, int64/real/blob/NUL/unicode/'' vs NULL, rowids, unique index, sequence; page
bounds with small limits; a cycle larger than a page; request count; failure cleanup; wide table).
Item: D-04.

### DEC-0345 — Unclear answers to create and delete
Origin: ai-proposed · Status: accepted · Affects: DEC-0094, PROV §2

Following DEC-0094: an unclear answer (5xx, non-JSON, no answer) to `POST …/d1/database` is resolved by listing that
exact name (`GET …/d1/database?name=…`, filtered to exact matches); one match is the created database, none
re-throws the original error. The limit refusal (403, code 7406) becomes the message "the Cloudflare account already
has the maximum number of D1 databases (PAR-219: 10; code 7406) … remove unused stages … or other D1 databases, then
run deploy again". `DELETE` answered with 404 counts as deleted, so a repeated cleanup never fails.
Item: D-04.

### DEC-0346 — The step-4 check: what "explicitly dropped" and "column rule" mean on a database
Origin: ai-proposed · Status: accepted · Affects: migrations.md §2 step 4 and "Cloudflare", MIG-REQ-003, `mig/cloud/check.ts`

The comparison is target-neutral (`packages/framework/src/mig/cloud/check.ts`, `CheckReader` per database; the D1
reader is `provision/cloudflare/d1/check-reader.ts`). A table may be absent from the new database only if an applied
migration contains `DROP TABLE` for it (parsed from the file text), so a table lost by the copy is caught.
`__framework_migrations` must have exactly one more row per applied migration; every other kept table the same count.
References: `PRAGMA foreign_key_check` is empty. Column rules of added columns come from the declared type and NOT
NULL, the only type facts a database holds: INTEGER holds integers, REAL reals, TEXT text without NUL, NOT NULL no
NULL. The narrower SQL §2.1 rules (32-bit integer, boolean 0/1, timestamp range) cannot be told apart in SQLite; an
added column only holds NULL or its static default, which the generator already checked. Record: every migration of
both histories listed. Evidence: `mig/cloud/check.unit.test.ts`, `provision/cloudflare/d1/check.unit.test.ts`.
Item: D-04.

### DEC-0347 — Tests run against a fake D1 HTTP API on local D1
Origin: ai-proposed · Status: accepted · Affects: D-04 tests, D-03 (may reuse it), plan §1 "Cloud usage limits"

`fake-d1-api.ts` serves create/list/delete/query with the A-05/A-06 shapes (200 `success: true` with `result[]`;
400 code 7500 `result: []`; 403 code 7406 over `maxDatabases`; 404 unknown UUID) on local D1 bindings from
`getPlatformProxy` (fixture `d1/fixtures/wrangler.jsonc`). Local D1 matches remote on what the copy relies on: batch
atomicity, `PRAGMA defer_foreign_keys`, refused `BEGIN`/`SAVEPOINT`, 100 parameters per statement, JSON numbers bound
as REAL (checked in this item). It differs on booleans (remote TEXT, local REAL), so the fake refuses boolean
parameters. `intercept` simulates A-05's 502 after a committed batch and lost answers. The deploy sequence of C-03
runs on it with C-03's FakeTarget for everything except databases (`d1/deploy-d1.unit.test.ts`).
Item: D-04.

### DEC-0348 — What D-RUN must confirm on live D1 (unverified here because of DEC-0317)
Origin: ai-proposed · Status: accepted (open until D-RUN) · Affects: D-RUN, D-RUN-M, MIG-AC-002/-003/-006

Not observed on remote D1 by A-05/A-06 and therefore assumptions until D-RUN's MIG pass:
1. `PRAGMA table_info`, `PRAGMA foreign_key_list` and `PRAGMA foreign_key_check` inside a multi-statement `/query`
   `batch`, and several `SELECT`s in one `batch` returning one `result[i].results` each (A-06 read one statement per
   `/raw` request).
2. `GET …/d1/database?name=<n>&page=&per_page=100` filters by name and pages as assumed (the fake treats `name` as a
   substring and the code filters exact matches).
3. `DELETE` of an unknown UUID answers 404.
4. `sqlite_master` on remote lists only `_cf_*` internal tables besides the app's (excluded by an escaped LIKE).
5. The A-06 binding rules still hold (`CAST(? AS INTEGER)` from text, `unhex(?)`).
If one fails, the fix is local to `provision/cloudflare/d1/` (e.g. one statement per request), at the cost of more
requests.

Estimate per deploy (for the D-RUN estimate; stage database with R rows in T tables, I index entries per row on
average, a few migration files; D-03's own Worker/R2/SST requests not included):
| Deploy | D1 API requests | Rows read | Rows written | Databases held |
| --- | --- | --- | --- | --- |
| First deploy (creates `db-1`, applies k files) | 1 list + 1 create + 2 record reads + k + 2 re-reads only on error ≈ 6 | < 50 | k record rows + schema writes ≈ 10–30 | 1 |
| Redeploy, nothing pending | 1 list + 2 record reads = 3 | ≈ 20–30 (sqlite_master, record) | 0 | 1 |
| Schema change (R ≤ 1,000 rows and ≤ 1 MB) | 1 list + 2 + 1 create + 5 copy + (2 + k) migrate + 8 check + 1 drop ≈ 20–22 | ≈ 5 R + 100 (copy: 2 R; check: 2 R counts, R FK check, R per table with an added column) | ≈ R × (1 + I) + migration effects (a new index writes R_t entries) + k | 2 until the old one is deleted |
| Failed schema change | as above up to the failure, + 1 drop of the new database | ≤ the above | the copy's writes, then deleted | 2, back to 1 |
For C-T2's MIG fixtures (tens of rows, R ≈ 30): about 20 requests, ~250 rows read and ~100 rows written per
schema-changing deploy; about 3 requests, ~30 rows read and nothing written per no-change redeploy.
Item: D-04.

### DEC-0349 — Cloud commands check the process for `NODE_USE_ENV_PROXY=1` first
Origin: ai-proposed · Status: accepted · Affects: DEC-0085, DEC-0107, DEC-0332, CLI-REQ-003, `src/cli/commands/smoke-cloud.ts`

Node's `fetch` uses `HTTPS_PROXY` only when the process started with `NODE_USE_ENV_PROXY=1`, and a running process cannot turn that on for itself. So `deploy`, `remove`, `setup-account`, `secrets set` and `certify-auth` on a cloud target, and `smoke --target <cloud>`, first check the environment. When `HTTPS_PROXY` (or `https_proxy`) is set and `NODE_USE_ENV_PROXY` is not `1`, they exit 1 and name the variable, before any request is sent. With no proxy (an owner machine), nothing is required. Re-executing the CLI with the variable set was rejected: it hides what happened, and it is more code. The cloud commands also refuse target `local` and an invalid stage name (PAR-291) with exit 2. `remove`, `setup-account` and `secrets set` additionally refuse missing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` by name. `deploy` leaves that to its step-1 preflight, which reports every missing prerequisite (PROV-AC-002).
Item: D-05.

### DEC-0350 — `remove` removes only test stages unless the production stage is confirmed by name
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-REQ-003, PROV-REQ-005, CLI-REQ-001, DEC-0263, cli.md §2

PROV-REQ-003 lets `remove` remove "the named stage", whichever it is. A production stage holds the owner's data, and `remove` deletes its databases with no recovery. A copied test command with one wrong word must not do that. So `remove --target <t> --stage <s>` removes a `test-…` stage as named, and refuses any other stage (exit 2, nothing loaded or contacted) unless `--confirm-production <s>` repeats the stage's name exactly. `--confirm-production` on a test stage is refused too. The compliance runner and every test only remove `test-` stages, so they never pass the option. After a removal with no leftovers, `remove` deletes the stage's recorded deploy output `.framework/<target>/stages/<stage>.json`. After a removal with leftovers it keeps the file, because the stage may still answer. Owner: accept the confirmation option, or say that `remove` should refuse production stages entirely.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-05.

### DEC-0351 — `deploy`: build, client assets, record, callback URL; never `setup-account`
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002, PROV-REQ-004, GOOGLE-REQ-004, CF-REQ-001, DEC-0272, DEC-0325, DEC-0336, cli.md §2

`deploy` runs `buildApp` for the stage. It then builds the client's static assets with Vite's `build` (framework options only: `configFile: false`, root the app, output `.framework/<target>/client/`; an app without `index.html` deploys without assets). It reads the migration histories (the package's framework history and `<app>/migrations/sqlite`), the declared secrets and `framework.google.clientId` from the build's resolved configuration. Then it runs C-03's `runDeploy` on the Cloudflare `TargetOperations` (D-03's `createCloudflareTarget`, with D-04's `d1DatabaseOperations` and D-02's `bucketCorsPolicy` / `checkStorageCors`). On success it calls `recordDeployOutput` (DEC-0272). For a non-`test-` stage it also prints `Google callback URL to register: <origin>/api/auth/callback`. A build failure is reported as "failed before step 1", having created nothing. `deploy` never creates shared resources: absent ones stop it with "run setup-account … first" (the core's behaviour, unit-tested at command level). `setup-account` is only ever run by an explicit `setup-account` command: no command, script, driver or test helper of the framework calls it. The `WorkerCode` uses `COMPATIBILITY_DATE` and `BINDINGS.logs` directly. These are the same constants `cloudflareWorkerSettings` uses. The settings object itself is not built, because its inputs (database, public origin) are known only inside the target. D-03's open item stands: the static-asset settings (run the Worker first for `/api`, `/api/*`; SPA fallback) are not yet in the SST program (DEC-0336). D-RUN confirms the assets shape on the first deploy.
Item: D-05.

### DEC-0352 — The runner-only abort point is the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT`
Origin: ai-proposed · Status: accepted · Affects: DEC-0269, COMPL-AC-008, compliance.md §2 "Deploy recovery", `tests/compliance/criteria/prov/deploy-recovery.test.ts`

DEC-0269 leaves the CLI form of `abortAt` to D-05, and says the CLI sets it "only for the compliance runner". An environment variable keeps it out of the owner's options and usage text. The name and values are the ones D-T1's COMPL-AC-008 test already assumes (`PROTOTYPE_FRAMEWORK_ABORT_AT=after-copy|after-code`). Any other non-empty value is a usage error that names the accepted values, raised before anything is built.
Item: D-05.

### DEC-0353 — The Cloudflare runtime signs R2 tickets for the bucket named by two Worker variables
Origin: ai-proposed · Status: accepted · Affects: DEC-0324, DEC-0327, FILES-REQ-003, FILES-REQ-004, cloudflare.md §2, `src/targets/cloudflare/{bindings,public,tickets}.ts`

D-02's `createWorkerTicketIssuer` needs the account ID and the stage bucket's name. D-01's runtime still used a stub that refused every ticket, and no variable carried either value (DEC-0327 left the names open). `deploy` now passes two plain-text Worker variables through `WorkerCode.variables`: `FRAMEWORK_R2_ACCOUNT_ID` (the account ID, not a secret) and `FRAMEWORK_FILES_BUCKET` (`<app>-<stage>-files`). The runtime's `workerTicketIssuer` reads them when a ticket is created. So a Worker without them still serves every other request, and only creating a ticket fails, with `CORE.MISCONFIGURED`. Neither name has the `SECRET_` prefix (DEC-0087). This amends DEC-0324's "the only Worker variable is `FRAMEWORK_PUBLIC_ORIGIN`". These files are outside D-05's Owns line (D-01's). The edit was needed so that FILES works on a deployed stage at all. Evidence: `src/targets/cloudflare/tickets.unit.test.ts` (a Cloudflare-runtime upload ticket addresses `https://<account>.r2.cloudflarestorage.com/<bucket>/<name>` and is signed). It was red against the stub first.
Item: D-05.

### DEC-0354 — `secrets set --target cloudflare`, `setup-account --target local`, `certify-auth`
Origin: ai-proposed · Status: accepted · Affects: SEC-REQ-003, SEC-REQ-004, PROV-REQ-004, GOOGLE-REQ-005, cli.md §2

- `secrets set <name> --target cloudflare --stage <s>` keeps B-17's argument, name and standard-input rules (`secrets.ts` gained an optional `cloud` dependency). It checks the stage name and the process before reading standard input, then calls the target's `setSecret`. It prints `set secret <name> for target cloudflare as SECRET_<NAME> (a Worker secret of stage <s>)`, never the value. A stage whose Worker does not exist yet fails with D-03's message ("run deploy first").
- `setup-account --target local` prints that the local target has no shared resources, and exits 0. It accepts `--target` only.
- `certify-auth` is wired to B-13's `certifyAuth`. It runs on a production stage of a cloud target only: test stages are refused before any request. The origin comes from the recorded deploy output, the client ID from the stage's values file, and the owner's answers line by line from standard input. It needs a working tree that matches HEAD, and writes one evidence record with the `workers.dev` subdomain redacted. In this phase it is exercised offline only (stubbed `fetch`; Google mocked, prompt §4). No production stage is created.
Item: D-05.

### DEC-0355 — The MIG and milestone passes need no new driver form
Origin: ai-proposed · Status: accepted · Affects: DEC-0318, plan §5 D-RUN, `tests/compliance/harness/driver.ts`

The driver already runs a cloud pass without deploying a run stage when it is given `--base-url` (and no `--stage`): it neither deploys nor removes anything, and the MIG/E2E tests deploy their own stages. So D-05 adds no `--no-stage` form. Change needed elsewhere (harness owner, D-T2 follow-up): `tests/compliance/harness/node-deps.ts` `targetOperations()` still rejects with "not built yet (D-03)". The driver's leftover check therefore records "leftover check failed" for every stage. It can now use `cloudflareOperations({ env: process.env, requireCredentials: true })` from `packages/framework/src/cli/commands/deploy.ts`.
The leftover-check note above was done by D-06 (DEC-0357). Edits outside D-05's Owns line: `src/cli/main.ts` (registration, lazy bindings) and `main.unit.test.ts` (the "not available yet" test replaced); `src/cli/wiring.ts` and `src/cli/commands/secrets.ts` (optional cloud store); `src/targets/cloudflare/{bindings.ts,public.ts}` plus the new `tickets.ts` and its test (DEC-0353); `docs/components/cli.md` §2 and `docs/components/cloudflare.md` §2 (docs kept in sync).
Item: D-05.

### DEC-0356 — Static assets of the generated SST Worker come from D-01's settings
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; unverified live, DEC-0334 item 6) · Affects: CF-REQ-001, CF-AC-001, cloudflare.md §2, DEC-0325, DEC-0336 (closes its "Static-asset settings" open item), `provision/cloudflare/sst.ts`

When the built code has an assets directory, `sstProgram` builds `cloudflareWorkerSettings` (D-01) from the stage's inputs (Worker name, bundle, assets directory, public origin, database, files bucket) and passes its `assets` to `sst.cloudflare.Worker` as `assets: { directory, notFoundHandling: "single-page-application", runWorkerFirst: ["/api", "/api/*"] }`. Without an assets directory (an app with no `index.html`, DEC-0351) there is no `assets` and the Worker answers every path, as before. Building the settings also applies D-01's checks (an `https` public origin without a path; no `SECRET_*` names).

Evidence for the shape (no Cloudflare call): the platform source embedded in the pinned SST binary (`sst-linux-x64` 4.17.2) declares `WorkerArgs.assets?: { directory; htmlHandling?; notFoundHandling?: "404-page" | "single-page-application" | "none"; runWorkerFirst?: boolean | string[] }` and maps it onto the Pulumi `WorkersScript` as `assets: { directory, config: { headers, redirects, htmlHandling, notFoundHandling, runWorkerFirst } }`, adding an `assets` binding named `ASSETS`. So no transform (`args.assets.config`) is needed. The option is marked `@internal` in SST's docs; if a later SST drops it, the fallback is DEC-0336's (set `assets` in the Worker transform, or raw Pulumi). D-RUN's first deploy and CF-AC-001 confirm the behaviour on a test stage.
Unit test: `sst.unit.test.ts` "serves the built client as static assets with D-01's settings …" (red: the program had `{ directory }` only).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-06.

### DEC-0357 — The driver's leftover check uses the framework's own `listStageResources`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-004, COMPL-AC-004, PROV-AC-003, compliance.md "Test stages", DEC-0341, DEC-0355 (its "change needed elsewhere" note), `tests/compliance/harness/node-deps.ts`

compliance.md "Test stages" says the leftover check uses `listStageResources` (PROV §2 per-target operations), so the driver uses the framework's Cloudflare operations, built exactly as `remove` builds them (`cloudflareOperations({ env, requireCredentials: true })` from `cli/commands/deploy.ts`, app directory `apps/reference`). D-T2's `_cloud/stage-resources.ts` hook is not used here: it is the *independent* probe the CF/PROV/E2E tests use to check the framework's removal, and the driver's check is defined in terms of the framework's operation. `stageLeftovers` (unchanged) keeps the exact-pattern databases and the `<kind> <id>` resources.

The check runs inside the driver's process, and Node's `fetch` uses the proxy only when the process was started with `NODE_USE_ENV_PROXY=1` (DEC-0085). So `stageResourceOperations` rejects before any request, naming the variable (D-05's `cloudProcessProblems`), when `HTTPS_PROXY` is set without it, and names missing credential variables; the driver then records "leftover check failed" rather than "no leftovers" (DEC-0263). Consequence for D-RUN: start the driver as `NODE_USE_ENV_PROXY=1 npm run compliance -- --target cloudflare …` (with the placeholder `CLOUDFLARE_API_TOKEN`, DEC-0083). Cost: about 5 API requests per check (Worker settings, bucket, tokens list, `sst-state` object list, D1 list); no D1 rows.
Unit tests: `node-deps.unit.test.ts` "the driver's Cloudflare leftover check …" against D-03's in-memory account (`FakeCloud`) through a fake `fetch` (red: `stageResourceOperations` did not exist).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-06.

### DEC-0358 — Playwright test paths come before `--project`
Origin: ai-proposed · Status: accepted · Affects: compliance.md "Driver", DEC-0320, `tests/compliance/harness/selection.ts`

In Playwright 1.64.1 `--project` is variadic, so the cloud form `playwright test --project integration --project e2e tests/compliance/` read the path as a project and failed with `Project(s) "tests/compliance/" not found` (side finding of root cause 2026-10-20-E2E-004-coverage-and-not-run; reproduced here with `--list`). The selection now lists test paths first: `playwright test tests/compliance/ --project integration --project e2e` (verified with `--list`: 26 tests in 14 files). The driver and the E2E-004 listing both read `runnerSelection`, so both are fixed. The existing selection test asserted the malformed form; it was updated, citing that root-cause record's evidence, and a rule test checks that nothing but `--project <name>` pairs follows the first `--project`.
Item: D-06.

### DEC-0359 — Cloud test hooks: Cloudflare API without credentials, R2 reads through a short-lived read-only token
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: D-T2, DEC-0279, LOG-AC-004, SEC-AC-005, PROV-AC-002, E2E-011, E2E-012

`_cloud/index.ts` exports `cloudHooks(target)` with C-T1's `CloudHooks` interface (`core/support/stores.ts`). `_cloud/logs.ts` exports `listLogEntries`, and `_cloud/stage-resources.ts` exports `listStageResources`, both with DEC-0279's signatures.
- **Secrets.** The stage's Worker script is found by name (DEC-0360). `GET` and `DELETE /accounts/{a}/workers/scripts/{script}/secrets[/SECRET_<NAME>]` read and delete its secrets. That makes the store a test hook outside the framework.
- **Logs and state home.** One account API token per test process gets only "Workers R2 Storage Bucket Item Read" on `prototype-logs` and `sst-state` (DEC-0100's mechanism). It expires after 30 min and is deleted on `beforeExit`. Before creating one, the hook deletes its own expired or older-than-1-h tokens (`compliance-r2read-*`). Listing and reading go through R2's S3 endpoint with a SigV4 signer of its own: no undeclared dependency, and it was checked offline against aws4fetch. So polling a log key costs no Cloudflare API requests, which the 500-per-item cap needs. Bucket existence uses `GET /accounts/{a}/r2/buckets/{name}` (404 means absent).
- **Credentials.** No `Authorization` header is sent while a proxy is configured (plan §10.6). Without a proxy, `CLOUDFLARE_API_TOKEN` is sent as a bearer token and never printed. Every API request is counted per process and the count is printed on exit, so runs are countable.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-T.

### DEC-0360 — The stage-resource probe matches by name and includes the state home
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: D-T2, CF-AC-002, PROV-AC-003, COMPL-AC-004, E2E-012

Physical names are what SST generates (PROV §2), so the probe treats a resource as the stage's when its name contains both the app name and the stage name as delimited parts. This covers the Worker, the R2 bucket, the R2 API token, and the objects in `sst-state`. A run's stage carries 15 random characters, so no other stage can match.
- Databases use PROV-REQ-002's exact pattern.
- State-home objects are included because the Cloudflare `remove` must delete them (DEC-0084), and PROV-AC-003 says "no resource … of the removed stage".
- Log entries are excluded.
- Output strings are `database <name>`, `Worker <name>`, `R2 bucket <name>`, `R2 API token <id>` and `state object sst-state/<key>`.

If D-03 names the Worker, bucket or token without the stage name, the probe finds nothing and the tests that expect one resource per kind fail. A follow-up would then match on D-03's recorded identifiers.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Integrator note: D-03 gives the Worker, bucket and token fixed names that contain both the app and the stage name (DEC-0331), so the probe's name match finds them.
Item: D-T.

### DEC-0361 — D1 stop and two-database cap are enforced inside the tests
Origin: ai-proposed · Status: accepted · Affects: DEC-0317, DEC-0318, D-RUN, D-RUN-M

`requireCloudD1()` blocks by default and passes only with `COMPLIANCE_CLOUDFLARE_D1=available`. The operator sets that variable once the reset is confirmed and the caps can be met. That way no D1 use happens by accident while DEC-0317 holds.

`requireDatabaseRoom(n)` counts the account's test-stage databases with one API request. It blocks when creating `n` more would hold more than two at once. Every further stage, D-T1's own and C-T1's, takes the same cross-process `further-stage` lock.

Consequences for D-RUN and D-RUN-M:
- PROV-AC-002's D1 clauses hold two databases (the failing migration's copy), so PROV-AC-002 belongs in the no-run-stage pass together with MIG-AC-002/-003/-006. Its record then holds all of its clauses (DEC-0264: the latest record decides an ID).
- PROV-AC-003 and COMPL-AC-008 hold two databases each, so they run in a milestone pass with no run stage.
- CF-AC-002 and COMPL-AC-004 fit the main pass: the run stage plus one further stage.
D-T1's per-test estimates (unmeasured basis; D-RUN replaces them with before/after readings). First deploy ≈ 50 D1 rows written, ≈ 20 read, ≈ 60 API requests; redeploy without pending migrations 0 written, ≈ 10 read, ≈ 40 requests; schema-changing deploy ≈ 40 written, ≈ 40 read, ≈ 60 requests; remove ≈ 25 requests; the hooks' read-only R2 token 4–5 requests per test process; a stage probe ≈ 5. Per test (rows written / read / API requests): CF-AC-001 0 / 0 / 0 (≈ 12 HTTP to the stage); CF-AC-002 ≈ 55 / 30 / 105; PROV-AC-001 ≈ 40 / 25 / 90; PROV-AC-002 no-D1 clauses 0 / 0 / 16, D1 clauses ≈ 110 / 100 / 230; PROV-AC-003 ≈ 105 / 50 / 200; PROV-AC-004 0 / 0 / 45; PROV-AC-006 ≈ 52 / 35 / 135; COMPL-AC-004 ≈ 50 / 25 / 120; COMPL-AC-008 ≈ 260 / 150 / 420. Passes: main (CF-AC-001, CF-AC-002, PROV-AC-001, COMPL-AC-004) ≈ 145 / 80 / 315; no-run-stage pass with the MIG criteria (PROV-AC-002) ≈ 110 / 100 / 245; milestone (PROV-AC-003, -004, -006, COMPL-AC-008) ≈ 420 / 235 / 800, which exceeds the 500-request cap, so D-RUN-M runs COMPL-AC-008 in a pass of its own after the other three (≈ 420 and ≈ 380 requests) and stops if a measurement passes a cap. D1-free clauses: PROV-AC-002 credential removed and restricted credential, PROV-AC-004 deploy without setup and setup twice, COMPL-AC-004 naming and `prodcheck`.
Item: D-T.

### DEC-0362 — Readings of CF-AC-001, CF-AC-002, PROV-AC-001
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CF-AC-001, CF-AC-002, PROV-AC-001

- **CF-AC-001:**
  - `/` and a random deep link answer the same HTML entry page.
  - Every script, stylesheet and modulepreload the page loads is on the stage's origin and answers 200 with a type other than HTML.
  - `/api/ref/deployment` answers JSON on that origin.
  - These paths each answer 404 with a JSON content type and a schema-valid `ErrorResponse` with code `HTTP.NOT_FOUND`: `/api`, a random path, a nested path, `/api/ref/<random>`, `/api/__framework/<random>`, and a POST.
- **CF-AC-002:** the run stage and one further stage are checked in two ways.
  - The probe shows one database, Worker, bucket and token per stage, with none shared.
  - Behaviourally:
    - A KV value and a file written on B are absent on A.
    - Upload tickets carry different SigV4 access keys and buckets.
    - The secret values differ by digest.
    - Deleting B's secret through the store makes B answer `SEC.MISSING` while A's value is unchanged.
  - Both stages' entries appear in `prototype-logs` under their own prefixes. The run stage's secret value is not needed, so the test does not depend on `COMPLIANCE_SECRET_API_KEY`.
- **PROV-AC-001 (Cloudflare):**
  - Every committed file of `apps/template` is the app definition, code, generated migrations, configuration values or standard package/tool metadata. No file is IaC, and no source or dependency names SST, Pulumi, wrangler, CDK or similar tools.
  - A scratch copy of exactly those files deploys and answers `/` and health 204.
  - The deploy leaves no new file outside the directories in the template's `.gitignore`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-T.

### DEC-0363 — Readings of PROV-AC-002
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-AC-002, D-05

- **"One credential removed":** `CLOUDFLARE_API_TOKEN` is removed from the deploy's environment, on a stage never deployed before. The deploy must exit non-zero and name the variable. Afterwards the independent probe must find nothing of the stage.
- **"Lacks the permission to create R2 API tokens":** the test needs an operator-supplied restricted token (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`) and a machine without the sandbox proxy. The proxy replaces every Authorization header (DEC-0083), so this clause is `blocked` in this sandbox.
- **"Failing migration":** the fixture is loaded, then the `unique-fail` overlay is deployed. The output must name the migrate step, `0001_unique_label`, "previous version restarted" and a next action. Afterwards `schema-version` must be v1, the fixture dump unchanged, and one database left.
- **"Secret removed by a test hook after the preflight":** the deploy prints no progress before step 7 is known, so the hook deletes `apiKey` at the first output that shows a later step, or 20 s into the deploy. If the deploy still stopped at the preflight, the secret is set again and the test retries once at 45 s. The output must then name the health step and `SEC.MISSING`.
- A defective preflight could create a database despite a missing credential, so these stopped deploys also take the further-stage lock and check the database cap.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Integrator note: the restricted-credential clause is the same finding as DEC-0335's open question; the two are one owner item (plan §11 Q5). The clause is always `blocked` in this sandbox.
Item: D-T.

### DEC-0364 — PROV-AC-004 and PROV-AC-006 (Cloudflare part)
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: PROV-AC-004, PROV-AC-006, plan §11 Q2

- **PROV-AC-004 idempotence:** after one `setup-account`, the test snapshots the account. The snapshot covers:
  - existence of the shared log bucket and the state home;
  - both buckets' settings, CORS and lifecycle;
  - every state-home object (key, ETag, last-modified, size);
  - every non-log-entry object of the log bucket;
  - a digest of the workers.dev subdomain.

  The snapshot must be identical after a second run.
- **PROV-AC-004 "deploying without it":** this needs an account where `setup-account` never ran. The test never deletes shared resources, so the clause runs only with `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1` and an absent log bucket; otherwise it is `blocked`.
- **PROV-AC-006 (Cloudflare part):** each "clean machine" is a fresh scratch copy (committed files only) with a fresh, empty HOME and XDG directories. Machine 1 deploys and writes a KV value. Machine 2 redeploys the same stage: it must succeed, keep the same single database and still see the value. Machine 3 removes the stage and nothing is left. The region part stays not-run ("AWS phase not started").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-T.

### DEC-0365 — Readings of COMPL-AC-004 and COMPL-AC-008
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-AC-004, COMPL-AC-008, D-05

- **COMPL-AC-004, naming:** the expected form `test-[a-z0-9]{PAR-291 − 5}` is read from parameters.md. It is checked for:
  - the run's stage;
  - the driver's generator and `newTestStage()`, each called twice, all distinct;
  - the stages of committed Cloudflare evidence records, all distinct.
- **COMPL-AC-004, interrupted run:** a deployed further stage is put in a temporary pending list. The real driver (`runCompliance`) then runs with real CLI stage operations and its real leftover check; only the test runners and the evidence writer are stubbed. Every resource still present afterwards must be named in the captured record's leftovers.
- **COMPL-AC-004, token left behind:** the stage's R2 API token is then re-created under its exact name and policies. A second driver cleanup whose removal skips the token must list the new token's ID among the leftovers. The token is deleted afterwards.
- **COMPL-AC-004, `prodcheck`:** a recording fake for the cloud operations shows that the driver never removes or checks `prodcheck`.
- **COMPL-AC-008:** two stages, one per abort point, are deployed at v1. Each is then deployed at v2 with the abort point, which must exit non-zero. A re-run must exit 0 and leave one database, health 204 and `schema-version` v2. The abort point's CLI form is D-05's; the assumption is the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT=after-copy|after-code`. If D-05 chooses another form, one constant in `prov/deploy-recovery.test.ts` changes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-T.

### DEC-0366 — Gaps left to other items
Origin: ai-proposed · Status: accepted · Affects: D-05, D-RUN, C-02 driver, DEC-0277

- **apiKey driver extension not done.** The plan's "From phase C" block hands D-T2 a driver extension that generates the reference app's `apiKey` and sets it on the run stage. That block also passes the key as `COMPLIANCE_SECRET_API_KEY` and redacts it. The brief for this item limited edits to `{cf,prov}/`, `_cloud/` and this file, so `tests/compliance/harness/**` was not edited. Until an item does that edit, the SEC/HTTP/CORE criteria that need the value stay `blocked` on Cloudflare.
- **Driver leftover check still a stub.** `tests/compliance/harness/node-deps.ts` `targetOperations()` rejects until it is wired to D-03's Cloudflare `TargetOperations`. Until then COMPL-AC-004's token clause fails ("leftover check failed"), correctly.
- **C-T4 hook signatures already match.** `listLogEntries` and `listStageResources` match C-T4's expected signatures (`e2e/support/cloud.ts`), so no C-T4 follow-up is needed.
Integrator note: the second bullet is resolved by DEC-0357 (the driver's leftover check now uses the framework's `listStageResources`). The first bullet (apiKey generation, `secrets set` on the run stage, `COMPLIANCE_SECRET_API_KEY`, redaction; DEC-0277) is still open: no harness file sets `COMPLIANCE_SECRET_API_KEY`.
Integrator note (final): the first bullet is closed by DEC-0398 (D-07).
Item: D-T.

### DEC-0367 — Examples are whole files copied unchanged from the template and the reference app
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-REQ-001, SKILL-REQ-004, SKILL-AC-001, SKILL-AC-004, DEC-0054, skill.md §2 "Implementation", `skill/examples/**`

SKILL-REQ-004 needs every example to type-check and pass `verify` in CI and to come only from `apps/template` or `apps/reference`. Code kept in a second copy that CI does not compile would drift, and fragments do not compile. So each example is a Markdown file (`skill/examples/<topic>.md`, eight files, 2.5–10 KB each, within PAR-072) holding whole files copied byte for byte from those two apps. Each copy is a fenced block directly preceded by `<!-- example-source: <repo path> -->`. The code is type-checked and tested where it lives: root `npm run verify` runs `npm --workspace apps/template run verify` and the same for `apps/reference`. E-T1 can then check SKILL-AC-004 mechanically: every block equals its source file, and no source path is under `apps/demo/`. Reference-app files were chosen only where they show an app pattern (`evolution.ts` for `atomic` and joins, `routes/levels.ts`, `encoding.ts`, `env.ts`, `config/local.json`, `tests/support.ts`). Compliance-only routes that pass client names and keys to the framework unchanged (`routes/files.ts`, `routes/kv.ts`, `routes/ref.ts`) are not shown, because an app should not copy them.
If a source file changes, the matching block must be copied again; E-T1's equality check finds the drift. The examples were made with a one-off copy script that is not committed: it read each listed path and wrote the block.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-01.

### DEC-0368 — `skill/templates/` holds the files an app agent fills in; the app template stays `apps/template`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-REQ-001, SKILL-REQ-004, SKILL-REQ-005, C-05 scaffolder, `skill/templates/**`

SKILL-REQ-001 lists "templates applied by the scaffolder". The scaffolder built in C-05 (`skill/scripts/scaffold`, not owned by E-01) copies `apps/template`. CI already type-checks and tests that template. A second copy under `skill/templates/` would need its own CI run and would drift. So `apps/template` stays the one app template. `skill/templates/` holds the other files an agent copies in by hand:
- `FRAMEWORK-ISSUE.md`, with the entry fields of SKILL-REQ-003 (task, contract or reference consulted, minimal reproduction, observed code or diagnostic, workaround not taken), plus "expected" and "blocked requirements" for the next action;
- `production-stage.json`, a production values file that is valid against `stage-config.schema.json`, with a placeholder Google client ID;
- `README.md`, saying what to copy where.
For SKILL-AC-004, E-T1 can check `production-stage.json` against the schema. The Markdown templates have no code to type-check.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-01.

### DEC-0369 — Reference structure: "Read this when" opening, "Stopping condition" ending, a per-rule section for diagnostics
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-002, SKILL-AC-002, CHECK-REQ-003, CHECK-AC-003, DEC-0181, E-02

Every reference begins with `# <title>` and then a paragraph that starts "Read this when". It ends with a section `## Stopping condition` whose text starts "Stop reading when". This gives E-T1 a fixed form to check. A reference that a CHECK diagnostic can name has a section `## Check rules that send you here`, with each rule ID (`prototype-framework/<rule>`) and what to do. Diagnostics name only the file (`references.ts`), so this section is how a diagnostic resolves to a file *and* a section:
- `http-and-validation.md`: `allowed-imports`, `browser-api-only`, `app-error-codes`, `no-raw-html`;
- `configuration.md`: `no-env-access`;
- `sql-and-migrations.md`: the six SQL rules and the five `migration-*` checks.
`troubleshooting.md` belongs to E-02 (with `owner-tasks.md` and `deploying.md`). It needs the same section for `no-suppression-comments`, `@typescript-eslint/no-explicit-any`, `consistent-type-assertions` and `no-non-null-assertion`, the fallback for every other rule (`referenceFor`). Until E-02's file exists, those four CHECK-AC-003 cases cannot pass. E-01 creates the other ten files named in `references.ts`, and the router and references already link to E-02's three files.
The four `troubleshooting.md` rule entries were added by E-03 (DEC-0379), which closes this gap.
Item: E-01.

### DEC-0370 — No tested finalize-upload or HMAC example exists yet; the references describe both in prose
Origin: ai-proposed · Status: superseded by DEC-0380 and DEC-0382 (E-03 added the tested finalize-upload and HMAC examples) · Affects: skill.md §2 "Files" and "Secrets", SKILL-REQ-004, DEC-0054, E2E-015 (the demo's share links)

skill.md §2 asks for "one tested example of the upload pattern", with a finalize route that calls `head`, and "a tested HMAC signing and verification example using `crypto.subtle` and base64url encoding, without `Buffer`". Neither app has them. The template's file routes issue tickets into a per-user folder and have no finalize route. The reference app has `crypto.subtle.digest` and base64 helpers, but no HMAC or base64url code. Examples may come only from those two apps, and E-01 does not own them. So `files.md` describes the finalize step and `secrets.md` the HMAC steps in prose, with API names and no code block, and each says plainly that no tested example exists yet. Nothing was invented as "tested". Proposed follow-up: an item that owns `apps/template` adds (a) an attachment-style record with a finalize route (`head`, delete if oversized or of the wrong type, then insert the record) and (b) a small HMAC sign/verify helper with base64url and tests for valid, tampered and expired tokens. E-01 then copies both into the examples. The demo (F, share links) needs (b).
Item: E-01.

### DEC-0371 — Router front matter, and which pins hard rule 5 names
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-REQ-003, SKILL-AC-003, `skill/SKILL.md`

`SKILL.md` starts with YAML front matter (`name: prototype-framework` and a description), so agent runtimes that load skills can find it. SKILL-REQ-003 says "never change framework version pins". The router names the exact pins the template's `package.json` carries (`@lago-morph/prototype-framework`, `hono`, `zod`, `typescript`, `vite`, `vitest`). `zod` must equal PAR-112 (`verify` checks it), and the others are the versions the framework is tested with. The hard rules are numbered 1–7, and the `FRAMEWORK-ISSUE.md` entry fields and the next action are stated in full in the router, not only in the template (SKILL-AC-003).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-01.

### DEC-0372 — Cloud behaviour is stated as designed, not as observed
Origin: ai-proposed · Status: accepted · Affects: `skill/reference/{files,testing,secrets,log}.md`, DEC-0101, DEC-0317

The Cloudflare run of phase D is pending (D1 daily limit, DEC-0317). So where a reference describes cloud behaviour (tickets, the Cloudflare file-transfer refusal reported with `status: null`, the first-deploy secret check, the shared log bucket key layout, `smoke` against a test stage), it gives the behaviour as the component docs and the code define it. It never reports an observed result. The open FILES-AC-003 conflict on Cloudflare is named as an open owner item (DEC-0101), and the reference tells apps not to branch on a failed transfer's status. The local-only aid in `local-development.md` (becoming admin through `POST /api/auth/mock-login` from the browser console) follows DEC-0171 and the HTTP contract. It is marked as a development aid that app code never uses.
Item: E-01.

### DEC-0373 — Owner steps live in three references plus the README
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-006, AUTH-REQ-005, GOOGLE-REQ-004, `skill/reference/{owner-tasks,deploying,troubleshooting}.md`, `apps/template/README.md`

The skill splits the owner steps by topic to keep each reference under PAR-071, and every reference stays below 10,000 bytes. `owner-tasks.md` has the token, `setup-account`, secrets, the Google client, admin and user IDs, and cost. `deploying.md` has test and production deploys, smoke, stop and start, remove, and the billable list. `troubleshooting.md` has log lookup, error codes, login failures, deploy failures and `verify` diagnostics. Each reference opens with "Read this when" and ends with "Stopping condition:". The references link only to each other, not to E-01's references, so link checks do not depend on merge order. The template README has no size budget. The scaffolder copies it into every new app, so it repeats every owner step in full, with `template` as the app name and a note to replace it.
Item: E-02.

### DEC-0374 — Cloudflare API token: an account token with four Account permissions
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open; not verified live) · Affects: PROV-REQ-002 step 1, PROV §2 "Credentials", DEC-0083, DEC-0100, owner-tasks.md §2, README §2

The framework verifies the token at `/accounts/<id>/tokens/verify` and creates the per-stage signing tokens at `/accounts/<id>/tokens`. Both are account-token endpoints (DEC-0083: "The token is an Account API token"). So the owner creates the token under Manage Account → Account API Tokens, not under My Profile.

The four permissions are read from the calls the framework makes:
- Workers Scripts: Edit, for the Worker, its secrets, the `workers.dev` route and the subdomain;
- Workers R2 Storage: Edit, for `prototype-logs`, `sst-state`, the stage bucket and its CORS policy and objects;
- D1: Edit;
- Account API Tokens: Edit, which `r2-token.ts` names as its permission.

No live check of a token holding exactly these four was made: the sandbox token's permissions are not visible. So the docs say to add any permission that `deploy` names. If SST's Pulumi provider needs more (for example, Account Settings: Read), D-RUN or E-RUN must amend this list.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-02.

### DEC-0375 — Log lookup on Cloudflare uses the Cloudflare API's R2 object listing with the owner's existing token
Origin: ai-proposed · Status: accepted (not verified live; E-RUN's E2E-011 re-run is the check) · Affects: LOG-REQ-004, E2E-011, skill.md §2 "Troubleshooting", troubleshooting.md §1

skill.md names the dashboard, or an S3-compatible CLI with a manually created read-only R2 token. The troubleshooting reference keeps both, and adds as its main command form a `curl` to `GET /accounts/<id>/r2/buckets/prototype-logs/objects?prefix=<app>/<stage>/<yyyy>/<mm>/<dd>/`. It reads an entry with `GET …/objects/<encodeURIComponent(key)>`.

The `curl` form needs no second token. It works unchanged in the sandbox, because the proxy replaces the `Authorization` header (DEC-0083). It needs only `curl` and `node`, which every framework user has. The framework's own `listObjectKeys` uses the same endpoint without `prefix`. The `prefix` parameter and the single-object GET are unverified live; if either fails at E-RUN, the S3-CLI form in the same section is the fallback. The "no log entry" fallback is `npx wrangler tail <app>-<stage>` (the Worker name, DEC-0331).
Item: E-02.

### DEC-0376 — Stop and start are owner steps in the dashboard or the API; no CLI command is added
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: CLI-REQ-001 (unchanged), DEC-0078, DEC-0090, deploying.md §4, README §9

The CLI's command table (CLI-REQ-001, binding) has no stop or start command, and E-02 owns no CLI files. The owner therefore stops a stage by turning off its `workers.dev` route. This is the same thing `stopApp` does. The docs give two ways: the dashboard toggle, or the script-subdomain API call of DEC-0090, which always sends `previews_enabled: false`. Every `deploy` starts the stage again (PROV-REQ-002 step 6). A-04 verified the API call on a Worker deployed with wrangler, but not on a framework-deployed stage.
Checked by the integrator: the design does not expect an owner-facing stop or start command. CLI-REQ-001's table has none; provisioning.md §2 lists `stopApp`/`startApp` as per-target operations used by deploy step 6, MIG-REQ-006 step 1 and the failed-migration path; the prompt's §9 D "per-target operations, including stop and start by turning the `workers.dev` address off and on" names those operations, which D-03 implements (DEC-0090, DEC-0091). So this is a decision about the owner's documented route, not a gap. Owner: accept the dashboard/API route, or ask for `stop`/`start` commands (a CLI-REQ-001 change).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-02.

### DEC-0377 — Google client ID placeholder is an instruction, never an ID-shaped value
Origin: ai-proposed · Status: accepted · Affects: plan §10.6 ("never invent credentials"), GOOGLE-REQ-004, owner-tasks.md §5–§6, README §5–§6

No Google client exists in this phase. The values-file example therefore shows `"clientId": "<paste the Client ID from §5 step 5>"`. That text is an instruction, and it cannot be mistaken for a real `….apps.googleusercontent.com` value. No such file is committed under `config/**`. The callback URL is given as `https://<app>-<stage>.<subdomain>.workers.dev/api/auth/callback`. The owner finds `<subdomain>` with `GET /accounts/<id>/workers/subdomain`, because the first production deploy stops on unset secrets before it prints the callback URL. The workers.dev subdomain is personal (DEC-0086), so no real value appears in the docs.
Item: E-02.

### DEC-0378 — Cost note: D1 daily limit stated as "about 100,000 rows written per day" on the free plan
Origin: ai-proposed · Status: accepted · Affects: plan §1 "Cloud usage limits", owner-tasks.md §7, deploying.md §6, README §11

The plan's own figure (§1) is the only D1 limit the docs state. Reads are described only as having "a larger limit". The docs give no prices, because they change, and say only that storage, not compute, stays billable while idle. The README's billable-while-idle table follows skill.md §2. The AWS items (database storage, credentials secret, shared network, routes that keep the database awake) appear in one sentence marked "not available yet". The R2 lifecycle rule for `prototype-logs` is offered as optional, marked unverified. It does not contradict DEC-0018, because the framework sets no retention rule; the owner may choose to add one.
Item: E-02.

### DEC-0379 — Troubleshooting's check-rule section names the full rule IDs; E-02's references take E-01's ending
Origin: ai-proposed · Status: accepted · Affects: CHECK-REQ-003, CHECK-AC-003, SKILL-REQ-002, DEC-0369, `skill/reference/{troubleshooting,deploying,owner-tasks}.md`

`troubleshooting.md` §5 ("A `verify` diagnostic that points here") becomes `## Check rules that send you here`. It lists each rule ID as diagnostics print it: `prototype-framework/no-suppression-comments`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/consistent-type-assertions` and `@typescript-eslint/no-non-null-assertion`. Each entry says what to do instead. A last entry covers any other rule ID, because `referenceFor` sends every unknown rule here. The three E-02 references now end the way E-01's do: `## Examples` with at least one example link, then `## Stopping condition` beginning "Stop reading when". The text is otherwise unchanged. `troubleshooting.md` is 10,323 bytes, within PAR-071 (12,000).
Item: E-03.

### DEC-0380 — The template's files become record-backed, with a finalize route
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: skill.md §2 "Files", SKILL-REQ-004, FILES-REQ (unchanged), `apps/template/src/server/{schema.ts,routes/files.ts}`, `apps/template/src/client/pages/files.ts`, `apps/template/migrations/*/0001_schema.*`

skill.md's upload pattern needs a record that makes a file visible, so the template could not keep listing straight from storage and still show the pattern. The smallest change that shows the whole pattern:
- a second table `uploads` (`id`, `ownerId`, `name`, `size`, `contentType`, `createdAt`), with its generated migration pair `0001_schema.sql`;
- `POST /files/upload-ticket {contentType}` returns `{ id, ticket }`, where `id = newId()` and the storage name is `uploads/<userId>/<id>`. The browser never supplies any part of the storage name;
- `POST /files/finalize {id, name}` calls `head`. A missing upload gives `HTTP.NOT_FOUND`. If the file is over 10 MiB or its type is not one of `text/plain`, `application/pdf`, `image/png` and `image/jpeg`, it is deleted and the route answers `HTTP.CONFLICT`. Only then is the row inserted. Because the storage name comes from the caller's ID, nobody can finalize another user's upload;
- `GET /files` and `POST /files/download-ticket {id}` read the rows, filtered by owner. Another user's ID gives `HTTP.NOT_FOUND`.

The type check sits in finalize only, so there is one place to change. That is files.md's own advice: "an app that cares about upload size or type can check `head` after the upload". A second finalize of the same ID meets the primary key and gets the framework's `SQL.CONFLICT`. No extra code handles it. No config key holds the limits, because constants keep the template smallest. The smoke test is unchanged: its tickets would point at the cloud, where `TestApp.request` cannot follow them.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-03.

### DEC-0381 — App tests upload by sending the in-process ticket's wire form
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `apps/template/tests/app.test.ts`, files.md §2 "Implementation"/"Local", skill/reference/testing.md

No public test helper performs an upload, and `uploadFile` needs a browser. So the template test declares `WireUploadTicket { url, method, headers }`, which is the documented JSON form of a ticket (files.md §2). It sends that request with `TestApp.request`. Under `createTestApp` the URL is the same-origin `/api/__framework/files/<token>`. The test reads the ticket only as test plumbing, and app code still treats tickets as opaque. If FILES changes the wire form, this test fails and must change with it. A public `TestApp` upload helper would remove this coupling; that is a possible framework follow-up, not done here.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-03.

### DEC-0382 — HMAC is a helper module with unit tests, not a route or a new secret
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: skill.md §2 "Secrets", `apps/template/src/server/signing.ts`, `apps/template/tests/signing.test.ts`

`signToken(key, subject, expiresAt)` returns `<subject>.<expiresAt>.<base64url HMAC-SHA-256>`. `verifyToken(key, token)` returns the subject, or `null` for a malformed, tampered, wrongly keyed or expired token. It uses `crypto.subtle.verify` (constant-time), `btoa`/`atob`, and `now()` for expiry. It uses no `Buffer`. The tests cover valid, tampered (subject, expiry and signature), wrong key, malformed and expired tokens, with fake timers for expiry. No route uses the helper, and no `shareKey` secret is declared. A declared secret must be set on every stage, or the deploy health check fails. That would add an owner step to every template stage for a feature the template does not need. The doc comment and `secrets.md` show the key coming from `c.var.secrets.get(...)`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-03.

### DEC-0383 — Example blocks re-copied by script; sizes
Origin: ai-proposed · Status: accepted · Affects: DEC-0367, PAR-072

Every `<!-- example-source -->` block whose source changed was copied again (`endpoint-and-page`, `files-tickets`, `notes-sql`, `secrets`, `tests`), and the new blocks `signing.ts` and `signing.test.ts` were added to `examples/secrets.md`. A one-off scratch script did this and is not committed (as in E-01). It also confirmed that no other block drifted. Largest example: `tests.md` at about 12.5 KB (PAR-072: 20,000). `files.md` and `secrets.md` now point at the examples instead of describing the steps in prose. The skill.md §2 "Implementation" bullet that said neither app has these was updated.
Item: E-03.

### DEC-0384 — Where the skill tests run, and the wiring that collects them
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-001…-004, vitest.integration.config.ts, tsconfig.json

The plan puts the tests in `tests/skill/`, which neither the integration nor the unit glob collected. The criteria are Local and not unit-level (they are not in the driver's `UNIT_LEVEL`), so they belong in the integration layer, which the driver runs on local with its tag filter. Wiring: `tests/skill/**/*.test.ts` added to `vitest.integration.config.ts` `include`; `tests/skill/**/*.ts` added to root `tsconfig.json` `include`, so `npm run typecheck` (part of `verify`) checks them. No harness change. The files are not `*.unit.test.ts`, so `npm run test:unit`/`verify` do not run them (the AC-004 test runs both apps' `verify`, minutes long).
Item: E-T1.

### DEC-0385 — SKILL-AC-005 is not duplicated
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-005

`tests/compliance/criteria/skill/scaffold.test.ts` already runs the real scaffolder into two non-empty directories and checks exit 1, the message and a byte- and mtime-identical tree. E-T1 adds no second test for it.
Item: E-T1.

### DEC-0386 — Readings of SKILL-AC-001
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-001

- "Every document" = the router (PAR-070), each `skill/reference/*.md` (PAR-071), each `skill/examples/*.md` (PAR-072); sizes are file bytes (UTF-8). `skill/templates/` has no budget.
- "Every reference" is the set CHECK names (`packages/framework/src/check/references.ts`, fixed by skill.md §2 "Implementation"); a test checks `skill/reference/` holds exactly that set so the link check cannot miss one.
- "Each reference links to its examples": every reference links to at least one existing example (skill.md §2: "links to at least one example"), and every example is linked from some reference.
- The link check also requires every relative link in any `skill/**/*.md` to resolve to an existing file (anchors are not checked).
Item: E-T1.
Proposed strengthening of the third bullet: DEC-0403 (status `proposed`, plan §11 Q9).

### DEC-0387 — Readings of SKILL-AC-002
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-002

- "Opens with 'read this when'": the first paragraph after the H1 title begins "Read this when" (case-insensitive); nothing may come before the title.
- "Ends with a stopping condition": the last section is an H2 "Stopping condition" whose text begins "Stop reading when" (skill.md §2).
- "The router covers each listed task": for each SKILL-REQ-002 task, a row of the router's task-map table whose task cell names the task links the reference it needs: endpoint → http-and-validation.md; storing data → sql-and-migrations.md; files → files.md; admin page → current-user.md; testing → testing.md; deploying → deploying.md; diagnosing a failing request, and a failing deploy (a diagnose/troubleshoot/debug row naming each) → troubleshooting.md.
Item: E-T1.

### DEC-0388 — Readings of SKILL-AC-003
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-003

Each SKILL-REQ-003 rule must be stated, every clause in one numbered item of the router's "Hard rules" section (skill.md §2: hard rules as a numbered list). Phrases are matched case-insensitively with light wording tolerance; the five `FRAMEWORK-ISSUE.md` entry fields are matched as the requirement words them. `npx <package> verify` accepts the package name or its binary name (DEC-0049).
Item: E-T1.

### DEC-0389 — Readings of SKILL-AC-004
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-004

- An example is "derived from" an app when its code blocks are copies of that app's files; every code block must therefore carry a directly preceding `<!-- example-source: <path> -->` (blank lines between are refused), name a file of `apps/template` or `apps/reference` (never `apps/demo/`), and equal it byte for byte (a missing final newline is tolerated). No block may equal a non-empty `apps/demo/` file.
- "CI type-checks and runs every example": CI is the framework's root `npm run verify`, which must run both apps' `verify`; `verify` type-checks only `src/` and `tests/` and runs `tests/**/*.test.ts` (cli.md §2, PAR-116), so every TypeScript source must lie there and every test source match that glob. Non-TypeScript sources (SQL, HTML, JSON) need only exist in those apps.
- "Runs ... the template": the test runs `npm --workspace <app> run verify` for `apps/template` and `apps/reference` and requires exit 0 (needs the framework built, as the driver and `test:integration` do).
Item: E-T1.
Refined by DEC-0392. Proposed extensions: DEC-0404, DEC-0405 (status `proposed`, plan §11 Q9).

### DEC-0390 — `apps/template` and `apps/reference` have no `vitest.config.ts`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-AC-004, SKILL-REQ-004, PROV-AC-001 (reading in `tests/compliance/criteria/prov/template-deploy.test.ts`), decision-log entries at lines 1564 and 1599 (their mentions of "the template's `vitest.config.ts`" are now historical)

The Review left open whether to delete the file. Rule taken: delete it from an app only if nothing uses it. Checked:
- No script: neither app's `package.json` has a `test` script or any script that runs Vitest directly.
- Not `verify` or `smoke`: both start Vitest with `config: false` (`packages/framework/src/cli/verify/tests.ts`, `smoke.ts`) and set the PAR-116 glob and 60 s timeouts themselves (decision log line 1564).
- Not the scaffolder: `skill/scripts/scaffold.mjs` copies the template's files; no step reads or names the file, and no scaffolder test lists it.
- No test needs it: the PROV-AC-001 test's `ALLOWED` list only permits the name; an app without the file still passes.
- No doc tells developers to run plain `vitest` in an app; `skill/reference/testing.md` names only `verify` and `smoke`.

So both files are deleted. This also settles the record's Observation: the template has no TypeScript outside `src/` and `tests/`, so "CI type-checks … the template" holds for every file. A bare `npx vitest` inside an app now runs with Vitest defaults (5 s timeouts, SQLite only), which was never a supported test command.

Not changed: the decision log text (history) and the PROV-AC-001 reading comment, which still list `vitest.config.ts` as permitted metadata; permitting a file that is absent is harmless. The owner may trim both.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-e1.

### DEC-0391 — E2E-004 is judged at F-EV, not at C-EV
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: E2E-004, DEC-0305, DEC-0320, plan §4 C-EV, §7 F-EV, §11 Q1, `ai/implementation/evaluations/C-local.md` (flag 3)

The C-EV evaluation (`ai/implementation/evaluations/C-local.md`) recorded E2E-004 `failed` on local in run 3: its coverage part (DEC-0305, DEC-0320) reports DEMO-AC-001…-011 and E2E-002 as having no tagged test, and its pass part needs every other applicable result passed. Those criteria belong to the demo, built in phase F, so E2E-004 cannot pass before then; the root cause is accepted (`ai/implementation/root-causes/2026-10-20-E2E-004-coverage-and-not-run.md`, cause C revised). Plan C-EV listed E2E-004 as a phase C item, which was inconsistent with §11 Q1. Rule: E2E-004 is removed from C-EV's list and judged at F-EV, after the demo's tests exist. Its test is unchanged; it keeps running and reporting `failed` until then (never skipped). Owner: accept the move, or narrow E2E-004's coverage part to the components built so far.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: C/D/E integrator (from the C-EV evaluation's flag 3).

### DEC-0392 — SKILL-AC-004: a demo file equal to a block's verified template or reference source is not derivation
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-AC-004, DEC-0389, `tests/skill/example-copies.unit.test.ts`

Replaces the last sentence of DEC-0389's first bullet ("No block may equal a non-empty `apps/demo/` file.") with: "No block may equal a non-empty `apps/demo/` file unless its marker names a file of `apps/template` or `apps/reference` that exists and that the block also equals byte for byte." The marker must be present and directly adjacent, and its path must pass the plain-path and app checks; a block with no marker, or with an invalid or missing source, is still reported when it equals a demo file. The rest of DEC-0389 is unchanged.

Reason: the demo is built by copying the template (DEC-0054, prompt §9 F, `apps/demo/BUILD-RECORD.md`), so template files it keeps unchanged (the empty config files, `src/server/signing.ts`, `tests/signing.test.ts`) are byte-identical to example blocks that were copied from the template hours before the demo existed. The old proxy reported those six legitimate copies; byte equality with a demo file is not evidence of derivation when the bytes are also the block's verified source. Code taken from a demo-only file, or from a demo file that diverged from the template, is still caught (by this clause and by the byte-for-byte test).

Residual limit: demo code first copied into `apps/template` or `apps/reference` and then into an example cannot be detected from bytes; any byte-equality proxy either misses it or also flags legitimate copies. That route requires changing a verified app, which that app's `verify` and review own.

Root cause and review (ACCEPTED): `ai/implementation/root-causes/2026-10-20-SKILL-AC-004-demo-overlap.md`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-e4 (test author, §8 step 3).

### DEC-0393 — In-page clauses of DEMO-AC-001, -003 and -009 are verified by a compliance-layer browser spec, not by the demo's smoke test
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEMO, COMPL, SKILL (DEMO-AC-001, DEMO-AC-003, DEMO-AC-009, DEMO-REQ-010, demo-spec §2 preamble, `skill/reference/testing.md`, plan §7 F-03)

The demo-spec §2 preamble says the smoke test (DEMO-REQ-010) covers each criterion on a deployed stage except those it lists; the in-page clauses of DEMO-AC-001 ("renders as text"), DEMO-AC-003 ("displays") and DEMO-AC-009 ("the copy button copies it") are not in that list. This entry records a deviation from that preamble; `docs/demo/demo-spec.md` itself is not edited, because it is one of the fresh F-01 builder's three inputs (E2E-015) and states how binding criteria are verified.

Rule: those in-page clauses are verified by a compliance-layer Playwright spec, `tests/compliance/e2e/demo-pages.spec.ts` (tagged exactly DEMO-AC-001, DEMO-AC-003, DEMO-AC-009; outside `apps/demo/**`), locally against the demo under `dev` and on Cloudflare against the F-03 `test-` stage before it is removed; the AWS part is `not-run` under plan §8.2 only. The demo's smoke test covers their API side, and DEMO-REQ-010's "exercises each requirement" is read as met by that API-side exercise. The ACs and DEMO-REQ-010 are unchanged.

Reason: apps have no browser tests by design. Playwright is scoped to browser-level compliance tests (PAR-114, compliance.md); it is not an app dependency; SKILL.md hard rule 1 limits what `tests/**` may import; and `verify` and `smoke` run only Vitest `*.test.ts` files over HTTP (PAR-116, cli.md). The demo's smoke test therefore cannot cover page-only behaviour, and the demo builder correctly raised this as FRAMEWORK-ISSUE #1 instead of working around it. `skill/reference/testing.md` now states, app-generically, that an app's tests and smoke test reach it through its API and that page-only behaviour is checked by the framework's browser tests.

Root cause and review (ACCEPTED, fix amended): `ai/implementation/root-causes/2026-10-20-F-02-round-3-demo-issues.md`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-f4a (docs).

## Implementation phase: local and Cloudflare — follow-ups after phase E, phase F demo checks (2026-10-20)

Entries DEC-0394 to DEC-0412 were integrated by the final integrator from the drafts of items C-T6, D-07, E-04, E-T2, fix-e2, fix-f1 and fix-f4b (plan §10.4). None of these items made a Cloudflare call. No parameter changed. The E-T2 entries (DEC-0403 to DEC-0407) keep the status `proposed` that their draft gave them; their acceptance is open (plan §11 Q9).

### DEC-0394 — Level and placement of the runner's CLI-AC-003 tests
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-003, tests/compliance/harness/driver.unit.test.ts

CLI-AC-003 speaks of *injected* failures, and it is in the driver's `UNIT_LEVEL` list, so the tests are unit tests of `runCompliance` with fake `DriverDeps` (the existing `harness()` fake in `driver.unit.test.ts`; no network, no Cloudflare). They are in a new `[CLI-AC-003]` describe block of that file, each title tagged `[CLI-AC-003]`, so the local run's unit layer folds them into CLI-AC-003 only. "The compliance runner's cleanup" is read as: stopping `dev` (local), removing the test stage, and the leftover check (cloud).
Item: C-T6.

### DEC-0395 — Readings of "non-zero exit statuses that reflect the original failure"
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-003

- A failing tagged test: the run exits with the test runner's status (1 in the fake), and the record's `exitStatus` equals it.
- An original failure plus a failing cleanup: the exit status is still the original one (1), the record is still written, the original failure stays the recorded reason, and the cleanup failure is reported (raw remove log, `leftovers`, stage kept in the pending list).
- A cleanup failure after tests that all passed is a partial failure (CLI-REQ-003: "including partial failures"; `remove` with leftovers exits 1), so the run must exit non-zero. The exact value is not fixed by the criterion; the test asserts non-zero and that the record's `exitStatus` matches the process status.
Item: C-T6.

### DEC-0396 — Two tests failed against the driver; driver fixed, tests unskipped
Origin: ai-proposed · Status: accepted (resolved by the driver fix) · Affects: CLI-AC-003, tests/compliance/harness/driver.ts, tests/compliance/harness/cli.ts

The C-T6 test author found two `[CLI-AC-003]` tests failing and committed them as `it.skip` (the author does not change the code under test, prompt §7):

1. Local: when `dev`'s `stop()` rejected after a failing test, `runCompliance` threw out of its `finally` block. No record was written and `cli.ts` exited 64 (usage-error status), losing the original status 1.
2. Cloud: when every test passed but stage removal failed (leftovers remained) or the leftover check failed, the run exited 0.

Root cause and fix: `ai/implementation/root-causes/2026-10-20-CLI-AC-003-driver-cleanup-failures.md` (Review: ACCEPTED; Fix section). The driver now guards `local.stop()` (error text in raw `dev.log`, `exitStatus ||= 1`) and, after cleanup, sets `exitStatus ||= 1` when `leftovers` is non-empty, which includes a leftover check that could not run. `||=` keeps an earlier non-zero (original) status. Both tests are unskipped with no other test change; no `it.skip` remains in the harness tests. The `cli.ts` header and the Driver paragraph of `docs/components/compliance.md` state the rule. Cloud runs must be started with `NODE_USE_ENV_PROXY=1` in this sandbox (DEC-0357), or the leftover check cannot run and every cloud run correctly exits 1.

Open follow-ups from the review (not done here): F1, `cli.ts` gives the usage status 64 to any runtime exception from `runCompliance`; F2, `deps.pendingStages.remove` in `removeStage` is unguarded, so a failure to persist the pending list stops the record from being written.
Item: C-T6.

### DEC-0397 — AWS not-run parts for CORE-AC-006 and SQL-AC-006
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-006, SQL-AC-006, tests/compliance/harness/expected.ts

`PHASE_RULES` gains two part rules on `local`, automated tier, detail `AWS phase not started` (plan §8.2), shaped like CHECK-AC-005's demo part: CORE-AC-006 part "AWS-bundle clause" (no AWS bundle yet) and SQL-AC-006 part "Data API retry-loop clause" (the Data API adapter is AWS code, not built). Only `local`: the SQL-AC-006 clause is stated as local and deterministic, and CORE-AC-006 is Local only; on Cloudflare SQL-AC-006 has no not-run part. The AWS phase removes both rules when it adds their tests.
Item: C-T6.

### DEC-0398 — The driver deploys, sets `apiKey` through `secrets set`, and deploys again
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: DEC-0277, DEC-0366, compliance.md "Driver", `tests/compliance/harness/{driver,node-deps,env}.ts`, SEC-AC-001, SEC-AC-002, HTTP-AC-002, CORE-AC-002, D-RUN

- **When.** Only for a run stage the driver deploys itself (cloud target, no `--base-url`). Local runs are unchanged: the value stays in `apps/reference/.dev.vars`, set by the operator (DEC-0277). A cloud pass on a given `--base-url` (the MIG pass, DEC-0355) generates and sets nothing; an exported `COMPLIANCE_SECRET_API_KEY` still passes through there as before.
- **Sequence.** `deploy` → generate → `secrets set apiKey --target <cloud> --stage <stage>` → `deploy` again. The first deploy of a new stage stops after step 5 with "required secrets are not set: apiKey" and the app stopped (provision core `checkSecretsAfterFirstCode`); the CLI wrapper recognises that output (or the preflight's "secret <name> is not set (set it with secrets set)") and rejects with `SecretsNotSetError`, which the driver accepts; any other deploy failure propagates unchanged (no retry, no secret). The second deploy always runs, also when the first one succeeded (a reused `--stage` that already had a value): it starts the stopped app and its health check passes only on the version that has the new secret, which is simpler and safer than relying on the secret PUT's own version roll-out (DEC-0092: a few seconds' delay).
- **Value.** 32 characters from `[A-Za-z0-9]`, `crypto.randomInt` per character (≥ 12 as `testSecretValue()` needs). Generated in the driver process per run, held only in memory.
- **Setting it.** The framework's own path (D-05, DEC-0354): `npx prototype-framework secrets set apiKey …` in `apps/reference`, the value written to the process's standard input, never an argument. Its output (which never contains the value, CLI-REQ-004) is kept as `raw/secrets-set.log`, redacted again defensively. `CloudStageOps.setSecret` is optional in the interface so cleanup-only operation objects (COMPL-AC-004's test) need not provide it; the driver fails the setup with a clear message if a deploying target lacks it.
- **Handing it to the tests.** `COMPLIANCE_SECRET_API_KEY` in the environment of the vitest and Playwright processes only (`env.ts` `ENV.testSecret`, `childEnv({ testSecret })`); the build and typecheck processes do not get it.
- **Never logged or committed.** The value is added to the evidence writer's redactions (`<test-secret>`) before it is set, so a failure after that point still redacts; the writer applies them to the record and every raw file. The driver's own output lines go through the same redactions (this also applies the existing account-subdomain redaction to them). The live echo of a process given values to hide (the test runners, `secrets set`) is written a line at a time with the values replaced, so a value split across two output chunks is still hidden.
- **Raw files.** `deploy.log` (first deploy), `secrets-set.log`, `redeploy.log`.
- **Check.** `driver.unit.test.ts` "[COMPL-AC-004] the test secret on a cloud run stage": the real evidence writer, into a temp root, with a fake test run that prints the value in its output and its failure message: no written file contains the value, the raw log shows `<test-secret>`, and no driver log line contains it; plus no command line carries it and the build/typecheck environment lacks it. `node-deps.unit.test.ts`: the generator's form, the unset-secrets recognition, standard input plus line-wise echo redaction on a real child process, and the request count below.

Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-07.

### DEC-0399 — Extra Cloudflare API requests per run stage
Origin: ai-proposed · Status: accepted · Affects: plan §1 "Cloud usage limits", §5 D-RUN estimate

Relative to the driver before D-07 (one `deploy`, which on a new stage stopped on the unset secret), per run stage:
- `secrets set apiKey`: **1** request (`PUT …/workers/scripts/<worker>/secrets`), counted on D-03's fake account through `cloudflareOperations` (`node-deps.unit.test.ts`; building the operations makes none).
- second `deploy`: ≈ **16** framework requests + 2 SST runs (30–60 each, unmeasured) + 3 D1 requests, D-05's count on the fakes (plan §5 D-RUN "Command sequence per stage").
- Total ≈ **17 framework requests + 2 SST runs (≈ 77–137 requests)**; the secret step writes no D1 rows (the redeploy's D1 rows are within D-05's per-stage "< 60 rows written"). These steps were already in the plan's per-stage estimate (≈ 215–370 requests), so that estimate is unchanged.

Item: D-07.

### DEC-0400 — Owner steps use existing commands for the app name and for checking a values file
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-006, prompt §3, README §1/§6/§8, owner-tasks §1/§5/§6, troubleshooting (top), deploying §4

The framework has no command that prints the app's name or creates or edits a stage's values file, and none is added (no new CLI features). Instead:
- the app's name comes from `build --target local --stage local`, which already prints `built <app> for target …`: `APP=$(npm run --silent build -- --target local --stage local | sed -n 's/^built \([^ ]*\) for .*/\1/p')`. It builds only into the git-ignored `.framework/` and makes no network call (checked in a network namespace);
- after creating or editing `config/cloudflare/<stage>.json`, the owner runs `npm run build -- --target cloudflare --stage "$STAGE"`, which rejects invalid JSON and undeclared keys (checked locally, no network). It does not check that `framework.google.clientId` is present; `deploy` does.
Item: E-04.

### DEC-0401 — Values file created and edited by pasted `node -e` one-liners
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-006, README §6/§8, owner-tasks §5/§6

The production values file is written by a `node -e` one-liner that takes the Client ID as an argument (no heredoc, because indentation inside Markdown list items would break the `EOF` terminator on copy). Admin and user IDs are added or removed by one `node -e` one-liner with `OP=add|remove` and `LIST=admins|users`, which de-duplicates and then prints the file. This replaces the JSON fragment the owner had to merge by hand. Node is already required. `skill/templates/production-stage.json` is left for agents; owner pages do not need it. Commands were tested on a scratch copy.
Item: E-04.

### DEC-0402 — Explicit git lines, `STAGE` variable, extracted subdomain, unverified labels
Origin: ai-proposed · Status: accepted · Affects: SKILL-REQ-006, prompt §11, README, owner-tasks, deploying, troubleshooting, SKILL.md, files.md

- Every "commit" step now gives `git add …` and `git commit -m …` lines (`git add -A` for app changes; `.gitignore` keeps `.dev.vars`, `.logs/` and `.framework/` out).
- The stage name is set once as `STAGE=…` and used as `"$STAGE"` (and `"$APP-$STAGE"` for the Worker name).
- The `workers.dev` subdomain is extracted from the API response with the same `node -e` JSON pattern the log commands use, and the callback URL is printed with `echo`.
- The sandbox-only proxy-token note is removed from troubleshooting §1.
- Every Cloudflare dashboard menu path is labelled "not yet verified".
- owner-tasks §1 and README §1 end the repository-root block with `cd apps/template`.
- F8: `SKILL.md` now says apps are *designed* to run on Cloudflare and AWS, that only local runs are verified, and that the AWS target is not built yet; `files.md`'s Cloudflare platform note and troubleshooting's two Cloudflare-specific table cells are marked not yet verified.

Sizes after the change (PAR-071, 12,000 bytes): owner-tasks ≈ 10.0 kB, troubleshooting ≈ 10.4 kB; SKILL.md within PAR-070. No example block changed.
Item: E-04.

### DEC-0403 — SKILL-AC-001: "each reference links to its examples" means every example tied to it (F1)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-001, DEC-0386 (third bullet strengthened)

DEC-0386 read "its examples" as "at least one example". The criterion says *its* examples (plural, possessive): each reference must link every example that shows what it covers. `tests/skill/budgets-and-links.test.ts` now holds a table of each reference's examples, keyed by exactly `REFERENCE_FILES`, and requires every link in it. The "at least one" and "every example linked from somewhere" checks remain. Each row comes from skill.md §2 and from the files each example copies, not from the references' text:

| Reference | Its examples | Reason |
| --- | --- | --- |
| configuration | configuration | the only example of configuration keys and values files |
| current-user | admin-and-current-user | the only example of levels, `getCurrentUser`, `requireUser`/`requireAdmin`/`requireCurrentUser` |
| deploying | configuration, tests | design "Deploying": test stages use `config/<target>/test.json` (copied only in configuration.md); design "Testing": the smoke test against a deployed test stage (tests.md) |
| files | files-tickets | design "Implementation": `files-tickets.md` copies the finalize route "and the references point there" |
| http-and-validation | endpoint-and-page | design "HTTP and validation": `Hono<Env>` from `env.ts`, response types in `src/shared/`, `api<T>` in browser code; all shown there |
| kv | status-kv | the only example using `c.var.kv` |
| local-development | configuration, endpoint-and-page | `config/local.json` (configuration.md) and the `index.html` and client entry `dev` serves (endpoint-and-page.md) |
| log | notes-sql | the only example writing a log entry (`c.var.log.write`) |
| owner-tasks | configuration | copy-ID steps put IDs in `config/<target>/<stage>.json`, copied only in configuration.md |
| secrets | secrets | design "Implementation": `secrets.md` copies the HMAC helper and "the references point there" |
| sql-and-migrations | notes-sql | the only example of tables and generated migrations |
| testing | tests | the only example of `createTestApp` and the smoke test |
| troubleshooting | (none) | the design ties no example to it; the "at least one" check still applies |

Result: **fails today**: `skill/reference/deploying.md does not link skill/examples/configuration.md`. That is a skill gap, not fixed here (test-author item). Fix: add the link in `deploying.md` (E-04 or a docs fix item).
Integrator note: item fix-e3 added that link (root cause `ai/implementation/root-causes/2026-10-20-SKILL-AC-001-deploying-missing-example-link.md`, Fix section), on the precondition that this entry is accepted; the status is left as drafted.
Item: E-T2.

### DEC-0404 — SKILL-AC-004: the template's browser examples are run (F2)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-004, DEC-0389

"CI type-checks and runs every example." Examples copy `apps/template/index.html`, `src/client/main.ts`, `src/client/dom.ts` and `src/client/pages/{account,admin,files,notes,status}.ts`. No app test executes them; the app tests reach server routes only. New `tests/skill/example-pages.test.ts` (integration layer, so the driver runs it):
- a static check: every example source that is an `index.html` or under `src/client/` must be loaded by the template's `index.html` (its module script, then the relative non-type imports). So the run covers each one, and a new browser example outside that graph fails;
- a run: a scratch copy of `apps/template` (greeting set, `apiKey` set with `secrets set`) is served with `dev` and driven in Chromium by `tests/compliance/e2e/support/template-pages.ts`, the same driver E2E-001 uses. That covers the greeting, log in and out, Notes, Status (kept after reload), Files upload and download, and the admin secret check. All 7 steps must pass, with no uncaught page exception. The driver now also reports `pageErrors` (Playwright `pageerror`). E2E-001 reads only `steps`, so it is unaffected.

Server-side example files are executed by the apps' `verify` tests, which load `src/app.ts` and so every route module. No per-file coverage check was added: the criterion asks that the examples run, and module load plus the route tests meets that.

The run is not in root `npm run verify`. Putting it there needs a wiring line outside test files, in root `package.json` `verify`: append `&& vitest run --config vitest.integration.config.ts tests/skill/example-pages.test.ts`. It needs the framework built (verify builds it first) and Chromium (`/opt/pw-browsers`). It takes about 20 s. Not applied: changing root scripts is shared configuration (plan §1 rule 1 then requires a full `verify`), so it is left to the orchestrator.
Integrator note: item fix-e3 has since appended that line to root `verify` and ran full `verify` online and offline (same root-cause record, Fix item 2); the status is left as drafted.
Item: E-T2.

### DEC-0405 — SKILL-AC-004: the byte-for-byte example check runs in root `verify` (F3)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-004, DEC-0384

`tests/skill/examples.test.ts` was split into two files:
- `tests/skill/example-copies.unit.test.ts` holds the file-only checks: markers, no `apps/demo/`, byte-for-byte equality, sources inside what `verify` covers, and the root `verify` wiring. The unit include glob `tests/**/*.unit.test.ts` collects it, so `npm run test:unit` and therefore root `npm run verify` run it. The integration glob `tests/skill/**/*.test.ts` also collects it, so the driver's integration run still evidences SKILL-AC-004 from it. The driver's unit run is limited to `UNIT_LEVEL` and ignores it. No configuration changed. A new tagged test asserts this wiring: root `verify` runs `test:unit`, which uses `vitest.unit.config.ts`, which includes `tests/**/*.unit.test.ts`.
- `tests/skill/examples.test.ts` keeps only the two apps' `verify` runs (minutes long). Root `verify` runs those apps' `verify` itself.
Item: E-T2.

### DEC-0406 — CHECK-AC-003 covers the five migration-checker rule IDs (F4)
Origin: ai-proposed · Status: proposed · Affects: CHECK-AC-003, DEC-0187

"Every rule's diagnostic" includes the migration checker's five rule IDs (check.md §2). New `packages/framework/test/integration/check/migration-diagnostics.test.ts` runs the real `verify` on three fixture apps (`apps/base` + `mig/base`; three apps so that one break cannot hide another). For each rule it requires a line in the check.md §2 layout carrying that rule ID, a message that names the construct (the location prefix is excluded), and a `skill/reference/*.md` that exists:
- `migration-checksums`: a comment appended to a generated migration; the message names that migration.
- `migration-history`: a pair numbered two past the last, recorded in checksums; the message names the file.
- `migration-dialects`: a column added to one dialect only, checksum kept; the message names the column.
- `migration-supported-changes`: a column renamed by hand in both dialects; the message names the file and both columns.
- `migration-apply`: an `ALTER TABLE` on a missing table; the message names the file and the missing table.

All 5 pass.
Item: E-T2.

### DEC-0407 — The CHECK-AC-003 coverage control is tagged and checks "exactly one" (F5)
Origin: ai-proposed · Status: proposed · Affects: CHECK-AC-003

The control in `portability-rules.test.ts` is now tagged `[CHECK-AC-003]`, so the driver runs it. It was untagged and showed as `skipped`. Before, it mapped `RULES` through `some(...)`, so a rule with two representative fixtures passed. Now it lists every representative fixture's rule, plus the other representatives, and requires that list sorted to equal `ALL_RULES`. So each rule has exactly one, none missing and none twice. It passes.
Item: E-T2.

### DEC-0408 — A criterion is defined only by a row of a `| ID | Criterion | Verifies | Where |` table
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL-REQ-001, COMPL-REQ-002, COMPL-AC-001, compliance.md "Driver", DEC-0319

Before this decision the driver's catalogue (`tests/compliance/harness/catalogue.ts`) took any `| <AREA>-AC-NNN | … |` row of three or more cells anywhere under `docs/` as a definition, with its last cell as the Where text, and the COMPL test's independent reader (`tests/compliance/criteria/compl/support.ts` `whereSets`) took such a row of any width. DEC-0319's two-column table of criterion IDs in the decision log broke the test's reader; a three-column one would have broken the driver ("defined twice"). `docs/CONVENTIONS.md` does not define the criteria table format; every defining document uses the same header, which COMPL-AC-001 ("the criteria's "Where" columns") relies on.

Rule (both readers, implemented separately; the test shares no code with the harness):
- A row defines a criterion only when it is a body row of a table whose header row has the cells `ID`, `Criterion`, `Verifies`, `Where`, in that order (compared after trimming), with a `| --- |` separator row next. The table ends at the first line that does not start with `|`.
- The ID and the Where text are read from the `ID` and `Where` columns by index. An escaped `\|` inside a cell does not split it.
- Inside a criteria table, a body row whose cell count differs from the header's, or whose ID cell is not `<AREA>-AC-NNN`, throws with the file and line. A header row whose first two cells are `ID | Criterion` but which is not exactly that header with a separator next also throws. Rows outside criteria tables are ignored, whatever their width.
- Scenarios are unchanged: a `#### E2E-nnn` heading followed by a `Where:` line.

On the real `docs/` both readers give the same 140 IDs (124 criteria, 16 scenarios) and the same per-target, per-tier sets as before the change. No doc change: DEC-0319's table stays as written. Stating the rule in compliance.md "Driver" is left to the owner.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-e2 (root cause 2026-10-20-COMPL-AC-001-where-parser-decision-log).

### DEC-0409 — `TestApp.dispose` states that in-process views share disposal
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: `docs/contracts/ts/testing.d.ts` (`TestApp.dispose` doc comment), DEC-0193, `skill/reference/testing.md`

No type or behaviour change. The doc comment on `dispose` now states the behaviour DEC-0193 and `test-app.ts` already have: in-process, the original test app and every test app made from it with `as` share one app, so disposing any of them disposes all and later requests through any of them reject; on a connected stage it only logs that test app out and stage data is kept. Changing in-process behaviour (making a view's `dispose` a no-op) is not proposed; it would need its own decision.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-f1 (root cause 2026-10-20-F-02-round-1-demo-issues, entry 4).

### DEC-0410 — The spec finds the demo through `COMPLIANCE_DEMO_BASE_URL`, or starts it locally
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: COMPL (compliance driver usage), DEMO, plan F-03

The driver starts or deploys the reference app only, and `COMPLIANCE_BASE_URL` names that app. The spec therefore does not use the harness `baseURL`. It works out the demo's origin like this:
- If `COMPLIANCE_DEMO_BASE_URL` is set, the spec uses that origin, on any target.
- If it is unset and the target is `local`, a `beforeAll` copies `apps/demo` to the git-ignored `.framework/e2e/demo-pages-<random>/`, the same way `support/apps.ts` copies apps for other E2E specs. It starts `dev` there with `support/process.ts` `startDev` and stops it in `afterAll`. Each run starts from fresh local state, and the tree stays clean (the driver's evidence check).
- If it is unset on a cloud target, every test calls `prerequisiteMissing`, so the criteria are recorded `blocked` with a reason, never passed or `not-run`.

**No driver or harness wiring was needed.** The driver passes its whole environment to Playwright (`childEnv`), so the variable reaches the spec unchanged. F-03 runs the spec against the demo's `test-` stage before it removes that stage:
`COMPLIANCE_DEMO_BASE_URL=<demo stage origin> npm run compliance -- --target cloudflare --base-url <demo stage origin> --only DEMO-AC-001,DEMO-AC-003,DEMO-AC-009`
With `--base-url`, the driver deploys no reference stage. The cloud cost is two posts, four photo, publish and delete calls, and one about 24 MB R2 object, which is deleted. That is tens of D1 rows. The F-03 estimate rules still apply.
Item: fix-f4b.

### DEC-0411 — Selectors come from the demo specification, not the round-3 demo
Origin: ai-proposed · Status: accepted (assumption; owner review open) · Affects: DEMO, COMPL

The demo is rebuilt from its specification every round (round 4 is in progress), so the spec uses no demo API route, element ID or class name. It drives the page only through:
- the framework's routes `/api/auth/mock-login` (identities, on local and `test-` stages) and `/api/auth/me`;
- controls found by role and accessible name, with tolerant patterns.

**Assumed accessible names** (the `ASSUMED_*` constants in the spec). The demo specification requires these controls but does not name them:

| Control | Role | Name pattern |
| --- | --- | --- |
| title field | textbox | `/title/i` |
| text field (optional) | textbox | `/text\|body\|content\|message/i` |
| create button | button | `/create\|new (draft\|post)\|add (draft\|post)\|submit\|save draft/i` |
| attach button (optional; clicked if present) | button | `/attach\|upload\|add photo/i` |
| publish button | button | `/^publish\b/i` |
| delete button (cleanup only) | button | `/delete/i` |
| account link (optional; followed if present) | link | `/account/i` |
| account heading | heading | `/account/i` |
| copy button | button | `/copy/i` |

**Assumed page flow:**
- The draft form is on the front page `/`.
- After creating a draft, the app either goes to the post or lists it as a link named by its title. The spec opens it through that link.
- The file picker for photos is on the post page.
- Published posts are listed on `/` as links named by their titles.

**One structural selector:** `input[type="file"]`, because a file picker has no required accessible name.

**How each clause is checked:**
- The title check looks for elements whose whole text is the title (`getByText(…, { exact: true })`), in any role.
- The photo check scans `document.images` for an image whose natural size is the photo's 3600×2400, then repeats the check on a fresh load of the post.

The round-3 demo matches all of these. The round-4 demo has no account link, so that link is now optional and the account heading and displayed ID are asserted instead (root cause `2026-10-20-demo-ac-009.md`); the whole spec passes against round 4 locally. The whole spec must still be re-checked against the deployed round-4 demo before the F-03 run.
Item: fix-f4b.

### DEC-0412 — What each test asserts
Origin: ai-proposed · Status: accepted (assumption; owner review open) · Affects: DEMO-AC-001, DEMO-AC-003, DEMO-AC-009

**DEMO-AC-001.**
- An admin creates a draft through the page. The title is `Hello <script>window.demoPagesXss<id>=1</script> <id>`. The specification lets admins create drafts and publish any post, so no user's draft has to be reached by an admin.
- On the author's post page, then in an anonymous visitor's list on `/`, then on the visitor's view of the post, the spec checks:
  - an element shows exactly the literal title as its rendered text;
  - that element has no child elements;
  - no `script` element contains the marker;
  - `window[marker]` is undefined.
- The post is deleted through the page afterwards.

**DEMO-AC-003.**
- The browser encodes a random-pixel 3600×2400 baseline JPEG at quality 1. It is about 24.5 MB, and the test requires at least 20 MiB, so it counts as 20 MB under either reading. It also checks the `FFD8FF` signature.
- The JPEG is attached through the post page's file picker.
- Pass: an image on the post is `complete` with natural size 3600×2400, so `naturalWidth` > 0. This holds both after the upload and on a fresh load of the post.
- The download and byte-identity clause is left to the smoke test and is not claimed here.

**DEMO-AC-009.**
- Clipboard read and write are granted for the demo origin, and a sentinel is written to the clipboard first.
- The user opens `/` and reaches the account page through the page's own link if it has one; otherwise the account page must be shown on `/` (round 4 shows it inline on every page). Root cause: `ai/implementation/root-causes/2026-10-20-demo-ac-009.md`.
- The test asserts more than the link: the account heading (`/account/i`) is visible, and the ID that `/api/auth/me` returns is visible as an element's exact text ("The account page shows the same ID as `/api/auth/me`").
- The user then clicks the copy button.
- Pass: the clipboard then holds exactly the `id` that `/api/auth/me` returns, which is the ID given to the mock login.

The tests are independent: no serial mode, so one test failing does not skip the others. The file is named without a scenario ID and is tagged only DEMO-AC-001, DEMO-AC-003 and DEMO-AC-009, not E2E-015.
Item: fix-f4b.
