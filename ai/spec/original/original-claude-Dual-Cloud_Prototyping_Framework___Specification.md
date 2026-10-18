# Dual-Cloud Prototyping Framework — Specification

Oct 8, 2026 · @Jonathan

## Purpose of this spec

This spec captures the design of a TypeScript framework for AI-written prototype apps that run unchanged locally, on Cloudflare, and on AWS. It records decisions and their rationale so a future AI session can reproduce the design reasoning without the original conversation.

It is not a plan. It defines what to build and why, not task order or estimates. Where a fact was verified against current documentation or by a local test, the verification date is 2026-10-08. Items marked **Unverified** must be checked before implementation.

**Who carries the knowledge.** The owner does not write TypeScript and will not remember platform incompatibilities. Every incompatibility an app could hit must be absorbed by the framework, stated as a rule in the skill, or caught by a static check or the compliance suite. Nothing may depend on the owner knowing it.

Four deliverables are in scope: the framework package, a compliance suite that runs on all three targets, an AI skill that teaches agents to build apps on the framework, and a demo application that uses every feature.

## Motivation

The goal is a common environment for vibe-coded prototypes: an AI writes all application code, and the owner can deploy the same app to Cloudflare or AWS and run it locally. Running on both clouds is a hard requirement. Apps are very low volume, and local semantics only need to be close enough for development.

**Why a framework at all.** No widely adopted option covers both clouds with this capability set:

- Nitric matches the original idea closely (multi-cloud, multi-language, local emulation) but has no Cloudflare target, and its main branch had no commits after 2026-02-05 as of 2026-10-08.
- Container-portable backends (Supabase, PocketBase) fail on Cloudflare because Cloudflare Containers have no persistent disk; persistence requires FUSE-mounting R2.
- Nitro (unjs) deploys to both clouds and has KV and SQL layers, but v3 is still beta, its database layer needs experimental flags, and it has no queue or auth abstraction.
- No mainstream TypeScript library abstracts both Cloudflare Queues and SQS. The only one found with drivers for both (ZinTrust) is a full framework with negligible adoption (single- or low-double-digit weekly downloads per queue package as of 2026-10-08).

**Why it must stay thin.** An AI writes best against components heavily represented in its training data. The framework therefore composes stock, widely used components and owns only the seams between app code and platform. A custom abstraction the AI has never seen would need its documentation in every session; that is what the skill's progressive disclosure is designed to minimize.

**Why TypeScript.** It is the only language that runs first-class on both Cloudflare Workers and AWS Lambda. Python on Workers is less mature, and Java cannot run on Workers.

## Framework summary

The framework is a Hono app plus a service-context middleware that gives every handler `c.var.{sql, kv, files, secrets, user, queue}`, with one adapter per capability per target, deployed by SST. Handlers never import platform APIs.

Targets are `cloudflare` (Workers), `aws` (Lambda), and `local`. Local runs the Cloudflare build under Cloudflare's local runtime (`wrangler dev`, workerd), so there are two adapter sets, not three. Azure, GCP, and non-TypeScript backends are out of scope.

| Capability | Cloudflare | AWS | Local |
| --- | --- | --- | --- |
| Sync HTTP API | Hono on Workers | Hono on Lambda | Hono on workerd (`wrangler dev`) |
| SQL | D1 (SQLite) | Aurora Serverless v2 (Postgres) via RDS Data API, scales to zero | local D1; PGlite for Postgres-dialect tests |
| KV | table in SQL | table in SQL | table in SQL |
| Files | R2 via S3 API | S3 | local R2 with its S3-compatible endpoint |
| Async (webhooks) | Cloudflare Queues + DLQ | SQS + DLQ | local Cloudflare Queues (retries and DLQ emulated) |
| Auth | server-side OIDC code flow, signed session cookie | same | mock login |
| Secrets | Worker secrets | AWS Secrets Manager | `.dev.vars` |
| Static web | same Worker as the API (Workers static assets) | `sst.aws.StaticSite` behind `sst.aws.Router` with the API | Vite dev server proxying `/api` |
| Provisioning | SST v4 | SST v4 | none |

**Build categories.** Every component is one of three kinds:

| Component | Category |
| --- | --- |
| SST, Hono, Drizzle ORM, drizzle-kit, `aws4fetch`, `jose`, wrangler (local runtime), PGlite, Cloudflare Queues, SQS, platform secret managers, SST static-site and router components | Stock |
| Entry points, `createServices`, SQL connection factory, `atomic`, KV, files, secrets accessor, auth routes and middleware, session cookie, webhook verification, queue adapter, idempotency guard, deploy-and-migrate script | Thin wrapper (tens of lines each) |
| Service-context middleware, portable schema helpers and `PortableDb`, SST config template, static checks, compliance suite, AI skill and template repo, demo application | Custom development |

## Settled decisions

These decisions are fixed; a future session should not reopen them without the owner.

| Decision | Rationale |
| --- | --- |
| Language: TypeScript only, client and server | Only language first-class on both Workers and Lambda. |
| Must run on Cloudflare and AWS, plus local | Owner requirement. |
| Volume: under 100 events/hour, peak 10/minute | Prototype scale; justifies folding KV into SQL and simple local emulation. |
| IaC: SST v4 (Pulumi-based), version pinned | One TypeScript config covers both providers; code bundling, resource linking, and stages are built in. Terraform was considered and is viable but needs separate packaging and more wiring. Current release is 4.17.2 (2026-10-08); development has slowed (two commits July–October 2026), so the version is pinned and raw Pulumi providers are the fallback. |
| HTTP: Hono | Web-standard Request/Response; same app runs on Workers, Lambda, Node. |
| SQL: common subset of SQLite and Postgres, accessed only through Drizzle ORM via the portable schema helpers and `PortableDb` handle; enforced by construction, static checks, and tests on both dialects | Lets Cloudflare use D1 directly instead of an external Postgres via Hyperdrive. MySQL excluded (no `RETURNING`, no `ON CONFLICT`, different quoting). |
| AWS Postgres: Aurora Serverless v2 with the RDS Data API and `scaling.min: "0 ACU"` | Standard Postgres, so stock Drizzle driver (`drizzle-orm/aws-data-api/pg`) and migrator work. Lambda reaches it over HTTPS, so Lambda stays outside the VPC and no NAT gateway is needed. Scales to zero; the first request after idle waits up to 15 s while it resumes. Aurora DSQL rejected: Drizzle's migrator runs all statements in one transaction, which DSQL's one-DDL-per-transaction rule forbids. RDS rejected: Lambda would need a VPC and NAT. |
| Local runtime: Cloudflare's `wrangler dev` (workerd) | Emulates D1, R2 (including an S3 endpoint with presigned URLs), and Queues with retries and DLQ, all verified 2026-10-08. Enforces Workers constraints during development. Removes a third adapter set. The Postgres dialect is exercised by running SQL tests against PGlite. |
| One origin for web client and API on both clouds | Session cookies work without CORS or third-party-cookie issues. |
| KV is a table in SQL | Removes a service and an adapter; volume is trivial. |
| Files via the S3 API | R2 is S3-compatible, so one client serves both clouds. |
| Async = Cloudflare Queues and SQS, scoped to enqueue, callback handling, and idempotency | Async exists only to process inbound webhooks. A SQL-plus-cron queue was considered and rejected in favor of native queues. |
| Auth: three levels (anonymous, authenticated, admin); Google first, more OIDC providers by configuration | Admin = authenticated and present in an admin list stored in the secrets manager. Login is a server-side OIDC code flow because Google's token endpoint requires the client secret even with PKCE; the API then issues its own session cookie. |
| Secrets come from platform secret managers | Cloudflare Worker secrets; AWS Secrets Manager; `.dev.vars` locally. |
| Exact local semantics are not required | Low volume; local exists for fast development, not fidelity. |

## Component details

Each component lists its contract, its per-target implementation, and the constraints an implementer must respect.

### Entry points (thin wrapper)

One shared `app.ts` defines the Hono app. Three entry files export it per target:

- Cloudflare: `export default { fetch: app.fetch, queue: queueHandler }`.
- AWS: `handle(app)` from `hono/aws-lambda` for HTTP, plus a separate SQS-triggered Lambda export for the queue consumer.
- Local: the Cloudflare entry, run by `wrangler dev`.

App code must use Web-standard APIs only (fetch, Web Crypto, streams). Workers has CPU-time limits and partial Node API support; code that runs on Lambda can fail on Workers. Because local development runs on workerd, such code fails during development, not after deploy.

### Service-context middleware (custom)

This is the core of the framework. It builds a typed `c.var` containing `sql`, `kv`, `files`, `secrets`, `user`, and `queue` for the current target, so handlers are platform-blind.

- Target is fixed at build time per entry point, not detected at runtime.
- Services are built by a plain `createServices(env)` factory. The Hono middleware calls it for HTTP requests, and the queue shims call it for consumers, which run outside Hono and never see `c.var`.
- On Workers, bindings arrive per request in `c.env`; construct adapters per request (cheap) or memoize per isolate.
- On Lambda, construct once per cold start and reuse across invocations.
- Exports the TypeScript types for `c.var` so handlers get full typing.

### SQL (stock + thin wrapper + custom portable layer)

Drizzle ORM is the query layer. A connection factory returns a Drizzle instance for the target.

- Cloudflare: D1 binding with Drizzle's D1 driver.
- AWS: Aurora Serverless v2 through the RDS Data API with Drizzle's `aws-data-api/pg` driver.
- Local: local D1 under `wrangler dev`. SQL tests also run in-process against PGlite to exercise the Postgres dialect.

**Dual-dialect schema (decided, validated 2026-10-08).** App developers never write SQL; all access goes through the Drizzle ORM.

- `defineTable(name, columns)` builds a `sqliteTable` or `pgTable` for the build target from one declaration, but is always typed as the Postgres table. App code therefore has one table type.
- `c.var.sql` is typed as `PortableDb`: the Postgres Drizzle database type narrowed to `select`, `insert`, `update`, `delete`, `with`/`$with`, and `$count`. On D1 the real handle is cast to this type; method names match. Writes without `.returning()` are typed `Promise<void>`, because their raw results differ by driver.
- drizzle-kit runs once per dialect against the same schema file, with the target passed by environment variable, producing a migration folder per dialect. Migrations are build artifacts and are never hand-edited; the migration checker post-processes them (see Static checks).
- Validation: the same app code produced identical results on PGlite, better-sqlite3, and local D1 for insert/upsert with `RETURNING`, filtered select with order and limit, inner join, group-by count, CTE, update/delete with `RETURNING`, `$count`, and foreign-key enforcement. Generated migrations, including an incremental one, applied on both dialects.

**Portable column types.** These encode the storage rules, so the subset is enforced by construction. Columns are `NOT NULL` unless declared `.nullable()`.

| Type | Postgres | SQLite | Notes |
| --- | --- | --- | --- |
| `id` | `text` primary key | `text` primary key | Value from framework `newId()` (UUID). No auto-increment. |
| `text` | `text COLLATE "C"` | `text` | `C` collation makes sorting match SQLite (Aurora defaults to `en_US.UTF-8`). |
| `integer` | `integer` | `integer` | 32-bit range. |
| `number` | `double precision` | `real` | Postgres `real` is single precision; never used. |
| `timestamp` | `bigint` (number mode) | `integer` | Epoch milliseconds; overflows Postgres `integer`. |
| `boolean` | `boolean` | `integer` (boolean mode) | App sees `true`/`false` on both. |
| `json` | `json` | `text` (json mode) | App sees parsed values on both. Not queryable in SQL. |
| `ref(table)` | `text` + foreign key | `text` + foreign key | |

**Framework query helpers.** The framework itself may use the `sql` template; apps may not.

- `asc(col)` / `desc(col)`: always emit explicit `NULLS FIRST` / `NULLS LAST`, so null ordering matches on both dialects (verified on PGlite and local D1). Drizzle's own `asc`/`desc` are banned in app code.
- `containsText(col, s)`: case-insensitive substring match on both dialects. `like`/`ilike` are banned in app code.
- `atomic(statements[])`: runs built-but-unawaited statements as one unit: `db.batch()` on D1, a transaction on Postgres. D1 rejects interactive transactions, and D1 batches are atomic (both verified on local D1). Branching on intermediate results inside the unit is not supported.

**Common subset rules** (enforced by the portable types, the static checks, and running tests on both dialects):

- Allowed: CRUD, joins, aggregates, subqueries, CTEs, `LIMIT`/`OFFSET`, `ON CONFLICT ... DO UPDATE/NOTHING`, `RETURNING`.
- Forbidden: raw SQL, dialect-specific functions and builder methods, JSON operators, full-text search, enum/array/jsonb types, window functions, transactions other than `atomic`, Drizzle's relational query API (`db.query`).
- Selecting non-aggregated columns that are not in `GROUP BY` works on SQLite and fails on Postgres; the PGlite test run catches it.
- D1 and the local runtime enforce foreign keys by default; nothing to enable.
- SQLite column changes need a table rebuild. Drizzle's generated rebuild uses `PRAGMA foreign_keys=OFF`, which D1 ignores, so the rebuild fails when other rows reference the table. The migration checker rewrites it to `PRAGMA defer_foreign_keys=ON/OFF`, which D1 documents for this case; verified on local D1 with referencing rows present.

### KV (thin wrapper)

A `kv` table: `key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NULL`.

- API: `get(key)`, `put(key, value, { ttlSeconds? })`, `delete(key)`, `list(prefix)`.
- Values are JSON-serialized text. `put` uses `ON CONFLICT (key) DO UPDATE`.
- Expired rows are filtered on read; deletion of expired rows is lazy.

### Files (thin wrapper)

One S3-API client (`aws4fetch`, which runs on Workers and Node) over R2 and S3.

- API: `get(key)`, `put(key, body, { contentType? })`, `delete(key)`, `list(prefix)`, `presign(key, { method, expiresSeconds })`.
- Cloudflare: R2's S3-compatible endpoint with an R2 API token as credentials. The R2 Workers binding is not used, because it cannot presign. Presigned URLs work only on the S3 endpoint domain, not custom domains. The token is created by SST through Pulumi (`cloudflare.ApiToken`; access key = token ID, secret = SHA-256 of the token value), so no manual setup is needed.
- AWS: S3 with the Lambda role's credentials.
- Local: local R2 served on its S3-compatible endpoint (`local_dev.experimental_s3_credentials` in the wrangler config, an experimental flag). Signed and presigned PUT/GET verified 2026-10-08.
- Browser uploads to a presigned URL cross origins, so each bucket gets a CORS rule allowing the site origin: `cloudflare.R2BucketCors` on Cloudflare, bucket CORS on S3. The local endpoint allows every origin, so only the cloud compliance run proves this rule.

### Queue adapter (stock queues + thin wrapper)

Scope is limited to enqueue, callback handling, and idempotency. No polling, visibility-timeout management, ordering, or job-status API.

- `queue.send(body, { delaySeconds? })`: `env.QUEUE.send()` on Cloudflare, SQS `SendMessage` on AWS, an in-memory array locally.
- One normalized handler signature: `handler(msg: { id, body, attempts })`. Return means ack; throw means retry.
- Cloudflare shim: iterate the `MessageBatch`, call `msg.ack()` on success and `msg.retry()` on throw.
- AWS shim: return a partial-batch-failure response listing failed message IDs. The SST queue subscriber sets `batch.partialResponses: true` (off by default).
- Local: local Cloudflare Queues under `wrangler dev`; retries and the DLQ behave as configured (verified: `max_retries: 2` gave three attempts, then the DLQ).
- Retries and dead-letter queues are configured in SST on both clouds, not in code.
- Delivery is at-least-once with no ordering guarantee on both platforms; handlers must be idempotent.
- `queue.send` rejects bodies over 128 KB, the Cloudflare limit (SQS allows 1 MiB). Large payloads go to files, and the message carries the key.

### Idempotency guard (thin wrapper)

Wraps a queue handler. Each message carries an idempotency key, normally the webhook provider's event ID.

- Table `processed_events(key TEXT PRIMARY KEY, processed_at INTEGER NOT NULL)`.
- Before calling the handler, skip if the key exists.
- The handler may read freely, and returns the write statements it wants committed, built but not awaited. The guard appends the `processed_events` insert and runs everything with `atomic()`. A failure commits nothing, so the retry runs cleanly. A concurrent duplicate fails on the primary key and is acknowledged as already processed.
- Side effects outside SQL (such as calling an external API) happen inside the handler before it returns, and must tolerate replay.

### Webhook receiver and verification (thin wrapper)

Flow: read the raw body, verify the signature, enqueue, return 200 immediately. Providers retry or disable slow endpoints.

- HMAC verification via Web Crypto (works on both runtimes) with constant-time comparison.
- One small verifier function per provider; the provider signing secret comes from `secrets`.
- The raw body must be read before any JSON parsing, because signatures cover exact bytes.

### Auth (stock + thin wrapper)

Three levels: anonymous, authenticated, admin. Middleware exposes `requireAuth()` and `requireAdmin()` and sets `c.var.user` (null when anonymous).

- Login runs on the server, because Google's token endpoint requires the client secret even with PKCE (verified 2026-10-08):
  - `GET /api/auth/login?provider=…` redirects to the provider with PKCE and `state`.
  - `GET /api/auth/callback` exchanges the code with the client secret (one POST to the token endpoint found by OIDC discovery), then validates the ID token with `jose`.
  - It sets the app's own session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, HMAC-signed with Web Crypto, holding `issuer`, `sub`, and expiry (default 7 days). No session table.
  - `POST /api/auth/logout` clears the cookie.
- The session is independent of the provider's tokens, so Google's one-hour ID token lifetime does not matter and the browser never holds tokens.
- Providers are a configured list of `{ issuer, clientId }` plus a client secret per provider. Signing keys come from OIDC discovery via `jose`'s remote JWKS. Adding a standards-compliant provider is a config entry. Google ID tokens use either `https://accounts.google.com` or `accounts.google.com` as issuer; accept both.
- The API also accepts `Authorization: Bearer <ID token>` from configured issuers, for scripts and the compliance suite.
- User identity is `issuer + sub`, never email alone. Email alone would let a lookalike account on a weaker provider match an admin entry.
- Admin = authenticated and identity present in an admin-list secret (a JSON array of `issuer|sub` strings). If email matching is ever allowed, require `email_verified`.
- Admin-list changes take effect after the secrets cache expires.
- Local: `/api/auth/login` sets a mock session; a local setting chooses whether that user is admin.

### Secrets (stock + thin wrapper)

Accessor `secrets.get(name): Promise<string>`.

- Cloudflare: Worker secrets via `c.env`.
- AWS: AWS Secrets Manager `GetSecretValue`, cached in memory per Lambda instance with a TTL. Lambda is outside any VPC, so it reaches Secrets Manager directly.
- Local: `.dev.vars` file (wrangler's standard).
- Standard secrets: OIDC client IDs and secrets, session signing key, admin list, webhook signing secrets, R2 credentials.

### Static web (stock)

The web client is TypeScript built with Vite, deployed by SST. The site and the API share one origin on both clouds, so no CORS is needed for API calls and session cookies are first-party.

- Cloudflare: the API Worker also serves the built site through Workers static assets, with `runWorkerFirst: ["/api/*"]` and single-page-application not-found handling. SST's `sst.cloudflare.Worker` has an `assets` argument for this; it is marked internal in SST's source, so if it changes, set the same Worker settings through `transform`.
- AWS: `sst.aws.Router` (CloudFront) routes `/api/*` to the API Lambda's function URL and everything else to `sst.aws.StaticSite` (S3).
- Local: the Vite dev server proxies `/api` to `wrangler dev`.

### Local runtime (stock, configured)

`wrangler dev` runs the Cloudflare entry point with local D1, R2 (S3 endpoint enabled), Queues, `.dev.vars` secrets, and mock auth. The Vite dev server serves the client. `npm run dev` starts both; nothing is deployed and no cloud account is needed. Verified with wrangler 4.149.0.

### SST config template (custom)

One `sst.config.ts` that selects Cloudflare or AWS components by target.

- Provisions per target: compute, SQL database, bucket with CORS rule, queue with DLQ and consumer, secrets, static site, and (AWS) router.
- AWS: `sst.aws.Aurora` with `dataApi: true` and `scaling.min: "0 ACU"`. Aurora requires a VPC, so the template creates an `sst.aws.Vpc` with no NAT gateway; the Lambdas are not placed in it.
- Cloudflare: the R2 API token for S3 access and the `R2BucketCors` rule are raw Pulumi resources, because the SST bucket component has no CORS option.
- Wires bindings, IAM permissions (via SST linking), and environment.
- Uses SST stages for per-developer and per-PR environments.
- SST does not apply database migrations (its D1 component has no migrations option; the Worker's `migrations` option is for Durable Objects). `npm run deploy -- --target <cloudflare|aws>` runs `sst deploy`, then applies pending migrations with Drizzle's migrators: through the D1 HTTP API on Cloudflare, through the Data API on AWS.

## Deliverable 1: framework package

The package is what an app installs to use the framework: capability interfaces, the service-context middleware, and per-target adapters behind separate entry points so a Workers bundle never pulls in AWS SDK code.

**Entry points (subpath exports):**

| Subpath | Contents |
| --- | --- |
| `core` | Capability interfaces (`Kv`, `Files`, `Secrets`, `Queue`, `User`), `PortableDb`, `defineTable` and portable column types, `asc`, `desc`, `containsText`, `atomic`, `newId`, `c.var` types, `createServices` contract, auth routes and middleware (`requireAuth`, `requireAdmin`), session cookie, idempotency guard, webhook verifier helpers, normalized queue-handler type |
| `cloudflare` | Context middleware and adapters for D1, R2 (S3 API), Cloudflare Queues shim, Worker secrets. Also used by `local`. |
| `aws` | Context middleware and adapters for Aurora via Data API, S3, SQS shim, Secrets Manager |
| `local` | Mock login, the wrangler config fragment for local R2 S3 access, and the PGlite test harness |
| `sst` | Helpers the SST config template uses to declare one app's resources for either target |
| `lint` | The static checks: ESLint rules and the migration checker (see Deliverable 3) |

**Public API surface an app sees:**

- `c.var.sql`: a `PortableDb` Drizzle handle, with tables declared through `defineTable` and portable column types; `asc`, `desc`, `containsText`, `atomic`, `newId`.
- `c.var.kv`: `get`, `put`, `delete`, `list`.
- `c.var.files`: `get`, `put`, `delete`, `list`, `presign`.
- `c.var.secrets`: `get`.
- `c.var.user`: `{ issuer, sub, email?, isAdmin } | null`.
- `c.var.queue`: `send`.
- `defineQueueHandler(fn)` and `idempotent(keyFn, fn)` for consumers.
- `requireAuth()` and `requireAdmin()` middleware.
- Per-provider webhook verifiers, starting with a generic HMAC verifier.

**Framework-owned tables:** `kv` and `processed_events`, with migrations in both dialects shipped by the package.

Packaging choices still open: single package with subpath exports vs a small monorepo of packages, npm scope and name, and versioning policy.

**Pinned versions.** The package pins exact versions of Drizzle (the `PortableDb` cast relies on Drizzle's internal types), drizzle-kit, wrangler, and SST. The template repo pins the framework. Upgrades happen in the framework repo, gated by the compliance suite, never inside an app.

## Deliverable 2: compliance suite

The compliance suite is one set of tests, written once, that proves every capability contract holds on `local`, `cloudflare`, and `aws`. It is load-bearing: with three targets, it is the only defense against drift.

**How it runs.** The suite is a reference app built on the framework plus a test runner that drives it over HTTP. The same test code runs against a local server or a deployed SST stage, selected by a base URL and target name. Running in-process against adapters alone is not enough, because bindings, IAM, and event wiring only exist in a real deployment.

- Local: start `wrangler dev` and run the suite. Also run the SQL tests in-process against PGlite, to catch dialect drift.
- Cloud: deploy an ephemeral SST stage per target, run the suite, then remove the stage.
- Async tests poll a test-only status endpoint until the consumer's effect appears or a timeout passes.

**Required coverage:**

| Area | What must be proven |
| --- | --- |
| HTTP | Routing, JSON in and out, error mapping, site and API served from one origin |
| SQL | Migrations apply, including a table rebuild while other rows reference the table; CRUD, joins, CTEs, group-by, `ON CONFLICT`, `RETURNING`, `atomic` behave identically; ordering of mixed-case text and of nullable columns is identical; `containsText` is case-insensitive on both |
| KV | Put/get/delete/list by prefix; overwrite; TTL expiry |
| Files | Put/get/delete/list; content type preserved; presigned GET and PUT work from outside the app; a browser-style presigned PUT from the site origin passes bucket CORS (cloud only) |
| Secrets | Known secret readable; missing secret fails clearly |
| Auth | Login callback sets the session cookie; logout clears it; anonymous blocked from protected routes; valid session and valid bearer token accepted; wrong issuer, wrong audience, expired token or session, and tampered cookie rejected; admin allowed only when in the admin list |
| Webhooks | Valid signature enqueues and returns 200; invalid signature returns 401 and enqueues nothing |
| Queue | Message delivered to the handler; a throwing handler is retried; repeated failure lands in the DLQ; oversized body rejected by `send` |
| Idempotency | Duplicate delivery of the same key produces exactly one effect; a failed first attempt does not block the retry |
| Static checks | A fixture for every rule fails; the allowed-pattern fixtures pass |

**Auth in cloud tests.** Real Google sign-in cannot run unattended. The suite registers a test-only OIDC issuer in the cloud test stages: a minimal provider in the reference app that publishes a JWKS and approves every authorization request. The suite drives the full login redirect and callback against it, and mints bearer tokens with the same key. This also exercises the multi-provider configuration path.

**Output.** A per-target pass/fail report, so a regression on one target is visible immediately.

## Deliverable 3: AI skill

The skill teaches an agent to build apps on the framework while loading only the detail the current task needs. Aggressive progressive disclosure is the primary design constraint: the default context cost should be a short router, with depth available on demand down to complete examples and copyable templates.

**Disclosure layers.** Each layer is read only when the one above points to it for the current task.

| Layer | Content | When loaded |
| --- | --- | --- |
| L0: frontmatter description | One paragraph saying when the skill applies | Always (by the host) |
| L1: `SKILL.md` | Non-negotiable rules and a task router | When the skill triggers |
| L2: capability references | One short file per capability: contract, allowed patterns, forbidden patterns | When the task touches that capability |
| L3: examples | Complete minimal working code for one task each (e.g. a protected CRUD route, a webhook-to-queue flow) | When the agent is about to write that kind of code |
| L4: templates | Copyable files: route, queue handler, webhook verifier, portable table definition, SST resource block | Applied by a scaffolding script, not read into context |

**L1 content.** Kept deliberately small. It holds:

- What the framework is, in two or three sentences.
- Hard rules: use only `c.var` services; never import platform SDKs or bindings in app code; Web-standard APIs only; tables only through `defineTable` and portable column types; queries only through `PortableDb` and the framework helpers; every queue handler wrapped in `idempotent`; webhooks verify then enqueue then return 200; identify users by issuer + sub; never change pinned dependency versions.
- Definition of done: `npm run check` passes (see Static checks). The agent runs it before reporting any task complete, and fixes failures instead of suppressing rules.
- A task router: a short table mapping intents ("add an endpoint", "store data", "handle a webhook", "add an admin page", "deploy") to the L2 file and, where relevant, the L3 example and L4 scaffold command.
- Stop rules: do not read framework source, adapter internals, or other targets' details; if the router does not cover the task, say so rather than exploring. If the agent believes the framework itself is wrong, it writes `FRAMEWORK-ISSUE.md` with a minimal reproduction and stops, rather than working around it in app code.

**Shielding techniques:**

- Every file opens with a one-line "read this when" and ends with "stop here unless", so the agent knows when it has enough.
- Files are small and single-topic, with a size budget per layer enforced by a check in the skill's repo.
- Links only go one layer down; no file links sideways into another capability's detail.
- Templates are applied by scaffold scripts that write files directly, so template text never enters the agent's context unless it opens the generated file.
- App code is platform-blind, so cloud-specific detail lives only in deploy-task references and is never loaded for feature work.
- Deterministic feedback replaces preloaded detail: linter and type errors carry messages that name the exact L2 file to read, so the agent loads guidance only when it violates a rule.

**Static checks.** `npm run check` runs ESLint with the framework rules, the TypeScript type check, the migration checker, and the tests (on local D1 and on PGlite). Each rule's message names the fix and the L2 file. The rules apply to app code; the framework package is exempt.

| Rule | Bans or requires | Use instead |
| --- | --- | --- |
| `no-platform-imports` | Imports of `cloudflare:*`, `node:*`, `@aws-sdk/*`, `sst`, `wrangler`, `drizzle-orm/sqlite-core`, `drizzle-orm/pg-core`, Drizzle drivers, database clients | `c.var` services, `defineTable` |
| `no-env-access` | `process.env`, `c.env`, `import.meta.env` in server code | `c.var.secrets` |
| `no-raw-sql` | `sql` template, `execute`, `.run()`, `.all()`, `.get()`, `.values()` | `PortableDb` query builder |
| `no-dialect-features` | `like`, `ilike`, `notLike`, array and JSON operators, `.for()`, `selectDistinctOn`, Drizzle's `asc`/`desc` | `containsText`, framework `asc`/`desc` |
| `require-explicit-order` | `orderBy(column)` without `asc`/`desc` | framework `asc(col)` / `desc(col)` |
| `no-transactions` | `.transaction()`, `.batch()` | `atomic()` |
| `no-relational-queries` | `db.query.*` | `select` with joins |
| `ids-from-framework` | Hand-made IDs and auto-increment | `newId()` |
| `idempotent-consumers` | Queue handlers not wrapped in `idempotent` | `idempotent(keyFn, fn)` |
| `webhook-verify-first` | Reading a webhook body other than through the framework verifier | per-provider verifier |
| `no-email-authorization` | Using `user.email` in authorization decisions | `requireAdmin()`, `issuer + sub` |
| Migration checker | Rewrites `PRAGMA foreign_keys=OFF/ON` to `PRAGMA defer_foreign_keys=ON/OFF` in SQLite migrations; rejects enum, array, `jsonb`, and other DDL outside the portable types; fails if the two dialects' migration folders disagree on tables or columns | |

**Contents of the skill repo:**

- `SKILL.md` (L1).
- `reference/` with one file per capability: http, sql, kv, files, queue-and-webhooks, auth, secrets, static-site, local-dev, deploy, testing.
- `examples/` with one complete working example per common task.
- `templates/` plus `scripts/scaffold` to apply them.
- A template app repo that is the starting point for every new prototype, pre-wired to the package, linter, compliance hooks, and SST config.

The skill's examples should be exercised by the compliance suite or CI so they never drift from the package.

## Deliverable 4: demo application

The demo is a small, realistic app that uses every framework feature on the happy path and deploys to all three targets. Unlike the compliance suite, it does not call every API or exercise failure paths and corner cases; its job is to show how the pieces fit in a real app and to be the source for the skill's examples.

**Domain: a shared notes board.** Anyone can browse published notes; signed-in users post notes with attachments; an admin moderates and sets a site banner; an inbound webhook turns external events into notes.

| Feature | How the demo uses it |
| --- | --- |
| Static web client | Vite TypeScript SPA: board view, note editor, admin page, Google sign-in |
| Sync API | Hono routes to list, read, create, and delete notes |
| SQL | `notes` and `attachments` tables declared with `defineTable` |
| KV | Per-user display preferences; the admin-set site banner |
| Files | Attachment upload and download via presigned URLs |
| Async API | Webhook endpoint that verifies a signature, enqueues, and returns 200; a consumer creates a note from the event |
| Idempotency | The consumer is wrapped in `idempotent`, keyed on the event ID |
| Secrets | Webhook signing secret, OIDC config, admin list |
| Auth: anonymous | Browse published notes |
| Auth: authenticated | Create notes, upload attachments, save preferences |
| Auth: admin | Delete any note, set the banner |

**Webhook source.** The demo ships a small sender script that signs and posts sample events with HMAC, so the async path can be shown on any target without a third-party account. Adapting the verifier to a real provider is documented as an extension, not built.

**Expectations:**

- Runs locally with one command and deploys to Cloudflare and AWS from the same code, differing only in SST target.
- Contains no platform-specific code outside the framework's entry points and SST config.
- Kept small enough to read in one sitting.
- A short smoke script checks the main user journey on each target; exhaustive checks belong to the compliance suite.
- The skill's L3 examples are excerpts of the demo, so the demo staying green keeps the examples correct.

## Scope, risks, and path to production

**Out of scope:** Azure and GCP targets; non-TypeScript backends; MySQL; queue features beyond enqueue, callbacks, and idempotency (ordering, job status, polling); roles beyond the three auth levels; high-volume operation.

**Known risks:**

- Dual-dialect support is the largest ongoing tax, concentrated in the portable schema helpers and `PortableDb`. Mitigated by the static checks and by running every SQL test on both dialects.
- Workers constraints (CPU time, partial Node APIs) can break code that works on Lambda; local development on workerd surfaces this early.
- Three targets triple the test matrix; the compliance suite must stay green on all three.
- Admin-list changes are delayed by secrets caching.
- SST development has slowed. The version is pinned; if its abstractions leak or break, fall back to its raw Pulumi providers.
- Three dependencies are experimental or internal: wrangler's local R2 S3 endpoint, SST's Worker `assets` argument, and the `PortableDb` cast over Drizzle's internal types. Pinned versions and the compliance suite contain this.
- Aurora's resume after idle delays the first request by up to 15 s on AWS.

**Resolved 2026-10-08** (details are in the component sections): D1 has no interactive transactions and its batches are atomic; one Drizzle query codebase cannot typecheck against both database types, so `PortableDb` exists; Google requires the client secret, so login is server-side; SST does not apply D1 migrations; queue message limits are 128 KB on Cloudflare and 1 MiB on SQS; AWS Postgres is Aurora Serverless v2 with the Data API.

**Unverified items to check before implementation:** these need cloud accounts, and the first cloud compliance run settles them.

- The Data API driver returns the same results as PGlite for every portable operation.
- SST's Worker `assets` argument serves the site and API from one Worker as described.

**Path to production (not designed yet).** Production hardening is mostly additive because the seams are already in the right place:

- Data operations: backups and point-in-time restore, migration discipline, D1 size and throughput limits.
- Authorization: roles stored in the database instead of a secret, session handling, audit trail.
- Observability: structured logs, OpenTelemetry tracing, error reporting, DLQ alerts.
- Security: rate limiting, schema validation on every input, secret rotation, dependency scanning.
- Delivery: CI with per-PR SST stages running the compliance suite.

Production apps rarely need two clouds. The expected path is that each app graduates to a single target, possibly dropping the SQL common subset, while the framework's value shifts from portability to consistent layout, seams, and hardening.
