# Decision Log

Each entry records one decision, its origin (see [CONVENTIONS.md §4](../CONVENTIONS.md)), and its status. Entries are never deleted; a reversed decision gets a new entry, and the old one is marked `superseded by DEC-…`.

Statuses: `accepted` · `not-adopted` (considered or inherited, deliberately not carried forward) · `removed` (previously in scope, taken out by the owner) · `superseded`.

"Earlier spec" means the AI-assisted specification drafts of October 8–9, 2026 kept under `ai/spec/`. The owner typed none of that text, so anything inherited from it without owner confirmation is `provenance-unclear`.

Entries DEC-0001 to DEC-0029 and DEC-0036 to DEC-0050 were recorded on 2026-10-18 during the specification reorganization session, from the owner's statements in that session unless their origin says otherwise.

---

## Requirements-level decisions

### DEC-0001 — Both clouds mandatory; framework stays cloud-neutral
Origin: owner · Status: accepted; for release 1 amended by DEC-0508 (local and Cloudflare; AWS in a later release) · Affects: SYS-REQ-001, SYS-REQ-002

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
Origin: owner · Status: superseded by DEC-0521 (admins are a role stored with the account in the stage's database) · Affects: SYS-REQ-018, CFG, AUTH

The admin list moves from secrets to configuration and identifies admins by the same opaque user ID the app sees. Instructions must show how to find one's own ID; copy and paste is acceptable. Because configuration is deploy-time, changing admins requires a redeploy.

Not adopted from the earlier spec: an admin list stored as a secret, keyed by provider issuer and subject, with periodic refresh.

### DEC-0016 — Google first, behind a provider-neutral abstraction
Origin: owner · Status: accepted; the Google part superseded for release 1 by DEC-0509 and DEC-0513 (email and password replaces Google; the provider-neutral abstraction stays) · Affects: SYS-REQ-019, AUTH, GOOGLE

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
Origin: owner-approved · Status: accepted; for release 1 amended by DEC-0508 ("works" means local and Cloudflare) · Affects: SYS-REQ-026, COMPL

### DEC-0021 — Real-provider certification is a separate, rarely repeated manual test
Origin: owner · Status: superseded by DEC-0512 (an automated check on a production deployment replaces the guided manual certification) · Affects: SYS-REQ-027, GOOGLE

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
Origin: owner-approved · Status: accepted; amended by DEC-0524 (the level is read from the account on each authenticated request; sessions stay unrevocable) · Affects: AUTH

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
Origin: owner · Status: superseded by DEC-0522 (anyone who signs up and verifies is a user) · Affects: SYS-REQ-017 (refinement), AUTH, CFG, SKILL, DEMO

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
Evidence: `ai/implementation/spikes/a-01/RESULT.md`, logs `w01`–`w15`, `s03`–`s07` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md). Fallback: none needed.

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
Evidence: `ai/implementation/spikes/a-02/RESULT.md`, logs `c02`, `c03`, `n01`, `n02`, `p01` (archived). Fallback: none needed (plan fallback was "report the refused host to the owner").

### DEC-0086 — The account's `workers.dev` subdomain is already registered
Origin: ai-proposed · Status: accepted (resolved by the owner, 2026-10-25: the account's subdomain was renamed to a neutral name; see DEC-0552) · Affects: cloudflare.md §2 (`setupAccount`), D-03/D-05

`GET /accounts/{account}/workers/subdomain` returns `success: true` with a subdomain set, so on this account `setup-account --target cloudflare` only reads and records it (the "register if none" branch is not exercised here and is tested only by unit tests with a fake API). The subdomain value contains the owner's name; it is not written into committed docs or evidence (it is computed/recorded at runtime by `setup-account`), and spike logs redact it.
Assumption (taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"): treating the subdomain as non-secret but personal — redacted in committed artefacts, not a credential.
**Resolved (owner, 2026-10-25).** The owner renamed the account's `workers.dev` subdomain to a neutral name, so it no longer contains personal data. The framework must never register a subdomain derived from personal data: on an account without one, `setup-account` registers `pf-<random>` (DEC-0552).
Evidence: `ai/implementation/spikes/a-02/logs/c01-subdomain-get.txt` (archived). Fallback: none needed.

### DEC-0087 — SST/Pulumi Worker updates keep secrets set through the Cloudflare API; no second copy, no extra mechanism
Origin: ai-proposed · Status: accepted · Affects: cloudflare.md "Deploy mechanics" (`deploy`, `setSecret`), SEC-REQ-003, PROV-REQ-002, D-03

An `sst deploy` (SST 4.17.2, provider 6.15.0) that updates the stage Worker — new script content, changed plain-text variables, a removed binding, also after `sst refresh` — keeps every `SECRET_<NAME>` set by `setSecret` through `PUT /accounts/{id}/workers/scripts/{name}/secrets`; the running Worker keeps the same value. The Cloudflare script-upload API itself keeps a script's existing `secret_text` bindings when a new upload does not declare them (verified with a direct upload without `keep_bindings`). So `deploy` needs nothing extra and never stores secrets. The SST transform `transform.worker: args => { args.keepBindings = ["secret_text", "secret_key"] }` was verified to deploy and may be added as an explicit guard (assumption: D-03 adds it, since it is harmless and makes the reliance visible; not required for correctness today).
Constraint: an upload that declares any binding with a secret's name replaces that secret permanently, so the framework must never pass a binding named `SECRET_*` through SST (CFG/framework variables must not use the `SECRET_` prefix). `sst remove` deletes the Worker and its secrets (expected).
Evidence: `ai/implementation/spikes/a-03/RESULT.md`, logs `s02`–`s07`, `c03`–`c17`, `r01`–`r02` (archived). Result: kept. Fallback: none needed (named fallback is the mechanism observed).

### DEC-0088 — SST runs need `NODE_USE_ENV_PROXY=1` in the sandbox (amends DEC-0083)
Origin: ai-proposed · Status: accepted · Affects: DEC-0083, plan §10.6, PROV §2 "Credentials", D-03, D-05, every cloud run

SST's own Node dynamic providers (e.g. `WorkerUrl`, used by `sst.cloudflare.Worker` with `url: true`; also `kv-data`, `worker-placement`, `zone-lookup`) call `api.cloudflare.com` with Node's global `fetch`. Without `NODE_USE_ENV_PROXY=1` that fetch bypasses `HTTPS_PROXY`, the placeholder token is not replaced, and the deploy fails with Cloudflare error 9106 "Authentication failed". The SST environment is therefore A-01's plus `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21; it prints a harmless "EnvHttpProxyAgent is experimental" warning). On an owner machine with a real token the variable is harmless.
Evidence: `ai/implementation/spikes/a-03/RESULT.md` finding 2, logs `s01` (fails), `s02` (works) (archived).

### DEC-0089 — Non-browser clients probing `workers.dev` send their own User-Agent
Origin: ai-proposed · Status: accepted · Affects: C-04 `smoke`/`connectTestStage`, compliance drivers, D-RUN

Cloudflare answers requests with the default `Python-urllib` User-Agent with 403 "error code: 1010" (not the proxy). Test and smoke clients set an explicit User-Agent.
Evidence: `ai/implementation/spikes/a-03/logs/c07-diag-403.txt` (archived).

### DEC-0090 — `stopApp`/`startApp` on Cloudflare use the script-subdomain API with `previews_enabled` pinned to false
Origin: ai-proposed · Status: accepted · Affects: DEC-0078, cloudflare.md §2 "Deploy mechanics" (`stopApp`, `startApp`), migrations.md §2 steps 1 and 6 and "Failure", D-03, MIG-AC-006

DEC-0078's assumption holds. `stopApp` is `POST /accounts/{account}/workers/scripts/{worker}/subdomain` with `{"enabled": false, "previews_enabled": false}`; `startApp` is the same call with `{"enabled": true, "previews_enabled": false}`; the state is read with `GET` on the same path. The call returns the new state synchronously. While off, the `workers.dev` URL answers HTTP 404 (`error code: 1042`). Toggling creates no Worker version or deployment: script settings, deployments and versions were identical before, while off, and after on, and the secret, a plain-text variable and a KV binding all worked after the restart.
Both fields are always sent: a body with only `{"enabled": true}` turned preview URLs on as a side effect.
Propagation observed from the sandbox: off ≤ 2.3 s, on ≤ 1.6 s (6 cycles; typically ~0.8 s; probe resolution ~0.7 s). `startApp` therefore needs no fixed wait; a caller that must see the change (tests, smoke) polls the URL for up to 30 s (assumption: simplest reasonable bound, ≫ observed; to be set as a parameter by D-03 if needed).
Evidence: `ai/implementation/spikes/a-04/RESULT.md`, logs `a01`–`a09`, `t01`–`t06a`, `c03`–`c05` (archived). Fallback: none needed (plan fallback was "ask owner").

### DEC-0091 — A deploy may itself re-enable the route; the CLI still calls `startApp` explicitly
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); the stop part superseded by DEC-0544 (a deploy leaves a stage that `stop` stopped stopped, unless `--start`) · Affects: cloudflare.md §2 (`deploy`, `startApp`), migrations.md §2 step 6, D-03

With the route off, `wrangler deploy` of a config with `workers_dev: true` turned the route back on. So a stop is not held across a deploy. This is consistent with MIG §2 step 6 (deploy, then start) and with cloudflare.md's rule that the CLI calls `startApp` explicitly after every deploy. SST's Worker (URL / `WorkersScriptSubdomain`) behaviour while the route is off was not tested here.
Assumption (taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review): no design change; D-03 verifies by test that an SST deploy followed by `startApp` leaves `enabled: true, previews_enabled: false`, and that `stopApp` is never followed by a deploy before migrations finish (MIG §2 order already guarantees this).
Evidence: `ai/implementation/spikes/a-04/logs/w05-deploy-while-off.txt`, `a09-sub-after-redeploy.txt`, `c05-get-after-redeploy.txt` (archived).

### DEC-0092 — Secret updates reach requests after a short delay
Origin: ai-proposed · Status: accepted · Affects: SEC tests (SEC-AC-001), MIG-AC-006, D-03 cloud tests

Immediately after `wrangler secret put` the Worker still served the version without the secret; a few seconds later the new version (triggered by the secret) served it. Cloud tests that set a secret and then read it poll for the expected result (bounded) instead of reading once.
Evidence: `ai/implementation/spikes/a-04/logs/c01-get-before.txt`, `c02-get-before-settled.txt` (archived).

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
Origin: ai-proposed · Status: superseded by DEC-0545 (the native export/import runs when a pre-check shows none of the failure shapes below; this copy is the fallback) · Affects: MIG-REQ-005, MIG-REQ-006 step 2, migrations.md §2 "Cloudflare" and "Fallback copy", PROV §2 `copyDatabase`, D-04

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

Evidence: `ai/implementation/spikes/a-06/RESULT.md`, `logs/`, `fallback_copy.py` (archived). Fallback applied: yes (migrations.md "Fallback copy").

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
Origin: ai-proposed · Status: superseded by DEC-0550 (one account signing token created by `setup-account`; the S3 derivation stays) (was: accepted) · Affects: FILES §2 "Cloudflare", SEC (R2 signing credentials), PROV, cloudflare.md, D-02

Provisioning creates the token through `POST /accounts/<account>/tokens` (works with the sandbox's proxy-injected token) with one policy: permission group "Workers R2 Storage Bucket Item Write" (looked up by name from `GET /accounts/<account>/tokens/permission_groups`; id at test time `2efd5506f9c8494dacb1fa10a3e7d5b6`) on resource `com.cloudflare.edge.r2.bucket.<account>_default_<bucket>` = `"*"`. S3 credentials: access key ID = token `id`; secret access key = lowercase hex SHA-256 of the token `value` (returned once; stored only as the framework-internal Worker secret, never printed). Item Write includes object reads. The token was usable immediately and refused the other bucket and ListBuckets (403 AccessDenied). Removal deletes it with `DELETE /accounts/<account>/tokens/<id>`. Assumption (simplest): one token per stage, named after the stage's resources, created by provisioning; rotation is out of scope here.
Evidence: RESULT.md "How it works", N10–N12, logs/01-setup.txt, logs/04-teardown.txt. Fallback: none needed.

### DEC-0101 — R2 omits CORS headers on 403: on Cloudflare a rejected ticket reports status null (open owner item)
Origin: ai-proposed · Status: accepted; owner item closed by DEC-0534 (owner chose option (b), 2026-10-25) · Affects: FILES-REQ-006, FILES-AC-003, client.d.ts `uploadFile`/`downloadUrl` behaviour on Cloudflare, D-02

R2 sends `Access-Control-Allow-Origin` on 200 and 404 responses but not on authentication failures (`403 SignatureDoesNotMatch`, `403 ExpiredRequest`), even for the allowed origin. In Chromium an expired or content-type-mismatched ticket therefore ends with XHR status 0 / `fetch` TypeError ("No 'Access-Control-Allow-Origin' header"), so the browser helpers can only report status null and `no response: network or cross-origin blocked`. FILES-AC-003 requires an expired ticket to fail with storage's status and `rejected by storage (HTTP n)`; that cannot be met on Cloudflare as designed. The design names no fallback.
Assumption until the owner decides (simplest, no contract change): D-02 implements tickets as in DEC-0098…DEC-0100; on Cloudflare an expired/rejected ticket yields `FILES.TRANSFER_FAILED` with status null and the `no response …` message; the evaluator records FILES-AC-003's expired-ticket clause on Cloudflare as failing with a pointer to this entry, rather than the implementation working around it. Options for the owner: (a) revise FILES-REQ-006/AC-003 to allow status null when storage's response is not readable cross-origin; (b) have the browser helper check the ticket's expiry before sending and fail as an expired ticket without a storage status (still not "storage's status"); (c) route transfers through a framework upload service (files.md §5), losing direct-to-storage transfers.
Evidence: `ai/implementation/spikes/a-07/RESULT.md` (B3, logs/03-errors.txt (archived)).

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
Evidence: `ai/implementation/spikes/a-08/RESULT.md`, `out/local.txt`, `out/remote-binding.txt` (archived),
`out/remote-http.txt` (archived). Fallback: not needed.

### DEC-0103 — sql.d.ts typing approach works; three declarations revised (contract change)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-REQ-002, SQL-REQ-003, CORE (AppDefinition.tables), docs/contracts/ts/sql.d.ts, docs/contracts/ts/index.d.ts, B-05

Spike A-09 (evidence: `ai/implementation/spikes/a-09/RESULT.md`, `revised.diff` (archived); drizzle-orm 0.45.4,
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

Integration (A-INT): adopted under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me"). `revised.diff` was
applied to `docs/contracts/ts/sql.d.ts` (now identical to the spike's `fw-revised/index.d.ts`),
`AnyTable` is exported from `docs/contracts/ts/index.d.ts`, and sql.md §2.2 describes the types. The
spike's checks, rerun against the edited contract file (drizzle-orm 0.45.4; TypeScript 5.9.3 and
6.0.3), exit 0 for the §2.3 example and for every check, with no errors in the contract under
`--skipLibCheck false`. B-05 builds on the revised contract.

### DEC-0104 — Dependency pins verified; remaining pins chosen
Origin: ai-proposed · Status: accepted · Affects: PAR-100…PAR-116, B-01, CHECK, LOCAL, COMPL

Spike A-10 (evidence: `ai/implementation/spikes/a-10/RESULT.md`, `out/` (archived)) installed PAR-100…PAR-108 at
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
Refined by DEC-0415 and DEC-0416 (the proxy is started with the dev registry turned off).

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEC-0083, DEC-0088, DEC-0084, PROV §2 "Credentials" and "Removal", plan §10.6, D-03, D-05, every cloud run

One statement of DEC-0083 as amended by DEC-0088, for implementers:
- **wrangler:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>` (the proxy injects the real token for `api.cloudflare.com`), `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, plus the sandbox's `HTTPS_PROXY`.
- **SST/Pulumi:** `CLOUDFLARE_API_TOKEN=<non-secret placeholder>`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID`, `NODE_USE_ENV_PROXY=1`, `--stage` (or `SST_STAGE`), plus `HTTPS_PROXY`.
- **Framework Node code** calling Cloudflare or `workers.dev` with `fetch`: `NODE_USE_ENV_PROXY=1` (DEC-0085).
On an owner machine the real token goes in `CLOUDFLARE_API_TOKEN` and the proxy-specific variables are harmless. Removal: `sst remove` leaves the stage's state objects (including its passphrase) in the `sst-state` bucket, so the framework's Cloudflare `remove` deletes the objects under `*/<app>/<stage>` itself and never the bucket (DEC-0084).
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Evidence: `ai/implementation/spikes/a-01/RESULT.md`, `ai/implementation/spikes/a-03/RESULT.md`.

### DEC-0108 — Offline runs use the spike's `offline.sh` wrapper
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: plan §10.2, B-17 (`verify` offline check), B-18 / C-05 exit checks, CHECK-REQ-006 runs

Plan §10.2's offline command runs `ip link set lo up`, but `ip` (iproute2) is not installed in this sandbox. Offline runs use `unshare -rn sh <dir>/offline.sh <command…>`, where `offline.sh` brings loopback up with `ip` if present and otherwise with an ioctl through `python3 -I lo-up.py`, then runs the command. Spike A-10 ran Vitest, `wrangler dev` and Playwright + Vite offline with it. The files were `ai/implementation/spikes/a-10/scripts/{offline.sh,lo-up.py}` (archived); B-01 copies both unchanged to `scripts/offline.sh` and `scripts/lo-up.py` at the repository root, and later items use that path. Unsetting `HTTPS_PROXY` or disabling TLS is still never a substitute.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Evidence: `ai/implementation/spikes/a-10/RESULT.md` "Environment", commands 3, 5, 13.

### DEC-0109 — The framework depends on `@pulumi/cloudflare` only if its code imports it
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: PAR-108, B-01 (`FW/package.json`), D-03

SST 4.17.2 installs its own `@pulumi/cloudflare` 6.15.0 (PAR-108) in `.sst/platform`, and installing the package directly pulls a newer `@pulumi/pulumi` (3.270.0) than SST's (3.215.0). So the framework declares `@pulumi/cloudflare` as a dependency, at exactly PAR-108, only if framework code imports it (for example for types or a resource SST does not wrap); otherwise it relies on SST's copy and declares nothing. PAR-108 stays the pinned version either way.
Recorded under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Evidence: `ai/implementation/spikes/a-10/RESULT.md` finding 5, command 15.

---

## Implementation phase: local and Cloudflare — phase B local foundation (2026-10-19)

These were recorded by build items B-01…B-18 (with B-16a) and test-author items B-T1…B-T4 of `ai/implementation/plan.md`, and integrated by item B-INT. All are `ai-proposed`. Where two drafts recorded the same decision they were merged into one entry (named in its last line). An entry taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue" says so in its body and shows `owner review open` (or `owner decision outstanding`) in its status line; entries without that mark are routine design choices for points the documents leave open (prompt §5).

### DEC-0110 — No `./targets/aws` subpath until the AWS phase
Origin: ai-proposed · Status: superseded by DEC-0447 (was: accepted, assumption under the owner's instruction; owner review open, plan §11 Q3) · Affects: CORE-REQ-005, CORE-AC-005, `packages/framework/package.json`

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: HTTP-REQ-002, HTTP-AC-002, SEC-REQ-002, B-10, B-16, SEC-AC-002, HTTP-REQ-007, B-03, B-04

Responses below 500 keep a `FrameworkError`'s own message (app messages such as "note limit reached", validation details); responses of 500 and above give the catalogue meaning, with the detail only in the log. HTTP cannot know secret values itself, so `createHttpParts({ secretValues: (c) => Iterable<string> })` takes them from the runtime (B-16 wires SEC: e.g. every `SECRET_*` value in the Worker env); every non-empty value is replaced by `[redacted]` in the response message and the log entry. Reason: HTTP-AC-002's "an error containing a known secret value is not echoed" covers app-thrown `FrameworkError` messages, which only redaction can meet.

B-T1's draft of the same decision ("Secret values are redacted from responses and log entries"): HTTP-REQ-007 logs the underlying error's message, while SEC-REQ-002 forbids secret values in log entries and error responses, and C-01's fixture is "a route that throws an error containing the test secret value". The tests therefore require that a known secret value (one read through `c.var.secrets` in this request or set for the test app) never appears in a response — including the message of an app-thrown 4xx `FrameworkError` — nor in any log entry, even when app code put it into an error message. The framework must redact known secret values (or not return app messages).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: LOCAL-REQ-003, core.md "Testing", cli.md `verify`, B-16, B-17, B-16 (`createTestApp`), B-17 (`verify`), core.md §2 "Testing", SQL-AC-001/-003…-006, KV-AC-001…-005

Same variable as the B-T2 suites assume (merged below), so there is one name. The dialect is read once per process from the environment variable `PROTOTYPE_FRAMEWORK_DIALECT` (`sqlite` by default, or `postgres`; anything else is `CORE.MISCONFIGURED`) and fixed after the first read. Worker bundles (local and Cloudflare) leave it unset and get SQLite; `verify` sets `postgres` for the second test-runner process. `defineTable` builds the table of that dialect when the schema module is imported, and keeps a dialect-neutral definition; `tableFor(table, dialect)` builds (and memoizes) the other dialect's table, resolving `ref`s to the same dialect, for `generate-migration` (B-07), which needs both histories from one process.

B-T2's draft of the same decision ("Framework suites select the SQL dialect with `PROTOTYPE_FRAMEWORK_DIALECT`"): core.md and local.md fix the dialect per test-runner process but name no mechanism; spike A-10 says "an env var selecting the dialect (B-16)". The suites assume the variable `PROTOTYPE_FRAMEWORK_DIALECT` with values `sqlite` (local D1) and `postgres` (PGlite), read when the framework is loaded. It is defined once in `test/integration/sql/support/dialect.ts`; if B-16 chooses another name, only that constant changes. One entry file per dialect (`*.sqlite.test.ts`, `*.postgres.test.ts`) sets it and then imports its suite dynamically, so dialect-specific tables are built after selection; Vitest's `forks` pool gives each file its own process, so `npm run test:integration` covers both dialects in one run. A harness check (not a criterion) in `sql.suites.ts` proves the selection took effect: a 101-parameter query must fail on local D1 (PAR-216, DEC-0102) and succeed on PGlite.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); the result-size check on writes superseded by DEC-0542 (a write's RETURNING rows are never refused) · Affects: SQL-REQ-002, SQL-REQ-004, SQL-REQ-006, sql.md §2.2 "Handles", "Result size", B-08, B-16

`sqliteDb(binding, options)` and `postgresDb(client, options)` return a plain frozen object with only the `PortableDb` members; `atomic`'s `WriteDb` has only `insert`/`update`/`delete`. So `batch`, `transaction`, raw `run`/`execute` and `db.query` are absent at run time as well as in the types (the portability rules remain the guard against Drizzle builder members the types hide, e.g. SQLite's `.all()`; those are not removed). Each builder made through a handle is a proxy whose `then`/`catch`/`finally`/`execute` run the query through the guard, map a driver write result without rows to `undefined` (`Array.isArray` test: Drizzle returns rows as arrays on both drivers, and a D1 result object or a PGlite result object otherwise), and check the PAR-215 size (sql.md §2.3 measure, strict "larger than"). The size is checked after the driver returns, so a write whose RETURNING rows are too large has already committed; that is the same on every target (on AWS the Data API refuses before returning, at PAR-214 > PAR-215). `atomic`'s results are measured together. B-05's `withValueRules` proxy stays underneath (row-level value rules).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-06.

### DEC-0138 — `atomic` mechanics locally
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-REQ-005, SQL-AC-005, sql.md §2.2 "atomic"

D1: steps are built on a write handle over the database, checked, then submitted with Drizzle's `db.batch` (one D1 batch, which D1 runs as one transaction). PGlite: Drizzle's `transaction`; inside it all steps are built on a write handle over the transaction (with the value rules), checked, then executed in order; any error rolls back. The check: a step's return value must be a builder made by *that call's* write handle (recorded in a per-call `WeakSet`); anything else — a builder from `c.var.sql`, one captured earlier, a promise from an `async` step — rejects with `CORE.INTERNAL` (sql.md §2.2; SQL-REQ-005 only asks for "a catalogue error", and B-T2's suite accepts any catalogue code) before anything executes. Builders made on a step's handle reject with `CORE.INTERNAL` when awaited, so an `async` step cannot execute its write outside the unit (found by the unit test: awaiting the builder inside an `async` step had executed it). A handle not made by `sqliteDb`/`postgresDb` is `CORE.INTERNAL`. Empty input resolves to `[]` without touching the database (so also without a forced-outage error). The whole call runs as one guarded operation (one PAR-210 budget).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-06.

### DEC-0139 — `containsText` SQL per dialect
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-REQ-003, sql.md §2.2, DEC-0106

No substring-position function exists in both dialects (`instr` is SQLite-only, `strpos`/`position(… in …)` Postgres-only), and Drizzle `sql` fragments cannot see the dialect while rendering, so `containsText` picks `instr(lower(col), ?) > 0` or `strpos(lower(col), $n) > 0` from the column's class (`SQLiteColumn` or not); a column always belongs to a table built for one dialect (B-05). The needle is folded in JS (A–Z only) instead of `lower(?)`, which Postgres cannot type for an untyped parameter. Relies on the harness database's C ctype for ASCII-only `lower()` on Postgres (DEC-0106); measured: `àpple` does not match `ÀPPLE` on both local dialects.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-06.

### DEC-0140 — Failure mapping, PAR-210 locally, forced outage and logging
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-REQ-006, SQL-AC-006, LOG-REQ-005, LOG-AC-005, sql.md §2.2 "Failures", B-08, B-16

- `SQL.CONFLICT`: anywhere in the error's `cause` chain (Drizzle 0.45 wraps driver errors in `DrizzleQueryError`), SQLSTATE `23505`/`23503` or a SQLite message `UNIQUE|PRIMARY KEY|FOREIGN KEY constraint failed`. The message is generic (no values or names), because 409 messages reach the client.
- `SQL.UNAVAILABLE` (local adapters): messages `PGlite is closed`, Miniflare's `poisoned stub` (binding used after `dispose`), and connection-level ones (`Network connection lost`, `ECONNREFUSED`, `ECONNRESET`, `fetch failed`); also any operation not settled within PAR-210 (45 s; the late outcome is ignored). Observed messages: unit test "a database that cannot be reached …" in `src/sql/queries.unit.test.ts`. The Data API retry loop is AWS and not built.
- Anything else from a driver: `FrameworkError("CORE.INTERNAL")` carrying the driver message and `cause` (logged; the HTTP handler returns only the catalogue meaning for status ≥ 500), so no driver error reaches app code.
- Adapter options (`SqlAdapterOptions`, exported from `src/sql/drivers.ts`): `unavailable: true` (for `createTestApp`'s `unavailable: ["sql"]`, B-16) fails every operation with `SQL.UNAVAILABLE` without running it; `budgetMs` (tests only); `log`: when given, every `SQL.UNAVAILABLE` is written once through `logFailure` (component `SQL`). KV (B-08) should create its handle without `log` and log its own `KV.UNAVAILABLE`, so a KV outage is not logged as a SQL one.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-06.

### DEC-0141 — `sum`/`avg` normalisation
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-REQ-003, sql.md §2.2

`sum(x)`/`avg(x)` are `sql\`sum(${x})\`.mapWith(toJsNumber)`: numbers pass, strings and bigints (Postgres `numeric`/`bigint`) become numbers, and an unsafe integer or non-finite value is `SQL.INVALID_VALUE`. NULL (empty or all-NULL input) stays null (Drizzle does not call the decoder for NULL). `count`/`countDistinct`/`min`/`max` stay Drizzle's (already `Number`/column-mapped).

No portable bound-parameter or statement-size limit is added (A-08, DEC-0102; PAR-216, PAR-217 are cited in sql.md "Common needs").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-06.

### DEC-0142 — Migration file layout, snapshots, checksums and record format
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: MIG-REQ-001, MIG-REQ-002, MIG-AC-001, MIG-AC-002, migrations.md §2 "Generation", "Record", B-15, B-17, D-04, DEC-0224, DEC-0236

migrations.md fixes the directories and the record columns but not file names, how drizzle-kit learns the previous schema, the `checksums.json` format or the record `id`. Chosen, simplest that meets them:
- Files: `migrations/<dialect>/<nnnn>_<slug>.sql`, same base name in both dialects, `<nnnn>` = highest existing number + 1 (4 digits), `<slug>` = `schema` unless the caller names one (lowercase snake_case). Statements joined with drizzle-kit's `--> statement-breakpoint` lines.
- drizzle-kit is driven through `drizzle-kit/api` (`generateSQLiteDrizzleJson`/`generateSQLiteMigration`, `generateDrizzleJson`/`generateMigration`), so it never prompts; no drizzle config file or `_journal.json`. The previous schema is the snapshot saved with the newest file, `<dialect>/meta/<base>.json`; a newest file without a snapshot (hand-written) makes generation fail with a message. Deleting an unapplied last pair (and its snapshots) and generating again reproduces it.
- `checksums.json`: `{ "<dialect>/<file>.sql": "<sha256 hex of the UTF-8 text>" }`, keys sorted; generation only adds entries for new files, never recomputes existing ones, and drops entries of files that no longer exist. Snapshots are not checksummed (they only steer the next generation).
- Record: `id` = `<history>/<base name>` with history `framework` or `app` (so app and framework IDs never collide and an app ID contains its file base name, as the B-T2 suites assume), `dialect` = `sqlite`/`postgres`, `checksum` = the file's SHA-256 hex, `applied_at` = epoch ms (`integer` on SQLite, `bigint` on Postgres).
- Framework tables are plain Drizzle tables in `src/mig/framework.ts` (not `defineTable`: `__framework_kv.key` is text, not a UUID): `__framework_kv(key text primary key, value text not null)`, `__framework_migrations(id text primary key, dialect, checksum, applied_at not null)`. Their history `FW/migrations/{sqlite,postgres}/0000_framework_tables.sql` (+ `checksums.json`) is produced by the same engine; a unit test fails if the shipped files differ from what the engine generates. KV (B-08) uses `frameworkTables(dialect).kv`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-07.

### DEC-0143 — The generator also refuses changes to existing columns
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: migrations.md §2 "Supported changes", CHECK-REQ-004, B-15

migrations.md requires refusing drop+add diffs (tables, or columns of one table). Besides those, the engine refuses — with a message naming the add-copy-drop pattern, before writing anything — a change to an existing column's type, nullability, default or primary key, and a NOT NULL column without a static default added to an existing table. These are exactly the unsupported changes of CHECK-REQ-004; without the refusal drizzle-kit would emit a SQLite table rebuild that D1 cannot run on referenced tables (DEC-0095) and the checker would reject anyway. The checker (B-15) still has to catch them in hand-written files (CHECK-AC-004 uses hand-written pairs). Not refused (not in the whitelist, rare, left to the checker): adding a foreign key to an existing column.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-07.

### DEC-0144 — Local reading of MIG-AC-002/-003 and in-place application
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: MIG-REQ-002, MIG-REQ-003, MIG-AC-002, MIG-AC-003 (local), migrations.md §2 "Local", B-16, B-17 (`dev`), B-07

Same reading as B-T2's draft (merged below): locally a deployment is a `dev` start (or a `createTestApp` on fresh storage) that applies pending migrations in place; there is no copy and no second database. Each pending migration is applied atomically with its record row (local D1: one `batch` prefixed with `PRAGMA defer_foreign_keys = on`, the same shape as Cloudflare's DEC-0093 request; PGlite: one transaction). On failure the applier stops, leaves the database exactly as before that migration (earlier migrations of the same run stay applied — each is its own unit, as on Cloudflare), and throws `MigrationFailedError` (migration ID, file, cause, IDs applied before it); `dev` must exit non-zero and `createTestApp` must reject. "The old app answers again" = a `dev` start with the previous sources and committed migrations serves the unchanged database. With nothing pending the applier writes nothing (no record update). Following DEC-0094, an error is not taken as proof of rollback: the record is re-read and a migration found there counts as applied. Evidence: `src/mig/apply.unit.test.ts` on local D1 (getPlatformProxy) and PGlite; a mutation that runs the D1 statements one by one instead of as one batch makes the failing-migration test fail (checked once by hand, not committed).

B-T2's draft of the same decision ("MIG-AC-002/-003 local interpretation"): Locally a "deployment" is a `dev` start: it applies pending migrations in place to the persistent local D1 database (migrations.md §2 "Local"). Hence: initial deployment = first `dev` start; second deployment with no changes = another `dev` start with the same sources, which must leave the whole database (schema, every row, the migration record including applied times) byte-for-byte equal and answer the health check and the app's routes; "neither stops the app" has no separate local meaning (local deploys are `dev` restarts) and is checked as "applies nothing". A failing deployment = `dev` exits non-zero instead of serving; "unchanged" = identical database snapshot; "no new database behind" = exactly one local D1 database file; "the old app answers again" = `dev` with version 2's sources and committed migrations serves the unchanged data; the re-run path tested is "after correcting the data". `dev`'s address is the first `http://localhost:<port>` it prints (LOCAL-REQ-004) on which `/api/__framework/health` answers 204; `dev` is stopped with SIGINT to its process group. The database is read from Miniflare's SQLite file under `.wrangler/state/**/d1/` after `dev` stops (Node's `node:sqlite`). These criteria are not run on PGlite: `dev` uses local D1 only, and PGlite exists only in test processes with fresh storage.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Items: B-07, B-T2 (drafts merged).

### DEC-0145 — No checksum or order check when applying locally
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: MIG-REQ-001, B-15, B-17

The local applier does not compare recorded checksums with the files, and does not refuse a pending file that sorts before an applied one: `verify`'s migration checker (B-15) owns edit detection, and local data is disposable (`reset-local`). Recorded migrations whose files are missing (e.g. a newer version's migrations after switching back to old sources) are ignored.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-07.

### DEC-0146 — Empty values are accepted (KV-REQ-002 over KV-AC-002) — open owner item
Origin: ai-proposed · Status: accepted; owner item closed by DEC-0538 ("empty is ok", 2026-10-25; KV-AC-002 drops "and values" from its "Empty" clause) · Affects: KV-REQ-002, KV-AC-002, kv.md §2, DEC-0225

**Conflict, for the owner.** KV-AC-002 says "Empty, oversized, and malformed keys **and values** are rejected with the specified codes". KV-REQ-002 rejects only empty keys ("Keys MUST be non-empty …"); for values it names only malformed text (`KV.INVALID_KEY`) and more than PAR-223 bytes (`KV.VALUE_TOO_LARGE`), and the catalogue has no code meaning "empty value" (`KV.VALUE_TOO_LARGE` is "exceeds the KV value size limit"). The criterion's "empty … values" clause therefore has no specified code to be rejected with. Chosen: the requirement wins (binding, CONVENTIONS); `put(k, "")` stores the empty string and `get(k)` returns `""` (not null), as the B-T2 suite expects (DEC-0225). Neither the requirement nor the criterion text was edited. **Open owner question:** either drop "and values" from KV-AC-002's "Empty" clause, or add an empty-value rule (and a code) to KV-REQ-002.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-08.

### DEC-0147 — Prefix rules: empty prefix lists every key; over PAR-220 bytes rejected
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: KV-REQ-001, KV-REQ-002, kv.md §2

KV-REQ-002 requires prefixes to be well-formed but gives no length rule; the catalogue's `KV.INVALID_KEY` meaning ("Key or prefix is empty, malformed, or too long") is read as describing the code's cases jointly, not as a requirement that prefixes be non-empty. Chosen: a prefix is well-formed text of at most PAR-220 bytes (a longer prefix can match no key, and the B-T2 suite expects `KV.INVALID_KEY`), else `KV.INVALID_KEY`; the empty prefix is allowed and lists every key (simplest; "keys starting with the prefix").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-08.

### DEC-0148 — `limit` is clamped, not rejected
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: KV-REQ-003, kv.d.ts `KvListOptions.limit`, kv.md §2

No catalogue code exists for a bad page size, and kv.d.ts only names a default and a maximum. Chosen: absent or non-finite → PAR-221; otherwise `floor`, clamped to 1…PAR-222.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-08.

### DEC-0149 — KV's own SQL handle and failure mapping (KV-REQ-005, LOG-REQ-005)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: KV-REQ-005, KV-AC-005, LOG-REQ-005, kv.md §2, DEC-0140, B-16

`createKv(db, { log })` (`src/kv/service.ts`) takes a handle made by `sqliteDb`/`postgresDb`. B-16 must build that handle **separately from `c.var.sql`'s**: same binding/client, with `unavailable` set when `createTestApp`'s `unavailable` contains `"sql"` **or** `"kv"`, the same `budgetMs`, and **no `log`**; and pass the request's log to `createKv`. Then: `SQL.UNAVAILABLE` (forced, PAR-210 budget, unreachable database) becomes `KV.UNAVAILABLE` with the SQL error as `cause`, written once via `logFailure` (component `KV`; the HTTP handler's later `logFailure` of the same object writes nothing), so no `SQL` entry appears for a KV outage. Any other `SQL.*` code (e.g. `SQL.RESULT_TOO_LARGE`, which the PAR choices make impossible) is a framework fault and becomes `CORE.INTERNAL`, so no SQL code surfaces from KV. `KV.*` and `CORE.*` errors pass unchanged. Evidence: `src/kv/service.unit.test.ts` ("storage that cannot be used": forced outage and a closed database, both dialects).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-08.

### DEC-0150 — Cursor form; one extra row per page
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: KV-REQ-003, KV-AC-003, KV-AC-005, kv.md §2

The cursor is base64url (no padding) of UTF-8 JSON `[prefix, lastKey]`; decoding requires the canonical re-encoding to match, so an altered cursor (e.g. a character appended) is `KV.INVALID_CURSOR`. Not signed: a forged cursor can only skip ahead within its own prefix, which exposes nothing. Each page query fetches `limit + 1` rows so `nextCursor` is null exactly when nothing remains (kv.d.ts), in one query; a maximum page plus one row is 51 × (1,024 + 4,096) = 261,120 bytes ≤ PAR-215 (262,144). If PAR-220/222/223 grow, that margin must be rechecked (the unit test "a maximum page of maximum-size entries" fetches exactly this case on both dialects).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted; "Order" amended on Cloudflare by DEC-0430 (stored keys end in U+0001) · Affects: FILES-REQ-001, FILES-AC-001, PAR-231, PAR-232

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
Origin: ai-proposed · Status: accepted; owner item (plan §11 Q7) closed by DEC-0536 ("rejected before sending" is an official class, 2026-10-25) · Affects: FILES-REQ-003, FILES-REQ-006, client.d.ts, FILES-AC-003, FILES-AC-006

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
Origin: ai-proposed · Status: accepted; its last two sentences (login with the mock and no real provider) superseded by DEC-0516 (the password provider is installed on every stage, so `/api/auth/login` always goes to the sign-in page) · Affects: AUTH-REQ-009, CORE-REQ-006, AUTH-AC-009, B-16

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-001, CHECK-REQ-006, check.md §2, B-17

`runPortabilityRules(appDir)` (`./check`) lints every `.ts/.tsx/.mts/.cts` file under `src/` and `tests/` with ESLint (PAR-111) using only the shipped configuration (`overrideConfigFile: true`, `allowInlineConfig: false`). Type information comes from a TypeScript program the engine creates with fixed app-lib-set options (`APP_COMPILER_OPTIONS`, identical to `tsconfig.app.json`), not from the app's `tsconfig.json`. Type errors never stop the rules, so `verify` can print both the type errors and the rule diagnostics (DEC-0238: `node:fs`, `.transaction()`, `db.query` fail both). B-17 should type-check with the same `APP_COMPILER_OPTIONS`, print `formatDiagnostics(...)`, and fail when either step reports anything. Rules resolve every reference through the type checker to its declaration (aliases, local re-exports, namespace imports, `const` copies) and classify declarations by the package that declares them (framework package root, `drizzle-orm`, `hono`, TypeScript lib files); framework declarations are recognised both in the workspace and under `node_modules`. Files under `src/` but outside `client/`, `shared/`, `server/` (e.g. `src/vite-env.d.ts`) are treated as server code; files outside `src/` and `tests/` are not app code. Only TypeScript files are app code.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-14.

### DEC-0180 — What each rule rejects (readings of check.md §1)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); the `allowed-imports` reading amended by DEC-0554 (the deny list also applies to the installed dependency tree and the Worker bundle, and names `cloudflare` and `googleapis`) · Affects: CHECK-REQ-001, SQL-REQ-002, CORE-REQ-005, CORE-REQ-007, check.md §2

Listed per rule in check.md §2 "What each rule takes as its construct". Readings worth review:
- `allowed-imports` uses a fixed deny list for platform SDKs and drivers (Cloudflare, AWS, SST, Pulumi, Vercel, Netlify, Google Cloud, Azure, PGlite, pg, postgres, mysql, SQLite drivers, libSQL, Neon, PlanetScale, drizzle-kit, Prisma, Kysely, Knex, TypeORM, Sequelize, MongoDB, Redis) plus every `scheme:` specifier; other npm packages are allowed. `drizzle-orm` (root) is allowed by this rule; its non-portable names are the SQL rules'. Framework subpaths follow CORE-REQ-005 literally: server code `.` only (not `./client`), tests `.` and `./testing`, shared code nothing; browser framework imports are `browser-api-only`'s. Browser code may not import server or test code even type-only; server code may not import browser or test code.
- `no-dialect-features` rejects all Drizzle SQL expressions and functions (`drizzle-orm/sql/**`) the framework does not re-export, rather than a named list; set operations (`union`, …), cross and lateral joins are rejected as "not supported" though sql.md §2.3 names only right/full joins; `groupBy` and `having` are not rejected. `min`/`max` accept `id()`/`ref()` columns (text values).
- `framework-ids` is narrow: only literal, template, call and `new` values (also through `const`) are traced; parameters and properties pass (SQL-REQ-004's run-time check covers the rest).
- `app-error-codes` judges the code by its type, so a parameter typed `ErrorCode` fails; `AUTH.UNAUTHORIZED` is rejected (not in CORE-REQ-007's table).
- `no-env-access` also covers `const { env } = process` and Hono `onError`/`notFound` by type.
- CHECK-REQ-002 "unchecked type assertions" includes non-null assertions (`x!`).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25. The risk of a fixed list (a denied SDK arriving inside an ordinary package) is reduced by DEC-0554.
Item: B-14.

### DEC-0181 — Skill reference file names
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-003, CHECK-AC-003, SKILL-REQ-002, E-01, E-02

`src/check/references.ts` fixes the names under `skill/reference/`: `http-and-validation.md`, `sql-and-migrations.md`, `kv.md`, `files.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `local-development.md`, `deploying.md`, `testing.md`, `troubleshooting.md`, `owner-tasks.md` (skill.md §2 topics, plus the owner tasks E-02 writes). Rule → reference: `allowed-imports`, `browser-api-only`, `app-error-codes`, `no-raw-html` → `http-and-validation.md`; `no-env-access` → `configuration.md`; the six SQL rules → `sql-and-migrations.md`; type-escape bans, `no-suppression-comments` and anything else → `troubleshooting.md`. E-01/E-02 must create exactly these files; CHECK-AC-003 passes only once they exist.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-14.

### DEC-0182 — Raw-HTML sinks and suppression comments are framework rules
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-001 (last paragraph), CHECK-REQ-002, check.md §2

check.md §2 suggests "existing lint rules (for example `no-unsanitized`)". No such plugin is pinned in parameters.md and B-14 owns no `package.json`, so the shipped configuration uses its own `prototype-framework/no-raw-html` (browser code only; DOM sinks and React's `dangerouslySetInnerHTML`). Likewise `prototype-framework/no-suppression-comments` bans `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` and ESLint directive comments (typescript-eslint's `ban-ts-comment` was dropped because its `@ts-ignore` message recommends `@ts-expect-error`, which is banned too). Type escapes otherwise use typescript-eslint (PAR-111) `no-explicit-any`, `consistent-type-assertions` (`never`; `as const` stays allowed) and `no-non-null-assertion`. The rules import `@typescript-eslint/utils` types only (a dependency of the pinned `typescript-eslint`, same version); B-INT may declare it explicitly.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-14.

### DEC-0183 — Detecting app configurations that weaken framework rules
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-006, CHECK-AC-006, B-17

`checkAppLintConfig(appDir)` (also run by `runPortabilityRules`) imports the app's `eslint.config.{js,mjs,cjs,ts,mts,cts}` (default export, nested arrays flattened) and reports, as a diagnostic on that file naming the rule, every entry that sets a shipped rule to a lower severity than `error` or to different options; a plugin registered under another namespace with `meta.name: "prototype-framework"` is followed. A file that fails to load is itself a failure (rule `prototype-framework/lint-config`). `ignores` patterns and other settings of the app file are not inspected, because `verify` never uses that file for its rules.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-14.

### DEC-0184 — Supported changes are judged by each migration's schema effect, not its statements
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-004, CHECK-AC-004, MIG-REQ-001, MIG-REQ-003, migrations.md §2 "Supported changes", check.md §2

The checker applies the app history one migration at a time (framework history first, through MIG's `applyMigrations`, the same path as `dev`/`createTestApp`) to fresh local D1 (getPlatformProxy, not persisted, temporary config) and PGlite, introspects the schema after each, and diffs consecutive states per dialect. Supported: add or drop a table; add a column that is nullable or has a static default; drop a column (with its references); add or drop an index or a unique constraint. Rejected, each with a message naming the add-copy-drop pattern: a table removed and another added in one migration (rename); a column removed and another added in the same table in one migration (rename); a NOT NULL column without a default added to an existing table; a change to an existing column's type, nullability, default or primary key; a reference added to, or removed from, a column that is kept. A statement diff was rejected because drizzle-kit itself writes a supported change — dropping a `ref()` column on SQLite — as a table rebuild (`PRAGMA`, `CREATE TABLE __new_…`, `INSERT … SELECT`, `RENAME`), observed with the B-07 generator. In addition, statements that change data (`INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `TRUNCATE`, `MERGE`) are rejected, except drizzle-kit's rebuild copy `INSERT INTO __new_<t> (…) SELECT …`. A migration that fails to apply on a fresh database is reported with the database error (`migration-apply`) and that dialect's later migrations are not judged; e.g. SQLite cannot add a NOT NULL column without a default at all, so that case shows as `migration-apply` on SQLite and `migration-supported-changes` on Postgres.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-15.

### DEC-0185 — "Same logical schema": what is compared, and when
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-004, MIG-REQ-001, check.md §2

Per table: columns by SQL name with declared type, nullability, static default and primary key; non-unique indexes and unique column sets (unique constraints and unique indexes alike, by ordered column list, names ignored); references (`cols -> table(cols)` with update/delete actions). Declared types are compared by SQLite storage class (`integer` ≡ `integer`/`bigint`/`smallint`/`boolean`; `real` ≡ `real`/`double precision`/`numeric`; `text` ≡ `text`), since SQLite has no boolean or bigint; a Postgres `boolean` therefore matches any SQLite `integer`. Defaults are compared as SQL text after removing Postgres casts and wrapping parentheses (and unquoting quoted numbers of non-text columns). Framework tables are included. When both histories have the same file names, the dialects are compared after each pair and only the first diverging pair is reported (later pairs inherit it); otherwise only the final schemas are compared, when both histories applied completely.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-15.

### DEC-0186 — Checksums, layout and order
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-004, MIG-REQ-001, DEC-0142, DEC-0145

The local applier checks neither checksums nor order (DEC-0145), so the checker does, offline: every `migrations/<dialect>/*.sql` must have its SHA-256 recorded in `migrations/checksums.json` (missing entry: "not made by generate-migration"; different: "edited after it was generated"); every entry must name an existing file (a deleted, possibly applied migration); `checksums.json` must exist and be a JSON object when there are migrations. Layout: names `<nnnn>_<slug>.sql`; numbers 0000, 0001, … without gaps or repeats per dialect; the same base names in both dialects. Since checksums are keyed by file name, renumbering or inserting a file before applied ones is caught by numbering or by missing entries. The checker cannot know which migrations a cloud stage has applied; it does not compare migrations with the current table definitions (not required by CHECK-REQ-004).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-15.

### DEC-0187 — Diagnostics
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-003, CHECK-REQ-004, B-17

Diagnostics are `CheckDiagnostic`s (same layout through `formatDiagnostics`), located at line 1, column 1 of the migration file (or `migrations/checksums.json`), with rule IDs `prototype-framework/migration-checksums`, `-history`, `-apply`, `-supported-changes`, `-dialects` (`MIGRATION_CHECKS`) and reference `skill/reference/sql-and-migrations.md`. A dialect mismatch is reported once, on the SQLite file of the pair, naming both files and every difference (e.g. `column records.extra exists in postgres but not in sqlite`). These rule IDs are not ESLint rules and are not in `RULE_NAMES`/the shipped config.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-15.

### DEC-0188 — Build output layout and how the app module is loaded
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-REQ-002, cli.md §2, local.md §2, B-17, D-03, DEC-0214, DEC-0218, DEC-0240

`buildApp({ appDir, target, stage })` (`src/build/build.ts`) writes `<app>/.framework/<target>/{config.mjs, entry.mjs, worker.js}` (plus `wrangler.jsonc` locally), deleting the directory first. `config.mjs` is CFG's generated module; `entry.mjs` imports `../../src/app.ts`, `./config.mjs` and `<package>/targets/<target>`; `worker.js` is the esbuild bundle of the entry (ESM, minified, no legal comments, conditions `workerd`/`worker`/`browser`). `src/app.ts` must export the `defineApp` result as `default` or as `app`. To read the definition at build time (name, config declaration, secrets), `loadApp` bundles `src/app.ts` with esbuild for Node, keeping every import from outside the app directory external (so the app shares the caller's framework instance), imports it from `.framework/.load/` and deletes the file. Build failures are `CORE.MISCONFIGURED` with the components' messages (app/stage name rules, every values-file problem, secret declarations).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16.

### DEC-0189 — Mock and local-only code are excluded by the entry, not by flags
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); its Google sentence ("A production stage uses the Google provider …") superseded by DEC-0513, DEC-0509 · Affects: CORE-REQ-006, PROV-REQ-005, AUTH-REQ-009, CORE-AC-006, PROV-AC-005

`./targets/cloudflare` exports `createCloudflareWorker(app, config, { mock? })` and re-exports `createAuthMock`; only a test-stage entry imports and passes it. `./targets/local` (`createLocalWorker`) is the only runtime that imports the local ticket issuer, the transfer route and the mock unconditionally. The bundler marks framework modules (paths inside the package) `sideEffects: false`, so a module that only the runtime re-exports (the mock) leaves no code at all in a production bundle; `BundleResult.modules` lists only modules that contribute bytes. Not built here (phase D): the R2 log writer (D-01; until then Cloudflare entries print marked lines like local) and the SigV4 ticket signer (D-02; until then `createUploadTicket`/`createDownloadTicket` on Cloudflare fail with `CORE.MISCONFIGURED`). A production stage uses the Google provider; a test stage uses the mock, plus Google only when `framework.google` is configured.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16.

### DEC-0190 — Worker bindings, variables and the local Wrangler configuration
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: cloudflare.md §2 "Worker settings", config.md §2 "Delivery", B-17 (`dev`), D-01, D-03

Binding names: D1 `DB`, R2 `FILES`; Worker variable `FRAMEWORK_PUBLIC_ORIGIN` holds the stage's public origin (the only provisioning-derived value read in this phase; read per request, `CORE.MISCONFIGURED` when absent). Secrets are `SECRET_<NAME>` in `env` (SEC-REQ-003); every such value is redacted from responses and log entries. The local `wrangler.jsonc` is `{ name: "<app>-local", main: "worker.js", compatibility_date: "2026-10-01", d1_databases: [DB], r2_buckets: [FILES] }` with placeholder IDs; it sets no `vars` and no persist path. **For B-17:** `dev` must pass `FRAMEWORK_PUBLIC_ORIGIN=http://localhost:<vite port>` (e.g. `--var`), point Wrangler's state at `<app>/.wrangler/state` (`--persist-to`, B-T2 reads it there) and at `<app>/.dev.vars` (Wrangler reads `.dev.vars` beside the config file, which is under `.framework/local/`), and apply migrations to that state (MIG `migrateLocal` through `getPlatformProxy` with the same config and persist path) before starting Wrangler. The compatibility date is a constant in `src/build/build.ts`; no parameter was added.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16.

### DEC-0191 — Node-only imports of shared modules are replaced in Worker bundles
Origin: ai-proposed · Status: superseded by DEC-0197 · Affects: CF-REQ-003, CF-AC-003, CORE-AC-006, SQL (`sql/drivers.ts`), MIG (`mig/framework.ts`)

Two shared modules that Worker runtimes need import Node-only code at module scope: `sql/drivers.ts` imports PGlite (`@electric-sql/pglite`, `drizzle-orm/pglite`) and `mig/framework.ts` uses `node:url` with `import.meta.url` (KV imports it for the KV table). The bundler resolves those three specifiers to stand-in modules that throw if called, and defines `import.meta.url` as a fixed string, so no Node module and no Postgres harness code is in a Worker bundle, and the Worker needs no `nodejs_compat` flag. Verified: `src/build/build.unit.test.ts` (module list and import scan) and a local bundle answering requests in workerd (`unstable_startWorker`). The clean fix is in those components (see "Changes requested from other items"); once made, the stand-ins can go.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-16.

### DEC-0192 — `createTestApp` migrations: committed ones from the working directory, else generated
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: testing.d.ts ("migrations applied"), B-17 (`verify`), B-16, B-07

`createTestApp` applies the framework history, then the app's: `<cwd>/migrations/` when it holds a `<dialect>/` directory (app tests run from the app root, as `verify` runs them), otherwise — when the app has tables — a history generated once per process and app definition from the table definitions by MIG's own generator into a temporary directory. So in-process tests of apps without committed migrations (the framework's own suites) still get their tables, and app tests exercise the committed files.

B-T2's draft of the same decision ("`createTestApp` applies the app's generated migrations from the working directory"): `createTestApp(app)` receives only the `DefinedApp`; the simplest reading of "fresh local storage, migrations applied" with `verify` running tests from the app root is that it applies the framework migrations and then the app's committed `migrations/<dialect>/` found from `process.cwd()`. The SQL suites therefore write a scratch app with the same tables (`sql/fixtures/schema.ts`, defined through an injected framework module so test process and CLI share one definition), run `generate-migration` there, and `chdir` into it for the test process. If `createTestApp` instead builds the schema from the definitions, the generated files are simply unused. The KV suites need no app tables and do not change directory.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Items: B-16, B-T2 (drafts merged).

### DEC-0193 — `createTestApp` behaviour the contract leaves open
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: testing.d.ts (contract changed: `logWriter`, `framework` key, `as` with the stub), DEC-0210, DEC-0226, DEC-0229

- Deployment `{ app: <definition name>, stage: "local", target: "local" }`; name rules apply (a bad name rejects with `CORE.MISCONFIGURED`); declared secret names are checked as in a build.
- `config`: the reserved key `framework` is the values file's `framework` section; all other keys are values. Both go through CFG's schema validation and resolution, so an undeclared key, a wrong type or a missing value without default rejects. The object is copied: later mutation has no effect (each call is one build).
- Secrets: `secrets` maps logical names to `SECRET_<NAME>`; fresh random `frameworkSessionKey` and `frameworkLocalTicketKey` values per test app. `unavailable: ["secrets"]` makes the app's reader fail (`SEC.UNAVAILABLE`); framework secrets keep working.
- `unavailable`: `sql` → the app's handle and KV's handle are forced unavailable; `kv` → KV's handle only (`KV.UNAVAILABLE`, no `SQL` entry); `files` → a store whose every operation rejects (`FILES.UNAVAILABLE`).
- `logWriter: "failing" | "never-completing"` (added to the contract) uses LOG's `failingSink()` / `neverCompletingSink()`; `logs()` is then empty. Otherwise the memory sink, which echoes `error` entries to stderr.
- Public origin `http://localhost:8787`. `request(path)` resolves `path` against it, adds `Origin` to state-changing requests unless `init` has one, and sends the `loginWithStub` session unless `init` sets `Cookie`; no other response cookie is kept (tests that follow the login steps by hand pass cookies explicitly).
- Without `stubLoginProvider`: the mock is installed and `user`/`as()` are its fixed identity per request (no `user` → the session decides). With it: the stub provider and no mock (no mock-login route); `user` rejects and `as()` throws, since both need the mock. `loginWithStub` requests `/api/auth/login`, passes the `Location` through `stubCallbackUrl`, requests the callback with the transaction cookie, and keeps the `session_local` cookie; if none is set (a stub failure) it rejects with the redirect it got.
- `dispose()` closes PGlite and the platform proxy; later requests reject.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16.

### DEC-0194 — The local ticket key's name lives in a local-only SEC module
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-REQ-006, CORE-AC-006, secrets.md §2, DEC-0189, DEC-0193

`FRAMEWORK_SECRETS` (`src/secrets/names.ts`, in every cloud bundle) no longer holds `localTicketKey`. `src/secrets/local-names.ts` holds `LOCAL_TICKET_KEY`, `LOCAL_FRAMEWORK_SECRETS` and `DEV_GENERATED_SECRETS`; it is imported only by the local runtime, `createTestApp`, `secrets set` and the `.dev.vars` store. `FrameworkSecretName` still includes the local name as a type. `createFrameworkSecrets({ read, log, extra })` makes `extra` names readable besides `FRAMEWORK_SECRETS`; the stage runtime passes its target's `requiredFrameworkSecrets` as `extra` (a secret the health check requires is one framework code reads), so the local target adds the ticket key without the shared runtime naming it. `secrets set` still accepts `frameworkLocalTicketKey`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16a.

### DEC-0195 — The local cookie settings are passed in by the local runtime
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: LOCAL-REQ-004, LOCAL-AC-004, AUTH-REQ-006, auth.md §2 "Session cookie"

`src/auth/local-cookies.ts` holds `LOCAL_COOKIES` (`session_local`, `login_local`, not Secure); `src/auth/cookies.ts` holds only `CLOUD_COOKIES`. `cookieSettings(target, settings = CLOUD_COOKIES)` and `AuthOptions.cookies` / `StageOptions.cookies` now take a `CookieSettings` object instead of a `"local" | "cloud"` mode; non-Secure settings on any non-local target are still CORE.MISCONFIGURED. Assumption: without settings every target, the local one included, gets the cloud settings (the safe direction); the local runtime and `createTestApp` always pass `LOCAL_COOKIES`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16a.

### DEC-0196 — SQL drivers split into a D1 module and a Node-only Postgres harness module
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-REQ-006, CF-REQ-003, SQL-REQ-006, sql.md §2 "Local drivers", DEC-0191

`src/sql/drivers.ts` is replaced by `src/sql/d1.ts` (`sqliteDb`, `SqlAdapterOptions`; Workers-compatible) and `src/sql/postgres.ts` (`postgresDb`, `openPostgres`, `POSTGRES_DATABASE`; Node only). The guard's built-in unreachable pattern no longer names PGlite; `GuardOptions.unreachable` / `normalizeError(…, unreachable)` take a driver's extra patterns, and `postgresDb` passes `/PGlite is closed/i`. Unit test: a query on a closed harness database is `SQL.UNAVAILABLE` (`src/sql/postgres.unit.test.ts`).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16a.

### DEC-0197 — The framework migrations directory moves to a Node-only MIG module; bundler stand-ins removed
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CF-REQ-003, CF-AC-003, DEC-0191

`FRAMEWORK_MIGRATIONS_DIR` moves from `src/mig/framework.ts` to `src/mig/migrations-dir.ts`, so `framework.ts` (imported by KV and the stage runtime) uses no `node:url` or `import.meta.url`. With 3 and 4, `src/build/bundle.ts` no longer replaces `@electric-sql/pglite`, `drizzle-orm/pglite` or `node:url` and no longer defines `import.meta.url`; a Node built-in reaching a Worker bundle now fails the build (esbuild cannot resolve it for the browser platform). DEC-0191 is superseded.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16a.

### DEC-0198 — The diagnostics count line names each kind of problem
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-003, CHECK-REQ-004, check.md §2 "Diagnostics", B-17

`formatDiagnostics` ends with `<n> portability problem(s)`, `<n> migration problem(s)` (rules in `MIGRATION_CHECKS`), or both joined by `, ` (portability first). No test pinned the wording (B-T4 and the integration suites do not match the count line; the B-14 unit test's `2 portability problems` still holds).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-16a.

### DEC-0199 — Command table, exit statuses, commands of later items
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CLI-REQ-001, CLI-REQ-003, CLI-REQ-004, cli.md §2

Every CLI-REQ-001 command is registered in `src/cli/main.ts`. Exit 0 = success, 1 = failure, 2 = usage error. `deploy`, `remove`, `setup-account`, `certify-auth`, `smoke` and `secrets set --target cloudflare` exit 1 with "not available yet: it requires …" naming the work item (C-04, D-05); D-05 replaces the bindings. Failures print the error's message only. Usage messages never repeat an unexpected argument (a secret typed by mistake is never echoed); `secrets set` prints the name and `SECRET_<NAME>` location only after the name was checked against the declared names, and does not print the stage argument.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0200 — `reset-local` removes `.wrangler/` and `.logs/`, keeps `.dev.vars`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: LOCAL-REQ-002, LOCAL-AC-002

"Local state" = local D1 (SQL, KV) and R2 under `.wrangler/`, and the local log. `.dev.vars` holds secrets the owner set with `secrets set`; clearing it would lose them, and `dev` regenerates only the framework's dev keys. `.framework/` is build output, not state.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0201 — `verify` runs every step and reports all of them
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CLI-REQ-002, CLI-AC-002, DEC-0238

Order: type check, portability rules, migration checker, zod version, tests (sqlite), tests (postgres). Tests run even when a static step failed, so one run shows every problem. Diagnostics use CHECK's one-line layout (`file:line:col  error  message  rule  (read reference)`; type errors carry `TSnnnn` as the rule). No clock times or durations are printed; failing and skipped tests are listed sorted by file and name and passing tests are only counted (a line naming a file is read as a diagnostic about it, DEC-0237), so two runs on the same app print identical text (checked offline on the template: CLI-AC-002 "two consecutive runs"). A dialect run with no passing test fails ("no tests ran"); a test file that fails to load, an unhandled error, or a runner crash fails the run.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0202 — `verify`'s type check and zod check
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK §2, CHECK-AC-001, CLI-REQ-002

The type check uses `APP_COMPILER_OPTIONS` over the same files the rules lint (`src/`, `tests/`), never the app's `tsconfig.json`. `src/` and `tests/` are checked in separate programs: test files import Vitest, whose declarations reference Node's types, which would otherwise make `Buffer` type-check in server code. The zod check reads `node_modules/zod/package.json` resolved upwards from the app (Node's resolution) and compares with PAR-112 (`ZOD_VERSION`, unit-tested equal to the framework's own `zod` dependency); a missing zod fails.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0203 — `verify`'s test runs: Vitest Node API in a child per dialect, framework options only
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CLI-REQ-002, LOCAL-REQ-003, PAR-116, CHECK-REQ-006

Each dialect runs `dist/cli/verify/test-runner-child.js` in its own process with `PROTOTYPE_FRAMEWORK_DIALECT` set; the child calls Vitest's `startVitest` with `config: false`, root = app, include = PAR-116 glob, no file-system module cache, silent, 60 s test and hook timeouts (opening PGlite the first time takes over 5 s; same values as the template's `vitest.config.ts`), and writes a summary JSON the parent formats. The app's Vitest configuration is not read, like the lint configuration (the app cannot narrow which tests run). If an app needs Vitest settings beyond these, that is a framework change.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0204 — `dev` process layout
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: local.md §2, LOCAL-REQ-002, LOCAL-REQ-004, LOG-REQ-003, MIG-REQ-003, CFG-AC-003, DEC-0190

`dev` builds for target `local`, stage `local`; runs `ensureDevSecrets`; applies migrations with `migrateLocal(d1MigrationDatabase(DB), <app>/migrations)` through `getPlatformProxy({ configPath: .framework/local/wrangler.jsonc, persist: { path: <app>/.wrangler/state/v3 } })` — the same database file `wrangler dev --persist-to <app>/.wrangler/state` uses; a `MigrationFailedError` exits 1 before serving. Ports are free loopback ports picked at start (refined by DEC-0417: no port is picked before its bind; Vite starts first on port 0, then Wrangler on port 0). Wrangler is a child process (`--ip 127.0.0.1`, inspector on 127.0.0.1, `--env-file <app>/.dev.vars`, `--var FRAMEWORK_PUBLIC_ORIGIN:http://localhost:<vite port>`, `--local`, metrics off); its stdout and stderr go through LOG's `createLogCapture` into `.logs/<UTC day>.log`, other lines to stderr prefixed `[wrangler]`. Vite runs in the CLI process with no app configuration file (`configFile: false`; the generated configuration cannot widen the host), on 127.0.0.1, `appType: "spa"` (deep links get the entry page), `/api` proxied to Wrangler without changing `Host`, cache in `.framework/vite`, and a first middleware that answers 403 unless `Host` is exactly `localhost:<port>`. The client root is the app root when it has `index.html`, else `src/client/`. `dev` prints `http://localhost:<port>/` after both are serving, does not rebuild while running, and on SIGINT/SIGTERM closes Vite, stops Wrangler and exits 0; Wrangler ending on its own exits 1. Wrangler's own port answers any `Host`; it is loopback-only and not printed (the Host check is enforced on the one printed origin).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-17.

### DEC-0205 — Root `npm run verify`
Origin: ai-proposed · Status: superseded by DEC-0242 · Affects: plan §10.1, B-17 task line

`npm run build -w packages/framework && npm run typecheck && npm run test:unit && npm --workspace apps/template run verify`. Framework lint is not included: the root `lint` script is still a stub (not owned by B-17) and fails by design; `apps/reference` is added by C-01 when it exists.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: B-17.

### DEC-0206 — What the template contains, one use per capability
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-REQ-004, skill.md §2 "The template", cli.md §2 "App layout", CHECK-AC-005, E-02, C-05

`apps/template` (app name `template`) is a notes app: config key `greeting` (`GET /api/hello`, anonymous); SQL table `notes` (`GET`/`POST /api/notes`, user's own rows, `requireUser`); a log entry per created note (component `notes`); KV status line per user (`GET`/`PUT /api/status`); files in `users/<id>/` via upload/download tickets (`GET /api/files`, `POST /api/files/{upload,download}-ticket`); one secret `apiKey`, checked (never returned) by an admin-only route (`GET /api/admin/secret`, `requireAdmin`). One route module per capability in `src/server/routes/`, each taking `Hono<Env>`; `src/server/env.ts` exactly as skill.md §2. The browser part is `index.html` at the app root (the Vite root, as in B-T4's base fixture) plus `src/client/main.ts` and one page module per capability under `src/client/pages/`, built with `textContent` only. `src/shared/types.ts` holds only types: the portability rules let browser code import shared code type-only (DEC-0180), so input limits live in the server's Zod schemas only. `config/local.json` and `config/cloudflare/test.json` set no values (the greeting has a default) and an empty `framework` section. Only `.`, `./client` and `./testing` are imported; nothing names a target.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-18.

### DEC-0207 — The smoke file picks its mode through the test runner's provided context
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CLI-AC-005, skill.md §2 "Testing", testing.d.ts `connectTestStage`, C-04

`tests/smoke/smoke.test.ts` calls `connectTestStage()` when Vitest's `inject("prototypeFrameworkSmoke")` is `true`, and `createTestApp(app, …)` otherwise (so it runs in-process under `verify`). App code may not read `process.env` or `import.meta.env` (`no-env-access`), and the contract has no other switch, so the runner's provided context (PAR-116 is Vitest) is the simplest target-neutral signal. **For C-04:** `smoke` must run Vitest with `provide: { prototypeFrameworkSmoke: true }` on `tests/smoke/**`. If C-04 prefers another mechanism, only this file changes. The smoke checks avoid `logs()` (throws on a connected stage) and use a fresh random mock user per run, so they also pass on a stage that keeps data.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-18.

### DEC-0208 — Committed migrations generated with MIG's generator; app test timeouts
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: MIG-REQ-001, CLI-REQ-002, B-17

The CLI was not merged, so `migrations/` (`0000_schema` pair, snapshots, `checksums.json`) was generated by calling MIG's `generateAppMigrations` on the loaded app (the engine `generate-migration` uses); the migration checker reports nothing. `vitest.config.ts` keeps the PAR-116 glob and raises test and hook timeouts to 60 s, because the first PGlite open in a Postgres-dialect process takes over 5 s (observed: the first test timed out at the default). **For B-17:** `verify`'s test runs must either use the app's `vitest.config.ts` or apply an equivalent timeout themselves.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-18.

### DEC-0209 — The template imports `hono` types without declaring `hono`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: skill.md §2 ("route modules take `Hono<Env>`"), B-01 dependency rule, C-05

Route modules use `import type { Hono } from "hono"` as skill.md prescribes; `hono` is a framework dependency, resolved by hoisting. Adding it to `apps/template/package.json` would change the shared lockfile, which only an integrator regenerates (plan §9.2). Proposed (integrator or CORE): either declare `"hono": "4.13.13"` (PAR pin) in the template's dependencies and regenerate the lockfile, or re-export the `Hono` type from `.` so apps need no direct `hono` import. Scaffolded apps installed from a tarball depend on hoisting until then.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-18.

### DEC-0210 — LOG-AC-001 needs a log-writer injection option in `TestAppOptions`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: LOG-AC-001, `docs/contracts/ts/testing.d.ts` (owner B-16), B-04

LOG-AC-001 requires "an injected log writer that fails and one that never completes", but no public contract offers an injection point; plan B-04 already lists "failing and never-completing writer injection for tests". Proposal: add to `TestAppOptions` `readonly logWriter?: "failing" | "never-completing"` ("failing": every write rejects/throws inside the writer; "never-completing": every write returns a promise that never settles). `log/log.test.ts` uses exactly this name through an intersection type (`TestAppOptions & { logWriter?: … }`), so it type-checks today and fails until B-16 adds the option. If B-16 picks another shape, it updates the contract and this one test together (decision draft required, contract change).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0211 — How the suites reach the framework
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: all B-T1 suites, B-16, B-17, B-RUN, plan §10.1

- In-process tests import the public hubs by relative path (`src/index.ts`, `src/testing/index.ts`), which re-export exactly the contract names; they run against sources and need no build.
- Everything an app would do through the package name uses the package name and therefore the compiled `dist/` (DEC-0111): on-disk fixture apps (temp directories whose `node_modules` links to the workspace's), the CORE-AC-001 compiler fixtures, the esbuild bundle of `./client` for the browser test, and the package binary (`bin/prototype-framework.js`) for `build`, `dev` and `secrets set`.
- **Open item:** `npm run test:integration` must build the framework first (`npm run build -w packages/framework`). Without `dist/` those tests fail with a message saying so. Wiring that order is B-16/B-17's (or the integrator's, for the root script). Resolved: B-16a made root `test:integration` build the framework first.

B-T2's draft of the same decision ("How the suites reach the framework"): In-process code imports only the public hubs `src/index.ts` and `src/testing/index.ts` (the contracted names) and uses services only through a route of a `defineApp` app (`c.var.sql`, `c.var.kv`); a probe route runs a test closure inside a real request and returns its value or thrown error in memory, so `undefined`, JS types and `FrameworkError` instances are observed exactly as app code sees them. CLI behaviour is exercised through the package binary `bin/prototype-framework.js` in scratch app directories (copied from `apps/template` when present, minus sources/tests/migrations/state; `node_modules` symlinked to the workspace's). The binary loads `dist/`, so **the framework must be built (`npm run build -w packages/framework`) before `npm run test:integration`**; B-16/B-17/B-RUN wire that order. Scratch apps live in the OS temp directory and are removed after each file.

B-T4's draft of the same decision ("Suites drive the real binary on throwaway copies; the framework must be built first"): Each test copies fixture layers into a fresh OS temp directory, symlinks `node_modules` to the workspace's, and runs `node_modules/.bin/prototype-framework <command>` there (what `npx <package> <command>` resolves to). The binary and exports point at `dist/` (DEC-0111), so the harness refuses to run when `packages/framework/dist/cli/public.js` is missing or older than `src/`, naming the command `npm --workspace packages/framework run build`. The runner (B-RUN) must build before `npm run test:integration`, or B-17 wires the build into that script.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Items: B-T1, B-T2, B-T4 (drafts merged).

### DEC-0212 — Finding the `dev` origin; one `dev` at a time
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: HTTP-AC-001, HTTP-AC-006, LOG-AC-002, LOG-AC-003, CFG-AC-003, SEC-AC-001, SEC-AC-002

The dev port is not contracted. The harness starts `npx <package> dev` (the binary) in the app directory, collects every `http://localhost:<port>` printed, and uses the one that serves both `GET /` as `text/html` 200 and `GET /api/__framework/health` as a framework response (204 or JSON) — the one-origin requirement (HTTP-REQ-004, LOCAL-REQ-004). `dev` must therefore print that URL. Vitest runs files in parallel, so dev sessions are serialised by a lock directory in the OS temp directory (owner pid inside; a dead owner's lock is taken over). Stopping sends SIGINT to the process group, then SIGKILL after 15 s.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0213 — Fixture client entry page location
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); refined by DEC-0312 · Affects: HTTP-AC-001

Where the client's `index.html` lives is not contracted (cli.md only says `src/client/` holds browser code). Fixture apps write the same page at the app root and at `src/client/index.html`. HTTP-AC-001 asserts the deep link returns 200 HTML byte-identical to `GET /` and containing the page's marker.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0214 — Entry-module export form
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: on-disk fixture apps, B-16, cli.md §2 App layout, testing.d.ts, B-18

The form of `src/app.ts`'s export is not contracted ("the value an app's entry module exports"). Fixture apps export the `defineApp` result both as `default` and as `app`.

B-T4's draft of the same decision ("App entry and test-app conventions used by fixtures"): `src/app.ts` exports the `defineApp` result both as `default` and as `app` (cli.md says only that it "holds the defineApp call"). App tests call `createTestApp(app)` and `TestApp.request` with the full path (`/api/hello`). The Vite entry page is `index.html` at the app root loading `/src/client/main.ts`. Fixture `tsconfig.json` repeats the app lib set. Route handlers live inline in `defineApp` (no `hono` import needed).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Items: B-T1, B-T4 (drafts merged).

### DEC-0215 — CFG-AC-003 local interpretation
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CFG-AC-003, B-17

"A running build" is a running `dev`; "the next build" is the next `dev` start (which builds). The test edits `config/local.json` while `dev` runs, checks the served value is unchanged after 8 s and 10 s, restarts `dev`, and expects the new value. So `dev` must not rebuild on a values-file change while running (E2E-014: "takes effect only after the rebuild").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0216 — Local stage name and build invocations
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-004, CFG-AC-006, SEC-AC-002…004

CLI-REQ-001 requires `--stage` for `build` and `secrets set`; no doc names the local stage. Tests use `--target local --stage local`, which reads `config/local.json`. Test/production stage selection (CFG-AC-002) is tested with `build --target cloudflare --stage test-<id>` and `--stage bt1prod`, which run offline (plan B-16).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0217 — "Naming" in CLI failures
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-006

A failure "names" something when the command exits non-zero and its combined stdout+stderr contains: the offending key (CFG-AC-002), the missing file as `config/<target>/<stage>.json` (CFG-AC-002), the unknown field's name (CFG-AC-006), or for the app-name rule the bad name plus one of `hyphen`, `lowercase letters and digits`, `[a-z0-9]`, `PAR-290` (CORE-AC-007).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0218 — CFG-AC-004: where the resolved configuration is observed
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CFG-AC-004, B-09, B-16

The resolved configuration is embedded in the build as a generated module (DEC-0063) under `.framework/`; its format is not contracted. The test passes when, after `build`, some file under `.framework/` contains both each declared secret's logical name and its location (`SECRET_<NAME>`, SEC-REQ-003), for a local and a Cloudflare test-stage build.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0219 — HTTP-AC-007 entry contents and fixtures
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: HTTP-AC-007, LOG-AC-005, B-03, B-04

- The log entry schema has no structured fields beyond `message`, so method, route path, code, the error's name and message, the stack (a V8 frame line `\n    at `), and the key or secret name are all asserted inside `message`. The secret is accepted by logical name or location.
- Routes have no path parameters, so "route path" and request path coincide.
- No app-reachable in-process path produces `CORE.MISCONFIGURED`, so the reference route throws `FrameworkError("CORE.MISCONFIGURED")` (a CORE code, not a capability code, so CORE-REQ-007 does not forbid it at runtime).
- "Exactly one `error` entry" counts `error` entries added to `logs()` during that request.
- LOG-AC-005: the entry's `component` is `CORE` for an uncaught error and `SQL` for `SQL.UNAVAILABLE` (LOG-REQ-005 "the failing component's code").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0220 — Other readings
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: listed per item

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
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T1.

### DEC-0221 — SQL-AC-001: what "rejected" and "valid name" mean
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-05, SQL-REQ-001, SQL-AC-001, SQL-AC-004

- "Rejected" = `defineTable` (or `defineApp` with the table) throws at definition time, so no database is created; any `Error` counts (no catalogue code is specified for schema errors).
- Table names must be lowercase ASCII snake_case starting with a letter, at most 63 bytes (Postgres' identifier limit: "valid on every target"), and not start with `__framework_`. Rejected fixtures: `Notes`, `notesList`, `notes-list`, `notes list`, `1notes`, `café`, `__framework_notes`, empty, 64 × `n`. Column keys must be ASCII lowerCamelCase whose snake_case name obeys the same rules (rejected: `Title`, `created_at`, `title-text`, `title text`, `ünicode`, `__frameworkX`, 64 × `a`). Index/unique entries naming a non-existent key are rejected.
- Composite primary keys, reference actions and SQL-expression defaults cannot be expressed through `sql.d.ts`; the suite asserts this at the type level (`@ts-expect-error`, enforced by `npm run typecheck`) and also forces each through with a cast and expects a run-time rejection. Auto-increment, generated and non-portable columns are forced in as Drizzle pg-core builders (`serial`, `generatedAlwaysAs`, `varchar`). Custom collations have no expression at all in the contract or in a portable builder; that clause is covered only by the absence of an API (not testable at run time).
- `.default()` values outside the column rule are rejected the same way (tagged SQL-AC-004).
- The identical-schema clause is checked by applying the generated histories to a fresh local D1 (`getPlatformProxy`) and a fresh PGlite and comparing introspected schemas: snake_case names, §2.1 physical type per dialect, NOT NULL, primary key, defaults, references with a "fail while referenced" action (`NO ACTION`/`RESTRICT`), unique sets and indexes. SQLite stores boolean defaults as 0/1 or `false`/`true`; the comparison reads both as booleans for boolean columns. The introspection harness was validated against hand-written drizzle-style DDL on real local D1 and PGlite (not committed).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T2.

### DEC-0222 — SQL-AC-003…-006: value and failure expectations
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-05, B-06, SQL-AC-003…-006

- "Identical results" locally = the same literal expectations pass in both dialect processes; floats are compared with PAR-280's tolerance. Seed IDs are fixed, valid UUID v4 text so orderings ending in `id` are known.
- `containsText` folds the needle as well as the column (ASCII only): `ÀPPLE` matches `ÀPPLE and apple`, `àpple` does not.
- Value rules (SQL-AC-004): `id()` values must be UUID v4 text (`not-a-uuid` → `SQL.INVALID_VALUE`); NULL into a NOT NULL column → `SQL.INVALID_VALUE`; wrong JS types (e.g. `"1"` for `integer`, `1` for `boolean`) → `SQL.INVALID_VALUE`; the same rules apply to `update().set()`; a multi-row insert with one bad value writes nothing; `ref` to a missing row and deleting a referenced row → `SQL.CONFLICT` (SQL-REQ-006 "reference violation").
- `atomic` with a step built on the outer handle: SQL-REQ-005/`sql.d.ts` say "a catalogue error"; sql.md §2.2 says `CORE.INTERNAL`. The test accepts any catalogue code (the binding wording) and checks nothing was written.
- `SQL.RESULT_TOO_LARGE`: "larger than PAR-215" is strict, so a result of exactly 262,144 bytes (sql.md §2.3 measure) succeeds and one byte more fails.
- The Data API retry clause of SQL-AC-006 and the Cloudflare/Data API targets of SQL-AC-003…-006 are out of scope for B-T2 (AWS code is not built; cloud parts are later phases).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T2.

### DEC-0223 — MIG-AC-001: the checker is judged through `verify`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-07, B-15, B-17, MIG-AC-001

The migration checker has no contracted entry point other than `verify` (CLI-REQ-002 step 3). The test first runs `verify` on the unedited scratch app (must exit 0; the app has one test, because `verify` fails on zero tests), then appends a comment line to the first generated SQLite migration and expects a non-zero exit whose output names the edited file (assumption: CHECK diagnostics name the offending file). `migrations/checksums.json` must be JSON and mention each migration's base name. "One new migration per dialect" = exactly one new `.sql` file in each of `migrations/sqlite/` and `migrations/postgres/`, earlier files byte-identical.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T2.

### DEC-0224 — Recognising app migrations in `__framework_migrations`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-07, MIG-REQ-002

The record's columns are `(id, dialect, checksum, applied_at)` (migrations.md §2) but the `id` format is not specified. The tests assume an app migration's `id` contains its file's base name (e.g. `0000_…`); every row is unique; rows not matching an app file are framework migrations (at least one), and all of them precede the app rows in insertion order, which follow file order.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T2.

### DEC-0225 — KV ambiguities
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-08, KV-AC-001…-005

- KV-AC-002 says "empty … values are rejected", but KV-REQ-002 only rejects empty keys; the requirement wins: `put(k, "")` is accepted and `get` returns `""`.
- A malformed or over-long prefix is rejected with `KV.INVALID_KEY` (KV-REQ-002 and the catalogue: "Key or prefix"); the empty prefix and `limit` above PAR-222 are not tested (not in any criterion; clamp vs reject is unspecified).
- `nextCursor` is null whenever no item remains, including after a full page that exhausts the prefix (kv.d.ts "Null when there are no more items").
- "Database unreachable" locally = `createTestApp(app, { unavailable: ["sql"] })`; every KV operation must then fail with `KV.UNAVAILABLE`, not `SQL.UNAVAILABLE` (KV-REQ-005).
- KV-AC-004's local part is the same KV suite passing in both dialect processes; each KV test carries both its own ID and KV-AC-004.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T2.

### DEC-0226 — `framework.admins` / `framework.users` reach `createTestApp` through `config.framework`; a rebuild is a new `createTestApp`
Origin: ai-proposed · Status: superseded by DEC-0521 and DEC-0522 (was: accepted (assumption under the owner's instruction; owner review open)) · Affects: AUTH-AC-003, AUTH-AC-012, CFG-AC-005, E2E-007, AUTH-AC-005; testing.d.ts (`TestAppOptions.config`), B-12, B-16

AUTH-AC-012 says "With `createTestApp` using `stubLoginProvider` and `framework.users` set to one user ID", but `TestAppOptions.config` is documented as "Config values overriding the app's defaults. A key the app did not declare makes `createTestApp` throw", and no other option carries the framework lists. Assumption: `config` also accepts the reserved key `framework`, holding the stage-config schema's `framework` object (`{ admins?, users? }`), and it is not an undeclared app key. E2E-007 and AUTH-AC-003 say the redeploy "is a rebuild" locally; the suites treat each `createTestApp` call as one build. CFG-AC-005's "only after the next build" is checked by mutating the very object passed to `createTestApp` after the build (no effect) and then building again (effect). Suggest testing.d.ts document the `framework` key (contract owner: B-16).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded in release 1; see the status line.
Item: B-T3.

### DEC-0227 — The stub login provider's `id` is `"stub"`; base32 case is not compared
Origin: ai-proposed · Status: superseded by DEC-0513 (was: accepted (assumption under the owner's instruction; owner review open)) · Affects: AUTH-AC-002; auth.md §2 "User ID", B-12

AUTH-AC-002 requires the ID to match the specified derivation (`u_` + first 26 characters of base32(SHA-256(`<provider id>:<subject>`))), which needs the stub's provider id; no document names it. Assumed `"stub"`. auth.md does not fix the base32 alphabet's letter case, so the suite uses RFC 4648 and compares case-insensitively. "Two providers yield different IDs": locally only the stub completes a non-mock login through `createTestApp` (the Google provider cannot without Google), so the suite checks that the stub's ID is the derivation for its own provider name and differs from the derivation under `"google"`. That is the strongest local form; record it as such for the evaluator.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded in release 1; see the status line.
Item: B-T3.

### DEC-0228 — The stub provider redirects straight to the callback URL; the transaction cookie is the non-session cookie `/api/auth/login` sets
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: AUTH-AC-005, AUTH-AC-006, AUTH-AC-008, AUTH-AC-010; B-12 (`FW/src/auth/testing.ts`)

auth.md says the stub "speaks no protocol" but not what its `beginLogin` returns. Assumption: its `redirectUrl` is the `callbackUrl` it was given (built from the public origin) plus stub-specific query parameters, so a test can follow `/api/auth/login` → `Location` → `/api/auth/callback` in-process with `TestApp.request` and the transaction cookie. This is how the suites observe the callback URL (AUTH-AC-008), the transaction cookie's attributes (AUTH-AC-006), missing / tampered / crossed / expired transactions and `returnTo` sanitising (AUTH-AC-010). Refused and replayed callbacks use `loginWithStub(…, { stubFailure })`, since only the stub can produce them.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T3.

### DEC-0229 — `TestApp` request semantics the suites rely on
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: all B-T3 AUTH and FILES tests; testing.d.ts, B-16

- `request(path)` takes the full path including `/api` (e.g. `/api/auth/me`).
- An explicit `Cookie` header in `init` is sent as given and takes precedence over any session the test app keeps.
- Without a `user` option, a session cookie from `/api/auth/mock-login` decides the current user (the mock's default anonymous identity does not override it).
- `loginWithStub` with a `stubFailure` may resolve or reject (the contract does not say); tests accept either and assert only the observable outcome (no session, log entry).
- Failed-login log entries name the fixed reasons with auth.md's words ("transaction missing or expired", "state mismatch", "provider refused", "token exchange rejected", "token check failed"), matched case-insensitively, and carry the failing request's `requestId`.
- Time checks use `Date`; tests fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`) so local storage I/O keeps running (core.md §2 "Testing" says the runner's fake timers govern session and ticket expiry).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T3.

### DEC-0230 — AUTH-AC-007's missing-Origin and deployed-router clauses are not testable in-process
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: AUTH-AC-007; testing.d.ts, C-phase compliance authors

`TestApp.request` always sends the deployment's origin on state-changing requests unless `init` sets one, so a request with no `Origin` cannot be sent through it, and "through the deployed router" needs the `dev` server or a deployed stage. The B-T3 tests cover the in-process ("directly") part: wrong origins (`https://evil.example`, `null`, a look-alike host) rejected with `AUTH.REQUEST_FORGERY` for POST/PUT/PATCH/DELETE and logout, and the public origin accepted. Their titles say "in-process". The missing-Origin clause and the router part are left to the compliance criteria tests against `dev` and the test stage (C-phase), which can send raw HTTP.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T3.

### DEC-0231 — FILES browser tests run the in-process app behind a local bridge; an unrelated origin is a `127.0.0.1` page with `<base href>` to the app
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-004 (browser part), FILES-AC-006 (browser part); B-11

`files/browser-harness.ts` serves the bundled `<package>/client` and forwards `/api/*` to `TestApp.request`, at `http://localhost:<port>`. Assumption: local ticket URLs are same-origin (relative, or absolute to the page's origin), as files.md §2 Local says ("a same-origin framework route"). The unrelated origin is `http://127.0.0.1:<other port>`, whose page sets `<base href="<app origin>/">` so the same ticket targets the app's transfer route cross-origin; the browser must refuse it (`uploadFile` → `FILES.TRANSFER_FAILED`, status null, `no response: network or cross-origin blocked`, nothing stored; a download `fetch` fails with `TypeError`). A same-origin control proves the tickets work. Interruption (FILES-AC-006) is the bridge pausing a transfer-route PUT after 2 MiB of a 16 MiB body, then dropping the connection; with bytes already sent, the expected class is `interrupted after n bytes` (0 < n < size) with status null. The harness mechanics were checked against Chromium with a fake app (cross-origin PUT blocked before reaching the server; upload error after ~6 MB reported by XHR progress).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T3.

### DEC-0232 — The Google provider is reached as `createGoogleLoginProvider(): LoginProvider` from `FW/src/google/public.ts`
Origin: ai-proposed · Status: superseded by DEC-0513 (was: accepted (assumption under the owner's instruction; owner review open)) · Affects: GOOGLE-AC-001 (local), GOOGLE-AC-002, GOOGLE-AC-003; B-13

No contract names GOOGLE's factory. Assumed a no-argument `createGoogleLoginProvider()` exported from `FW/src/google/public.ts`, returning the internal `LoginProvider` (docs/contracts/ts/internal/login-provider.d.ts); the suite loads it with a dynamic import so the shared type-check stays green until B-13 adds it. Configuration and secret come only through `ProviderContext`: `getConfig` answers `framework.google.clientId` (or the enclosing `framework.google` / `framework` objects), and `getSecret` answers any name containing "google" (case-insensitive) with the client secret. Global `fetch` is stubbed (prompt §4); Google's discovery, JWKS and token endpoints answer from memory, and every other URL is recorded as unexpected and must stay empty, so nothing contacts Google (jose 6's `createRemoteJWKSet` uses global `fetch`). The client ID is obviously fake (`fake-test-client-id.invalid`) and exists only in test files.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded in release 1; see the status line.
Item: B-T3.

### DEC-0233 — GOOGLE-AC-002 also gets an integration form; the "never fetch token URLs" clause is tagged under it
Origin: ai-proposed · Status: superseded by DEC-0513 (was: accepted (assumption under the owner's instruction; owner review open)) · Affects: GOOGLE-AC-002

GOOGLE-AC-002 names unit tests; B-13's unit tests remain its primary evidence. The B-T3 suite feeds the same hand-built tokens through the provider's `completeLogin` (expecting `AUTH.LOGIN_FAILED` for wrong signature, issuer, audience, expired, future issued-at beyond PAR-252, wrong or missing nonce), with controls that tokens inside the 60 s skew and the documented issuer `accounts.google.com` are accepted. GOOGLE-REQ-002's "MUST NOT fetch URLs taken from the token" is checked in a test tagged GOOGLE-AC-002 (a token with `jku`/`x5u` headers), because no AC names that clause.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded in release 1; see the status line.
Item: B-T3.

### DEC-0234 — Parts of B-T3 criteria covered elsewhere or not-run
Origin: ai-proposed · Status: superseded by DEC-0513 (was: accepted (assumption under the owner's instruction; owner review open)) · Affects: AUTH-AC-005, AUTH-AC-009, GOOGLE-AC-001, FILES-AC-004, FILES-AC-006

- AUTH-AC-005: contract part only. No OpenAPI/JSON-Schema validator is a declared dependency (ajv is only transitive), so `auth/support.ts` hand-codes the `CurrentUser` and `ErrorResponse` schemas of framework.openapi.yaml; keep them in step with the YAML. Admin-list part: cloud milestone, not-run ("Google login mocked for this phase").
- AUTH-AC-009: local part (mock-login works with the identity used as given). The production-404 and "production bundles contain no mock" parts need a production build: bundle inspection is CORE-AC-006 (B-T4); the cloud production part is not-run.
- GOOGLE-AC-001: local part (redirect parameters and the token request with the client secret and PKCE verifier). The certification step-1 check against a production deployment is not-run.
- FILES-AC-004 / FILES-AC-006: the "type inspection" and "server part" tests are Vitest; the browser parts are Playwright (`files/transfers.spec.ts`, project `integration`). FILES-AC-004's forbidden vocabulary (storage services, signing, credentials, CORS, bindings) is the list in `files/app-facing-types.test.ts`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded in release 1; see the status line.
Item: B-T3.

### DEC-0235 — Fixture TypeScript files carry a `.fixture` suffix
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: `packages/framework/test/fixtures/**`, B-01 `packages/framework/tsconfig.json`

`packages/framework/tsconfig.json` includes `test/**/*.ts` with the framework (Node) lib set and NodeNext resolution. Fixture apps are app code (app lib set, Bundler resolution) and many fail type checking on purpose, so as `.ts` they would break `npm run typecheck`. They are stored as `*.ts.fixture`; the harness (`fixtures/support/app.ts`) strips the suffix when it copies a fixture app. The passing and failing apps were type-checked by hand against the B-01 contract stubs under the app lib set: the passing app is clean; the failing app's type errors are exactly the intended ones.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0236 — Fixture apps hold no generated migrations; the harness runs `generate-migration`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: B-07, B-17

Migrations are the framework generator's output (format, file names, `checksums.json`), which does not exist yet. After copying, the harness runs `generate-migration` once, as an owner does after defining tables; a failure there fails the test setup with the command's output. Tests that need a hand-changed history (`editMigrationKeepingChecksum`, `addHandWrittenMigration`) infer the `checksums.json` entry from the existing file's digest (sha256/sha1/sha512, hex/base64/base64url, optionally `algo:`/`algo-` prefixed) and fail with a clear harness message if the format is not recognisable; a drizzle `meta/_journal.json`, when present, gets an entry for a hand-written file.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0237 — Diagnostic layout the assertions rely on
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-REQ-003, B-14, B-17

A diagnostic about a file is found by the file's base name (fixture base names are unique) on an output line, plus any indented continuation lines (so both one-line `path:line:col message rule` and ESLint "stylish" layouts work). The rule is "named" when its name appears as a whole word, plugin prefix allowed (`x/no-raw-sql`). Type errors are recognised by `TSnnnn`. CHECK-AC-003 additionally needs, in one diagnostic (the rule line up to the next diagnostic), a skill reference written as `skill/reference/<name>.md` or `reference/<name>.md` that exists under `skill/`, and the construct (per-fixture patterns in `fixtures/support/check-catalog.ts`, matched after removing the file name, rule name and reference path).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0238 — `verify` reports every static step's diagnostics, not only the first failing step's
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-AC-001, CHECK-AC-003, SQL-AC-002, CLI-REQ-002, B-17

CHECK-AC-001 requires the rule (`allowed-imports`) to fail `node:fs` and bare `fs` imports, but under the app lib set (no `@types/node`) those also fail type checking; likewise `.transaction()`, `.batch()` and `db.query` are absent from `PortableDb` and fail type checking before `no-transactions` / `no-relational-queries` could be seen. The tests therefore require `verify`'s output to contain both the type error and the rule's diagnostic. The simplest reading: `verify` runs type checking and the portability rules and reports both before failing. All failing fixtures share one app and one `verify` run.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0239 — Postgres-only failures used for CLI-AC-002 and LOCAL-AC-003
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); CLI-AC-002 fixture superseded by DEC-0311 · Affects: CLI-AC-002, LOCAL-AC-003

Both use only supported features, so only the Postgres test process can catch them: `.limit(-1)` (SQLite: no limit; Postgres: "LIMIT must not be negative") for CLI-AC-002, and `selectDistinct` ordered by an unselected column (Postgres requires ORDER BY expressions of SELECT DISTINCT in the select list) for LOCAL-AC-003. The assertion is that `verify` fails and its output names the failing app test, which proves a test run (not a static check) failed. The output need not say which dialect failed (not specified), so "works on SQLite" is not separately asserted.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0240 — Bundle inspection reads `.framework/` and matches surviving strings
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CORE-AC-006, CF-AC-003, PROV-AC-005, LOCAL-AC-004, B-16

cli.md says `build` generates entry points under `.framework/`; the tests assume the whole build output is there and scan every file in it. Positive controls: a `.js`/`.mjs` file exists, the text contains `__framework/health` and the stage's own config marker. Modules are recognised by strings that survive bundling and minification: `mock-login` (mock); `stubLoginProvider`/`loginWithStub`/`stubFailure` (stub provider, `./testing`); `__framework/files` (local transfer route); `ticket_key`/`ticketKey`/`SECRET_*TICKET*` (local ticket key — assumes its framework-internal name contains "ticket"); `@aws-sdk`/`aws-sdk`/`amazonaws.com`; `pulumi`, `sst` specifiers or paths, `/provision/`, `setupAccount`, `listStageResources` (provisioning); `pglite`/`electric-sql`; import specifiers of `fs`, `fs/promises`, `child_process`, `worker_threads`, `cluster`, `repl`, `inspector`, `v8`, `tty`, `dgram` (with or without `node:`); tooling package specifiers or `node_modules/<pkg>/` paths (eslint, typescript, drizzle-kit, wrangler, vite, vitest, esbuild, miniflare). Comments mentioning these strings in bundled framework code would be false positives; the build should strip comments or minify.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0241 — Readings of individual criteria
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: listed IDs

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
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: B-T4.

### DEC-0242 — The framework lints its own source with typescript-eslint's recommended rules; root `verify` includes it
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); lint scope extended by DEC-0315 · Affects: plan §3 B-17 task line, plan §10.1, prompt §5 ("the framework's own code must pass its own checks"), PAR-111, DEC-0205

The plan's root `verify` is "framework typecheck + framework lint + unit tests + `npx <package> verify` in the apps" (B-17 task line), so the framework lints itself. The shipped portability rules (`./check`) are written for app code (app lib set, no Node APIs) and do not fit framework code, which is Node and Worker library code. Chosen, simplest: root `eslint.config.js` applies typescript-eslint's `recommended` configuration (ESLint and typescript-eslint at PAR-111, declared as root dev dependencies) to `packages/framework/src/**/*.ts` and `packages/framework/bin/**/*.js`; in colocated `*.unit.test.ts` files `no-unused-vars` and `no-unused-expressions` are off, because those files hold type-level fixtures (values declared only for their types, expressions read only by the type checker). Root `lint` = `eslint packages/framework/src packages/framework/bin`; root `verify` = `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit && npm --workspace apps/template run verify` (`apps/reference` is added by C-01). The test-author suites and fixtures under `packages/framework/test/**` are not linted yet: they are owned by test-author items, and recommended rules report seven findings there (unused `_` names, `{}` types, one unused directive) at B-INT. C-INT may extend the scope once their owners fix them. Integration fix: two `prefer-const` findings in unit tests (`testing/test-app.unit.test.ts`, `secrets/service.unit.test.ts`) were corrected without changing behaviour.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL §2, C-T1…C-T4, D-RUN, `apps/reference/ROUTES.md`

`apps/reference` (app name `reference`) follows the template's layout: `src/app.ts` exports the `defineApp` result as `default` and `app`; one route module per area in `src/server/routes/` (`ref`, `levels`, `errors`, `kv`, `files`, `fixture`, `cases`); `index.html` at the app root with `src/client/`; `src/shared/types.ts` types only. The route list, with the criteria each route serves, is `apps/reference/ROUTES.md`; tests address the app only through it. Capability routes (`/api/kv/*`, `/api/files/*`, `/api/fixture/*`, `/api/cases/*`) require a logged-in user, since cloud test stages are publicly reachable; fixtures and error routes are anonymous unless the code needs a level. KV and FILES routes pass keys, names and cursors to the framework unchanged (no prefix), so the framework's own rejections are observable.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0251 — Error routes raise capability codes by causing them
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: HTTP-AC-002, HTTP-AC-007, CORE-AC-008, CORE-REQ-007, `app-error-codes`, DEC-0219

"A reference route per catalogue code with a status" is one literal route `/api/errors/<CODE>` per code (no path parameter, so the HTTP-REQ-007 route path equals the request path). App code may throw only the four CORE-REQ-007 codes (`app-error-codes` fails `verify` otherwise), so every other code is produced by doing what causes it: `CORE.MISCONFIGURED` by calling `defineTable` with an invalid table name inside the handler (DEC-0132); `CFG.UNDECLARED_KEY` and `SEC.UNDECLARED` by reading an undeclared name through the general `ConfigService<ConfigDeclaration>` / `SecretsService<string>` types, to which the app's typed services are assignable without a type assertion; `SQL.CONFLICT` by a duplicate unique `authors.name`; `SQL.INVALID_VALUE` by `integer` 2³¹; `SQL.RESULT_TOO_LARGE` by one 300,000-character row (one oversized row, plan §1 limits); `KV.*`/`FILES.*` invalid inputs directly; outage codes (`*.UNAVAILABLE`, `SEC.MISSING`) by a plain read that fails only under `createTestApp`'s `unavailable` option or a missing value, and otherwise answers 200 `{ raised: false }`. `AUTH.LOGIN_FAILED` has no route: app code may not throw it and the framework's callback answers failed logins with a redirect (DEC-0168). DEC-0219's fixture (B-T1) throws `FrameworkError("CORE.MISCONFIGURED")` directly; the reference app cannot, since `app-error-codes` rejects it.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0252 — Secret fixture routes never return the value
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SEC-AC-001, SEC-AC-002, SEC-AC-005, HTTP-AC-002

The app declares one secret, `apiKey` (the test secret). Every declared secret is required by the health check and the deploy preflight, so no "never set" secret is declared; `SEC.MISSING` is observed where `apiKey` has no value. `GET /api/ref/secret` returns only the SHA-256 of the value, so SEC-AC-001's "is returned" is checked by digest and no response ever contains the value. `GET /api/ref/throw-secret` (plain `Error`, 500) and `/throw-secret-app` (`HTTP.CONFLICT`, 409) throw errors whose messages contain the value, for HTTP-AC-002's no-echo clause (DEC-0123 redaction).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0253 — Route modules take the router type derived from `AppDefinition`; no `hono` import
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEC-0209, DEC-0243, `apps/reference/package.json`, `package-lock.json`

The template imports `type { Hono } from "hono"` and declares `hono` (DEC-0243). Declaring it in `apps/reference/package.json` would change the shared lockfile, which only an integrator regenerates. The reference app instead types its route modules with `Api = Parameters<AppDefinition<typeof config, Secret>["routes"]>[0]` (in `src/server/env.ts`), which is the same `Hono<AppEnv<…>>`, and imports nothing from `hono`. If the integrator prefers the template's form, declare `hono` 4.13.13 here, regenerate the lockfile and switch the alias to `Hono<Env>`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0254 — Version 1/2 schemas as overlays; a failing overlay for MIG-AC-003
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL §2 ("committed version 1 and version 2 schemas"), E2E-010, MIG-AC-002, MIG-AC-003, C-T2, C-T4, D-RUN-M

An app has one schema at a time, so the committed app is version 1, and every version-dependent part (the `parents`/`children` tables, the fixture load and dump, `SCHEMA_VERSION`) lives in `src/server/evolution.ts`. Overlays under `apps/reference/versions/<name>/` hold a replacement `src/server/evolution.ts` and the complete `migrations/` tree, generated with `generate-migration` from a copy of the app; a test applies one by copying the app, replacing `migrations/` and that file, then deploying (locally: the next `dev` start). `v2` adds `children.rank` (default 0), an index on `children(parentId, rank)`, and drops `parents.note`, a table with child rows (MIG §2 supported changes only; the drop and the add are on different tables, so the generator accepts one migration). `unique-fail` adds a unique constraint on `children.label`, which the data fixture violates (two children labelled `shared`) — the "data-dependent failing migration" of MIG-AC-003, provided here because C-T2 does not own `apps/reference`. Overlay files are outside `src/`, so the app's own `verify` does not check them; checked manually in scratch copies: the `v2` copy passes `verify` (both dialects), a `dev` start of `v2` over a v1 `dev` state holding the fixture keeps every row and file (dump shown below), and `unique-fail` makes `dev` exit before serving with the migration named and the database unchanged.

Evidence (local, scratch copies): v2 dump after upgrade `{"version":"v2","parents":[{"name":"alpha"},{"name":"beta"},{"name":"gamma"}],"children":[…5 rows, "rank":0…],"files":[…2 files, sha256 unchanged…]}`; unique-fail: `dev: migration app/0001_unique_label (…/0001_unique_label.sql) failed and was not applied; the database is unchanged by it: D1_ERROR: UNIQUE constraint failed: children.label`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0255 — Data fixture shape and the fixture routes
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-010, MIG-AC-003, MIG-AC-006

The data fixture (`src/server/fixture-data.ts`) is 3 parents, 5 children and 2 files under `fixture/` (one text, one with all 256 byte values). `id()` values must come from `newId()` (`framework-ids`), so `POST /api/fixture/load` generates IDs and `GET /api/fixture/dump` compares by content: parents by name, children by parent name and label, files by name, size, content type and SHA-256. Load inserts all rows with one `atomic` call and refuses a second load with `HTTP.CONFLICT`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-01.

### DEC-0256 — Shared case sets: interface and registry handover
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: C-T2 (owner of `apps/reference/src/server/cases/**`), SQL-AC-003…-006, KV-AC-004

A case is `(services: { sql, kv, files, log }, input: unknown) => Promise<unknown>`; a set is a record of named cases (`src/server/case-types.ts`). `POST /api/cases/run { set, name, input? }` answers `{ outcome: "value", value }` or `{ outcome: "undefined" }`, or the framework's `ErrorResponse` for a thrown error; `GET /api/cases` lists the sets. The route reads its sets from `src/server/case-registry.ts`, which ships empty, because C-01 may not create files under `src/server/cases/**` and a missing module would fail `verify`. **For C-T2:** export `caseSets: CaseSets` from `src/server/cases/index.ts` and replace the registry's body with `export { caseSets } from "./cases/index";` (ownership of that one file passes to C-T2 for this edit). Case tables `authors`, `posts` (every column type, nullable and defaulted columns, a reference), `tags` (composite unique, index) are in `src/server/schema.ts` with committed migrations; changing them needs a new migration from C-01's owner.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted; "contains an ID" amended 2026-10-24 (root cause 2026-10-24-G6-release-milestone-misread) · Affects: COMPL-REQ-006, COMPL-AC-006, `validation/invalidations.md`, DEC-0261

A record whose command contains `--milestone` is milestone evidence. Any other record is automated evidence for its commit only. For each target, the latest record that contains an ID decides that ID. A record contains an ID when it has an entry for the ID other than `not-run: not selected for this run (--only)`, the entry DEC-0261 writes for an expected ID outside `--only`. That entry says only that the run did not try the ID, so it is skipped when choosing the deciding record and when judging it. The match is exact (status `not-run` and that detail, `NOT_SELECTED` in `tests/compliance/harness/catalogue.ts`); every other `not-run` detail still counts. "Works" requires every automated entry of every applicable target to be `passed` for the commit. It also requires every milestone item's latest milestone record to be passed and not invalidated. An invalidation line is `- <YYYY-MM-DD | ISO time> | <IDs> | <reason>`. A date alone means the end of that UTC day. An entry invalidates records that finished at or before it, and elapsed time never does. The commits touching `packages/framework/src/google/`, `packages/framework/src/auth/login-provider.ts` or `docs/contracts/ts/internal/login-provider.d.ts` since the commit of the last valid GOOGLE-AC-005 record are listed. With no certification, the whole history is listed.
Item: C-02.

### DEC-0265 — Traceability report
Origin: ai-proposed · Status: accepted; "latest result per target" amended 2026-10-24 (root cause 2026-10-24-G6-release-milestone-misread) · Affects: COMPL-REQ-002, COMPL-AC-002, DEC-0261

Tests are found by the runners themselves, so titles built at run time are read the way the runners name them. For Vitest, a run whose name filter matches nothing collects every file without running any test body. Playwright uses `--list`. A scan of the test sources adds bracketed tags and `tag(...)` calls, for suites a listing cannot see. Each catalogue ID is listed with its tests and its latest result per target. The latest result per target comes from the latest record that contains the ID in DEC-0264's sense: an entry `not-run: not selected for this run (--only)` (DEC-0261) does not count, matched exactly as there. IDs with no test are flagged **UNTESTED**, and tags that name no defined ID are flagged too.
Item: C-02.

### DEC-0266 — Harness tooling: launcher, HTTP client, Playwright, self-test, root scripts
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: plan §9.2, §10.1, DEC-0085, DEC-0089, PAR-119, PAR-210, PAR-270, PAR-280

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25; unverified against the live API, verify in D-03/D-RUN); 409 reading amended by DEC-0421 (200, 404 and 409 confirmed live in pass 0) · Affects: PROV-REQ-004, PROV-AC-007, cloudflare.md `setupAccount`, D-03

R2 bucket names are scoped to an account, so the bucket `prototype-logs` is read through this account's path `GET /accounts/{account}/r2/buckets/prototype-logs`: success → owned; HTTP 404 → absent; HTTP 403 → foreign (it exists but this account does not own it, or its credentials cannot see it — the message says both). Creation is `POST /accounts/{account}/r2/buckets {"name":"prototype-logs"}`; HTTP 409 → foreign. Any other answer is an error naming the bucket and the HTTP status. The status codes were not observed against the live API (this item is offline); D-03/D-RUN confirm them. Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").

**To verify in phase D:** D-03 and D-RUN must confirm the 404/403/409 readings against the live R2 API before `setup-account` relies on them; until then this entry is unverified.
Item: C-03.

### DEC-0271 — The fake target and the Cloudflare API seam
Origin: ai-proposed · Status: accepted · Affects: COMPL-AC-007, PROV-AC-007, CLI-AC-003, D-03, D-05

`provision/core/fake-target.ts` is an in-memory `TargetOperations` with per-operation failure injection, used by the core's unit tests and available to D-05's command tests. `provision/cloudflare/account.ts` takes a `CloudflareApi` function (method, path relative to `/client/v4`, JSON body → status and JSON body), so it never handles credentials; D-03 supplies the real one (authentication, `NODE_USE_ENV_PROXY=1`, DEC-0107). Its colocated unit test `account.unit.test.ts` is treated as part of the owned file (plan §3: colocated unit tests are implementer-owned).
Item: C-03.

### DEC-0272 — How `smoke` finds the base URL: recorded dev origin and recorded deploy output
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CLI-REQ-001 `smoke`, CLI-AC-005, testing.d.ts `connectTestStage`, `dev` (B-17), D-05 `deploy`

`dev` picks a free port each start, so `smoke --target local` cannot guess it. While it runs, `dev` records `{ origin, pid }` in `<app>/.framework/local/dev-server.json` (git-ignored) and removes the file when it stops. `smoke` treats a missing or malformed record, or one whose process has ended, as "no running dev server" and says to start `npm run dev`. On a cloud the base URL is the stage's recorded deploy output `<app>/.framework/<target>/stages/<stage>.json` (`{ publicOrigin }`), written by `deploy` (D-05). The helpers `recordDevServer`/`clearDevServer`/`recordDeployOutput` are in `src/cli/commands/smoke.ts`. With `--target local`, `--stage` may be left out and can only be `local`. On a cloud, `--stage` is required and must start with `test-`. Anything else is refused before any request is sent.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SEC-AC-001, SEC-AC-002, HTTP-AC-002, CORE-AC-002, C-RUN, D-RUN, C-02 driver

Criteria that need the reference app's test secret `apiKey` to have a known value read it from its SEC-REQ-003 location: locally `SECRET_API_KEY` in `apps/reference/.dev.vars` (`dev` does not reload `.dev.vars` while running, so the runner sets it *before* the run with `npm run secrets -- set apiKey --target local --stage local` in `apps/reference`, value on stdin; a long random value of letters and digits). A cloud store cannot be read back, so on a cloud the runner sets the value on the run stage and passes it to the tests in `COMPLIANCE_SECRET_API_KEY` (the driver does not do this yet: a D item must add it, or the runner exports it). Without a value (or one under 12 characters) the tests report a missing prerequisite (`blocked`), never pass. CORE-AC-002's health check reports `SEC.MISSING` the same way.

C-INT: the driver passing `COMPLIANCE_SECRET_API_KEY` on a cloud run is assigned to D-T2/D-05 in the plan (§5 "From phase C").
Integrator note: done by D-07; see DEC-0398.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T1.

### DEC-0278 — Clauses that change a stage run on scratch copies and further stages
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-003, SEC-AC-001, SEC-AC-003, SEC-AC-005, LOG-AC-004, CLI-AC-001, CLI-AC-004, CLI-AC-005, COMPL-REQ-003

The driver records evidence only from an unmodified working tree, so no test edits a tracked file. Clauses that edit committed files or need a deployment without the secret run on a scratch copy of the app outside the repository (`node_modules` linked to the workspace's), with its own `dev`: CFG-AC-003 (edit `config/local.json` while `dev` runs, then restart), SEC-AC-001 "without a value" (a copy with no `.dev.vars` value), SEC-AC-003 local (`secrets set` into the copy's `.dev.vars`), CLI-AC-001/-004/-005 (template copy; a git repository of its own so `smoke` can record evidence from a clean tree there). Scratch `dev` sessions are serialised by a cross-process lock. On a cloud, clauses that set or delete secrets or remove a stage run on one further `test-<random>` stage (`newTestStage()`) deployed from a scratch copy and removed in `finally`, serialised across files by a lock (at most one further stage at a time; with the run stage that is ≤ 2 D1 databases, plan "Cloud usage limits"). A further stage's first deploy that stops naming unset secrets is followed by `secrets set` and a second deploy (PROV §2). One file (`secrets/further-stage.test.ts`) holds SEC-AC-001 (cloud missing clause), SEC-AC-003 (cloud), SEC-AC-005, LOG-AC-004 (removal clause), CLI-AC-004 (cloud) on one shared further stage; CLI-AC-005 deploys the template to its own further stage.
Item: C-T1.

### DEC-0279 — Cloud test hooks D-T2 provides under `tests/compliance/criteria/_cloud/`
Origin: ai-proposed · Status: accepted (C-T4 part: accepted under the owner's instruction of 2026-10-25) · Affects: D-T2, LOG-AC-002, LOG-AC-004, LOG-AC-005, SEC-AC-002, SEC-AC-003, SEC-AC-005, E2E-011, E2E-012, E2E-014

**Criteria tests (C-T1).** Cloud stores are reached through `tests/compliance/criteria/_cloud/index.ts` (D-T2 owns it), which must export `cloudHooks(target: string): CloudHooks | Promise<CloudHooks>` with the interface in `core/support/stores.ts`: `deleteSecret({app, stage}, name)`, `secretLocations({app, stage})` (e.g. `["SECRET_API_KEY"]`), `logBucketExists()`, `listLogKeys(prefix)`, `readLogObject(key)`. The module is loaded at run time; while it is absent the tests report a missing prerequisite. Stored-entry lookups by request ID read only the objects whose key ends with `-<requestId>.json`; SEC-AC-002 reads all of the run stage's entries for today and yesterday.

**E2E tests (C-T4).** Log-bucket listing and the stage-resource probe belong to D-T2 (`tests/compliance/criteria/_cloud/**`). The E2E tests load them at run time and report a missing prerequisite (`blocked`) while they do not exist:
- `_cloud/logs.ts` exporting `listLogEntries({ target, app, stage, day }): Promise<{ key: string; body: string }[]>` — every object under `<app>/<stage>/<day>/` (`day` = `yyyy/mm/dd`) in the account's shared log bucket, with its body;
- `_cloud/stage-resources.ts` exporting `listStageResources({ target, app, stage }): Promise<string[]>` — every resource of PROV's removal list still present for the stage, as the driver's leftover strings (`database <name>`, `<kind> <id>`).
If D-T2 chooses other names, a C-T4 follow-up adapts `support/cloud.ts` (plan: "gaps found in them go back to a C-T* follow-up item"). The D1 database probe (PROV-REQ-002's exact pattern) and the shared-bucket existence check use the Cloudflare API directly (`support/cloud.ts`, no Authorization header; the proxy injects the token). Cloud log waits use `CLOUD_WAITS.requestMs` (an entry is written within its request's lifetime, PAR-270); waiting for a newly set secret uses `CLOUD_WAITS.routeToggleMs`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T1, C-T4 (merged: C-T1-3 and C-T4-7).

### DEC-0280 — Readings of criteria
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); the SEC-AC-005 bullet superseded by DEC-0540, the LOG-AC-004 bullet by DEC-0541 · Affects: the IDs named

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
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T1.

### DEC-0281 — Shared case sets: one expectation set, three places
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-AC-003…-006, KV-AC-001…-005, COMPL-REQ-001, `apps/reference/src/server/cases/**`, `tests/compliance/criteria/{sql,kv}/`

The cases live in the reference app (`cases/sql.ts`, `cases/kv.ts`, `cases/mig.ts`, registered by `case-registry.ts` per DEC-0256) and only report what the framework did; expectations are literals in `tests/compliance/criteria/{sql,kv}/suite.ts`, derived from sql.md / kv.md / the contracts. Each suite runs three times: in-process on local D1 and on PGlite (`createTestApp(referenceApp)` + `POST /api/cases/run`, one entry file per dialect because the dialect is fixed per process, DEC-0134), and through the reference app over HTTP (`client()`: `dev` locally, the test stage on a cloud). "Identical results on every target" (SQL-AC-003, KV-AC-004) = the same literal expectations pass in every place; floats compare with PAR-280; unordered results are sorted by the case and compared as multisets. Every KV test is tagged with its own criterion and KV-AC-004.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0282 — In-process runs exist only on the local target
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-REQ-001, `tests/compliance/criteria/{sql,kv}/*.{d1,pglite}.test.ts`

The in-process entry files define their tests only when `target()` is `local`. On a cloud run they would produce local results under the cloud target's evidence; defining them conditionally (rather than skipping) keeps cloud evidence to the HTTP runs, and adds no `not-run` entries. This is the one place the C-T2 tests read `target()`, and only to choose where tests exist, not what they expect.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0283 — Cases are namespaced, self-cleaning and use only public, `verify`-clean app code
Origin: ai-proposed · Status: accepted · Affects: `apps/reference/src/server/cases/**`

Each case takes `{ ns }`, a random per-suite namespace (`c-t2-<16 hex>`), names its authors/keys under it and deletes what it wrote (SQL: one seed of 10 rows per suite, removed by `cleanup`; other cases in `finally`), because a cloud stage is shared by the run's criteria. Rejections are reported inside a case by catalogue code (`codeOf`/`outcome`), so one request checks many values; a non-`FrameworkError` is reported as `not-a-framework-error: …`, which no expectation accepts (SQL-REQ-006). `framework-ids` forbids literal IDs, so IDs come from `newId()` and results map them to labels; the deliberately invalid IDs of SQL-AC-004 come from the case input (left to the run-time rule, as `framework-ids` documents). Type assertions are banned in app code, so wrong-JS-type values (e.g. `1` for `boolean`) are not tested; `boolean` has no in-type boundary.
Item: C-T2.

### DEC-0284 — Readings of SQL-AC-003…-006
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SQL-AC-003…-006

- SQL-AC-003 "every supported feature": every §2.3 row is exercised — select/selectDistinct, insert (single and multi-row), update, delete, inner/left joins, a subquery (`inArray` over a select), a select-only CTE (`$with`/`with`), all exported comparison/boolean/null/`inArray`/`notInArray`/`between` expressions on every column type, `containsText`, every aggregate incl. `groupBy`, `asc`/`desc` on every nullable type, `limit`/`offset`, both upsert forms against declared uniques, and `returning`. Ordering totality: within a suite's data every ordering ends in a column whose values are distinct (`title`), so the order is determined.
- `containsText` "edge cases": `""`, `%`, `_`, `\`, a would-be LIKE pattern (`1%s`, `o_e`) that must not match, ASCII folding (`HELLO`, `APPLE`), non-ASCII not folded (`àpple`, `äpfel`), NULL never matching.
- SQL-AC-004: per type, values just inside and just outside each rule of sql.md §2.1 (integer ±2³¹ edges, fractions, NaN; number ±Infinity, NaN, `Number.MAX_VALUE`, `Number.MIN_VALUE`, −0 stored as 0; timestamp −1, 2⁵³, fractions, 0, `MAX_SAFE_INTEGER`; text lone/reversed surrogates, NUL, `""`, U+FFFF, U+10FFFF, an astral pair; `id`/`ref` uppercase UUID and non-UUID). Rejections must be `SQL.INVALID_VALUE` and write nothing (also for `update().set()`, comparisons and a multi-row insert with one bad row); accepted values must read back exactly.
- SQL-AC-005: the outer-handle rejection must be a catalogue code (any; SQL-REQ-005 and sql.d.ts say "a catalogue error", sql.md says `CORE.INTERNAL`, as DEC-0222) and nothing — not even the first, valid step — may be written. A committing `atomic` is checked as a control.
- SQL-AC-006: duplicate single-column and composite unique values on insert and update → `SQL.CONFLICT` (409 over HTTP); one row of 270,000 ASCII characters selected back → `SQL.RESULT_TOO_LARGE` (one oversized row, plan §1), one of 200,000 succeeds. **Not covered:** the Data API retry-loop clause (AWS adapter; not built in this phase).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0285 — Readings of KV-AC-001…-005; KV-AC-002's empty-value conflict
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25; owner item DEC-0146 / plan §11 Q6) · Affects: KV-AC-001…-005, DEC-0146

- KV-AC-001: list results are checked for exact key sets and code point order, incl. `%`, `_`, mixed case, a key outside the prefix that a non-literal match would include (`<ns>/pa%b` for prefix `<ns>/p/`), and code point vs UTF-16 order (U+FFFD before U+1F600).
- KV-AC-002: limits in UTF-8 bytes (a key of 1,024 bytes made of 2-byte characters is accepted; a 1,025-byte key with an astral character, only 1,023 UTF-16 units long, is rejected); malformed keys, prefixes and values are `KV.INVALID_KEY` (KV-REQ-002). **Empty values:** the test follows KV-REQ-002 (binding) and DEC-0146 — `put(k, "")` is accepted and `get` returns `""` — in its own test whose title names the conflict, so the owner's decision changes one test. A prefix over PAR-220 bytes is not asserted (DEC-0147 is an implementation choice no requirement states).
- KV-AC-003: "2.5 pages" = 10 keys in pages of 4 (sizes 4, 4, 2), not 50 keys at the default page size (plan §1 limits); a cursor is rejected with a different, a narrower and a wider prefix, and when malformed.
- KV-AC-005: the maximum page is exactly PAR-222 = 50 entries of PAR-220-byte keys and PAR-223-byte values (the criterion's own size, the only test above "tens of rows"); "database unreachable" locally = `createTestApp(…, { unavailable: ["sql"] })` and `["kv"]`, in-process only (DEC-0225).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0286 — MIG criteria deploy their own stages from a scratch copy of the reference app
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); stage layout amended by DEC-0423 (three self-contained blocks), its D1 reads' "no Authorization header" by DEC-0428 · Affects: MIG-AC-002, -003, -006, DEC-0144, compliance.md "Test stages", D-RUN

`tests/compliance/criteria/mig/support/stage.ts` copies `apps/reference` (without state, tests and overlays) to a temporary directory, applies an overlay (`v1` = committed app, `versions/v2`, `versions/unique-fail`) and deploys it: locally a `dev` start (DEC-0144; after a failed start the harness serves the previous version's sources, the local reading of "the old app answers again"), on Cloudflare `deploy --target cloudflare --stage test-<random>` then `remove`. The database is read only with SELECTs: locally from Miniflare's SQLite file, on Cloudflare through the D1 HTTP API `query` endpoint of the stage's lowest-numbered `reference-<stage>-db-<n>` database (no Authorization header; the proxy injects it). Two stages, used one after the other: (1) initial deploy, unchanged redeploy, failing `unique-fail` deploy, data correction, successful re-run; (2) v1 → v2 with data, writes during the deploy, a secret and a session.
- MIG-AC-002: "creates the schema" = every app and framework table exists; "the record lists every migration once" = `__framework_migrations.id` in rowid order equals `framework/<file>` for the framework history then `app/<file>` for the app's, each in file order (DEC-0142 format); "changes no data" = every table's rows, incl. the record's applied times, are identical; "does not stop the app" = on a cloud every health probe during the deploy answers 204; locally a deployment is a `dev` restart, so only "applies nothing" is checked (DEC-0144).
- MIG-AC-003: failure = non-zero exit, same database names, every row unchanged, health 204, `schema-version` back to `v1`, dump unchanged. The re-run corrects the data (case `mig/relabelDuplicate` relabels one of the two `shared` children) and re-runs the same overlay. Preservation = same parent and child IDs and references (`note` dropped, `rank` = 0 added), no orphaned child, other tables unchanged.
- MIG-AC-006 (cloud only): at most 20 KV writes, one per 3 s, while the v2 deploy runs; at least one must be acknowledged (otherwise the check proves nothing) and every acknowledged one must be readable afterwards; exactly one stage database; `GET /api/ref/secret` returns the SHA-256 of the value set before the first deploy; `GET /api/ref/me` with the session from before answers as before.
- Not runnable until D: the Cloudflare paths depend on D-05's `deploy`/`remove`/`secrets set --target cloudflare` and were not executed here.

A schema-changing deploy of a MIG stage holds two databases while the run stage holds a third; how D-RUN stays within the cap of two is DEC-0318.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0287 — C-01's case-runner test updated for the registered sets
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: `apps/reference/tests/fixture-and-cases.test.ts` (C-01-owned), DEC-0256

C-01's test "has no sets until C-T2 registers them" asserted `GET /api/cases` = `{ sets: {} }` and failed once the registry re-exports C-T2's sets, so the reference app's `verify` (and root `verify`) failed. The only edit outside C-T2's paths: that assertion now expects the registered set names `kv`, `mig`, `sql` (its unknown-case 404 check is unchanged). Owner instruction "do not stop for questions"; C-01's owner may prefer another form.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T2.

### DEC-0288 — Browser transfers use the published `<package>/client`, bundled and added to a page of the app's origin
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-003, FILES-AC-004 (browser part), FILES-AC-006 (browser part); `tests/compliance/criteria/files/browser.ts`

FILES-AC-003 needs `uploadFile` and `downloadUrl` called with tickets the test chooses (another name's, another content type's, an expired one), and needs `ApiError.status`, which the reference page's status text does not show. The reference page exposes no helpers. So the test bundles the installed package's `./client` entry (what an app imports) with esbuild into an IIFE (`window.fw`) and adds it to the reference app's own page with `page.addScriptTag`. The page is on the target's origin (`dev`, or the stage), so the browser treats the transfers exactly as an app's. Tickets are requested by a logged-in Node client from the reference app's ticket routes, as app server code would hand them out, and passed into the page unchanged. esbuild is not declared in `tests/compliance/package.json` (C-T3 does not own it); it resolves from the root `node_modules` (framework dependency, PAR-119). If a cloud stage's page ever sends a Content-Security-Policy that blocks inline scripts, the injection fails visibly; Playwright's `bypassCSP` would then be the fix (not set now, since `dev` sends none). Not a missing route: the scenario-level flow through the app's own page is E2E-009.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0289 — Ticket fields are read only through the documented ticket shape
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-003, FILES-AC-005, E2E-009

Where a criterion is about what a ticket permits, the tests read `url`, `method`, `headers` and `expiresAt`, the shape files.md §2 "Shared runtime shape" documents (DEC-0160). App code never does; the type inspection (FILES-AC-004) checks that app-facing types expose none of these.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0290 — "A ticket for one name cannot write another": the ticket's URL edited to name another file is refused
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-003

The test uploads with an upload ticket for `…/one.txt` (it writes that name and nothing else), then rewrites the ticket URL wherever it carries the name — plainly, percent-encoded, or inside a base64url JSON segment (a signed token) — to `…/two.txt`, sends each rewritten URL with the ticket's method and headers from the page, and expects each to be refused, `two.txt` absent and `one.txt` unchanged. It requires at least one rewrite to be possible, so the clause cannot pass vacuously.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0291 — "An upload with a different content type is rejected": a raw `fetch` from the page
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-003

`uploadFile` always sends the ticket's content type, so the mismatched upload is a plain `fetch` `PUT` to the ticket URL with `Content-Type: image/png` from the app's page. It passes when the request does not succeed (a refused status, or a network/CORS error on a cloud) and nothing is stored; a control upload with the ticket's own type then works.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0292 — FILES-AC-003's expired-ticket clause waits for a real expiry (PAR-233)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-003; `expired-ticket.spec.ts`

No contract option or reference route issues a shorter-lived ticket, and the expiry is checked by storage (R2 on Cloudflare), so the clock cannot be moved. The test uses the ticket once (control), waits until its `expiresAt` plus 30 s (bounded: the lifetime must not exceed PAR-233 + 1 min; test timeout PAR-233 + 5 min), and asserts the clause as written: `FILES.TRANSFER_FAILED`, a numeric status ≥ 400, `rejected by storage (HTTP n)`, no storage error body in the message, nothing written. It is in its own spec file so the wait overlaps the other specs. On Cloudflare it is expected to fail (DEC-0101); it is not skipped or weakened. A test-only short ticket lifetime would make the run 15 minutes shorter; that would be a framework change (not requested).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0293 — FILES-AC-004 browser part: a `127.0.0.1` page is the unrelated origin, against `dev`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-004; B-EV flag F6

Per F6 the browser part runs against `dev` (the driver's local target), not a harness. The unrelated origin is a page served by the test at `http://127.0.0.1:<port>` with `<base href="<app origin>/">`, so relative (local) ticket URLs target the app's storage cross-origin; on a cloud the ticket URLs are absolute anyway. A same-origin control precedes it. Outcomes are soft assertions, so the evidence shows the upload and the download result together.
Observed on `dev` (informational, 2026-10-20): the upload from `http://127.0.0.1:<port>` **succeeds**. `dev`'s HTTP server answers the preflight for `/api/__framework/files/*` with `Access-Control-Allow-Origin: <the requesting loopback origin>` (it does so for `http://127.0.0.1:1234`, not for `http://evil.example`), i.e. any page on a loopback origin, such as another local dev server, can use the app's tickets. This is the dev-server path F6 asked to check; the test reports it as a failure. Origin of the header (Vite's default `server.cors`, which allows loopback origins) is for a diagnoser to confirm.

Since fixed (root-cause record `ai/implementation/root-causes/2026-10-20-FILES-AC-004-dev-vite-default-cors-allows-loopback.md`, commit `69ae283`): `dev` runs Vite with `server.cors: false`, so the loopback page is refused and the test passes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0294 — FILES-AC-006: server part in-process; browser part through a cutting proxy against `dev`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-006

Server part: a running `dev` cannot be given unreachable storage, so the reference app runs in-process with `createTestApp(…, { unavailable: ["files"] })` and every `/api/files/*` route (put, get, head, delete, list, both ticket kinds) must answer 503 `FILES.UNAVAILABLE`. Browser part: the page on `dev` is opened in a context whose proxy is a small forwarding HTTP proxy run by the test (`bypass: "<-loopback>"`, since Chromium never proxies loopback otherwise); it drops the connection of every upload `PUT` to the ticket's path after 2 MiB, and the upload is throttled to 4 MiB/s (CDP) so the cut lands mid-body. Chromium retries a reset request a few times; each attempt is cut. Expected: `FILES.TRANSFER_FAILED`, status null, `interrupted after n bytes` with 0 < n < 16 MiB, nothing stored. Both parts are Local only (Where), so the driver selects them only on `local`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0295 — FILES-AC-005: the stage's storage as a stranger finds it
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-005 (Cloud)

The storage address comes from a ticket URL with its query string (where a signed URL carries its signature) removed. Unsigned `GET` of the file, of a sibling name, of the storage root and of the first path segment (bucket, path-style), and an unsigned `PUT`, must each get a 4xx without the file's bytes or name in the body, and the file must be unchanged. Cloud only: locally the signature is part of the path, so the test is not meaningful there and the driver does not select it.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0296 — FILES-AC-004 type inspection walks the published declarations, and the contracts
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: FILES-AC-004

The TypeScript checker walks the FILES exports (and `Services.files`) of the package's `exports` `types` files for `.` and `./client`, and of `docs/contracts/ts/{index,client}.d.ts` (bundler resolution, since the contracts use extensionless imports), collecting member, parameter, type and string-literal names; none may match the storage/signing/credential vocabulary, and `UploadTicket` / `DownloadTicket` must have no property besides the brand. A non-vacuity check requires the walk to have reached `createUploadTicket`, `createDownloadTicket`, `contentType`, `onProgress` and `nextCursor`. B-T3 inspects the sources; this inspects what an app installs.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0297 — AUTH-AC-006: per-target cookie names; the transaction cookie and the "Locally" clauses in-process
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: AUTH-AC-006

"As specified" is AUTH-REQ-006 plus auth.md §2: names `session_local` / `login_local` locally and `__Host-session` / `__Host-login` on cloud targets; HttpOnly, SameSite=Lax, Path=/, no Domain, cloud also Secure; lifetime PAR-250 (session) and PAR-251 (transaction) from Max-Age or Expires (±60 s). These are the per-target expectations the criterion states, so the tests branch on the target for them. A `test-` stage and local `dev` have no real login provider, so their `/api/auth/login` sets the session directly (DEC-0171) and no transaction cookie: on the target the test checks every cookie the login flow sets. The transaction cookie itself is checked with the stub login provider, which exists only in-process (`createTestApp(…, { stubLoginProvider: true })`), together with the "Locally, expired and future-dated" clauses (fake `Date`, as B-T3 did). Those in-process tests are registered only when the target is `local` (not skipped elsewhere), so a cloud run neither runs nor records them. Consequence for evaluators: on a cloud test stage the transaction-cookie attributes are not observed; that is only possible on a stage with a real provider (prodcheck: not-run, Google login mocked).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0298 — AUTH-AC-007: missing and wrong Origin through the deployed router with raw HTTP; directly in-process
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: AUTH-AC-007; DEC-0230

Through the deployed router (`dev` locally, the stage on a cloud): a POST with a session and no `Origin` (also `/api/auth/logout`, which must leave the session intact), with wrong origins (`https://evil.example`, `null`, a look-alike host, the same host with the other scheme, another port, a trailing slash), and with the public origin (the base URL's origin). Directly: in-process (local only), wrong and correct origins.
Observed on `dev` (informational, 2026-10-20): `Origin: https://localhost:<dev port>` (other scheme) is **accepted** through `dev` but refused by the worker when sent to it directly, so `dev`'s front server appears to rewrite or drop `Origin` before the forgery check. The test reports this as a failure; a diagnoser should confirm the mechanism.

Since fixed (root-cause record `ai/implementation/root-causes/2026-10-20-AUTH-AC-007-wrangler-proxy-rewrites-origin-scheme.md`, commit `69ae283`): `dev` proxies `/api` with `changeOrigin: true`, so wrangler no longer rewrites the `Origin` scheme and the test passes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0299 — AUTH-AC-009: only the test-stage part
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); its production-404 part, which waited on Google login, superseded by DEC-0513 · Affects: AUTH-AC-009

On the target (local or `test-` stage): chosen level, ID used as given (including characters a derived ID never has) and display name appear in `/api/auth/me`, `c.var.user` and the guards; a fixed default ID per level; `anonymous` logs out. The production 404 is not-run (Google login mocked, plan §8.1). "Production bundles contain no mock module" is a bundle inspection (CORE-AC-006 build part, B-T4) and is not checked or tagged here.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0300 — E2E-009: BMP photos through the reference app's page; request and source checks
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-009

The photos are uncompressed 24-bit BMPs of at least 20 MB and 100 MB (decimal), generated on disk for the run and removed afterwards (one item per size the scenario names). Upload through `file-input` + `upload` until `upload-status` is `Uploaded.`; view: the item's `preview` reaches the photo's natural dimensions; download: the item's `download` link, observed through Playwright's `download` event, saved and compared by size and SHA-256. "Requests only to the app's API and through framework helpers": every page request is a ticket URL the app's ticket routes returned, a same-origin `/api/*` request outside `/api/__framework/`, or a same-origin GET loading the page or its client code; each photo went to storage by exactly one PUT to an upload-ticket URL, and `/api/files/content` was never called. "No storage or CORS settings": the reference app's code and configuration files (excluding tests, generated migrations and the version overlays) contain none of the storage/CORS vocabulary.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0301 — No missing reference routes
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: C-01 `apps/reference/ROUTES.md`

Every route these tests use is in ROUTES.md (`/files/*`, `/levels/*`, `/ref/me`, the framework's `/api/auth/*`). Not needed but would help: a way to issue a short-lived ticket on test stages (DEC-0292).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T3.

### DEC-0302 — Target-specific parts are defined only on their targets
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-007, E2E-011, E2E-014, COMPL-REQ-001

Where a scenario states different steps per target (E2E-007 local in-process part; E2E-011 local failing-writer part; E2E-014 cloud scan part and local rebuild part), the test for one target's part is defined only when `target()` is that target (`if (target().target === "local") test(...)`), not skipped elsewhere: the driver turns each skipped tagged test into a `not-run` entry, which would misstate a part that does not apply. Shared parts (E2E-011's entry lookup, E2E-014's committed-values check) run on every target and branch only on where the target stores its entries.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0303 — E2E-001: offline namespace after scaffolding; capabilities through the template's pages
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-001, LOCAL-AC-001

Scaffolding (`skill/scripts/scaffold`) needs the npm registry for the template's other pinned dependencies (DEC-0276), so it runs with cloud credentials removed from the environment (`CLOUDFLARE_*`, `CF_*`, `AWS_*`, `GOOGLE_*`, `GCLOUD*`, `CLOUDSDK_*`, `AZURE_*`, `SST_*`) but with the proxy. Every later step runs under `unshare -rn sh scripts/offline.sh` (no network at all, stronger than "cloud providers blocked"), with the same credentials removed and `HOME` an empty directory; the test first shows `api.cloudflare.com` is unreachable there. Because the browser must reach `dev` inside the namespace, `support/template-pages.ts` (run by Node with type stripping) starts `dev` and Chromium inside it and prints one result line. "Imports every public subpath" = every key of the installed package's `exports` map imports in Node and type-checks (`tsc --strict --skipLibCheck`, Bundler resolution). "Each capability through the template's pages": CFG (heading shows `greeting` set in `config/local.json`), AUTH (Log in / Log out; admin via mock-login), SQL (Notes), KV (Status, kept after reload), FILES (upload, list, download same bytes), SEC (Admin "Check secret" after `secrets set apiKey`), LOG (the note's entry in `.logs/`). Selectors are the template pages' visible texts (the template has no test IDs). The scaffolded app lives in the OS temp directory and is removed afterwards.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0304 — E2E-003: violations, expected rules and references
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-003, CHECK-REQ-003

E2E-001 and E2E-003 share one scaffolded app (one spec file, serial). Each violation is one new file under `src/server/` (or the edited `migrations/sqlite/0000_schema.sql`), restored after its `verify` (run offline). Pass per violation: `verify` exits non-zero and a diagnostic line names the file, the rule ID and `(read skill/reference/<file>.md` per check.md §2 "Diagnostics" and DEC-0181: AWS SDK import and `node:fs` → `prototype-framework/allowed-imports` + `http-and-validation.md`; `c.env.DB` → `no-env-access` + `configuration.md`; raw `sql` → `no-raw-sql`, `rightJoin` → `no-dialect-features`, edited migration → `migration-checksums`, all + `sql-and-migrations.md`; `any` → `@typescript-eslint/no-explicit-any` + `troubleshooting.md`. `caches.default` may instead fail type checking (a TS error line naming the file). "A SQLite-only function" has no Drizzle helper, so it is `strftime` through Drizzle's `sql` template; either `no-dialect-features` or `no-raw-sql` counts. The test fails while the skill reference files do not exist only if `verify` stops printing them; their existence is CHECK-AC-003's (E-01).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0305 — E2E-004: in-run coverage part; the pass part is read from the run's own record
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-004, COMPL-REQ-006

E2E-004's pass condition is a property of a whole run's evidence record, which is written after every test finishes, so no test of that run can observe it (running the suite recursively would double cloud usage). The tests check what a run can: (a) coverage — every criterion the driver expects to run on this target and tier (`expectedCriteria`) has at least one tagged test in the files this target's run executes (`tests/compliance/**`, plus `packages/framework/test/integration/**` locally; driver.ts limits cloud runs to `tests/compliance/`); (b) the evidence writer's schema matches the contract's required fields and properties and rejects invalid records. Titles say "coverage part" / "record part". The evaluator judges E2E-004 itself from that run's record (every other applicable result `passed`, record schema-valid). Expected to fail until every component's tests exist (SKILL, DEMO criteria in phases E/F; other C-T* items until merged).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0306 — E2E-005: browser fetches from the app page; exposure detectors
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-005

The browser logs in via `/api/auth/mock-login` and calls ROUTES.md's protected routes with `fetch` from the app's own page (`/`), so cookies and `Origin` are the browser's. Permitted actions per level: `/levels/anyone` all; `/levels/user` (GET, POST), `/levels/current`, `/kv/value`, `/files/head` user and admin; `/levels/admin` (GET, POST) admin only; refusals 401 `AUTH.UNAUTHENTICATED` (anonymous) / 403 `AUTH.FORBIDDEN` (user). Every `/api` response's body and headers (except `Set-Cookie`, which carries the framework's own session) is checked for the words google, oidc, oauth, openid, issuer, iss, email, id token, access token, refresh token, jwt (camel/snake case split, case-insensitive), email addresses and JWT-shaped strings. "App-facing types" = the shipped declaration files of `.`, `./client`, `./testing` (CORE-REQ-005's app-importable subpaths) and every declaration file they import; identifiers and string literals are checked with the same detector, comments are not (they are documentation, not types).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0307 — E2E-013/E2E-014 secret checks without printing values
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-013, E2E-014, SEC-REQ-002, CLI-REQ-004

E2E-013 finds the secret `apiKey` in responses through its digest (`GET /api/ref/secret` → SHA-256; every substring of each short response text is hashed), so it needs no copy of the value and runs on every target; locally it also checks every `.dev.vars` value (≥ 8 characters). E2E-014 sets a fresh value with `secrets set apiKey` (standard input) — on a cloud on the run's stage, then deploys that stage again; locally in a copy of the reference app under the git-ignored `.framework/e2e/` (the tree stays clean). Scans: repository = `git ls-files` plus untracked non-ignored files; build outputs = the app's `.framework/` (LOCAL §2 "Build output"); browser assets = everything reachable from `/` (same origin, outside `/api`, ≤ 300 files); logs = `.logs/` locally, the stage's entries of the day in the shared bucket on a cloud. `.wrangler/` (local runtime state) and `.dev.vars` (the local secret store itself) are not scanned. Assertion messages name where a value was found, never the value. Local "rebuild" = restarting `dev`, which builds (DEC-0215); the served value is checked unchanged for 10 s after the edit.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0308 — E2E-010 and E2E-012 stage handling
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-010, E2E-012, D-RUN-M

Each scenario creates its own `test-<random>` stages (`newTestStage()`) and removes them in `finally`; each deploy runs from its own copy of the app under `.framework/e2e/` so concurrent deploys never share a build directory. The first Cloudflare deploy of a stage stops when `apiKey` is unset (provisioning.md "First Cloudflare deploy"); the helper then sets a fresh value and deploys again. E2E-010: v2 = the `versions/v2/` overlay; "applies nothing" = the stage keeps the same single database (a schema-changing deploy copies to a new one, MIG-REQ-006) and the dump is unchanged; "no downtime" = every probe of `/api/ref/schema-version` (no database rows) during the second v2 deploy answers 200, one per second. E2E-012: the kept stage holds the migration fixture plus its own KV value and file; the removed stage its own KV value and file and one log entry, which must remain after removal. Data per scenario: tens of rows (fixture 3 + 5 rows, 2–3 files, 1–2 KV keys), within the plan's cloud usage limits.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0309 — E2E-016 scan details
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-016

Scanned: `docs/contracts/ts/**/*.ts` except `internal/`, and `docs/contracts/http/framework.openapi.yaml`. TypeScript files are tokenised with the TypeScript scanner (identifiers, string and template literals, comments); the YAML file line by line. Case-sensitive whole-word matching; in identifiers a word boundary is also a camel-case boundary (`getS3Client`, `OAuthToken`), a lower-case term also matches its capitalised camel-case form (`tokenIssuer`), and multi-word terms also match their identifier spellings (`idToken`, `IDToken`, `access_token`). A test checks `terms.txt` equals the scenario's list, and positive/negative controls check the scanner. The scan test also runs in a local milestone run, where the driver records E2E-016's "review" part from it; the review itself is F-04's `validation/reviews/E2E-016.md` (the evaluator must not read the scan as the review).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T4.

### DEC-0310 — In-process reference app from Playwright
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-007, E2E-011

The in-process parts import `apps/reference/src/app.ts` at run time (its `app` export, DEC-0214) and call `createTestApp` with the working directory set to `apps/reference` (restored afterwards), so the committed migrations apply. E2E-007's "copy the user ID from the account page" reads `/api/auth/me`, the account page's data (framework.openapi.yaml); "redeploy" is a second `createTestApp` with `framework.admins` (testing.d.ts: each call is one build).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25; implemented by D-02, see DEC-0329); raster-`inline` part superseded by DEC-0414 · Affects: FILES-REQ-003, files.md §2 (Local, Cloudflare), `packages/framework/src/files/local/route.ts`, D-02

Observed in phase C: a local download is saved under the ticket token (the last segment of the ticket URL), because the local route sends a bare `Content-Disposition: attachment`. files.md does not say what name a download gets. The simplest reasonable behaviour is chosen. A storage response to a download ticket names the file with `filename*=UTF-8''<percent-encoded file name>` (RFC 6266/8187) in its `Content-Disposition`. That is `attachment; filename*=…` for every content type except raster images, which stay `inline; filename*=…` as they are now. The whole file name is used and nothing is interpreted as a path (FILES-REQ-002); browsers replace `/` and other unsafe characters when they save the file. There is no app-facing change and no new option. Locally the `/api/__framework/files/*` route adds the parameter. On Cloudflare the download ticket signs R2's `response-content-disposition` query parameter with the same value (the S3 GetObject override). D-02's tests confirm that R2 honours it on a presigned GET. If it does not, Cloudflare keeps the default name and this entry is revised. C-INT changes no code. The local change is a small follow-up to the FILES local route (B-11's paths), and the Cloudflare part belongs to D-02 (plan §5 "From phase C"). The implementing item updates files.md.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-INT.

### DEC-0314 — LOG-AC-004 "written outside a request": the design has no such writer; the clause stays blocked pending the owner
Origin: ai-proposed · Status: superseded by DEC-0541 (the owner dropped the clause from LOG-AC-004; LOG-REQ-004's rule and its unit test stay) · Affects: LOG-AC-004, LOG-REQ-002, LOG-REQ-004, `docs/components/log.md`, `tests/compliance/criteria/log/keys.test.ts`, D-01

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); two-database cap superseded by DEC-0419; the stage guards applied to every further stage by DEC-0424 · Affects: plan §1 "Cloud usage limits", §5 D-RUN and D-RUN-M, DEC-0263, DEC-0268, DEC-0278, DEC-0286, DEC-0308, MIG-AC-002, MIG-AC-003, MIG-AC-006, E2E-010, E2E-012, PAR-219

C-T2's estimate per Cloudflare run is about 350 base rows written, up to about 700 with index entries, under 2,000 rows read, and about 100–150 API requests from the MIG tests, plus those of 2 stages × 3–4 deploys and removals. That is within the caps. The databases are the problem. A run stage holds one D1 database. A stage's first deploy migrates in place (DEC-0268), and so does a redeploy without pending migrations, so each holds one database. A schema-changing deploy copies (MIG-REQ-006) and holds two. The MIG file (DEC-0286), E2E-010 (v1 → v2 on its own stage) and E2E-012 (a kept and a removed stage) therefore reach three databases alongside the run stage, which breaks the plan §1 cap of two. Rule: D-RUN and D-RUN-M run in passes, each holding at most two databases.
1. **Main pass:** `npm run compliance -- --target cloudflare --only <every expected ID except MIG-AC-002, MIG-AC-003, MIG-AC-006>`. It uses the run stage plus at most one further stage at a time (DEC-0278's lock; further stages deploy the committed schema, so one database each).
2. **MIG pass,** after the main pass has removed its stage: `--only MIG-AC-002,MIG-AC-003,MIG-AC-006` with no run stage. The MIG tests deploy their own stages and do not use the run stage, so the pass gives the driver `--base-url` and nothing else is deployed. If D-05 or D-RUN find that the driver needs a real base URL, D-05 adds a `--no-stage` form instead (decided in D). The MIG stages are used one after the other (DEC-0286).
3. **Milestone (D-RUN-M):** E2E-010 and E2E-012 run as separate passes, each with no run stage (`--base-url`, as above), and the other milestone items run in a pass of their own. D-T1's stage-lifecycle tests (PROV-AC-*) follow the same rule.
Before each pass, D-RUN checks the account's database count (PAR-219) and the day's D1 usage, then records both readings (plan §1). D1 use waits for DEC-0317 in any case.
Item: C-INT.

## Implementation phase: local and Cloudflare — phase C follow-ups, phase D Cloudflare, phase E skill (2026-10-20)

Entries DEC-0319 to DEC-0391 were integrated by the C/D/E integrator from the drafts of items fix-c3, C-T5, D-01…D-06, D-T1/D-T2, E-01…E-03, E-T1 and fix-e1 (plan §10.4), and DEC-0391 from the C-EV evaluation. No Cloudflare call was made by any of these items: everything cloud-side is verified offline against fakes and is confirmed live by D-RUN once the D1 stop (DEC-0317) ends. No parameter changed.

### DEC-0319 — The driver also runs the unit layer on local, for an explicit list of unit-level criteria only
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-REQ-003, COMPL-REQ-006, COMPL-AC-002, COMPL-AC-006, COMPL-AC-007, GOOGLE-AC-002, PROV-AC-007, CLI-AC-003, plan §10.1, §10.3, compliance.md "Driver", DEC-0261 (supersedes its first bullet's "each runs once" for the local unit layer)

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
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause B).

### DEC-0320 — E2E-004's coverage part lists the driver's exact selection through the runners
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-004, DEC-0305, DEC-0265

DEC-0305's coverage part ("has at least one tagged test in the files this target's run executes") was implemented as a regex scan of `*.test|spec.ts` sources, which cannot see titles built at run time (the KV and SQL shared case sets tag through `t(id, …)` / `tag(id, …)` in helper modules), so IDs the same run recorded `passed` were reported uncovered (root cause, cause A).

Rule: the coverage part lists, without running a test body, exactly the invocations of `runnerSelection` for the target (`tests/compliance/tools/listing.ts` `listDriverTests`: a Vitest run whose name filter matches nothing, per config; `playwright test --list` over the driver's projects and paths), scopes each listed test to the IDs it may evidence (`scopeTests`; unit-layer tests only for unit-level IDs), and reports the expected IDs no listed test carries (`uncovered`, `selection.ts`). No source scan supplements it, so the check cannot count a tag the driver would not run. Listing problems (load errors, non-zero exits) are appended to the failure message. The listing writes its Playwright JSON to its own file, never the run's `PLAYWRIGHT_JSON_OUTPUT_NAME`. The traceability report uses the same listing executor (`listSelection`) with every layer and keeps its source scan as a supplement (DEC-0265). DEC-0305's wording becomes "has at least one tagged test that the run's runners collect with the driver's selection".
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-c3 (root cause 2026-10-20-E2E-004-coverage-and-not-run, cause A).

### DEC-0321 — COMPL-AC-001 and COMPL-AC-003 are compliance-level, evidenced by nested real runs of the command in a clone
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-AC-001, COMPL-AC-003, DEC-0319, `tests/compliance/criteria/compl/`

Both criteria are stated over runs of the one command, so they are not unit-level and stay off `UNIT_LEVEL`. Their tests (`tests/compliance/criteria/compl/{targets,evidence}.test.ts`, integration layer, selected by the driver like every other criterion) run the real `npm run compliance -- …` as a child process:
- in a throwaway `git clone --shared` of HEAD with the installed `node_modules` linked in (untracked, excluded), so a test can commit a deliberate case or modify a tracked file without touching the working tree the enclosing run records from;
- with `--out <temp dir>`, no `COMPLIANCE_*`/`CLOUDFLARE_*`/`AWS_*` variables, and a dead proxy, so a nested run can make no cloud call;
- never recursing into the real suites: a nested run either blocks every ID (`--blocked '*=…'`, so it lists and records without starting `dev`, deploying or running a test) or uses `--self-test` (only `harness/self-test/`).
Each record a nested run writes is checked against `docs/contracts/schemas/evidence.schema.json` by a small checker in the test support (independent of the writer's own validator).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T5.

### DEC-0322 — How each clause is read
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-AC-001, COMPL-AC-003

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

Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C-T5.

### DEC-0323 — Cloudflare log writer: `LOGS` binding, per-request sink, fallback without the binding
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: LOG-REQ-001, LOG-REQ-004, LOG-AC-001, LOG-AC-002, LOG-AC-004, LOG-AC-005, DEC-0128, DEC-0189, DEC-0314, cloudflare.md §2 "Runtime", log.md §2 "Cloudflare", D-03, D-T2

The shared log bucket `prototype-logs` is bound to the stage Worker as the R2 binding `LOGS` (`BINDINGS.logs`). `r2LogSink` (`src/log/cloudflare/sink.ts`) writes each entry as one object: the body is the entry's JSON, `httpMetadata.contentType` is `application/json`, and the key comes from `logObjectKey` (`src/log/cloudflare/keys.ts`): `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json` from the entry's UTC time, with `<id>` the request ID or, when there is none, `crypto.randomUUID()` (the only evidence for LOG-REQ-004's random-value rule is `keys.unit.test.ts`, DEC-0314). The write promise has its rejection swallowed and is handed to the request's `ctx.waitUntil`; the sink returns nothing, so the writer never waits (DEC-0128). A synchronous throw from the binding or from `waitUntil` is dropped. The sink needs the request's env and execution context, so `StageOptions` gained an optional `requestSink(c)` that replaces the static `sink` per request (the local runtime and `createTestApp` are unchanged). Without a `LOGS` binding (a misconfigured Worker), entries are printed as the local marked lines (`workerOutputSink` format) rather than failing anything, since LOG-REQ-001 forbids a log write from failing the caller and the lines still show in the Worker's logs. This replaces B-16's interim stub (DEC-0189). Verified offline: unit tests with fake buckets; the runtime against Wrangler's local R2 (`getPlatformProxy`); a real `build --target cloudflare --stage test-x` bundle under local workerd writing to `LOGS`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); unchanged in effect by DEC-0430, which addresses the stored key (`x%2F..%2Fy%01`); extended on AWS to every operation by DEC-0464 (owner review open); since DEC-0533 it matters only for `.` segments (`..` segments are invalid names), so it stays · Affects: FILES-REQ-002, FILES-REQ-003, files.md §2 "Cloudflare"

WHATWG URL parsing, used by aws4fetch, Workers and browsers, resolves `.` and `..` path segments, even when they are percent-encoded. With per-segment encoding, a ticket for `x/../y` would address `y`, and a ticket for `../up.txt` would address `/up.txt` outside the bucket path. That is unit-tested: the test failed before the fix. Fix (simplest): when any segment of the name is `.` or `..`, the issuer encodes the whole name, every `/` as `%2F`. Other names keep the per-segment form that A-07 verified. Assumption, not verified live: R2 decodes `%2F` in the path into `/` in the key, as S3 does, and canonicalises the path from the decoded key, as aws4fetch does. D-RUN checks it with one ticket for a `x/../y` name. A name that is exactly `.` or `..` cannot be put in any path-style or virtual-hosted URL. For such a name, `createUploadTicket`/`createDownloadTicket` on Cloudflare throw `FILES.INVALID_NAME`: "cannot be transferred by the browser on this target". Server operations on such names still work. This is a target difference in a corner case that FILES-REQ-002 allows. Owner: accept it, or forbid the names `.` and `..` in FILES-REQ-002 on every target.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: D-02.

### DEC-0329 — Download names on Cloudflare, and the content type the issuer needs
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); content-type part superseded by DEC-0414 · Affects: DEC-0313, files.md §2 "Download names", `src/files/service.ts` (B-11's), D-RUN

DEC-0313 is implemented with one helper, `downloadDisposition(name, contentType)` in `src/files/cloudflare/disposition.ts`. The local route imports it: a shared FILES module would be the natural home, but D-02 does not own one. The helper builds `attachment|inline; filename*=UTF-8''<RFC 8187 value-chars>` and percent-encodes `'`, `(`, `)`, `*` and `/` too. The Cloudflare download ticket signs it as `response-content-disposition`. aws4fetch serialises the query in form encoding, so the space after `;` is sent as `+`. Assumed (S3 behaviour): R2 decodes `+` as a space when it checks the signature. D-RUN confirms R2 honours the override and accepts the signature with one presigned GET. If it does not, DEC-0313 says Cloudflare keeps the default name and the entry is revised. Choosing `inline` for raster images needs the file's content type. `TicketIssuer.download(name)` does not pass it, so the Cloudflare issuer takes an optional second argument and defaults to `attachment`. `<img src>` ignores `Content-Disposition`, so images still display. Needed elsewhere: in `src/files/service.ts` `createDownloadTicket`, pass the `head` result's content type: `options.tickets.download(name, infoOf(head).contentType)`, and widen `TicketIssuer.download` to `(name, contentType?)`. Until then, Cloudflare names raster images `attachment`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-02.

### DEC-0330 — Storage CORS preflight for deploy's health step; CORS policy helper
Origin: ai-proposed · Status: accepted · Affects: provisioning.md step 7, DEC-0099, FILES-REQ-004, D-03

`bucketCorsPolicy(publicOrigin)` returns the DEC-0099 body: one rule, `maxAgeSeconds` 60, no `exposeHeaders`. It refuses with `CORE.MISCONFIGURED` any value that is not exactly one origin (a path, a trailing slash, a wildcard, no scheme). `bucketCorsPath(accountId, bucket)` is `/accounts/<a>/r2/buckets/<b>/cors`. D-03 sends them through its `CloudflareApi`. `checkStorageCors({ accountId, bucket, publicOrigin, fetch? })` sends one `OPTIONS` to `https://<account>.r2.cloudflarestorage.com/<bucket>/__framework-cors-check`, with `Origin`, `Access-Control-Request-Method: PUT` and `Access-Control-Request-Headers: content-type`, and no credentials. It returns `{ ok: true }` only for a 2xx whose `Access-Control-Allow-Origin` equals the origin exactly (a `*` fails). Otherwise it returns `{ ok: false, status, message }` in the shape of PROV's `HealthOutcome`, naming the status and the ACAO value. It never reads storage's body and never throws (an unreachable host becomes `ok: false`). The tests replay A-07's recorded answers, N13 (204 with ACAO) and N14 (403 without). From Node it needs `NODE_USE_ENV_PROXY=1` behind the sandbox proxy (plan §10.6).
Item: D-02.

### DEC-0331 — Cloudflare stage resources have fixed names
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); the per-stage signing token's name amended by DEC-0550 (a legacy name only) · Affects: PROV §2 "Stage resources", CF-REQ-002, PROV-AC-003, PROV-AC-006, DEC-0263, `provision/cloudflare/names.ts`

On Cloudflare the stage's Worker script is `<app>-<stage>`, its R2 bucket `<app>-<stage>-files`, and its R2 signing token `<app>-<stage>-files-signing`. These are not generated names. PROV §2 says physical names are "whatever the provisioning tool generates (with a unique suffix where the namespace is global)". Workers scripts, R2 buckets and account API tokens are named per account, not globally, and app names have no hyphens (PAR-290), so the fixed names are unique. With PAR-290 and PAR-291 every name fits the 63-character limits. Reason: every operation (stop, start, secrets, removal, the leftover check) finds the stage's resources from the stage name alone, with no SST outputs or local state. That includes a deploy from a clean machine (PROV-AC-006). They are still referenced only by exact name, never by a wildcard. `remove` and the leftover check match SST state objects as `<kind>/<app>/<stage>` exactly, or below it, so `test-a` never matches `test-ab`.
**Change needed elsewhere:** provisioning.md §2 "Stage resources" should say that on Cloudflare the names are fixed as above. cloudflare.md "Deploy mechanics" should name them. Neither doc is owned by D-03.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-03.

### DEC-0332 — The real `CloudflareApi` sends `CLOUDFLARE_API_TOKEN` as a bearer token
Origin: ai-proposed · Status: accepted · Affects: DEC-0083, DEC-0107, DEC-0271, plan §10.6, D-05, `provision/cloudflare/api.ts`

`createCloudflareApi({ token })` sends `Authorization: Bearer <CLOUDFLARE_API_TOKEN>` to `https://api.cloudflare.com/client/v4<path>`, as wrangler and SST do. On an owner machine that is the real token. In the sandbox it is the non-secret placeholder, which the proxy replaces (DEC-0083). Plan §10.6's "never send an Authorization header yourself" means agents in the sandbox, who must not send real credentials. The framework only passes on whatever the variable holds. Messages never contain the token or a request body. A non-JSON answer (e.g. the proxy's 502 `text/plain`) is returned as text and quoted in errors, up to 200 characters. Node's `fetch` uses `HTTPS_PROXY` only when the process starts with `NODE_USE_ENV_PROXY=1` (DEC-0085). The variable cannot be set from inside the process, so the CLI process must already have it (D-05).
Item: D-03.

### DEC-0333 — The `workers.dev` subdomain is a shared account resource, read from Cloudflare on every deploy
Origin: ai-proposed · Status: accepted (resolved by the owner, 2026-10-25: the subdomain was renamed to a neutral name); the registered name amended by DEC-0552 (`pf-<random>`, never derived from the account ID) · Affects: PROV-REQ-004, PROV §2 "State home" ("account settings live with the shared resources"), cloudflare.md §2, DEC-0086, `provision/cloudflare/account.ts`

`inspectAccount` reports three shared resources: `R2 bucket prototype-logs`, `R2 bucket sst-state` (SST's state home, DEC-0084; same 404/403/409 readings as the log bucket, DEC-0270), and `workers.dev subdomain`. The subdomain is `owned` when `GET /accounts/{id}/workers/subdomain` returns a non-empty `result.subdomain`. It is `absent` on HTTP 404 or an empty value. It is never `foreign`, because it is a setting of the account itself, and any other answer is an error. Cloudflare holds the subdomain, so "recording" it means it is read again on every deploy (`accountSubdomain`) and never stored on the owner's machine. When it is absent, `setup-account` registers `pf-<first 12 characters of the account ID>` with `PUT /accounts/{id}/workers/subdomain {"subdomain": …}`. If that fails, the error names the subdomain and asks the owner to register one in the dashboard and run `setup-account` again. The name is deterministic, so a repeat run tries the same name. It is the simplest name that contains nothing personal. On this account the subdomain already exists (DEC-0086), so registration runs only in unit tests.
**Change needed elsewhere:** cloudflare.md §2 could say which name is registered (D-01 owns that doc in this wave).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue".
**Resolved (owner, 2026-10-25).** The owner renamed the account's subdomain to a neutral name. The framework must never register a subdomain derived from personal data; it registers `pf-<random>` (DEC-0552), which replaces the account-ID-derived name above.
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
Origin: ai-proposed · Status: superseded by DEC-0550 (deploy needs no token permission, so the preflight no longer checks it) (was: accepted (accepted under the owner's instruction of 2026-10-25)); open question closed by DEC-0420 and DEC-0428 (no proxy injection; the restricted-credential clause runs when the operator supplies the token) · Affects: PROV-REQ-002 step 1, PROV-AC-002, `provision/cloudflare/r2-token.ts`, D-T1

Cloudflare has no request that answers "may this credential create a token?" without creating one, and step 1 must create nothing. The preflight therefore reads `GET /accounts/$ID/tokens/permission_groups` and `GET /accounts/$ID/tokens?per_page=50&page=1`, the two reads that token creation itself needs. If either is refused, it reports "the Cloudflare API token lacks the permission to create R2 API tokens (Account API Tokens: Edit): HTTP …". Before that, it checks the credential variables by name (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and the token with `GET /accounts/$ID/tokens/verify`. A token that can read tokens but not edit them passes the preflight, and step 5's token creation then fails, naming the token. That is accepted as the simplest available check.
**Open question (owner / D-T1):** in the sandbox the proxy replaces every `Authorization` header to `api.cloudflare.com` with the injected token, so a deploy cannot use a restricted credential. If so, PROV-AC-002's "credential that lacks the permission to create R2 API tokens" clause cannot be run live from this sandbox, and its unit test (`r2-token.unit.test.ts`, `target.unit.test.ts`) is the only evidence.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-03.

### DEC-0336 — The SST app generated for a Cloudflare stage
Origin: ai-proposed · Status: accepted (unverified live; DEC-0334 item 6); "Steps" amended by DEC-0427 · Affects: PROV-REQ-001, PROV-REQ-002 steps 3 and 5, cloudflare.md §2, DEC-0036, DEC-0084, DEC-0087, DEC-0088, DEC-0091, DEC-0107, `provision/cloudflare/sst.ts`

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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); amended by DEC-0543 (a production stage is backed up before anything is deleted; the confirmation stays) · Affects: PROV-REQ-003, PROV-REQ-005, CLI-REQ-001, DEC-0263, cli.md §2

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25; unverified live, DEC-0334 item 6) · Affects: CF-REQ-001, CF-AC-001, cloudflare.md §2, DEC-0325, DEC-0336 (closes its "Static-asset settings" open item), `provision/cloudflare/sst.ts`

When the built code has an assets directory, `sstProgram` builds `cloudflareWorkerSettings` (D-01) from the stage's inputs (Worker name, bundle, assets directory, public origin, database, files bucket) and passes its `assets` to `sst.cloudflare.Worker` as `assets: { directory, notFoundHandling: "single-page-application", runWorkerFirst: ["/api", "/api/*"] }`. Without an assets directory (an app with no `index.html`, DEC-0351) there is no `assets` and the Worker answers every path, as before. Building the settings also applies D-01's checks (an `https` public origin without a path; no `SECRET_*` names).

Evidence for the shape (no Cloudflare call): the platform source embedded in the pinned SST binary (`sst-linux-x64` 4.17.2) declares `WorkerArgs.assets?: { directory; htmlHandling?; notFoundHandling?: "404-page" | "single-page-application" | "none"; runWorkerFirst?: boolean | string[] }` and maps it onto the Pulumi `WorkersScript` as `assets: { directory, config: { headers, redirects, htmlHandling, notFoundHandling, runWorkerFirst } }`, adding an `assets` binding named `ASSETS`. So no transform (`args.assets.config`) is needed. The option is marked `@internal` in SST's docs; if a later SST drops it, the fallback is DEC-0336's (set `assets` in the Worker transform, or raw Pulumi). D-RUN's first deploy and CF-AC-001 confirm the behaviour on a test stage.
Unit test: `sst.unit.test.ts` "serves the built client as static assets with D-01's settings …" (red: the program had `{ directory }` only).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-06.

### DEC-0357 — The driver's leftover check uses the framework's own `listStageResources`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-REQ-004, COMPL-AC-004, PROV-AC-003, compliance.md "Test stages", DEC-0341, DEC-0355 (its "change needed elsewhere" note), `tests/compliance/harness/node-deps.ts`

compliance.md "Test stages" says the leftover check uses `listStageResources` (PROV §2 per-target operations), so the driver uses the framework's Cloudflare operations, built exactly as `remove` builds them (`cloudflareOperations({ env, requireCredentials: true })` from `cli/commands/deploy.ts`, app directory `apps/reference`). D-T2's `_cloud/stage-resources.ts` hook is not used here: it is the *independent* probe the CF/PROV/E2E tests use to check the framework's removal, and the driver's check is defined in terms of the framework's operation. `stageLeftovers` (unchanged) keeps the exact-pattern databases and the `<kind> <id>` resources.

The check runs inside the driver's process, and Node's `fetch` uses the proxy only when the process was started with `NODE_USE_ENV_PROXY=1` (DEC-0085). So `stageResourceOperations` rejects before any request, naming the variable (D-05's `cloudProcessProblems`), when `HTTPS_PROXY` is set without it, and names missing credential variables; the driver then records "leftover check failed" rather than "no leftovers" (DEC-0263). Consequence for D-RUN: start the driver as `NODE_USE_ENV_PROXY=1 npm run compliance -- --target cloudflare …` (with the placeholder `CLOUDFLARE_API_TOKEN`, DEC-0083). Cost: about 5 API requests per check (Worker settings, bucket, tokens list, `sst-state` object list, D1 list); no D1 rows.
Unit tests: `node-deps.unit.test.ts` "the driver's Cloudflare leftover check …" against D-03's in-memory account (`FakeCloud`) through a fake `fetch` (red: `stageResourceOperations` did not exist).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-06.

### DEC-0358 — Playwright test paths come before `--project`
Origin: ai-proposed · Status: accepted · Affects: compliance.md "Driver", DEC-0320, `tests/compliance/harness/selection.ts`

In Playwright 1.64.1 `--project` is variadic, so the cloud form `playwright test --project integration --project e2e tests/compliance/` read the path as a project and failed with `Project(s) "tests/compliance/" not found` (side finding of root cause 2026-10-20-E2E-004-coverage-and-not-run; reproduced here with `--list`). The selection now lists test paths first: `playwright test tests/compliance/ --project integration --project e2e` (verified with `--list`: 26 tests in 14 files). The driver and the E2E-004 listing both read `runnerSelection`, so both are fixed. The existing selection test asserted the malformed form; it was updated, citing that root-cause record's evidence, and a rule test checks that nothing but `--project <name>` pairs follows the first `--project`.
Item: D-06.

### DEC-0359 — Cloud test hooks: Cloudflare API without credentials, R2 reads through a short-lived read-only token
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: D-T2, DEC-0279, LOG-AC-004, SEC-AC-005, PROV-AC-002, E2E-011, E2E-012

`_cloud/index.ts` exports `cloudHooks(target)` with C-T1's `CloudHooks` interface (`core/support/stores.ts`). `_cloud/logs.ts` exports `listLogEntries`, and `_cloud/stage-resources.ts` exports `listStageResources`, both with DEC-0279's signatures.
- **Secrets.** The stage's Worker script is found by name (DEC-0360). `GET` and `DELETE /accounts/{a}/workers/scripts/{script}/secrets[/SECRET_<NAME>]` read and delete its secrets. That makes the store a test hook outside the framework.
- **Logs and state home.** One account API token per test process gets only "Workers R2 Storage Bucket Item Read" on `prototype-logs` and `sst-state` (DEC-0100's mechanism). It expires after 30 min and is deleted on `beforeExit`. Before creating one, the hook deletes its own expired or older-than-1-h tokens (`compliance-r2read-*`). Listing and reading go through R2's S3 endpoint with a SigV4 signer of its own: no undeclared dependency, and it was checked offline against aws4fetch. So polling a log key costs no Cloudflare API requests, which the 500-per-item cap needs. Bucket existence uses `GET /accounts/{a}/r2/buckets/{name}` (404 means absent).
- **Credentials.** No `Authorization` header is sent while a proxy is configured (plan §10.6). Without a proxy, `CLOUDFLARE_API_TOKEN` is sent as a bearer token and never printed. Every API request is counted per process and the count is printed on exit, so runs are countable.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-T.

### DEC-0360 — The stage-resource probe matches by name and includes the state home
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: D-T2, CF-AC-002, PROV-AC-003, COMPL-AC-004, E2E-012

Physical names are what SST generates (PROV §2), so the probe treats a resource as the stage's when its name contains both the app name and the stage name as delimited parts. This covers the Worker, the R2 bucket, the R2 API token, and the objects in `sst-state`. A run's stage carries 15 random characters, so no other stage can match.
- Databases use PROV-REQ-002's exact pattern.
- State-home objects are included because the Cloudflare `remove` must delete them (DEC-0084), and PROV-AC-003 says "no resource … of the removed stage".
- Log entries are excluded.
- Output strings are `database <name>`, `Worker <name>`, `R2 bucket <name>`, `R2 API token <id>` and `state object sst-state/<key>`.

If D-03 names the Worker, bucket or token without the stage name, the probe finds nothing and the tests that expect one resource per kind fail. A follow-up would then match on D-03's recorded identifiers.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Integrator note: D-03 gives the Worker, bucket and token fixed names that contain both the app and the stage name (DEC-0331), so the probe's name match finds them.
Item: D-T.

### DEC-0361 — D1 stop and two-database cap are enforced inside the tests
Origin: ai-proposed · Status: accepted; refined by DEC-0424 (one guard sequence, `takeStageRoom`, for every further stage; the lock released on every failure path) · Affects: DEC-0317, DEC-0318, D-RUN, D-RUN-M

`requireCloudD1()` blocks by default and passes only with `COMPLIANCE_CLOUDFLARE_D1=available`. The operator sets that variable once the reset is confirmed and the caps can be met. That way no D1 use happens by accident while DEC-0317 holds.

`requireDatabaseRoom(n)` counts the account's test-stage databases with one API request. It blocks when creating `n` more would hold more than two at once. Every further stage, D-T1's own and C-T1's, takes the same cross-process `further-stage` lock.

Consequences for D-RUN and D-RUN-M:
- PROV-AC-002's D1 clauses hold two databases (the failing migration's copy), so PROV-AC-002 belongs in the no-run-stage pass together with MIG-AC-002/-003/-006. Its record then holds all of its clauses (DEC-0264: the latest record decides an ID).
- PROV-AC-003 and COMPL-AC-008 hold two databases each, so they run in a milestone pass with no run stage.
- CF-AC-002 and COMPL-AC-004 fit the main pass: the run stage plus one further stage.
D-T1's per-test estimates (unmeasured basis; D-RUN replaces them with before/after readings). First deploy ≈ 50 D1 rows written, ≈ 20 read, ≈ 60 API requests; redeploy without pending migrations 0 written, ≈ 10 read, ≈ 40 requests; schema-changing deploy ≈ 40 written, ≈ 40 read, ≈ 60 requests; remove ≈ 25 requests; the hooks' read-only R2 token 4–5 requests per test process; a stage probe ≈ 5. Per test (rows written / read / API requests): CF-AC-001 0 / 0 / 0 (≈ 12 HTTP to the stage); CF-AC-002 ≈ 55 / 30 / 105; PROV-AC-001 ≈ 40 / 25 / 90; PROV-AC-002 no-D1 clauses 0 / 0 / 16, D1 clauses ≈ 110 / 100 / 230; PROV-AC-003 ≈ 105 / 50 / 200; PROV-AC-004 0 / 0 / 45; PROV-AC-006 ≈ 52 / 35 / 135; COMPL-AC-004 ≈ 50 / 25 / 120; COMPL-AC-008 ≈ 260 / 150 / 420. Passes: main (CF-AC-001, CF-AC-002, PROV-AC-001, COMPL-AC-004) ≈ 145 / 80 / 315; no-run-stage pass with the MIG criteria (PROV-AC-002) ≈ 110 / 100 / 245; milestone (PROV-AC-003, -004, -006, COMPL-AC-008) ≈ 420 / 235 / 800, which exceeds the 500-request cap, so D-RUN-M runs COMPL-AC-008 in a pass of its own after the other three (≈ 420 and ≈ 380 requests) and stops if a measurement passes a cap. D1-free clauses: PROV-AC-002 credential removed and restricted credential, PROV-AC-004 deploy without setup and setup twice, COMPL-AC-004 naming and `prodcheck`.
Item: D-T.

### DEC-0362 — Readings of CF-AC-001, CF-AC-002, PROV-AC-001
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CF-AC-001, CF-AC-002, PROV-AC-001

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
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-T.

### DEC-0363 — Readings of PROV-AC-002
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); "blocked in this sandbox" amended by DEC-0428 (blocked only while the restricted token is not supplied) · Affects: PROV-AC-002, D-05

- **"One credential removed":** `CLOUDFLARE_API_TOKEN` is removed from the deploy's environment, on a stage never deployed before. The deploy must exit non-zero and name the variable. Afterwards the independent probe must find nothing of the stage.
- **"Lacks the permission to create R2 API tokens":** the test needs an operator-supplied restricted token (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`) and a machine without the sandbox proxy. The proxy replaces every Authorization header (DEC-0083), so this clause is `blocked` in this sandbox.
- **"Failing migration":** the fixture is loaded, then the `unique-fail` overlay is deployed. The output must name the migrate step, `0001_unique_label`, "previous version restarted" and a next action. Afterwards `schema-version` must be v1, the fixture dump unchanged, and one database left.
- **"Secret removed by a test hook after the preflight":** the deploy prints no progress before step 7 is known, so the hook deletes `apiKey` at the first output that shows a later step, or 20 s into the deploy. If the deploy still stopped at the preflight, the secret is set again and the test retries once at 45 s. The output must then name the health step and `SEC.MISSING`.
- A defective preflight could create a database despite a missing credential, so these stopped deploys also take the further-stage lock and check the database cap.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Integrator note: the restricted-credential clause is the same finding as DEC-0335's open question; the two are one owner item (plan §11 Q5). The clause is always `blocked` in this sandbox.
Item: D-T.

### DEC-0364 — PROV-AC-004 and PROV-AC-006 (Cloudflare part)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: PROV-AC-004, PROV-AC-006, plan §11 Q2

- **PROV-AC-004 idempotence:** after one `setup-account`, the test snapshots the account. The snapshot covers:
  - existence of the shared log bucket and the state home;
  - both buckets' settings, CORS and lifecycle;
  - every state-home object (key, ETag, last-modified, size);
  - every non-log-entry object of the log bucket;
  - a digest of the workers.dev subdomain.

  The snapshot must be identical after a second run.
- **PROV-AC-004 "deploying without it":** this needs an account where `setup-account` never ran. The test never deletes shared resources, so the clause runs only with `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1` and an absent log bucket; otherwise it is `blocked`.
- **PROV-AC-006 (Cloudflare part):** each "clean machine" is a fresh scratch copy (committed files only) with a fresh, empty HOME and XDG directories. Machine 1 deploys and writes a KV value. Machine 2 redeploys the same stage: it must succeed, keep the same single database and still see the value. Machine 3 removes the stage and nothing is left. The region part stays not-run ("AWS phase not started").
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: D-T.

### DEC-0365 — Readings of COMPL-AC-004 and COMPL-AC-008
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-AC-004, COMPL-AC-008, D-05

- **COMPL-AC-004, naming:** the expected form `test-[a-z0-9]{PAR-291 − 5}` is read from parameters.md. It is checked for:
  - the run's stage;
  - the driver's generator and `newTestStage()`, each called twice, all distinct;
  - the stages of committed Cloudflare evidence records, all distinct.
- **COMPL-AC-004, interrupted run:** a deployed further stage is put in a temporary pending list. The real driver (`runCompliance`) then runs with real CLI stage operations and its real leftover check; only the test runners and the evidence writer are stubbed. Every resource still present afterwards must be named in the captured record's leftovers.
- **COMPL-AC-004, token left behind:** the stage's R2 API token is then re-created under its exact name and policies. A second driver cleanup whose removal skips the token must list the new token's ID among the leftovers. The token is deleted afterwards.
- **COMPL-AC-004, `prodcheck`:** a recording fake for the cloud operations shows that the driver never removes or checks `prodcheck`.
- **COMPL-AC-008:** two stages, one per abort point, are deployed at v1. Each is then deployed at v2 with the abort point, which must exit non-zero. A re-run must exit 0 and leave one database, health 204 and `schema-version` v2. The abort point's CLI form is D-05's; the assumption is the environment variable `PROTOTYPE_FRAMEWORK_ABORT_AT=after-copy|after-code`. If D-05 chooses another form, one constant in `prov/deploy-recovery.test.ts` changes.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-REQ-001, SKILL-REQ-004, SKILL-AC-001, SKILL-AC-004, DEC-0054, skill.md §2 "Implementation", `skill/examples/**`

SKILL-REQ-004 needs every example to type-check and pass `verify` in CI and to come only from `apps/template` or `apps/reference`. Code kept in a second copy that CI does not compile would drift, and fragments do not compile. So each example is a Markdown file (`skill/examples/<topic>.md`, eight files, 2.5–10 KB each, within PAR-072) holding whole files copied byte for byte from those two apps. Each copy is a fenced block directly preceded by `<!-- example-source: <repo path> -->`. The code is type-checked and tested where it lives: root `npm run verify` runs `npm --workspace apps/template run verify` and the same for `apps/reference`. E-T1 can then check SKILL-AC-004 mechanically: every block equals its source file, and no source path is under `apps/demo/`. Reference-app files were chosen only where they show an app pattern (`evolution.ts` for `atomic` and joins, `routes/levels.ts`, `encoding.ts`, `env.ts`, `config/local.json`, `tests/support.ts`). Compliance-only routes that pass client names and keys to the framework unchanged (`routes/files.ts`, `routes/kv.ts`, `routes/ref.ts`) are not shown, because an app should not copy them.
If a source file changes, the matching block must be copied again; E-T1's equality check finds the drift. The examples were made with a one-off copy script that is not committed: it read each listed path and wrote the block.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: E-01.

### DEC-0368 — `skill/templates/` holds the files an app agent fills in; the app template stays `apps/template`
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25); the placeholder Google client ID of `production-stage.json` superseded by DEC-0513 (`framework.google` left the stage-config contract) · Affects: SKILL-REQ-001, SKILL-REQ-004, SKILL-REQ-005, C-05 scaffolder, `skill/templates/**`

SKILL-REQ-001 lists "templates applied by the scaffolder". The scaffolder built in C-05 (`skill/scripts/scaffold`, not owned by E-01) copies `apps/template`. CI already type-checks and tests that template. A second copy under `skill/templates/` would need its own CI run and would drift. So `apps/template` stays the one app template. `skill/templates/` holds the other files an agent copies in by hand:
- `FRAMEWORK-ISSUE.md`, with the entry fields of SKILL-REQ-003 (task, contract or reference consulted, minimal reproduction, observed code or diagnostic, workaround not taken), plus "expected" and "blocked requirements" for the next action;
- `production-stage.json`, a production values file that is valid against `stage-config.schema.json`, with a placeholder Google client ID;
- `README.md`, saying what to copy where.
For SKILL-AC-004, E-T1 can check `production-stage.json` against the schema. The Markdown templates have no code to type-check.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-REQ-003, SKILL-AC-003, `skill/SKILL.md`

`SKILL.md` starts with YAML front matter (`name: prototype-framework` and a description), so agent runtimes that load skills can find it. SKILL-REQ-003 says "never change framework version pins". The router names the exact pins the template's `package.json` carries (`@lago-morph/prototype-framework`, `hono`, `zod`, `typescript`, `vite`, `vitest`). `zod` must equal PAR-112 (`verify` checks it), and the others are the versions the framework is tested with. The hard rules are numbered 1–7, and the `FRAMEWORK-ISSUE.md` entry fields and the next action are stated in full in the router, not only in the template (SKILL-AC-003).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: superseded by DEC-0551 (two tokens with per-command permission sets, verified live) and DEC-0550 (deploy creates no API token) (was: accepted, assumption under the owner's instruction; owner review open; not verified live) · Affects: PROV-REQ-002 step 1, PROV §2 "Credentials", DEC-0083, DEC-0100, owner-tasks.md §2, README §2

The framework verifies the token at `/accounts/<id>/tokens/verify` and creates the per-stage signing tokens at `/accounts/<id>/tokens`. Both are account-token endpoints (DEC-0083: "The token is an Account API token"). So the owner creates the token under Manage Account → Account API Tokens, not under My Profile.

The four permissions are read from the calls the framework makes:
- Workers Scripts: Edit, for the Worker, its secrets, the `workers.dev` route and the subdomain;
- Workers R2 Storage: Edit, for `prototype-logs`, `sst-state`, the stage bucket and its CORS policy and objects;
- D1: Edit;
- Account API Tokens: Edit, which `r2-token.ts` names as its permission.

No live check of a token holding exactly these four was made: the sandbox token's permissions are not visible. So the docs say to add any permission that `deploy` names. If SST's Pulumi provider needs more (for example, Account Settings: Read), D-RUN or E-RUN must amend this list.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue". Superseded by DEC-0550 and DEC-0551.
Item: E-02.

### DEC-0375 — Log lookup on Cloudflare uses the Cloudflare API's R2 object listing with the owner's existing token
Origin: ai-proposed · Status: accepted (not verified live; E-RUN's E2E-011 re-run is the check) · Affects: LOG-REQ-004, E2E-011, skill.md §2 "Troubleshooting", troubleshooting.md §1

skill.md names the dashboard, or an S3-compatible CLI with a manually created read-only R2 token. The troubleshooting reference keeps both, and adds as its main command form a `curl` to `GET /accounts/<id>/r2/buckets/prototype-logs/objects?prefix=<app>/<stage>/<yyyy>/<mm>/<dd>/`. It reads an entry with `GET …/objects/<encodeURIComponent(key)>`.

The `curl` form needs no second token. It works unchanged in the sandbox, because the proxy replaces the `Authorization` header (DEC-0083). It needs only `curl` and `node`, which every framework user has. The framework's own `listObjectKeys` uses the same endpoint without `prefix`. The `prefix` parameter and the single-object GET are unverified live; if either fails at E-RUN, the S3-CLI form in the same section is the fallback. The "no log entry" fallback is `npx wrangler tail <app>-<stage>` (the Worker name, DEC-0331).
Item: E-02.

### DEC-0376 — Stop and start are owner steps in the dashboard or the API; no CLI command is added
Origin: ai-proposed · Status: superseded by DEC-0544 (owner: `stop` and `start` commands) · Affects: CLI-REQ-001 (unchanged), DEC-0078, DEC-0090, deploying.md §4, README §9

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
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open); the 10 MiB size cap superseded by DEC-0539 (owner), the finalize pattern and type check kept · Affects: skill.md §2 "Files", SKILL-REQ-004, FILES-REQ (unchanged), `apps/template/src/server/{schema.ts,routes/files.ts}`, `apps/template/src/client/pages/files.ts`, `apps/template/migrations/*/0001_schema.*`

skill.md's upload pattern needs a record that makes a file visible, so the template could not keep listing straight from storage and still show the pattern. The smallest change that shows the whole pattern:
- a second table `uploads` (`id`, `ownerId`, `name`, `size`, `contentType`, `createdAt`), with its generated migration pair `0001_schema.sql`;
- `POST /files/upload-ticket {contentType}` returns `{ id, ticket }`, where `id = newId()` and the storage name is `uploads/<userId>/<id>`. The browser never supplies any part of the storage name;
- `POST /files/finalize {id, name}` calls `head`. A missing upload gives `HTTP.NOT_FOUND`. If the file is over 10 MiB or its type is not one of `text/plain`, `application/pdf`, `image/png` and `image/jpeg`, it is deleted and the route answers `HTTP.CONFLICT`. Only then is the row inserted. Because the storage name comes from the caller's ID, nobody can finalize another user's upload;
- `GET /files` and `POST /files/download-ticket {id}` read the rows, filtered by owner. Another user's ID gives `HTTP.NOT_FOUND`.

The type check sits in finalize only, so there is one place to change. That is files.md's own advice: "an app that cares about upload size or type can check `head` after the upload". A second finalize of the same ID meets the primary key and gets the framework's `SQL.CONFLICT`. No extra code handles it. No config key holds the limits, because constants keep the template smallest. The smoke test is unchanged: its tickets would point at the cloud, where `TestApp.request` cannot follow them.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: E-03.

### DEC-0381 — App tests upload by sending the in-process ticket's wire form
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: `apps/template/tests/app.test.ts`, files.md §2 "Implementation"/"Local", skill/reference/testing.md

No public test helper performs an upload, and `uploadFile` needs a browser. So the template test declares `WireUploadTicket { url, method, headers }`, which is the documented JSON form of a ticket (files.md §2). It sends that request with `TestApp.request`. Under `createTestApp` the URL is the same-origin `/api/__framework/files/<token>`. The test reads the ticket only as test plumbing, and app code still treats tickets as opaque. If FILES changes the wire form, this test fails and must change with it. A public `TestApp` upload helper would remove this coupling; that is a possible framework follow-up, not done here.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: E-03.

### DEC-0382 — HMAC is a helper module with unit tests, not a route or a new secret
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: skill.md §2 "Secrets", `apps/template/src/server/signing.ts`, `apps/template/tests/signing.test.ts`

`signToken(key, subject, expiresAt)` returns `<subject>.<expiresAt>.<base64url HMAC-SHA-256>`. `verifyToken(key, token)` returns the subject, or `null` for a malformed, tampered, wrongly keyed or expired token. It uses `crypto.subtle.verify` (constant-time), `btoa`/`atob`, and `now()` for expiry. It uses no `Buffer`. The tests cover valid, tampered (subject, expiry and signature), wrong key, malformed and expired tokens, with fake timers for expiry. No route uses the helper, and no `shareKey` secret is declared. A declared secret must be set on every stage, or the deploy health check fails. That would add an owner step to every template stage for a feature the template does not need. The doc comment and `secrets.md` show the key coming from `c.var.secrets.get(...)`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-AC-004, SKILL-REQ-004, PROV-AC-001 (reading in `tests/compliance/criteria/prov/template-deploy.test.ts`), decision-log entries at lines 1564 and 1599 (their mentions of "the template's `vitest.config.ts`" are now historical)

The Review left open whether to delete the file. Rule taken: delete it from an app only if nothing uses it. Checked:
- No script: neither app's `package.json` has a `test` script or any script that runs Vitest directly.
- Not `verify` or `smoke`: both start Vitest with `config: false` (`packages/framework/src/cli/verify/tests.ts`, `smoke.ts`) and set the PAR-116 glob and 60 s timeouts themselves (decision log line 1564).
- Not the scaffolder: `skill/scripts/scaffold.mjs` copies the template's files; no step reads or names the file, and no scaffolder test lists it.
- No test needs it: the PROV-AC-001 test's `ALLOWED` list only permits the name; an app without the file still passes.
- No doc tells developers to run plain `vitest` in an app; `skill/reference/testing.md` names only `verify` and `smoke`.

So both files are deleted. This also settles the record's Observation: the template has no TypeScript outside `src/` and `tests/`, so "CI type-checks … the template" holds for every file. A bare `npx vitest` inside an app now runs with Vitest defaults (5 s timeouts, SQLite only), which was never a supported test command.

Not changed: the decision log text (history) and the PROV-AC-001 reading comment, which still list `vitest.config.ts` as permitted metadata; permitting a file that is absent is harmless. The owner may trim both.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-e1.

### DEC-0391 — E2E-004 is judged at F-EV, not at C-EV
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: E2E-004, DEC-0305, DEC-0320, plan §4 C-EV, §7 F-EV, §11 Q1, `ai/implementation/evaluations/C-local.md` (flag 3)

The C-EV evaluation (`ai/implementation/evaluations/C-local.md`) recorded E2E-004 `failed` on local in run 3: its coverage part (DEC-0305, DEC-0320) reports DEMO-AC-001…-011 and E2E-002 as having no tagged test, and its pass part needs every other applicable result passed. Those criteria belong to the demo, built in phase F, so E2E-004 cannot pass before then; the root cause is accepted (`ai/implementation/root-causes/2026-10-20-E2E-004-coverage-and-not-run.md`, cause C revised). Plan C-EV listed E2E-004 as a phase C item, which was inconsistent with §11 Q1. Rule: E2E-004 is removed from C-EV's list and judged at F-EV, after the demo's tests exist. Its test is unchanged; it keeps running and reporting `failed` until then (never skipped). Owner: accept the move, or narrow E2E-004's coverage part to the components built so far.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: C/D/E integrator (from the C-EV evaluation's flag 3).

### DEC-0392 — SKILL-AC-004: a demo file equal to a block's verified template or reference source is not derivation
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-AC-004, DEC-0389, `tests/skill/example-copies.unit.test.ts`

Replaces the last sentence of DEC-0389's first bullet ("No block may equal a non-empty `apps/demo/` file.") with: "No block may equal a non-empty `apps/demo/` file unless its marker names a file of `apps/template` or `apps/reference` that exists and that the block also equals byte for byte." The marker must be present and directly adjacent, and its path must pass the plain-path and app checks; a block with no marker, or with an invalid or missing source, is still reported when it equals a demo file. The rest of DEC-0389 is unchanged.

Reason: the demo is built by copying the template (DEC-0054, prompt §9 F, `apps/demo/BUILD-RECORD.md`), so template files it keeps unchanged (the empty config files, `src/server/signing.ts`, `tests/signing.test.ts`) are byte-identical to example blocks that were copied from the template hours before the demo existed. The old proxy reported those six legitimate copies; byte equality with a demo file is not evidence of derivation when the bytes are also the block's verified source. Code taken from a demo-only file, or from a demo file that diverged from the template, is still caught (by this clause and by the byte-for-byte test).

Residual limit: demo code first copied into `apps/template` or `apps/reference` and then into an example cannot be detected from bytes; any byte-equality proxy either misses it or also flags legitimate copies. That route requires changing a verified app, which that app's `verify` and review own.

Root cause and review (ACCEPTED): `ai/implementation/root-causes/2026-10-20-SKILL-AC-004-demo-overlap.md`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-e4 (test author, §8 step 3).

### DEC-0393 — In-page clauses of DEMO-AC-001, -003 and -009 are verified by a compliance-layer browser spec, not by the demo's smoke test
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEMO, COMPL, SKILL (DEMO-AC-001, DEMO-AC-003, DEMO-AC-009, DEMO-REQ-010, demo-spec §2 preamble, `skill/reference/testing.md`, plan §7 F-03)

The demo-spec §2 preamble says the smoke test (DEMO-REQ-010) covers each criterion on a deployed stage except those it lists; the in-page clauses of DEMO-AC-001 ("renders as text"), DEMO-AC-003 ("displays") and DEMO-AC-009 ("the copy button copies it") are not in that list. This entry records a deviation from that preamble; `docs/demo/demo-spec.md` itself is not edited, because it is one of the fresh F-01 builder's three inputs (E2E-015) and states how binding criteria are verified.

Rule: those in-page clauses are verified by a compliance-layer Playwright spec, `tests/compliance/e2e/demo-pages.spec.ts` (tagged exactly DEMO-AC-001, DEMO-AC-003, DEMO-AC-009; outside `apps/demo/**`), locally against the demo under `dev` and on Cloudflare against the F-03 `test-` stage before it is removed; the AWS part is `not-run` under plan §8.2 only. The demo's smoke test covers their API side, and DEMO-REQ-010's "exercises each requirement" is read as met by that API-side exercise. The ACs and DEMO-REQ-010 are unchanged.

Reason: apps have no browser tests by design. Playwright is scoped to browser-level compliance tests (PAR-114, compliance.md); it is not an app dependency; SKILL.md hard rule 1 limits what `tests/**` may import; and `verify` and `smoke` run only Vitest `*.test.ts` files over HTTP (PAR-116, cli.md). The demo's smoke test therefore cannot cover page-only behaviour, and the demo builder correctly raised this as FRAMEWORK-ISSUE #1 instead of working around it. `skill/reference/testing.md` now states, app-generically, that an app's tests and smoke test reach it through its API and that page-only behaviour is checked by the framework's browser tests.

Root cause and review (ACCEPTED, fix amended): `ai/implementation/root-causes/2026-10-20-F-02-round-3-demo-issues.md`.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: superseded by DEC-0499 · Affects: CORE-AC-006, SQL-AC-006, tests/compliance/harness/expected.ts

`PHASE_RULES` gains two part rules on `local`, automated tier, detail `AWS phase not started` (plan §8.2), shaped like CHECK-AC-005's demo part: CORE-AC-006 part "AWS-bundle clause" (no AWS bundle yet) and SQL-AC-006 part "Data API retry-loop clause" (the Data API adapter is AWS code, not built). Only `local`: the SQL-AC-006 clause is stated as local and deterministic, and CORE-AC-006 is Local only; on Cloudflare SQL-AC-006 has no not-run part. The AWS phase removes both rules when it adds their tests.
Item: C-T6.

### DEC-0398 — The driver deploys, sets `apiKey` through `secrets set`, and deploys again
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEC-0277, DEC-0366, compliance.md "Driver", `tests/compliance/harness/{driver,node-deps,env}.ts`, SEC-AC-001, SEC-AC-002, HTTP-AC-002, CORE-AC-002, D-RUN

- **When.** Only for a run stage the driver deploys itself (cloud target, no `--base-url`). Local runs are unchanged: the value stays in `apps/reference/.dev.vars`, set by the operator (DEC-0277). A cloud pass on a given `--base-url` (the MIG pass, DEC-0355) generates and sets nothing; an exported `COMPLIANCE_SECRET_API_KEY` still passes through there as before.
- **Sequence.** `deploy` → generate → `secrets set apiKey --target <cloud> --stage <stage>` → `deploy` again. The first deploy of a new stage stops after step 5 with "required secrets are not set: apiKey" and the app stopped (provision core `checkSecretsAfterFirstCode`); the CLI wrapper recognises that output (or the preflight's "secret <name> is not set (set it with secrets set)") and rejects with `SecretsNotSetError`, which the driver accepts; any other deploy failure propagates unchanged (no retry, no secret). The second deploy always runs, also when the first one succeeded (a reused `--stage` that already had a value): it starts the stopped app and its health check passes only on the version that has the new secret, which is simpler and safer than relying on the secret PUT's own version roll-out (DEC-0092: a few seconds' delay).
- **Value.** 32 characters from `[A-Za-z0-9]`, `crypto.randomInt` per character (≥ 12 as `testSecretValue()` needs). Generated in the driver process per run, held only in memory.
- **Setting it.** The framework's own path (D-05, DEC-0354): `npx prototype-framework secrets set apiKey …` in `apps/reference`, the value written to the process's standard input, never an argument. Its output (which never contains the value, CLI-REQ-004) is kept as `raw/secrets-set.log`, redacted again defensively. `CloudStageOps.setSecret` is optional in the interface so cleanup-only operation objects (COMPL-AC-004's test) need not provide it; the driver fails the setup with a clear message if a deploying target lacks it.
- **Handing it to the tests.** `COMPLIANCE_SECRET_API_KEY` in the environment of the vitest and Playwright processes only (`env.ts` `ENV.testSecret`, `childEnv({ testSecret })`); the build and typecheck processes do not get it.
- **Never logged or committed.** The value is added to the evidence writer's redactions (`<test-secret>`) before it is set, so a failure after that point still redacts; the writer applies them to the record and every raw file. The driver's own output lines go through the same redactions (this also applies the existing account-subdomain redaction to them). The live echo of a process given values to hide (the test runners, `secrets set`) is written a line at a time with the values replaced, so a value split across two output chunks is still hidden.
- **Raw files.** `deploy.log` (first deploy), `secrets-set.log`, `redeploy.log`.
- **Check.** `driver.unit.test.ts` "[COMPL-AC-004] the test secret on a cloud run stage": the real evidence writer, into a temp root, with a fake test run that prints the value in its output and its failure message: no written file contains the value, the raw log shows `<test-secret>`, and no driver log line contains it; plus no command line carries it and the build/typecheck environment lacks it. `node-deps.unit.test.ts`: the generator's form, the unset-secrets recognition, standard input plus line-wise echo redaction on a real child process, and the request count below.

Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-AC-001, DEC-0386 (third bullet strengthened)

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-AC-004, DEC-0389

"CI type-checks and runs every example." Examples copy `apps/template/index.html`, `src/client/main.ts`, `src/client/dom.ts` and `src/client/pages/{account,admin,files,notes,status}.ts`. No app test executes them; the app tests reach server routes only. New `tests/skill/example-pages.test.ts` (integration layer, so the driver runs it):
- a static check: every example source that is an `index.html` or under `src/client/` must be loaded by the template's `index.html` (its module script, then the relative non-type imports). So the run covers each one, and a new browser example outside that graph fails;
- a run: a scratch copy of `apps/template` (greeting set, `apiKey` set with `secrets set`) is served with `dev` and driven in Chromium by `tests/compliance/e2e/support/template-pages.ts`, the same driver E2E-001 uses. That covers the greeting, log in and out, Notes, Status (kept after reload), Files upload and download, and the admin secret check. All 7 steps must pass, with no uncaught page exception. The driver now also reports `pageErrors` (Playwright `pageerror`). E2E-001 reads only `steps`, so it is unaffected.

Server-side example files are executed by the apps' `verify` tests, which load `src/app.ts` and so every route module. No per-file coverage check was added: the criterion asks that the examples run, and module load plus the route tests meets that.

The run is not in root `npm run verify`. Putting it there needs a wiring line outside test files, in root `package.json` `verify`: append `&& vitest run --config vitest.integration.config.ts tests/skill/example-pages.test.ts`. It needs the framework built (verify builds it first) and Chromium (`/opt/pw-browsers`). It takes about 20 s. Not applied: changing root scripts is shared configuration (plan §1 rule 1 then requires a full `verify`), so it is left to the orchestrator.
Integrator note: item fix-e3 has since appended that line to root `verify` and ran full `verify` online and offline (same root-cause record, Fix item 2); the status is left as drafted.
Item: E-T2.

### DEC-0405 — SKILL-AC-004: the byte-for-byte example check runs in root `verify` (F3)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: SKILL-AC-004, DEC-0384

`tests/skill/examples.test.ts` was split into two files:
- `tests/skill/example-copies.unit.test.ts` holds the file-only checks: markers, no `apps/demo/`, byte-for-byte equality, sources inside what `verify` covers, and the root `verify` wiring. The unit include glob `tests/**/*.unit.test.ts` collects it, so `npm run test:unit` and therefore root `npm run verify` run it. The integration glob `tests/skill/**/*.test.ts` also collects it, so the driver's integration run still evidences SKILL-AC-004 from it. The driver's unit run is limited to `UNIT_LEVEL` and ignores it. No configuration changed. A new tagged test asserts this wiring: root `verify` runs `test:unit`, which uses `vitest.unit.config.ts`, which includes `tests/**/*.unit.test.ts`.
- `tests/skill/examples.test.ts` keeps only the two apps' `verify` runs (minutes long). Root `verify` runs those apps' `verify` itself.
Item: E-T2.

### DEC-0406 — CHECK-AC-003 covers the five migration-checker rule IDs (F4)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-AC-003, DEC-0187

"Every rule's diagnostic" includes the migration checker's five rule IDs (check.md §2). New `packages/framework/test/integration/check/migration-diagnostics.test.ts` runs the real `verify` on three fixture apps (`apps/base` + `mig/base`; three apps so that one break cannot hide another). For each rule it requires a line in the check.md §2 layout carrying that rule ID, a message that names the construct (the location prefix is excluded), and a `skill/reference/*.md` that exists:
- `migration-checksums`: a comment appended to a generated migration; the message names that migration.
- `migration-history`: a pair numbered two past the last, recorded in checksums; the message names the file.
- `migration-dialects`: a column added to one dialect only, checksum kept; the message names the column.
- `migration-supported-changes`: a column renamed by hand in both dialects; the message names the file and both columns.
- `migration-apply`: an `ALTER TABLE` on a missing table; the message names the file and the missing table.

All 5 pass.
Item: E-T2.

### DEC-0407 — The CHECK-AC-003 coverage control is tagged and checks "exactly one" (F5)
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: CHECK-AC-003

The control in `portability-rules.test.ts` is now tagged `[CHECK-AC-003]`, so the driver runs it. It was untagged and showed as `skipped`. Before, it mapped `RULES` through `some(...)`, so a rule with two representative fixtures passed. Now it lists every representative fixture's rule, plus the other representatives, and requires that list sorted to equal `ALL_RULES`. So each rule has exactly one, none missing and none twice. It passes.
Item: E-T2.

### DEC-0408 — A criterion is defined only by a row of a `| ID | Criterion | Verifies | Where |` table
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL-REQ-001, COMPL-REQ-002, COMPL-AC-001, compliance.md "Driver", DEC-0319

Before this decision the driver's catalogue (`tests/compliance/harness/catalogue.ts`) took any `| <AREA>-AC-NNN | … |` row of three or more cells anywhere under `docs/` as a definition, with its last cell as the Where text, and the COMPL test's independent reader (`tests/compliance/criteria/compl/support.ts` `whereSets`) took such a row of any width. DEC-0319's two-column table of criterion IDs in the decision log broke the test's reader; a three-column one would have broken the driver ("defined twice"). `docs/CONVENTIONS.md` does not define the criteria table format; every defining document uses the same header, which COMPL-AC-001 ("the criteria's "Where" columns") relies on.

Rule (both readers, implemented separately; the test shares no code with the harness):
- A row defines a criterion only when it is a body row of a table whose header row has the cells `ID`, `Criterion`, `Verifies`, `Where`, in that order (compared after trimming), with a `| --- |` separator row next. The table ends at the first line that does not start with `|`.
- The ID and the Where text are read from the `ID` and `Where` columns by index. An escaped `\|` inside a cell does not split it.
- Inside a criteria table, a body row whose cell count differs from the header's, or whose ID cell is not `<AREA>-AC-NNN`, throws with the file and line. A header row whose first two cells are `ID | Criterion` but which is not exactly that header with a separator next also throws. Rows outside criteria tables are ignored, whatever their width.
- Scenarios are unchanged: a `#### E2E-nnn` heading followed by a `Where:` line.

On the real `docs/` both readers give the same 140 IDs (124 criteria, 16 scenarios) and the same per-target, per-tier sets as before the change. No doc change: DEC-0319's table stays as written. Stating the rule in compliance.md "Driver" is left to the owner.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-e2 (root cause 2026-10-20-COMPL-AC-001-where-parser-decision-log).

### DEC-0409 — `TestApp.dispose` states that in-process views share disposal
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: `docs/contracts/ts/testing.d.ts` (`TestApp.dispose` doc comment), DEC-0193, `skill/reference/testing.md`

No type or behaviour change. The doc comment on `dispose` now states the behaviour DEC-0193 and `test-app.ts` already have: in-process, the original test app and every test app made from it with `as` share one app, so disposing any of them disposes all and later requests through any of them reject; on a connected stage it only logs that test app out and stage data is kept. Changing in-process behaviour (making a view's `dispose` a no-op) is not proposed; it would need its own decision.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; accepted under the owner's instruction of 2026-10-25 ("you should not be asking detailed minor questions about things you designed yourself with no input from me").
Item: fix-f1 (root cause 2026-10-20-F-02-round-1-demo-issues, entry 4).

### DEC-0410 — The spec finds the demo through `COMPLIANCE_DEMO_BASE_URL`, or starts it locally
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: COMPL (compliance driver usage), DEMO, plan F-03

The driver starts or deploys the reference app only, and `COMPLIANCE_BASE_URL` names that app. The spec therefore does not use the harness `baseURL`. It works out the demo's origin like this:
- If `COMPLIANCE_DEMO_BASE_URL` is set, the spec uses that origin, on any target.
- If it is unset and the target is `local`, a `beforeAll` copies `apps/demo` to the git-ignored `.framework/e2e/demo-pages-<random>/`, the same way `support/apps.ts` copies apps for other E2E specs. It starts `dev` there with `support/process.ts` `startDev` and stops it in `afterAll`. Each run starts from fresh local state, and the tree stays clean (the driver's evidence check).
- If it is unset on a cloud target, every test calls `prerequisiteMissing`, so the criteria are recorded `blocked` with a reason, never passed or `not-run`.

**No driver or harness wiring was needed.** The driver passes its whole environment to Playwright (`childEnv`), so the variable reaches the spec unchanged. F-03 runs the spec against the demo's `test-` stage before it removes that stage:
`COMPLIANCE_DEMO_BASE_URL=<demo stage origin> npm run compliance -- --target cloudflare --base-url <demo stage origin> --only DEMO-AC-001,DEMO-AC-003,DEMO-AC-009`
With `--base-url`, the driver deploys no reference stage. The cloud cost is two posts, four photo, publish and delete calls, and one about 24 MB R2 object, which is deleted. That is tens of D1 rows. The F-03 estimate rules still apply.
Item: fix-f4b.

### DEC-0411 — Selectors come from the demo specification, not the round-3 demo
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEMO, COMPL

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
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: DEMO-AC-001, DEMO-AC-003, DEMO-AC-009

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

## Implementation phase: local and Cloudflare — F-04 fixes for E2E-016 (2026-10-20)

Entries DEC-0413 and DEC-0414 were integrated by the integrator from the drafts of items fix-f04a and fix-f04b (plan §10.4). Neither item made a Cloudflare call. No parameter changed. DEC-0414 supersedes the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329; both entries are marked partly superseded. No line was added to `validation/invalidations.md`: it is still empty and no milestone record exercising FILES downloads exists.

### DEC-0413 — Docs-only portability notes invalidate no milestone record
Origin: ai-proposed · Status: accepted · Affects: COMPL-REQ-006, E2E-016, docs/components/{aws,check,cli,cloudflare,compliance,local,skill}.md

COMPL-REQ-006 requires a milestone item to be run again "after a change to PROV, MIG, CF, AWS, or adapter code". "Code" qualifies the whole list, so adding the `## 5. Portability note` sections (E2E-016 R-01) to these documents, `cloudflare.md` and `aws.md` included, is not such a change: it invalidates no milestone record and needs no `validation/invalidations.md` entry. The R-01 root-cause Review confirmed this reading (`ai/implementation/root-causes/2026-10-20-e2e-016-r01-portability-notes.md`, Review, "COMPL-REQ-006 reading"). E2E-016 (review part) is recorded again by the F-04 re-review in any case.
Item: fix-f04a.

### DEC-0414 — Every download is `attachment; filename*=…` on every target, raster images included
Origin: ai-proposed · Status: superseded by DEC-0535 (owner, 2026-10-25) for PNG, JPEG, GIF and WebP, which are now `inline`; still in force for every other type · Affects: DEC-0313, DEC-0329, FILES-REQ-003, COMPL-REQ-001, E2E-009, files.md §2 ("Download names", Local), `skill/reference/files.md` "Downloads", `packages/framework/src/files/{cloudflare/disposition.ts, cloudflare/tickets.ts, local/route.ts}`, D-02

Supersedes the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329. A storage response to a download ticket carries `Content-Disposition: attachment; filename*=UTF-8''<RFC 8187 value-chars of the whole name>` for every content type, raster images included, on local and on Cloudflare. `downloadDisposition(name)` takes no content type; `RASTER_IMAGES` and `isRasterImage` are removed; the Cloudflare issuer's `download` takes only the name. The local route keeps `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. `service.ts`, `TicketIssuer` and `targets/cloudflare/tickets.ts` are unchanged: they already pass no content type, which is now the whole contract (the third gap of the R-06 record, E3, closes because nothing needs a content type any more). DEC-0329's other content stays: the one shared helper, the RFC 8187 encoding, R2's signed `response-content-disposition`, and D-RUN's check that R2 honours it on a presigned GET.

Reasons: (1) no FILES REQ, contract or AC asks for inline images; "displays" in DEMO-REQ-003, DEMO-AC-003 and E2E-009 is met through `<img src>`, which ignores `Content-Disposition`. (2) The old behaviour differed by target (local `inline`, Cloudflare `attachment`), which COMPL-REQ-001 forbids without a criterion that states it. (3) R-06 experiment E9: across origins Chromium ignores `<a download>`, so an `inline` image on an R2 ticket URL would navigate instead of downloading and break E2E-009 on Cloudflare. Evidence: `ai/implementation/root-causes/2026-10-20-e2e-016-r06-raster-inline-disposition.md` and its Review; the parity test "a raster image downloads with the same Content-Disposition on local and Cloudflare" in `packages/framework/src/files/local/route.unit.test.ts` failed before the fix (local `inline; filename*=UTF-8''p.png`, Cloudflare `attachment; filename*=UTF-8''p.png`) and passes after it.

Visible change: locally, a raster download opened in a new tab (the demo's `target=_blank` photo link, the template's `window.open`) now downloads instead of displaying, as it already did on Cloudflare. Images shown with `<img src>` still display; no requirement or test depends on the old behaviour (plan §11 Q5).

For the integrator: DEC-0313's status still reads "not yet implemented", which is stale (implemented by D-02, `disposition.ts`); mark it. Invalidations: none needed (`validation/invalidations.md` is empty and no milestone record exercising FILES downloads exists); if one is recorded before this merges, add a line for it (COMPL-REQ-006, adapter code).
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-f04b.

## Implementation phase: local and Cloudflare — dev-registry fixes (2026-10-20)

Entries DEC-0415 and DEC-0416 were integrated by the integrator from the drafts of items fix-registry and fix-registry-2 (plan §10.4). Neither item made a Cloudflare call. No parameter changed. DEC-0416 moves DEC-0415's registry override into a shared helper; DEC-0415's content otherwise stays. Both refine DEC-0105, which is marked. LOCAL was added to check.md §3 "Uses" (DEC-0416, Placement); provisioning.md §3 lists no test dependencies, so `fake-d1-api.ts` needs no note there.

### DEC-0415 — A test app never joins Wrangler's local dev registry
Origin: ai-proposed · Status: accepted · Affects: DEC-0105, `docs/contracts/ts/testing.d.ts` ("fresh local storage"), core.md §2 "Testing", `packages/framework/src/testing/test-app.ts`, `packages/framework/src/testing/test-app.unit.test.ts`

`createTestApp` starts its platform proxy with Miniflare's host-wide dev registry (`~/.config/.wrangler/registry`, or `WRANGLER_REGISTRY_PATH`) turned off. `getPlatformProxy` has no option for this, so `startPlatformProxy` sets `WRANGLER_REGISTRY_PATH=""` (which Miniflare treats as disabled) around only the synchronous `getPlatformProxy(...)` call, passes `remoteBindings: false` so that Wrangler reads the variable before its first `await`, and restores the previous value, or its absence, in `finally` before anything else runs. The proxy is still `getPlatformProxy` (DEC-0105); `remoteBindings: false` changes nothing for the generated D1 + R2 config, which has no remote bindings. `dev` and the other `getPlatformProxy` callers (`check/migrations/databases.ts`, `provision/cloudflare/d1/fake-d1-api.ts`) are unchanged; moving them to a shared helper is a separate follow-up item.

Reasons: (1) a test app has no cross-Worker bindings, and the contract promises fresh, isolated local storage; joining the registry under the fixed name `test-app` was a hidden host-wide dependency. (2) With a live foreign `test-app` entry, a `Date` faked into the past (the documented expiry-test pattern) turned Miniflare's registration retry into a 1 ms loop of `TimeoutOverflowWarning`s, and a `Date` faked into the future deleted other processes' live entries. (3) A whole-process override would leak into `wrangler dev` children; bypassing `getPlatformProxy` would go against DEC-0105.

Risk and guard: the fix depends on a Wrangler internal (the variable is read before the first `await` when remote bindings are off). The `describe("createTestApp and the dev registry")` tests fail if an upgrade moves that read, and they also assert that the variable is restored after `createTestApp`.

Evidence: `ai/implementation/root-causes/2026-10-20-testing-dev-registry.md` (diagnosis, Review, and "Fix" with the red-green table): before the fix the three tests failed (own entry written; `expected 229 to be +0` warnings; both foreign entries deleted); after it they pass, with the existing `createTestApp` tests.
Item: fix-registry.

### DEC-0416 — One registry-free platform-proxy helper for the framework's in-process tools
Origin: ai-proposed · Status: accepted · Affects: DEC-0105, DEC-0415, core.md §2 "Testing", `packages/framework/src/targets/local/platform-proxy.ts` (new), `packages/framework/src/testing/test-app.ts`, `packages/framework/src/check/migrations/databases.ts`, `packages/framework/src/provision/cloudflare/d1/fake-d1-api.ts`, and their unit tests

The scoped `WRANGLER_REGISTRY_PATH=""` override of DEC-0415 moves out of `test-app.ts` into one shared helper, `startPlatformProxy<Env>(configPath)` in `src/targets/local/platform-proxy.ts`. It calls `getPlatformProxy({ configPath, persist: false, remoteBindings: false })` with the dev registry turned off only for the synchronous part of the call, and restores the previous value, or its absence, before any `await`. Three callers use it: `createTestApp`, the migration checker's local D1 (`check/migrations/databases.ts`, Worker name `migration-checker`, loaded lazily with `await import(...)` as `wrangler` was before), and the fake D1 HTTP API (`provision/cloudflare/d1/fake-d1-api.ts`, fixture name `d1-unit-tests`). `dev` (`src/cli/dev/*`) is unchanged: there, joining the registry is ordinary `wrangler dev` behaviour.

Placement: the helper is the local target's emulated storage (LOCAL, local.md introduction: "local emulations of storage"), so it lives under `src/targets/local/`. It is an internal Node-only module, not on the `./targets/local` subpath (`public.ts`), and no Worker entry point imports it. `src/testing/` was the other option the plan named, but it is CORE's `./testing` harness, and the migration checker runs in app developers' `check` and `verify`, not in tests. CHECK's and PROV's design docs (§3 "Uses") do not list LOCAL; the integrator may add it to check.md §3 (PROV's only user is test support, `fake-d1-api.ts`).

Reasons: (1) all three callers have no cross-Worker bindings, and each used a fixed Worker name, so two processes at once gave each other a 90 s registration retry, and a faked `Date` would give the 1 ms loop or the deletion of other processes' entries (root cause, Review §4). (2) One copy of a Wrangler-internal dependency, not three. (3) The checker is unchanged in behaviour: `remoteBindings: false` selects nothing for its D1-only config (`cli.js:185543-185545`).

Risk and guard: as in DEC-0415, the helper depends on Wrangler reading the variable before its first `await`. Each caller has its own guard test, which fails if an upgrade moves the read: `describe("createTestApp and the dev registry")` (`test-app.unit.test.ts`, kept unchanged), `describe("sqlite check database and the dev registry")` (`databases.unit.test.ts`) and `describe("fake D1 HTTP API and the dev registry")` (`fake-d1-api.unit.test.ts`). The two new tests use a scratch registry through `vi.stubEnv` with two live foreign entries, and assert that no entry is written while the instance is live or after it closes, that the foreign entries survive, and that the variable equals the stubbed path after the open resolves. Neither caller runs under fake timers anywhere in the repository (grep for `useFakeTimers` and `setSystemTime`), so they use the real clock.

Evidence: red, before the callers changed: each new test failed with the caller's own entry in the registry (`d1-unit-tests`, then `migration-checker`, each with `instanceId` and `debugPortAddress`). Green, after: the three files pass (31 tests). `~/.config/.wrangler/registry` was empty throughout.
Item: fix-registry-2.

## Implementation phase: local and Cloudflare — `dev` port binding fix (2026-10-21)

Entry DEC-0417 was integrated by the integrator from the draft of item fix-mig002 (plan §10.4). The item made no Cloudflare call. No parameter changed. DEC-0417 refines DEC-0204's ports sentence, which is marked. cli.md §2's `dev` bullet now starts Vite first and then `wrangler dev`, each on port 0 with the real port read back, and local.md §2 names Vite before Wrangler; the skill states no start order or port.

### DEC-0417 — `dev` binds its ports itself: Vite first, then Wrangler on port 0 for the Worker and the inspector
Origin: ai-proposed · Status: accepted · Affects: DEC-0204, local.md §2, cli.md §2 (`dev` bullet), LOCAL-REQ-004, `packages/framework/src/cli/commands/dev.ts`, `packages/framework/src/cli/dev/plan.ts`, `packages/framework/src/cli/dev/runtime.ts`, and their unit tests

DEC-0204's sentence "Ports are free loopback ports picked at start." becomes: "No port is picked before its bind. Vite starts first on loopback port 0, and its bound port is the public origin. Wrangler then starts with `--port 0 --inspector-port 0` (still `--ip 127.0.0.1` and `--inspector-ip 127.0.0.1`) over an `ipc` channel. `dev` takes the Worker's port from wrangler's `DEV_SERVER_READY` IPC message, or else from its `Ready on http://127.0.0.1:<port>` line, and then points Vite's `/api` proxy at it. Until then `/api` answers 503. If Vite's bind fails with its own structured `EADDRINUSE`, `dev` starts the client again, at most 3 attempts in all, and prints each retry to stderr with the port and the attempt. After the last attempt it fails with Vite's original error and exits 1. It re-runs nothing else, and any other failure ends `dev` at once." In DEC-0204's process-layout sentence, "Wrangler ... then Vite" becomes "Vite, then Wrangler". cli.md §2's `dev` bullet says the same: it starts Vite on `127.0.0.1` first, then `wrangler dev` on a loopback port that Wrangler binds itself. Nothing else in DEC-0204 changes: the Host check, the loopback-only listeners, the printed origin, the stop behaviour and the exit statuses.

Reasons:
1. The root cause, ai/implementation/root-causes/2026-10-20-mig-ac-002-workerd-crash.md (Review, Required change 1), found that `freePort()` (listen on port 0, read the port, close) leaves a 1–2 s window before workerd binds the port. In that window another socket can take it, and workerd then dies with `bind(): Address already in use` (F2). With port 0, the kernel picks the port during workerd's own bind, so it never hands out one that is in use. wrangler 4.149.0 passes 0 through unchanged (`cli.js:374922-374931`, `:212070`) and sends `DEV_SERVER_READY` when it has an IPC channel (`cli.js:374832-374843`).
2. Vite 8.3.4 has no race-free port 0. `httpServerStart` (`vite/dist/node/chunks/node.js:14687-14696`) also picks an ephemeral port with `getAvailableEphemeralPort`, releases it, and then binds it. So the client port keeps a short window, and the Review's bounded retry (reason 4) covers it. The retry depends only on a structured error code. Vite's `listen` rethrows `EADDRINUSE` as a plain `Error("Port N is already in use")`. The real `startClient` therefore reads the code from the http server's own `"error"` event and throws `ClientPortInUseError` (carrying Vite's original error) only when that code is `EADDRINUSE`. Output text is never matched. A middleware-mode Vite on a server `dev` binds itself would remove this window as well, but it would change Vite's HMR, restart and host handling. That is a larger change than this fix needs.
3. The late `/api` target: Vite hands the proxy's `configure(proxy, options)` the same options object that its http-proxy spreads into every request (`node.js:19928-19929`, `:19734-19740`). Setting `target` on that object after Wrangler reports its port takes effect on the next request. Until then, the first middleware answers 503 for `/api`. No request can arrive before the URL is printed, because the URL is printed only after `proxyApiTo`.

Inspector: still enabled, and on loopback. In one local `dev` run of a scratch copy of `apps/reference` (no Cloudflare call), every listener of the dev process group was on 127.0.0.1. `GET /json/version` answered `{"Browser":"wrangler/v4.149.0","Protocol-Version":"1.3"}` on one listener (wrangler's inspector proxy) and `{"Browser": "workerd", ...}` on another. `/api/auth/me` through Vite answered 200.

Evidence:
- Red, before the change:
  - `test/integration/local/dev.test.ts` "serves even when every port freePort returns is taken by another socket before dev binds it" failed with `dev ended before serving: Error: Port 39191 is already in use`.
  - The new `plan.unit.test.ts` tests failed: the args held the picked ports, and `devServerReadyPort` and `readyLinePort` did not exist.
- Green, after the change: both pass, with the CLI unit suite and the local `dev` integration suite. See the record's red-green table.
Item: fix-mig002.

## Implementation phase: local and Cloudflare — Cloudflare API request budget (2026-10-23)

### DEC-0418 — Cloudflare API request budget follows Cloudflare's own rate limit
Origin: owner · Status: accepted · Affects: plan §1 "Cloud usage limits", plan §5 D-RUN pass schedule

The owner asked (2026-10-23) to raise the API request budget to one appropriate to Cloudflare's actual limits. Cloudflare's global API rate limit is 1,200 requests per 5 minutes per user, counted across the dashboard, API keys and API tokens; exceeding it blocks all API calls for 5 minutes with HTTP 429. There is no daily cap. GraphQL analytics have a separate 300 queries per 5 minutes (developers.cloudflare.com/fundamentals/api/reference/limits/, /analytics/graphql-api/limits/). The per-pass cap of 500 requests (plan §1, set after the phase A D1 incident) is replaced by: ≤ 2,000 Cloudflare API requests per pass, never more than 1,000 in any 5-minute window (headroom for the owner's own dashboard use), and stop on the first HTTP 429. API requests are not billed; the D1 caps (≤ 1,000 rows written and ≤ 10,000 read per pass, ≤ 10,000 written per UTC day, ≤ 2 databases at once) are unchanged. Passes that the pass schedule split only to stay under 500 requests may be merged again.

### DEC-0419 — D1 budget set from the free plan's limits; no stress tests
Origin: owner · Status: accepted · Affects: plan §1 "Cloud usage limits", DEC-0317, DEC-0318, DEC-0418

The owner (2026-10-23): the free D1 limits are 5,000,000 rows read and 100,000 rows written per day; adjust the budget, there is no need for crippling limits; do not run stress tests. New caps: per pass ≤ 10,000 rows written and ≤ 500,000 read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read (half the free limits, leaving headroom for the owner's own use); ≤ 4 D1 databases at once (account limit 10); raised the same day by the owner to ≤ 8 D1 databases at once. The rule that prevents a repeat of the phase A incident stays: no stress tests, load tests, platform-limit probing or row loops; tens of rows per test; measure D1 usage before and after every pass. The earlier ≤ 1,000 written / ≤ 10,000 read per item and ≤ 2 databases at once are superseded; DEC-0318's two-database rule no longer forces separate passes.

### DEC-0420 — Cloudflare credentials come from the environment, not proxy injection
Origin: owner · Status: accepted · Affects: plan §10.6, plan §5 D-RUN, DEC-0083, DEC-0107, DEC-0335, DEC-0363

On 2026-10-24 the owner changed the cloud environment: the sandbox proxy no longer injects a token for `api.cloudflare.com`, and a real API token is provided as the environment variable `CLOUDFLARE_API_TOKEN`. Reason: the proxy replaced every `Authorization` header, so the Workers static-asset upload, which must be authorised with the upload-session JWT, always failed with 401 (validation/cloudflare/pass-1b/SUMMARY.md). Verified: a request with no header or a fake token now returns 400; a request with the environment token returns `active`. Tools use the variable directly; the placeholder value of DEC-0083/DEC-0107 is no longer set. The token value is never printed, logged or committed; evidence is grepped for it. PROV-AC-002's restricted-credential clause, blocked only because the proxy replaced every header (DEC-0335, DEC-0363), may now be runnable.

## Implementation phase: local and Cloudflare — Cloudflare live testing (2026-10-23/24)

Entries DEC-0421 to DEC-0431 were integrated by the integrator from the drafts of items fix-pass0, fix-cloudtests, fix-pass1, fix-envtoken, fix-auth005, fix-r2order and fix-sec001 (plan §10.4), written after Cloudflare passes 0, 1, 1c and 2. Each entry keeps its draft's wording and status. The integration made no Cloudflare call. No parameter changed (`CLOUD_WAITS.secretRolloutMs` of DEC-0431 is a test-harness wait bound, not a parameter). Marked in place: DEC-0270 (409 reading amended by DEC-0421), DEC-0336 ("Steps" amended by DEC-0427), DEC-0162 ("Order" amended on Cloudflare by DEC-0430), DEC-0328 (stored key extended by DEC-0430; its rule is unchanged in effect), DEC-0286 (stage layout amended by DEC-0423, its D1 reads' Authorization header by DEC-0428), DEC-0318 and DEC-0361 (guards applied to every further stage by DEC-0424), and DEC-0335 and DEC-0363 (the sandbox refusal of PROV-AC-002's restricted-credential clause removed by DEC-0428, applying DEC-0420). DEC-0429 and DEC-0430 are open for owner review (plan §11 Q5); the owner items from these passes are plan §11 Q11–Q14.

### DEC-0421 — A bucket-creation conflict is read back, not taken as foreign (amends DEC-0270)
Origin: ai-proposed · Status: accepted · Affects: DEC-0270, DEC-0334, PROV-REQ-004, PROV-AC-007, `packages/framework/src/provision/cloudflare/account.ts`

DEC-0270 read every HTTP 409 from `POST /accounts/{account}/r2/buckets` as "foreign". Pass 0 check 3 (`validation/cloudflare/pass-0/logs/responses.jsonl`, label `c03-create-existing`) disproved that reading. Creating `prototype-logs` while this account already had it answered 409, code 10004, "The bucket you tried to create already exists, and you own it." R2 bucket names are scoped to an account (DEC-0334 item 1), so a 409 on this account's path means the bucket exists in this account.

Amended reading: on a 409, `createBucket` reads the bucket back with the same `GET /accounts/{account}/r2/buckets/<name>` that inspection uses (DEC-0270's GET readings):
- 200 → owned: no error, because the end state PROV-REQ-004 requires is reached;
- 403 → foreign: "`R2 bucket <name>` already exists but belongs to another account (or this account's credentials cannot read it); nothing was created";
- 404 → an error naming the bucket and `HTTP 409`, with "reading it back found it absent";
- any other answer → inspection's error, "checking `R2 bucket <name>` failed: …".

The code does not rely on the 409 message text, which is not a contract. The read-back costs one GET, and only on a 409. DEC-0270's other readings are unchanged. The 200, 404 and 409 answers are now confirmed live by pass 0 (checks 1–3). The 403 reading stays unverified, because one account cannot produce it (DEC-0334). PROV-AC-007 goes through inspection's GET 403 and is unaffected. The fake (`fake-cloud.test-support.ts`) now answers with the live 409 message.

**Known limitation, accepted and not fixed:** the 409 path is reached only when the bucket appears between `setup-account`'s inspection GET (404) and its POST: a concurrent `setup-account`, or a bucket created by hand. In that race `setup-account` still prints `created: R2 bucket <name>` (`core/setup-account.ts`), although another process created it, because `createSharedResources` returns `void` and `created` is built from its input list. The end state, an owned bucket, is the required one, and no requirement fixes the output wording. Changing it would widen the target-neutral `TargetOperations` interface and the `SetupAccountResult.created` contract, which is out of scope for this fix.

Evidence: `ai/implementation/root-causes/2026-10-23-pass0-F2-create-bucket-409-owned.md` (diagnosis and Review); unit tests in `packages/framework/src/provision/cloudflare/account.unit.test.ts` (the 409-then-200 and 409-then-404 tests failed before the fix; 409-then-403 is a guard).
Item: fix-pass0.

### DEC-0422 — In the sandbox, `remove` cannot delete R2 objects whose names have a `..` segment through the API
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-003, FILES-REQ-002, FILES-AC-002, D-RUN, `packages/framework/src/provision/cloudflare/objects.ts`

Pass 0 (`validation/cloudflare/pass-0/logs/`, label `d02f-delete-dot`) sent `DELETE /accounts/{account}/r2/buckets/prototype-logs/objects/x%2F..%2Fy` and got 403 with the plain-text body "request rejected: path contains traversal sequence". The body format and the request's position point to the sandbox's egress proxy, not Cloudflare. The response headers were not captured, so this is an inference. R2 accepted the same key through the S3 endpoint (PUT 200, GET 200, DELETE 204).

No framework defect was found. Whether real Cloudflare, reached without this proxy, accepts the path is unverified (owner item, plan §11 Q11). If real Cloudflare refuses it, PROV-REQ-003 is broken for valid FILES-REQ-002 names, and the fix is an S3-DELETE fallback in `deleteObjects` (see the root-cause record).

Limitation recorded: in this sandbox, stage removal (`remove`) cannot delete objects in the files bucket whose names have a `..` segment. `remove` reports such a leftover by name and fails (DEC-0263). Only `..` was observed. Names with `.` or empty (`//`) segments are untested. The pass-1 handling is in plan §5 D-RUN. No code was changed.

Evidence: `ai/implementation/root-causes/2026-10-23-pass0-F1-r2-api-delete-traversal-403.md` (diagnosis and Review).
Item: fix-pass0.

### DEC-0423 — The MIG criteria run as three self-contained blocks, and set the secret after the first Cloudflare deploy
Origin: ai-proposed · Status: accepted · Affects: MIG-AC-002, MIG-AC-003, MIG-AC-006, DEC-0277, DEC-0286, DEC-0398, `tests/compliance/criteria/mig/**`

`mig/deploys.test.ts` had two describe blocks whose tests depended on each other across IDs, so a per-ID selection (`--only`, the driver's `-t '\[<ID>\]'`) failed MIG-AC-003 and MIG-AC-006. It now has three blocks, each on its own stage, with the assertions unchanged:
- A (MIG-AC-002): the initial deployment and the no-change redeployment;
- B (MIG-AC-003): `beforeAll` deploys version 1 and loads the fixture; then the failing `unique-fail` deploy and its re-run;
- C (MIG-AC-003 preservation, MIG-AC-006): `beforeAll` deploys version 1, loads the fixture, takes a session, then runs the v2 schema-changing deploy with the writer and records its result; the two tests assert on the recorded result and the stage.

`createStage({ secrets })` takes the declared secrets. Locally it sets them with `secrets set --target local` before the first `dev` start (DEC-0277). On Cloudflare only the stage's first deploy is special: when it stops on unset secrets (DEC-0398's `secretsNotSet`), the stage runs `secrets set` for each secret, value on stdin, and deploys again, returning the combined output. No later deploy and no deploy failing for another reason is retried. `remove()` runs `remove` only if a deploy was attempted. The stage's CLI is the shared `BIN` of `core/support/repo.ts`.

Evidence: root cause `ai/implementation/root-causes/2026-10-23-cloud-test-paths.md` item 1 and its Review. Red then green: R1c was run as per-ID `-t` runs of `deploys.test.ts` on `--target local`.
- Before: MIG-AC-002 passed (2 passed); MIG-AC-003 failed 2 of 3 ("expected one local D1 database, found 0", "not being served"); MIG-AC-006 failed on "the schema-changing deploy ran (previous test)".
- After: MIG-AC-002 2 passed, MIG-AC-003 3 passed, 0 failed.

MIG-AC-006 now passes both selection-dependent assertions (the deploy ran, and writes were attempted) and fails at "writes acknowledged while the deploy ran > 0". That is its cloud-only clause: the criterion's Where is "Cloud", and locally a deployment is a `dev` restart, so no write can be acknowledged during it (DEC-0144). The assertion is unchanged and fails the same way in a whole-file local run. The local driver does not select MIG-AC-006. R1a/R1b are in `mig/support/stage.unit.test.ts`.
Item: fix-cloudtests.

### DEC-0424 — Every further cloud stage takes the shared stage guards, and releases the lock on every failure path
Origin: ai-proposed · Status: accepted · Affects: DEC-0317, DEC-0318, DEC-0361, plan §1 "Cloud usage limits", `tests/compliance/criteria/prov/support/stage.ts`, `tests/compliance/criteria/core/support/stages.ts`, `tests/compliance/criteria/mig/support/stage.ts`, `tests/compliance/e2e/**`

`takeStageRoom(databases, what)` in `prov/support/stage.ts` runs the guard sequence in a fixed order: the D1 stop (`requireCloudD1`), the cross-process `further-stage` lock, and the two-database cap (`requireDatabaseRoom`) under the lock. When the cap check throws, it releases the lock before rethrowing. It returns an idempotent release. It has no skip flag; only `withCloudStage`'s existing `held` option (for `holdStages` callers) bypasses it.
- `withCloudStage` and `holdStages` use it.
- The MIG cloud stage takes it for 2 databases before anything is copied or deployed. It releases it if any later step of `createStage` throws (account check, stage name, copy). `remove()` releases it in `finally`, even when `remove` exits non-zero.
- `withFurtherStage` replaces its own lock with `takeStageRoom(1, …)`. `scratchCopy` now runs inside the `try`, so a failed copy no longer leaks the lock, and the stage is removed only if a deploy was attempted.
- E2E-010 and E2E-012 wrap their whole body, including the `finally` removals, in `withE2EStages(2, …)` (`holdStages`). E2E-014's cloud step `setSecretThenDeploy` applies only the D1 stop before `secrets set`, because it creates no database.

Evidence: same root cause, items 1c and 2, and the Review's required change 2. The red-then-green tests are R1d, R2a–R2d and the lock-release cases in `mig/support/stage.unit.test.ts`, `core/support/stages.unit.test.ts`, `prov/support/stage.unit.test.ts` and `e2e/support/apps.unit.test.ts`. They run against a fake CLI (`criteria/_fakes/fake-cli.mjs`) and a stubbed `fetch`, with `TMPDIR` set to a scratch directory so the test lock never collides with a real run.
Item: fix-cloudtests.

### DEC-0425 — A removal made by another actor cancels the cleanup removal only when nothing is left
Origin: ai-proposed · Status: accepted · Affects: PROV-AC-006, COMPL-AC-004, `tests/compliance/criteria/prov/support/stage.ts`

`CloudStage.removedElsewhere(result, remaining)` records an out-of-band removal, so `withCloudStage`'s `finally` does not run `remove` a second time. It counts only when `result.status === 0` **and** `remaining` (the stage-resource probe after the removal) is empty. Otherwise the cleanup still runs. Taking `remaining` as a parameter enforces the Review's condition in the helper itself, not only at the call sites.
- PROV-AC-006 calls it after the no-leftovers check (`clean-machine.test.ts`, after `listStageResources`), with machine 3's `remove` result.
- COMPL-AC-004 calls it right after the first driver cleanup's `listStageResources`, with status 0 and the cleanup's log. The put-back token is still deleted by ID in the outer `finally`.

Each call saves one `remove` (20 + S Cloudflare requests).

Evidence: same root cause, item 3, and the Review's required change 1. The red-then-green tests are R3a (one `remove`), R3b (failed out-of-band removal: cleanup still runs) and R3c (exit 0 with resources left: cleanup still runs).
Item: fix-cloudtests.

### DEC-0426 — The MIG Cloudflare stage reads the D1 listing once per deploy, and `snapshot()` batches its SELECTs
Origin: ai-proposed · Status: accepted · Affects: plan §1 "Cloud usage limits" (500 requests per item), DEC-0348, `tests/compliance/criteria/mig/support/stage.ts`

`cloudflareStage.query` used to list the account's databases on every query. Now the stage's current database (the lowest `-db-<n>`) is re-read once after every deploy attempt, failed ones included. It is read after the `during` callback has settled and never from inside it. A failed re-read leaves it unset, so the next query reads it again. `databases()` still lists every time.

`snapshot()` moved to `support/stage.ts`. It makes one query for the table names, then one `queryBatch` of all the tables' SELECTs. That is a single `/query` with `{ batch: [{ sql }, …] }`, the form D-04's D1 client already relies on (`provision/cloudflare/d1/client.ts`), and `fake-d1-api.ts` implements it; it stays a DEC-0348 item-1 check for D-RUN. The result count is checked against the statement count. Locally, `queryBatch` runs each statement on the same read-only database.

Item 4's split-pass question (MIG-AC-003 and COMPL-AC-008 across two records; the Review's options (a) and (b)) is **not** decided here. It goes to the owner.

Evidence: same root cause, item 4. R4a in `mig/support/stage.unit.test.ts`: the listings are at most deploys + `databases()` calls; a query after a failed deploy goes to the database read after that deploy; a snapshot makes at most 2 `/query` calls.
Item: fix-cloudtests.

### DEC-0427 — Step 3 targets `Files` only when the stage has a database; `sst remove` runs only when SST has the stage's state (amends DEC-0336 "Steps")
Origin: ai-proposed · Status: accepted · Affects: DEC-0336, DEC-0334 item 10, DEC-0084, PROV-REQ-002, PROV-REQ-003, `packages/framework/src/provision/cloudflare/target.ts`, `sst.ts`, `fake-cloud.test-support.ts`

Pass 1's first deploy of `apps/reference` failed at step 3 with `✕  Target not found: Files`. SST 4.17.2 resolves `--target <name>` only against the resources in the stage's previous deployment state (`pkg/project/run.go:348-360`). A stage's first deploy has no state, so DEC-0336's `sst deploy --target Files` could never succeed on it. A stage without `app/<app>/<stage>` in `sst-state` is also unknown to `sst remove`, which then fails with `Stage not found`.

Amended steps:
- **Step 3 (`deployInfrastructure`)** decides from `input.database`:
  - with a database, the program declares the bucket and the Worker, and the run is `sst deploy --target Files`. The first database is created only after a step 3 succeeded, so `Files` is in SST's state. If the built Worker code is absent, step 3 is refused before any SST run: an untargeted run on a bucket-only program would delete the Worker with its secrets (R1);
  - without a database (a first deploy), the program is bucket-only and the run is an untargeted `sst deploy`. An untargeted run makes the stage's SST state equal the program, so it would delete a Worker in that state. If the Worker `<app>-<stage>` exists (checked by exact name), step 3 is refused: "the stage has a Worker `<app>-<stage>` but no database; … restore the database or run remove" (R2).
- **Removal:** `sst remove` is skipped only when a successful listing of `sst-state` lacks the exact key `app/<app>/<stage>`. If the listing fails, the failure is recorded and `sst remove` still runs. After a successful `sst remove`, the `app/` object it leaves behind (an empty checkpoint) is deleted, so a re-run of `remove` skips `sst remove`. The exact-name Worker and bucket deletes and the final deletion of the stage's state objects are unchanged (DEC-0084) (R3).
- Step order is unchanged (3 → first database → 4 → 5), so PROV-REQ-002's "no new app code" in step 3 holds.

Known limit, accepted: a stage with a database whose SST state was lost fails step 3 with SST's own `Target not found: Files`; `remove` recovers it.

The unit tests' fake SST now models SST's per-stage state (R4): `app/` marks a stage SST knows; `--target X` must be in that state; a targeted run adds nothing; an untargeted run makes the state equal the program; `remove` deletes only components in state and fails with `Stage not found` without `app/`; every run writes `update/<app>/<stage>/<id>`, and a stage's first run writes `passphrase/`. The old `snapshot/` keys are gone.

Still unverified live, carried to pass 2 (DEC-0334 item 10): a later `--target Files` step 3 leaves the Worker and its secrets in place, and whether `--target Files --target-dependents` updates the bucket's child resource. The pass-1 leftovers (`passphrase/` and `update/` objects of `test-ycfmck8n9jis0gb`) should be removed with the fixed `remove`, which should exit 0 without running `sst remove`.

Evidence: `ai/implementation/root-causes/2026-10-23-pass1-sst-target-not-found.md` (diagnosis and Review, R1–R4); `packages/framework/src/provision/cloudflare/target.unit.test.ts` (the first-deploy sequence, R1, R2 and both R3 remove tests failed before the fix; the second-deploy targeted test guards the targeted path).
Item: fix-pass1.

### DEC-0428 — Test hooks always send the environment token; PROV-AC-002's restricted-credential clause no longer refuses HTTPS_PROXY (applies DEC-0420)
Origin: ai-proposed · Status: accepted · Affects: DEC-0420, DEC-0083, DEC-0335, DEC-0363, PROV-AC-002, plan §10.6, `tests/compliance/criteria/_cloud/api.ts`, `tests/compliance/criteria/prov/deploy-sequence.test.ts`, `tests/compliance/criteria/prov/support/restricted-token.ts`, `tests/compliance/criteria/mig/support/stage.ts`, `tests/compliance/e2e/support/cloud.ts`

DEC-0420 removed the proxy's token injection for `api.cloudflare.com` and put a real token in `CLOUDFLARE_API_TOKEN`. Code written for DEC-0083 still assumed injection:

- `_cloud/api.ts` `authHeader()` sent no `Authorization` header whenever `HTTPS_PROXY` was set, so every cloud test hook request in the sandbox was unauthenticated (400 since DEC-0420). It now sends `Bearer $CLOUDFLARE_API_TOKEN` whenever the variable is set, proxy or not, and takes the environment as a parameter so it can be unit tested.
- Two further direct Cloudflare API callers sent no header by design ("the proxy injects the token"): the D1 HTTP reads in `mig/support/stage.ts` and the E2E probes in `e2e/support/cloud.ts`. Both now spread `authHeader()` into their headers.
- PROV-AC-002's restricted-credential clause refused to run when `HTTPS_PROXY` was set, because the proxy replaced the restricted token (DEC-0335, DEC-0363). The refusal is removed. The gate moved to `prov/support/restricted-token.ts` (`restrictedToken(env)`); the clause is still `blocked` when `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION` is unset, and runs in the sandbox when the operator supplies it.
- Comments that described the sandbox token as a placeholder the proxy replaces were updated: `packages/framework/src/provision/cloudflare/api.ts`, `environment.ts`, and the module headers above. The framework's own code already sent the bearer token unconditionally; no behaviour change there. Framework unit tests that use the literal fake value `"placeholder"` are fake tokens, not the DEC-0083 convention, and are unchanged.

Not done here: the restricted token itself is not provisioned, so the clause stays `blocked` until the owner supplies one. No live Cloudflare call was made.

Evidence: `tests/compliance/criteria/_cloud/api.unit.test.ts` and `tests/compliance/criteria/prov/support/restricted-token.unit.test.ts` (with `HTTPS_PROXY` and a fake token set, the header is sent / the token is returned; both failed before the fix and pass after). `vitest related` (unit config) 26 files / 204 tests pass; typecheck and lint pass.
Item: fix-envtoken.

### DEC-0429 — AUTH-AC-005's contract part runs over HTTP on every target; its successful-callback response is a cloud not-run part
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Affects: AUTH-AC-005, AUTH-REQ-005, E2E-004, COMPL-AC-001, DEC-0171, plan §8.1, `tests/compliance/criteria/auth/contract.test.ts`, `tests/compliance/harness/expected.ts`, `tests/support/http-schemas.ts`

AUTH-AC-005's Where is "Local, cloud; admin-list part: cloud (milestone)", so its contract part ("`/api/auth/*` responses validate against the HTTP contract") is automated on cloud. Its only tests were in-process (`packages/framework/test/integration/auth/routes-contract.test.ts`), which the cloud selection rightly excludes. Pass 1c therefore recorded AUTH-AC-005 `not-run` on Cloudflare and failed E2E-004's coverage part.

Decision:
- **Location.** The contract part's cloud evidence is `tests/compliance/criteria/auth/contract.test.ts`, target-neutral through `client()`: `GET /api/auth/me` (anonymous, user, admin via mock-login; 200, `no-store`, CurrentUser), `POST /api/auth/mock-login` (204, empty body; four invalid bodies are 400 `HTTP.INVALID_INPUT`), `GET /api/auth/login?returnTo=%2Fafter` (302/303 to `/after` on the target's origin, the mock session of DEC-0171), `GET /api/auth/callback` without a transaction (302 to `/` with `authError=login_failed` and a `requestId`, no session), `POST /api/auth/logout` (204, empty body, with and without a session), and undefined methods (`GET logout`, `DELETE me`, `POST login`, `GET mock-login`: 405 `HTTP.METHOD_NOT_ALLOWED` with `Allow`). Every error assertion checks the exact catalogue status and code, and the ErrorResponse schema. Mock-login tests use per-test IDs (`fix-auth005-*`).
- **Shared schema checks.** `isCurrentUserResponse` and `isErrorResponse` move to `tests/support/http-schemas.ts`, which imports only the error catalogue (`packages/framework/src/core/errors.ts`). The framework AUTH suite's `support.ts` re-exports them; the compliance suite does not import that `support.ts` (it pulls in `createTestApp` and `node:crypto`).
- **No local successful-callback copy.** The local selection already runs `routes-contract.test.ts`, whose stub-provider test covers the successful callback in-process.
- **Part rule.** `{ id: "AUTH-AC-005", targets: CLOUD, mode: "automated", part: "contract part: successful callback (needs a real login provider)", detail: GOOGLE_MOCKED }`. A test stage has the mock and no real provider (DEC-0171), so the 302 to `returnTo` with a session cookie first exists on `prodcheck` with Google, like AUTH-AC-009's cloud production part. It is added to plan §8.1 "for the evaluator to confirm": prompt §4 names only the admin-list part.

Evidence: `ai/implementation/root-causes/2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test.md` (diagnosis and Review, changes 1-5). Red-green in the Review's order: the offline Cloudflare coverage check (`tests/compliance/harness/selection.unit.test.ts`, `uncovered` over `listDriverTests("cloudflare")`) was red with `["AUTH-AC-005"]` until the contract tests landed; the `expected.unit.test.ts` expectation (Cloudflare automated `notRunParts` = that part; local none) was red until the part rule landed. Local driver run `--target local --only AUTH-AC-005,E2E-004` (record `oddohzaf86h0m0a`, not committed: a filtered run): AUTH-AC-005 and E2E-004 passed (6 new HTTP tests plus the 3 in-process ones). No Cloudflare call was made.

Still to verify in pass 2 on Cloudflare: AUTH-AC-005 `passed` with the not-run part entry above, the admin-list milestone part still outstanding, and E2E-004's coverage part passed.
Item: fix-auth005.

### DEC-0430 — On Cloudflare, R2 keys are `name + U+0001` (below PAR-230 bytes), so R2 lists in code point order (amends DEC-0162 "Order"; DEC-0328 unchanged in effect)
Origin: ai-proposed (orchestrator, under the owner's "make an assumption and continue") · Status: accepted (owner, 2026-10-25: "accept"; the invisible U+0001 ending stays) · Affects: DEC-0162, DEC-0328, FILES-REQ-001, FILES-REQ-002, PAR-230, `docs/components/files.md` §2 Cloudflare, `skill/reference/files.md`, `packages/framework/src/files/cloudflare/keys.ts`, `tickets.ts`, `src/targets/cloudflare/public.ts`, `src/files/fake-store.test-support.ts`

Pass 1c failed FILES-AC-001 on Cloudflare: R2 listed `…/a` after `…/a b` and `…/a/b`. The live probe of 2026-10-24 measured R2's order, through the binding and the S3 API alike: UTF-8 byte order, except that the end of a key ranks like one more byte between 0x31 and 0x61. `startAfter` does not follow that order (it returned keys the listing puts before it), so the service's paging could also repeat names. Keys ending in U+0001 list in true byte order, presigned GET/PUT of `%01` keys work, and R2's key limit is 1,024 bytes (1,025 gets 400 `InvalidObjectName`). Listing through S3 is no alternative: it has the same order.

Decision:
1. **Stored key.** The Cloudflare store (`cloudflareFilesStore`, wrapping the R2 binding in `createCloudflareWorker`) stores each name as `name + U+0001` when the name is under PAR-230 (1,024) UTF-8 bytes. FILES-REQ-002 forbids U+0001 in names, and it sorts below every byte a name can hold, so no stored key is a proper prefix of another and R2's end-of-key rank never decides an order. A name of exactly 1,024 bytes is stored unterminated: `name + U+0001` would exceed R2's limit, and a 1,024-byte name can be a proper prefix of no valid name, so the order still holds. PAR-230 is unchanged.
2. **Decoding and paging.** `get`, `head`, `delete` address the stored key; listed keys have a trailing U+0001 removed (a key without one is returned as it is, never dropped). `startAfter` is the last name's stored key, so paging stays in the listing's order. `prefix` is passed unchanged.
3. **Tickets.** Upload and download tickets sign and address the stored key (`…/<name>%01`). The `response-content-disposition` filename and everything app-facing keep the plain name.
4. **Scope.** The shared service, the local target (Miniflare, which already lists in byte order) and any S3 store keep plain keys. No framework code lists R2 through the S3 XML API, so no `encoding-type=url` change was needed; owner S3 tooling must use it (U+0001 cannot appear in XML 1.0).
5. **DEC-0328 `.`/`..` names keep working as before.** The dot-segment checks test the name, not the stored key: a name that is only `.` or `..` still gets no ticket (`FILES.INVALID_NAME`), and a name with a `.`/`..` segment is still sent with every `/` as `%2F` (now `x%2F..%2Fy%01`). The server operations accept these names as before. D-RUN's live `x/../y` check must be repeated with terminated keys in pass 2.
6. **Existing objects: no migration, no read fallback.** No FILES object exists outside test stages. The only `*-files` bucket recorded as kept is pass 1c's stage R (`reference-test-9mfkg261apxm7s2-files`, `validation/cloudflare/pass-1c/SUMMARY.md`), a test stage; pass 2 removes it (or clears it) before redeploying. Objects written there before this change would read as missing, and a list would return them unchanged. Tickets issued before the deploy point at plain keys; their 15-minute lifetime (PAR-233) bounds that.
7. **Visible to owners.** In the R2 dashboard and `wrangler r2 object get <bucket>/<key>`, every key carries an invisible U+0001, and a lookup by the plain name finds nothing. Documented in files.md §2 Cloudflare and `skill/reference/files.md`. Owner question (closed 2026-10-25, batch A of owner decisions): the owner answered "accept", so the ending stays and FILES-REQ-001 keeps code point order.

Evidence: `ai/implementation/root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md` (diagnosis, Review items 1–7, "Live probe (2026-10-24)"). The fake binding gained `order: "r2"`, which implements the probe's measured order (end of key ranked 0x31) and `startAfter` rule, and refuses keys over 1,024 bytes; `keys.unit.test.ts` checks it against probe L1, L3, L4 and L8. Red before the fix: the limit-3 listing of `p/…` names with five `p/a/…` extensions, plain and with short store pages, repeated names until the 50-page cap. Green after: each name once, in code point order. Also covered: 1,023-, 1,024- and 1,025-byte names, `.`, `..`, `x/../y`, `a/.` names in the store and in tickets, and the Worker addressing the binding by the stored key.

Still unverified live, carried to pass 2: FILES-AC-001 on Cloudflare with terminated keys, FILES-AC-002/-003/-004 transfers with `%01` keys, and D-RUN's `x/../y` check.
Item: fix-r2order.

### DEC-0431 — The cloud SEC-AC-001 / HTTP-AC-002 test waits, bounded, for SEC.MISSING after deleting the secret; `CLOUD_WAITS.secretRolloutMs` names the DEC-0092 bound
Origin: ai-proposed · Status: accepted · Affects: DEC-0092, DEC-0280, SEC-AC-001, HTTP-AC-002, `tests/compliance/criteria/secrets/further-stage.test.ts`, `tests/compliance/criteria/core/support/secrets.ts`, `tests/compliance/harness/wait.ts`

Pass 2 failed SEC-AC-001 and HTTP-AC-002 because the further-stage test read `/api/ref/secret` once, 126 ms after `DELETE …/secrets/SECRET_API_KEY` answered 200. Cloudflare was still serving the previous Worker version, which has the secret (DEC-0092). The test was the only cloud secret-deletion check that did not wait. CF-AC-002 already waits.

Change (test-only):
- New helper `expectSecretMissing(c)` in `core/support/secrets.ts`. It first waits, using `waitFor` with `timeoutMs: CLOUD_WAITS.secretRolloutMs` and `intervalMs: 2_000`, until `GET /api/ref/secret` passes `c.expectError(…, catalogueStatus("SEC.MISSING"), "SEC.MISSING")`. Only that status with that code ends the wait. A stale 200, another code, SEC.MISSING with another status, or a body without a code all keep it waiting. If the bound passes, the test fails, and the timeout message carries the last HTTP check failure. After the wait, the earlier assertions run unchanged on fresh requests to both paths: status and code, `errorResponseViolations`, a UUID request ID, and two distinct IDs.
- `further-stage.test.ts`: the SEC-AC-001 / HTTP-AC-002 `it` calls the helper after `deleteSecret`. It gets its own `10 * 60_000` timeout (Review R1). Without that, the integration default of 60 s would stop the test before the 60 s wait could report.
- `CLOUD_WAITS.secretRolloutMs = 60_000` (DEC-0092; twice the route toggle's bound, the value CF-AC-002 uses inline). This follows Review R2. CF-AC-002 and SEC-AC-003 keep their inline bounds, which have the same value. Moving them to the constant is a later cleanup, not part of this fix.

Not changed:
- SEC-AC-005's test. Its "next request" wording waits on an owner decision (see that test's own root-cause record).
- `deleteSecret`'s catch-all (root cause, fix item 2, optional). It still hides an authorization failure, but the wait now catches that case anyway: the stage never answers SEC.MISSING, and the test fails at the bound.
- R3 (two consecutive SEC.MISSING answers). This is not adopted. Revisit it only if a flake shows up.

Red-green (local fakes, no cloud call): `tests/compliance/criteria/core/support/secrets.unit.test.ts`. The fake stage keeps answering 200 with the old hash for the first 2 requests after the delete, then answers SEC.MISSING.
- With the helper as the old single read, the test failed with pass 2's exact error: `GET /api/ref/secret → status 200, code none … (expected status 500 with code SEC.MISSING)`. 7 of 10 tests were red.
- With the wait, all of them pass.
- Further cases prove the wait accepts only SEC.MISSING, and that a stage which never reaches it fails at 60 s. Two more cases show the assertions after the wait still fail on an empty request ID and on a repeated one.

These tests show the wait, not Cloudflare's rollout delay. The delay is documented by the trace and by DEC-0092.

Still to verify live: the pass-2 re-run (`--only SEC-AC-001,HTTP-AC-002`) passes on the further stage.

Evidence: `ai/implementation/root-causes/2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early.md` (diagnosis and Review R1–R3).
Item: fix-sec001.

## Implementation phase: AWS — phase G, offline (2026-10-24)

Deferred (DEC-0508): the AWS target is not part of release 1. The code, tests and evidence of this phase were moved off the release branch to the branch `aws`; the entries below stay for the record. Files they name under `src/targets/aws/`, `src/provision/aws/`, `src/files/aws/`, `src/log/aws/`, `src/sql/data-api*`, `tests/compliance/criteria/{aws,_cloud/aws}/`, `plan-aws.md`, `ai/implementation/spikes/g-s*` and `validation/local/phase-G/` exist only on that branch. Index: `ai/implementation/aws-deferred.md`.

Entries DEC-0432 to DEC-0502 were integrated by G-INT from the drafts of items G-S1, G-S2, G-F1, G-01 … G-11 and G-T4 (plan §10.4; G-T1, G-T2, G-T3 and G-12 wrote no draft). They are numbered in that order. Each entry keeps its draft's wording and status: everything here is `ai-proposed` and was built and checked offline, with no AWS call, so "to be confirmed live" and "unverified live" still hold until phase L. Draft-level notes (open points, fidelity notes, live items) are folded into one entry of their item, with their state at integration.

Parameters (docs/parameters/parameters.md): PAR-111's AWS SDK value recorded; new PAR-120 (`aws-sdk-client-mock`), PAR-121 (`@types/aws-lambda`), PAR-272 (Lambda runtime), PAR-273 (architecture), PAR-274 (memory), PAR-275 (Data API resume backoff), PAR-276 (bundle size bound), PAR-281 (AWS-AC-005 pause wait), PAR-282 (AWS hook API-call cap per compliance run) and PAR-283 (Aurora clusters at once); PAR-271's note extended. Each value was checked against the code that uses it.

Marked in place: DEC-0110 (superseded by DEC-0447), DEC-0397 (superseded by DEC-0499), DEC-0328 (extended on AWS by DEC-0464). Amendments between drafts are marked in the later-numbered entries' status lines and in the amended ones': DEC-0449 by DEC-0468 and DEC-0493; DEC-0460 by DEC-0469; DEC-0440 and DEC-0483 by DEC-0490; DEC-0432 by DEC-0472.

Conflict flagged, not resolved: DEC-0464 (on AWS a name that is only `.` or `..` is `FILES.INVALID_NAME`) against FILES-AC-002's shared `".."` round-trip case, which G-T3's pre-check suite runs over the S3 store and which fails there by design. Owner review open on DEC-0464, DEC-0468, DEC-0481, DEC-0491 and DEC-0495; the owner questions are in plan-aws.md §5.1.

Plan-aws.md "Decisions to record": 1 → DEC-0447; 2 → DEC-0432, DEC-0456, DEC-0461; 3 → DEC-0472, DEC-0433; 4 → DEC-0445; 5 → DEC-0498; 6 → DEC-0475; 7 → DEC-0442, DEC-0476, DEC-0478; 8 → DEC-0490; 9 → DEC-0486; 11 → DEC-0441, DEC-0491; 12 → DEC-0438 (the SPA fallback is the router function's `custom404`, G-S2 RESULT); 13 → DEC-0456, DEC-0470; 14 → DEC-0436, DEC-0479, DEC-0495. Decision 10 (COMPL-AC-004's R2-token clause on AWS) has no draft and stays open (plan-aws.md §5 Q7).

Evidence by item (from each draft's head):

- **G-S1** (DEC-0432…DEC-0437): `ai/implementation/spikes/g-s1/RESULT.md`, plus the spike's tests and probe in the same directory. All of it is offline, and no AWS endpoint was contacted.
- **G-S2** (DEC-0438…DEC-0444): `ai/implementation/spikes/g-s2/RESULT.md`. Everything there was found offline, with no AWS call. Items marked "unverified live" are checked in phase L.
- **G-F1** (DEC-0445…DEC-0446): `packages/framework/src/sql/data-api-fake.test-support.ts` (the fake; its header lists every fidelity gap) and `packages/framework/src/sql/data-api-fake.unit.test.ts` (54 self-tests, including drizzle `aws-data-api/pg` CRUD and transactions). All of it is offline, and no AWS endpoint was contacted.
- **G-01** (DEC-0447…DEC-0451): the G-01 commit on `claude/implement-aws-g-01`, its unit tests (`packages/framework/src/core/exports.unit.test.ts`, `src/targets/aws/public.unit.test.ts`, `src/config/{secret-locations,resolve,files}.unit.test.ts`, `src/build/build.unit.test.ts`, `src/cli/args.unit.test.ts`, `src/cli/commands/{deploy-wiring,secrets-cloud,smoke}.unit.test.ts`) and the CORE-AC-005 integration tests (`test/integration/core/package.test.ts`, `test/integration/cli/verify.test.ts`). No AWS endpoint was contacted.
- **G-02** (DEC-0452…DEC-0455): `packages/framework/src/sql/data-api.ts` (the adapter) and `packages/framework/src/sql/data-api.unit.test.ts` (23 tests against the G-F1 Data API fake, on fake timers where time matters). The fake is a pre-check, never AWS evidence (DEC-0445). No AWS endpoint was contacted.
- **G-03** (DEC-0456…DEC-0460): the G-03 commit on `claude/implement-aws-g-03` and its unit tests: `packages/framework/src/log/aws/{pending,sink}.unit.test.ts`, `src/secrets/aws.unit.test.ts`, `src/targets/aws/settings.unit.test.ts`, plus the moved `src/log/keys.unit.test.ts`. Each S3 request goes to a fetch stub. Each SSM client is an `aws-sdk-client-mock`. The sink and secrets suites install the G-07 network guard (`provision/aws/aws-network-guard.test-support.ts`). Each suite checks that the guard refuses an unmocked request to `*.amazonaws.com`, and that no other test in the file tried one. No AWS endpoint was contacted. Live behaviour (a real deny, real SSM errors) is phase L's.
- **G-04** (DEC-0461…DEC-0467): the G-04 commit on `claude/implement-aws-g-04` and its unit tests: `packages/framework/src/files/aws/{store,tickets,cors,xml}.unit.test.ts`, plus the moved `src/files/s3/sign.unit.test.ts` and the unchanged Cloudflare tests. Every AWS test runs under `installAwsNetworkGuard` (`src/provision/aws/aws-network-guard.test-support.ts`), and each file asserts that the guard recorded no attempt. One test shows that a store left on the global `fetch` is refused before a socket opens. No AWS endpoint was contacted. Everything here is a pre-check against the in-process S3 fake (`src/files/aws/s3-fake.test-support.ts`), not AWS evidence (plan-aws.md §2).
- **G-05** (DEC-0468…DEC-0471): the G-05 commit on `claude/implement-aws-g-05` and its unit tests: `packages/framework/src/targets/aws/handler.unit.test.ts` (18 tests): Function URL (payload 2.0) event fixtures through the fully assembled stage, with the Data API adapter on the G-F1 fake (framework migrations applied), the S3 files store on the G-04 fake, an SSM stub client and a fetch stub for the log bucket; `src/targets/aws/public.unit.test.ts` (the subpath contract); `src/provision/aws/sst.unit.test.ts` (the new variable-equality test). Every AWS suite installs the G-07 network guard (`provision/aws/aws-network-guard.test-support.ts`) and asserts it recorded no attempt. No AWS endpoint was contacted. All of this is a pre-check, never AWS evidence (plan-aws.md §2).
- **G-06** (DEC-0472…DEC-0474): the G-06 commit on `claude/implement-aws-g-06` and its tests: `packages/framework/src/build/aws.unit.test.ts`: fixture apps built with `--target aws` from the framework's sources (entry, output layout, the stage program taking the build's Lambda code, the SDK bundled, the size bound, the bundle run in Node through the Function URL handler under the AWS network guard, PROV-AC-005 aws build part for `test-g06`, `prod`, `prodcheck`, `mytest-1`, CORE-AC-006 AWS-bundle part, failing builds for Cloudflare-only, provisioning, CLI-only SDK and secret-value bundles, and a positive control: the same app's Cloudflare bundle fails the AWS rules as Cloudflare-only); `packages/framework/src/build/inspect.unit.test.ts`: every rule on a synthetic bundle; `packages/framework/test/integration/build/aws-bundles.test.ts`: the CLI (`npx <package> build --target aws`) on the B-T4 fixture app with the installed `dist/`, inspected like `cloudflare-bundles.test.ts` (DEC-0240). No AWS endpoint was contacted and nothing was deployed. The bundle has not run on Lambda; that is phase L.
- **G-07** (DEC-0475…DEC-0479): `packages/framework/src/provision/aws/{environment,engine,account}.ts` and their `*.unit.test.ts` (47 tests, all against `aws-sdk-client-mock`; a network guard refuses any `*.amazonaws.com` request and the suites assert it saw none). No AWS endpoint was contacted. Everything marked "unverified live" is checked in phase L (L-0, L-2).
- **G-08** (DEC-0480…DEC-0484): `packages/framework/src/provision/aws/{sst,names}.ts` and `sst.unit.test.ts` (26 tests). The structural tests evaluate the generated `sst.config.ts` against stand-ins for SST's globals. The type-check test runs strict `tsc` over the generated full, step-3 and CORS programs against a cached SST 4.17.2 platform with `@pulumi/aws` 7.20.0, the way G-S2 did, and a broken program (`nodejs23.x`, `"postgresql"`) fails it. No AWS call was made and no `sst deploy` was run. Everything here is unverified live until phase L's first deploy.
- **G-09** (DEC-0485…DEC-0487): `packages/framework/src/provision/aws/databases.ts` and `packages/framework/src/provision/aws/databases.unit.test.ts`. The tests run against the G-F1 Data API fake (16 tests). Three of them run PROV's `runDeploy` with the core `FakeTarget`, with its database operations replaced by G-09's: the MIG-AC-003 migration-failure and check-failure paths; the MIG-AC-006 copy-migrate-check-replace sequence; the MIG-AC-002 redeploy with nothing pending. All of this is a pre-check, never AWS evidence (DEC-0445). The AWS network guard records no attempt, and no AWS endpoint was contacted.
- **G-10** (DEC-0488…DEC-0492): `packages/framework/src/provision/aws/target.ts` and `target.unit.test.ts` (29 tests). The tests run every operation against `aws-sdk-client-mock` (Lambda, RDS, S3, Secrets Manager, SSM, Resource Groups Tagging API) over an in-memory account, with an injected fake SST and injected Data API operations, and run PROV's `runDeploy` and `runRemove` on top. The fake SST models the SST 4.17.2 behaviour from root cause 2026-10-23-pass1 and DEC-0440: `--target` resolves only against the stage's checkpoint, a targeted run adds nothing to state, an untargeted run deletes a Function the program leaves out, `remove` without a checkpoint fails with `Stage not found`, and `state.purge` deletes the stage's state. The AWS network guard records no attempt. No AWS endpoint was contacted and `sst` never ran. Everything here is unverified live until phase L.
- **G-11** (DEC-0493…DEC-0497): the G-11 commit on `claude/implement-aws-g-11` and its unit tests: `packages/framework/src/cli/commands/aws-operations.unit.test.ts`: the per-target factory's dispatch and refusals; the child environment; the AWS factory's account, target, region, code and `fetch` wiring (injected account and target); the real AWS target built with no request; the SDK clients' proxy-aware handler carrying the child environment; and `runSst` with a fake `SstExec` receiving `SSL_CERT_FILE`, the proxy and `NODE_USE_ENV_PROXY=1`. The AWS network guard is installed for the whole file and records no attempt. `deploy.unit.test.ts`, `deploy-wiring.unit.test.ts`, `remove.unit.test.ts`, `setup-account.unit.test.ts`, `smoke.unit.test.ts` (`--target aws` cases, with a `FakeTarget`) and `secrets-cloud.unit.test.ts` (unchanged AWS case). Cloudflare's CLI tests are unchanged and green. `tests/compliance/harness/node-deps.unit.test.ts`: the leftover check through the new factory, for Cloudflare and AWS. No AWS endpoint was contacted and `sst` never ran. Nothing here has run against AWS. That is phase L.
- **G-T4** (DEC-0498…DEC-0502): the G-T4 commits on `claude/implement-aws-g-t4`. Unit tests: `tests/compliance/harness/{expected,results,reports,driver,node-deps,aws-usage}.unit.test.ts` and `tests/compliance/criteria/_cloud/aws/{criteria-hooks,usage,secrets-logs}.unit.test.ts`. Integration: `tests/compliance/criteria/sql/data-api-retry.test.ts`. No AWS endpoint was contacted: the hook tests use aws-sdk-client-mock behind the framework's AWS network guard, and the driver tests use a fake target.

### DEC-0432 — One AWS SDK v3 version, 3.1153.0, for every client; client-mock and Lambda types pinned
Origin: ai-proposed · Status: accepted; the bundle rule amended by DEC-0472 (S3 through signed `fetch`, so `client-s3` is not bundled) · Affects: PAR-111, new PAR-120, PAR-121, `packages/framework/package.json`

The framework pins these at exactly 3.1153.0:
- `@aws-sdk/client-{rds-data,s3,ssm,lambda,sts,rds,secrets-manager,ec2,iam,resource-groups-tagging-api}`.

The framework also pins these dev dependencies:
- `aws-sdk-client-mock` 4.1.0;
- `@types/aws-lambda` 8.10.164.

Reasons:
- SST 4.17.2 already pulls in `@aws-sdk/client-lambda@3.1153.0`, so the clients share one version with it.
- All ten clients install together with one `@aws-sdk/core` (3.978.5) and one `@smithy/node-http-handler` (4.12.1).
- `aws-sdk-client-mock` 4.1.0 intercepts `RDSDataClient` 3.1153.0 in the spike's tests.

The clients' transitive ranges float. The root lockfile fixes them.

Bundle rule:
- The HTTP Lambda bundle contains only rds-data, s3 and ssm. With drizzle's Data API driver and `hono/aws-lambda`, that is 886 KB minified, 248 KB gzipped.
- ec2, iam, rds, sts, secrets-manager, lambda and tagging are CLI or provisioning only.
- The bundle carries its own pinned SDK. It does not rely on the copy in the managed runtime.
Item: G-S1.

### DEC-0433 — The HTTP Lambda sets runtime `nodejs22.x`, architecture `arm64` and memory 1024 MB explicitly
Origin: ai-proposed · Status: accepted · Affects: new PAR-272, PAR-273, PAR-274, AWS-REQ-001, G-S2 program

SST 4.17.2 accepts both values: `FunctionArgs.runtime` includes `"nodejs22.x"`, and `architecture` is `"x86_64" | "arm64"`. A type check against the cached 4.17.2 platform gives no errors for these values and rejects `"nodejs23.x"` and `"arm"`.

SST's defaults are `nodejs24.x`, `x86_64` and `1024 MB` (function.ts:1765, 1769, 1888). The program must therefore set runtime and architecture. Otherwise the Lambda runs Node 24, against PAR-111's Node 22.22.0.

- **arm64** costs less per GB-second. The bundle is pure JavaScript with no native modules, so it can run there.
- **1024 MB** is SST's default. Lambda CPU scales with memory, which shortens cold starts and SigV4/JSON work. At PAR-001's load the cost difference is negligible.

The managed runtime's Node patch level is AWS's choice. The live phase records the deployed `process.version`.
Item: G-S1.

### DEC-0434 — The Lambda entry uses `hono/aws-lambda` from the pinned Hono, with one boundary cast
Origin: ai-proposed · Status: accepted · Affects: AWS-REQ-001, AWS-AC-006, AWS-AC-004, `FW/src/targets/aws/`

Hono 4.13.13's `handle(app)` behaves correctly for Function URL (payload 2.0) events:
- It selects the v2 processor.
- It joins `event.cookies` into `Cookie`.
- It returns several Set-Cookie headers as `cookies: [a, b]` and drops them from `headers`.
- It decodes base64 bodies.
- It keeps JSON error bodies.

The fixture test is in the spike. It is the offline half of AWS-AC-006.

Hono's event types require fields that real Function URL events and @types/aws-lambda leave out: `body`, `requestContext.authorizer` and `authentication`. So the entry takes the @types/aws-lambda `APIGatewayProxyEventV2` and passes it with `as unknown as LambdaEvent`.

`c.req.url` comes from the `Host` header. The framework's origin keeps coming from configuration (DEC-0044).

`hono/aws-lambda` is marked deprecated in favour of `@hono/aws-lambda`, which is at 1.0.1. It still adds no dependency, so it stays. The switch is a pin change at Hono v5.
Item: G-S1.

### DEC-0435 — The Data API adapter wraps drizzle `aws-data-api/pg` in `portableHandle` and classifies SDK errors itself
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-006, SQL-AC-006, sql.md §2 (AWS), new PAR-275, `FW/src/sql/`

`drizzle(client, { resourceArn, secretArn, database })` passes through `withValueRules` and then `portableHandle` with the existing guard. It type-checks under the framework's strict settings. The driver's database is assignable without a cast to the `PortableDb` members, and the only cast is postgres.ts's `as unknown as DrizzleDb`. It runs selects and inserts correctly against a mocked `RDSDataClient`, and an insert without `returning` gives `undefined`.

The adapter must also do the following:
- **(a) Resume retry.** It finds `DatabaseResumingException` by `name` on the cause chain, which runs DrizzleQueryError → SDK exception. It retries with PAR-275 backoff until PAR-210, then fails with `SQL.UNAVAILABLE`. Today's guard turns this into `CORE.INTERNAL`.
- **(b) Constraint errors.** It maps SQLState 23505 and 23503 to `SQL.CONFLICT`. A Data API `DatabaseErrorException` carries the SQLState only in its message and has no pg `code`. The message shape is assumed and must be confirmed live.
- **(c) SDK retry.** It creates the `RDSDataClient` with `maxAttempts: 1`, so the framework's loop is the only retry. That keeps the time budget exact, and fake timers can test it.

The clock, the random source and the error source are injected (sql.md:157).
Item: G-S1.

### DEC-0436 — Node-side SDK clients reach a proxy through an explicit `NodeHttpHandler` with a `proxyEnv` agent
Origin: ai-proposed · Status: accepted · Affects: CLI, PROV AWS operations, compliance harness, live phase L

A local CONNECT proxy shows the following:
- With or without `NODE_USE_ENV_PROXY=1`, SDK v3's default `NodeHttpHandler` ignores `HTTPS_PROXY`, because it builds its own `https.Agent`.
- `new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }) })` goes through the proxy on Node 22.22.0. It honours `NO_PROXY`, and it connects directly when no proxy variable is set.

Every SDK client the CLI, provisioning or the harness creates uses this handler. It needs no `https-proxy-agent` dependency, and it is harmless in Lambda, where no proxy variable is set.

`@types/node` 22.20.5 does not declare `proxyEnv`, so the code needs a local type extension for that option.

Node `fetch` (aws4fetch) honours the proxy only under `NODE_USE_ENV_PROXY=1`. The CLI environment keeps that flag, as A-01 found. Proxy TLS also needs `NODE_EXTRA_CA_CERTS`, which is preset in this sandbox.

Fallback: `httpsAgent: https.globalAgent` with `NODE_USE_ENV_PROXY=1`. It works, but it depends on an experimental code path (`UNDICI-EHPA` warning).
Item: G-S1.

### DEC-0437 — AWS-AC-005's wait for a paused cluster is bounded
Origin: ai-proposed · Status: accepted · Affects: AWS-AC-005, new PAR-281

The slow test does the following:
1. It sends no traffic to the cluster.
2. Every 30 seconds it polls the cluster's observable pause state. G-S2 or an L item names the API.
3. It stops after PAR-281 (15 minutes).
4. If the cluster has not paused by then, it records AWS-AC-005 as not-run, with the reason and the last observed state.

The bound comes from three parts:
- PAR-213's 5-minute pause delay;
- up to 10 minutes for the pause to take effect and become visible;
- a short tail.

That keeps one live run under about 20 minutes, including the timed request.

Note at integration: G-T1's observer (`tests/compliance/criteria/_cloud/aws/cluster.ts`, `PAUSE_WAIT_MS`) and G-T2's AWS-AC-005 test (`tests/compliance/criteria/aws/support.ts`, `pauseBoundMs(PAR-213)` = PAR-213 + 10 minutes) both implement this bound as 15 minutes, polling every 30 s. Recorded as PAR-281.
Item: G-S1.

### DEC-0438 — The AWS stage program: components, arguments and fixed names
Origin: ai-proposed · Status: accepted · Affects: AWS-REQ-001…005, PROV-REQ-001/002, aws.md §2, provisioning.md §2 "Stage resources"

The framework writes `sst.config.ts` for an AWS stage from JSON inputs, the same way `provision/cloudflare/sst.ts` does. App settings: `removal: "remove"`, `home: "aws"`, `state: { purge: true }`, `providers.aws = { version: PAR-109, region }`.

The components:
- `Files`: `sst.aws.Bucket`, with the bucket name fixed by transform to `<app>-<stage>-files-<account-id>`.
- `Database`: `sst.aws.Aurora`, with:
  - `engine: "postgres"` and the PAR-110 `version` as an input;
  - `dataApi: true`;
  - `scaling` 0–4 ACU with `pauseAfter: "5 minutes"` (PAR-212/213);
  - `vpc: { subnets, securityGroups }` from setup-account (DEC-0074);
  - `transform.cluster`: `clusterIdentifier = <app>-<stage>`, `skipFinalSnapshot = true`, `deletionProtection = false`.
- `Router`: `sst.aws.Router`, with no domain and protection `"none"`.
- `Site`: `sst.aws.StaticSite`, with the prebuilt client as `path` and `router: { instance: router }`.
- `Http`: `sst.aws.Function`, with:
  - `name = <app>-<stage>-http`, the built `bundle` and `handler`;
  - `runtime: "nodejs22.x"`, `architecture: "arm64"`;
  - `timeout` PAR-270;
  - explicit `permissions` that name exact ARNs, and **no `link`**;
  - `url: { cors: false, router: { instance: router, path: "/api", readTimeout: PAR-271 } }`.

Four physical names are fixed: the files bucket, the cluster, the credentials secret and the Function. With them, IAM statements, `remove` and `listStageResources` work from the stage name alone on a clean machine, as DEC-0331 does on Cloudflare, and the Function can name the long-lived resources without a dependency edge (DEC-0440). The S3 bucket namespace is global, so the bucket name ends with the account ID. Every other physical name is generated by SST (`<app>-<stage>-<logical>-<rand8>`). Those resources are found through state or SST's `sst:app`/`sst:stage` default tags.

Result: the program type-checks against SST 4.17.2's platform types, and evaluates under Pulumi mocks to the resource list in RESULT.md §2. 13 structural tests pass. Fallback: none needed.
Item: G-S2.

### DEC-0439 — The public origin comes from `router.url` in one phase
Origin: ai-proposed · Status: accepted · Affects: aws.md §2 (the two-phase sentence), CFG `FRAMEWORK_PUBLIC_ORIGIN`

`router.url` is passed to the Function's environment directly. There is no cycle:
- the Router takes no input from its routes;
- the Function attaches its `/api` route by writing the Router's KeyValueStore (`router.ts:3221-3264`, `function.ts:2836-2890`);
- the recorded edges show `HttpFunction → RouterCdnDistribution`, and nothing under Router depends on Http or Site.

The two-phase update in aws.md:68 is not used. Fallback, if a later SST pin creates a cycle: deploy with the origin from the previous deploy's output, then run one more untargeted deploy when the output changed.
Item: G-S2.

### DEC-0440 — AWS step 3: the long-lived infrastructure is `Files` and `Database`, named by literals only
Origin: ai-proposed · Status: accepted; point 4's read-back of the secret ARN from step 3's output amended by DEC-0490 (found by `DescribeSecret`) · Affects: PROV-REQ-002 step 3, DEC-0427 (AWS counterpart), MIG-REQ-006, `FW/src/provision/aws/` (G-1x)

SST 4.17.2 resolves `--target` only against the stage's stored checkpoint, `app/<app>/<stage>.json` in the state bucket. It also always adds `--target-dependents`. The pinned binary, run offline, showed three things:
- a first deploy fails with `Target not found`;
- children of a target are deployed;
- **a resource that depends on a target's output is redeployed with its new inputs (new code) even when the target is unchanged.**

So, on AWS:
1. **The stage has no database yet** (first deploy): step 3 is an untargeted `sst deploy` of a program that declares only `Files` and `Database`.
2. **The stage has a database:** step 3 is `sst deploy --target Files,Database` with the full program.
3. DEC-0427's guards apply unchanged:
   - choose the target from "the stage has a database";
   - refuse a database without code;
   - before an untargeted step 3, refuse when the stage's Function exists.
4. Nothing under Http, Site or Router may take a component output of `Files` or `Database`. The cluster ARN and the bucket ARNs are built from the fixed names. The credentials secret's full ARN, which has a random suffix and is required by the Data API, is read back from step 3's output (`databaseSecretArn`) and embedded as a literal.
5. A structural test over the dependency edges recorded under mocks enforces rule 4. Its negative control (`EDGE: database.secretArn`) fails it.

Unverified live: the AWS run of the targeted path on a second deploy.
Item: G-S2.

### DEC-0441 — The database credentials secret: SST-created, recovery window 0, named by `$transform`
Origin: ai-proposed · Status: accepted · Affects: PROV §2 "Removal", aws.md "remove", `listStageResources`, DEC-0061

- `sst.aws.Aurora` always creates `aws.secretsmanager.Secret` `<name>ProxySecret`, with `recoveryWindowInDays: 0` hard-coded (`aurora.ts:890-912`), plus a `SecretVersion` holding `{username, password}`.
- The master password is SST's `RandomPassword`. RDS-managed passwords are not used, so this is the secret `remove` must delete without recovery.
- No Aurora transform covers the secret. The recovery window needs none, and the name is set with a global `$transform(aws.secretsmanager.Secret)` matched on the logical name: `<app>-<stage>-database-credentials`.
- `sst remove` deletes the secret with `ForceDeleteWithoutRecovery` (the provider's documented meaning of 0). `remove`'s by-name fallback must pass `ForceDeleteWithoutRecovery: true`.

Unverified live: that the same name can be created again immediately after a forced delete.
Item: G-S2.

### DEC-0442 — SST's AWS state home: bootstrapped by SST; setup-account triggers it with `sst unlock`
Origin: ai-proposed · Status: accepted · Affects: provisioning.md §2 "State home", aws.md `setupAccount`/`remove`/`listStageResources`

`home: "aws"` is bootstrapped by SST per region, on every command that loads the home (deploy, remove, diff, refresh, unlock, secret). `sst install` does not load it.

The bootstrap creates:
- `sst-asset-<rand12>`, which also holds Function code zips;
- `sst-state-<rand12>`, versioned;
- TLS-only bucket policies on both buckets;
- the ECR repository `sst-asset`;
- the SSM String `/sst/bootstrap`, with version 5 and the bucket names.

Each stage adds the SSM SecureString `/sst/passphrase/<app>/<stage>`, and `app/`, `secret/`, `update/`, `summary/`, `eventlog/` and `snapshot/` objects in the state bucket.

How the framework handles this:
- `setupAccount` makes SST bootstrap the chosen region by running `sst unlock --stage <setup-stage>` on a minimal app (`home: "aws"`). Then it reads `/sst/bootstrap` to verify the state bucket.
- `state: { purge: true }` makes a `remove` that leaves no resources delete the stage's state objects and its passphrase. The passphrase is outside `/<app>/<stage>/`, so `listStageResources` lists it, and `remove`'s fallback deletes it by exact name.

Unverified live.
Item: G-S2.

### DEC-0443 — The Function's role trusts Lambda only (works around an SST 4.17.2 bug)
Origin: ai-proposed · Status: accepted · Affects: AWS-REQ-003, AWS-AC-003, aws.md §2

SST 4.17.2 tests `!dev` on an `Output` (`function.ts:2279`). An Output is always truthy, so every Function role gets the dev trust policy, which also trusts `arn:aws:iam::<account>:root`. This was observed under mocks.

The program sets `transform.role` to set `assumeRolePolicy` to `aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" })`, and a structural test checks it. Remove the override when an SST pin fixes the bug.
Item: G-S2.

### DEC-0444 — Offline verification of the generated AWS program: type-check, Pulumi mocks, structural tests
Origin: ai-proposed · Status: accepted · Affects: plan-aws.md G-1x provisioning items, test economy

Running the program under `@pulumi/pulumi/runtime` `setMocks` is feasible offline. The harness:
- bundles the program the way SST does (`run.go:136-188`, `js.go:55-145`: define, inject, the provider-globals plugin, the external list);
- stubs the CLI's RPC calls `Provider.Aws.Bootstrap` and `Runtime.Build`;
- records each resource's inputs, parent and dependency URNs from `MockMonitor.registerResource`.

The provisioning implementer turns this into the framework's offline check of the AWS program: type-check, mock evaluation, and structural tests for the resource set, names, permissions, timeouts, the Lambda-only trust policy, and the step-3 no-edge rule.

What the mocks cannot show, left to phase L: AWS-side validation, the dynamic providers (KV routes, site files, invalidation), the real `Runtime.Build`, and plans and diffs.
Item: G-S2.

### DEC-0445 — The Data API fake is a pre-check, never evidence
Origin: ai-proposed · Status: accepted · Affects: SQL-AC-003…006, KV-AC-001…005, MIG-AC-002/003/006, COMPL-AC-008 (AWS runs), the evaluator, `FW/src/sql/data-api-fake.test-support.ts`

A test that passes against `DataApiFake` shows only that the code path works against an in-process model of the Data API built on PGlite. It is never AWS evidence: sql.md §2 "Local" says PGlite does not prove Data API behavior, and plan-aws §2 says a pre-check must not be counted. So:
- The evaluator records no AWS criterion as passed on the strength of the fake. An AWS run of a criterion needs the live phase L.
- Evidence files and RESULT notes that cite the fake call it a "pre-check".
- Every behaviour of the fake that was not confirmed against AWS is marked "assumed" in the file header. The live phase confirms or corrects each one, and a correction changes the fake, not the adapter's expectations alone.

Reason: the fake shares Postgres with Aurora, but its error shapes, response-size accounting, parameter typing, concurrency and database operations are modelled from the SDK types, drizzle's session and the G-S1 findings, not from observed Data API responses.
Item: G-F1.

### DEC-0446 — The fake's assumed Data API shapes, for G-02 to code against and L to confirm
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: SQL-REQ-006, SQL-AC-006, G-02, phase L

- **SQL errors** are `BadRequestException` by default, or `DatabaseErrorException` with the `sqlErrorException` option. The SDK marks `BadRequestException` deprecated, so the real service may use either. The message is `ERROR: <message>[\n  Detail: <detail>]; SQLState: <code>`, and there is no pg `code` field. So the adapter (G-02) classifies by the SQLSTATE parsed from the message, under either exception name.
- **Resuming** is `DatabaseResumingException`, matched by `name`. `resume({ calls })` and `resume({ untilMs })`, with an injected clock, drive the retry loop's tests.
- **Response size** is `BadRequestException` "Database returned more than the allowed response size limit" when the JSON response is over PAR-214. For a write, the statement has already run.
- **Parameters**: an unhinted string binds as varchar, an integer as int8 and a double as float8. So SQL that needs an int4 argument (`repeat(text, :n)`) must cast it.
- **Concurrency**: statements on one database are serialised while a transaction is open. `CommitTransaction` after a failed statement is refused and rolls back.
- **Databases**: `CREATE DATABASE … TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`, `CREATE DATABASE "<new>" TEMPLATE "<old>"` and `DROP DATABASE … WITH (FORCE)` are executed by Postgres itself. Each database is its own PGlite instance. A copy is refused (55006) while a transaction is open on its source. Whether the real Data API leaves a pooled connection open stays the migrations.md "Early spike" question for phase L.
Item: G-F1.

### DEC-0447 — `./targets/aws` is exported; DEC-0110 is superseded
Origin: ai-proposed · Status: accepted · Supersedes: DEC-0110 · Affects: CORE-REQ-005, CORE-AC-005, `packages/framework/package.json`, DEC-0111

The exports map now lists all eight subpaths of CORE-REQ-005's table: `.`, `./client`, `./testing`, `./targets/local`, `./targets/cloudflare`, `./targets/aws`, `./provision`, `./check`. `./targets/aws` points at `dist/targets/aws/public.{js,d.ts}`, built from `src/targets/aws/public.ts`, as DEC-0111 does for the other target subpaths.

DEC-0110 kept the subpath out because "an export pointing at placeholder code is not allowed" while AWS was not being built. The AWS phase has started, so the subpath is added now and filled by G-05. Until then it holds a contract stub:
- `createAwsLambdaHandler(app, resolved, { mock? })`, the name plan-aws.md G-05 gives, returning an `AwsLambdaHandler`. It throws `AwsNotImplementedError` ("AWS target not yet implemented (phase G): …").
- `createAuthMock`, re-exported for test-stage entries, as `./targets/cloudflare` does.
- The event and result types are opaque (`unknown`) so the published declarations need no `@types/aws-lambda`. G-05 narrows them.

Nothing generates an AWS entry yet (`build --target aws` stops first, DEC-0449), so the stub is never bundled.

CORE-AC-005's fixture part is unchanged and still passes for the right reason. The fixture importing `./targets/aws` from app server code fails `verify` through `allowed-imports`, whose diagnostic names the subpath. Now that the subpath resolves, that rule is the only thing that rejects the import. The tests' expected subpath sets include `./targets/aws`, and a new unit test checks that every subpath's dist files come from an existing source module.
Item: G-01.

### DEC-0448 — `"aws"` joins `Target`; the AWS secret location is per stage
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-003, SEC-REQ-003, CFG-REQ-004, `core/identity.ts`, `cli/args.ts`, `secrets/set-command.ts`, `config/secret-locations.ts`

- `Target` is `"local" | "cloudflare" | "aws"`. `TARGETS` in `cli/args.ts` and the `secrets set` parser's list include `aws`, so `--target aws` is accepted by every command that takes a target.
- `secretLocation(target, name, scope?)` gains SEC-REQ-003's AWS row: `/<app>/<stage>/secrets/<name>`, with the logical name unchanged (secrets.md §2). The AWS location depends on the stage, so the AWS form needs `{ app, stage }`. Calling it for AWS without them throws, and the overloads make that a type error for a `Target`-typed argument. The resolved configuration passes the deployment, so CFG-AC-004 lists SSM paths on AWS.
- `envSecretReader` takes only the env-backed targets (`Exclude<Target, "aws">`), and the local and Cloudflare runtimes pass their own literal target. The AWS SSM reader is G-03's.
- `secrets set --target aws` reports the location as "… (an SSM SecureString parameter of stage …)". The write itself still goes through the target's operations, which are not built yet.
Item: G-01.

### DEC-0449 — AWS paths not built yet throw `AwsNotImplementedError`, never fall through to Cloudflare
Origin: ai-proposed · Status: superseded by DEC-0468 (the `createAwsLambdaHandler` row) and DEC-0493 (every other row; `core/aws-pending.ts` deleted) · Affects: CLI-REQ-001, `core/aws-pending.ts`, the G items named below

Before this item, each target branch below treated "not local" as Cloudflare. With `"aws"` in `Target`, each one now throws `AwsNotImplementedError` (message "AWS target not yet implemented (phase G): <what> (<item>)") until the named item replaces it:

| Place | What it stops | Replaced by |
| --- | --- | --- |
| `build/build.ts` `buildApp` | `build --target aws`, after the stage config resolves (so a missing `config/aws/test.json` is still reported first) and before anything is written | G-06 |
| `build/build.ts` `entrySource` | the generated Lambda entry | G-06 |
| `cli/commands/deploy.ts` `prepareDeploy` | `deploy --target aws`, before any build | G-06, G-10, G-11 |
| `cli/commands/deploy.ts` `cloudflareOperations` | the provisioning operations for `deploy`, `remove`, `setup-account` and `secrets set` on AWS | G-07 … G-11 |
| `cli/commands/smoke.ts` `logLocation` | `smoke --target aws`'s log location | G-11 |
| `targets/aws/public.ts` `createAwsLambdaHandler` | the Lambda runtime | G-05 |

The places that already handle every cloud target the same way are unchanged: cookie settings, the mock guard, config file selection (`config/<target>/test.json`), `connectTestStage`, and the cloud process check.
Item: G-01.

### DEC-0450 — The template and reference apps commit `config/aws/test.json`
Origin: ai-proposed · Status: accepted · Affects: CFG-REQ-002, `apps/template`, `apps/reference`

Each app's `config/aws/test.json` is a copy of its `config/cloudflare/test.json`: template `{ "values": {}, "framework": {} }`; reference `greeting: "Hello from a test stage"`. A unit test reads both apps' files through the build's reader and checks that the AWS file equals the Cloudflare one. Production AWS stages need their own committed files, as on Cloudflare. apps/reference/ROUTES.md names the new file. The template README's AWS steps are G-12's.
Item: G-01.

### DEC-0451 — The AWS SDK pins of DEC-0432 are installed in the framework
Origin: ai-proposed · Status: accepted · Affects: PAR-111, PAR-120, PAR-121, DEC-0113, `packages/framework/package.json`, `package-lock.json`

- Dependencies, exact: `@aws-sdk/client-{ec2,iam,lambda,rds,rds-data,resource-groups-tagging-api,s3,secrets-manager,ssm,sts}` 3.1153.0.
- Dev dependencies, exact: `aws-sdk-client-mock` 4.1.0 and `@types/aws-lambda` 8.10.164.
- `npm install` regenerated the root lockfile. All ten clients share one `@aws-sdk/core`, 3.978.5.

This extends DEC-0113's dependency set. Its "Not declared: `@pulumi/aws` (AWS phase)" still holds, because G-08 decides whether the program needs it. No framework code imports the clients yet. The bundle rule of DEC-0432 (only rds-data, s3 and ssm in the HTTP Lambda) is G-06's to enforce.
Item: G-01.

### DEC-0452 — The resume retry wraps each Data API call, inside the shared guard
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-006, SQL-AC-006, sql.md §2 (AWS), proposed PAR-275, `FW/src/sql/data-api.ts`

- The adapter hands drizzle a proxy of the `RDSDataClient` whose `send` retries a call that fails with `DatabaseResumingException` (matched by `name`). A resuming error means the call did not run, so the retry is safe for every command, including `BeginTransaction`, `CommitTransaction` and statements inside a transaction.
- The wait before retry n is random(0, min(5 s, 250 ms × 2ⁿ)) (proposed PAR-275). The loop stops when the next attempt would start after the handle's budget (PAR-210 by default, `budgetMs` otherwise), measured from that call's first attempt. It then fails with `SQL.UNAVAILABLE` and logs it once through `logFailure` when the handle has the request's log (DEC-0140).
- The clock (`now`, `sleep`) and the random source are injected through `dataApiDb(…, { clock })`. The error source is the client itself, so the SQL-AC-006 clause is tested with the fake's `resume()` on vitest fake timers. With random 0.5 it makes 22 calls and waits 43,875 ms in total.
- The shared guard's own PAR-210 race still bounds the whole operation, so a whole `atomic` call cannot exceed PAR-210 either.

Reason: per-call retry needs no per-operation state on a client shared across requests, and it does not redo work that already ran. The guard is composed, not changed, so local D1, PGlite and Cloudflare behave as before (their suites are unchanged and green).
Item: G-02.

### DEC-0453 — Data API error mapping
Origin: ai-proposed · Status: accepted (shapes to be confirmed live) · Affects: SQL-REQ-006, SQL-AC-006, `FW/src/sql/data-api.ts`

The adapter wraps the shared guard and classifies the failure's cause chain before the guard sees it:
- `BadRequestException` or `DatabaseErrorException` whose message carries `SQLState: 23505` or `23503` → `SQL.CONFLICT`, with the guard's generic message, so no key value leaks.
- Either name with "more than the allowed response size limit" → `SQL.RESULT_TOO_LARGE`, naming PAR-214.
- `ServiceUnavailableError`, and `ETIMEDOUT`/`EAI_AGAIN`/`ENOTFOUND`/`EHOSTUNREACH`/`socket hang up` (through the guard's `unreachable` patterns) → `SQL.UNAVAILABLE`.
- A `FrameworkError` on the chain (the resume give-up, value checks) passes through. Anything else goes to the shared guard unchanged and becomes `CORE.INTERNAL`.

PAR-215 is still checked by the portable handle on every result, as on every target.

Known gap, for phase L: PAR-214 is measured on the JSON response, PAR-215 on values. A NULL counts 0 bytes towards PAR-215 but about 15 bytes of JSON, so a result of many NULL-heavy rows can be within PAR-215 and still exceed PAR-214. It then fails only on AWS, as `SQL.RESULT_TOO_LARGE`, against the intent of SQL-REQ-006. Non-text values are about 15–25 bytes of JSON against 8 counted, so a result at PAR-215 made only of such values stays under 1 MiB. Proposal: phase L measures the real ratio. If it matters, either count NULL as 8 bytes in sql.md §2.3, or add a row cap.

Fidelity note on the G-F1 fake (from the draft, for its owner): the fake threw its SQL exception with the PGlite error as `cause`, carrying the pg `code`, which the SDK's exceptions do not have. Against the raw fake, the shared guard would find 23505 on the chain and map a constraint violation to `SQL.CONFLICT` without the message parsing AWS needs, so the fake hid G-S1 finding (b). The G-02 tests strip `cause` at the client boundary (`sdkLike`). Resolved before integration by the G-F1 follow-up (commit `96802c6`, "fake errors carry SQLSTATE only in the message").
Item: G-02.

### DEC-0454 — Value normalisation at the Data API boundary
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-004, SQL-AC-004, `FW/src/sql/data-api.ts`

- **Writes.** drizzle sends every integral JS number as `longValue`. A `number()` value that is integral but not a safe integer, such as 1e300, is not an int64, and the fake refuses it. The adapter sends such a value as `doubleValue`. Safe integers stay `longValue`, which is int8: Postgres's assignment casts handle `integer` columns, and comparison operators handle comparisons.
- **Reads.** A `longValue` that is not a safe JS integer has already lost precision in the SDK's JSON parsing, so it is `SQL.INVALID_VALUE`, as for aggregates. `doubleValue`, `booleanValue` and `isNull` map to number, boolean and null through drizzle. `-0` is stored as 0 by the column rule.
- The round-trip test covers the int32 bounds, `Number.MAX_SAFE_INTEGER` timestamps, 1e300, 5e-324, −2⁵³−2, `-0`, booleans, NULL and non-BMP text. It also covers `eq` on 1e300 and on −2³¹, and `count`/`sum`/`avg`/`min`/`max`, including empty input.
Item: G-02.

### DEC-0455 — One client per cold start; the SDK dependencies move to `dependencies`
Origin: ai-proposed · Status: accepted · Affects: PAR-111, DEC-0432, DEC-0435, DEC-0436, `packages/framework/package.json`

- `dataApiClient()` creates the client on first use and keeps it for the process. It uses `maxAttempts: 1` and `NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }) })`. A local type adds `proxyEnv`, which `@types/node` 22.20.5 does not declare.
- `createDataApiClient({ region })` is for the CLI (G-09/G-11), which passes the region.
- `@aws-sdk/client-rds-data` 3.1153.0 moves from `devDependencies` to `dependencies`. `@smithy/node-http-handler` is added at exactly 4.12.1, the version already in the lockfile, because the adapter imports it directly.
Item: G-02.

### DEC-0456 — The log sink signs one S3 `PutObject` per entry with aws4fetch; the handler waits for pending writes for at most PAR-260
Origin: ai-proposed · Status: proposed · Affects: LOG-REQ-001, LOG-REQ-004, LOG-AC-001/004, log.md §2 "AWS", aws.md §2, G-05

`src/log/aws/sink.ts`, `s3LogSink({ bucket, pending })`:
- **Request.** One virtual-hosted `PUT https://<bucket>.s3.<region>.amazonaws.com/<key>` per entry. The key comes from the shared LOG-REQ-004 builder. The body is the entry's JSON and the content type is `application/json`.
- **Signing.** SigV4 with aws4fetch and the role's temporary credentials. The `x-amz-security-token` header is signed. The headers include `x-amz-expected-bucket-owner: <account-id>`. aws4fetch signs S3 requests as `UNSIGNED-PAYLOAD` by default, so the sink computes the body's SHA-256 itself and signs that (`x-amz-content-sha256`). A unit test recomputes the signature independently with `node:crypto`.
- **Failures.** The request is sent once (`retries: 0`, and the signed request goes to `fetch` directly). aws4fetch's own retries (10 by default) are not used, so PAR-260 is the only time budget. A non-2xx answer (a denied `PutObject` returns 403), a 5xx or a network error rejects the write. The tracker swallows the rejection, so the entry is dropped and the request is unaffected.
- **Tracker.** `src/log/aws/pending.ts`, `createPendingWrites()`. There is one per invocation. The sink calls `track(write)`. The handler calls `await settle()` before it returns the response.
  - `settle()` waits until no write is pending, including writes that start while it waits.
  - It never waits longer than `LOG_WRITE_WAIT_MS` = PAR-260 (2 s), measured from the call.
  - It never rejects and leaves no timer behind.
  - A write still running at the bound is abandoned, not aborted.
- **Tests.** A Hono app built the way G-05's handler will work gives two results:
  - With 403 AccessDenied on every write, the response is 200, and both writes were attempted.
  - Under fake timers, with writes that never complete, the response comes exactly PAR-260 late.
Item: G-03.

### DEC-0457 — Without complete log-bucket settings, entries are printed as marked output lines
Origin: ai-proposed · Status: proposed · Affects: LOG-REQ-001, DEC-0323 (the Cloudflare equivalent)

Sometimes `awsLambdaSettings(env).logBucket` is `undefined`: `FRAMEWORK_LOG_BUCKET`, `FRAMEWORK_ACCOUNT_ID`, `AWS_REGION` or the role credentials are missing (a misconfigured Lambda). The sink then prints each entry as `[prototype-framework:log] <json>`, which lands in the function's CloudWatch log stream. No S3 request is made. This mirrors the Cloudflare sink without its `LOGS` binding. Logging never makes a request fail, so this case is not `CORE.MISCONFIGURED`.
Item: G-03.

### DEC-0458 — The LOG-REQ-004 key builder moves to `src/log/keys.ts`
Origin: ai-proposed · Status: proposed · Affects: LOG-REQ-004, `src/log/cloudflare/sink.ts`, decision-log references to `log/cloudflare/keys.ts`

`logObjectKey` and `randomKeyPart` moved, unchanged, from `src/log/cloudflare/keys.ts` to `src/log/keys.ts`, and their unit test moved with them. Both sinks import the shared builder, so the AWS bundle pulls in nothing from a Cloudflare directory (core.md:89; G-06's bundle inspection). The decision log's older mentions of the old path are historical and were left as they are.
Item: G-03.

### DEC-0459 — The SSM reader: `ParameterNotFound` by name → `undefined`; any other failure → a plain error; no cache
Origin: ai-proposed · Status: proposed · Affects: SEC-REQ-003, SEC-REQ-005, SEC-AC-001/005, secrets.md §2 "AWS", DEC-0157

`src/secrets/aws.ts`, `ssmSecretReader(client, { app, stage })`, is a `SecretReader`:
- **Request.** `GetParameter { Name: secretLocation("aws", name, scope), WithDecryption: true }`. That is the G-01 path `/<app>/<stage>/secrets/<name>`, used for app and framework-internal secrets alike.
- **Missing.** `ParameterNotFound`, matched by the error's `name` so that a second copy of the SDK classes in a bundle still matches, resolves `undefined`. An absent or empty `Value` does the same. `createSecretsService` turns `undefined` into `SEC.MISSING`.
- **Other failures.** Any other failure rejects with a plain `Error("SSM GetParameter failed with <ErrorName>")`. This includes AccessDenied, KMS, throttling, 5xx and network errors. It is deliberately not a `FrameworkError`: the service rethrows those unlogged, so a plain error lets it raise `SEC.UNAVAILABLE` and log it once through `logFailure`. The SDK message never appears in the error or the log.
- **No cache.** The reader keeps no state, and every call is one `GetParameter`. The only reuse is the per-request `SecretsService`'s, which the SEC-REQ-005 "MAY" allows. A test shows three requests through one shared reader seeing `old`, then `new`, then `SEC.MISSING`.
- **Client.** `createSsmClient(env, region)` builds the client once per cold start. It gets the G-S1/G-07 proxy-aware handler. That handler moved from `provision/aws/environment.ts` to `src/targets/aws/sdk.ts`, which imports no client, and `environment.ts` re-exports it. The Lambda bundle therefore gets the handler without the EC2, RDS and STS clients. The SDK's default retry (3 attempts) is kept.
Item: G-03.

### DEC-0460 — `awsLambdaSettings` reads FRAMEWORK_* and Lambda's own variables; it never reads `SECRET_*`, and provisioning refuses to declare it
Origin: ai-proposed · Status: proposed; the database variable names amended by DEC-0469 (G-08's names kept) · Affects: CFG-REQ (config.md §2 "Delivery", "AWS"), SEC-REQ-002, G-02, G-04, G-05, G-08

`src/targets/aws/settings.ts` is the AWS counterpart of Cloudflare's `bindings.ts` (reader) and `settings.ts` (declaration).

Framework variables (`LAMBDA_VARIABLES`):

| Variable | Holds | Used by |
| --- | --- | --- |
| `FRAMEWORK_PUBLIC_ORIGIN` | the stage's public origin | |
| `FRAMEWORK_ACCOUNT_ID` | the account ID | expected owner |
| `FRAMEWORK_LOG_BUCKET` | the shared log bucket | LOG |
| `FRAMEWORK_FILES_BUCKET` | the stage's bucket | G-04 |
| `FRAMEWORK_DB_CLUSTER_ARN`, `FRAMEWORK_DB_SECRET_ARN`, `FRAMEWORK_DB_NAME` | the cluster, the credentials secret and the current database | G-02 |

Lambda's own variables are `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`.

How each side behaves:
- **Reader.** `awsLambdaSettings(env)` reads each value when it is used. A missing required value is `CORE.MISCONFIGURED` and names the variable. `logBucket` is `undefined` instead (DEC-0457). The reader returns nothing for a name starting with `SECRET_`.
- **Declaration.** `awsLambdaEnvironment(input)` builds the variables G-08 puts on the SST Function. `checkLambdaEnvironment` refuses `SECRET_*` names (on AWS, secrets are SSM parameters, and a Lambda's environment can be read through `GetFunctionConfiguration`) and Lambda-reserved names.

Open questions of the G-03 draft, with their state at integration:
1. Variable names shared with G-02, G-04 and G-08: resolved by DEC-0469 (one list, G-08's names).
2. Redacting secrets on AWS: resolved by DEC-0471 (every value read in the cold start).
3. Abort at the bound: resolved by DEC-0470 (abandon, not abort).
4. The SSM client's retry (SDK default of 3 attempts kept): open, to be decided with AWS-AC-005's timing in phase L.
5. Live checks (phase L): a denied `PutObject` to the log bucket answers 403 and the request still succeeds (LOG-AC-001's AWS case); the exact SSM error names for a KMS denial and an unreadable path (`AccessDeniedException`).
Item: G-03.

### DEC-0461 — The AWS `FilesStore` is S3's REST API through aws4fetch, virtual-hosted, header-signed with the role's session credentials
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-001, FILES-REQ-006, files.md §2 AWS, aws.md §2, `src/files/aws/store.ts`, `location.ts`, G-05, G-08

`createS3FilesStore({ location: { bucket, region, accountId }, credentials, fetch?, now? })` implements the `FilesStore` the shared service already runs over. The service is unchanged.
- **Endpoint.** It uses `https://<bucket>.s3.<region>.amazonaws.com/<key>`. The bucket must be a dotless S3 name, because TLS wildcard certificates cover one label. The region and the 12-digit account ID are also checked. A bad value is `CORE.MISCONFIGURED` when the store is created.
- **Signing.** aws4fetch signs every request in its header (`allHeaders`). The request sends `X-Amz-Security-Token` and `x-amz-expected-bucket-owner: <accountId>` (aws.md §2). A `PUT` signs its payload's SHA-256 (`X-Amz-Content-Sha256`), so S3 checks the bytes. Other requests use `UNSIGNED-PAYLOAD`.
- **Bodies.** `put` buffers a stream body, because a single S3 `PUT` needs a length. A Lambda request is buffered already.
- **Mapping.** `get` returns null on 404 `NoSuchKey`; any other 404 (`NoSuchBucket`) is a failure. `head` returns null on any 404, since a `HEAD` has no body. `delete` succeeds on 204, and on 404 `NoSuchKey`. Any other status throws `S3RequestError("S3 <Operation> answered HTTP <n> (<Code>)")`, and a network failure is thrown unchanged. The service turns both into `FILES.UNAVAILABLE` (DEC-0164). S3's error body is never included.
- **No retry.** This follows DEC-0164: no FILES time budget, and the failure surfaces at once. L-1 may revisit it if S3 throttles (`SlowDown`) at PAR-001's load.
- **Credentials.** `lambdaSessionCredentials(env)` reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. All three are required, since role credentials are always temporary. A missing one is `CORE.MISCONFIGURED` naming the variable, never a value. The credentials are read for each request and each ticket.

For G-08 (IAM): the role needs `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`, and `s3:ListBucket` on `arn:aws:s3:::<bucket>`. Without `ListBucket`, S3 answers 403 instead of 404 for an absent key, so `get`/`head` of a missing file would become `FILES.UNAVAILABLE`.

For G-05: wire `createFilesService({ store: createS3FilesStore({ location, credentials: () => lambdaSessionCredentials(process.env) }), tickets: createAwsTicketIssuer({ location, credentials: … }) })`, with `location` taken from the deployment settings (CFG).

Live items carried to L-1 (listed in the S3 fake's header as fidelity gaps): S3 list order and `start-after` on the DEC-0462 names; the `encoding-type=url` character set; `+` in a presigned query; `%2F` in key paths (`x/../y`); CORS headers on S3 403s; 403 versus 404 for an absent key with and without `s3:ListBucket`; the exact error codes (`NoSuchKey`, `ExpiredToken`, `RequestTimeTooSkewed`). `HEAD_CONCURRENCY` (8) is an internal constant, not a parameter.
Item: G-04.

### DEC-0462 — No U+0001 key ending on AWS: S3 already lists in code point order
Origin: ai-proposed · Status: accepted · Affects: DEC-0430, DEC-0162, FILES-REQ-001, `src/files/aws/store.ts`

DEC-0430 is Cloudflare only. Its point 4 says "the shared service, the local target … and any S3 store keep plain keys", and files.md §2 Cloudflare scopes the ending to `cloudflareFilesStore`. The ending works around R2's order, in which the end of a key ranks like a byte between 0x31 and 0x61, and its `startAfter`, which does not follow its listing order.

S3's documented behaviour has neither problem:
- ListObjectsV2 returns general purpose bucket keys "in ascending order based on the key name", which is UTF-8 binary order. So a proper prefix comes first.
- `start-after` "can be any key in the bucket" and returns the keys after it in that order.
- UTF-8 byte order is code point order (FILES-REQ-001).

So the AWS store uses each name as its key, and `startAfter` is the last name.

The fake implements that order. The tests check it on the R2 failure case (`p/a`, `p/a b`, `p/a+`, `p/a/b`, `p/aa`), and on `U+FFFD` before `U+1F600`, which UTF-16 order would swap. Limit-3 pages over S3 pages capped at 1–10 keys return each name exactly once, in order. Not yet observed on AWS. L-1 lists those names on a real stage bucket.
Item: G-04.

### DEC-0463 — Listing: `encoding-type=url`, plus one `HEAD` per listed object for its content type
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-001, FILES-AC-001, DEC-0162, `src/files/aws/store.ts`, `xml.ts`

`FileInfo` includes `contentType`, but S3 listings carry none. So when the service asks for `httpMetadata`, which it always does, `list` sends a `HEAD` for every listed object, at most 8 at a time (`HEAD_CONCURRENCY`), and keeps the listing order. That is up to PAR-232 + 1 `HEAD`s for one page. That cost is acceptable at PAR-001's load, and storing the content type anywhere else would need a second store.

An object deleted between the listing and its `HEAD` is left out. If every object on a truncated S3 page was deleted, the store lists on from that page's last key, so the service never sees an empty truncated page.

The listing asks for `encoding-type=url`. A name may hold characters XML 1.0 cannot carry (U+FFFE, U+FFFF). Keys are decoded with `+` read as a space, as botocore's `unquote_plus` does; S3 sends `+` itself as `%2B`. The XML is read by a small tag reader (`xml.ts`), because Lambda has no DOM parser and no XML dependency is added. A body that is not a `ListBucketResult` is `FILES.UNAVAILABLE`.

Assumed, live item L-1: S3's exact `encoding-type=url` character set.
Item: G-04.

### DEC-0464 — On AWS, a name that is only `.` or `..` is `FILES.INVALID_NAME` for every operation (extends DEC-0328)
Origin: ai-proposed · Status: proposed, owner review open (conflict flagged: FILES-AC-002's `..` case, plan-aws.md §5.1) · Affects: DEC-0328, FILES-REQ-002, FILES-AC-002, `src/files/s3/path.ts`, `packages/framework/test/integration/files/server-operations.test.ts`

On AWS the server operations also go through URLs. WHATWG URL parsing, used by `fetch` and aws4fetch, resolves `.` and `..` path segments, even when they are percent-encoded (`%2e`). So no URL can address the key `.` or `..`.

DEC-0328's rules therefore apply to every AWS operation, through the shared `objectPath`:
- A name with a dot segment (`a/../b`, `../../etc/passwd`, `./x`) is sent with every `/` as `%2F`, and it works.
- A name that is only `.` or `..` is `FILES.INVALID_NAME` for `put`, `get`, `head`, `delete` and both tickets, before any request is sent.

On Cloudflare, only the tickets refuse these names.

Consequence: the FILES-AC-002 cloud case lists `".."` among its round-trip names (`server-operations.test.ts:148`), so on AWS it will fail for that one name. Owner options:
1. Forbid the names `.` and `..` in FILES-REQ-002 on every target. This is recommended: it is one rule, the same on every target, and it removes DEC-0328's ticket corner case too.
2. Accept a documented target difference and adjust the case.
3. Send those two names through `@aws-sdk/client-s3`, whose Node handler does not normalise paths. That adds a second S3 path, and S3's own handling of such keys is unverified.

Taken under the owner's instruction "make an assumption and continue".

Conflict, flagged at integration and not resolved: G-T3's offline pre-check suite runs the shared FILES-AC-002 server-operation cases over the S3 store, and its `".."` round-trip case fails there by design (commit `77267c2`, "Known failure, left failing"). This entry and the shared case cannot both hold on AWS. Both stay as written until the owner chooses an option above (plan-aws.md §5.1).
Item: G-04.

### DEC-0465 — AWS tickets: presigned with the session token signed, content type signed, `attachment` disposition
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-003, DEC-0062, DEC-0313, DEC-0414, `src/files/aws/tickets.ts`

`createAwsTicketIssuer({ location, credentials, now? })` uses the same JSON shape as every target, through `presignUrl`: virtual-hosted URL, `X-Amz-Expires` = PAR-233 / 1000 = 900.
- **Session token.** aws4fetch puts `X-Amz-Security-Token` in the query *before* signing, so the token is signed. The URL carries the key ID, signature and token, never the secret (DEC-0062).
- **Upload.** It signs `Content-Type` (`X-Amz-SignedHeaders=content-type;host`).
- **Download.** It signs `host` and `response-content-disposition: attachment; filename*=UTF-8''<name>` from the shared `downloadDisposition` (DEC-0414, no content type). aws4fetch writes the query back form-encoded, so the disposition's space is `+`, as on Cloudflare, where D-RUN verified it.

Fixed vectors pin the exact URLs, including signatures, for an upload and a download. The vectors use the S3 documentation's example key pair, a made-up session token and a fixed time, and the independent reference agrees with both signatures.

Against the fake:
- another content type, another name or another method is refused with 403;
- a URL with the token removed is refused with 400;
- an unsigned request is refused with 403;
- a ticket works repeatedly through `X-Amz-Date + 900 s`, then gets 403.

A presigned URL also stops working when its signing session expires. files.md §2 already assumes the role session outlasts PAR-233.

Live items (L-1): S3 reading `+` as a space in a presigned query; whether S3 sends CORS headers on its 403s (FILES-AC-003's expired-ticket clause, plan-aws.md §5 Q9); `%2F` in a key path.
Item: G-04.

### DEC-0466 — The bucket's CORS value is SST's `BucketArgs.cors`, every field set; the preflight is shared with Cloudflare
Origin: ai-proposed · Status: accepted · Affects: FILES-REQ-004, DEC-0099, `src/files/aws/cors.ts`, G-08, G-10 (health step)

`bucketCorsArgs(publicOrigin)` returns `{ allowOrigins: [origin], allowMethods: ["PUT", "GET"], allowHeaders: ["Content-Type"], exposeHeaders: [], maxAge: "60 seconds" }`. This is the rule Cloudflare's `bucketCorsPolicy` uses, and a test checks that they agree.

It is shaped for `sst.aws.Bucket`'s `cors` argument, and G-08 passes it unchanged. Every field is set because SST 4.17.2 defaults a missing field to `*` origins, all methods, `*` headers and `ETag` exposed (`bucket.ts:1114-1126`). The origin must be exactly one origin, or the call is `CORE.MISCONFIGURED`.

`checkStorageCors({ location, publicOrigin, fetch? })` sends deploy's one unsigned `OPTIONS` to `https://<bucket>.s3.<region>.amazonaws.com/__framework-cors-check`. It passes only on a 2xx whose `Access-Control-Allow-Origin` is that origin. Block Public Access is G-08's.
Item: G-04.

### DEC-0467 — The S3 protocol code shared by Cloudflare and AWS lives in `src/files/s3/`
Origin: ai-proposed · Status: accepted · Affects: files.md §2 Cloudflare/AWS, `src/files/cloudflare/{sign,sigv4-reference.test-support,cors,tickets,credentials}.ts`, CORE-REQ-006 (G-06 bundle inspection)

Moved without behaviour change, so the AWS bundle does not depend on `files/cloudflare/` for signing:
- `cloudflare/sign.ts` → `s3/sign.ts`. `S3Credentials` gains an optional `sessionToken`, and the new `signRequest` does header signing. `presignUrl` is unchanged for Cloudflare.
- `cloudflare/sigv4-reference.test-support.ts` → `s3/sigv4-reference.test-support.ts`. It gains `expectedHeaderSignature` and `parseAuthorization` for header-signed requests. It now sorts the canonical query by key *and* value, as the specification says, and collapses header whitespace. No existing vector changed.
- The key-path rule is extracted from `cloudflare/tickets.ts` to `s3/path.ts` (`objectPath(name, key)`). Cloudflare passes its stored key with the U+0001 ending. The refusal message is now "cannot be addressed in a storage URL on this target".
- `exactOrigin` and the preflight are extracted from `cloudflare/cors.ts` to `s3/cors.ts`. The Cloudflare exports and their behaviour are unchanged.

`cloudflare/disposition.ts` stays where it is, because files.md §2 "Download names" names that file as the one helper for every target. It has no Cloudflare-only imports.
Item: G-04.

### DEC-0468 — `createAwsLambdaHandler` is `assembleStage` over the AWS adapters, behind `hono/aws-lambda`; it replaces the G-01 stub
Origin: ai-proposed · Status: accepted (owner review open: CloudFront's `Origin` forwarding, plan-aws.md §5.1) · Supersedes: the `createAwsLambdaHandler` row of DEC-0449 · Affects: AWS-REQ-001, AWS-REQ-004, CORE-REQ-005, `FW/src/targets/aws/{public,handler}.ts`

`public.ts` exports `createAwsLambdaHandler(app, resolved, { mock? })` and `createAuthMock`, as before. It calls `createAwsLambdaRuntime(app, resolved, deps)` (`handler.ts`) with `process.env`, the Data API client of the cold start (`dataApiClient`), `createSsmClient(process.env, region)` and, on production stages or with Google configured, the Google login provider. That mirrors `createCloudflareWorker`. Tests call `createAwsLambdaRuntime` with fakes.

The adapters it wires into `StageOptions`:
- **SQL/KV:** `dataApiDb(client, { resourceArn, secretArn, database })` from the Lambda variables. The app's handle gets the request's log, and KV's handle does not (DEC-0149).
- **FILES:** `createS3FilesStore` and `createAwsTicketIssuer`, with `lambdaSessionCredentials(process.env)` read per call. Both are created on first use, so a Lambda with a bad or missing files bucket still serves requests that do not touch files.
- **SEC:** one `ssmSecretReader` for app and framework-internal secrets alike (path `/<app>/<stage>/secrets/<name>`). The SSM client is created on the first read. Required framework secrets are the same as on Cloudflare: the session key, plus the Google client secret on production.
- **LOG:** `s3LogSink` per request, with that invocation's tracker (DEC-0470). Entries outside a request go to marked output lines.
- **Origin and cookies:** the public origin is `FRAMEWORK_PUBLIC_ORIGIN` (`awsLambdaSettings`), and the cookies use the cloud settings.

Construction reads no variable and creates no client. A missing variable is `CORE.MISCONFIGURED` on the request that needs it.

The public event and result types are structural (`FunctionUrlEvent`, `FunctionUrlResult`), so `dist/targets/aws/*.d.ts` need no `@types/aws-lambda`. @types/aws-lambda's `APIGatewayProxyEventV2` is assignable to them, which the fixtures check. There is one boundary cast into Hono's `LambdaEvent`, as DEC-0434 says.

**Origin never from Host (AWS-REQ-004).** Hono builds `c.req.url` from `requestContext.domainName`/`Host`. A fixture with a spoofed host shows the app sees that URL. Even so:
- a POST with a session and `Origin` equal to the spoofed host, to the Function URL host, or absent is `AUTH.REQUEST_FORGERY`;
- only `Origin` equal to `FRAMEWORK_PUBLIC_ORIGIN` passes;
- without that variable the request is `CORE.MISCONFIGURED`, never a fallback to Host.

Note for G-06: `assembleStage` still lives in `targets/cloudflare/stage.ts`. It is target-neutral, and plan-aws G-05 names it. If G-06's bundle inspection forbids anything under a `cloudflare/` directory, move it, unchanged, to a shared place such as `targets/stage.ts`, as G-03 and G-04 did for the key builder and S3 signing.

Open points of the G-05 draft, with their state at integration:
1. The generated entry and the bundle rule: done by DEC-0472 and DEC-0474.
2. Live (phase L): AWS-AC-004 and AWS-AC-006 against the real Function URL and CloudFront, and whether CloudFront passes the `Origin` header to the Function URL origin unchanged. The router's origin request policy must forward it, or every POST with a session would be `AUTH.REQUEST_FORGERY` through CloudFront (owner question, plan-aws.md §5.1).
Item: G-05.

### DEC-0469 — One list of Lambda variable names, `targets/aws/variables.ts`; the G-08 names are kept
Origin: ai-proposed · Status: accepted · Affects: DEC-0460 (open question 1), DEC-0480, `FW/src/targets/aws/{variables,settings}.ts`, `FW/src/provision/aws/sst.ts`

G-03 and G-08 had chosen the database names independently:

| Value | G-03 (`settings.ts`) | G-08 (`sst.ts`) |
| --- | --- | --- |
| cluster | `FRAMEWORK_DB_CLUSTER_ARN` | `FRAMEWORK_DATABASE_CLUSTER_ARN` |
| secret | `FRAMEWORK_DB_SECRET_ARN` | `FRAMEWORK_DATABASE_SECRET_ARN` |
| database | `FRAMEWORK_DB_NAME` | `FRAMEWORK_DATABASE` |

All other names agreed. The G-08 names are kept, because the G-S2 spike and the generated program already use them. The runtime side changes.

`targets/aws/variables.ts` holds `LAMBDA_VARIABLES` and `LAMBDA_RUNTIME_VARIABLES`. It is plain data with no imports.
- `settings.ts` imports both and re-exports them.
- `provision/aws/sst.ts` imports `LAMBDA_VARIABLES` and re-exports it. Its own copy is deleted, and its `database` key is now `databaseName`.

A new test in `sst.unit.test.ts` runs the generated program and takes the Function's environment (minus the app's own variables). It then runs `awsLambdaSettings` over a recording environment through every getter, and asserts three things:
- the variables the program sets equal the variables the runtime reads, minus Lambda's own `AWS_*`;
- both equal `LAMBDA_VARIABLES`;
- the runtime reads the program's values back as the stage's cluster, secret, database, bucket and account.
Item: G-05.

### DEC-0470 — The handler awaits that invocation's pending log writes for at most PAR-260; a write still running then is abandoned
Origin: ai-proposed · Status: accepted · Affects: LOG-REQ-001, LOG-AC-001, AWS-REQ-005, DEC-0456 (open question 3)

- An outer Hono app gives each invocation a fresh `env` object. The stage's `requestSink` looks up that invocation's `createPendingWrites()` tracker in a `WeakMap` keyed by the object, so concurrent invocations never share a tracker, and nothing outlives the request.
- After the stage answers, in a `finally`, the outer app awaits `settle()`. Only then does `hono/aws-lambda` turn the response into the Function URL result. So the handler returns after every write has finished, or after PAR-260 (2 s), whichever comes first.
- **Abandon, not abort**, as G-03 proposed. A write still running at the bound is left, with no `AbortSignal`. It may finish after a thaw, and its failure is swallowed. An abort would lose writes that were about to land, and either way the entry is not awaited. AWS-REQ-005's budget (PAR-270 55 s > PAR-210 45 s + PAR-260 2 s) is unchanged.
- Tests:
  - A write held open keeps the handler pending until it is released.
  - Under fake timers, a write that never completes delays the result by exactly PAR-260, and the handler leaves no timer behind.
  - A 403 AccessDenied on `PutObject` still gives 200.
  - With no log bucket variable, entries go to marked output lines and no `PutObject` is sent.
  - A mutation run with the `settle()` removed fails five tests.
Item: G-05.

### DEC-0471 — Secret redaction on AWS: every secret value the Lambda has read in this cold start
Origin: ai-proposed · Status: proposed · Affects: SEC-REQ-002, HTTP (DEC-0123), SEC-AC-002 (AWS), DEC-0460 (open question 2)

On Cloudflare and locally, `secretValues` is every `SECRET_*` value in the Worker env, that is, every secret value the runtime holds (http.md §2 "Error handler": "Known secret values (supplied by the runtime from SEC)"). On AWS the runtime holds no value until it reads SSM.

So the runtime wraps its one SSM reader (app and framework secrets) and records every non-empty value it returns in a set kept for the cold start. `secretValues` is that set, and the error handler redacts it from both the response and the log entry.
- That covers every value this request read before failing. It also covers values earlier requests read in the same environment, such as an app module that cached one, which is as close as AWS gets to "every value the runtime holds".
- A value the Lambda never read cannot appear in its output, so nothing is missed.
- The set grows only with distinct values: at most one per secret per rotation, for one cold start.

Alternative not taken: a per-request set. It is equivalent for the normal case but misses a value cached across requests.

Tests:
- an `HTTP.CONFLICT` carrying the SSM value answers with `[redacted]`;
- a plain `Error` carrying it answers 500 without it, and none of the `PutObject` bodies contains it.
Item: G-05.

### DEC-0472 — The AWS build writes one Node 22 ESM file, `.framework/aws/bundle/index.mjs`, handler `index.handler`, with the AWS SDK bundled
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-006, AWS-REQ-001, DEC-0432, DEC-0433, DEC-0480, `FW/src/build/{build,bundle}.ts`

- **Entry** (`.framework/aws/entry.mjs`): `export const handler = createAwsLambdaHandler(app, config)` from `<package>/targets/aws`; a test stage imports `createAuthMock` too and passes `{ mock: createAuthMock }`. A production entry does not import the mock, so it is not bundled (PROV-REQ-005). This closes open point 1 of g-05.
- **Bundle** (`bundleLambda`): esbuild with `platform: "node"`, `target: "node22"` (PAR-272), `format: "esm"`, minified, no legal comments, nothing external. `mainFields: ["module", "main"]` prefers the SDK's ESM builds. A banner defines `require` through `createRequire`, because CommonJS dependencies call `require` for Node built-ins and ESM has none. The framework's side-effect-free plugin is shared with the Worker bundle.
- **SDK bundled, not the runtime's.** Everything but Node built-ins is in the file: the pinned rds-data and ssm clients, `@smithy/*`, Hono, drizzle and aws4fetch. The bundle does not depend on the SDK copy in the managed runtime (DEC-0432). S3 is signed `fetch` (G-03, G-04), so `client-s3` is not in the bundle at all.
- **Layout.** `entry.mjs` and `config.mjs` stay in `.framework/aws/`. The bundle has its own directory, `bundle/`, which holds only `index.mjs`, because SST zips the whole `bundle` directory and wants the handler at its root. `buildApp` returns `lambda: { bundle, handler }`, which is exactly `FunctionCode`'s `bundle` and `handler` in `provision/aws/sst.ts` (G-08's test already used `/app/.framework/aws/bundle` and `index.handler`). `AWS_LAMBDA_CODE` holds the names.
- `.mjs` makes Node load the file as ESM without a `package.json`. Lambda's Node runtime resolves `index.handler` to `index.mjs`.
- The fixture bundle is about 0.58 MB minified (a framework app with SQL, KV, FILES, SEC, LOG and AUTH).

Open points of the G-06 draft, with their state at integration:
1. DEC-0397's rule for CORE-AC-006's AWS-bundle clause: removed by DEC-0499.
2. `deploy --target aws` passing `buildApp`'s `lambda` into `FunctionCode`: done by DEC-0494.
3. Live (phase L): the bundle's first cold start on `nodejs22.x` arm64, `process.version`, and the cold-start time at 1024 MB.
Item: G-06.

### DEC-0473 — `assembleStage` and `downloadDisposition` move out of `cloudflare/` directories; re-exports stay
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-006, CORE-AC-006, DEC-0468 (note for G-06), `FW/src/targets/stage.ts`, `FW/src/files/disposition.ts`

The AWS bundle inspection forbids every framework module under a `cloudflare/` directory (DEC-0474). Two target-neutral modules lived under one and were reached from the AWS runtime:
- `targets/cloudflare/stage.ts` (`assembleStage`, `StageOptions`), named by g-05;
- `files/cloudflare/disposition.ts` (`downloadDisposition`), used by the AWS download ticket (G-04) and the local route.

Both moved unchanged, by `git mv`, to `targets/stage.ts` and `files/disposition.ts`. Every framework importer (the three target runtimes, `createTestApp`, the AWS and Cloudflare ticket issuers, and the local route) now imports the new path. The old paths are one-line re-exports, so the Cloudflare and local behaviour and their tests are unchanged, and the old unit tests (`targets/cloudflare/stage.unit.test.ts`, `files/cloudflare/disposition.unit.test.ts`) run through the re-exports. The Cloudflare bundle still holds no AWS module, and `cloudflare-bundles.test.ts` passes.

Alternative not taken: forbidding only `targets/cloudflare/{public,bindings,tickets,settings}` by name. It would let the next shared helper placed under `cloudflare/` pass unnoticed, and the path rule is what "no Cloudflare-only modules" reads as.
Item: G-06.

### DEC-0474 — The AWS build inspects its bundle and fails on a forbidden module, a secret value or the size bound
Origin: ai-proposed · Status: accepted · Affects: CORE-REQ-006, CORE-AC-006, PROV-REQ-005, PROV-AC-005, DEC-0240, new PAR-276, `FW/src/build/inspect.ts`

`buildApp` runs `inspectBundle` on every AWS bundle before it returns. A violation fails the build with `CORE.MISCONFIGURED`, lists every violation, and deletes `bundle/`, so a failed build leaves nothing for `deploy` to upload. The rules mirror the Cloudflare inspection (DEC-0240): module paths from esbuild's metafile, and strings that survive minification.
- **External imports:** only Node built-ins may be left external (`node:module`'s `builtinModules`).
- **Cloudflare-only:** framework modules under any `cloudflare/` directory; `wrangler`, `miniflare`, `workerd`, `@cloudflare/*`; `cloudflare:*` imports; `R2Bucket`, `D1Database`.
- **Provisioning:** framework `provision/`; `sst`, `@pulumi/*`; `setupAccount`, `listStageResources`.
- **CLI-only AWS SDK clients:** ec2, iam, rds, sts, secrets-manager, lambda, resource-groups-tagging-api (DEC-0432). `@aws-sdk/nested-clients` (the credential chain's STS and SSO) is allowed.
- **Postgres harness, stub login provider and test helpers (`testing/`, `*.test-support.*`), the local file-transfer route and its ticket key, tooling.** Same strings as DEC-0240.
- **Authentication mock** (`auth/mock`, `mock-login`): production stages only.
- **Secret values:** no value of a `SECRET_*` variable, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_SESSION_TOKEN` in the build's environment (`BuildOptions.env`, default `process.env`), and no value in the app's `.dev.vars`. Values shorter than 8 characters are skipped. No AWS access key ID (`AKIA`/`ASIA` + 16) may appear. The violation gives a count and never the value.
- **Size:** at most PAR-276 bytes.

Framework module rules match only paths under `packages/framework/{src,dist}/` or `@lago-morph/prototype-framework/{src,dist}/`, so an app's own `src/cloudflare/` or `src/testing/` folder is not flagged.

The Cloudflare build is unchanged: it has no build-time inspection, and its tests inspect it as before. Applying `inspectBundle` with a Workers rule set there is possible later, but would change Cloudflare's behaviour, which G-06 must not do.
Item: G-06.

### DEC-0475 — The shared network is created by SDK calls in `setupAccount`, with fixed names and one tag
Origin: ai-proposed · Status: accepted · Affects: DEC-0074, PROV-REQ-004, AWS-REQ-002/003, aws.md "Deploy mechanics" (plan-aws decision 6)

`setupAccount` creates the shared network directly through EC2 and RDS, not through an SST account app:
- one VPC `10.0.0.0/16`, found by the tag `prototype-framework=shared-network` (and named `prototype-shared`);
- two private subnets, `/20` each from `10.0.0.0/20`, `10.0.16.0/20`, …, in the first two available Availability Zones (sorted by name), one per zone;
- the DB subnet group `prototype-shared` over those two subnets;
- the security group `prototype-shared-db` with no ingress rule (Aurora is reached only through the Data API).

It never creates an internet gateway, NAT gateway, route, address or ingress rule. A tagged VPC that has an internet or NAT gateway, several tagged VPCs, or a `prototype-shared` subnet group in another VPC stop `setup-account` and `deploy` with a message naming them. A partial network (for example a run interrupted after the VPC) is reported `absent` and completed on the next run, reusing every part that exists; a subnet group missing one of the subnets is modified to cover both. `readSharedNetwork` gives G-08 the VPC, subnet, subnet-group and security-group identifiers.

Reason: one call sequence with exact names keeps the network outside every stage's SST state, so stage removal cannot touch it (PROV-REQ-003), and keeps `inspectAccount` read-only. Unverified live: subnet creation right after `CreateVpc` (no waiter is used).
Item: G-07.

### DEC-0476 — The log bucket's location is the account's region; a different `--region` is refused
Origin: ai-proposed · Status: accepted · Affects: DEC-0075, PROV-REQ-006, PROV §2 "State home" (plan-aws decision 7)

The shared log bucket is `prototype-logs-<account-id>`. Ownership is `HeadBucket` with `ExpectedBucketOwner` = the STS account: 200 owned, 404 absent, 403 foreign (PROV-AC-007's AWS case), anything else an error naming the bucket. `CreateBucket` answered `BucketAlreadyOwnedByYou` is success; `BucketAlreadyExists` is foreign. New buckets get `BucketOwnerEnforced` and a full public-access block.

The account's region is read back on every run with `GetBucketLocation` (with the expected owner); it is never stored on the owner's machine. When the bucket is absent, the region is the one given with `setup-account --region`, else PAR-060. A `--region` that differs from an existing bucket's location stops with a message naming both regions; a re-run without `--region` uses the recorded one.
Item: G-07.

### DEC-0477 — The engine check: highest 17.x with `MinCapacity` 0 and `SupportsHttpEndpoint` on `db.serverless`
Origin: ai-proposed · Status: accepted · Affects: PAR-110, PAR-212, PROV-REQ-002 step 1, provisioning.md §2 "State home"

A region passes when `DescribeDBEngineVersions(aurora-postgresql)` lists an `available` 17.x whose `ServerlessV2FeaturesSupport.MinCapacity` is ≤ 0 and for which `DescribeOrderableDBInstanceOptions(db.serverless)` shows `SupportsHttpEndpoint: true`. The highest such minor is PAR-110's value for the region. The check runs:
- in `createSharedResources`, before the first change, and stops with "…; nothing was created";
- in the AWS preflight after STS `GetCallerIdentity`, in the recorded region (skipped while the log bucket is absent: `inspectAccount` then tells the owner to run `setup-account`).

A failing check lists each 17.x it saw and why it was rejected. Unverified live: that AWS fills `ServerlessV2FeaturesSupport` and `SupportsHttpEndpoint` for Aurora PostgreSQL 17 (L-0 resolves PAR-110 in us-east-1; if a field is absent there, this check needs another source and the decision is revisited).
Item: G-07.

### DEC-0478 — The SST state home is bootstrapped with `sst unlock` on a minimal app and inspected through `/sst/bootstrap`
Origin: ai-proposed · Status: accepted · Affects: PROV §2 "State home", PROV-AC-004 (plan-aws decision 7)

Following G-S2 Q4, `setupAccount` writes a minimal `home: "aws"` app (`prototypeaccount`, provider PAR-109, the account region, no resources) into a temporary directory and runs `sst install --stage account`, then `sst unlock --stage account`. `inspectAccount` reads the SSM parameter `/sst/bootstrap`: missing, or `version` < 5 → absent (SST would bootstrap again); otherwise the state bucket it names is checked with `HeadBucket` and the expected owner (owned or foreign). A record naming a missing bucket is an error telling the owner to delete the parameter. After the bootstrap, the state home must read back as owned. Unverified live.
Item: G-07.

### DEC-0479 — CLI-side SDK clients get the proxy-aware handler as an options object
Origin: ai-proposed · Status: accepted · Affects: DEC-0436 (plan-aws decision 14), PAR-111

Every account-setup client is built with `requestHandler: { httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: env }) }`. The SDK turns that options object into `NodeHttpHandler.create(options)`, so the client holds an explicit `NodeHttpHandler` with the G-S1 agent (a unit test checks this for every client) without a direct dependency on `@smithy/node-http-handler`. The S3 client also sets `followRegionRedirects`, since the log bucket may be in another region than the client's.

Credentials are checked by name: `AWS_PROFILE`, a web-identity or container source, or the pair `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`; missing pair members are named. STS failures are reported by the SDK error's name and HTTP status only, never its message.

The ten G-S1 clients (3.1153.0), `aws-sdk-client-mock` 4.1.0 and `@types/aws-lambda` 8.10.164 are now framework dependencies, at exactly the G-S1 versions.

Note at integration: G-02 (DEC-0455) made `@smithy/node-http-handler` 4.12.1 a direct framework dependency, because `sql/data-api.ts` imports it; the account clients described here still get the handler through the options object.
Item: G-07.

### DEC-0480 — The framework's AWS stage program is G-S2's, generated from the app definition with every input embedded as JSON
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-001, AWS-REQ-001…005, DEC-0438…DEC-0443, `FW/src/provision/aws/sst.ts`

`sstProgram` writes G-S2's program, unchanged in shape, from `{ stage, account, filesCors?, http? }`:
- **App settings:** `removal: "remove"`, `home: "aws"`, `state: { purge: true }`, and `providers.aws = { version: PAR-109, region }`.
- **`Files`:** the bucket is named `<app>-<stage>-files-<account>`. It keeps SST's default public-access block. It has `cors: false` unless a CORS rule is passed (see 3).
- **`Database`:** Aurora Postgres at the region's PAR-110 version, with `dataApi`, PAR-212/213 scaling, and the shared network's subnets and security group. Its transform sets the identifier `<app>-<stage>`, `skipFinalSnapshot` and no deletion protection. A global `$transform` names SST's credentials secret `<app>-<stage>-database-credentials`.
- **`Router`, `Site`, `Http`:** declared only when `http` is given. `Site` is declared only when the app has a client.
- **The Function:**
  - name `<app>-<stage>-http`;
  - **`runtime: "nodejs22.x"` and `architecture: "arm64"` set explicitly** (DEC-0433), and `memory: "1024 MB"` (PAR-274);
  - timeout PAR-270;
  - no `vpc` and no `link`;
  - `url: { cors: false, router: { path: "/api", readTimeout: PAR-271 } }`;
  - a role trust policy for Lambda only.
- **Inputs are data only.** They are serialised as one JSON literal typed by an inline interface. That way `tsc` checks them against SST's argument types, and a value can never become code.
- **Refused before any SST run:**
  - `SECRET_*` variables;
  - variables with an `AWS_`, `LAMBDA_` or `SST_` prefix;
  - variables that collide with one the program sets;
  - a credentials-secret ARN that is not the stage's;
  - an RDS-invalid cluster identifier (a leading digit, `--`, or a trailing `-`);
  - a missing shared network.

The Function's environment is the app's framework variables plus `LAMBDA_VARIABLES`:
- `FRAMEWORK_DATABASE`;
- `FRAMEWORK_DATABASE_CLUSTER_ARN` and `FRAMEWORK_DATABASE_SECRET_ARN`;
- `FRAMEWORK_FILES_BUCKET` and `FRAMEWORK_LOG_BUCKET`;
- `FRAMEWORK_ACCOUNT_ID`, for the expected-owner header;
- `FRAMEWORK_PUBLIC_ORIGIN` = `router.url`.

**G-03 and G-05 read these exported names.** If they need different names, the change goes into this one constant.
Item: G-08.

### DEC-0481 — The Function's IAM statements name exact ARNs; the log bucket is put-only under the stage's prefix
Origin: ai-proposed · Status: accepted (owner review open: `kms:Decrypt` for SSM, plan-aws.md §5.1) · Affects: AWS-REQ-003, AWS-AC-003, SEC-AC-003, LOG §2 AWS, `functionPermissions`

`functionPermissions` returns six statements:
- the five `rds-data` transaction and statement actions on `arn:aws:rds:<region>:<acct>:cluster:<app>-<stage>`;
- `secretsmanager:GetSecretValue` on the secret's full ARN. The ARN is checked against `<name>-` plus 6 alphanumerics, so it can never be a wildcard or another stage's secret;
- `s3:GetObject`, `PutObject` and `DeleteObject` on `arn:aws:s3:::<files>/*`, plus `s3:ListBucket` on the bucket itself. FILES lists objects (`ListObjectsV2`), and without `ListBucket` a missing key answers 403 instead of 404;
- `s3:PutObject` only, on `arn:aws:s3:::prototype-logs-<acct>/<app>/<stage>/*` (the LOG-REQ-004 prefix);
- `ssm:GetParameter` on `arn:aws:ssm:<region>:<acct>:parameter/<app>/<stage>/secrets/*`.

Rules, checked by unit tests:
- No action has a wildcard.
- A resource wildcard appears only as a final `/*` under the stage's own key or path prefix.
- No statement grants anything else on the log bucket.

The `aws` partition is assumed.

Unverified live:
- whether reading a SecureString encrypted with the AWS-managed `aws/ssm` key needs an explicit `kms:Decrypt`. It is not granted. AWS-managed keys allow use through SSM by principals in the account;
- the IAM simulation (AWS-AC-003).
Item: G-08.

### DEC-0482 — The files bucket has no CORS rule unless the caller passes one
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003/004 (AWS), G-04, G-10

SST's `Bucket` default CORS allows every origin, header and method. The program sets `cors: false`, so SST creates no `BucketCorsConfiguration` and no cross-origin request is allowed by default. `SstInput.filesCors` passes G-04's rule (allowed origins, methods, headers, exposed headers, max age) through to SST unchanged.

The stage origin is `router.url`, an output of a step-5 component. Two options remain for G-04/G-10:
- pass it as a literal on later deploys;
- set the rule by API after step 5, as Cloudflare does. With `cors: false`, SST then never overwrites it.

That choice is G-04's and G-10's. The bucket must not take a Router output: `Files` is a step-3 target.
Item: G-08.

### DEC-0483 — Step 3 on AWS: untargeted program without the Function on a first deploy, `--target Files,Database` otherwise
Origin: ai-proposed · Status: accepted; the secret ARN's read-back through `stageOutputs` amended by DEC-0490 (found by `DescribeSecret`) · Affects: PROV-REQ-002 step 3, DEC-0440, root cause 2026-10-23-pass1, G-10

`infrastructureDeploy(input, hasDatabase)` mirrors the Cloudflare fix:
- **No database** (a first deploy): it returns the input without `http` and no target. The run is an untargeted `sst deploy` of a program that declares only `Files` and `Database`. SST resolves `--target` only in stored state, so a target cannot be used here.
- **A database exists:** it returns the full program with `--target Files,Database`.
- **A database exists but there is no built code:** it throws before any SST run. This is R1 of the root-cause review.

The other guard stays with G-10's `deployInfrastructure`: refuse the untargeted run when the stage's Function exists (R2), because that run would delete it.

A structural test checks that nothing under Router, Site or Http takes an output of Files or Database, and that `router.url` is the Function's only output input. So `--target-dependents` never ships new code in step 3.

`stageOutputs(dir, …)` reads `databaseSecretArn` and `clusterArn` back from `.sst/outputs.json` and checks they are the stage's. Unverified live: that the outputs file is at that path and holds the run's return values.

`runSst` is the Cloudflare runner with the AWS SST environment: `AWS_REGION` = the account region, `NODE_USE_ENV_PROXY=1`. It reuses `SstExec` and `processSstExec`.
Item: G-08.

### DEC-0484 — The platform type-check runs when a cached SST platform is present and is skipped otherwise
Origin: ai-proposed · Status: accepted · Affects: test economy, G-RUN, the offline `verify`

SST's platform (`.sst/platform`, about 400 MB with `@pulumi/aws`) is created by `sst install` from the npm registry. It is not in the repository. The unit layer makes no network call. So the type-check test looks for a platform in two places:
- `PROTOTYPE_SST_PLATFORM`;
- `apps/*/.framework/provision/{aws,cloudflare}/.sst/platform`.

It accepts only `version` 4.17.2 with `@pulumi/aws` 7.20.0.

It builds a view of the platform with the `providers: { aws }` `config.d.ts` (G-S2 `setup-platform.mjs`) and runs strict `tsc`. **Without a platform it is reported as skipped, not passed.** G-RUN should set `PROTOTYPE_SST_PLATFORM` so that the check counts.

The Pulumi-mock run (DEC-0444) is not ported. The structural tests cover the same names, arguments, permissions, trust policy and step-3 edge rule with no platform or Pulumi runtime. The mock harness stays in the spike for a later item if wanted.
Item: G-08.

### DEC-0485 — AWS database operations: resume wait, create/copy/drop on `postgres`, unclear answers
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: MIG-REQ-003, MIG-REQ-006, migrations.md §2 (AWS), aws.md "Deploy mechanics", G-10, `FW/src/provision/aws/databases.ts`

- **Resume.** Every Data API call goes through sql/data-api.ts's resume loop (proposed PAR-275 backoff), with PAR-210 per call. `whileResuming` is now exported for this. Each operations instance also waits once, before its first operation, with `SELECT 1` on `postgres`. That wait is exposed as `waitForResume()` for G-10. If the cluster is still resuming after PAR-210, the operation fails as "the stage's Aurora cluster did not answer", carrying the `SQL.UNAVAILABLE` text.
- **Statements.** All three statements run connected to `postgres`, outside any transaction, with names quoted:
  - create: `CREATE DATABASE "<n>" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`;
  - copy: `CREATE DATABASE "<new>" TEMPLATE "<old>"`;
  - drop: `DROP DATABASE "<n>" WITH (FORCE)`. A drop that fails with SQLSTATE 3D000 (the database is gone) counts as done, as a 404 does on Cloudflare.
- **Name length.** A name longer than 63 bytes is refused, because Postgres would silently truncate it.
- **`StageDatabase.id` is the database name.** A name is unique within a cluster, and the cluster belongs to the stage.
- **Listing** returns the `datname` values of `pg_database` that are not templates. `postgres` is included; the core's anchored pattern drops it.
- **Unclear answers (DEC-0094).**
  - A Data API SQL error (`BadRequestException` or `DatabaseErrorException` with `SQLState:` in the message) is definitive: nothing was created.
  - Any other failure of a create or copy is unclear. The CLI then looks up the exact name in `pg_database`, and a database found there counts as created. `CREATE DATABASE` is atomic, so a database that exists is complete.
  - A failed copy therefore leaves no database behind, so the Cloudflare-style cleanup drop is not needed. The core's restore path still drops the new database when one is listed.
- **Hints in error messages.**
  - 55006 on a copy: another session is connected to the source.
  - 42P04: a leftover database; the next deploy removes it first.

Questions for phase L:
- Does `CREATE DATABASE … TEMPLATE` of a large database fit within the Data API's 45 s statement limit? `continueAfterTimeout` is not modelled by the fake.
- After such a timeout, the database may appear only later. It is then a leftover, which the next deploy deletes.
- The migrations.md "Early spike": does the Data API leave a pooled connection to the old database open?

Fidelity note on the G-F1 fake (from the draft): the tests strip the `cause` the fake attached to its SQL exceptions (`sdkLike`, as in the G-02 tests), so the operations classify errors by the SQLSTATE in the message, as on AWS. No test depends on `cause`; the G-F1 follow-up (commit `96802c6`) that removed it changes nothing here.
Item: G-09.

### DEC-0486 — One Data API transaction per migration file
Origin: ai-proposed · Status: accepted · Affects: MIG-REQ-003, migrations.md §2 "Record" (AWS), `FW/src/provision/aws/databases.ts`

- Each pending file is applied as follows:
  1. `BeginTransaction` on the new database;
  2. each of its statements unchanged, one `ExecuteStatement` per statement, split at drizzle-kit's breakpoints as locally;
  3. its `__framework_migrations` row, with `applied_at` as `longValue`/int8 into the `bigint` column;
  4. `CommitTransaction`.
- Any failure sends `RollbackTransaction`, best effort, and rethrows. MIG's `applyMigrations` then re-reads the record (DEC-0094). So a commit whose answer was lost counts as applied when its row is present.
- Postgres has transactional DDL, so a failing file leaves nothing of itself. This matches the PGlite applier and Cloudflare's one batch per file.
- Each file is its own transaction, not one transaction for the whole deploy. The reasons:
  - it keeps each transaction well inside the Data API's limits (3 minutes idle, 24 hours total);
  - it matches the per-file atomicity every other target has;
  - on failure the whole copy is dropped anyway (MIG-REQ-003).
Item: G-09.

### DEC-0487 — The Postgres side of the MIG step-4 check
Origin: ai-proposed · Status: accepted · Affects: MIG-REQ-006 step 4, SQL §2.1, `FW/src/mig/cloud/check.ts` consumers

The Postgres `CheckReader` reads through the Data API:
- **Tables.** Base tables of schema `public`, with columns from `information_schema.columns` (`data_type` in lower case, NOT NULL from `is_nullable`), and exact `count(*)` row counts in one `UNION ALL` statement.
- **References.** Every foreign key in `pg_constraint` (`contype = 'f'`) on a `public` table, using MATCH SIMPLE: a row counts as violating only when all its referencing columns are non-null and no parent row matches. The counts are summed per child table. Postgres enforces foreign keys itself, so a violation can arise only from a `NOT VALID` constraint or from a dropped and re-added constraint. The test models the second case.
- **Column rules** of added columns, from the declared type and NOT NULL (sql.md §2.1):
  - `double precision`/`real` must be finite (not NaN or ±Infinity);
  - `bigint` (only `timestamp()`) must be in 0…2⁵³−1;
  - `integer`, `boolean` and `text` are enforced by Postgres's own types (int4 range; UTF-8 text never holds NUL), so only NULL is checked.
  - Negative zero is not checked, as on D1.
- The comparison itself is the target-neutral `checkMigrated`. It reports a changed row count, a missing table that no applied migration drops, orphaned references, broken added-column rules and a record that lacks a migration.
Item: G-09.

### DEC-0488 — Step 3 and step 5 on AWS, with the R1/R2 guards
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-002 steps 3 and 5, DEC-0440, DEC-0483, root cause 2026-10-23-pass1

- **Step 3** goes through G-08's `infrastructureDeploy` and `runSst`:
  - with a database: the full program and `sst deploy --target Files,Database`;
  - without one: an untargeted run of the program without the Function.
- **R1:** step 3 of a stage that has a database but no built code is refused before any AWS or SST call.
- **R2 (the guard G-08 left to G-10):** before the untargeted run, `GetFunction` on `<app>-<stage>-http`. If the Function exists, step 3 fails with "the stage has a Lambda function … but no database; step 3 would delete the function; restore the database or run remove". SST is not run.
- **Step 5** is a full untargeted `sst deploy` against the current database. The public origin is `router.url`, read from the run's `.sst/outputs.json` through `stageOutputs`, with the trailing slash removed.
- **Session key:** `deployCode` writes `frameworkSessionKey` (PAR-253) as a SecureString when it is absent. This happens before the SST run, since the parameter does not depend on the Function. An existing key is never replaced.
- The tests pin the first deploy as `install`, `deploy` (untargeted, `"http": null`), create and migrate db-1, the session key, `deploy` (untargeted, with the Function), CORS, start. A later deploy runs `deploy --target Files,Database`, then `deploy`, and the targeted run leaves the Function untouched.
Item: G-10.

### DEC-0489 — The files bucket's CORS rule is set by API after step 5
Origin: ai-proposed · Status: accepted · Affects: DEC-0482, DEC-0466, FILES-REQ-004, DEC-0099

The origin is a step-5 output, and `Files` is a step-3 target. So the program keeps `cors: false` (SST manages no CORS resource), and `deployCode` sends `PutBucketCors` with `bucketCorsArgs(origin)` translated field for field into the S3 rule, with the expected bucket owner. This is G-08's second option, the same pattern as Cloudflare. It needs no previous-deploy output, so it also works from a clean machine. Step 7 then checks the rule with FILES' unsigned preflight (`checkStorageCors`) through the shared `checkStageHealth`.

Parameter note from the draft: the health check reuses DEC-0090's 30 s retry window. CloudFront propagation may need more; phase L measures it.
Item: G-10.

### DEC-0490 — Identifiers are found by fixed name and lookup, never from local state
Origin: ai-proposed · Status: accepted · Affects: PROV-AC-006, DEC-0438, DEC-0441, DEC-0442, plan-aws decision 8 (`listStageResources` sources)

- **Account and region:** G-07's `awsAccount` (STS and the log bucket's location).
- **Credentials secret ARN:** `DescribeSecret` on `<app>-<stage>-database-credentials`, checked with `checkDatabaseSecretArn`. It is not read from `.sst/outputs.json`, so step 5, the databases and `listStageResources` work without the outputs of an earlier run on the same machine.
- **Engine version:** an existing cluster keeps its own `EngineVersion` (`DescribeDBClusters`). Only a new cluster gets the engine check's PAR-110 value. A newer minor in the region therefore never upgrades a stage's cluster as a side effect of a deploy.
- **Data API operations** (G-09) are built per stage once the secret exists. `migrationDatabase` is synchronous and takes no stage, so the stage is read from the database name `<app>-<stage>-db-<n>`. App names have no hyphens (PAR-290).

`listStageResources` returns the following, de-duplicated by identifier:
1. the Function's ARN (`GetFunction`), the files bucket's ARN (`HeadBucket` with the expected owner), the cluster's ARN and the secret's ARN;
2. every SSM parameter under `/<app>/<stage>/` (recursive), and SST's passphrase `/sst/passphrase/<app>/<stage>`;
3. the stage's SST state objects in the state bucket named by `/sst/bootstrap`, as `<bucket>/<key>`. It lists every version and delete marker of SST's own purge set: `app/<app>/<stage>.json` and `secret/<app>/<stage>.json` as exact keys, and `update/`, `summary/`, `eventlog/` and `snapshot/` as `…/<app>/<stage>/` prefixes. Another stage whose name starts with this one's never matches;
4. every other resource tagged `sst:app=<app>` and `sst:stage=<stage>`, through the Tagging API in the account's region and in us-east-1 (CloudFront). These are reported by ARN, with the kind taken from the ARN. Tag entries of the four fixed-name resources are skipped, since those were checked directly;
5. the databases: `pg_database` through the Data API when the cluster exists, else none.

Unverified live: the Tagging API can keep returning a deleted resource's ARN for a while. A leftover check right after `remove` could then report a resource that is already gone. Phase L's first `remove` must look for this. The fix, if needed, is a per-kind existence check for the ARNs it returns.

Small change outside `target.ts` (from the draft): `account.ts` exports `bootstrapStateBucket` (its parameter narrowed to `{ ssm, region }`), so the target finds the state bucket the way `inspectAccount` does.
Item: G-10.

### DEC-0491 — `removeStage` order and fallbacks
Origin: ai-proposed · Status: accepted (owner review open: a failed `sst remove` keeps the stage's SST state, plan-aws.md §5.1) · Affects: PROV-REQ-003, provisioning.md §2 "Removal", aws.md "remove", DEC-0441, DEC-0442, DEC-0084

The core first deletes the databases by the exact pattern. Then each of these steps is attempted even when an earlier one failed. The failures are thrown together, and the core reports leftovers:
1. **Empty the files bucket.** Every version and every delete marker (`ListObjectVersions`, then versioned `DeleteObjects` in batches of 1000, with the expected owner). A missing bucket counts as done.
2. **Delete the parameters under `/<app>/<stage>/`** (recursive), in batches of 10.
3. **`sst remove`**, skipped only when a successful `HeadObject` shows that the state bucket has no `app/<app>/<stage>.json`, or when the state home does not exist. If the check fails, the failure is recorded and `sst remove` still runs (R3).
4. **Force-delete the credentials secret:** `DeleteSecret` with `ForceDeleteWithoutRecovery: true`. Not-found counts as done. This also covers an `sst remove` that failed or was skipped.
5. **Delete the stage's SST state:** every version of the purge set above, then the passphrase parameter. This step runs only when `sst remove` succeeded or was skipped.

There is no by-name fallback for the cluster, the Function or the CloudFront resources. Unlike Cloudflare's Worker and bucket, they have dependents (instances, routes, the KeyValueStore) that only SST's state knows. So, **unlike Cloudflare (DEC-0084)**, a failed `sst remove` keeps the stage's SST state and passphrase. The failure says so, the state objects appear as leftovers, and a later `remove` runs SST again. A test shows that this retry then removes everything.

`stopApp` treats a missing Function as already stopped. This is the case when step 5 of a first deploy failed. `startApp` reports it as a failure.
Item: G-10.

### DEC-0492 — Where the AWS target is registered
Origin: ai-proposed · Status: proposed · Affects: G-11

The Cloudflare target is registered only in `cli/commands/deploy.ts` `cloudflareOperations`, which builds it from the process environment. That is CLI wiring, so it was left to G-11: `--target aws` still raises `AwsNotImplementedError` there. G-11 should call `createAwsTarget({ env, appDir, code })` with the G-06 `FunctionCode`, and its proxy and CA environment. `createAwsStageClients` already gives every client the proxy-aware handler.
Item: G-10.

### DEC-0493 — One operations factory per cloud target, behind `targetOperations`
Origin: ai-proposed · Status: accepted · Affects: D-05, DEC-0492, DEC-0449, DEC-0501, `cli/commands/{operations,aws-operations,deploy,remove,setup-account,secrets-cloud}.ts`, `tests/compliance/harness/node-deps.ts`

- `cli/commands/operations.ts` holds the registration point `OPERATIONS_FACTORIES = { cloudflare, aws }` and `targetOperations(options)`. `targetOperations` dispatches on `--target`. It refuses `local`, an unknown target, and a region for any target but AWS.
- `cloudflareOperations` moved there unchanged. `deploy.ts` re-exports it, so existing importers keep working. It now refuses every target but Cloudflare with a plain error. Before this item, `aws` threw `AwsNotImplementedError` there. The AWS factory refuses every target but AWS in the same way, so neither target can fall through to the other's code.
- `awsOperations` (`aws-operations.ts`) builds G-07's `awsAccount({ env, region? })` and G-10's `createAwsTarget({ env, appDir, account, code?, fetch? })`. With `requireCredentials` (`remove`, `setup-account`, `secrets set`, the harness), it names the missing credential variables before anything is built. `AWS_PROFILE` or another SDK credential source counts as present. `deploy` leaves that check to its step-1 preflight, as on Cloudflare.
- `deploy`, `remove`, `setup-account` and `secrets set` bind `targetOperations`. So does the compliance harness's leftover check (G-T4). With no AWS credentials, the AWS leftover check now fails with "missing AWS credentials: …" and is recorded as a failed check, never as "no leftovers".
- `AwsNotImplementedError` (`core/aws-pending.ts`) has no caller left, so the file is deleted. `smoke`'s log location and `deploy`'s prepare are built (below), and the G-01 table's last entries are closed.

Which commands this covers: the CLI's cloud commands are `build`, `deploy`, `smoke`, `remove`, `secrets set`, `setup-account` and `certify-auth` (cli.md CLI-REQ-001). The CLI has no `stop`, `start` or `logs` command. `stopApp` and `startApp` run inside `deploy` (PROV-REQ-002 steps 2 and 6). Logs are reached through the location `smoke` prints. `build --target aws` is G-06's. `certify-auth --target aws` needs no AWS call and was already target-neutral.
Item: G-11.

### DEC-0494 — `deploy --target aws` hands `buildApp().lambda` to the stage program as `FunctionCode`
Origin: ai-proposed · Status: accepted · Affects: DEC-0472 (open point 2), PROV-REQ-002, `cli/commands/deploy.ts` `prepareDeploy`

- `prepareDeploy` builds the stage, then the client's assets into `.framework/aws/client/`, which is separate from `bundle/`, the directory SST zips. The code is `{ bundle: lambda.bundle, handler: lambda.handler, assetsDirectory? }`, exactly G-08's `FunctionCode`.
- It adds no `variables`, because the stage program sets every framework Lambda variable itself (`LAMBDA_VARIABLES`).
- A build that returns no `lambda` stops before any operations are built.
- The migration histories are the Postgres ones (`migrations/postgres/`), the dialect of the AWS target (`dialect: "postgres"`). Cloudflare keeps the SQLite ones.
Item: G-11.

### DEC-0495 — The AWS child environment: `SSL_CERT_FILE` from `NODE_EXTRA_CA_CERTS`, both proxy spellings
Origin: ai-proposed · Status: accepted (to be confirmed live; owner review open: Go TLS via `SSL_CERT_FILE`, plan-aws.md §5.1) · Affects: DEC-0436, DEC-0479, DEC-0107, `provision/aws/environment.ts` `sstEnvironment`

`awsChildEnvironment(env)` is the environment of every AWS SDK client and child process the AWS operations create: SST, which runs Pulumi and `pulumi-resource-aws`, and the state-home bootstrap.
- `SSL_CERT_FILE` is set to `NODE_EXTRA_CA_CERTS` when the owner has not set it. Go programs ignore `NODE_EXTRA_CA_CERTS`. An owner's own `SSL_CERT_FILE` is never replaced.
- `HTTPS_PROXY`/`https_proxy` and `NO_PROXY`/`no_proxy` are each set to the same value when either spelling is set.
- `sstEnvironment` still adds `AWS_REGION`, `NODE_USE_ENV_PROXY=1` and the telemetry settings on top.

The SDK clients get `targets/aws/sdk.ts`'s proxy-aware handler, with this environment as `proxyEnv`, through `createAwsClients` and `createAwsStageClients`.

Cloudflare's operations are unchanged and get no such variables, so Cloudflare behaves as before.

Notes:
- In Go, `SSL_CERT_FILE` replaces the default system roots file. The sandbox's bundle (`/root/.ccr/ca-bundle.crt`) holds 123 certificates, which suggests it carries the public roots as well as the proxy CA. Phase L-0 confirms that SST and the Pulumi provider reach AWS through the proxy with this setting.
- The stage clients' Data API client (`createDataApiClient`, G-02) takes its `proxyEnv` from `process.env`, not from the passed environment. In the CLI they are the same process environment apart from the variables added here, and `SSL_CERT_FILE` does not affect Node. This was left unchanged.

Open points of the G-11 draft, with their state at integration:
1. Phase L: the first live `setup-account --target aws` and `deploy --target aws` through the sandbox proxy confirm this entry, that is, Go TLS with `SSL_CERT_FILE` and the Pulumi provider through `HTTPS_PROXY` (owner question, plan-aws.md §5.1).
2. G-12's owner copy-and-paste steps: done (commit `d248f1f`).
Item: G-11.

### DEC-0496 — `setup-account --target aws --region <r>`
Origin: ai-proposed · Status: accepted · Affects: PROV-REQ-004, PROV-REQ-006, DEC-0476, cli.md CLI-REQ-001 table

- `--region` is accepted only with `--target aws`; with any other target it is a usage error (exit 2).
- The value must look like an AWS region name (`^[a-z]{2}(-[a-z]+)+-\d{1,2}$`, for example `us-east-1` or `us-gov-west-1`). Otherwise it is a usage error, before any operations are built.
- The region is passed to `awsAccount` as its chosen region. G-07's rules then apply:
  - a new account's log bucket is created there;
  - without `--region`, a new account gets PAR-060 and an existing one keeps the log bucket's location;
  - a region that differs from an existing log bucket's is refused, naming both regions.
- `deploy` and the other commands never pass a region.
Item: G-11.

### DEC-0497 — `smoke --target aws` prints the S3 prefix and the CloudWatch log group; the account ID is redacted in evidence
Origin: ai-proposed · Status: accepted · Affects: LOG-REQ-003, LOG-REQ-004, CLI-AC-005, DEC-0086, `cli/commands/smoke.ts`

The line printed is "log for today: S3 bucket prototype-logs-<account-id> (<region>), keys under <app>/<stage>/<yyyy>/<mm>/<dd>/ (s3://…/); Lambda output: CloudWatch log group /aws/lambda/<app>-<stage>-http (<region>)".
- The log group is the Lambda runtime's own output. The program sets no `logging`, so it is SST's default group for the Function's name.
- The account ID and region come from G-07's account operations (STS `GetCallerIdentity`, the log bucket's location), using the child environment.
- If they cannot be read (no credentials, for example), the line shows `<account-id>` and the reason, and the run continues. The log location never decides the result, and `smoke` otherwise needs no AWS credentials.
- The account ID is added to the evidence record's redactions (`<account-id>`), the same way the `workers.dev` subdomain is (DEC-0086), because the line is part of the raw smoke log.
Item: G-11.

### DEC-0498 — The AWS not-run detail is "AWS live run pending (no account)"
Origin: ai-proposed · Status: accepted · Affects: `tests/compliance/harness/expected.ts` (`PHASE_RULES` `*`/aws, `AWS_LIVE_PENDING`), plan-aws.md §2, G-EV

The `*` rule on `aws`, in any tier, now has the detail "AWS live run pending (no account)" instead of "AWS phase not started". Phase G builds and pre-checks the AWS code offline. Only phase L records AWS evidence. The rule stays until L-RUN. A dry run of the wiring against fakes (G-RUN) passes its own rules through `DriverDeps.notRunRules`.
Item: G-T4.

### DEC-0499 — DEC-0397's not-run parts become required clauses
Origin: ai-proposed · Status: accepted · Supersedes: DEC-0397 · Affects: CORE-AC-006, SQL-AC-006, `expected.ts` (`CLAUSE_RULES`), `results.ts`

The two part rules of DEC-0397 are removed. In their place, `CLAUSE_RULES` names each clause and a title pattern on `local`, automated tier:
- CORE-AC-006 "AWS-bundle clause": `\bAWS[- ]bundle\b`. This is G-06's bundle inspection; its test title must name the AWS bundle.
- SQL-AC-006 "Data API retry-loop clause": `\bData API retry[- ]loop clause\b`. This is the new criteria test `tests/compliance/criteria/sql/data-api-retry.test.ts`.

A clause with no executed test of its own whose title matches is recorded as its own `not-run` entry: "<part>: no test tagged [ID] for this clause ran on local". So the criterion's other tests passing never stands in for the clause. Until G-06 lands, a local run therefore records CORE-AC-006's AWS-bundle clause as not-run.

The SQL-AC-006 clause test is a criteria-side test in the integration layer, not G-02's unit test. SQL-AC-006 is not unit-level (DEC-0319), so the unit layer would not count G-02's test. Making SQL-AC-006 unit-level would also have counted G-02's Data API fake tests (conflict, too large), which are a pre-check (DEC-0445). The clause test injects the error source (a client whose every call is rejected with `DatabaseResumingException`) and a virtual clock. It runs at three jitter levels.

PROV-AC-007's AWS case (G-07, unit level) and CORE-AC-005's `./targets/aws` tests (G-01, integration layer) were already tagged and selected, so they are not duplicated. `expected.unit.test.ts` checks that they are still there.
Item: G-T4.

### DEC-0500 — Skip notes become the not-run detail
Origin: ai-proposed · Status: accepted · Affects: compliance.md "Driver" ("each skipped tagged test adds a `not-run` entry"), AWS-AC-005, `tests/compliance/harness/{skip-notes-reporter,reports,results,driver}.ts`

Vitest's JSON report has no field for a `skip(note)` note. The driver now adds a reporter, `tests/compliance/harness/skip-notes-reporter.ts`, before the JSON reporter. It copies the note into the test's `meta.skipNote`, which the JSON report does carry. Playwright notes are read from the `skip` annotation.

A skipped test with a note gets its own `not-run` entry, and its detail is the note (a leading "not-run:" is dropped, and the detail is capped at 1,000 characters). Skipped tests without a note are still listed together by title.
Item: G-T4.

### DEC-0501 — Driver `--target aws`: names, leftovers, usage caps
Origin: ai-proposed · Status: accepted (to be confirmed live); the "until then" fallback of the leftover check ended by DEC-0493 · Affects: compliance.md "Driver" and "Test stages", plan §1 "Cloud usage limits", `tests/compliance/harness/{aws-usage,driver,node-deps}.ts`, `criteria/_cloud/aws/usage.ts`, `criteria/prov/support/stage.ts`

- **Names.** The run stage is still `test-<run ID>`. Before deploying, the driver checks the stage's fixed AWS names (DEC-0438/DEC-0480):
  - the cluster `<app>-<stage>`: at most 63 characters, starting with a letter, with no doubled, leading or trailing hyphen;
  - the Function `<app>-<stage>-http`: at most 64 characters;
  - the bucket `<app>-<stage>-files-<account-id>`: at most 63 characters.

  With PAR-290 and PAR-291 every run stage passes. The check stops a hand-given `--stage` that would break a rule.
- **Leftovers.** The leftover check uses the framework's own operations factory, the one `remove` wires (`cloudflareOperations`, which G-11 extends to AWS with G-10's `TargetOperations`). Until then it throws "AWS target not yet implemented", and the record lists that as a failed leftover check. Tests pass a `FakeTarget` through `OperationsFactory`. The AWS deploy output's public origin is the CloudFront URL, never the Function URL.
- **At most 3 Aurora clusters at once.** Before deploying, the driver counts the account's test-stage clusters (`<app>-test-…`, RDS `DescribeDBClusters` through the counted hooks). It refuses a fourth: the deploy is not attempted, the stage is not added to the pending list, and the criteria are recorded not-run with the reason. Further stages made by stage-lifecycle tests take the same check (`requireClusterRoom` in `takeStageRoom`), which reports a missing prerequisite on AWS. On Cloudflare that check is still the D1 database cap.
- **API-call count.** Each process that uses the hooks prints `[g-t1] aws api calls in this process: <n>`. The driver sums these lines per test run, adds its own process's count, and writes the result to `raw/aws-usage.log`. It sets `COMPLIANCE_AWS_MAX_CALLS` to what is left of the run's cap for each run, and starts no further run once the cap is used up. A total above the cap gives exit 1. The proposed run cap is 2,000 hook calls, `COMPLIANCE_AWS_MAX_RUN_CALLS` overrides it. Calls the framework CLI makes (deploy, remove, the leftover check) are not counted.

Note at integration: the run cap is PAR-282 and the cluster cap PAR-283.
Item: G-T4.

### DEC-0502 — `cloudHooks("aws")` carries the `AwsCloudHooks` members
Origin: ai-proposed · Status: accepted (to be confirmed live) · Affects: `tests/compliance/criteria/_cloud/aws/{criteria-hooks,index,api}.ts`, AWS-AC-002…006

`awsCloudHooks()` returns G-T2's `AwsCloudHooks`:
- `simulatePrincipalPolicy`, `functionUrl` and `observeCluster` are G-T1's simulation, Function URL and pause observer. An observer that reports "never pauses" maps to not paused, and the detail says so.
- `stageResources` reads the role from the Function, the cluster ARN and the credentials secret's ARN.
- `stageFunctions` lists Lambda functions with the stage's name prefix.
- `stageNatGateways` lists NAT gateways that are not `deleted` and are in the shared VPC (found by the tag `prototype-framework=shared-network`, DEC-0475), in any VPC a stage function names, or tagged with the stage. An EC2 client is added to the hooks' clients.
Item: G-T4.

### DEC-0503 — The driver gives the AWS test hooks the account's region
Origin: ai-proposed · Status: accepted · Affects: `tests/compliance/harness/{driver,node-deps}.ts`, `tests/compliance/criteria/_cloud/aws/{api,usage}.ts`, plan-aws.md §4 (`AWS_REGION` item)

On `--target aws`, right after building the stage operations and before removing old stages or deploying, the driver reads the account's region. It reads it the way `deploy` and `smoke` do (DEC-0075, DEC-0476): G-07's `awsAccount(...).region()` with the CLI's AWS child environment. That is the log bucket's location, or PAR-060 when the account has no log bucket yet. Operations that cannot read it fall back to `AWS_REGION`, then `AWS_DEFAULT_REGION`. When the account has a region, it wins over a different `AWS_REGION`, and the driver prints a note. With no region, or when reading it fails, the driver stops with a `PrerequisiteMissingError` before deploying. Every criterion that would have run is then recorded not-run with that reason. Every test process gets `AWS_REGION` and `AWS_DEFAULT_REGION` set to the region. The cluster count in the driver's own process gets it too, through `testStageClusters(region)`. `raw/aws-usage.log` records it. Reading the region costs STS `GetCallerIdentity` plus the log bucket's head and location, 2 or 3 calls. Like the framework CLI's own calls, they are not counted against the hooks' cap. The owner no longer needs to export `AWS_REGION`.
Item: G-EV fixes (F4, F3).

### DEC-0504 — A run against fakes is marked `dryRun` and never counted
Origin: ai-proposed · Status: accepted · Affects: `docs/contracts/schemas/evidence.schema.json` (new optional `dryRun` string), `packages/framework/src/evidence/{schema,writer}.ts`, `tests/compliance/harness/{driver,node-deps}.ts`, `tests/compliance/tools/{records,release,traceability}.ts`

The evidence record gets an optional `dryRun` string, which says what was faked. The driver sets it when `DriverDeps.notRunRules` is not `PHASE_RULES`. It also sets it when the stage operations carry a `dryRun` of their own. `cliStageOps` gives them one when it is built on a fake CLI runner or a fake `OperationsFactory`. `readRecords` lists such a record among the skipped files ("a dry run (…), never evidence"). The release and traceability reports also drop it themselves, so a marked record never counts, wherever it is stored. GD (`validation/local/phase-G/aws-dry-run/…/rx3n81izmc4esca.json`) predates the field. It stays unmarked as committed and must still never be moved under `validation/aws/`.
Item: G-EV fixes (F4, F3).

### DEC-0505 — The file names `.` and `..` are invalid on every target
Origin: owner · Status: accepted · Resolves: the DEC-0464 / FILES-AC-002 conflict (plan-aws.md §5.1 Q1) · Affects: FILES-REQ-002, FILES-AC-002, DEC-0328, DEC-0464, `packages/framework/src/files/names.ts`, `packages/framework/test/integration/files/server-operations.cases.ts`, `tests/compliance/criteria/files/server-operations.test.ts`, `skill/reference/files.md`

The owner, 2026-10-24: "File names of . and .. are ridiculous and should never be allowed." FILES-REQ-002 now says a name MUST NOT be exactly `.` or `..`. The shared check (`checkName`, which every FILES operation that takes a name calls before any storage call) rejects both with `FILES.INVALID_NAME` on local, Cloudflare and AWS. Only the whole name is tested. Names that merely contain dots (`...`, `.x`) and names with `.` or `..` as a `/`-separated segment (`a/../b`, `./x`, `../../etc/passwd`) keep their documented behaviour: they are valid and never resolved as paths, since FILES-REQ-002 says names are not paths, so segments are not names. List prefixes are unchanged (a prefix `..` still lists names such as `../up.txt`). DEC-0328's `%2F` rule for dot segments stays. Its ticket refusal, and DEC-0464's refusal in `objectPath`, now act only as a second guard behind `checkName`, so there is no target difference. FILES-AC-002's round-trip case no longer lists `..` (`...` takes its place), and its rejection cases add `.` and `..`. G-T3's aws-precheck suite runs the same cases and now passes.

## Release scope (2026-10-24)

### DEC-0508 — Release 1 is local and Cloudflare; the AWS target is deferred to a later release (branch `aws`)
Origin: owner · Status: accepted · Amends: DEC-0001, DEC-0020 (for release 1) · Affects: SYS-REQ-001, SYS-REQ-026, COMPL-REQ-001, COMPL-REQ-006, COMPL-AC-001, COMPL-AC-006, CORE-REQ-005, `docs/components/aws.md`, the AWS sections of the component documents, the AWS parameters, `tests/compliance/harness/{catalogue,args,env,expected,driver,node-deps}.ts`, `tests/compliance/tools/{traceability,release}.ts`, `skill/`, `apps/template/README.md`

The owner, 2026-10-24: "Move aws code to a branch". The first release targets local and Cloudflare only. The AWS target follows in a later release.

- **Where the AWS work is.** Everything built for AWS (phase G, offline: DEC-0432…DEC-0504) is kept on the branch `aws` (head `07be83f`), never run live. The index for picking it up again, with the open database question for the owner's test accounts, is `ai/implementation/aws-deferred.md`.
- **What left the release branch.** The AWS target runtime, provisioning, Data API adapter, S3 file store, log sink and SSM secrets (`src/targets/aws/`, `src/provision/aws/`, `src/sql/data-api*`, `src/files/aws/`, `src/log/aws/`, `src/secrets/aws.ts`); the AWS build path and the Lambda bundle inspection, which only AWS used; the CLI's `--target aws` wiring (`aws-operations.ts`, `setup-account --region`); `"aws"` in the framework's `Target` and the `./targets/aws` export (so DEC-0447 and DEC-0448 no longer hold on this branch, and DEC-0110's subpath table applies again); the AWS criteria tests and cloud hooks, the AWS usage caps and region step of the compliance driver (DEC-0501, DEC-0503), the aws-precheck suites, the `config/aws/` files (DEC-0450); the AWS SDK, `aws-sdk-client-mock`, `@types/aws-lambda` and `@smithy/node-http-handler` dependencies; and the phase G records (`validation/local/phase-G/`, the spikes `g-s1`/`g-s2`, `plan-aws.md`, the `g-*` decision drafts, `G-aws-offline.md`).
- **What stays, because local or Cloudflare uses it.** The shared S3 signing, URL path and CORS preflight in `src/files/s3/` (DEC-0467), `src/files/disposition.ts` and `src/targets/stage.ts` (DEC-0473), `src/log/keys.ts` (DEC-0458), the per-target operations factory, now registering Cloudflare only (DEC-0493), the `dryRun` evidence marker (DEC-0504), the skip-notes reporter (DEC-0500), the clause-rule kind with no rules (DEC-0499), the root `vitest.config.ts` and the other test-robustness fixes, and the ban on the file names `.` and `..` (DEC-0505).
- **Requirements.** SYS-REQ-001 and SYS-REQ-026 carry an amendment note for release 1. Every other requirement, criterion, scenario and parameter that names AWS is kept as written and marked "deferred (branch `aws`)" where it stands. `docs/components/aws.md` is marked deferred at its top; its content is kept for the record. A requirement's AWS clause binds again when the AWS release starts.
- **What the harness and reports judge.** The catalogue still reads every criterion. `npm run compliance` refuses `--target aws`, no not-run rule names AWS, and the AWS clauses of Local criteria (CORE-AC-006's AWS bundle, SQL-AC-006's Data API retry loop) are not required (no clause rules). The traceability report shows results for local and Cloudflare only and lists the AWS-only criteria as deferred, never as untested. The release report (COMPL-AC-006) judges local and Cloudflare only, so no AWS criterion or record is ever listed as missing.
- **Numbering.** DEC-0506 and DEC-0507 were used on the branch `aws` after it was split off (DEC-0506: at most 8 Lambda functions, PAR-284, budget alarm removed; DEC-0507: region guard under `PROTOTYPE_AWS_SANDBOX=pluralsight`). They are not reused here, and are not recorded on this branch; this entry is DEC-0508 so the two logs never give one number two meanings. Merging the branches brings them in unchanged.

## Login: email and password with Better Auth (2026-10-25)

Plan: `ai/implementation/plan-auth.md`. Spike evidence: `ai/implementation/spikes/ba-s1-s3/RESULT.md` (S1, S3, and the offline part of S2). The owner answered the plan's §7 on 2026-10-24 and 2026-10-25.

### DEC-0509 — Email and password, through Better Auth self-hosted in the app's Worker, is release 1's real login provider; Workers Paid is required
Origin: owner · Status: accepted · Supersedes: DEC-0016 (its Google part, for release 1) · Affects: SYS-REQ-019, SYS-REQ-026, SYS-REQ-027, AUTH, `docs/components/password.md` (PWD), `docs/components/mail.md` (MAIL), CF, PROV, CLI, COMPL, SKILL, PAR-122, PAR-241…PAR-245, PAR-254…PAR-259

The owner, 2026-10-24: Better Auth (BA), self-hosted in the app's Worker. The account is on Workers Paid, and the owner confirmed on 2026-10-25 that Workers Paid is active. Password hashing (scrypt, about 72 ms CPU per operation in local workerd, RESULT.md S2) does not fit the Free plan's CPU limit, so Workers Paid is a prerequisite of every Cloudflare account that hosts a production stage. The new component PWD owns the provider. App code still sees only the access level, the opaque user ID and the display name (SYS-REQ-017). Further providers stay addable behind the provider interface (SYS-REQ-019).

### DEC-0510 — The framework keeps its own session; Better Auth handles credentials only
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-006, AUTH-REQ-008, PWD-REQ-003, `docs/contracts/ts/internal/login-provider.d.ts` (`CredentialProvider`)

Proposed in plan-auth.md §1 and confirmed by spike S3. The stateless `__Host-session` cookie (DEC-0028) stays the only session, for these reasons:
- `identify()` needs no database read per request;
- the mock uses the same cookie;
- the admin and users lists are judged per request;
- MIG-AC-006's session survives a schema-changing deploy.

PWD implements the internal `CredentialProvider`, which returns `ProviderIdentity { subject: <BA user ID>, displayName: <BA user name> }`. AUTH derives the user ID as `deriveUserId("password", subject)` (DEC-0067) and issues the framework session.

Framework routes forward a rebuilt request to BA's own handler (the "handler bridge"), because BA's server-side API calls skip its rate limiter. The bridge:
- copies only `Origin`, `CF-Connecting-IP` and `User-Agent`;
- returns none of BA's headers;
- deletes the BA session row that a sign-in creates.

BA's admin and test-utils plugins are not used.

### DEC-0511 — Email verification is mandatory, sent through Cloudflare Email Service from `no-reply@<domain>`
Origin: owner · Status: accepted · Affects: PWD-REQ-001, MAIL-REQ-001…MAIL-REQ-005, CF §2, PROV-REQ-002, PROV-REQ-004

The owner, 2026-10-24: for self-hosted auth, email verification is mandatory, sent through Cloudflare Email Service (https://developers.cloudflare.com/email-service/). Arbitrary recipients need Workers Paid and a sender domain on Cloudflare DNS.

The owner, 2026-10-25: "Sender no-reply@domain." The local part is fixed as `no-reply`, and the domain is DEC-0514's single setting. A new component, MAIL, owns sending.

### DEC-0512 — An automated real-provider check on a production deployment replaces the guided manual certification
Origin: owner · Status: accepted · Supersedes: DEC-0021 · Affects: SYS-REQ-026, SYS-REQ-027, PWD-AC-009, AUTH-AC-011, COMPL-REQ-005, COMPL-REQ-006, COMPL-AC-005, COMPL-AC-006, E2E-006, E2E-008, CLI-REQ-001

The owner, 2026-10-24: setup and testing must be possible for an AI agent without manual steps or browser automation. `check-login --target cloudflare --stage prodcheck` replaces `certify-auth`. Over HTTP only, it:
- signs up a fresh address under `t.<domain>`;
- reads the real email from the framework's mail sink and verifies;
- signs in;
- resets the password;
- checks the rate limit;
- writes one evidence record.

It runs on every compliance cloud run (COMPL-REQ-005), so the real provider is checked on every run, not as a rarely repeated milestone item. That is about three real sends per run.

### DEC-0513 — Google is dropped from release 1; its code is kept on the branch `google`
Origin: owner · Status: accepted · Supersedes: DEC-0016 (its Google part) · Affects: `docs/components/google.md` (retired), GOOGLE-REQ-001…GOOGLE-REQ-005, GOOGLE-AC-001, GOOGLE-AC-002, GOOGLE-AC-003, GOOGLE-AC-005, SEC §2 (`frameworkGoogleClientSecret`), CFG (`framework.google`), CLI-REQ-001 (`certify-auth`), COMPL-REQ-006, PAR-106, the component map, `tests/compliance/harness/expected.ts`

The owner, 2026-10-24/25: "Drop Google." The Google provider's code is preserved on the branch `google`.
- **The document.** `google.md` is kept for the record and marked retired. Its requirements are retired, with pointers to the PWD requirements. Its criteria leave the criteria tables, so the catalogue no longer reads them, and are listed in a "Retired criteria" table.
- **The code.** `src/google/`, its tests, `certify-auth` and the `jose` dependency (PAR-106) leave the release branch in implementation item I-G. Until then the code stays, and its tests' tags name retired IDs, which the traceability report lists under "Tags naming no defined criterion or scenario".
- **Configuration.** `framework.google` leaves the stage-config contract now. The Zod mirror (`src/config/schema.ts`) follows in item I-E.
- **Later.** Re-adding Google means a new decision, a provider beside PWD behind the same interface, and new IDs.

### DEC-0514 — The email domain is one account setting, initially `shareplay.com`; every address derives from it
Origin: owner · Status: accepted · Affects: MAIL-REQ-003, MAIL-AC-004, MAIL-AC-005, PROV-REQ-002, PROV-REQ-004, CF §2, CLI-REQ-001 (`setup-account`, `check-login`, `mail`), `docs/contracts/schemas/stage-config.schema.json` (`framework.email`)

The owner, 2026-10-25: "Make domain configurable in one place, initially shareplay.com." The owner will change the domain later, after a transfer. An interim value given earlier the same day, `lago-morph.xyz`, was replaced before anything was built on it.

Where the one setting lives:
- **The setting.** The key `emailDomain` of the Cloudflare account settings record. The record is the JSON object `framework/account.json` in the account's state home bucket `sst-state` (DEC-0084); SST's own objects use other top-level prefixes. It lives with the shared resources, as PROV §2 requires of account settings, so a clean machine finds it. Only `setup-account --target cloudflare --email-domain <domain>` writes it, and that is also how the owner changes it.
- **What derives from it.** The sender `no-reply@<emailDomain>` and the test mailbox subdomain `t.<emailDomain>`, nothing else.
- **Who reads it.** Each of these reads the record at run time, and none keeps a copy in a committed file:
  - `setup-account`: sending onboarding, and Email Routing on `t.<emailDomain>`;
  - `deploy`: the preflight, the `EMAIL` binding's allowed sender, and the Worker variable `FRAMEWORK_MAIL_FROM`, which is how the mail sender gets the address;
  - `check-login` and `mail --target cloudflare`: the test addresses.
- **No other copy.** No framework source, app, configuration file, template, skill text or test may hard-code the domain, or a sender address on it.
  - Owner instructions write `<domain>`.
  - Tests use reserved names (`example.test`, `localhost`).
  - The stage configuration has no place for an address: `framework.email` holds only the sender's display name.
  - This replaces the plan's per-stage `framework.email.from` and its build check that `from` is on the account's domain. With no copy to compare, that check becomes a repository scan (MAIL-AC-005).
- **Local and in-process.** There is no account there. The `dev`, `createTestApp` and `test-*` capture senders never send. Locally the sender is `no-reply@localhost`; on a cloud test stage it is the derived address.

`shareplay.com` was onboarded for Cloudflare Email Sending on the account on 2026-10-25, by `POST /zones/{zone}/email/sending/subdomains`, with DNS records under `cf-bounce.shareplay.com` and `_dmarc.shareplay.com`. `setup-account` must still do this itself, idempotently: it lists the zone's sending subdomains first and creates nothing that exists.

### DEC-0515 — The Cloudflare API token's email permissions
Origin: owner · Status: accepted; the production deploy's permission check amended by DEC-0553 (it reads with Zone Read and Email Sending Read; the write permissions are `setup-account`'s), the one token split into two by DEC-0551 · Affects: PROV-REQ-002 (preflight), PROV-REQ-004, PROV §2 "Credentials", SKILL-REQ-006

The owner, 2026-10-25: the existing API token already has the email permissions. Besides the permissions it already needs (Workers, D1, R2, API tokens, the workers.dev subdomain), the token carries:
- account: Email Sending Write, Email Routing Addresses Write;
- zone (the email domain's zone): Email Routing Rules Write, DNS Write, Zone Settings Write, Zone Read.

Account and zone permissions on one token are accepted. `setup-account`, and the preflight of a production stage's `deploy`, check them and name each one that is missing (PROV-REQ-002).

### DEC-0516 — How the framework uses Better Auth: the spike's corrections
Origin: ai-proposed · Status: accepted · Supersedes: DEC-0171 (its sentences on login without a real provider) · Affects: AUTH-REQ-007, AUTH-REQ-010, AUTH §2, PWD-REQ-001…PWD-REQ-007, CF-REQ-003, `docs/contracts/http/internal/auth-password.openapi.yaml`

From RESULT.md (problems P1–P11), which corrects plan-auth.md §1:
- **The forgery check is the primary defence.** BA checks `Origin` only on sign-in and sign-up; on forgot, reset and resend it checks it only when a `Cookie` header is present, and the bridge never forwards one (P3). So AUTH-REQ-007 requires `Origin` equal to the public origin on every POST to `/api/auth/*`, with or without a session. BA's `trustedOrigins` is not a second layer for those routes.
- **Always on.** BA turns its origin check off under `NODE_ENV=test` or a truthy `TEST` (P1), and its rate limiter outside `NODE_ENV=production` (P2). The framework always passes `advanced.disableOriginCheck: false` and `rateLimit.enabled: true`, on every target and in `createTestApp`.
- **BA's bodies are never forwarded.** Sign-up answers differ in their values for an existing and a new address (P9). Every framework route answers with its own fixed body or redirect.
- **Verify.** BA's verify is GET only (P4), so the framework's POST verify calls it server-side as a GET through the bridge. The verify token is a stateless JWT: a replay within PAR-256 answers success and creates nothing.
- **No email on a refused sign-in.** `sendOnSignIn` is off (P8), so a refused sign-in sends nothing and cannot spend the sending quota. The user asks for a new link with the explicit resend action (PAR-259).
- **Import** from `better-auth/minimal`, with `better-auth/adapters/drizzle` (P5). The bundle then references only `node:crypto` and `node:async_hooks`, and `nodejs_compat` is set explicitly.
- **Client IP.** The rate-limit key uses the IP from `CF-Connecting-IP` (P7). `createTestApp` and `dev` supply `127.0.0.1` unless the request sets the header.
- **Logging.** BA's logger maps to LOG entries with fixed reasons, never BA's message text, so no address reaches the log (P10).
- **Other options.** Telemetry is off. BA's `baseURL` is the resolved public origin, never a request header.
- **One sign-in page on every stage.** PWD is installed on every stage, including `dev` and `test-*` stages, beside the mock where the mock is allowed. So `GET /api/auth/login` always redirects to the sign-in page. This replaces DEC-0171's rule that, with the mock and no real provider, `/api/auth/login` logs in as the mock's default user. Tests choose an identity with `mock-login` as before.

### DEC-0517 — Parameter values for the password provider and mail
Origin: owner-approved · Status: accepted · Affects: PAR-122, PAR-241…PAR-245, PAR-254…PAR-259

The owner, 2026-10-25: "Approve recommended values", meaning the PARs in plan-auth.md §5 and RESULT.md's recommendations. The parameters register records:
- password length 12 to 128 characters;
- verification link valid 24 h, reset link 1 h;
- rate limits per IP: sign-in 5 per 60 s; sign-up, forgot and resend 3 per 300 s; verify and reset submissions 10 per 60 s; BA's default rule 100 per 60 s;
- scrypt N=16384, r=16, p=1, a 64-byte key and a 16-byte salt (BA's default);
- mail sink retention 1 day;
- a Worker bundle bound.

**The better-auth pin** is exactly `1.7.7`, the newest version at least two weeks old on 2026-10-25. Version 1.7.12, which the spike ran, was 4 days old. The implementer moves the pin to `1.7.12` only if it needs a fix made in 1.7.8–1.7.12, and records that fix in a decision entry.

**Numbering.** The plan's PAR-240 for the sink retention is not used: PAR-240 is retired (DEC-0077) and IDs are never reused, so the retention is PAR-241.

### DEC-0518 — MAIL: one sender interface, one sender per kind of stage, and an account-level mail sink
Origin: ai-proposed · Status: accepted · Affects: MAIL-REQ-001…MAIL-REQ-005, LOCAL-REQ-002, `docs/contracts/ts/testing.d.ts` (`TestApp.mail`), PROV-REQ-004, CLI-REQ-001 (`mail`)

From plan-auth.md §2 and §3. `MailSender.send({ to, subject, text, html })` is framework-internal. It runs in the request's `waitUntil`, through BA's `advanced.backgroundTasks.handler`.

The senders:
- production stages: the Email Service binding `EMAIL` (`send_email`, allowed sender `no-reply@<domain>`);
- `test-*` stages: a capture sender with `GET /api/__framework/test-mail?to=`. Both are excluded from production bundles, like the mock;
- local `dev`: a capture sender. It prints a marked line, which `dev` writes to the git-ignored `.mail/<ts>-<id>.json`, like `.logs/`. Miniflare's own email output folder is not relied on;
- `createTestApp`: an in-memory outbox.

Real delivery is checked through the account-level sink:
- Email Routing on `t.<domain>`, with a catch-all rule to the framework's sink Worker `prototype-mailsink`;
- the sink writes the raw message to the R2 bucket `prototype-mailsink`, which has a lifecycle rule (PAR-241);
- the sink is a shared account resource: `setup-account` creates it, and stage removal never touches it.

Open spike questions:
- S5: how SST/Pulumi express the `send_email` binding, and whether secrets survive the Worker update;
- S4: Email Service quotas, and when `E_SENDER_NOT_VERIFIED` appears.

### DEC-0519 — Accepted limitations of the password provider
Origin: ai-proposed · Status: accepted · Affects: PWD-REQ-004, MAIL-REQ-001, COMPL-REQ-005

- **A reset does not end framework sessions.** A reset revokes BA's sessions, of which there are none after the bridge. Framework sessions are stateless (DEC-0028) and stay valid until they expire (PAR-250). This is out of scope, like revocable sessions (system spec §4).
- **Send failures are logged, not shown.** Sends run after the response, so the page cannot report a failed send without revealing whether the account exists.
  - The failure is one LOG entry with a fixed reason and the provider's error code, never the address.
  - The "check your email" page always offers resend.
  - So an Email Service outage or suspension blocks sign-up without telling the user; the owner sees it in the log.
- **Test users accumulate on `prodcheck`.** Each `check-login` run leaves one verified test user. This is accepted for now; a cleanup route can come later.
- **The rate limiter counts every request**, successes included (P6). It costs 1–3 D1 queries per bridged request.

### DEC-0520 — Where the spec differs from plan-auth.md §5
Origin: ai-proposed · Status: accepted; its first bullet amended by DEC-0526 (E2E-007's cloud part and AUTH-AC-005's admin part are automated); the meaning text of `AUTH.NOT_VERIFIED` amended by DEC-0528 · Affects: E2E-007, E2E-008, AUTH-AC-005, SKILL-AC-006, PWD §2, `docs/contracts/ts/errors.d.ts`, `tests/compliance/harness/expected.ts`

- **The admin-list criteria stay milestone items, performed by an AI agent.** The plan has E2E-007's cloud part "automated in check-login". Becoming an admin needs a committed change to `config/cloudflare/prodcheck.json` and a redeploy, and each `check-login` run uses a fresh user, so it cannot run on every commit.
  - E2E-007's cloud part, AUTH-AC-005's admin-list part and SKILL-AC-006 stay milestone items.
  - The tester reads the mail with `mail --target cloudflare`, so no owner step remains.
  - E2E-008 becomes an automated scenario, run by `check-login`.
- **Two new error codes**, `AUTH.NOT_VERIFIED` (403) and `AUTH.RATE_LIMITED` (429, retryable), are specified in PWD §2 and in the internal HTTP contract. They are added to `errors.d.ts` together with `ERROR_CATALOGUE` in implementation item I-C. The reason: the catalogue's unit test transcribes `errors.d.ts` exactly, and this item changes documents and contracts only.
- **Not-run rules.** The criteria that need the password provider on a cloud stage get this phase's not-run rule "password login provider not implemented yet (DEC-0509)" in the compliance harness. It replaces the Google-mocked rules until items I-B…I-G land and the test authors tag tests. New local criteria get no rule: they are reported untested until their tests exist.
- **Other differences.** The sink retention is PAR-241, not PAR-240 (DEC-0517), and the domain is an account setting, not a per-stage `from` (DEC-0514).

## Login: admins by role, everyone who signs up is a user (2026-10-25)

The owner's two decisions of 2026-10-25, and the design the orchestrator proposed for them, which the owner agreed. They replace configuration-based admins (DEC-0015) and the optional users list (DEC-0080).

### DEC-0521 — Admins are a role stored with the account in the stage's database, not a list in configuration
Origin: owner · Status: accepted · Supersedes: DEC-0015 · Affects: SYS-REQ-018, AUTH-REQ-003, AUTH-REQ-005, PWD-REQ-008, CFG-REQ-005, SKILL-REQ-006, `docs/contracts/schemas/stage-config.schema.json`, `docs/contracts/ts/testing.d.ts`

The owner, 2026-10-25: "We can assign users to groups in better auth, correct? If so on cloudflare let's create an admin group and assign users there, not in a file." And, clarifying: "The user is not assigned any roles though. There is not a 'user' role."

- **Where the role lives.** In the column `role` of `__framework_auth_user`, shaped like Better Auth's admin-plugin field: text holding role names separated by commas. It is in the stage's own database: D1 on Cloudflare, the local D1 for `dev`, and PGlite or local D1 in `createTestApp`.
- **Only one role exists: `admin`.** The column can hold more roles in a later release, but no other role is defined now. Unknown names in the column are ignored.
- **There is no "user" role.** A new account has no roles: the column is NULL. Nothing ever writes `user` into it. The admin plugin's `defaultRole: "user"` is not copied, and the admin plugin itself is not installed.
- **"user" is an access level, not a role.** The levels are:
  - `anonymous`: no valid session;
  - `user`: a valid session for an existing, verified account;
  - `admin`: a user whose role list contains `admin`.
- **Revoking** removes `admin` from the list. When no role is left, the column is NULL again, never `user`.
- **No admins in configuration.** `framework.admins` leaves the stage-config schema. A values file that still holds it is rejected, like any unknown field (CFG-REQ-005 as amended).

### DEC-0522 — Anyone who signs up and verifies their address is a user; the users list is removed
Origin: owner · Status: accepted · Supersedes: DEC-0080 · Affects: SYS-REQ-018, AUTH-REQ-003, AUTH-REQ-005, CFG-REQ-005, DEMO-REQ-011, SKILL-REQ-006, `docs/contracts/schemas/stage-config.schema.json`, `docs/contracts/http/framework.openapi.yaml` (`unlistedId`)

The owner, 2026-10-25: "Anyone who signs up is a user."

- Any account with a verified email address is level `user`. Admins are users with the `admin` role (DEC-0521).
- `framework.users` leaves the stage-config schema, and with it the "unlisted" login: `/api/auth/me` no longer returns `unlistedId`.
- **An unverified account is never a user.** Sign-in already refuses it (PWD-REQ-001). The level check also reads the verification flag, so a session whose account is no longer verified, or no longer exists, is anonymous.
- DEMO-REQ-011 ("only listed people can post") and DEMO-AC-011 are retired. On the demo, every signed-up user can post, as DEMO-REQ-002's permissions table already says for level `user`.

### DEC-0523 — The first admin is granted with the operator command `admins`
Origin: ai-proposed · Status: accepted · Affects: CLI-REQ-001, CLI-REQ-005, CLI-AC-006, CLI-AC-007, SKILL-REQ-006

Better Auth's own `setRole` needs an existing admin's session, so nobody could ever become the first admin through it. The framework adds an operator command instead:

- **Forms.** `npm run admins -- grant <email> --target <t> --stage <s>`, `revoke <email> …` and `list …`. The owner's proposal wrote `--stage <stage>` only; `--target` is added because every stage command takes it (CLI-REQ-001). With `--target local`, `--stage` may be left out and can only be `local`.
- **Where it writes.** Directly in the stage's database:
  - on Cloudflare, through the D1 HTTP API, against the stage's current database (MIG §2), with the token that deploys already use;
  - locally, in the app's persisted local D1 (`.wrangler/state`), which `dev` also uses.
- **People are named by email.** It is an operator tool, not app code, so the email address is the natural handle for the owner. App code still never sees an address (SYS-REQ-017).
- **Stages.** It works on `test-*` stages and on production stages. On a production stage it requires `--confirm-production <s>` repeating the stage name, as `remove` does (CLI §2).
- **Refusals.** These are refused with exit 1, and nothing changes:
  - an unknown address;
  - an unverified account;
  - on Cloudflare, a stage with more than one database. That means a schema-changing deploy is in progress or was interrupted, and a grant could land in a database that is about to be deleted.
- **Output.**
  - `grant` and `revoke` print the account's user ID and its new role list.
  - `list` prints each admin's address, user ID and roles.
  - No form prints a password, a hash, a token, or an API credential (CLI-REQ-004).
- **Idempotent.** Granting a role already held, or revoking one not held, changes nothing and exits 0.

### DEC-0524 — The level is read from the account on every request that carries a valid session; one D1 read per authenticated request
Origin: ai-proposed · Status: accepted · Amends: DEC-0028 (sessions stay stateless and unrevocable; only the level is read per request) · Affects: AUTH-REQ-003, AUTH-REQ-006, AUTH §2 (session cookie), `docs/contracts/ts/internal/login-provider.d.ts` (`AccountStatus`)

- **When it reads.** AUTH reads the account's verification flag and role list from the stage's database once per request. It does so only when the request carries a valid framework session from a real provider: a session cookie with a good signature that has not expired. These requests make no database read:
  - a request without a session cookie;
  - a request with an invalid, tampered or expired cookie;
  - a request with a session created by the authentication mock. The mock's session carries its level, and only test stages and local builds have the mock (AUTH-REQ-009).
- **Grant and revoke take effect on the next request.** Nobody has to log in again, and no deploy is needed.
- **The session names the account.** The user ID cannot be reversed into the provider's subject (AUTH-REQ-002). So the session cookie gains the provider id and the provider's subject (session format version 2). The cookie is signed and HttpOnly, and app code never sees it. A version 1 cookie is treated as anonymous, which logs everyone out once.
- **Lookup.** The session's provider answers `accountStatus(subject)` with `{ verified, roles }`, or null for an unknown account. For the password provider this is one `SELECT email_verified, role FROM __framework_auth_user WHERE id = ?`.
- **A failed read means anonymous.** If the read fails, that request is anonymous, and one `warn` LOG entry, `role lookup failed (<code>)`, names the error code. A request is never admin on a guess.
- **The trade-off against DEC-0028.**
  - DEC-0028 made sessions stateless, so no request needed a database read for identity. This adds one primary-key D1 read to every authenticated request.
  - Apps are low-volume (DEC-0005), and the rate limiter already reads D1 on every credential request (DEC-0519), so the cost is accepted.
  - Sessions themselves stay stateless: logout, a password reset and a revoke do not end a copied session. A revoke does lower that session's level on the next request.

### DEC-0525 — Tests: the mock still chooses a level; a test helper grants roles to real-provider accounts
Origin: ai-proposed · Status: accepted · Affects: AUTH-REQ-009, `docs/contracts/ts/testing.d.ts` (`TestApp.grantRole`, `TestApp.revokeRole`, `TestAppOptions.config`)

- **The authentication mock is unchanged.** `mock-login`, `as()` and `createTestApp`'s `user` choose `anonymous`, `user` or `admin` directly, and no role is read for them.
- **The role helpers.** `TestApp.grantRole(userId, "admin")` and `revokeRole(userId, "admin")` change a real-provider account's roles. They work in a test app created with `passwordLoginProvider` or `stubLoginProvider`.
  - The account is named by the user ID that `/api/auth/me` shows.
  - They write what `admins` writes: the password provider's `role` column, or the stub's in-memory accounts. So the same level code runs.
  - They throw on a mock test app and on a connected stage. On a stage, use the `admins` command instead.
- **The stub provider** keeps one in-memory account per subject logged in with `loginWithStub`. Each is verified and starts with no roles.
- **Configuration.** `createTestApp`'s reserved `config.framework` key no longer takes `admins` or `users`. With either, it throws, as the build does.

### DEC-0526 — What changes because admins are a role
Origin: ai-proposed · Status: accepted · Amends: DEC-0520 (its first bullet) · Affects: E2E-007, AUTH-AC-003, AUTH-AC-005, AUTH-AC-012, AUTH-AC-013, AUTH-AC-015, PWD-AC-010, CFG-AC-005, CLI-AC-006, CLI-AC-007, SKILL-AC-006, DEMO-REQ-009, DEMO-REQ-011, DEMO-AC-011, COMPL-REQ-006, MIG §2, `tests/compliance/harness/expected.ts`

- **No more "copy your user ID into configuration".** The skill's and the template README's copy-ID steps go away. Becoming an admin is one `admins grant <address>` command, run by the owner or an agent. `/api/auth/me` and the demo's account page still show the ID, for support and for the test helpers.
- **Milestone parts become automated.**
  - DEC-0520 kept E2E-007's cloud part and AUTH-AC-005's admin-list part as milestone items, because they needed a committed configuration change and a redeploy. A grant needs neither.
  - So both now run on every cloud run. The test signs up on `prodcheck`, grants itself the role with `admins grant … --confirm-production prodcheck`, checks that the next request is admin, then revokes the role.
  - They leave the milestone list (COMPL-REQ-006).
  - SKILL-AC-006 stays a milestone item, because it follows the owner documentation from account setup onwards. It no longer edits a values file.
- **New criteria:**
  - AUTH-AC-015: no database read without a session;
  - PWD-AC-010: a new account has no role;
  - CLI-AC-006 and CLI-AC-007: the `admins` command, locally and on Cloudflare.
- **Rewritten criteria:** AUTH-AC-003, AUTH-AC-005, AUTH-AC-012, AUTH-AC-013, CFG-AC-005 and E2E-007.
- **Retired:** DEMO-REQ-011 and DEMO-AC-011 (DEC-0522).
- **Migration.** A new framework migration in both dialects adds the column (`framework/<nnnn>_auth_role`, the next free number). It is a nullable text column with no default, which is a supported change (MIG §2). Existing accounts get NULL, meaning no roles.
- **Not-run rules.** The new and rewritten cloud parts need the password provider on a cloud stage. Until the implementation items land and the tests are tagged, they get this phase's rule "password login provider not implemented yet (DEC-0509)".
- **Implementation follow-ups.** This item changes documents and contracts only, so these are not done here:
  - the stage-config Zod mirror (`src/config/schema.ts`), `ResolvedConfig` and `levels.ts` drop `admins` and `users`;
  - the committed values files drop them too (`apps/demo/config/cloudflare/prod.json`, and the template's and the reference app's files);
  - the session format version 2, `accountStatus`, the role column and its migration, the `admins` command, and the test helpers;
  - `skill/` and `apps/template/README.md` replace the copy-ID steps with `admins grant`, in item I-G's rewrite of the owner tasks.

### DEC-0527 — The mail sink is `sink@t.<domain>` with plus-addressing, not a catch-all; enabling `t.<domain>` turns on zone-wide routing
Origin: ai-proposed · Status: accepted · Amends: DEC-0518 (its catch-all sink rule) · Affects: MAIL-REQ-005, MAIL-AC-007, PWD §2 (the `check-login` sign-up address), AUTH-AC-005, SKILL-AC-006, E2E-007, cloudflare.md `setupAccount`, `ai/implementation/plan-auth.md` §3

From item I-F (`ai/implementation/decisions/i-f.md`) and its live run on 2026-10-25.
- **No catch-all on a subdomain.** Cloudflare's Email Routing docs say catch-all rules are only available for the apex domain, and a subdomain gets literal rules only. So `setup-account` creates one literal rule, `sink@t.<emailDomain>` → Worker `prototype-mailsink`, and turns on the zone's subaddressing (`support_subaddress`). Every `sink+<tag>@t.<emailDomain>` then reaches the sink. The sink stores each message under its envelope recipient, so tests use `sink+<run ID>@t.<emailDomain>` and runs stay apart. Other addresses under `t.<emailDomain>` are not delivered.
- **Known Cloudflare behaviour: a subdomain enables routing for the whole zone.** `POST /zones/<z>/email/routing/dns` with `{"name":"t.<emailDomain>"}` creates the subdomain's MX and SPF records. It also creates an apex SPF TXT and a DKIM TXT (`cf2024-1._domainkey.<emailDomain>`), and it turns Email Routing on for the zone. The apex gets no MX, so `GET /zones/<z>/email/routing` reads `enabled: true, status: "misconfigured"`, and the apex receives nothing. The framework accepts this and does not undo it. An owner who later wants mail on the apex sets that up in Cloudflare.
- **Readiness.** `GET …/email/routing/dns?subdomain=t.<emailDomain>` lists every record the subdomain needs, whether it exists or not. The records are ready when each one is among the zone's DNS records (`GET /zones/<z>/dns_records?name=t.<emailDomain>`) and Cloudflare reports no error. The POST is sent only when one is missing.
- **"Verified" sending.** The Email Sending entry (`GET /zones/<z>/email/sending/subdomains`) has no status or verified field; "verified" means the entry for the exact domain name has `enabled: true`, which `setup-account` polls for (MAIL-AC-007).

### DEC-0528 — `AUTH.NOT_VERIFIED`'s meaning names no email address
Origin: ai-proposed · Status: accepted (accepted under the owner's instruction of 2026-10-25) · Amends: DEC-0520 (the meaning text of `AUTH.NOT_VERIFIED`) · Affects: PWD §2, `docs/contracts/ts/errors.d.ts`, E2E-005

From the diagnosis of the Cloudflare pass-auth run `k9cc5zjcbm5mrkc` (2026-10-25). `errors.d.ts` is an app-facing type, and E2E-005 forbids login-provider details in it; DEC-0306's detector flags the word "email". The meaning "The account's email address has not been verified yet." was the only finding. It is now "The account has not been verified yet." (and the error message "the account has not been verified yet"). The code, status and retryability are unchanged. The sign-in and sign-up pages still say "email", because they are the password provider's own pages, not app-facing types.

### DEC-0529 — Build output keeps the stages' deploy records
Origin: ai-proposed · Status: accepted · Affects: cli.md §2 (`build`, `deploy`, `smoke`, `check-login`), `packages/framework/src/build/build.ts`

From the same diagnosis. `build` cleared `.framework/<target>/`, which also holds every stage's recorded deploy output `stages/<stage>.json`. Every `deploy` builds first, so deploying one stage of an app erased the records of its other stages, and `check-login` on `prodcheck` found none after the compliance run's tests had deployed further stages. `build` now clears its own output there and keeps `stages/`; `remove` still deletes a stage's record.

## Compliance harness: D1 budgets by plan, self-created test tokens, deferred second-account clauses (2026-10-25)

Three owner instructions of 2026-10-25 for the compliance harness, and how the harness applies them (item ba-harness-limits). No requirement or criterion text changes.

### DEC-0530 — D1 budgets for the Free and the Workers Paid plan; the harness reads the plan from Cloudflare
Origin: owner · Status: accepted · Amends: DEC-0419 (its caps become the Free budget) · Affects: plan §1 "Cloud usage limits", PAR-219, PAR-284, PAR-285, `tests/compliance/harness/d1-budget.ts`, `tests/compliance/criteria/_cloud/d1.ts`, the compliance driver

The owner, 2026-10-25: "you need to use different D1 limits for free and paid accounts. Still no limit testing though."

Cloudflare's D1 limits and pricing (developers.cloudflare.com/d1/platform/pricing/ and developers.cloudflare.com/d1/platform/limits/, read 2026-10-25):
- **Workers Free:** 5,000,000 rows read and 100,000 rows written per day, reset at 00:00 UTC; 5 GB storage; 10 databases per account; 500 MB per database.
- **Workers Paid:** 25 billion rows read and 50 million rows written included per month (then $0.001 per million read and $1.00 per million written), reset on the subscription's renewal date; 5 GB storage included; 50,000 databases per account; 10 GB per database.

Budgets, in DEC-0419's spirit (well inside the included usage, not crippling):
- **Free (PAR-284), DEC-0419 unchanged:** per pass ≤ 10,000 rows written and ≤ 500,000 read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read (half the daily limits); ≤ 8 D1 databases at once (of 10).
- **Workers Paid (PAR-285):** per pass ≤ 100,000 rows written and ≤ 5,000,000 read; per UTC day ≤ 500,000 written and ≤ 25,000,000 read; ≤ 20 D1 databases at once. Even 31 days at the daily cap use 31 % of the written and 3.1 % of the read rows included per month, so tests never cause a charge and the owner keeps most of the allowance. Per pass is a fifth of a day, as on Free. The database cap bounds what an interrupted run leaves behind; the account limit is far above it.
- **Unchanged on both plans:** no stress tests, load tests, platform-limit probing or row loops; tens of rows per test; D1 usage measured before and after every pass. No test checks a budget by running into it.

**Plan detection.** At the start of a cloud run the driver calls the documented Account Subscriptions list, `GET /accounts/<account>/subscriptions` (developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/, needs "Billing Read"). An account-scoped subscription with rate plan `workers_paid` whose state is not `Cancelled`, `Failed` or `Expired` means Workers Paid; a successful listing without one means Free. Read live on 2026-10-25: this account lists `workers_paid` (state `Paid`) besides `r2_paid`, `images_v2_stream_basic` and zone-scoped `free` plans. When Cloudflare does not answer (the token lacks Billing Read, an error), the explicit setting `COMPLIANCE_CLOUDFLARE_PLAN=free|paid` decides, and without it the Free budget applies; Cloudflare's answer wins over the setting. The driver logs the budget, writes the reading to the record's `raw/d1-budget.json`, and passes the plan to the test processes in `COMPLIANCE_D1_PLAN`, so the database guard (`requireDatabaseRoom`) applies the plan's cap without another request. A test process started outside the driver applies the setting, else Free.

### DEC-0531 — The compliance driver creates and deletes the restricted test tokens itself
Origin: owner · Status: accepted · Amends: DEC-0335, DEC-0363, DEC-0428 (the operator no longer has to supply PROV-AC-002's token) · Affects: PROV-AC-002, PROV-AC-004, COMPL-REQ-004, plan §11 Q13, PAR-286, `tests/compliance/harness/test-tokens.ts`, the compliance driver

The owner, 2026-10-25: "Create your own test token."

- **Which.** PROV-AC-002's clause needs a credential without the permission to create R2 API tokens (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`); PROV-AC-004's needs a token lacking exactly one email permission of DEC-0515 (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION`).
- **When.** At the start of a cloud run that selects the criterion, unless the operator set the variable: the driver creates the token through `POST /accounts/<account>/tokens` (an account-owned token) with the main token, which has "Account API Tokens Write". The permission group IDs come from `GET /accounts/<account>/tokens/permission_groups`.
- **Minimal permissions.**
  - `prototype-compliance-<run ID>-no-r2-token`: Workers Scripts Write, Workers R2 Storage Write and D1 Write on the account; no "Account API Tokens" at all.
  - `prototype-compliance-<run ID>-no-email`: the same, plus Account API Tokens Read (the DEC-0515 check reads the token's own policies; the deploy preflight reads the token lists) and Email Sending Write on the account, and Email Routing Rules Write, DNS Write, Zone Settings Write and Zone Read on the account's zones. It lacks "Email Routing Addresses Write".
- **Expiry.** PAR-286, 6 hours, as a backstop.
- **Secrecy.** The value is held in the driver's memory. It is passed only to the test processes in the variable, never to the build or other commands. It is redacted as `<test-token>` from the live echo, the driver's output, the raw output and the record. It is never written to disk or logged; the log names only the token.
- **Removal.** The driver deletes its tokens at the end of the run, also when setting up the target or the tests failed. At the start it deletes `prototype-compliance-*` tokens an interrupted earlier run left. The leftover check (COMPL-REQ-004) then lists the account's tokens, and every `prototype-compliance-*` token still listed is a leftover (`API token <name>`), as is a token listing that fails.
- **Live proof, 2026-10-25.** With the harness code, one `no-r2-token` token was created, read back (status `active`, `expires_on` 6 hours ahead, one policy on the account with exactly D1 Write, Workers R2 Storage Write and Workers Scripts Write), listed, and deleted. Afterwards reading it answered HTTP 404 and no `prototype-compliance-*` token was listed. The value was never printed.

### DEC-0532 — Clauses that need a second Cloudflare account are deferred
Origin: owner · Status: accepted · Affects: PROV-AC-004, `tests/compliance/harness/expected.ts` (not-run rules), `tests/compliance/criteria/prov/setup-account.test.ts`, plan §5 D-RUN "Not runnable here"

The owner, 2026-10-25: "Defer the tests that require another account".

- **PROV-AC-004, "Deploying without it fails with a clear message".** It needs an account on which `setup-account` never ran, and the test never deletes this account's shared resources. A not-run rule in `PHASE_RULES` (Cloudflare, milestone) records the part "fresh-account clause: deploying without setup-account fails with a clear message" as `not-run` with the detail "deferred: needs a second Cloudflare account (owner, 2026-10-25)". The rest of PROV-AC-004 runs. The test is defined only when the operator sets `COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1`, so a run no longer records the criterion `blocked` for it. Whoever lifts the deferral removes the rule.
- **Other clauses checked.** No other criterion clause needs a second account. PROV-AC-007's foreign bucket is a stubbed cloud response in a local unit test. DEC-0270's 403 "foreign" reading needs one too (DEC-0334), but it is a reading, not a criterion clause, and stays an unverified assumption. SKILL-AC-006's "set up an account" runs `setup-account` on this account, which is idempotent; it is not-run for its own reason (DEC-0509).

## Owner decisions, batch A: file names, transfers, test outages, template uploads, inline images (2026-10-25)

Owner decisions of 2026-10-25 on open items of FILES, KV, the testing contract and the template (item batch-a). DEC-0430's owner question is closed in its own entry (status accepted).

### DEC-0533 — No `/`-separated segment of a file name may be `..`
Origin: owner · Status: accepted · Amends: DEC-0505 (adds `..` segments to the names `.` and `..`) · Affects: FILES-REQ-002, FILES-AC-002, DEC-0328, files.md §2 (Cloudflare, AWS "Names"), `packages/framework/src/files/names.ts` (`checkName`), `src/files/s3/path.ts` (comment), `packages/framework/test/integration/files/server-operations.cases.ts`, `skill/reference/files.md`

The owner, 2026-10-25: "Ban .. between slashes, anything that ends with /.. and files named .. the issue is the things that look like the parent directory shortcut."
- **Rule.** A name is invalid when any of its `/`-separated segments is exactly `..`: `..`, `../x`, `a/../b`, `a/..`, `a//../b`, `../`. `checkName`, which every FILES operation that takes a name calls before any storage call, rejects these with `FILES.INVALID_NAME` ("has a ".." segment") on every target. The name `.` stays invalid (DEC-0505).
- **Still valid.** Names that merely contain dots (`notes..txt`, `..x`, `x..`, `...`, `.hidden`, `a/.b`, `a/..b/c`) and names with `.` segments (`./x`, `a/./b`, `a/.`). They are not resolved as paths.
- **List prefixes are unchanged.** `checkPrefix` does not apply the rule: a prefix is not a name, and a prefix such as `..` still lists `...` and `..x`.
- **DEC-0328 is not moot.** URL parsers also resolve `.` segments, so the `%2F` form stays for names with a `.` segment. For `..` segments it, and the issuer's refusal of `.` and `..`, are now only a second guard behind `checkName`.
- **Existing data.** No FILES object with a `..` segment is known outside test stages. Such an object, if one exists, can no longer be read, deleted or listed back by name through FILES, because every operation that takes a name rejects it; `list` still returns it by prefix.

### DEC-0534 — The browser helper refuses an expired upload ticket before sending
Origin: owner · Status: accepted · Resolves: DEC-0101 (owner chose its option (b)) · Affects: FILES-REQ-006, FILES-AC-003, client.d.ts `uploadFile`, files.md §2, `packages/framework/src/files/client.ts`, `skill/reference/files.md`

The owner chose option (b) of DEC-0101: the browser helper checks the ticket's expiry before sending.
- `uploadFile` compares the ticket's `expiresAt` with the browser's clock (`Date.now()`) after checking that the value is an upload ticket. When `Date.now() >= expiresAt`, it throws `ApiError` with `FILES.TRANSFER_FAILED`, status null, `requestId` null and the message `rejected before sending: ticket expired` (the class of DEC-0536). Storage is not contacted, so there is no storage status and no storage body, and the stored file is unchanged.
- The check is the same on every target, so FILES-AC-003's expired-ticket clause no longer depends on R2's missing CORS headers on its 403s. A content-type-mismatched upload still reaches storage, and on Cloudflare it still fails with status null and the `no response` class (DEC-0101, unchanged).
- **Clock skew.** The browser's clock decides. A browser clock that is ahead refuses a ticket slightly early; one that is behind sends it, and storage refuses it as before (the `rejected by storage` or `no response` class). Tickets last PAR-233 (15 minutes), so ordinary skew only shortens or lengthens the window a little.
- `downloadUrl` is unchanged: it sends nothing, and the URL it returns may be used later by `<img>` or a link, where storage refuses an expired ticket.

### DEC-0535 — Downloads of PNG, JPEG, GIF and WebP are `inline`; every other type stays `attachment`
Origin: owner · Status: accepted · Supersedes: DEC-0414 for the four types · Affects: FILES-REQ-003, FILES-AC-003, DEC-0313, DEC-0329, files.md §2 ("Download names and inline images", Local, Cloudflare), `packages/framework/src/files/{disposition.ts, service.ts, cloudflare/tickets.ts, local/route.ts}`, `src/targets/cloudflare/tickets.ts`, `skill/reference/files.md`

The owner, 2026-10-25, replacing the high-risk part of DEC-0414: downloads of common raster image types are served `inline` so they display in the browser, from storage's own origin, with `X-Content-Type-Options: nosniff`, using the response parameters the presigned URL supports. SVG, HTML and every other type stay `attachment`, and the real filename is kept.
- **Which types.** `image/png`, `image/jpeg`, `image/gif` and `image/webp` (`INLINE_IMAGE_TYPES` in `src/files/disposition.ts`). The test is on the stored content type's essence: the part before any `;`, trimmed and lowercased. Everything else, including `image/svg+xml`, `text/html`, `application/xhtml+xml`, `image/bmp`, `image/avif` and a missing type, is an `attachment`.
- **How.** `createDownloadTicket` passes the stored content type to the issuer (`TicketIssuer.download(name, contentType?)`; without one a download is an `attachment`). `downloadDisposition(name, contentType)` gives `inline; filename*=UTF-8''<name>` or `attachment; filename*=UTF-8''<name>` (the RFC 8187 encoding of DEC-0329, the whole name, so the file keeps its real name, DEC-0313).
- **Cloudflare.** The download ticket signs `response-content-disposition` as before and, for an inline image, `response-content-type` set to the essence (for example `image/png`), the S3 GetObject response overrides. The image is then served with exactly the checked type, whatever parameters or case the stored type had. The URL is R2's presigned URL on `https://<account>.r2.cloudflarestorage.com`, a different origin from the app.
- **Local.** The transfer route serves an inline image with `Content-Type` set to the essence, `Content-Disposition: inline; …`, and, as for every response, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. Both targets therefore give the same disposition for the same type, so COMPL-REQ-001 needs no per-target expectation.

**Security reasoning.**
1. *Only types that cannot run script.* PNG, JPEG, GIF and WebP are decoded as images and nothing else. A browser that gets a response with one of these as its `Content-Type` renders it as an image or fails. The MIME Sniffing standard sniffs a declared image type only among image types, never into HTML or script. A polyglot file (bytes that are both a valid image and HTML) is shown as an image. SVG (which can carry script), HTML, XHTML, XML, PDF and unknown types stay `attachment`.
2. *The served type is the checked type.* The ticket overrides the response's type with the essence that passed the check (`response-content-type` on Cloudflare, `Content-Type` locally), so a stored type such as `image/png; x=…` or `IMAGE/PNG` is never served as anything but `image/png`. The stored type itself is the one the app's server put on the upload ticket, which signs `Content-Type`, so the browser cannot choose another type (FILES-REQ-003).
3. *Storage's origin, not the app's.* On Cloudflare the content comes from R2's endpoint, so even content a browser mis-handled could not read the app's cookies, storage or DOM. Locally the route is on the app's origin (development and tests only); there `nosniff` and `Content-Security-Policy: sandbox` (an opaque origin with no script) stop it from running as the app.
4. *`nosniff` on Cloudflare: not settable by the framework (open for the owner).* A presigned GET can carry only S3's GetObject response overrides (`response-content-type`, `response-content-disposition`, `response-cache-control`, `response-content-encoding`, `response-content-language`, `response-expires`), none of which sets `X-Content-Type-Options`, and R2's object metadata (`httpMetadata`) has no field for it either. So the framework cannot add `X-Content-Type-Options: nosniff` to R2's response, and whether R2 sends it is not verified (no Cloudflare call in this item; Cloudflare's R2 S3 API page and presigned-URL page, read 2026-10-25, do not mention it). The protection on Cloudflare rests on points 1–3: `nosniff` only stops a browser from upgrading an unknown or text type, and an inline download is never served with such a type. The owner may accept this, or ask for a design that can set headers (for example serving inline images through a framework route, DEC-0101 option (c)).
5. *What the owner gives up from DEC-0414.* Across origins Chromium ignores `<a download>` (DEC-0414's experiment E9), so on Cloudflare a link to an inline image opens it instead of saving it, and an app cannot force a PNG to download. E2E-009's photos are BMP, which stays `attachment`, so its download check is unaffected.
- **Unverified live, for the next Cloudflare pass.** R2 honoured the signed `response-content-disposition` in pass 0 (`validation/cloudflare/pass-0/SUMMARY.md`, DEC-0329). That it also honours `response-content-type` on a presigned GET is the S3 behaviour, assumed and not yet observed. FILES-AC-003's new disposition clause checks both on Cloudflare.

### DEC-0536 — "rejected before sending" is an official failure class of FILES-REQ-006
Origin: owner · Status: accepted · Resolves: DEC-0165's open item (plan §11 Q7) · Affects: FILES-REQ-006, client.d.ts, files.md §1, `skill/reference/files.md`

The owner added the class "rejected before sending" (for example "rejected before sending: not an upload ticket") to FILES-REQ-006's list. Its form is `rejected before sending: <reason>`, with status null. The reasons are `not an upload ticket` and `not a download ticket` (DEC-0165) and `ticket expired` (DEC-0534). `content type does not match ticket` stays a class of its own, as FILES-AC-003 states it. The helper's code for the existing reasons is unchanged.

### DEC-0537 — `TestApp.setUnavailable` makes capabilities fail mid-test
Origin: owner · Status: accepted · Resolves: plan §11 Q10 (DEMO-AC-003's failure clause), option (a) · Affects: `docs/contracts/ts/testing.d.ts` (`TestCapability`, `TestApp.setUnavailable`), core.md §2 "Testing", DEMO-AC-003 (its local failure clause), demo-spec.md, `packages/framework/src/testing/{test-app.ts, connect.ts, public.ts}`, `apps/demo/tests/app.test.ts`, `skill/reference/testing.md`, `skill/reference/files.md`

The `unavailable` option held for the whole test app from creation, so a test could not store a file and then make a later files operation fail. The owner chose option (a): a switch the test flips mid-test.
- **API.** `t.setUnavailable(capabilities: readonly TestCapability[]): void`, with `TestCapability = "sql" | "kv" | "files" | "secrets"` (the option's type, now named). It replaces the set of unavailable capabilities, starting with the `unavailable` option's, from the next operation on. `[]` makes every capability available again. As with the option, `sql` also makes `kv` unavailable. Stored data is kept. The set is shared by the test app and every one made from it with `as`, because they are one app (like `dispose`). A replacing setter fits `testing.d.ts`'s style of one option per behaviour and needs no second method to restore.
- **Errors.** It throws for an unknown capability and after `dispose`. On a connected stage (`connectTestStage`) it throws: a deployed stage's storage cannot be made to fail from a test.
- **Implementation.** `createTestApp` reads the set on every request: the store, the SQL and KV handles' forced-outage flag and the secret reader are chosen per request, as the stage runtime already builds them per request.
- **Use.** The demo's test of DEMO-AC-003's failure clause now stores a photo, calls `t.setUnavailable(["files"])` and deletes the post: the post is deleted and one `warn` entry is logged.

### DEC-0538 — Empty KV values are allowed; KV-AC-002 drops "and values" from its "Empty" clause
Origin: owner · Status: accepted · Resolves: DEC-0146 (plan §11 Q6) · Affects: KV-AC-002, kv.md §4

The owner, 2026-10-25: "empty is ok". KV-REQ-002 is unchanged: only empty keys are rejected. KV-AC-002 now says that empty keys, oversized keys and values, and malformed keys and values are rejected with the specified codes, and that an empty value is accepted and read back as `""`. This is what the code already does (DEC-0146, DEC-0225), so no code changes.

### DEC-0539 — The template sets no upload size cap
Origin: owner · Status: accepted · Supersedes: DEC-0380's 10 MiB cap · Affects: SKILL-REQ-004 (the template's example), skill.md §2 "Files", PAR-234, `apps/template/src/server/routes/files.ts`, `apps/template/tests/app.test.ts`, `skill/examples/files-tickets.md`, `skill/examples/tests.md`, `skill/reference/files.md`

The owner, 2026-10-25: "Why limit files to 10mb? That is stupid."
- The template's finalize route no longer checks the size. Uploads are limited only by what the framework and R2 support: one `PUT` per upload (DEC-0062), so the platform's single-upload maximum, PAR-234. On Cloudflare that is R2's maximum upload size for one request, 4.995 GiB (5 GiB less 5 MiB; developers.cloudflare.com/r2/platform/limits/, read 2026-10-25, which also gives 5 TiB less 5 GiB per object, reachable only by multipart upload, which the framework does not use). Locally the test app and `dev` buffer an upload in memory (DEC-0163), so the machine's memory is the practical limit there.
- The finalize pattern is kept: `head`, a missing upload is `HTTP.NOT_FOUND`, a type outside the accepted list is deleted and answered `HTTP.CONFLICT`, and only then is the row inserted. The template's test now checks that a file of 10 MiB + 1 byte is accepted, and that a wrong-type upload is deleted.
- The skill still teaches that an app may check size in its finalize route when it needs a limit (FILES "Safe upload pattern" step 3 is unchanged).

## Owner decisions, batch B: bounded secret rollout, LOG-AC-004, and the high-risk designs removed (2026-10-25)

Owner decisions of 2026-10-25 (batch B). The owner, on the high-risk items: "come up with a solution that is not high risk". No live Cloudflare call was made for these entries; the code is unit-tested against the fake Cloudflare and D1 APIs. Criteria whose tests must change are listed in each entry; the criteria tests themselves are changed by the test authors.

### DEC-0540 — SEC-AC-005: a bounded delay on Cloudflare, then 5 consecutive requests
Origin: owner · Status: accepted; its counting rule ("5 consecutive requests after the first that …") superseded by DEC-0562 · Supersedes: DEC-0280's SEC-AC-005 bullet · Affects: SEC-AC-005, secrets.md §2 "Propagation on Cloudflare", PAR-310, plan §11 Q12, `tests/compliance/criteria/secrets/further-stage.test.ts` (test authors)

The owner chose plan §11 Q12 option A. On Cloudflare a secret change reaches requests through a Worker version rollout of a few seconds (DEC-0092), so "the next request" cannot hold for a deletion and only by chance for `secrets set`. The framework still reads the binding on every request and caches nothing across requests (SEC-REQ-005 unchanged).
- **New text of SEC-AC-005.** After `secrets set`, requests see the new value within PAR-310, and 5 consecutive requests after the first that sees it all see it. After a direct store deletion (the test hook), requests fail with `SEC.MISSING` within PAR-310, and 5 consecutive requests after the first that fails all fail with it.
- **PAR-310**, 60 seconds (owner), the value of `CLOUD_WAITS.secretRolloutMs` (DEC-0431). "Never the old value again" can only be sampled; 5 requests is the sample.
- **Test change** (test authors): the SEC-AC-005 test waits for the change with `waitFor` bounded by PAR-310, then reads 5 more times and requires every read to show it, for both clauses.

### DEC-0541 — LOG-AC-004 loses its outside-request clause; LOG-REQ-004's rule stays
Origin: owner · Status: accepted · Supersedes: DEC-0314, DEC-0280's LOG-AC-004 bullet · Affects: LOG-AC-004, plan §11 Q8, `tests/compliance/criteria/log/keys.test.ts` (test authors)

The owner chose to drop "and one written outside a request has a random final part" from LOG-AC-004 (plan §11 Q8). No framework or app path writes an entry outside a request (DEC-0314). LOG-REQ-004's "or a random value when it has none" stays, and its evidence stays the R2 key builder's unit test (`src/log/cloudflare/`, D-01). The criterion's test drops the clause that reported `blocked` (test authors).

### DEC-0542 — The result-size check never fails a committed write
Origin: owner · Status: accepted · Supersedes: DEC-0137's write clause · Affects: SQL-REQ-006, SQL-AC-006, sql.md §2.2 "Handles" and "Result size", §2.3 "Result size", PAR-215, `packages/framework/src/sql/handle.ts`, `atomic.ts`, skill `sql-and-migrations.md`, the SQL-AC-006 test (test authors)

DEC-0137 checked PAR-215 on every result after the driver returned, so an `insert`, `update` or `delete` whose RETURNING rows were too large had committed and was then reported as `SQL.RESULT_TOO_LARGE`. A caller that retries a failed write then saves it twice. Options: refuse before executing (the RETURNING size of an `update` or `delete` is not known in advance), truncate (a returned list that silently misses rows is a worse trap), or return the rows. The SQL spec can state the last one cleanly, so:
- **Rule.** PAR-215 applies to reads: the rows of a `select` or `selectDistinct` (also behind `$with`/`with`). A write's RETURNING rows, and every `atomic` step's, are returned in full, whatever their size. A builder's kind is fixed by the first of `select`, `selectDistinct`, `insert`, `update`, `delete` in its chain.
- **SQL-REQ-006** now says so (owner amendment), and SQL-AC-006 gains the clause "a committed `insert` whose RETURNING rows exceed PAR-215 resolves with all of them and its rows are stored once".
- **Code.** `handle.ts` tracks each builder's kind and size-checks reads only; `atomic` no longer size-checks. Unit tests on local D1 and PGlite: a committed `insert`, `update` and `delete` with RETURNING over PAR-215 succeed and return every row, a `select` of the same rows is still `SQL.RESULT_TOO_LARGE`, and `atomic` returns its steps' large RETURNING rows.
- **AWS** (deferred): the Data API refuses a response over PAR-214 before returning it, so the AWS adapter must keep the same promise, for example by checking the rows to be written against PAR-214 before sending; that is decided in the AWS release.
- **Test change** (test authors): SQL-AC-006's test adds the committed-write clause through the reference app's new SQL case `writeResultSize` (`apps/reference/src/server/cases/sql.ts`; input `{ ns, chars }` as for `resultSize`; answer `{ returned, length, stored }`, expected `{ 1, chars, 1 }` for `chars` = `SQL_SIZES.oversized`).

### DEC-0543 — A production `remove` backs the stage up to `prototype-backups` before deleting anything
Origin: owner · Status: accepted · Amends: DEC-0350 · Affects: PROV-REQ-003, PROV-REQ-004, PROV §2 "Removal", "Restoring a removed production stage", "Per-target operations" (`backupStage`), CF §2 `setupAccount`, `remove`, PAR-311, CLI §2 `remove`, skill `deploying.md` §5 and §6, `packages/framework/src/provision/{core/remove.ts,cloudflare/backup.ts,cloudflare/account.ts,cloudflare/api.ts}`, PROV-AC-003 and PROV-AC-004 tests (test authors)

DEC-0350 kept a production removal behind `--confirm-production`, but the removal still deleted the owner's data with no recovery. Now:
- **Account resource.** `setup-account --target cloudflare` also creates the R2 bucket `prototype-backups` with one lifecycle rule, `framework-backups-retention`, that deletes every object PAR-311 (30 days, owner) after it was written; another rule on the bucket is kept. Both count as shared resources (`R2 bucket prototype-backups`, `lifecycle rule of R2 bucket prototype-backups (PAR-311)`), so `deploy` on an account set up before this change stops with "run setup-account … first" until the owner runs `setup-account` once more, which creates only these two (with batch C merged, also the replaced signing credential, which is denied on this bucket: DEC-0550). Stage removal never touches the bucket; a stage whose fixed names would be it is refused (`names.ts`).
- **Order.** `remove` of a stage not named `test-…` (still only with `--confirm-production <stage>`) first writes the backup under `prototype-backups/<app>/<stage>/<yyyymmddThhmmssZ>/`: `database/<name>.sql`, D1's own export of each stage database; `files/<key>`, every object of the stage bucket with its bytes and content type unchanged (keys keep DEC-0430's U+0001 ending); and `manifest.json` last. It then lists the prefix and requires every object written. Only after both the export and the copy succeeded does it delete anything. If any backup step fails, nothing is deleted and `remove` exits 1, naming the failure and saying the stage is unchanged. Secrets are not backed up (they are values the owner sets again). A `test-` stage is removed as before, without a backup.
- **Transfers.** The database export is D1's export API (DEC-0545's `exportDump`; its download is a signed URL in a Cloudflare-owned bucket, A-06). Objects are read and written as bytes through the R2 object endpoints of `api.cloudflare.com` with the deploy token (a new `CloudflareBytesApi` seam beside `CloudflareApi`). Neither the bytes `GET`/`PUT` of those endpoints nor `…/lifecycle` on this bucket has been called live yet (like DEC-0334's reads); the first live production removal confirms them.
- **Restore** (provisioning.md §2 "Restoring a removed production stage", skill `deploying.md` §5): deploy the stage again and set its secrets; `stop` it; delete its new, empty `<app>-<stage>-db-1` and create it again under the same name, so it stays the lowest-numbered (current) one; load the export into it with `wrangler d1 execute <app>-<stage>-db-1 --remote --file database/<name>.sql`; copy the files back into `<app>-<stage>-files` with S3 tooling that keeps keys byte for byte; then `deploy --start`, which binds the Worker to the restored database and applies any newer migrations. The export is D1's own, so a row over PAR-217 (which DEC-0096 found the import refuses) must be loaded by hand.
- **Tests.** Unit tests on the fake Cloudflare account: the backup's objects, bytes and content types, the export before the first deletion, and for each failing step (export, file read, backup write, missing bucket) that nothing is deleted; a test stage writes no backup. PROV-AC-003's and PROV-AC-004's tests list the account's shared resources and must include the backup bucket and its rule (test authors).

### DEC-0544 — `stop` and `start` commands; a deploy leaves a stopped stage stopped unless `--start`
Origin: owner · Status: accepted · Supersedes: DEC-0376; the stop part of DEC-0091 · Affects: CLI-REQ-001, PROV-REQ-002 step 6 and step 7, PROV §2 "Stage record", "Per-target operations" (`readStageRecord`, `writeStageRecord`), MIG §2 "Failure", CF §2 `stopApp`/`startApp`, CLI §2, skill `deploying.md` §4, the apps' npm scripts, CLI-AC-001's test (test authors)

- **Commands.** `stop --target <t> --stage <s>` and `start --target <t> --stage <s>`, on test and production stages alike, with no confirmation (neither deletes anything). `stop` turns the stage's `workers.dev` route off (`stopApp`, DEC-0090) and then records the stop; `start` deletes the record and then turns the route on. The orders keep the record on the safe side: a failed record write after a stop says "a deploy would start it again; run stop again", and a failed start after the record is gone leaves the next deploy to start it.
- **Stage record.** Where the framework's state lives: the JSON object `framework/<app>/<stage>/stage.json` in the state home `sst-state`, `{ "stopped": true }`; no object means "not stopped". Its key has the `<kind>/<app>/<stage>` shape of the stage's state objects, so `remove` deletes it with them and the leftover listing reports it as `stage record`. Every machine sees it (PROV-AC-006).
- **Deploy.** Step 1 reads the record. A stopped stage without `--start` stays stopped: step 6 turns the route off again (the code deploy may itself turn it on, DEC-0091, so the route can answer for the seconds between steps 5 and 6) and step 7, the health check, is skipped; the output says the stage is stopped and how to start it. A failed migration of a stopped stage deletes the new database and leaves the previous version stopped. `deploy --start` deletes the record and runs steps 6 and 7 as usual. A schema-changing deploy of a stopped stage still stops and copies as before.
- **CLI-REQ-001** lists `stop`, `start` and `deploy … [--start]`; the template, reference and demo apps expose `stop` and `start` as npm scripts.
- **Test change** (test authors): CLI-AC-001's test runs every command of the table, so it gains `stop` and `start` (dispatched with `--target local`, which they refuse with a usage error, as for the other cloud commands).

### DEC-0545 — Cloudflare `copyDatabase` uses D1's native export/import when a pre-check shows it is safe
Origin: owner · Status: accepted · Supersedes: DEC-0096 (its copy stays as the fallback) · Affects: MIG-REQ-006 step 2, migrations.md §2 "Fallback copy" and "Cloudflare" *Copy*, PROV §2 `copyDatabase`, PROV-REQ-002 (deploy output), PAR-312, PAR-313, PAR-314, `packages/framework/src/provision/cloudflare/d1/{native-copy.ts,operations.ts,client.ts}`

The row-by-row copy took 48.6 s for A-06's 5 MB fixture against about 3 s for the native path, and the app is stopped meanwhile. DEC-0096's evidence names exactly when the native path breaks, so a quick pre-check of the source rules those cases out:
- **Pre-check** (reads only, two requests): every reference points to a table created earlier (no self-reference, no reference to a later table, so no cycle; the dump writes tables in creation order and the import's deferral spans about 4 KB); no row's values exceed PAR-312 (40,000 bytes, so a quoted INSERT stays under PAR-217's 100,000 bytes); no text holds a NUL (the import stops there silently) and no integer is beyond ±2^53 (the dump rounds it); all values together at most PAR-313 (5,000,000 bytes, within what A-06 exercised); no virtual or WITHOUT ROWID table.
- **Native path**: export with `output_format: "polling"`, download from the signed URL, import (`init` with the dump's MD5, upload to the signed URL, `ingest`, `poll`), each wait bounded by PAR-314 (120 s, polled each second). Then every table's row count is compared with the source's. Any failure there is not trusted: the new database is deleted and created again and the row-by-row copy runs.
- **Fallback**: otherwise the row-by-row copy of DEC-0096 runs unchanged.
- **Deploy output**: the deploy prints `copied database <old> into <new>: D1 native export/import` or `…: row-by-row copy (<reason>)`, and `DeployResult.copyMethod` carries it.
- **Live calls**: the native path adds `POST /accounts/<a>/d1/database/<uuid>/export` and `…/import` and the two signed-URL transfers; A-06 used them live on 2026-10-19, the framework's code has not yet.
- **Tests**: against the fake D1 API, which now answers export and import in A-06's shapes: a safe database is copied exactly by the native path; each failure shape (self-reference, reference to a later table, a row over PAR-312, a NUL, an integer beyond 2^53, a database over PAR-313) takes the row-by-row path, named with its reason, and is still exact; a failed import is recreated and copied row by row; an export that never completes stops at PAR-314.

### DEC-0546 — The framework's D1 database limit depends on the account's plan
Origin: owner · Status: accepted · Extends: DEC-0530 to the framework · Affects: PAR-219, migrations.md §2 "Cloudflare" *Copy* step 1, `packages/framework/src/provision/cloudflare/{plan.ts,d1/operations.ts}`, `src/cli/commands/operations.ts`

The framework's message for Cloudflare code 7406 still said "PAR-219: 10". It now reads the plan as the harness does (DEC-0530): `GET /accounts/<a>/subscriptions`, an account-scoped `workers_paid` subscription that is not `Cancelled`, `Failed` or `Expired` means Workers Paid (50,000 databases), a successful listing without one means Free (10). When Cloudflare does not answer with a listing (the token lacks "Billing Read", an error), the setting `PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN=free|paid` decides, and without it the message names both limits and says the plan could not be read. The plan is read only when a database creation is refused with 7406, so an ordinary deploy makes no new request. The framework has no cap of its own below Cloudflare's: Cloudflare enforces the plan's limit and the message names it.

## Batch C: account signing credential, two tokens, production email reads, portability, digest (2026-10-25)

### DEC-0550 — The stages' R2 signing credential is one account credential that `setup-account` creates; `deploy` creates no API token
Origin: ai-proposed · Status: accepted · Supersedes: DEC-0100 (per-stage token; its S3 derivation stays) · Amends: CF-REQ-002 (the R2 signing credential), DEC-0331 (the token name), DEC-0335 (the preflight's token check is gone), DEC-0374 · Affects: PROV-REQ-002 step 1, PROV-REQ-004, PROV §2 "Stage resources", "Removal", "Signing record", "Restoring a removed production stage", cloudflare.md §2 "Deploy mechanics", files.md §2 "Cloudflare", COMPL-REQ-004, PROV-AC-002, PROV-AC-004, CF-AC-002, COMPL-AC-004, `provision/cloudflare/{r2-token,account,target,names}.ts`, `files/cloudflare/{tickets,credentials}.ts`

The owner, 2026-10-25, batch C: reduce the risk of DEC-0374, whose one token held "Account API Tokens: Edit" for every deploy; move the creation of R2 credentials out of everyday deploys into `setup-account`.

- **Where the credential was.** `deploy` step 5 created one account API token per stage, `<app>-<stage>-files-signing`, with "Workers R2 Storage Bucket Item Write" on the stage bucket (DEC-0100), and stored its S3 credentials as the stage's framework-internal Worker secrets `frameworkR2AccessKeyId` / `frameworkR2SecretAccessKey`. That is why every deploy token needed "Account API Tokens: Edit", which can mint a token with any permission of the account.
- **Now.** `setup-account` creates one account token, `prototype-r2-signing`, when the account has none. Its policies:
  - `allow` "Workers R2 Storage Bucket Item Write" on `com.cloudflare.api.account.<account>: "*"` (every bucket of the account, so it covers stage buckets created later);
  - `deny` the same group on `com.cloudflare.edge.r2.bucket.<account>_default_<bucket>` for `prototype-logs`, `sst-state`, `prototype-mailsink` and `prototype-backups` (`ACCOUNT_BUCKETS`), nested under the account key.
  Its S3 credentials (access key ID = token id, secret access key = hex SHA-256 of the value, DEC-0100) and the list of buckets the token denies (`deniedBuckets`) go into the stage-independent **signing record** `framework/r2-signing.json` in `sst-state`, beside the account settings record (DEC-0514). The record is a shared resource (`R2 signing credential prototype-r2-signing`) that `inspectAccount` reads: when it is absent, `deploy` stops in step 1 telling the owner to run `setup-account`. `deploy` step 5 copies the two values from the record into the stage's Worker secrets on every deploy, so a stage that still uses its legacy token, or a credential that `setup-account` replaced, switches over on the next deploy. A same-named token without a record (its value is shown only once) is deleted and replaced; a record that cannot be written deletes the new token again.
- **Live check, 2026-10-25.** An account-owned token with the `allow` policy nested as `{ account: { "com.cloudflare.edge.r2.bucket.*": "*" } }` is refused (HTTP 400, code 1001, "Must specify a bucket for account owned tokens, or nest bucket under specific account resource"); `{ account: "*" }` is accepted. A temporary token with the two policies above listed a stage bucket over S3 (`ListObjectsV2`, HTTP 200) and was refused on `sst-state`, `prototype-logs` and `prototype-mailsink` (`403 AccessDenied`). The token was deleted.
- **What the stages share, and what they do not.** A leaked stage Worker secret now reaches every stage bucket of the account instead of one; it still reaches no account bucket, so not the SST state, the records, the logs or the mail sink. Tickets stay bound to the stage: the server signs only URLs for its own bucket (`FRAMEWORK_FILES_BUCKET`), and a signature covers bucket, key, method and expiry. The stages keep disjoint databases, buckets and secrets. This is the accepted trade for an everyday token that cannot create tokens: Cloudflare's account-owned tokens cannot be scoped to stage buckets that do not exist yet. CF-REQ-002 carries an amendment, and CF-AC-002 now asks that each stage's ticket names only its own bucket, signed with the account's credential.
- **Legacy tokens.** Stages deployed before this decision have `<app>-<stage>-files-signing`. `listStageResources` and `remove` still find and delete it when the credential may list tokens; with the everyday token the listing answers 403 and is treated as "none", so `remove` works without the token permission and leaves the legacy token, which is scoped to the deleted bucket only. The owner deletes leftover legacy tokens in the dashboard, or runs `remove` with the setup token. One such token exists on the development account (2026-10-25).
- **Removal and leftovers.** `remove` never touches the account's credential. COMPL-REQ-004's leftover check covers a legacy token; COMPL-AC-004's deliberately left-behind resource becomes the stage's R2 bucket.
- **The backup bucket (merge of batch B, DEC-0543).** Batch B added the account bucket `prototype-backups`, where a production `remove` writes the stage's database exports and files for PAR-311. It is in `ACCOUNT_BUCKETS`, so the token is denied on it too: a leaked stage Worker secret can neither read a removed stage's backup (the data the owner deleted) nor overwrite or delete one. The owner restores with an R2 token of their own (PROV §2 "Restoring a removed production stage"). The live check above covered the three buckets denied then; the fourth entry has the same shape and is not yet verified live.
- **Re-run of `setup-account`.** The record names the buckets its token denies. A record whose `deniedBuckets` does not include every `ACCOUNT_BUCKETS` entry (every record written before this merge, which has no such field) makes the credential read as absent; `setup-account` then deletes the same-named token and creates one with the full deny list (it needs "Account API Tokens Write", so the setup token). The deploy preflight reports every absent shared resource in one message, `the account's shared resources are missing (<names>); run setup-account --target cloudflare first`, so an account set up before both batches sees the backup bucket, its lifecycle rule and the signing credential named together, and one run of `setup-account` creates all three. A unit test (`target.unit.test.ts`) covers that message.

Criterion tests that must change (they are under `tests/compliance/criteria/`, which this batch does not edit): PROV-AC-002 (`prov/deploy-sequence.test.ts`, `prov/support/restricted-token.ts`: the restricted-token deploy now succeeds, and a deploy without the signing record fails naming it), PROV-AC-004 (`prov/setup-account.test.ts`: the Account API Tokens Write clause, and the production-deploy clause of DEC-0553), CF-AC-002 (`cf/stage-resources.test.ts`, `_cloud/stage-resources.ts`: no per-stage token; equal access keys, different buckets), COMPL-AC-004 (`prov/test-stages.test.ts`: leave the bucket behind instead of the token).

### DEC-0551 — Two Cloudflare tokens: an everyday token and a setup token, with the minimal permission set of each command
Origin: ai-proposed · Status: accepted (verified live with a temporary token, 2026-10-25; SST's own calls during a deploy not yet observed); the setup token superseded by DEC-0563's dashboard-made bootstrap token, and the everyday set extended by DEC-0563 with Email Routing Rules Read · Supersedes: DEC-0374 · Affects: PROV §2 "Credentials", PROV-REQ-002, PROV-REQ-004, SKILL-REQ-006, `skill/reference/owner-tasks.md` §2–§3, `skill/reference/troubleshooting.md`, `skill/reference/deploying.md`, `apps/template/README.md` §2–§4, `provision/cloudflare/{r2-token,email,email-permissions}.ts`

The calls are read from `provision/cloudflare/*` and `cli/commands/*`. Each permission is the one Cloudflare's API reference lists as accepted for the call (developers.cloudflare.com/api/, "Accepted Permissions", read 2026-10-25), or, where the reference lists none, the one the live check showed. "Write" is the API name of the dashboard's "Edit".

| Command | Account permissions | Zone permissions (email domain's zone) | Calls behind them |
| --- | --- | --- | --- |
| `deploy`, test stage | Workers Scripts Write, Workers R2 Storage Write, D1 Write | none | `tokens/verify` (no permission; any token verifies itself); `workers/subdomain` GET (Workers Scripts Read or Write), script upload, `…/secrets` PUT/GET and `…/subdomain` POST (Workers Scripts Write); R2 bucket create (Workers R2 Storage Write), bucket GET, CORS PUT and the `sst-state` objects of SST and the records, the stage record `framework/<app>/<stage>/stage.json` GET, and its DELETE for `--start` (R2 Storage; DEC-0544); the preflight's `prototype-backups` GET and `…/lifecycle` GET (Workers R2 Storage Read or Write; DEC-0543); D1 list and query (D1 Read or Write), create and delete (D1 Write); the native copy's `…/database/<uuid>/export` and `…/import` POSTs (D1 Write; the signed-URL download and upload need no Cloudflare permission; DEC-0545). SST/Pulumi use the same Workers, R2 and D1 endpoints |
| `deploy`, production stage | the above, plus Email Sending Read | Zone Read | zone lookup `GET /zones?name=` ("Zone Read"); `GET /zones/<z>/email/sending/subdomains` (live: 403 without Email Sending Read) |
| `remove` | Workers Scripts Write, Workers R2 Storage Write, D1 Write | none | script settings GET and DELETE, bucket objects DELETE and bucket DELETE, `sst remove`, D1 delete; deleting a legacy per-stage token needs Account API Tokens Write and is skipped without it (DEC-0550) |
| `remove`, production stage | the above | none | first the backup (DEC-0543): `prototype-backups` GET, D1 `…/export` POST and its polling (D1 Write) with the signed-URL download (no Cloudflare permission), the stage bucket's listing and object bytes GET, and object bytes PUT and listing in `prototype-backups` (Workers R2 Storage Write, which includes Read) |
| `stop`, `start` | Workers Scripts Write, Workers R2 Storage Write | none | `…/scripts/<w>/subdomain` POST, the route toggle (Workers Scripts Write); the stage record's PUT (`stop`) or DELETE (`start`) in `sst-state` (Workers R2 Storage Write) (DEC-0544) |
| `secrets set` | Workers Scripts Write | none | `…/scripts/<w>/secrets` PUT |
| `smoke` | none | none | no Cloudflare API request: HTTP to the stage only, base URL from the deploy record |
| `check-login` | Workers R2 Storage Read, D1 Write | Zone Read, Analytics Read | account settings record and mail sink objects (R2); `admins grant`/`revoke` through the D1 query API; zone lookup; GraphQL `emailSendingAdaptive` (live: without Analytics Read the query names the missing `com.cloudflare.api.account.zone.analytics.read`) |
| `admins` | D1 Write (`list` alone: D1 Read) | none | D1 list and query |
| `mail last --target cloudflare` | Workers R2 Storage Read | none | the account settings record and the mail sink's objects |
| `setup-account` | Workers Scripts Write, Workers R2 Storage Write, Account API Tokens Write, Email Sending Write, Email Routing Addresses Write | Email Routing Rules Write, DNS Write, Zone Settings Write, Zone Read | subdomain PUT (Workers Scripts Write); buckets (`prototype-backups` included), lifecycle rules (`prototype-backups`' PAR-311 rule `…/lifecycle` GET and PUT included, DEC-0543), records (R2 Storage Write); the sink Worker upload; the signing token (`tokens` POST: "Account API Tokens Write"; `permission_groups` and the token list: Read or Write); its own policies for the permission checks (`tokens/<id>`: Read or Write); the DEC-0515 email set-up |

**Batch B's calls (merge of batch B, DEC-0542…0546).** Every new call is covered by a permission the everyday or setup token already holds, so neither set changes: `stop`/`start` and the stage record need Workers Scripts Write and Workers R2 Storage Write; the production backup and the native copy need D1 Write and Workers R2 Storage Write; the backup bucket and its lifecycle rule are created with the setup token's Workers R2 Storage Write. Not verified live under these sets: the D1 export and import endpoints and the R2 object bytes endpoints have not yet been called by the framework's code (DEC-0543, DEC-0545). The plan read of DEC-0546, `GET /accounts/<a>/subscriptions`, needs "Billing Read" (the API reference's accepted permissions). It is deliberately in neither set: billing data is not something a deploy needs, and the read only sharpens an error message. A token without it gets HTTP 403; `workersPlanReader` never throws, falls back to `PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN`, and without the setting the 7406 message names both limits (`plan.unit.test.ts` covers the 403). So the plan read never fails a deploy.

**The two tokens** (owner-tasks §2, the template README §2):
- **Everyday token** (`prototype-framework`): the union of every command but `setup-account` (`stop`, `start` and the production backup included). Account: Workers Scripts Write, Workers R2 Storage Write (which includes Read), D1 Write, Email Sending Read. Zone: Zone Read, Analytics Read. No permission on API tokens, so it cannot mint a token, and no write permission on email or DNS.
- **Setup token** (`prototype-framework-setup`): `setup-account`'s set. The owner runs `setup-account` rarely (once per account, and to change the email domain), sets the setup token for that run only, and may give it an expiry and recreate it when needed.

**Live check, 2026-10-25** (51 Cloudflare API calls and 8 read-only S3 listings in all for this decision and DEC-0550, including the final listing that showed no `prototype-compliance-batchc-*` token left; token values and the account ID were never printed). A temporary token `prototype-compliance-batchc-everyday-…` with exactly the everyday set and a 2-hour expiry: `tokens/verify` 200 `active`; `prototype-logs` and `sst-state` bucket GET 200, a never-created bucket 404 (code 10006); `workers/subdomain` 200; the account settings record 200; the signing record 404 (absent, code 10007); the `sst-state` listing 200; D1 list 200; a missing Worker's `secrets` and `settings` 404 (code 10007), the answers step 1 and step 3 rely on; the mail sink listing 200; the zone lookup 200; the Email Sending listing 200; the GraphQL delivery query 200 without errors; and `tokens/permission_groups`, the token list and its own `tokens/<id>` 403 (code 9109), which deploy no longer sends except the stage listing's legacy-token probe, read as "none". A second token without Email Sending Read and Analytics Read: the sending listing 403 (code 10000) and the GraphQL error above. Both tokens were deleted and read back 404. No deploy ran, so SST/Pulumi's own requests and the Email Service binding upload of a production stage are not observed under the everyday set; a refusal there fails step 3 or 5 with Cloudflare's error, which names the request.

### DEC-0552 — The `workers.dev` subdomain `setup-account` registers is `pf-<random>`, never derived from personal data
Origin: owner · Status: accepted · Amends: DEC-0333 (the registered name) · Resolves: DEC-0086 · Affects: cloudflare.md §2, PAR-320, `provision/cloudflare/account.ts` (`randomSubdomain`)

The owner, 2026-10-25, resolved DEC-0086 and DEC-0333 by renaming the account's `workers.dev` subdomain to a neutral name. The framework must never register a subdomain derived from personal data. DEC-0333 registered `pf-<first 12 characters of the account ID>`; the account ID identifies the owner's account and appears in every stage's public address, so the code now registers `pf-` and PAR-320's 12 random characters (`a`–`z`, `0`–`9`, from `crypto.randomBytes` with rejection sampling so each character is equally likely). A repeat run after a refused registration draws a new name. The framework reads the subdomain from Cloudflare on every deploy and never derives anything else from the account ID or the owner's name.

### DEC-0553 — A production deploy reads its email prerequisites with "Zone Read" and "Email Sending Read"; the write permissions of DEC-0515 are `setup-account`'s only
Origin: ai-proposed · Status: accepted · Amends: DEC-0515 (its sentence that a production deploy checks the email permissions), PROV-REQ-002 step 1 · Affects: PROV-AC-004, `provision/cloudflare/email.ts` (`productionPrerequisites`), `provision/cloudflare/email-permissions.ts`

DEC-0515 had a production deploy check all six email permissions by reading the token's own policies, which needs "Account API Tokens Read" and keeps the email write permissions on the token every deploy uses. A deploy writes nothing email-related: the `send_email` binding is part of the Worker upload. So `productionPrerequisites` keeps its checks (the zone exists and is active; the domain's Email Sending entry is onboarded and verified) and drops the policy read: the zone lookup needs "Zone Read", the sending listing "Email Sending Read" (live: 403 without it), and a refusal names that permission. `setup-account` still checks every DEC-0515 permission, plus "Account API Tokens Write" while the signing credential is absent (DEC-0550), before it changes anything. PROV-AC-004's production-deploy clause becomes "with a token lacking Email Sending Read, a production deploy names that permission and changes nothing"; its criterion test (`prov/setup-account.test.ts`) must change.

### DEC-0554 — The portability check also inspects the installed dependency tree and the Worker bundle for provider SDKs
Origin: ai-proposed · Status: accepted · Amends: DEC-0180 (`allowed-imports`' fixed list), CHECK-REQ-001 (`allowed-imports` row), CF-REQ-003 · Affects: CHECK-AC-001, CF-AC-003, check.md §2, `src/check/{denied-packages,dependencies,engine}.ts`, `src/check/rules/allowed-imports.ts`, `src/build/{inspect,build}.ts`

The owner, 2026-10-25, batch C: reduce the risk of DEC-0180, whose check blocks only packages that app code imports by name, so an ordinary-looking package can bring in a provider SDK.

- **One deny list.** The patterns move to `src/check/denied-packages.ts` (`isDeniedPackage`), shared by the import rule, the tree check and the bundle inspection. It also names `cloudflare` (the Cloudflare SDK) and `googleapis`.
- **Installed tree** (`check/dependencies.ts`, run by `verify` with the lint rules). The lockfile is the nearest `package-lock.json` upwards that lists the app (the workspace root's for a workspace app), else `node_modules/.package-lock.json`; lockfile versions 2 and 3. Without one, nothing is installed and nothing is reported. The walk starts from the app's `dependencies`, `devDependencies` and `optionalDependencies`, except the framework, whose own tree (SST, Wrangler, PGlite) runs on the owner's machine and never reaches a bundle. It follows `dependencies`, `optionalDependencies` and non-optional `peerDependencies`, resolved as Node resolves them (nearest `node_modules/<name>` upwards; workspace links to their target), breadth first. Each app dependency that reaches a denied package is reported once per denied package with a shortest chain, on its line of `package.json`, under `prototype-framework/allowed-imports` (so no new rule ID, and the CHECK-AC-003 reference mapping holds). Checked against this repository's lockfile: the template, reference and demo apps pass. (`better-auth`, a framework dependency, installs `kysely`; an app that added `better-auth` itself would be reported, which is intended.)
- **Bundle inspection** (`build/inspect.ts` `providerSdksIn`, run by every build after the Node module check). It fails the build with `CORE.MISCONFIGURED` when esbuild bundled a module from a denied package (read from the module's `node_modules/<package>/` path in the metafile), or when the bundle text carries a marker string a provider SDK has in its own code: the package scopes `@aws-sdk/`, `@smithy/`, `@google-cloud/`, `@azure/`, `@cloudflare/`, `@pulumi/`, `@vercel/`, `@netlify/`, `@neondatabase/`, `@planetscale/`, `@libsql/`, `firebase-admin`, and the client headers `aws-sdk-js`, `x-goog-api-client`, `azsdk-js-`, `cloudflare-typescript`. `@prisma/client` was tried as a marker and dropped: Better Auth's bundled code names it in an adapter message, so it would fail every framework bundle; a Prisma client is still caught by its module path. The framework's own signer (aws4fetch, with `X-Amz-*` headers) carries no marker.
- **Ordinary packages.** Only packages on the deny list, or bundles carrying an SDK's own marker, fail. The unit tests use fixture lockfiles (standalone, nested `node_modules`, workspace links, peers, the hidden lockfile) and fixture bundles.

CHECK-AC-001 and CF-AC-003 gain a clause each; their criterion tests (`tests/compliance/criteria/check/…`, the CF-AC-003 bundle test) must add fixtures for them.

### DEC-0555 — The owner-review digest is closed
Origin: owner · Status: accepted · Affects: every entry whose status said "owner review open", "proposed", "assumption" or "owner decision outstanding", plan.md §11 item 5

The owner, 2026-10-25: "you should not be asking detailed minor questions about things you designed yourself with no input from me."

- **Accepted.** Every such entry is set to `accepted` with the note "accepted under the owner's instruction of 2026-10-25"; any other notes in its status (amendments, supersessions, "unverified live") stay. The closing line "open for owner review" of those entries now carries the same note.
- **Not changed here.** The entries batches A and B change (DEC-0091, DEC-0096, DEC-0101, DEC-0137, DEC-0146, DEC-0165, DEC-0314, DEC-0328, DEC-0350, DEC-0376, DEC-0380, DEC-0414, DEC-0430, and DEC-0280's SEC-AC-005 bullet; DEC-0280 itself is accepted with that bullet excepted); the AWS-branch entries (items G-*); DEC-0374 (superseded by DEC-0550 and DEC-0551) and DEC-0180 (amended by DEC-0554).
- **Resolved by the owner.** DEC-0086 and DEC-0333: the owner renamed the `workers.dev` subdomain to a neutral name; the framework registers `pf-<random>` (DEC-0552).
- **Superseded.** The Google-provider entries DEC-0227, DEC-0232, DEC-0233 and DEC-0234 by DEC-0513; the Google parts of DEC-0189, DEC-0299 and DEC-0368 (the placeholder Google client ID of `production-stage.json`) by DEC-0513 (DEC-0367 names no Google client ID, so it is only accepted); DEC-0226 (the configuration admin and user lists in `createTestApp`) by DEC-0521 and DEC-0522.
- plan.md §11 item 5 says it is closed.

### DEC-0556 — Review fixes of batches B and C: lossless backups, numbered backup keys, every backup listed, a stopped stage re-stopped after any code-step failure, committed writes never timed out
Origin: ai-proposed · Status: accepted · Serves: DEC-0542, DEC-0543, DEC-0544 (owner rules) · Amends: DEC-0543 (backup layout), DEC-0545 (pre-check failure), DEC-0550 (credential replacement order), DEC-0554 (npm aliases, no lockfile), SQL-REQ-006 (write timing) · Affects: provisioning.md §1–§2 "Backup before a production removal", "Restoring a removed production stage", per-target operations; cloudflare.md; migrations.md §2 "Cloudflare"; sql.md SQL-REQ-006 and §2.2 "Failures"; check.md §2; skill `deploying.md`, `owner-tasks.md`; `src/provision/**`, `src/sql/{guard,handle,atomic}.ts`, `src/check/{dependencies,denied-packages,engine}.ts`, `src/check/rules/allowed-imports.ts`, `src/cli/commands/verify.ts`

An independent review of `claude/better-auth` found these; each was reproduced by a failing unit test first.

- **Lossless backup (DEC-0543, DEC-0096).** D1's export rounds integers beyond ±2^53 and its import stops at a NUL in text, and the backup was checked only for object presence, so a production `remove` could delete data it had not kept. Before the export, each database is scanned (the native copy pre-check's test); each table holding such a value is also read row by row and written as `database/<name>.lossless.json` (typed values: every integer as decimal text, text with every character intact, blobs as hex) and `database/<name>.lossless.sql` (`DELETE FROM` and one `INSERT` per row with literals no import misreads), both named in the manifest's `lossless`. The restore executes one file: the export without those tables' rows, followed by the lossless SQL. Failing the backup instead was the alternative; it would have made such a stage impossible to remove.
- **Numbered backup keys.** A stored key may be R2's full 1024 bytes, so `files/<key>` could not be written and such a stage could never be removed. Files are stored as `files/000001`, … in key order; the manifest's `fileObjects` gives each one's original key, content type and size.
- **Every backup listed.** A retry after a partial removal (databases already deleted) wrote a near-empty backup and named only it. `remove` now lists the stage's backups before backing up (a failed listing deletes nothing) and prints every one, the usable ones first and newest first, flagging a backup without a manifest, or with fewer databases than the most any backup of the stage holds, as "do not restore from it"; the closing line names the backup to restore from. The stage keeps no other record of its databases, so the backups themselves are the record.
- **A stopped stage stays stopped (DEC-0544).** A failure after `sst deploy` (the framework secrets, the deferred secrets check, the runner's after-code abort) skipped the re-stop, so a stage recorded as stopped answered publicly. Every failure at or after step 5 now turns the app off again, and the failure's stage state says whether that worked (otherwise the next action is `stop`).
- **Pre-check failure (DEC-0545).** A pre-check that throws (D1 refusing one of its reads) now makes the copy row by row, with the error as the reason, instead of failing the deploy. Its reference check compares table names without regard to ASCII case, as SQLite does (the row-by-row copy's parent ordering too). The pre-check is three read requests, not two.
- **Signing credential replacement (DEC-0550).** `setup-account` deleted the old `prototype-r2-signing` token before creating the new one, so a failure in between left every deployed stage with a dead key and no replacement. The new token and its record are written first, the old token is deleted last, and `setup-account` prints that every deployed stage must be redeployed to pick up the new key (until then its file tickets fail).
- **npm aliases and other package managers (DEC-0554).** A dependency `"s3": "npm:@aws-sdk/client-s3@^3"` passed the tree check and `allowed-imports`. Both now judge an alias by the package it installs (the lock entry's `name`, else the `npm:` spec's target; for imports, the aliases the app's `package.json` declares). Without a `package-lock.json` (pnpm, yarn, bun, or nothing installed) `verify` prints a warning that the tree was not checked.
- **A committed write is never reported as failed (DEC-0542).** The guard raced every operation against PAR-210, so a write whose answer arrived after the budget, having committed, was reported as `SQL.UNAVAILABLE`, inviting a retry that saves it twice. Writes (`insert`, `update`, `delete` builders and `atomic`) are no longer timed: the guard waits for the driver's answer; a driver error meaning "unreachable" is still `SQL.UNAVAILABLE`. Reads keep PAR-210. SQL-REQ-006 says so. A write that never gets an answer is bounded by the platform (PAR-270 on Lambda; the client's disconnect on a Worker), not by the framework.

### DEC-0557 — Re-review of DEC-0556: one restore file in dump order, a paged lossy scan, backups compared by database ids, PAR-210 until the handoff
Origin: ai-proposed · Status: accepted · Amends: DEC-0556 · Serves: DEC-0542, DEC-0543 (owner rules) · Affects: SQL-REQ-006 (amended text), sql.md §2.2 "Failures", provisioning.md "Backup before a production removal" and "Restoring a removed production stage", cloudflare.md, skill `deploying.md`, `src/provision/cloudflare/d1/{lossless,operations,fake-d1-api}.ts`, `src/provision/cloudflare/backup.ts`, `src/provision/core/remove.ts`, `src/sql/{guard,postgres,d1}.ts`

An independent re-review of DEC-0556 found these; each was reproduced by a failing unit test first.

- **One restore file in dump order.** DEC-0556 appended the lossless rows after D1's export, so a row referencing a lossy table's row came before its parent; D1's import defers foreign keys over only about 4 KB (A-06), so the restore failed on real D1. The backup now writes `database/<name>.restore.sql`: the export split into statements (on its bytes, quotes respected, so NUL and invalid UTF-8 elsewhere are kept), each lossy table's `INSERT` statements replaced at the first one's place by its rows. The number of statements replaced must equal the rows read, or the backup fails and deletes nothing. `.lossless.sql` is gone; the owner runs one command. The fake D1 import now enforces the 4 KB deferral (a violation open for more than 4096 bytes of the dump fails the import, rolled back), and the restore is tested against it.
- **Paged scan with a fallback.** The scan was one full-table read per table in one batch, which D1 refuses on a large database, so such a stage could never be removed. Each table is scanned on its own, `pageRows` rows per read by rowid (by offset for WITHOUT ROWID), stopping at the first lossy page; a table whose scan still fails is backed up losslessly (named in `scanFailures`) instead of failing the backup.
- **Text bytes kept exactly.** Text is written to the restore file as its stored bytes, `CAST(X'…' AS TEXT)`; the JSON keeps a leading U+FEFF and writes text that is not valid UTF-8 as `{"textHex": …}`.
- **Backups compared by database ids.** Flagging by database count could flag the only fresh backup against a stale one from an earlier lifetime of the stage. Manifests record `databaseIds` (D1 UUIDs); a backup is flagged only when it has no manifest or its ids are a strict subset of an earlier backup's. A manifest without ids is never flagged for its databases.
- **PAR-210 until the handoff.** DEC-0556's untimed write contradicted SQL-REQ-006's "cannot be reached within PAR-210 … `SQL.UNAVAILABLE`" and could wait without bound locally. The guard now bounds every operation by PAR-210 until it is handed to the driver: an adapter with a connection to wait for passes `connection` (PGlite: the handle's operations take PGlite's single connection in turn, after `waitReady`). An operation that does not get it in time is `SQL.UNAVAILABLE` and is never sent (the connection is given back when it comes). After the handoff a read stays bounded and a write is not. A D1 binding takes an operation at once. SQL-REQ-006 now says that the database is reached at the handoff, and that a write is bounded before it and never cut off after it.
- **Docs.** The restore is one command with the restore file; a row whose hex-written values push its statement over PAR-217 is loaded by hand, as for D1's export.
- **Second re-review.** (a) PGlite's connection turns are one queue per PGlite instance (a `WeakMap`), not per handle: a test app's SQL and KV handles share one instance, so a write on the second handle could otherwise wait inside PGlite with no timer. (b) A WITHOUT ROWID table is scanned and read in keyset pages by its primary key (`ORDER BY` the key, `WHERE (key…) > (…)` with the last page's `quote()` literals), never by `OFFSET`, whose cost grows with every page; rowid tables use the same keyset with `rowid`. (c) The dump splitter keeps a trigger's `BEGIN … END` body (and any `CASE … END`) whole, so a trigger inserting into a lossy table no longer breaks the statement count. (d) A production `remove` stops the app and records the stop, as `stop` does, before the backup starts, so the stage cannot change between the reads and the export; a failed backup leaves it stopped and prints the `start` command. A stop that fails while the target no longer lists the app's resource (`appResourceKind`, Cloudflare `Worker`: a retry after a partial removal) does not block the backup; any other failed stop deletes nothing.
- **Third re-review.** (a) Keyset pages carried their keys as `quote()` literals, which cut text at a NUL, so a WITHOUT ROWID table with a NUL in a text key was read forever. Keys now travel as `literal` writes values (text `CAST(X'…' AS TEXT)`, blobs `X'…'`, integers as decimal text), and a page whose last key equals the previous page's fails the backup loudly. Tested on real SQLite (node:sqlite) and the fake. (b) After stopping the app, a production `remove` waits PAR-315 (60 s on Cloudflare, `waitForInFlight`) for requests in flight before the backup reads anything. (c) The test app's auth database takes PGlite's connection turns too (`queuedClient`), so a guarded operation behind an auth transaction stays bounded by PAR-210.

## Compliance passes and criterion production stages (2026-10-25)

### DEC-0560 — No automated pass changes shared account state; criterion production stages carry reserved prefixes and are cleaned like test stages
Origin: ai-proposed (orchestrator's decision on the batch B/C test review, 2026-10-25) · Status: accepted · Amends: COMPL-REQ-004 (naming exception), COMPL-REQ-006 (milestone list), DEC-0531 (the token list) · Affects: PROV-AC-002's Where column, compliance.md §1 and §2, `tests/compliance/harness/{criterion-stages,driver,node-deps,leftovers,env,test-tokens}.ts`, `tests/compliance/criteria/prov/{deploy-sequence,preflight-fake,setup-account,removal}.test.ts`, plan.md D-RUN-M

The batch B/C criterion tests (DEC-0540…DEC-0546, DEC-0550…DEC-0555) need, for some clauses, to change the account's shared state or to create production stages.
- **No automated pass changes shared account state.** PROV-AC-002's clause "without the account's R2 signing credential, deploy names it and `setup-account`" can only be shown live by making the signing record (and, for the one-message clause, the backup bucket's PAR-311 lifecycle rule) read as absent. That clause becomes a milestone part of PROV-AC-002 (`Cloud; signing-credential clause: Cloud (milestone)`) and joins COMPL-REQ-006's milestone list. Tests learn the tier from `COMPLIANCE_RUN_MODE` (`automated` or `milestone`), which the driver sets. The live test restores the record and the rules in a `finally`, reads them back, and on any difference fails loudly with the repair command (`setup-account --target cloudflare` with the setup token). Its logic is also shown on every automated pass against the framework's fake Cloudflare API (`prov/preflight-fake.test.ts`, tagged PROV-AC-002).
- **Criterion production stages.** PROV-AC-003 (production removal and its backup, DEC-0543) and PROV-AC-004 (production deploy without "Email Sending Read", DEC-0553) need production stages of their own. They are named with a reserved prefix and 10 random lowercase letters and digits, `p003…` and `p004…` (one harness constant, `CRITERION_PRODUCTION_PREFIXES`). A test writes a marker `compliance/criterion-stages/<stage>.json` (`{ stage, runId, createdAt }`) in `sst-state` before it deploys such a stage and deletes it after the stage's successful removal. At the start and the end of every cloud run the driver lists the account's stages with these prefixes (from its Worker, R2 bucket and D1 database names) and the markers, and sweeps only marked stages whose marker is older than PAR-286 (6 h, the longest criterion run), so a concurrent run's live stage is never removed: it removes each with `remove --confirm-production <stage>` and the run's token (a production `remove` needs only the everyday set, DEC-0551; it writes a backup first, which the PAR-311 rule deletes), deletes the marker once nothing remains, and records what remains, or a listing that fails, as a leftover. A stage of the reserved shape without a marker (an owner's) is never removed; the driver logs a warning. COMPL-REQ-004 carries the exception; `prodcheck` and every other production stage stay exempt from cleanup.
- **Signing token replacement.** PROV-AC-004's re-run clause replaces `prototype-r2-signing` (DEC-0550 "Re-run of setup-account"); stages deployed before keep the old credential until their next deploy. The clause refuses (blocked) while any Worker other than the mail sink, `reference-prodcheck` and the reference app's marked criterion production stages exists; PROV-AC-004 runs in a milestone pass of its own with no run stage. After the replacement the clause redeploys `prodcheck`, so it holds the new credential, and checks an upload and a download through its tickets. Its `finally` checks the credential: a broken one is restored from the old record while the old token exists, else the run fails naming `setup-account`.
- **Self-created tokens.** compliance.md's list of criteria with self-created restricted tokens (DEC-0531) now matches the harness: PROV-AC-002 (the everyday token), PROV-AC-003 (no "Workers R2 Storage Write") and PROV-AC-004 (no "Email Routing Addresses Write"; no "Account API Tokens Write"; no "Email Sending Read").

## Compliance pass 4 (2026-10-25)

### DEC-0561 — Compliance pass 4 framework fixes: check-login over one connection, a restarted previous version is health-checked, the copy line on a failed migration
Origin: ai-proposed (compliance pass 4 diagnoses, independently confirmed) · Status: accepted · Serves: PWD-AC-009, PROV-AC-002, MIG-AC-003, DEC-0545 · Affects: password.md §2 "Real-provider check", provisioning.md §2 (deploy sequence notes), parameters.md PAR-330, `packages/framework/package.json`, `src/cli/one-connection.ts`, `src/cli/commands/check-login.ts`, `src/provision/core/{deploy,operations,fake-target}.ts`, `src/provision/cloudflare/target.ts`

Each defect was reproduced by a failing unit test first.

- **check-login from one client IP.** password.md §2 step 7 asks for "a burst of sign-in requests from one client", and PAR-258 counts per IP. check-login used `globalThis.fetch`, which spreads even sequential requests to one origin over several sockets; behind an egress proxy with several public addresses those leave from several IPs, so the limit may never be reached. check-login now builds one dispatcher with `connections: 1` (`oneConnectionDispatcher`: undici's `EnvHttpProxyAgent` when `HTTPS_PROXY`/`HTTP_PROXY` is set, as `NODE_USE_ENV_PROXY=1` honours them, else `Agent`) and sends every request over it, the stage's and the Cloudflare API's. It is passed per request, never installed globally (Wrangler replaces the global dispatcher). `undici` 7.29.1 becomes a framework dependency (PAR-330), the version already in the tree.
- **"Previous version restarted" means it answers.** After a failed migration or check, deploy printed "previous version restarted" as soon as `startApp` returned; PROV-AC-002 and MIG-AC-003 say the previous version answers again afterwards. `restorePrevious` now runs step 7's health wait (`checkHealth`, one try per second, up to 30 s) after `startApp`; `checkHealth` takes the deployed code optionally and, without it, uses the stage's public origin as the target names it. The stage state says "previous version restarted" only after a healthy answer, and otherwise "previous version restarted but not answering (<status/code>)"; the deploy exits 1 either way, as before. A stage recorded as stopped is not started or checked.
- **The copy line on a failed migration.** provisioning.md requires a deploy that copies the database to print which copy ran; the line was printed only after `migrate()` returned, so a migration, check or old-database deletion that failed after the copy, and the runner's `after-copy` abort, printed none. It is now printed inside `migrate()` right after `copyDatabase` returns.

### DEC-0562 — SEC-AC-005: the 5 consecutive requests are sent once PAR-310 has elapsed
Origin: orchestrator, applying the owner's decision 1A · Status: accepted · Supersedes: DEC-0540's counting rule · Affects: SEC-AC-005, secrets.md §2 "Propagation on Cloudflare", `tests/compliance/criteria/secrets/further-stage.test.ts` (test authors)

DEC-0540's criterion text counted the 5 consecutive requests from "the first that sees it", which is stricter than the owner's decision (a bounded delay, then 5 consecutive requests): during a Worker version rollout an old version can still answer a request after a new one has, so a request soon after the first that sees the change may still show the old state within PAR-310. The owner's bound is PAR-310 from the command returning; the sample comes after it.
- **New text of SEC-AC-005.** "After `secrets set`, a request sees the new value within PAR-310 of the command returning, and 5 consecutive requests sent once PAR-310 has elapsed all see it; after the test deletes the secret directly through the target's store (a test hook), a request fails with `SEC.MISSING` within PAR-310, and 5 consecutive requests sent once PAR-310 has elapsed all fail with it."
- **Test change** (test authors): for each clause the test waits, bounded by PAR-310 from the command (or store deletion) returning, for a request that shows the change; then waits until PAR-310 has elapsed since the command returned; then sends 5 requests that must all show it. A request that does not see the new value is reported with its body checked against the old value's hash, so a stale read is told apart from any other failure.
- PAR-310 (60 s) and SEC-REQ-005 are unchanged.

### DEC-0563 — One versioned Cloudflare permission list: the everyday token and the dashboard-made bootstrap token
Origin: owner (plan-setup-wizard §1, §4.1, 2026-10-26) · Status: accepted · Supersedes: DEC-0551's setup token (its everyday set is kept and extended) · Affects: PROV §2 "Credentials", SKILL-REQ-006, `skill/reference/owner-tasks.md` §2–§3, `apps/template/README.md` §2, PAR-331, PAR-332, `provision/cloudflare/permissions.ts`

One module, `provision/cloudflare/permissions.ts`, holds both tokens' permission groups by Cloudflare permission group ID, API name and scope (account or zone), with `PERMISSIONS_VERSION` (PAR-331) and `ACCOUNT_SETUP_VERSION` (PAR-332). The deep links (DEC-0564), the token checks and the everyday token's in-place upgrade (DEC-0565) and the docs' permission tables (`permissionTableMarkdown`) are generated from it; the hand-written lists in the docs are replaced from it (not yet done here).
- **Everyday** (`prototype-framework`, 7 groups): DEC-0551's minimal set, plus "Email Routing Rules Read" (owner, 2026-10-26), so the everyday token can check the whole account setup on its own. Account: Workers Scripts Write, Workers R2 Storage Write, D1 Write, Email Sending Read. Zone: Zone Read, Analytics Read, Email Routing Rules Read. Still no permission on API tokens and no zone write permission.
- **Bootstrap** (`prototype-framework-bootstrap`, 12 groups), replacing DEC-0551's setup token: Account: Workers Scripts Write, Workers R2 Storage Write, Account API Tokens Write, Email Sending Write, Email Routing Addresses Write, Billing Read, D1 Write. Zone: Email Routing Rules Write, DNS Write, Zone Settings Write, Zone Read, Analytics Read. The API cannot create a token that holds "Account API Tokens Write" (400, code 1001, verified 2026-10-26), so the owner makes it in the dashboard from its link; setup deletes it when done.
- **IDs.** Read once from `GET /accounts/<a>/tokens/permission_groups` on 2026-10-26 (public Cloudflare constants; output filtered to names, IDs and scopes). The code matches a policy's group by ID, or by name when the policy lists one. The existing `setup-account` checks (`EMAIL_PERMISSIONS`, `MAIL_SINK_PERMISSIONS`, `TOKEN_WRITE_PERMISSION`) are unchanged; a unit test keeps every name they check in `BOOTSTRAP` with the same scope.
- **Versions.** A release that needs more everyday or bootstrap permissions raises PAR-331 with the list; one that needs more account setup raises PAR-332.

### DEC-0564 — Both tokens come from pre-filled dashboard links, with every group given by ID
Origin: owner (plan-setup-wizard §1, §2, 2026-10-26; token name of the bootstrap token: ai-proposed) · Status: accepted · Affects: `provision/cloudflare/permissions.ts` (`deepLink`, `TOKEN_NAMES`)

`deepLink(kind)` is Cloudflare's account-owned token template (developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/, read 2026-10-26): `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=<URL-encoded JSON>&name=<URL-encoded name>`. The JSON is an array of `{ "key": <permission group ID>, "type": "read" | "edit" }` in list order; with an ID as the key the page ignores `type`, which is set from the name anyway ("read" for a Read group, else "edit"). IDs are used because each names exactly one group. The owner checked both links on 2026-10-26: every group arrived ticked (plan §2). The link cannot set the expiry, the account or the zone; the page puts every group in one policy for the entire account, so zone groups cover all the account's zones, which the owner accepted. The pre-filled names are `prototype-framework` (DEC-0551's everyday name) and `prototype-framework-bootstrap`.

### DEC-0565 — Checking a token against the list, the in-place update body, and the everyday token's quick check
Origin: ai-proposed · Status: accepted · Affects: `provision/cloudflare/permissions.ts` (`comparePolicies`, `withMissingPermissions`, `inPlaceUpdateBody`, `probeEveryday`), `provision/cloudflare/fake-cloud.test-support.ts`

- **Comparison** (`comparePolicies`, of `GET /accounts/<a>/tokens/<id>`'s policies). Scopes are read as `policyCovers` (DEC-0515) reads them. A required group is missing when no `allow` policy grants it on its scope, or a `deny` policy takes it away; "Zone Write", "Email Sending Write" and "Email Routing Rules Write" also satisfy their Read group. `wrongAccount`: the `allow` policies name accounts, and none is this one or `*`. `zoneCovered`: an `allow` policy granting a required zone group covers the email domain's zone (the zone, all zones, or the whole account); a policy granting only account groups says nothing about zones.
- **In-place update** (`PUT /accounts/<a>/tokens/<id>`, which keeps the value, verified 2026-10-26). The body keeps the token's name, status, expiry, start time and conditions, and every existing policy (its `id`, effect and resources, its groups by ID), then adds one `allow` policy for the missing account groups on the account and one for the missing zone groups on the email domain's zone (nested under the account, as the dashboard's token shows `zone.*`), or on all the account's zones when no zone is given. A policy naming one specific zone in this nested form is not yet verified live.
- **Quick check** (`probeEveryday`, plan §4.3 step 2): one read per everyday group with the everyday token: the Workers script list, the R2 bucket list, the D1 database list, the zone's Email Sending listing, the zone itself, a one-row GraphQL `emailSendingAdaptive` query on the zone (fails on any GraphQL error) and the zone's Email Routing rules. A pass is a 2xx answer, so a Write group shows only that it can read. The zone reads (and Email Sending Read's, which is on the zone) are made only when the zone is known. Results carry the group, pass or fail, and the HTTP status, never a body. The fake Cloudflare API answers these reads.

## Setup wizard, batch 2: token sources and git-ignore safety (2026-10-26)

### DEC-0570 — Cloudflare settings come from the environment first, then `.env.cloudflare` in the project root, for every Cloudflare command
Origin: owner (2026-10-26, plan-setup-wizard §1 and §4.2); the file format and wiring details ai-proposed · Status: accepted · Affects: PROV §2 "Credentials", cli.md (every command with `--target cloudflare`), `provision/cloudflare/{token-sources,environment}.ts`, `cli/{cloudflare-settings,wiring,main}.ts`, PAR-340

- **Order.** For each of `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL_DOMAIN` and `CLOUDFLARE_ACCOUNT_ID`, a non-empty environment variable wins; otherwise the value in `.env.cloudflare` (PAR-340) is used. An empty value counts as absent in either source, and so does an environment value of only whitespace. When both hold a value and they differ, the command prints a note naming the setting and saying the environment is used; it never prints either value.
- **Every Cloudflare command.** `deploy`, `remove`, `stop`, `start`, `secrets set`, `setup-account`, `check-login`, `admins`, `mail last` and `smoke`, when run with `--target cloudflare`, are built with the environment merged with the file (`cloudflareEnvironment`; each bound once through `cloud` in `cli/wiring.ts`). Nobody exports the variables by hand. A command on the local target reads no file. The "missing Cloudflare credentials" messages now say "set them in the environment or in .env.cloudflare".
- **The file format** (ai-proposed). `NAME=value` lines; `#` comments and blank lines; an optional `export ` prefix; optional single or double quotes; an unquoted value's ` #` comment is dropped, and so is its trailing `(…)` hint, so the template's account line with only `# ` removed reads as empty and a value typed before the hint is the value; an unquoted value with a space left inside is unreadable. A later line for the same name wins, as in a shell. Only the four names are read; other names are ignored. A line that is not an assignment (for example a token pasted on a line of its own) is ignored and named by its line number only. A file that cannot be read gives a note, and the environment alone is used.
- **The template** is exactly plan §3.2's four lines (`ENV_CLOUDFLARE_TEMPLATE`); `writeTemplateIfAbsent` never overwrites an existing file.
- **Fill-in.** `fillInSettings` writes `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN` only where the file has them empty or absent (an empty line in place, else the template's commented account line, else a new line), so copying the file starts the next project. A value already in the file is never changed; a value that cannot be written back as one plain line (space, quote, backslash or `#`) is refused without naming it.

### DEC-0571 — `.env.cloudflare` is left at mode 600 after every write; the bootstrap line is commented out after use
Origin: owner for the comment-out (2026-10-26, plan-setup-wizard §1); mode 600 ai-proposed (plan §4.2) · Status: accepted · Affects: `provision/cloudflare/token-sources.ts`, PAR-341, PAR-342

- Every write (`writeTemplateIfAbsent`, `commentOutBootstrap`, `fillInSettings`) leaves the file readable and writable by its owner only (PAR-341). Each write is atomic: the content goes to a new temporary file at that mode in the same directory, which is renamed over the file, so a file that had a wider mode never holds the new content and a reader never sees half a file.
- `commentOutBootstrap` replaces every active `CLOUDFLARE_BOOTSTRAP_TOKEN=` line, also one the parser cannot read (an unclosed quote), with PAR-342's line, so no value stays in the file, and leaves every other line as it was. Setup calls it after the bootstrap token has deleted itself.

### DEC-0572 — The CLI part of the three-place git-ignore check: a prominent warning on every run, never a failure
Origin: owner (2026-10-26, plan-setup-wizard §4.3 step 1 and §4.5) · Status: accepted · Affects: cli.md (`verify` and the Cloudflare commands), `provision/cloudflare/git-safety.ts`, `cli/{cloudflare-settings,commands/verify}.ts`, PAR-343

- **When.** Every Cloudflare command of DEC-0570 (when it reads `.env.cloudflare`) and `verify` (the app's `npm run verify`, which the repository's own `npm run verify` runs for the template and reference apps) print a warning set off by rule lines in two cases: the file exists but is not ignored (`git check-ignore -q`), or it is tracked (`git ls-files --error-unmatch`). No tracked file counts as ignored, so a tracked file gets the tracked warning only, even when `.gitignore` lists it. The commands print to standard error before they run; `verify` prints to its output before its first step and again before its verdict.
- **Never a failure.** The warnings never change an exit status, and an error while checking is swallowed. Outside a repository the commands print nothing; the not-a-repository warning is setup's (`gitSafetyWarnings` returns it for setup to print).
- **Tracked.** The warning says the tokens are in the repository's history (and on any remote it was pushed to) and how to replace them: delete them in the dashboard, `git rm --cached .env.cloudflare` and commit, list the file in `.gitignore`, and run the Cloudflare setup again for new tokens.
- **Adding the line.** `ensureEnvCloudflareIgnored` (for setup) appends `.env.cloudflare` to the project's `.gitignore` unless the file is already ignored, `.gitignore` already lists it, or `.gitignore` has PAR-343's marker line; it never untracks a file. The warning still prints when the marker is present, and says setup will not add the line.
- The repository's own `.gitignore` lists `.env.cloudflare`.

### DEC-0573 — No token value is ever printed
Origin: ai-proposed (from plan-setup-wizard §1 "Setup never prints a token value" and §4.3's output rules) · Status: accepted · Affects: `provision/cloudflare/{token-sources,git-safety}.ts`, `cli/cloudflare-settings.ts`

Notes, warnings and errors of the token sources and the git checks name settings, files and line numbers only, never a value of the file or the environment (tokens, account ID or email domain). Unit tests put a fake token with a marker string in the file and the environment and search every output for the marker.

### DEC-0574 — The file's bootstrap token is not passed to the everyday commands
Origin: orchestrator, pending owner review · Status: accepted · Affects: `cli/cloudflare-settings.ts`

The Cloudflare commands of DEC-0570 work with the everyday token, so the merged environment they get leaves out `CLOUDFLARE_BOOTSTRAP_TOKEN` from `.env.cloudflare` (a value already in the process environment stays, as before). The bootstrap token then never reaches their tools' processes (SST). `cloudflareEnvironment` and `readCloudflareSettings` still return it, and `cloudflare-setup` opts out with `cloud(name, load, { withBootstrapToken: true })` (`withCloudflareSettings`'s fourth argument). To reverse: drop the filter in `commandCloudflareEnvironment`.

## Setup wizard, batch 3: the account setup record and idempotent setup steps (2026-10-26)

### DEC-0577 — The account setup record: `framework/account.json` records the setup version, framework version, time, email domain and completed steps
Origin: owner (plan-setup-wizard §4.4), details ai-proposed · Status: accepted · Amends: DEC-0514 (the record's shape) · Affects: provisioning.md §2 "Account settings record", cloudflare.md `setupAccount`, cli.md `setup-account`, `src/provision/cloudflare/{setup-record,setup-steps,target}.ts`

- **Shape.** The account settings record keeps `emailDomain` and gains `setupVersion` (an integer, at least 1), `frameworkVersion` (the framework package's `package.json` version, read as `check-login` and `smoke` read it), `appliedAt` (ISO time) and `completedSteps` (the step IDs of DEC-0578 found done or applied). Every other field of the object is kept on a write; readers of `emailDomain` (`deploy`, `check-login`, `mail`) are unchanged.
- **Version semantics.** `setupVersion` is the account setup version that was applied: the release's `ACCOUNT_SETUP_VERSION` (the versioned permission list module), which starts at 1 (`FIRST_SETUP_VERSION`) and is raised by a release that adds a setup step or changes what one creates. The setup is current for a release expecting version N when the record's `setupVersion` is N or more, it names the email domain in use, and every step's inspection finds it done (`checkAccountSetup`, which takes N as a parameter). A record without the setup fields, written before them, or with an invalid one, reads as no record, so such an account is not current. A stored higher `setupVersion` is kept when an older release re-runs setup on the same domain, so the newer release does not see the account as out of date.
- **Writing.** Written last, after every step succeeded, and only when it changes (a domain, completed steps or version that differ, or a step applied in the run); a run that applies nothing writes nothing. `setup-account` keeps recording a changed domain as soon as the shared resources exist (DEC-0514), as `{ "emailDomain" }` alone, so the old domain's setup fields are dropped until the final write; such a run writes the object twice. The target records the version given as `setupVersion` in its options, default 1.
- **Reading.** Through the R2 object endpoints of `api.cloudflare.com`, which the everyday token's "Workers R2 Storage Write" allows.

### DEC-0578 — The account setup is a list of named steps, each with a read-only inspection and an idempotent apply
Origin: owner (plan-setup-wizard §4.3 step 7, §4.4), details ai-proposed · Status: accepted · Affects: cloudflare.md `setupAccount`, `src/provision/cloudflare/{account,email,setup-steps}.ts`

- **Steps**, in order: `log-bucket`, `state-bucket`, `backup-bucket`, `backup-lifecycle`, `subdomain`, `signing-record` (the account steps, `account.ts`), then `email-sending`, `mailsink-bucket`, `mailsink-lifecycle`, `mailsink-worker`, `test-mailbox-dns`, `subaddressing`, `test-mailbox-route` (the email steps of the email domain, `email.ts`). They are exactly what `setup-account` did before, with the same requests; `setup-account`'s `inspectAccount`, `createSharedResources` and `setUpEmail` run on them.
- **Inspect** reads only, with reads the everyday token's permissions allow, and reports each step done, missing, foreign (the resource exists but this account does not own it) or unreadable (DEC-0579), with a detail that never holds a token value or an account ID.
- **Apply** (`applySetupSteps`) inspects every step first; stops before any change when the email domain is invalid, a requested step is foreign, or the token lacks a permission the setup needs (DEC-0515's email permissions and, for the signing credential, "Account API Tokens Write", DEC-0551); then applies only the requested steps that are not done, in order, and writes the record last (DEC-0577). A second run applies nothing and writes nothing; a partial setup gets only its missing steps.

### DEC-0579 — A step the everyday token may not read counts as done only when the setup record lists it
Origin: orchestrator, pending owner review · Status: accepted (assumption; owner review open; not verified live) · Affects: `src/provision/cloudflare/{email,setup-steps}.ts`, `fake-cloud.test-support.ts` (`everydayApi`)

- **Question.** The everyday permissions (plan §4.1) cannot read the zone's DNS records (`GET /zones/<z>/dns_records` needs "DNS Read"), so `test-mailbox-dns` cannot be checked with them; whether "Email Routing Rules Read" covers the Email Routing settings (`subaddressing`) and the routing DNS endpoint is not verified live. What does the everyday inspection report for them?
- **Choice.** A refused read (HTTP 401 or 403) of these two steps reads `unreadable`, never done or missing; it counts as done only when the setup record of the same email domain lists the step as completed, and the step's detail says which. Every other step is read directly, so the buckets, the signing record, email sending and the test mailbox's routing rule are always checked with the everyday token's own reads (plan §4.4). The bootstrap token's apply reads both directly. Unverified live (DEC-0334).
- **How to reverse.** Add "DNS Read" (and, if needed, a routing settings read) to the everyday permission list, and drop the record fallback in `setup-steps.ts` (`inspectAll`).

## Setup wizard, batch 5: one-line local start, version check, upgrade (2026-10-26)

### DEC-0591 — Local setup is one idempotent framework function, `runLocalSetup`, that the starter and `cloudflare-setup` both run
Origin: ai-proposed (plan-setup-wizard §3.1, §4.3 step 0) · Status: accepted · Affects: `packages/framework/src/provision/core/local-setup.ts`, `src/provision/public.ts`, `packages/create-prototype-app/{bin/create-prototype-app.js,lib/create.mjs}`, `apps/template/.gitignore`

- **Where.** `runLocalSetup(projectDir, deps?)` in `provision/core/local-setup.ts`, exported from the `./provision` subpath. It returns one outcome per step, in order: `dependencies`, `local-secrets`, `gitignore`, each `already`, `applied` or `warned` with a message. A step that cannot complete is `warned` and the later steps still run; it never throws for a step.
- **Dependencies.** "Installed" means every name in the project's `dependencies` and `devDependencies` resolves as Node finds it (`node_modules/<name>` in the folder or a parent, so a workspace counts). Otherwise `npm install`; a failed install is a warning naming the folder.
- **Local secrets.** A random value (32 bytes, PAR-253, base64url) for each development framework secret `dev` generates (`DEV_GENERATED_SECRETS`) and each secret the app declares, written to `.dev.vars` (mode 600) only where the value is absent or empty. A set value is never changed. Messages name the secrets, never the values. The app's names come from loading `src/app.ts` (as `secrets set` does); a failure to load is a warning, and nothing is set.
- **`.env.cloudflare` in `.gitignore`.** The default is a minimal internal step until batch 4 rewires it to batch 2's shared helper: `not-a-repo` (not a git work tree, or git missing: nothing is written) → warned; `git check-ignore -q --no-index .env.cloudflare` matches → already; a `# keep-env-cloudflare-tracked` line in `.gitignore` → warned and unchanged; otherwise the line is appended → applied. Git problems warn and never fail (owner, 2026-10-26).
- **Extra dependency.** Besides `npmInstall`, `ensureIgnored` and `random`, the injectable `deps` take `declaredSecrets(dir)`, so tests need no app to load.
- **The starter.** The starter has no runtime dependencies, so it loads `runLocalSetup` from the new app's installed framework (`createRequire(<app>/package.json).resolve("@lago-morph/prototype-framework/provision")`) after its own `npm install`; the dependencies step then reads `already`. With `--no-install` it skips the local setup and says no local secret value was set. The template's own `.gitignore` now lists `.env.cloudflare`, so a new app has the line before git sees the file.

### DEC-0592 — Every skill copy carries a `VERSION` marker, and the framework package ships `skill/`
Origin: ai-proposed (plan-setup-wizard §4.8a step 2) · Status: accepted · Affects: `packages/create-prototype-app/{lib/create.mjs,scripts/bundle.mjs}`, `packages/prototype-framework-skill/scripts/bundle.mjs`, `packages/framework/{package.json,scripts/bundle-skill.mjs,.gitignore}`

- **The marker.** `version-check` must know a skill copy's version, but the copies leave out `.claude-plugin/` (SKILL_SKIP). Every copy the release makes (`copySkill` in the starter's `lib/create.mjs`: the starter's bundle, a new app's `.claude/skills/prototype-framework/`, the skill package and the framework package) writes `VERSION`, one line, from `skill/.claude-plugin/plugin.json`, whose version the release already keeps in lockstep (docs/RELEASING.md step 1). A copy of a copy keeps the marker. Nothing new to bump per release.
- **Readers.** `VERSION`, else a plugin install's `.claude-plugin/plugin.json`; a `SKILL.md` with neither is "a version without a marker", older than any marked one.
- **The framework package's `skill/`.** Its `prepack` runs the build, then `scripts/bundle-skill.mjs`, which copies the repository's `skill/` as the skill package's does and refuses a `plugin.json` at another version; `postpack` removes it (git-ignored). `files` lists `skill`. `npm pack --dry-run` shows `skill/SKILL.md` and `skill/VERSION` in the framework, starter and skill packages.

### DEC-0593 — The cloud setup script is printed only pinned to an exact version, and never upgrades itself
Origin: owner (2026-10-26: "pinned to a version; it never upgrades by itself") · Status: accepted · Affects: `packages/framework/src/cli/commands/versions.ts` (`setupScript`)

The framework prints plan §4.8's setup script from one function, always with an exact version: `version-check` (the app's version, when it is newer than the setup script's skill) and `upgrade` step 5 (the new version). Nothing the framework prints or runs uses `@latest` in the script, and neither command changes the environment's settings; the owner pastes the new line.

### DEC-0594 — `version-check` never changes anything and keeps no state; its npm row is quiet on network failure
Origin: owner (never changes anything, plan §4.8a, 2026-10-26); the details below ai-proposed · Status: accepted · Affects: `src/cli/commands/version-check.ts`, `src/cli/main.ts`, CLI-REQ-001, PAR-371; retires PAR-370

- Reads only files: the installed framework's `package.json` (falling back to the app's exact pin, with "run `npm install` first"), `<app>/.claude/skills/prototype-framework/VERSION` and `~/.claude/skills/prototype-framework/VERSION`. It prints one line with the three versions, then one suggestion per finding of the plan's table, or "Nothing to do". Exit status 0 whatever it finds.
- **Row 1** applies to either skill copy that is newer than the app's framework. **Row 2** also covers a setup-script copy without a marker. **Row 3**: npm's `latest` (`<registry>/@lago-morph%2Fprototype-framework/latest`, the registry from `npm_config_registry`) newer than the app's framework and every marked skill copy, with the headline (first line of that version's section) of `CHANGELOG.md` at the release tag `v<version>` on GitHub's raw file host. Both requests go through the environment's proxy (`oneConnectionDispatcher`), each bounded by PAR-371; any failure skips the row (or the headline) without a word.
- **Stateless (review of batch 5).** The first version kept a "once per session" mark file in the OS temp directory for PAR-370. That broke "never changes anything" and wrote at a predictable shared path another local user could plant a symbolic link at. There is no mark: `version-check` writes no file anywhere (a unit test runs the real binding against temporary home and temp directories and finds no new entry), and prints the npm row on every run while a newer release exists. Mentioning it only once per session is the skill's job (batch 6). PAR-370 is retired.

### DEC-0595 — `upgrade` moves the framework's companion pins with it, and judges Cloudflare re-runs against the framework the app had
Origin: orchestrator, pending owner review · Status: accepted · Affects: `src/cli/commands/upgrade.ts`, `apps/template/package.json`, skill hard rule 5

- **Steps.** `upgrade [latest|next|<exact version>]` (default `latest`) reads the release with `npm view`, pins `@lago-morph/prototype-framework` exactly, runs `npm install`, replaces `.claude/skills/prototype-framework` with the installed package's `skill/` (a release without one leaves the copy and exits 1), runs `npm run verify`, prints whether Cloudflare setup needs re-running and the setup script at the new version (DEC-0593). A failed verify exits 1 and keeps the upgrade, printing how to go back (`git checkout -- package.json package-lock.json .claude/skills/prototype-framework`, then `npm install`).
- **Question: companion pins.** The template pins `hono`, `zod`, `typescript`, `vite` and `vitest` at the framework's own versions, and `verify` checks Zod's. **Choice:** `upgrade` sets each of those the app has to the exact version the new release depends on, in the same install. This is the deliberate exception to skill hard rule 5 (never change pins), which applies to edits by hand. **To reverse:** drop the `COMPANION_PINS` loop in `repin`; an upgrade across a Zod change would then fail verify.
- **Question: what the app "recorded".** Batch 1 adds `PERMISSIONS_VERSION` and `ACCOUNT_SETUP_VERSION`; no app-side record of them exists yet. **Choice:** compare the values the previously installed framework exports from `./provision` with the new one's, each read in a fresh Node process. Higher → "needs re-running: `npm run cloudflare-setup`" (it needs the bootstrap token once); equal → nothing needed; absent on either side → "unknown, run `npm run cloudflare-setup` to check". **To reverse:** have `cloudflare-setup` write the versions it applied to a committed file and read that file in `cloudflareVerdict` instead.

### DEC-0596 — The starter makes a git repository and a first commit, warns on any git problem, and leaves an existing repository alone
Origin: orchestrator, pending owner review (the existing-repository rule); the rest plan §3.1 · Status: accepted · Affects: `packages/create-prototype-app/{bin/create-prototype-app.js,lib/create.mjs,README.md}`

- **Order.** Copy the template and the skill → `npm install` → `git init` → local setup (DEC-0591) → `git add -A` and a first commit. `.dev.vars` and `.env.cloudflare` are ignored, so they are never in it. The starter sets no git identity: a commit that fails (for example no `user.name`) is a warning with the commands to run. Git missing or failing is a warning; the exit status stays 0. A local setup that throws, or a framework without one, is also a warning (with the `secrets set` command to run by hand), and the first commit and the closing line still follow with exit status 0: the app is usable, since `dev` generates the framework's own keys and only the app's secrets are left unset. A failed `npm install` still exits 1, because the app cannot run.
- **Question: a folder inside an existing repository** (for example `npm create … my-app` in a checkout). **Choice:** no nested repository and no commit; the starter says so. **To reverse:** drop the `rev-parse --is-inside-work-tree` check in `initRepo`.
- **Output.** It asks for no account. The last line is exactly plan §3.1's: "cd <folder>, then `npm run dev`, or open this folder in Claude Code and say what to build." (with `--no-install`: "then `npm install` and `npm run dev`"). The plugin commands are printed only with `--no-skill`.

### DEC-0597 — The template app gains the npm scripts `version-check`, `upgrade` and `cloudflare-setup`
Origin: ai-proposed · Status: accepted · Amends: CLI-REQ-001 (two commands) · Affects: `apps/template/package.json`, `src/cli/main.ts`, `src/cli/main.unit.test.ts`, cli.md

`version-check` and `upgrade` join CLI-REQ-001's table and the template's scripts. `cloudflare-setup` points at `prototype-framework cloudflare-setup`, which batch 4 adds; until then that script ends with "unknown command". CLI-AC-001's local part (`tests/compliance/criteria/cli/commands.test.ts`) lists the commands it runs; the test author adds the two new ones.

## Setup wizard, batch 4: the `cloudflare-setup` state machine (2026-10-26)

### DEC-0584 — `cloudflare-setup` is one command that runs plan §4.3's steps 0–9 in order and reads its settings itself
Origin: owner (plan-setup-wizard §4.3, §3.2, §3.4); the binding and options ai-proposed · Status: accepted · Affects: CLI-REQ-001, cli.md, `src/cli/{main,wiring}.ts`, `src/cli/commands/cloudflare-setup.ts`, `src/provision/cloudflare/cloudflare-setup.ts`, `src/provision/core/local-setup.ts`, `apps/template/package.json` (`npm run cloudflare-setup`)

- **Order.** Local setup first (`runLocalSetup`, whose `.gitignore` step is now git-safety's `ensureEnvCloudflareIgnored`, the one helper DEC-0572 describes); the git warnings (`gitSafetyWarnings`, not-a-repository included) on every run, never a failure; the tokens; the account; the email domain; the everyday quick check (once the zone is known); the plan; the setup record; with the bootstrap token the setup steps, the single check of the everyday token, the in-place update and the self-delete; the network check; the summary with `deploy --target cloudflare --stage test-first` as the next step. The process check of D-05 (`NODE_USE_ENV_PROXY=1` behind a proxy) stops the run only before its first Cloudflare request, so the local setup, the warnings and the no-token text run without it.
- **Settings.** The command has no `--target`, so it is bound with `lazy`, not `cloud`: it reads the environment and `.env.cloudflare` itself (`readCloudflareSettings`), after the local setup, bootstrap token included. This is DEC-0574's opt-out; `cloud(…, { withBootstrapToken: true })` is not used because it merges only for `--target cloudflare` and prints the git warnings before the local setup has added the `.gitignore` line.
- **Options.** `--email-domain <domain>` answers step 5's question (and wins over `CLOUDFLARE_EMAIL_DOMAIN`, with a note); `--switch-account` confirms the account switch (DEC-0585). Nothing asks on standard input, so the skill and a script run it the same way.
- **Tokens.** Valid and active: `GET /accounts` lists what the token sees; `GET /accounts/<a>/tokens/verify` on each (the recorded account first) finds an account token's owner, else `GET /user/tokens/verify` a user token. A bad paste names the setting, what is wrong, and prints only that token's link (plan §3.4): not accepted by Cloudflare, not active, the same token in both settings, a bootstrap token that cannot read API tokens ("was the everyday token pasted there?"), one lacking bootstrap groups (named), or one of another account. With no token at all it writes the template (`writeTemplateIfAbsent`) and prints plan §3.2's text; with only the bootstrap token, the everyday part.
- **Without the bootstrap token** the run is complete when `checkAccountSetup` (everyday token) is current for `ACCOUNT_SETUP_VERSION` and the quick check passes; otherwise it names each reason (no setup record, older version, other domain, missing steps, failed reads with their status) and prints only the bootstrap link. **With it**, the steps are applied first and the everyday token is then checked; a valid bootstrap token in a run that needs nothing still checks the everyday token once and deletes itself (plan §1: "check exactly once, before deleting").

### DEC-0585 — The account is the everyday token's; several are listed by name only; a switch needs `--switch-account`
Origin: orchestrator, pending owner review · Status: accepted · Affects: `src/provision/cloudflare/{cloudflare-setup,token-sources}.ts`

- **Question.** Plan §4.3 step 4 says "list them and ask", but account IDs may never be printed. **Choice:** the account names, numbered, and how to copy the chosen account's ID from the dashboard into `CLOUDFLARE_ACCOUNT_ID` (setup does not print it). **To reverse:** accept an account name (`--account <name>`) and record its ID.
- **Which token decides.** The everyday token's account (an account token's owner, or the one `CLOUDFLARE_ACCOUNT_ID` names among a user token's). A bootstrap token of another account is the bad paste, with the bootstrap link. **To reverse:** let the bootstrap token decide.
- **Account switch** (plan §3.4): the tokens' account differs from the recorded `CLOUDFLARE_ACCOUNT_ID`. The run explains that the old account's stages keep running and how to remove them with the old everyday token (`npm run remove -- --target cloudflare --stage <stage>`), changes nothing and stops; `--switch-account` goes on with the new account and, at the end, replaces `CLOUDFLARE_ACCOUNT_ID` in the file (`fillInSettings`' new `replace` option, used only here) or, when it comes from the environment, says to change it there. Setup cannot list the old account's stages: its token is gone.
- **Email domain** (step 5): with none set, the account's zone names are listed and the run stops, also when there is only one, since the choice adds DNS records to that zone. No zone: how to add one.

### DEC-0586 — Token checks: denies, account scope, the zone grant form, group meta, and tokens setup cannot read
Origin: ai-proposed (review findings on DEC-0565) · Status: accepted (the zone form not yet verified live) · Amends: DEC-0565 · Affects: `src/provision/cloudflare/{permissions,email-permissions,cloudflare-setup}.ts`

- A `deny` takes away the group it names only, not a weaker one ("Zone Write" denied leaves "Zone Read"). `comparePolicies` reports the denied groups (`denied`); setup cannot fix them in place (an `allow` cannot beat a deny), so it explains and gives the everyday link.
- An account group counts on the account only when the account key's value is `"*"`; an account key holding zones grants only on those zones (also for `setup-account`'s email permission check).
- The in-place update adds the zone groups for the email domain's zone in Cloudflare's documented top-level form `{ "com.cloudflare.api.account.zone.<zone>": "*" }` (developers.cloudflare.com, API token resources), and keeps each existing group's `meta`. Without a zone it still uses the dashboard's nested all-zones form. Verify in the live pass; if Cloudflare refuses it, go back to the nested form.
- The everyday token is judged by the bootstrap token's read of its details. When they cannot be read (a user token, or one of another account), the quick check decides: passed, setup goes on and says the permissions were not read; failed, it gives the everyday link. Zone groups granted only on other zones: "scoped to the wrong zone", the everyday link, no update.

### DEC-0587 — Setup record and account settings review fixes
Origin: ai-proposed (review findings on DEC-0577, DEC-0579) · Status: accepted · Amends: DEC-0577, DEC-0579 · Affects: `src/provision/cloudflare/{setup-steps,setup-record,account-settings,target}.ts`, `src/cli/commands/operations.ts`, `src/provision/public.ts`

- **Bootstrap apply reads directly** (DEC-0579): `applySetupSteps` no longer lets the setup record vouch for a refused read; a refused read stops it, naming the step, before any change.
- **Version wired.** The CLI's Cloudflare operations pass `setupVersion: ACCOUNT_SETUP_VERSION`, so `setup-account` records the release's version.
- **Reported.** A `setup-account` run that only writes the setup record (a raised version) lists "account setup record (setup version N)" with what it created, instead of "nothing changed".
- **Other fields kept.** `writeAccountSettings` keeps every other field of the stored object (DEC-0577); a changed email domain drops only the setup record's fields (`setupVersion`, `frameworkVersion`, `appliedAt`, `completedSteps`), which described the old domain, until the setup writes them for the new one. It reads the object before writing.
- `./provision` exports `PERMISSIONS_VERSION` and `ACCOUNT_SETUP_VERSION`, which `upgrade` reads from a fresh process (DEC-0595).

### DEC-0588 — Exit status, the plan check, and when the bootstrap token is kept
Origin: orchestrator, pending owner review · Status: accepted · Affects: `src/provision/cloudflare/cloudflare-setup.ts`, CLI-REQ-003

- **Exit status.** 0 only when the account is set up, the everyday token current and every host reachable; 1 for every stop that needs the user (no token, choose an account or a domain, the bootstrap token needed, a bad paste, Workers Free, a blocked host) and for a failure; 2 for a usage error. Every stop prints the exact link or command and the next prompt. **To reverse:** return 0 for the stops that only wait for the user.
- **Plan.** Read with the bootstrap token's "Billing Read" (`workersPlanReader`; `PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN` is honoured as there). Workers Free stops before any change. The everyday token cannot read it: such a run reports the plan "not checked" and does not stop; the bootstrap run that set the account up checked it. **To reverse:** record the plan in the setup record.
- **Bootstrap token kept** (not deleted) when the setup steps fail, when the everyday token must be made again (wrong zone or account, a deny, or failing reads it cannot fix), and when the in-place update fails, so the next run can check the new everyday token with it. It is deleted only after the everyday token is confirmed or updated. A bootstrap token without an expiry gets a warning.

### DEC-0589 — Token writes go through a guard; the bootstrap token must be an account token
Origin: owner (plan §1, §4.3 step 7; "never change or delete the owner's token"); the guard's form ai-proposed · Status: accepted · Affects: `src/provision/cloudflare/cloudflare-setup.ts` (`guardTokenWrites`), PAR-361

- Every PUT or DELETE of `/accounts/<a>/tokens/<id>` or `/user/tokens/<id>` by either token passes `guardTokenWrites` before it is sent. Refused: an ID in `protectedTokenIds` (the command's option and PAR-361's environment setting); a DELETE of the everyday token; a DELETE of the bootstrap token outside its own last step; a PUT of any token but the everyday token. Setup's own signing token (the `signing-record` step) is not affected unless protected.
- The self-delete sends `DELETE /accounts/<a>/tokens/<id>` with the bootstrap token and the ID from that token's own `tokens/verify`; the in-place update `PUT`s the everyday token's ID from its own verify call. An everyday token whose ID is protected and lacks permissions is not updated: the run says so and stops.
- A user API token in `CLOUDFLARE_BOOTSTRAP_TOKEN` is refused (it would delete a token the user made for other uses); only an account token, as the bootstrap link makes, is accepted.

### DEC-0590 — Setup output names no account ID, zone ID or subdomain, and redacts any that reach it
Origin: owner (never print a token value, an account ID, a zone ID or the `workers.dev` subdomain); the redaction ai-proposed · Status: accepted · Amends: DEC-0573 · Affects: `src/provision/cloudflare/cloudflare-setup.ts`, PAR-360

- Messages name settings, account names, the email domain and zone names, permission names and HTTP statuses only. The network check names each host by its kind: "the account's R2 storage host (`<account ID>.r2.cloudflarestorage.com`)", "the account's workers.dev subdomain (`<subdomain>.workers.dev`)", with where to change a cloud environment's network access (allow `api.cloudflare.com`, `*.r2.cloudflarestorage.com`, `*.workers.dev`). Any HTTPS answer within PAR-360 counts as reachable.
- **Backstop.** Every line the run prints passes a redaction of each token value, account ID, zone ID, token ID and the subdomain known to the run (`[hidden]`), so a message from a lower layer (for example an API request's "got no response", which names its path) cannot leak one. A subdomain that is part of a printed name is hidden there too. The unit tests check that no run's output needs it.
