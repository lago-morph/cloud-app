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

These were recorded by AI spikes A-01…A-10 of `ai/implementation/plan.md` and integrated by item A-INT. Evidence is under `ai/implementation/spikes/<item>/`. All are `ai-proposed`; where an entry says it was taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue", it is open for owner review.

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
Origin: ai-proposed · Status: accepted · Affects: cloudflare.md §2 (`setupAccount`), D-03/D-05

`GET /accounts/{account}/workers/subdomain` returns `success: true` with a subdomain set, so on this account `setup-account --target cloudflare` only reads and records it (the "register if none" branch is not exercised here and is tested only by unit tests with a fake API). The subdomain value contains the owner's name; it is not written into committed docs or evidence (it is computed/recorded at runtime by `setup-account`), and spike logs redact it.
Assumption (owner not asked, per instruction): treating the subdomain as non-secret but personal — redacted in committed artefacts, not a credential.
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
Origin: ai-proposed · Status: accepted · Affects: cloudflare.md §2 (`deploy`, `startApp`), migrations.md §2 step 6, D-03

With the route off, `wrangler deploy` of a config with `workers_dev: true` turned the route back on. So a stop is not held across a deploy. This is consistent with MIG §2 step 6 (deploy, then start) and with cloudflare.md's rule that the CLI calls `startApp` explicitly after every deploy. SST's Worker (URL / `WorkersScriptSubdomain`) behaviour while the route is off was not tested here.
Assumption (owner not asked, per instruction): no design change; D-03 verifies by test that an SST deploy followed by `startApp` leaves `enabled: true, previews_enabled: false`, and that `stopApp` is never followed by a deploy before migrations finish (MIG §2 order already guarantees this).
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
Origin: ai-proposed · Status: accepted · Affects: MIG-REQ-005, MIG-REQ-006 step 2, migrations.md §2 "Cloudflare" and "Fallback copy", PROV §2 `copyDatabase`, D-04

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
Origin: ai-proposed · Status: accepted (owner review open) · Affects: SQL-REQ-002, SQL-REQ-003, CORE (AppDefinition.tables), docs/contracts/ts/sql.d.ts, docs/contracts/ts/index.d.ts, B-05

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
Origin: ai-proposed · Status: accepted · Affects: DEC-0083, DEC-0088, DEC-0084, PROV §2 "Credentials" and "Removal", plan §10.6, D-03, D-05, every cloud run

One statement of DEC-0083 as amended by DEC-0088, for implementers:
- **wrangler:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>` (the proxy injects the real token for `api.cloudflare.com`), `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, plus the sandbox's `HTTPS_PROXY`.
- **SST/Pulumi:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID`, `NODE_USE_ENV_PROXY=1`, `--stage` (or `SST_STAGE`), plus `HTTPS_PROXY`.
- **Framework Node code** calling Cloudflare or `workers.dev` with `fetch`: `NODE_USE_ENV_PROXY=1` (DEC-0085).
On an owner machine the real token goes in `CLOUDFLARE_API_TOKEN` and the proxy-specific variables are harmless. Removal: `sst remove` leaves the stage's state objects (including its passphrase) in the `sst-state` bucket, so the framework's Cloudflare `remove` deletes the objects under `*/<app>/<stage>` itself and never the bucket (DEC-0084).
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-01/RESULT.md`, `ai/implementation/spikes/a-03/RESULT.md`.

### DEC-0108 — Offline runs use the spike's `offline.sh` wrapper
Origin: ai-proposed · Status: accepted · Affects: plan §10.2, B-17 (`verify` offline check), B-18 / C-05 exit checks, CHECK-REQ-006 runs

Plan §10.2's offline command runs `ip link set lo up`, but `ip` (iproute2) is not installed in this sandbox. Offline runs use `unshare -rn sh <dir>/offline.sh <command…>`, where `offline.sh` brings loopback up with `ip` if present and otherwise with an ioctl through `python3 -I lo-up.py`, then runs the command. Spike A-10 ran Vitest, `wrangler dev` and Playwright + Vite offline with it. The files are `ai/implementation/spikes/a-10/scripts/{offline.sh,lo-up.py}`; B-01 copies both unchanged to `scripts/offline.sh` and `scripts/lo-up.py` at the repository root, and later items use that path. Unsetting `HTTPS_PROXY` or disabling TLS is still never a substitute.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-10/RESULT.md` "Environment", commands 3, 5, 13.

### DEC-0109 — The framework depends on `@pulumi/cloudflare` only if its code imports it
Origin: ai-proposed · Status: accepted · Affects: PAR-108, B-01 (`FW/package.json`), D-03

SST 4.17.2 installs its own `@pulumi/cloudflare` 6.15.0 (PAR-108) in `.sst/platform`, and installing the package directly pulls a newer `@pulumi/pulumi` (3.270.0) than SST's (3.215.0). So the framework declares `@pulumi/cloudflare` as a dependency, at exactly PAR-108, only if framework code imports it (for example for types or a resource SST does not wrap); otherwise it relies on SST's copy and declares nothing. PAR-108 stays the pinned version either way.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Evidence: `ai/implementation/spikes/a-10/RESULT.md` finding 5, command 15.
