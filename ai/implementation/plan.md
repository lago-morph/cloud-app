# Implementation plan — local and Cloudflare phase

Governing prompt: `ai/prompts/implement-local-cloudflare.md` (cited below as "prompt §n"). Sources of truth: `docs/` (binding: `*-REQ-*` and `docs/contracts/**` only). This plan is the brief for every subagent; when it disagrees with a binding document, the document wins and the plan must be revised by a planning subagent.

Abbreviations: `FW` = `packages/framework` (package `@lago-morph/prototype-framework`, version `0.1.0`, DEC-0049; `<package>` in the docs). "Read" lists always include `docs/CONVENTIONS.md` and the prompt sections named; they are not repeated per item.

---

## 1. Ground rules for every item

- **Roles are separate subagents** (prompt §7, §8): for any code, the *implementer*, the *test-case author*, the *test runner*, the *evaluator*, a *diagnoser*, and a *root-cause reviewer* are six different subagents. None may be the author of the code under test. Item IDs ending in `-Tn` are test-author items, `-RUN` runner items, `-EV` evaluator items, `-INT` integrator items.
- **Branches:** each item works on `claude/implement-local-cloudflare-<item-id lowercase>` in its own worktree, branched from the current feature branch `claude/implement-local-cloudflare`; it commits and pushes before returning (CLAUDE.md).
- **Before returning**, an implementer rebases on the feature branch, runs the per-item checks of "Test economy" below (not a full `npm run verify`, except where that section requires it), and reports the result. The orchestrator merges only items that report green per-item checks; the full `npm run verify` runs once per merge batch.
- **Ownership:** an item edits only the paths in its "Owns" line, plus its own decision draft (§10.4) and its own root-cause records. Needing to edit anything else = stop and return an open question.
- **Scope:** nothing AWS (no adapters, target, provisioning, or placeholder code that pretends to work); no queues, webhooks, or anything `removed`/`not-adopted` in the decision log; no `prodcheck` or any non-`test-` cloud stage (prompt §4).
- **Docs in sync:** an implementer that changes a design detail updates that component's design doc in the same commit (it owns that doc for the item's duration); contract-file changes (`docs/contracts/**`) need a decision draft and are allowed only to the item named as the contract's owner below.

### Cloud usage limits (binding for every item)

The target apps are low-volume; nothing in this framework needs more than a handful of rows to verify. Phase A spikes wrote about 1.22 million D1 rows in one day against the free plan's 100,000 rows written per day. These rules prevent a repeat:

- **Test data matches the target apps:** tens of rows per test, never generated in loops. A test that must exceed a size limit (e.g. PAR-215 result size) uses one oversized row, not many rows.
- **No stress tests, load tests or platform-limit probing**, on any target, unless a binding requirement names that exact limit; then the smallest test that shows it.
- **Hard caps per item that touches Cloudflare (DEC-0419, owner, 2026-10-23):** ≤ 10,000 D1 rows written and ≤ 500,000 D1 rows read per pass; ≤ 2,000 Cloudflare API requests per pass and never more than 1,000 in any 5-minute window (DEC-0418: Cloudflare's limit is 1,200 per 5 minutes per user, no daily cap; GraphQL analytics 300 per 5 minutes), stop on the first HTTP 429; ≤ 8 D1 databases at once (owner, 2026-10-23; account limit 10, PAR-219). **Whole run:** ≤ 50,000 D1 rows written and ≤ 2,500,000 rows read per UTC day, half of the free plan's 100,000 written / 5,000,000 read. The binding protection is the rule above: no stress tests, load tests or row loops.
- **Measure before and after:** every cloud item measures D1 usage before and after its work with the account's GraphQL analytics (`POST https://api.cloudflare.com/client/v4/graphql`, `d1AnalyticsAdaptiveGroups` summing `rowsRead`/`rowsWritten` for today's date, filtered by `accountTag` = `$CLOUDFLARE_ACCOUNT_ID`; send no Authorization header — the proxy injects it), records both readings in its RESULT/evidence, and stops and reports if it would pass a cap.
- **Estimate before big runs:** before D-RUN, D-RUN-M or F-03, a subagent writes an estimate of D1 rows and Cloudflare API requests per run into that plan item's notes; the run does not start until the orchestrator has checked the estimate against the caps.
- **D1 stop lifted (DEC-0317, DEC-0419):** the owner authorised Cloudflare testing again on 2026-10-23; D1 is used within the caps above. The driver still needs `COMPLIANCE_CLOUDFLARE_D1=available` to run D1-dependent criteria.
- **At most eight D1 databases at once (DEC-0419; supersedes DEC-0318's two):** a schema-changing deploy holds two databases per stage (MIG-REQ-006 copy); the harness cap `MAX_D1_DATABASES` is 8, so passes no longer need to be split for database count.

### Test economy (binding for every item)

Origin: owner · Status: accepted (approved by the owner on 2026-10-20). These rules override any per-item text that asks for more test runs; phase-end runs (`-RUN` items, exit checks) stay as written.

1. **Implementers and fixers** run only: the unit tests related to the files they changed (`vitest related <files>`, or the changed package's unit tests), `npm run typecheck`, `npm run lint`, the integration suite of the component they changed, and the compliance criteria (by ID) their change affects. They run the full `npm run verify` only when they change shared configuration, the build, or root scripts.
2. **Documentation-only items** run typecheck, lint and the skill tests (`tests/skill`). **Test-only items** run typecheck, lint and the tests they changed.
3. **Full `npm run verify`**, online and offline (§10.2), runs once per merge batch, by a test runner on the merged code (on the staging branch first), not per item.
4. **Offline runs per item** only when the item touches the CLI, `dev`, the migration checker, the evidence writer, or network code.
5. **Full compliance suite** runs once at each phase end, after all fixes have landed. Between, only the affected criteria are re-run.
6. **Order-dependence checks** cover only test files with state shared across tests: two shuffled seeds plus each tag run alone; no repeat of the normal order.
7. **Concurrency:** at most 2–3 subagents run test suites at the same time; documentation and read-only work may run alongside them.
8. **Reviewers** (diagnosers, root-cause reviewers) reproduce a failure once, plus one experiment per hypothesis; they repeat a run under load only when timing is the claimed cause.
9. **Background commands:** a subagent keeps at most one background wait at a time, and stops every background command it started (dev servers, scans, wait loops) before reporting.

---

## 2. Phase A — Spikes

Throwaway code only, each spike in `ai/implementation/spikes/<item-id>/` (own `package.json` if needed, never a workspace member). Each writes `ai/implementation/spikes/<item-id>/RESULT.md` (question, exact commands, raw output excerpts with credentials absent, verdict) and a decision draft (§10.4). Cloud spikes name every resource `spike<random8>-…`, remove it before returning, and list any leftover in RESULT.md. Exit for each: RESULT.md answers the question with evidence and the decision draft exists.

| ID | Spike | Read | Decision draft records | Fallback named in design |
| --- | --- | --- | --- | --- |
| A-01 | Cloudflare access and tool auth: run the §10 token-verify curl; find by experiment what makes **wrangler** (PAR-101) and **SST/Pulumi** (PAR-100, PAR-108) work through the proxy with the injected token (env vars needed, whether a non-secret dummy value is accepted and replaced by the proxy, `NODE_USE_ENV_PROXY=1`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`); include SST's Cloudflare state home (PROV §2 "State home") | prompt §10; `docs/components/provisioning.md` §2; `docs/components/cloudflare.md` §2 | Exact working env and invocation per tool; what fails | **none — stop and ask owner** (prompt §10) |
| A-02 | Is a deployed Worker's `workers.dev` address reachable from this sandbox (curl, Node `fetch` with `NODE_USE_ENV_PROXY=1`, and Playwright Chromium)? Deploy a trivial Worker with wrangler, then remove it | prompt §10; `cloudflare.md` §2 | Reachable or not, per client; account `workers.dev` subdomain status | **none — report the refused host to the owner; do not work around** (prompt §10) |
| A-03 | An SST/Pulumi update of a Worker keeps secrets set separately through the Cloudflare API | `cloudflare.md` "Deploy mechanics" | Kept or not; if not, which API mechanism keeps them | **Keep them through the Cloudflare API's handling of a script's existing secret bindings; never store a second copy** (cloudflare.md) |
| A-04 | A stage Worker's `workers.dev` route can be turned off and on via the API without redeploy, and secrets/bindings survive | DEC-0078; `migrations.md` §2 step 1/6; `cloudflare.md` | API calls used; observed state before/after; propagation delay | **none — ask owner** (DEC-0078 is an owner decision) |
| A-05 | D1 HTTP API applies one migration file as one atomic batch prefixed with `PRAGMA defer_foreign_keys = on` (a failing last statement leaves nothing applied) | `migrations.md` §2 "Cloudflare" | Atomic or not; request shape; size limits observed | **none — ask owner** |
| A-06 | D1 export and import produce a full copy (every row and value, incl. NULLs, unicode, large text, FK order) | `migrations.md` §2 "Cloudflare", "Fallback copy" | Copy fidelity; API steps; timings | **Fallback copy: page-by-page table copy, parents first, pages within D1 limits** (migrations.md) |
| A-07 | SigV4-signed R2 S3-endpoint URLs (aws4fetch PAR-105) work for direct browser PUT (with required `Content-Type`) and GET, with a bucket CORS policy limited to one origin; an unrelated origin is refused by the browser; R2 API token creation via `api.cloudflare.com` works and is bucket-scoped | `files.md` §2 (Tickets, Cross-origin, Cloudflare); DEC-0062 | Signing details, CORS policy shape, token-creation API and scope | **none named — ask owner** (files.md §5 mentions a framework upload service only as a portability note) |
| A-08 | Does local D1 (wrangler/Miniflare) enforce D1's bound-parameter and statement-size limits? Compare with remote D1 using the spike's account (SQL-OQ-1) | `sql.md` §6 SQL-OQ-1 | Limits observed locally vs remote | **If local does not enforce them: add a portable limit enforced on every target, one new catalogue code, one new AC (one parameter over D1's limit)** — implemented by B-06 |
| A-09 | The `sql.d.ts` typing approach (restricted Drizzle pg-core types, `Pick<PgDatabase<…>>`) type-checks the sql.md §2.3 CRUD example, incl. `.returning({ id })`, `atomic` tuple typing, and a wrong-type insert failing | `docs/contracts/ts/sql.d.ts`; `sql.md` §2.3 | Works / which declarations need change | **none — ask owner** (contract change) |
| A-10 | Pinned versions (PAR-100…PAR-116) install and work together on Node 22.22: SST 4.17.2 + @pulumi/cloudflare 6.15.0, Wrangler, Drizzle ORM/kit, Hono, aws4fetch, jose, PGlite (also: C collation available), Zod 4.x; pick and record exact PAR-111 (Node, TypeScript, ESLint), PAR-112, PAR-113 (Vite), PAR-114 (Playwright), PAR-116 (test runner and glob) | `docs/parameters/parameters.md` "Dependency pins" | Exact versions; parameter changes for PAR-1xx | **Replace a pin with a compatible version, record it in parameters.md, rerun affected ACs** (parameters.md) |
| A-INT | Integrate phase-A decision drafts into `docs/decisions/decision-log.md` and `docs/parameters/parameters.md` (§10.4) | §10.4 | — | — |
| A-EV | Evaluator: for each spike, does RESULT.md's evidence support the verdict and the decision entry? Did each failed assumption get its named fallback or an owner question? Writes `ai/implementation/evaluations/A.md` | spike RESULT.md files, decision log | — | — |

Dependencies: A-02, A-05, A-06, A-07 need A-01 (and A-08's remote comparison needs A-01). A-03 needs A-01 and A-02's Worker know-how; A-04 needs A-02. A-INT needs all spikes; A-EV needs A-INT. **Phase A exit:** A-EV accepts all ten; any "ask owner" spike that failed is raised to the owner, and the items that depend on it wait. Spike → dependent items: A-01 → D-03, D-05 and every cloud run; A-02 → every cloud run; A-03, A-04 → D-03; A-05, A-06 → D-04; A-07 → D-02; A-08 → B-06; A-09 → B-05; A-10 → B-01.

**Phase A outcomes (A-INT):** decisions DEC-0083…DEC-0109, parameters PAR-216…PAR-219, PAR-117, PAR-118 and the PAR-111…PAR-116 values. Fallbacks applied: A-06 only (fallback copy, DEC-0096). Taken under the owner's "make an assumption and continue" instruction and open for owner review: DEC-0086, DEC-0091, DEC-0096, DEC-0101 (FILES-AC-003 on Cloudflare, §11 Q4), DEC-0103 (revised `sql.d.ts`), DEC-0107…DEC-0109. The items below already reflect these.

---

## 3. Phase B — Local foundation

Component directory map (fixed by B-01; each component's item owns its directory):
`FW/src/{core,http,sql,mig,kv,files,config,secrets,log,auth,google,check,build,targets/local,targets/cloudflare,testing,cli,provision,evidence}/`, public hubs `FW/src/index.ts`, `FW/src/client/index.ts`, `FW/src/testing/index.ts`. Each component exposes its app-facing names from `FW/src/<comp>/public.ts` (browser helpers from `FW/src/<comp>/client.ts`); hubs only re-export. Unit tests are colocated as `FW/src/<comp>/**/*.unit.test.ts` (implementer-owned). In-process integration suites live in `FW/test/integration/<comp>/` (test-author-owned).

### B-01 — Workspace bootstrap
- **Task:** Create the npm-workspace skeleton of cli.md §2 with every workspace's `package.json` (root, `FW`, `apps/template`, `apps/reference`, `apps/demo` (empty stub only), `tests/compliance`) declaring all dependencies at the A-10 pins (DEC-0104; Miniflare PAR-117 only if imported directly and `@cloudflare/workers-types` PAR-118 as a framework dev dependency, DEC-0105; `@pulumi/cloudflare` only if framework code imports it, DEC-0109); generate the single root `package-lock.json`; root scripts `typecheck`, `lint`, `test:unit`, `test:integration`, `test:e2e`, `compliance`, `verify` (stubs that later items wire); `FW/package.json` `exports` map per CORE-REQ-005 with `./targets/local` and `./targets/cloudflare` only (no `./targets/aws` until the AWS phase: "one subpath per supported target"; record a decision) and the package `bin`; base `tsconfig` files (framework lib set; app lib set = ES + Web APIs, no `@types/node`, no workers-types: CHECK §2); `.gitignore` (`.framework/`, `.wrangler/`, `.logs/`, `.dev.vars`, `node_modules`, Playwright output); the component directories above, each with a `public.ts` stub that declares its contract names and throws `not implemented`, so hubs type-check; `FW/src/core/errors.ts` transcribed exactly from `errors.d.ts`; the test-tag helper and test-runner config for the three layers (§10.1); directories `ai/implementation/{decisions,root-causes,evaluations,spikes}/`, `validation/`; copy `ai/implementation/spikes/a-10/scripts/{offline.sh,lo-up.py}` (archived) unchanged to `scripts/` (DEC-0108, §10.2).
- **Read:** `cli.md` §2; `core.md` (CORE-REQ-005, CORE-REQ-006); `check.md` §2; all of `docs/contracts/ts/`; spike A-10 RESULT.md; DEC-0104, DEC-0105, DEC-0108, DEC-0109.
- **Owns:** root `package.json`, `package-lock.json`, root tsconfig/lint/test configs, `scripts/offline.sh`, `scripts/lo-up.py`, all workspace `package.json` files, `.gitignore`, hub files, every `FW/src/<comp>/public.ts` stub, `FW/src/core/errors.ts`.
- **Deps:** A-EV.
- **Exit:** `npm ci && npm run typecheck && npm run test:unit` pass (zero-test runs allowed only here); `node -e` print of `FW/package.json` exports equals the CORE-REQ-005 table minus `./targets/aws`.

After B-01, ownership of a component's `public.ts` passes to that component's item; shared files pass to the integrator (§9.2).

### B-02 — CORE
- **Task:** `defineApp`; deployment identity (app-name rule PAR-290, stage-name rule PAR-291, test-stage flag computed from `test-` prefix) as a build-time value; `Services`/`RequestVars` shapes; `FrameworkError`; the runtime app assembler that each target runtime calls (mount routes under `/api`, middleware order of core.md §2 with pluggable slots for HTTP error handler, LOG writer, services factory, AUTH, forgery check); request IDs; non-`FrameworkError` → `CORE.INTERNAL` with details only to the log; deferred `CORE.MISCONFIGURED` checks on first request.
- **Read:** `core.md`; `core.d.ts`, `errors.d.ts`, `index.d.ts`; DEC-0068.
- **Owns:** `FW/src/core/**`, `docs/components/core.md`, contracts `core.d.ts`, `errors.d.ts`, `index.d.ts`.
- **Deps:** B-01.
- **Exit:** unit tests green; covers in unit form CORE-AC-001 (type fixtures), CORE-AC-003 (identity has only `app`,`stage`), CORE-AC-004 (catalogue completeness scan + plain `Error` → 500 `CORE.INTERNAL`), CORE-AC-007 (name rule; build part with B-15).

### B-03 — HTTP
- **Task:** Error handler (catalogue status, `ErrorResponse`, `HTTP.NOT_FOUND` for unknown `/api`, `HTTP.METHOD_NOT_ALLOWED`); the single HTTP-REQ-007 error log entry for ≥500 (with key/secret name where relevant) and the never-log list; `jsonBody`/`queryParams` with PAR-200 streamed size check; `z` re-export; `Cache-Control: no-store` default; `GET /api/__framework/health`; browser `api` helper and `ApiError` (incl. non-app responses → `HTTP.NETWORK_ERROR` with the exact message).
- **Read:** `http.md`; `http.d.ts`, `client.d.ts`, `framework.openapi.yaml`, `errors.d.ts`.
- **Owns:** `FW/src/http/**` (incl. `FW/src/http/client.ts`), `docs/components/http.md`, contracts `http.d.ts`, `framework.openapi.yaml` (shared with AUTH: AUTH owns `/api/auth/*` paths).
- **Deps:** B-02.
- **Exit:** unit tests green for HTTP-AC-002, -003, -006, -007 behaviours (in-process Hono); HTTP-AC-001 `/api` part.

### B-04 — LOG (local)
- **Task:** `log.write` that never throws and never delays beyond PAR-260; entry builder adding time/app/stage/target/requestId (log-entry schema); local sink = single marked lines on Worker output (DEC-0066); in-memory sink for `createTestApp` with stderr echo of `error` entries; failing and never-completing writer injection for tests; LOG-REQ-005 hooks (`CORE.INTERNAL`, `*.UNAVAILABLE`). The line parser that `dev` uses to append to `.logs/<yyyy-mm-dd>.log` lives here too (B-17 calls it).
- **Read:** `log.md`; `log.d.ts`, `log-entry.schema.json`; `http.md` HTTP-REQ-007.
- **Owns:** `FW/src/log/**` (except `FW/src/log/cloudflare/**`, D-01), `docs/components/log.md`, `log.d.ts`, `log-entry.schema.json`.
- **Deps:** B-02.
- **Exit:** unit tests green for LOG-AC-001 (local), LOG-AC-002 (schema validation).

### B-05 — SQL: schema, column rules, dialect drivers
- **Task:** `defineTable` and column helpers (sql.md §2.1) building Drizzle tables with snake_case casing for SQLite and Postgres; name rules, one `id()`, rejected features; value rules → `SQL.INVALID_VALUE` before the database; drivers for local D1 (Worker binding via Miniflare) and PGlite (PAR-107), dialect chosen per process; `newId`, `now`. Types follow the revised `sql.d.ts` (DEC-0103: `Table<Cols, Name>`, `Column<…, TableName>`, `AnyTable`, framework-declared `sum`/`avg` typed as numbers). The PGlite harness creates its database with `LC_COLLATE 'C'` and `LC_CTYPE 'C'` (DEC-0106).
- **Read:** `sql.md` §1–§2.2; `sql.d.ts`; DEC-0038, DEC-0041, DEC-0050, DEC-0060, DEC-0102, DEC-0103, DEC-0106; spike A-09 (`src/checks.ts` is a ready type-fixture set).
- **Owns:** `FW/src/sql/**`, `docs/components/sql.md`, `sql.d.ts`.
- **Deps:** B-02.
- **Exit:** unit tests green for SQL-AC-001 and SQL-AC-004 on both dialects.

### B-06 — SQL: queries, `atomic`, normalisation, failures
- **Task:** Restricted `PortableDb`/`WriteDb`; `asc`/`desc` with explicit NULLS ordering; `containsText` via `lower()` + position; aggregate normalisation; writes resolve `void`; result-size measurement and `SQL.RESULT_TOO_LARGE` (PAR-215); `SQL.CONFLICT` mapping; `SQL.UNAVAILABLE` with PAR-210 budget (local adapters only; the Data API retry loop is AWS and is **not** built); `atomic` with the built-on-handle check before execution (D1 batch; PGlite transaction). No portable bound-parameter/statement limit: A-08 found local D1 enforces D1's limits (PAR-216, PAR-217) with the same errors, so the A-08 fallback is not applied (DEC-0102); no new catalogue code or AC.
- **Read:** `sql.md` (all); `sql.d.ts`; `errors.d.ts`; DEC-0102, DEC-0103.
- **Owns:** `FW/src/sql/**`, `docs/components/sql.md`, `sql.d.ts`.
- **Deps:** B-05.
- **Exit:** unit tests green for SQL-AC-003, -005, -006 (local parts) on both dialects.

### B-07 — MIG (local) and framework tables
- **Task:** `generate-migration` engine: drizzle-kit (PAR-103) non-interactive for both dialects, refusing drop+add diffs (MIG §2), writing `migrations/{sqlite,postgres}/` and `migrations/checksums.json`; framework migration histories for `__framework_kv` and `__framework_migrations` shipped in the package; in-place application on local D1 and PGlite with the `__framework_migrations` record (framework first, then app); no-op when nothing pending.
- **Read:** `migrations.md` (§1, §2 Generation/Supported changes/Record/Local); `sql.md` §2.1; `check.md` CHECK-REQ-004.
- **Owns:** `FW/src/mig/**` (except `FW/src/mig/cloud/**`, D-04), `FW/migrations/**`, `docs/components/migrations.md`.
- **Deps:** B-06.
- **Exit:** unit tests green for MIG-AC-001 (generation part), MIG-AC-002/-003 local interpretation (in-place apply; a failing migration leaves the local database unchanged — record the local interpretation as a decision).

### B-08 — KV
- **Task:** KV on `__framework_kv` through the SQL adapters: key/value rules (PAR-220, PAR-223), key-range prefix listing, opaque prefix-bound cursor, PAR-221/222 pages, `KV.UNAVAILABLE` mapping.
- **Read:** `kv.md`; `kv.d.ts`.
- **Owns:** `FW/src/kv/**`, `docs/components/kv.md`, `kv.d.ts`.
- **Deps:** B-07.
- **Exit:** unit tests green for KV-AC-001…005 (local parts) on both dialects.

### B-09 — CFG
- **Task:** `configString/Integer/Boolean/StringList`; `ConfigService`; values-file schema validation (stage-config schema, unknown field rejected); per-stage file selection (`config/local.json`, `config/<target>/test.json` for `test-*`, own file otherwise, no fallback); build-time resolution and the generated embedded module (DEC-0063); admin and users lists; secret locations from SEC's convention; `CFG.UNDECLARED_KEY`. A production-stage build does **not** require `framework.google` (deploy preflight checks it, PROV-REQ-002), so fixtures never need a Google client ID.
- **Read:** `config.md`; `config.d.ts`, `stage-config.schema.json`; `secrets.md` SEC-REQ-003; DEC-0063, DEC-0081.
- **Owns:** `FW/src/config/**`, `docs/components/config.md`, `config.d.ts`, `stage-config.schema.json`.
- **Deps:** B-02.
- **Exit:** unit tests green for CFG-AC-001, -002, -004, -006.

### B-10 — SEC (local)
- **Task:** `SecretsService` reading `SECRET_<NAME>` (local `.dev.vars` via the Worker env), `SEC.UNDECLARED`, `SEC.MISSING`, `SEC.UNAVAILABLE`, per-request reuse only; reserved `framework` prefix; framework-internal secret names (session key, Google client secret, R2 credentials, local ticket key); generation of missing dev-only framework secrets into `.dev.vars` without overwriting (called by `dev`); local `setSecret` writer for `secrets set --target local` reading stdin only.
- **Read:** `secrets.md`; `secrets.d.ts`; DEC-0012, DEC-0064.
- **Owns:** `FW/src/secrets/**` (except `FW/src/secrets/cloudflare/**`, D-01), `docs/components/secrets.md`, `secrets.d.ts`.
- **Deps:** B-09.
- **Exit:** unit tests green for SEC-AC-001, SEC-AC-004 (logic), SEC-AC-003 (local location).

### B-11 — FILES (local)
- **Task:** Server operations over the R2 binding (local R2 via Miniflare): names (PAR-230, control characters), list pagination (PAR-231/232), `FILES.INVALID_CURSOR`, `FILES.NOT_FOUND` for download tickets, `FILES.UNAVAILABLE`; local tickets = HMAC-signed same-origin `/api/__framework/files/*` route with expiry PAR-233, op/name/content-type binding, and the nosniff/CSP sandbox/attachment headers; browser `uploadFile` (single PUT, progress, pre-send content-type rejection) and `downloadUrl`; `FILES.TRANSFER_FAILED` messages exactly as FILES-REQ-006. The route and ticket key must be omittable from cloud bundles (CORE-REQ-006).
- **Read:** `files.md`; `files.d.ts`, `client.d.ts`; DEC-0058, DEC-0062.
- **Owns:** `FW/src/files/**` (except `FW/src/files/cloudflare/**`, D-02), `docs/components/files.md`, `files.d.ts`.
- **Deps:** B-03, B-10.
- **Exit:** unit tests green for FILES-AC-001, -002, -004 (type inspection), -006 (server part).

### B-12 — AUTH (mock and stub provider)
- **Task:** Current-user middleware; `requireUser`/`requireAdmin`/`requireCurrentUser`; user-ID derivation (DEC-0067); signed session cookie (PAR-250, PAR-253; `session_local` locally, `__Host-session` + Secure on cloud; cloud builds must reject local cookie settings); transaction cookie (PAR-251); `/api/auth/login|callback|logout|me` incl. `unlistedId`; `returnTo` sanitising; failed-login redirect and fixed-reason log entry; Origin-based forgery check; admin/users lists evaluated per request; authentication mock + `POST /api/auth/mock-login` (test stages/local only); `mockUsers`; test-only stub login provider (`./testing` only); browser `getCurrentUser`/`login`/`logout`.
- **Read:** `auth.md`; `auth.d.ts`, `client.d.ts`, `internal/login-provider.d.ts`, `testing.d.ts`, `framework.openapi.yaml` `/api/auth/*`; DEC-0028, DEC-0067, DEC-0072, DEC-0080.
- **Owns:** `FW/src/auth/**` (incl. `FW/src/auth/client.ts`, `FW/src/auth/testing.ts`), `docs/components/auth.md`, `auth.d.ts`, `internal/login-provider.d.ts`, the `/api/auth/*` paths of `framework.openapi.yaml`.
- **Deps:** B-03, B-09, B-10.
- **Exit:** unit tests green for AUTH-AC-001…004, -006…010, -012 (local parts), AUTH-AC-005 contract-validation part.

### B-13 — GOOGLE (offline)
- **Task:** Google `LoginProvider`: discovery from the fixed well-known URL, PKCE + state + nonce, scope exactly `openid profile`, server-side token exchange with client secret, jose validation (signature, issuer, audience, exp/iat within PAR-252, nonce), never fetching token-supplied URLs. `certify-auth` procedure logic (steps 1–5) as a library function with injectable I/O, so its step-1 check and record writing can be unit-tested offline. Tests use hand-built tokens and a stubbed `fetch`; nothing contacts Google. Test fixtures may use obviously fake client IDs inside test files only (never in `config/**` or docs).
- **Read:** `google.md`; `internal/login-provider.d.ts`; `evidence.schema.json`; prompt §4.
- **Owns:** `FW/src/google/**`, `docs/components/google.md`.
- **Deps:** B-02.
- **Exit:** unit tests green for GOOGLE-AC-001 (local part), -002, -003.

### B-14 — CHECK: portability rules
- **Task:** ESLint rules with type information (`allowed-imports`, `no-env-access`, `browser-api-only`, `no-raw-sql`, `no-dialect-features`, `framework-order`, `no-transactions`, `no-relational-queries`, `framework-ids`, `app-error-codes`), path classification, raw-HTML sink rules for browser code, CHECK-REQ-002 type-escape bans, the shipped config exported from `./check`, detection of app configs that disable/weaken rules, diagnostics naming construct + rule + skill reference. The skill reference names are fixed here in one file `FW/src/check/references.ts`; E-01 must create exactly those files.
- **Read:** `check.md`; `core.md` CORE-REQ-005, CORE-REQ-007; `sql.md` §2.3; DEC-0043.
- **Owns:** `FW/src/check/**` (except `FW/src/check/migrations/**`), `docs/components/check.md`.
- **Deps:** B-02, B-06.
- **Exit:** unit tests green on minimal fixtures for each rule (full fixture suites are B-T4's).

### B-15 — CHECK: migration checker
- **Task:** Apply both histories to fresh local D1 and PGlite, compare introspected schemas; supported-change whitelist with add-copy-drop diagnostics; checksum verification against `migrations/checksums.json`.
- **Read:** `check.md` CHECK-REQ-004; `migrations.md` §2.
- **Owns:** `FW/src/check/migrations/**`.
- **Deps:** B-07, B-14.
- **Exit:** unit tests green for CHECK-AC-004 core cases.

### B-16 — Build pipeline, target runtimes, `createTestApp`
- **Task:** `build --target local|cloudflare --stage <s>` library: generate entry points under `.framework/` from `src/app.ts`; embed identity + resolved config; compose per-target bundles (esbuild/wrangler) that exclude other targets' code, provisioning, tooling, the Postgres harness, and — for cloud — the stub provider, the local transfer route and its key, and — for non-`test-` stages — the mock; `FW/src/targets/local` and `FW/src/targets/cloudflare` runtimes with `createServices(env, deployment)` over D1/R2/env bindings (Cloudflare-specific signing, R2 log writer, Worker vars come in D); `createTestApp` (local D1/R2 through Wrangler's `getPlatformProxy`, DEC-0105, or PGlite per process, migrations applied, mock or stub provider, `unavailable`, `logs()`, `as`, `loginWithStub`, `dispose`). `build --target cloudflare` is needed now because CORE-AC-006, CF-AC-003 and PROV-AC-005 are Local criteria.
- **Read:** `core.md` §2; `local.md`; `cloudflare.md` §1–§2 (Worker settings); `provisioning.md` PROV-REQ-005; `testing.d.ts`; `config.md` §2.
- **Owns:** `FW/src/build/**`, `FW/src/targets/local/**`, `FW/src/targets/cloudflare/**`, `FW/src/testing/**`, `docs/components/local.md`, `testing.d.ts`.
- **Deps:** B-04, B-08, B-11, B-12, B-13.
- **Exit:** unit tests green for CORE-AC-006 (Cloudflare bundle part), CF-AC-003, PROV-AC-005, CFG-AC-002 (build part), CORE-AC-007 (build part).

### B-17 — CLI (local commands)
- **Task:** Package binary with all CLI-REQ-001 commands registered (cloud ones fail with a named missing prerequisite until D-05); implement `dev` (wrangler + Vite proxy on `localhost` loopback only, Host check, migrations, dev-secret generation, `.logs/` capture, clean shutdown), `verify` (typecheck with app lib set, portability rules loaded from the package, migration checker, zod-version check against PAR-112, app tests once per dialect in separate processes, fail on zero tests, deterministic, offline), `generate-migration`, `reset-local`, `build`, `secrets set --target local` (stdin only; rejects a value argument). Honest exit statuses (CLI-REQ-003) and no secret output (CLI-REQ-004). Wire root `npm run verify` = framework typecheck + framework lint + unit tests + `npx <package> verify` in `apps/template` (and `apps/reference` once it exists).
- **Read:** `cli.md`; `local.md`; `check.md` CHECK-REQ-006; `migrations.md` §2; `secrets.md` SEC-REQ-004.
- **Owns:** `FW/src/cli/**` (D-05 later takes `FW/src/cli/commands/{deploy,remove,setup-account,smoke-cloud,certify-auth}.ts`), `docs/components/cli.md`; the root `verify` script line (handed over by the integrator for this edit).
- **Deps:** B-10, B-15, B-16.
- **Exit:** unit tests green for CLI-AC-002 logic, CLI-AC-003 (local commands), SEC-AC-004.

### B-18 — Template app
- **Task:** `apps/template`: smallest app using every capability once (SQL table, KV, a file upload/download via tickets, config key, one secret, log write, access levels), with `src/server/env.ts` per skill.md §2, `src/client/` pages, `src/shared/`, `config/local.json`, `config/cloudflare/test.json`, generated migrations, tests incl. one `tests/smoke/` file usable both in-process and via `connectTestStage`. Exact framework version dependency. README owner tasks are E-02's.
- **Read:** `skill.md` §2 "The template"; `cli.md` §2 App layout; the contracts in `index.d.ts`, `client.d.ts`, `testing.d.ts`.
- **Owns:** `apps/template/**` except `apps/template/README.md`.
- **Deps:** B-16 (code), B-17 (exit check).
- **Exit:** **Phase B exit check** (run by B-RUN): `npm --workspace apps/template run dev` serves the client and `/api` on `http://localhost:<port>` and each capability works through its pages; `unshare -rn` (§10.2) + `npm --workspace apps/template run verify` passes twice with identical results. Covers CHECK-AC-005 (template part).

### Phase B test-case authors (write from contracts and ACs, not from implementation; may start right after B-01)
| ID | Suites (`FW/test/integration/<comp>/`) | Criteria to cover (local parts) | Deps |
| --- | --- | --- | --- |
| B-T1 | core, http, log, config, secrets | CORE-AC-001, -003, -004, -005, -007, -008; HTTP-AC-001…003, -006 (browser test, Playwright), -007; LOG-AC-001, -002, -003, -005; CFG-AC-001, -002, -003 (local), -004, -006; SEC-AC-001…004 | B-01 |
| B-T2 | sql, mig, kv | SQL-AC-001, -003…-006 (local D1 + PGlite; Data API parts excluded); MIG-AC-001…003 (local); KV-AC-001…005 (local) | B-01 |
| B-T3 | files, auth, google | FILES-AC-001, -002, -004, -006; AUTH-AC-001…004, -005 (contract part), -006…-010, -012; CFG-AC-005 (local); GOOGLE-AC-001 (local), -002, -003; E2E-007 (local, in-process per scenario text) | B-01 |
| B-T4 | check, cli, local, build (fixtures in `FW/test/fixtures/**`) | CHECK-AC-001…004, -006; SQL-AC-002; CLI-AC-002; CORE-AC-005, -006 (CF bundle part), -008 (verify part); CF-AC-003; PROV-AC-005; LOCAL-AC-002…004 | B-01 |

Each author owns only its suite directories (B-T4 also `FW/test/fixtures/**`).

### B-RUN, B-EV, B-INT
- **B-RUN:** runs `npm run test:unit` and `npm run test:integration` (framework suites) and the phase-B exit check commands; commits raw output to `validation/local/phase-B/` (archived) (interim; compliance-format evidence comes in C). Deps: B-18, B-T1…B-T4.
- **B-EV:** judges the phase-B exit check from B-RUN's output and the integration results per criterion; writes `ai/implementation/evaluations/B.md` flagging skipped tests, weak assertions, mis-tagged tests.
- **B-INT:** integrates phase-B decision drafts and parameter changes (§10.4); regenerates the lockfile if needed (§9.2). Runs before B-EV signs off.

**Phase B outcomes (B-INT):** decisions DEC-0110…DEC-0243 (drafts of the same decision merged; DEC-0191 superseded by DEC-0197, DEC-0205 by DEC-0242), new PAR-119 (esbuild), PAR-252 note extended. Open for owner review: DEC-0110, DEC-0123, DEC-0134, DEC-0137…DEC-0150, DEC-0179…DEC-0242 (§11 Q5); owner items DEC-0146 (§11 Q6) and DEC-0165 (§11 Q7). What later items now need:
- **Root `verify`** = framework build, typecheck, `lint` (typescript-eslint recommended over `FW/src`, `FW/bin`; DEC-0242), unit tests, template `verify`. C-01 adds `apps/reference`; C-INT may extend lint to `FW/test/**` once its owners clear the seven findings there.
- **Open from B-16 (not re-checked by B-INT):** B-T1's CORE-AC-001 importability test reports `ApiErrorInit (used by ApiError)` missing from `./client`. Fix before B-EV in `FW/src/http/client.ts` (inline the init type; no contract change) or export it from the hub (contract change to `client.d.ts`).
- **C-04:** `smoke` runs Vitest on `tests/smoke/**` with `provide: { prototypeFrameworkSmoke: true }`; the template's smoke file switches to `connectTestStage()` on it (DEC-0207).
- **C-T1/C-T3:** AUTH-AC-007's missing-Origin and deployed-router clauses are tested with raw HTTP against `dev` (and the test stage in D); B-T3 covers only the in-process part (DEC-0230).
- **D-01/D-02:** the Cloudflare runtime's R2 log writer and SigV4 ticket signer are stubs (DEC-0189): Cloudflare entries print marked lines, and tickets fail with `CORE.MISCONFIGURED`. Bindings `DB`, `FILES`, Worker variable `FRAMEWORK_PUBLIC_ORIGIN` (DEC-0190); D-02 issues tickets in the JSON shape of DEC-0160.
- **E-01/E-02:** create exactly the reference files named in `FW/src/check/references.ts` (DEC-0181): `http-and-validation.md`, `sql-and-migrations.md`, `kv.md`, `files.md`, `secrets.md`, `configuration.md`, `current-user.md`, `log.md`, `local-development.md`, `deploying.md`, `testing.md`, `troubleshooting.md`, `owner-tasks.md`; CHECK-AC-003 passes only then.
- **E-02:** the template README says local development needs `npm run secrets -- set apiKey --target local --stage local` (value on stdin) before the admin secret page works; `dev` generates only the framework's own dev keys (DEC-0159, DEC-0204).

---

## 4. Phase C — Local compliance

### C-01 — Reference app
- **Task:** `apps/reference`: routes per capability feature using only public exports; fixtures from compliance.md §2 (plain-`Error` route, log route, two-cookies route, v1/v2 schemas using only MIG §2 supported changes, data fixture incl. files); protected routes per level; a reference route per catalogue code with a status (HTTP-AC-002), routes raising the HTTP-AC-007 codes; a route that throws an error containing the test secret value; a generic "run case" route that executes the shared case sets in `apps/reference/src/server/cases/**`; `config/local.json`, `config/cloudflare/test.json` (no `prodcheck.json`: prompt §4).
- **Read:** `compliance.md`; ACs of every component; `e2e-scenarios.md`; contracts `index.d.ts`, `client.d.ts`.
- **Owns:** `apps/reference/**` except `apps/reference/src/server/cases/**`.
- **Deps:** B-EV.
- **Exit:** `npx <package> verify` passes in `apps/reference`; `dev` serves it.

### C-02 — Compliance driver, evidence, reports
- **Task:** `tests/compliance/harness/`: one command `npm run compliance -- --target <local|cloudflare> [--stage <s>] [--milestone]` that runs the tagged integration and E2E tests for that target, base-URL HTTP client (explicit User-Agent, DEC-0089; `NODE_USE_ENV_PROXY=1` for Node `fetch`, DEC-0085), Playwright setup, multiset comparison, PAR-280 float tolerance, bounded cloud waits; the evidence writer in `FW/src/evidence/` (shared with `smoke`): schema-valid records in `validation/<target>/<runId>.json` + raw output under `validation/<target>/<runId>/raw/`, refusal on a dirty tree, `detail` with status/code/requestId for HTTP failures, `not-run`/`blocked` reasons; test-stage run IDs (CSPRNG, alphabet and length filling PAR-291 after `test-`); leftover hook calling `listStageResources`; traceability report generator (all `*-AC-*`/`E2E-*` IDs in `docs/`, tests, results, untested flagged); release report ("works" rule of COMPL-REQ-006, invalidations from `validation/invalidations.md`, commits touching GOOGLE/login-provider files); per-target expected-criteria list derived from the Where columns, including this phase's not-run rules (§8).
- **Read:** `compliance.md`; `evidence.schema.json`; `e2e-scenarios.md` preamble; prompt §7, §11.
- **Owns:** `tests/compliance/harness/**`, `tests/compliance/tools/**`, `FW/src/evidence/**`, `docs/components/compliance.md`, `evidence.schema.json`, `validation/invalidations.md`.
- **Deps:** B-EV.
- **Exit:** unit tests green for COMPL-AC-002, -003 (local), -006; harness self-test runs one tagged sample test and writes a schema-valid record.

### C-03 — PROV target-neutral core (offline)
- **Task:** `FW/src/provision/core/`: per-target operations interface (PROV §2 table); deploy sequence PROV-REQ-002 steps 1–7 incl. failure reporting (failed step, migration file, DB error, stage state, next action), database discovery by anchored pattern, MIG-REQ-006/-003 orchestration (stop, copy, migrate, check, delete, deploy, start; failure → drop new, restart old), first-Cloudflare-deploy secret check, runner-only abort points; `remove` sequencing and leftover reporting; `setup-account` idempotence and ownership refusal; a fake target for tests. Plus the Cloudflare log-bucket ownership check of `setupAccount` against a stubbed Cloudflare API response, in `FW/src/provision/cloudflare/account.ts` (D-03 extends it).
- **Read:** `provisioning.md`; `migrations.md` §1–§2; `cloudflare.md` "Deploy mechanics"; DEC-0076, DEC-0078, DEC-0079.
- **Owns:** `FW/src/provision/core/**`, `FW/src/provision/cloudflare/account.ts`, `docs/components/provisioning.md`.
- **Deps:** B-EV.
- **Exit:** unit tests green for COMPL-AC-007, PROV-AC-007, CLI-AC-003 (deploy/remove with fake target, incl. failing cleanup keeps original status).

### C-04 — `smoke` and `connectTestStage`
- **Task:** `smoke --target local` against the running `dev` server (and the stage form, completed in D-05); `connectTestStage` (base URL from recorded deploy output or the dev server, explicit User-Agent (DEC-0089), mock-login, cookie jar, `Origin` on state-changing requests, rejects non-`test-` stages, precise failure messages); evidence record via `FW/src/evidence`; prints the stage's log location for the day.
- **Read:** `cli.md` (`smoke`); `testing.d.ts` `connectTestStage`; `log.md` LOG-REQ-003/-004.
- **Owns:** `FW/src/cli/commands/smoke.ts`, `FW/src/testing/connect.ts`.
- **Deps:** C-02.
- **Exit:** CLI-AC-005 local part passes on the template.

### C-05 — Scaffolder (minimal)
- **Task:** `skill/scripts/scaffold`: copies `apps/template` into a new directory, installs the framework from an `npm pack` tarball at an exact version, never overwrites existing files unless explicitly told. Needed now for E2E-001, E2E-003 and LOCAL-AC-001 (Local criteria); the skill text around it is phase E.
- **Read:** `skill.md` SKILL-REQ-005, §2 Layout; `e2e-scenarios.md` E2E-001; DEC-0049.
- **Owns:** `skill/scripts/**`.
- **Deps:** B-EV.
- **Exit:** SKILL-AC-005 passes; a scaffolded app passes `verify` under `unshare -rn`.

### Phase C test-case authors (target-parametrised; same tests later run on Cloudflare: COMPL-REQ-001)
| ID | Owns | Criteria / scenarios |
| --- | --- | --- |
| C-T1 | `tests/compliance/criteria/{core,http,log,config,secrets,cli}/` | CORE-AC-002, -003; HTTP-AC-001…-005 (cloud-only ones written now, run in D); LOG-AC-001, -002, -004, -005; CFG-AC-003…-005; SEC-AC-001…-003, -005; CLI-AC-001, -004, -005 |
| C-T2 | `tests/compliance/criteria/{sql,mig,kv}/`, `apps/reference/src/server/cases/**` | SQL-AC-003…-006 and KV-AC-004 as shared case sets run in-process (D1, PGlite) and through the reference app; MIG-AC-002, -003, -006; KV-AC-001…-005 |
| C-T3 | `tests/compliance/criteria/{files,auth}/`, `tests/compliance/e2e/E2E-009*` | FILES-AC-001…-006 (Playwright for -003, -004, -006 transfer parts; FILES-AC-003 asserted as written, so its expired-ticket clause is expected to fail on Cloudflare per DEC-0101, never skipped or weakened); AUTH-AC-004, -006, -007, -009 (test-stage part); E2E-009 |
| C-T4 | `tests/compliance/e2e/` (except E2E-009) | E2E-001, -003, -004, -005, -010, -011, -012, -013, -014, -016 (scan part; the term list file `tests/compliance/e2e/terms.txt`); E2E-007 cloud part is not-run (§8) |

Deps: C-02 (harness API), C-01 (route names; authors may start from the contracts and agree route names through C-01's route list file `apps/reference/ROUTES.md`).

### C-RUN, C-EV, C-INT
- **C-RUN:** `npm run compliance -- --target local` from a clean tree; also `npm run test:unit`; commits evidence + raw output. Deps: C-01…C-05, C-T1…C-T4.
- **C-EV:** **Phase C exit check:** every criterion and scenario whose Where includes Local is `passed`, or `not-run` under §8, with an evidence record — for the framework components (CORE, HTTP, SQL, MIG, KV, FILES, CFG, SEC, LOG, AUTH, GOOGLE, LOCAL, CF, PROV, CHECK, CLI, COMPL) and E2E-001, -003, -007, -009, -011, -013, -014, -016 (scan). E2E-004 is judged at F-EV (DEC-0391): its coverage part needs DEMO-AC-001…-011 and E2E-002. SKILL-AC-001…-004, CHECK-AC-003 (diagnostics must name *existing* skill references), DEMO-AC-*, CHECK-AC-005 (demo part), E2E-002 (local part) and E2E-015 belong to components built in E/F and are judged at E-EV / F-EV (see Open question 1). Writes `ai/implementation/evaluations/C-local.md`.
- **C-INT:** decision drafts and parameters (§10.4).

**Phase C outcomes (C-INT):** decisions DEC-0244…DEC-0310 from the drafts of C-01…C-05, C-T1…C-T4 and B-T5 (C-T4-7 merged into DEC-0279), plus C-INT's own DEC-0311…DEC-0318. No parameter changes. Corrections: DEC-0311 records the CLI-AC-002 `limit(10).offset(-1)` fixture (DEC-0239's CLI-AC-002 part is superseded; B-EV F11), and DEC-0312 limits DEC-0213's byte identity to entry pages with absolute script URLs. Shared-file fixes: `npm run test:unit` now runs `skill/scripts/**/*.unit.test.ts`; `apps/template/.gitignore` exists and the scaffolder copies it (DEC-0316); `lint` now covers `FW/test/**` (DEC-0315). Open for owner review: §11 Q5; new owner item §11 Q8 (DEC-0314).

---

## 5. Phase D — Cloudflare

Precondition: phase C accepted (prompt §10: all local work before touching the cloud), A-01…A-07 accepted.

### From phase C (C-INT): what each phase-D item must also do
- **D-01:** the R2 log writer's key builder gives an entry without `requestId` a random final part, and a unit test shows it: key ending `-<random>.json`, and two such entries differ. That test is the only evidence for LOG-REQ-004's random-value rule. LOG-AC-004's outside-request clause stays `blocked` until the owner answers §11 Q8 (DEC-0314).
- **D-02:** downloads are saved under the file name (DEC-0313). The Cloudflare download ticket signs R2's `response-content-disposition` with `attachment; filename*=UTF-8''<encoded name>` for every content type, raster images included, and a test confirms R2 honours it on a presigned GET. The local route sends the same `attachment; filename*=…` value, so both targets agree (fix-f04b, superseding the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329; owner review open). D-02 also owns the matching one-line change to the local route, `FW/src/files/local/route.ts`, together with its unit test and `docs/components/files.md`, for this edit.
- **D-03:** implements C-03's `TargetOperations` (`FW/src/provision/core/operations.ts`, DEC-0267) for Cloudflare, together with D-04's database operations. It supplies the real `CloudflareApi` to `provision/cloudflare/account.ts` (DEC-0271). Before `setup-account` relies on the shared log bucket's ownership readings (HTTP 404 absent, 403 foreign, 409 on create foreign; DEC-0270), it **verifies them against the live R2 API**. Until then the leftover check fails, and the failure is recorded as a leftover (DEC-0263).
- **D-05:** after a successful deploy, `deploy` calls `recordDeployOutput(appDir, target, stage, publicOrigin)` from `FW/src/cli/commands/smoke.ts` (DEC-0272). `remove` deletes `.framework/<target>/stages/<stage>.json`. D-05 wires the runner-only `abortAt` option (DEC-0269). It may reuse `provision/core/fake-target.ts` in command tests (DEC-0271). If the driver cannot run a cloud pass without a run stage through `--base-url`, D-05 adds that form (DEC-0318).
- **D-T2:** provides `tests/compliance/criteria/_cloud/index.ts` exporting `cloudHooks(target)` (interface in `tests/compliance/criteria/core/support/stores.ts`), plus `_cloud/logs.ts` (`listLogEntries`) and `_cloud/stage-resources.ts` (`listStageResources`), as DEC-0279 specifies. D-T2 also extends the driver: it takes over `tests/compliance/harness/**` for this edit. On a cloud run the driver generates the reference app's `apiKey` value (≥ 12 letters and digits), sets it on the run stage with `secrets set` (redeploying when the first deploy stops on unset secrets), passes it to the tests as `COMPLIANCE_SECRET_API_KEY`, and redacts it from evidence and raw output (DEC-0277). Without it, the SEC/HTTP/CORE criteria that need the value are `blocked`.
- **E-01 (later):** skill examples load client scripts with absolute URLs, as the template does (DEC-0312).

### D-01 — Cloudflare runtime parts of CFG, SEC, LOG, AUTH
- **Task:** Worker-variable delivery of provisioning-derived config (public origin, bucket/database/log-bucket identifiers; no variable or binding may use the `SECRET_` prefix, DEC-0087); Worker-secret reading; R2 log writer to the shared bucket with `waitUntil` and the LOG-REQ-004 key layout; cloud cookie attributes active in Cloudflare builds; static-asset and run-worker-first settings in the generated Worker config.
- **Read:** `cloudflare.md`; `config.md` §2 Delivery; `secrets.md`; `log.md` LOG-REQ-004; `auth.md` AUTH-REQ-006.
- **Owns:** `FW/src/log/cloudflare/**`, `FW/src/secrets/cloudflare/**`, `FW/src/targets/cloudflare/**`, `docs/components/cloudflare.md`.
- **Deps:** C-EV.
- **Exit:** unit tests green; `build --target cloudflare --stage test-x` bundle still passes CF-AC-003 / CORE-AC-006.

### D-02 — FILES on Cloudflare
- **Task:** SigV4-signed R2 S3-endpoint tickets with aws4fetch using the stage's R2 API token (framework-internal Worker secret), per DEC-0098: path-style URLs, `X-Amz-Expires` = PAR-233, upload tickets signed with `allHeaders: true` so `Content-Type` is signed (default signing lets another content type through), download tickets with `signQuery: true`; S3 credentials derived from the token as DEC-0100; the bucket CORS policy definition of DEC-0099 for provisioning; health-step CORS preflight helper. R2 omits CORS headers on 403, so an expired or mismatched ticket reaches the browser helpers as status null / `no response …`: implement exactly that, no workaround (DEC-0101, open owner item).
- **Read:** `files.md` §2 Cloudflare; spike A-07; DEC-0062, DEC-0098…DEC-0101.
- **Owns:** `FW/src/files/cloudflare/**`; for DEC-0313 only, `FW/src/files/local/route.ts` (+ its unit test) and `docs/components/files.md`.
- **Deps:** C-EV, A-07.
- **Exit:** unit tests green (signing against fixed vectors; offline).

### D-03 — PROV Cloudflare operations
- **Task:** Implement per-target operations for Cloudflare: `setupAccount` (shared `prototype-logs` bucket, state home, `workers.dev` subdomain registration/recording, ownership check), `deploy` via SST built from the app definition (no app IaC; current D1 database as input; never retains resources), `setSecret` (`SECRET_<NAME>`), `stopApp`/`startApp` (workers.dev route off/on), R2 API token create/delete scoped to the stage bucket, `remove` (empty bucket, delete token, delete D1 databases, SST removal; print leftovers, non-zero exit), `listStageResources`; preflight incl. R2-token-creation permission; tool environment per DEC-0107. Spike findings to apply: state home is the `sst-state` R2 bucket and `remove` deletes the stage's state objects there itself, since `sst remove` leaves them (DEC-0084); `setupAccount` reads and records the existing `workers.dev` subdomain (DEC-0086); never pass a binding named `SECRET_*` through SST, which would replace the secret (DEC-0087; optional `keepBindings` guard); `stopApp`/`startApp` always send both `enabled` and `previews_enabled: false` (DEC-0090); a test checks the route state after an SST deploy onto a switched-off route, then `startApp` (DEC-0091; only wrangler was observed); cloud tests poll (bounded) for a newly set secret (DEC-0092); R2 token per DEC-0100.
- **Read:** `provisioning.md`; `cloudflare.md`; spikes A-01, A-03, A-04, A-07; DEC-0036, DEC-0073, DEC-0078, DEC-0083…DEC-0092, DEC-0100, DEC-0107.
- **Owns:** `FW/src/provision/cloudflare/**` except `d1/**`.
- **Deps:** C-EV, A-01, A-03, A-04.
- **Exit:** unit tests green with stubbed Cloudflare API; no cloud calls in unit tests.

### D-04 — D1 database operations and cloud migration
- **Task:** `createDatabase`/`copyDatabase`/`dropDatabase` via the D1 HTTP API. `copyDatabase` always uses the fallback page-by-page copy, never export/import (DEC-0096; pages within PAR-218, PAR-216, PAR-217; values bound by stored type); the account limit of 10 D1 databases (PAR-219) is reported clearly. Apply each migration file as one `/query` request prefixed with `PRAGMA defer_foreign_keys = on`, with the `__framework_migrations` insert in the same request (DEC-0093). Only a JSON 4xx with `success: false` means rolled back; any other error or missing response is ambiguous, so read `__framework_migrations` on the new database before choosing the Failure path (DEC-0094). Tests include a table-level `unique()` and an added foreign key (DEC-0095). The MIG step-4 check (row counts, references, column rules on added columns, record complete); naming `<app>-<stage>-db-<n>`. Update `migrations.md` §2 "Cloudflare" to describe the fallback copy as the Cloudflare copy.
- **Read:** `migrations.md`; spikes A-05, A-06 (`fallback_copy.py` is a working prototype (archived)); `sql.md` §2.1; DEC-0093…DEC-0097.
- **Owns:** `FW/src/provision/cloudflare/d1/**`, `FW/src/mig/cloud/**`, `docs/components/migrations.md`.
- **Deps:** C-EV, A-05, A-06.
- **Exit:** unit tests green against a stubbed D1 API.

### D-05 — CLI cloud commands
- **Task:** Wire `deploy`, `remove`, `setup-account`, `secrets set --target cloudflare`, `smoke --target cloudflare --stage test-…`, `certify-auth` (command present; step-1 check and evidence via B-13 library; it requires a production stage, which this phase never creates), deploy output recording (base URL for `connectTestStage`), public-origin printing, health check + storage CORS preflight; the runner-only deploy abort points (COMPL §2 "Deploy recovery").
- **Read:** `cli.md`; `provisioning.md` PROV-REQ-002; `google.md` §2.
- **Owns:** `FW/src/cli/commands/{deploy,remove,setup-account,secrets-cloud,smoke-cloud,certify-auth}.ts`.
- **Deps:** D-01…D-04, C-04.
- **Exit:** unit tests green; `npx <package> deploy --target cloudflare --stage test-<id>` of the template succeeds once and `remove` leaves nothing (run by D-RUN, not by this item).

### Phase D test-case authors
| ID | Owns | Criteria / scenarios |
| --- | --- | --- |
| D-T1 | `tests/compliance/criteria/{cf,prov}/` | CF-AC-001, -002; PROV-AC-001 (CF part), -002, -003, -004, -006 (CF part, Open question 2); COMPL-AC-004, -008 |
| D-T2 | `tests/compliance/criteria/_cloud/**` | Cloud test hooks used by C-T*/D-T1 tests: direct deletion of a Worker secret (SEC-AC-005, PROV-AC-002), R2 log listing with a read-only R2 token created and deleted by the test (LOG-AC-004, E2E-011), stage-resource probes (CF-AC-002, PROV-AC-003). It does not edit C-T* files; gaps found in them go back to a C-T* follow-up item |

Deps: C-EV.

### D-RUN, D-RUN-M, D-EV, D-INT
- **D-RUN:** `setup-account --target cloudflare` (once; creates billable shared resources); before each stage, check the account's D1 database count against PAR-219 (a schema-changing deploy holds two per stage), so extra stages run one after another; then `npm run compliance -- --target cloudflare` on one `test-<random>` stage plus the per-criterion extra stages; always removes stages; records leftovers. Deps: D-05, D-T1, D-T2. Cloud usage: see §1 "Cloud usage limits" (estimate first; caps and before/after measurement apply).
  - **Not before D1 is available (DEC-0317):** while the owner's D1 stop holds, D-RUN records the D1-dependent criteria `blocked` with the §1 detail and runs nothing on D1.
  - **Estimate (C-T2, for the orchestrator's check):** C-T2's tests alone write about 350 base rows per Cloudflare run (SQL ≈ 65, KV ≈ 157, MIG ≈ 125), up to about 700 counting index entries. They read under 2,000 rows and make about 100–150 Cloudflare API requests (MIG D1 list/query), plus those of `deploy`/`remove` for 2 MIG stages × 3–4 deploys. C-T1's further stage, C-T3, C-T4 and D-T1 add their own. D-RUN completes the estimate for the whole run before starting, keeping each pass ≤ 1,000 rows written and the day ≤ 10,000.
  - **Command sequence per stage (D-05/D-06 reports; DEC-0334, DEC-0348, DEC-0357):** `setup-account --target cloudflare` (once) → `deploy --target cloudflare --stage test-<id>` (the first deploy stops on unset secrets, DEC-0277) → `secrets set apiKey --target cloudflare --stage test-<id>` (value on standard input) → `deploy` again → `smoke --target cloudflare --stage test-<id>` → `remove --target cloudflare --stage test-<id>`. Estimates per step (framework requests counted on the fakes; SST/Pulumi 30–60 per SST run on top, unmeasured): `setup-account` 3 (creating: up to 6); first deploy ≈ 23 + 2 SST runs + `sst install`, ≈ 6 D1 API requests; `secrets set` 1; redeploy ≈ 16 + 2 SST runs, 3 D1 requests; smoke: requests to `workers.dev` only; remove ≈ 20 + 1 SST run; up to ≈ 30 `workers.dev` requests when step 7 retries. **Per stage ≈ 215–370 Cloudflare API requests including SST, < 60 D1 rows written, 1 D1 database.** Each driver leftover check adds about 5 requests.
  - **Start the driver as `NODE_USE_ENV_PROXY=1 npm run compliance -- --target cloudflare …`** (with the real `CLOUDFLARE_API_TOKEN` from the environment, DEC-0420; no placeholder). Node's `fetch` uses the proxy only when the process starts with it; without it the cloud commands exit 1 before any request (DEC-0349) and the leftover check records "leftover check failed" (DEC-0357).
  - **Confirm SST's Worker `assets` option live:** it is `@internal` in SST 4.17.2 (DEC-0356). CF-AC-001 on the first deploy is the check; fallback per DEC-0336 (Worker transform or raw Pulumi).
  - **First, the 11 live checks of DEC-0334** (under 30 API requests through the proxy, no Authorization header; only check 10 needs D1): (1) `GET …/r2/buckets/prototype-logs` → 200; (2) `GET …/r2/buckets/<never-created>` → 404; (3) `POST …/r2/buckets {"name":"prototype-logs"}` while it exists → 409; (4) `GET …/workers/subdomain` → 200 with `result.subdomain` (the absent case and `PUT` are not tried); (5) R2 object listing paging (`result_info.cursor`, `is_truncated`); (6) token listing paging (`result_info.total_pages`); (7) `GET …/workers/scripts/<missing>/secrets` → 404; (8) `…/settings` → 404; (9) `DELETE …/workers/scripts/<name>?force=true` on a stage Worker → 200; (10) the generated SST program on the first deploy (bucket-only `--target Files`, Worker with `DB`/`FILES`/`LOGS`, variables, assets, route `enabled: true, previews_enabled: false`, secrets kept by a later step-3 run, SST accepting the `sst-state` bucket; waits for D1); (11) R2 token creation permission (DEC-0335). Also D-02's live checks (a `x/../y` ticket, DEC-0328; R2 honouring the signed `response-content-disposition`, DEC-0329) and D-04's D1 checks (DEC-0348, after D1 is available). A mismatch is a root-cause item for a follow-up.
  - **Always `blocked` here:** DEC-0270's 403 "foreign" reading cannot be produced with one account (R2 bucket names are per account); PROV-AC-002's restricted-credential clause (the proxy replaces every `Authorization` header, DEC-0335, DEC-0363); PROV-AC-004's "deploy without `setup-account`" clause (needs an account where it never ran, DEC-0364).
  - **Leftover `..` key after `remove` (pass 1 on; DEC-PENDING-fix-pass0-2, root cause `2026-10-23-pass0-F1-…`):** in this sandbox the proxy refuses the API `DELETE …/objects/<key>` for a name with a `..` segment. If `remove` fails naming such a leftover key, the runner deletes it once with a presigned S3 `DELETE`, signed with a temporary R2 token scoped to that bucket only, and deletes the token right after. The runner then runs `remove` once more, and records both steps (the S3 DELETE and its status, the token's creation and deletion, the second `remove`'s result) in the pass's ledger and summary, counted against the request cap. Do not resend the refused API DELETE. When an `api.cloudflare.com` answer is not JSON, log its `Server`, `cf-ray` and `content-type` headers.
  - **Still open before the SEC/HTTP/CORE criteria that need it:** the driver's `apiKey` generation, `secrets set` on the run stage, `COMPLIANCE_SECRET_API_KEY` and redaction (DEC-0277, DEC-0366); no harness file does it yet.
  - **Passes with ≤ 2 D1 databases (DEC-0318):** (1) the main pass, `--only` every expected ID except MIG-AC-002, -003, -006: the run stage plus at most one further stage at a time (C-T1's lock, DEC-0278); (2) after the main stage is removed, the MIG pass, `--only MIG-AC-002,MIG-AC-003,MIG-AC-006`, with no run stage (`--base-url`; D-05 found that no new driver form is needed, DEC-0355). PROV-AC-002 runs in this pass too (it holds two databases, DEC-0361). Its two MIG stages run one after the other, and a schema-changing deploy holds two databases. Check the database count (PAR-219) and D1 usage before each pass.
  - **Pass schedule (2026-10-23):** the cloud estimator wrote this estimate read-only, for the orchestrator's check. It covers every Cloudflare criterion still `blocked` (final-report §6.2, final.md), and it splits the passes above and D-RUN-M where the caps need it. Pass 0 is done: `setup-account` ran, and pass 0 used 38 requests and 0 rows.
    - **Counting basis.** Requests are Cloudflare API requests to `api.cloudflare.com`. R2 S3-endpoint and `workers.dev` requests are not counted. A request count is the framework's requests, counted on the fakes (D-05, DEC-0348, DEC-0399), plus **S per SST/Pulumi run**. S is unmeasured; the worst case is S = 60.
      - Each operation costs:
        - first deploy of a stage: 29 + 2S (it stops on the unset secret after step 5);
        - `secrets set`: 1;
        - redeploy with nothing pending: 19 + 2S;
        - schema-changing deploy: 37 + 2S;
        - deploy failing at step 4: ≈ 38 + S;
        - `remove`: 20 + S.
      - So one stage lifecycle with its secret (deploy, set, deploy, remove) costs 69 + 5S, which is **369 at S = 60**.
      - Other costs:
        - the driver's leftover check: 5;
        - a `stageResourceDetails` probe: 5;
        - the read-only R2 token: 5 per test process that reads `prototype-logs` or `sst-state` (Vitest forks one process per file);
        - `requireDatabaseRoom`: 1;
        - the before/after measurement: 3 per pass (2 GraphQL requests and 1 D1 list).
      - Rows written: a first deploy writes ≤ 50 (DEC-0361). Upper bounds include index entries. Logins write no rows: sessions are signed cookies. Log entries and files go to R2.
    - **Why a kept run stage R.** At S = 60, the driver's own run stage costs ≈ 374 per pass, so no pass that also needs a further stage can fit under 500.
      - So R is deployed once by hand (pass 1), used by passes 1–5 with `--base-url "$R_URL" --stage "$R"` (DEC-0355), and removed in pass 5. The tests get the value from the exported `COMPLIANCE_SECRET_API_KEY` (DEC-0398).
      - In these passes the driver neither redacts the exported value nor runs its leftover check for R. The tests never print the value. Pass 5 keeps `remove`'s own leftover output.
    - **Every pass.**
      - Set the environment: `export NODE_USE_ENV_PROXY=1 CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_DEFAULT_ACCOUNT_ID=<id> COMPLIANCE_CLOUDFLARE_D1=available`, plus `CLI="node <repo>/packages/framework/bin/prototype-framework.js"` and `C="npm run compliance -- --target cloudflare"` (driver from the repo root).
      - Before the pass:
        - take a GraphQL D1 reading;
        - check the `wrangler d1 list --json` count (0 expected, or 1 while R exists);
        - check that `.framework/compliance/pending-stages.json` is empty, because the driver would remove pending stages first, at ≈ 85 requests each.
      - After the pass, take the reading again. Stop if any reading would pass a cap.
    - **Pass 1: deploy R, then R's own criteria.** ≈ 340 requests at S = 60, ≤ 565 rows written, < 2,500 read, peak 1 database.
      - Commands:
        - `npm run build -w packages/framework`;
        - `R=$(node --input-type=module -e "const m=await import('./packages/framework/dist/evidence/run-id.js');console.log(m.testStageName(m.newRunId()))")`;
        - `KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")`;
        - in `apps/reference`: `$CLI deploy --target cloudflare --stage $R` (it stops on `apiKey`), `printf '%s\n' "$KEY" | $CLI secrets set apiKey --target cloudflare --stage $R`, then `$CLI deploy --target cloudflare --stage $R`; `R_URL` is the origin it prints;
        - `export COMPLIANCE_SECRET_API_KEY=$KEY`;
        - `$C --base-url "$R_URL" --stage "$R" --only AUTH-AC-004,AUTH-AC-005,AUTH-AC-006,AUTH-AC-007,AUTH-AC-009,CF-AC-001,CFG-AC-003,CFG-AC-004,CFG-AC-005,COMPL-AC-001,COMPL-AC-003,CORE-AC-002,CORE-AC-003,E2E-004,E2E-005,E2E-009,E2E-011,E2E-013,FILES-AC-001,FILES-AC-002,FILES-AC-003,FILES-AC-004,FILES-AC-005,HTTP-AC-001,HTTP-AC-003,HTTP-AC-004,HTTP-AC-005,KV-AC-001,KV-AC-002,KV-AC-003,KV-AC-004,KV-AC-005,LOG-AC-001,LOG-AC-002,LOG-AC-005,SEC-AC-002,SQL-AC-003,SQL-AC-004,SQL-AC-005,SQL-AC-006`;
        - `$C --milestone --base-url "$R_URL" --stage "$R" --only PROV-AC-004`. This is safe here because nothing deploys meanwhile; a concurrent deploy would change `sst-state` and break its snapshot;
        - E2E-011's troubleshooting check: the two `curl` commands of `skill/reference/troubleshooting.md` §1 for one `throw-plain` requestId on R. This takes 2 requests, and E-EV judges it. It can also go with pass 8.
      - Rows written:
        - R's deploy: ≤ 50;
        - the SQL case set: ≈ 65, ≤ 200 counting index entries;
        - the KV case set: ≈ 157, ≤ 314;
        - everything else: 0.
      - Requests:
        - R: 49 + 4S = 289;
        - R2 tokens for `log/entries`, `secrets/no-leak` and E2E-011: ≈ 15;
        - PROV-AC-004 (2× `setup-account` and 2 snapshots): ≈ 30;
        - the troubleshooting commands and the measurement: 5.
      - Before pass 2, **measure S**: count the first deploy's SST/Pulumi requests in the proxy ledger, as pass 0 did. Then recompute every pass below with the measured S.
    - **Pass 2: the further-stage group, on R.** ≈ 388 requests (369 + secret hooks 6 + 2 R2 tokens 10 + 3), ≈ 55 rows written, ≈ 50 read, peak 2 databases (R + 1).
      - Command: `$C --base-url "$R_URL" --stage "$R" --only SEC-AC-001,SEC-AC-003,SEC-AC-005,HTTP-AC-002,LOG-AC-004,CLI-AC-004`.
      - All six IDs tag tests in `secrets/further-stage.test.ts`. Its `beforeAll` deploys a further reference stage whenever any of them is selected, so none of them can go in pass 1.
    - **Pass 3: CF-AC-002, on R.** ≈ 396 requests (369 + probes 10 + Worker lookups 2 + secret hooks 6 + R2 token 5 + cap check 1 + 3), ≈ 55 rows written, ≈ 30 read, peak 2.
      - Command: `$C --base-url "$R_URL" --stage "$R" --only CF-AC-002`.
      - There is no margin left: skip this pass if the measured S is over 60.
    - **Pass 4: CLI-AC-005, on R.** ≈ 372 requests (369 + 3), ≈ 45 rows written, peak 2.
      - Command: `$C --base-url "$R_URL" --stage "$R" --only CLI-AC-005`.
      - It deploys a further template stage. `smoke` calls `workers.dev` only. The test needs `--stage` for `runDeployment()`.
    - **Pass 5: E2E-014, then remove R.** ≈ 228 requests (1 + 19 + 2S + 5 + 20 + S + 3), ≤ 5 rows written, peak 1.
      - Commands:
        - `$C --base-url "$R_URL" --stage "$R" --only E2E-014`;
        - then, in `apps/reference`, `$CLI remove --target cloudflare --stage $R`. Keep its output under `validation/cloudflare/pass-5/`; `remove` prints any leftovers and then exits non-zero;
        - `unset COMPLIANCE_SECRET_API_KEY KEY`.
      - E2E-014's cloud part sets a new `apiKey` on R and redeploys it, so it must be the last pass on R.
    - **Pass 6: PROV-AC-001, no run stage.** ≈ 373 requests (369 + 1 + 3), ≈ 40 rows written, peak 1.
      - Command: `$C --base-url https://no-run-stage.invalid --only PROV-AC-001`.
    - **Pass 7: COMPL-AC-004, no run stage.** **≈ 481 requests: under the 500 cap, over the 400 aim.** ≈ 50 rows written, ≈ 25 read, peak 1.
      - Command: `$C --base-url https://no-run-stage.invalid --only COMPL-AC-004`.
      - The requests are 118 + 6S:
        - deploy, set, deploy: 289;
        - the driver cleanup's `remove` plus its leftover check: 85;
        - the second cleanup's check: 5;
        - probes: 10;
        - the token's read, put-back and delete: 3;
        - the R2 token: 5;
        - the cap check: 1;
        - `withCloudStage`'s redundant `remove` of the already removed stage: 20 + S.
      - Run it only if the measured S is ≤ 47.
    - **Pass 8: F-03, the demo.** ≈ 382 requests (369 + 2 R2 tokens + 3), ≤ 150 rows written, < 300 read, peak 1.
      - Prerequisites: after F-01/F-02, and after pass 5, so that the demo stage is the only database.
      - Commands:
        - pick `D` as R was picked;
        - in `apps/demo`: `$CLI deploy --target cloudflare --stage $D` (it stops on `shareKey`), then `secrets set shareKey` with the value on standard input, then `deploy` again; `D_URL` is the origin it prints;
        - `$CLI smoke --target cloudflare --stage $D`, `smoke --target local`, and `git diff --quiet HEAD -- apps/demo`. These give the cloud parts of E2E-002, DEMO-AC-010 and E2E-015; on a cloud, `E2E-002.spec.ts` reports `blocked` by design;
        - `COMPLIANCE_DEMO_BASE_URL=$D_URL $C --base-url https://no-run-stage.invalid --only DEMO-AC-001,DEMO-AC-002,DEMO-AC-003,DEMO-AC-004,DEMO-AC-005,DEMO-AC-007,DEMO-AC-009`;
        - then, alone: `COMPLIANCE_DEMO_BASE_URL=$D_URL COMPLIANCE_DEMO_STAGE=$D $C --base-url https://no-run-stage.invalid --only DEMO-AC-008`. It matches `info` entries by time window (W3), and the driver cannot pass `--workers=1`;
        - `$CLI remove --target cloudflare --stage $D`.
      - Rows written: the deploy ≤ 50, plus a handful of posts, photos and preferences per test (≤ 5 photos per post).
    - **Day total for passes 1–8, at S = 60:** ≈ 2,960 requests, ≤ 965 rows written, < 3,500 read; peak 2 databases (passes 2–4).
    - **Cannot fit as written at S = 60.** Each item gives its requests as F + n·S, then (in brackets) the largest S at which it fits 400 / 500. Each runs in a pass of its own with no run stage (`--base-url https://no-run-stage.invalid`, plus `--milestone` for the milestone items) once the measured S allows. Together they would add ≈ 6,150 requests and ≈ 1,240 rows, so the day stays ≤ 2,300 rows written.
      - **MIG-AC-002, -003, -006:** 401 + 17S ≈ 1,420 [never / 5].
        - `--only` cannot split them: the tests in one file depend on earlier tests, across IDs. Block 1 alone is 253 + 10S; its 5 deploys alone take 10 SST runs. The D1 `query` calls cost 2 requests each (list + query), ≈ 130 in all. D1: ≈ 400 rows written, ≈ 1,000 read.
        - **Defect:** on Cloudflare, `beforeAll` runs `secrets set` before the first deploy. That is refused for a Worker that does not exist (DEC-0354), so both blocks fail at once.
        - **Missing guards:** the MIG stage takes neither the further-stage lock nor `requireCloudD1`/`requireDatabaseRoom`. So the earlier "MIG + PROV-AC-002" pass could hold 4 databases.
        - Needs a test change: deploy, then set, then deploy; selection per describe block; fewer redeploys.
      - **COMPL-AC-008:** 286 + 17S ≈ 1,306 [6 / 12]. Its two abort points share the ID. One abort point alone is 140 + 8S or 146 + 9S. Needs a split.
      - **PROV-AC-003:** 174 + 10S ≈ 774 [22 / 32].
      - **E2E-012:** 152 + 10S ≈ 752 [24 / 34].
      - **E2E-010:** 128 + 9S ≈ 668 [30 / 41].
      - **PROV-AC-002:** 153 + 8S ≈ 633, or + 22 + 2S when its secret-hook retry runs [30 / 43]. ≈ 150 rows written, ≈ 200 read.
      - **PROV-AC-006:** 121 + 8S ≈ 601 [34 / 47]. This includes `withCloudStage`'s redundant second `remove`.
    - **Missing guards elsewhere.**
      - E2E `deployStage` (E2E-010, -012, -014) and C-T1's `withFurtherStage` (passes 2 and 4) apply neither `requireCloudD1` nor `requireDatabaseRoom`.
      - The E2E specs also skip the further-stage lock, and Playwright runs spec files in parallel workers. So never select E2E-010 and E2E-012 in one pass.
    - **Loops and probing.**
      - The only test over 50 rows is KV-AC-005's `maxPage`. It loops over PAR-222 = 50 keys with 4 KiB values and deletes them: 100 row writes, ≈ 200 with the key index. The criterion names that limit, so this is allowed.
      - SQL-AC-006 uses one oversized row (PAR-215).
      - No platform-limit probing was found.
    - **Left behind if a pass is interrupted.**
      - R or the demo stage between passes: Worker, D1 database, R2 bucket, R2 token and state objects. Note both names in the pass log, and remove them in pass 5 or pass 8, or by hand.
      - Read-only `compliance-r2read-*` tokens. They expire after 30 min, and the next process sweeps them.
      - COMPL-AC-004's put-back token, if the process is killed.
      - FILES-AC-002's `x/../y` and `../up.txt`, if that test fails before its own cleanup. `remove` cannot delete them through the proxy (pass-0 F-1), so R's bucket would stay. Delete them through the app before pass 5.
    - **Not runnable here.**
      - CLI-AC-001: the driver records the whole criterion `not-run` (Google mocked), and no cloud test exists, although final-report §6.2 lists it as blocked.
      - Always `blocked`: PROV-AC-002's restricted-credential clause, PROV-AC-004's fresh-account clause, LOG-AC-004's outside-request clause (Q8), and DEC-0270's 403 reading.
      - FILES-AC-003's expired-ticket clause is expected to fail on Cloudflare (Q4).
      - E2E-004's pass part: with split passes, the evaluator reads the latest record for each ID (DEC-0264).
- **D-RUN-M:** milestone run `npm run compliance -- --target cloudflare --milestone`: E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006 (CF part), COMPL-AC-008. Deps: D-RUN. Cloud usage: see §1 "Cloud usage limits" (estimate first; caps and before/after measurement apply). DEC-0317 applies. E2E-010 (v1 → v2 on its own stage: 2 databases) and E2E-012 (a kept and a removed stage: 2 databases) each run in a pass of their own with no run stage. The other milestone items run in a separate pass (DEC-0318). COMPL-AC-008 (≈ 420 API requests) runs in a pass of its own after PROV-AC-003, -004, -006 (≈ 380), so no pass exceeds the 500-request cap (DEC-0361).
- **D-EV:** **Phase D exit check:** every automated criterion/scenario with Cloud in Where, except `aws.md` and §8 not-runs, `passed` on Cloudflare with evidence; a test stage removed with no leftovers (COMPL-AC-004 evidence); milestone records present or listed outstanding with reason. E2E-011 on Cloudflare must find the entry "using only commands copied from the skill's troubleshooting reference", which exists only after E-02; it is judged at E-EV. Writes `ai/implementation/evaluations/D-cloudflare.md`.
- **D-INT:** decision drafts and parameters (§10.4).

---

## 6. Phase E — Skill

### E-01 — Skill router, references, examples
- **Task:** `skill/SKILL.md` (≤ PAR-070, hard rules of SKILL-REQ-003 incl. `FRAMEWORK-ISSUE.md` entry contents and next action, task map of SKILL-REQ-002), one reference per topic in skill.md §2 (≤ PAR-071, "read this when" opening, stopping condition), with exactly the reference file names listed in `FW/src/check/references.ts`; examples (≤ PAR-072) taken only from `apps/template` and `apps/reference`, each type-checked and run by CI; `skill/templates/` used by the scaffolder.
- **Read:** `skill.md`; all contracts; `apps/template`, `apps/reference`; DEC-0054, DEC-0056.
- **Owns:** `skill/SKILL.md`, `skill/reference/**` except the three files E-02 owns, `skill/examples/**`, `skill/templates/**`, `docs/components/skill.md`.
- **Deps:** D-EV.
- **Exit:** SKILL-AC-001…-004 tests (E-T1) pass.

### E-02 — Owner tasks, template README, troubleshooting
- **Task:** Copy-and-paste owner steps (SKILL-REQ-006): user ID → `framework.admins` / `framework.users`; `setup-account`; `secrets set`; Google OAuth client setup and callback registration (written, not executed: prompt §4); deploy and remove; reading logs. In both `skill/reference/owner-tasks.md` (or the name in `references.ts`) and `apps/template/README.md`, plus the README's billable-while-idle list. `skill/reference/troubleshooting.md` with per-cloud log commands (LOG-REQ-004 layout), "no log entry" fallbacks, error-code meanings, login failures.
- **Read:** `skill.md` §2; `auth.md` AUTH-REQ-005; `google.md` GOOGLE-REQ-004; `provisioning.md`; `log.md`; spike A-01 (how commands work in practice).
- **Owns:** `apps/template/README.md`, `skill/reference/{owner-tasks,troubleshooting,deploying}.md` (exact names per `references.ts`).
- **Deps:** D-EV.
- **Exit:** E-T1 checks pass; the E2E-011 cloud log lookup is re-run by E-RUN using only these commands.

### E-T1, E-RUN, E-EV, E-INT
- **E-T1:** tests in `tests/skill/`: size budgets, link checks, structure ("read this when"/stopping condition), router task coverage, hard-rule presence, examples type-check and run, no example derived from `apps/demo/`, scaffolder no-overwrite (SKILL-AC-001…-005). Deps: D-EV.
- **E-RUN:** runs `tests/skill`, root `npm run verify`, CHECK-AC-003 (diagnostics name existing references), and re-runs E2E-011 (Cloudflare) on a fresh `test-` stage; records evidence; removes the stage.
- **E-EV:** **Phase E exit check:** SKILL-AC-001…-005 and CHECK-AC-003 `passed`; SKILL-AC-006 `not-run` (§8); E2E-011 cloud re-run passed. Writes `ai/implementation/evaluations/E.md`.

---

## 7. Phase F — Demo

### F-01 — Demo build (fresh agent)
- **Task:** A subagent with no other context builds `apps/demo/` from **only** `skill/`, `apps/template/`, and `docs/demo/demo-spec.md` (E2E-015). It records its model and inputs in `apps/demo/BUILD-RECORD.md`, raises any framework/skill defect in `apps/demo/FRAMEWORK-ISSUE.md` per the skill's rules, writes the demo's tests and smoke test, and passes `verify`.
- **Read:** only the three inputs above.
- **Owns:** `apps/demo/**`, plus the `validation/local/<runId>.json` and `validation/local/<runId>/` that its own `smoke --target local` run writes (commit them with the run's commit).
- **Deps:** E-EV.
- **Exit:** `verify` passes in `apps/demo`, or open `FRAMEWORK-ISSUE.md` entries exist.

### F-02 — Framework-issue loop (repeat per entry)
- For each entry: diagnose (§10.5 record), independent review, fix red-green in the framework or skill (by the owning item's path set), re-run affected tests (runner + evaluator). Then a **new** fresh F-01 agent rebuilds the demo from scratch. Repeat until no entry remains open.

### F-03 — Demo on Cloudflare (runner)
- Deploy the demo to a `test-<random>` Cloudflare stage, run `smoke --target cloudflare`, run the demo smoke locally (`smoke --target local`), confirm no source differences (E2E-002 CF + local parts), run the compliance driver's DEMO-AC-008 cloud check, remove the stage; evidence committed. Cloud usage: see §1 "Cloud usage limits" (estimate first; caps and before/after measurement apply).

### F-04 — Architecture review (E2E-016 review part, milestone)
- An independent reviewer (no code authored in this run) checks: every component doc has a portability note; no capability contract references another capability's adapter; no design adds features beyond its requirements. Records findings in `validation/reviews/E2E-016.md`; findings go through the owning items.
- **Blocking findings and their fixes:** R-01 → fix-f04a, R-06 → fix-f04b, then the F-04 re-review. Both root-cause records are reviewed (agree-with-changes); each fix applies the record's proposed fix **as amended by its Review section**. fix-f04a and fix-f04b touch disjoint paths and may run in parallel.

### fix-f04a — Portability notes in seven component documents (E2E-016 R-01; docs only)
- **Task:** append a `## 5. Portability note` section after §4's table in each of `aws.md`, `check.md`, `cli.md`, `cloudflare.md`, `compliance.md`, `local.md` and `skill.md`, in the style of the twelve existing notes (one to three sentences: what a new target or provider changes in this component, and what stays the same). Use the texts proposed in `ai/implementation/root-causes/2026-10-20-e2e-016-r01-portability-notes.md`, with the Review's corrections: rewrite the `local.md` note (cite `local.md:41-44,48`; drop the "Replacing Wrangler …" sentence; "the app source is the same as on a cloud target (SYS-REQ-001)" instead of "app code cannot tell it from a cloud target"), the `check.md` note (only `allowed-imports`' rejected platform packages and Hono platform modules name platforms), the `cli.md` note ("PROV's per-target operations (PROV §2)"; a new target adds its `--target` value and its build and deploy wiring) and the `compliance.md` note (Where columns select the criteria; per-target expectations only where a criterion states them; a new target's own `prodcheck` stage, values file and component criteria; "Existing tests do not change"). The `aws.md`, `cloudflare.md` and `skill.md` texts stand (optional Review additions allowed). Change nothing else in these documents.
- **Decision** DEC-0413 (decision log, `Item: fix-f04a`): COMPL-REQ-006's "a change to PROV, MIG, CF, AWS, or adapter code" is read as "code" for the whole list, so these docs-only notes invalidate no milestone record and need no `validation/invalidations.md` entry (confirmed by the R-01 Review).
- **Read:** the R-01 record and its Review; the seven documents; `docs/architecture/component-map.md` §1-§2; the existing notes (e.g. `provisioning.md`, `core.md`).
- **Owns:** the new `## 5. Portability note` section (and nothing else) of `docs/components/{check,cli,cloudflare,compliance,local,skill}.md`, borrowed for this edit from their owners B-14, B-17, D-01, C-02, B-16 and E-01, which have finished; and `docs/components/aws.md`, also limited to the new section.
- **Owner of `docs/components/aws.md`: fix-f04a** (no earlier item owned it). Editing it is in scope in this phase: the §1 Scope rule and prompt §4 ban AWS *code* (adapters, target, provisioning, placeholder code), and a portability note is informative design text that builds nothing and describes no behaviour that does not exist (CONVENTIONS §1). The edit is text only; no AWS code, test or config is added or changed.
- **Checks (§1 Test economy rule 2, documentation-only):** `npm run typecheck`, `npm run lint`, `tests/skill`. Plus the mechanical check `for f in docs/components/*.md; do grep -q '^## 5. Portability note' "$f" || echo "$f"; done`, which must print nothing.
- **Deps:** none beyond the reviewed R-01 record.
- **Exit:** checks green; the grep prints nothing.

### fix-f04b — `attachment` on both targets for every download (E2E-016 R-06)
- **Task:** option (a) of `ai/implementation/root-causes/2026-10-20-e2e-016-r06-raster-inline-disposition.md`, red-green, with its Review's changes:
  1. **Red first:** in `FW/src/files/local/route.unit.test.ts`, the parity test "a raster image downloads with the same Content-Disposition on local and Cloudflare": `p.png` as `image/png`; the local route's header and `response-content-disposition` from `createFilesService(...).createDownloadTicket("p.png")` over `createCloudflareTicketIssuer` with fixed dummy credentials (preferred by the Review; it needs no import from `targets/`) must both equal `attachment; filename*=UTF-8''p.png`. It fails today (local `inline; …`).
  2. **Fix:** `FW/src/files/cloudflare/disposition.ts`: `downloadDisposition(name)` always returns `attachment; filename*=…`; remove `RASTER_IMAGES` and `isRasterImage`. `FW/src/files/local/route.ts:46`: `downloadDisposition(grant.name)`, comment at lines 4-6 updated; `nosniff` and `CSP: sandbox` stay. `FW/src/files/cloudflare/tickets.ts`: drop the optional `contentType` of `download`. No change to `service.ts`, `TicketIssuer` or `FW/src/targets/cloudflare/tickets.ts`.
  3. **Tests:** update the four unit tests that pin `inline` for raster images to expect `attachment` (`route.unit.test.ts` valid `image/png` download and the `it.each` jpeg/gif/webp/avif/bmp case; `disposition.unit.test.ts` raster `it.each`; `tickets.unit.test.ts` "a raster image is named inline …"). Keep the non-raster and encoding cases.
  4. **Docs:** `docs/components/files.md` §2 at :65 ("Download names": `attachment; filename*=…` for every content type; drop the inline/DEC-0329 clause), :76 (Local) and :82 (drop the "Raster images means …" sentence). `skill/reference/files.md:39`: replace "raster images (…) are shown inline" with "a download is saved under the file's whole name (`attachment`); show images with `<img src>`".
- **Decision** DEC-0414 (decision log, `Item: fix-f04b`), status line `Origin: ai-proposed · Status: accepted (owner review open)`: supersedes the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329 (reasons: no REQ, contract or AC asks for inline images; it differs by target, which COMPL-REQ-001 forbids; R-06 E9 shows `inline` would break E2E-009's cross-origin download on Cloudflare). It also notes DEC-0313's stale "not yet implemented" status, for the integrator to mark. Listed for the owner in §11 Q5.
- **Read:** the R-06 record and its Review; `files.md` §2; DEC-0313, DEC-0329.
- **Owns:** `FW/src/files/cloudflare/disposition.ts`, `FW/src/files/cloudflare/tickets.ts`, `FW/src/files/local/route.ts` and their unit tests (`disposition.unit.test.ts`, `tickets.unit.test.ts`, `route.unit.test.ts`), all D-02's (DEC-0313 scope); `docs/components/files.md` §2 lines 65, 76, 82 (D-02's); and line 39 of `skill/reference/files.md`, borrowed from E-01 for this one edit.
- **Checks (§1 Test economy rule 1):** `vitest related` on the changed files (covers `disposition`, `tickets`, `route`, `sign` and `service` unit tests); `npm run typecheck`; `npm run lint`; the FILES integration suite (local); compliance criteria by ID on local: **FILES-AC-003, E2E-009, DEMO-AC-003**. No Cloudflare run: the Cloudflare value is already `attachment`; D-RUN's R2 `response-content-disposition` check stays as planned. `tests/skill` also runs, for the skill reference edit.
- **Invalidations:** none needed now (`validation/invalidations.md` is empty and no milestone record exercising FILES downloads exists). If one is recorded before this fix merges, the integrator adds a line for it (COMPL-REQ-006, adapter code).
- **Visible effect:** see §11 Q5 (photo links with `_blank` and the template's `window.open` now download locally).
- **Deps:** none beyond the reviewed R-06 record.
- **Exit:** the parity test was red before the fix and is green after; all checks green.

### F-04 re-review — E2E-016 after fix-f04a and fix-f04b
- **Who:** an independent reviewer who wrote neither fix, neither root-cause record and no code in this run.
- **Task:** re-run E2E-016's three checks on the merged feature branch: check 1 with the grep of fix-f04a (prints nothing) and a read of the seven new notes; check 3 for R-06 (one `attachment; filename*=…` value on both targets; no remaining raster exception in FILES code, `files.md` or `skill/reference/files.md`). Record the resolution of R-01 and R-06 in `validation/reviews/E2E-016.md`, and record the **scope ruling** required by the R-01 Review: `docs/demo/demo-spec.md` is not a component document for check 1 (CONVENTIONS §7 lists `demo/` apart from `components/`; it is an E2E-015 input; its portability is enforced by CHECK and E2E-002), although the component map lists DEMO as a component. The non-blocking findings stay as recorded unless their owners have acted.
- **Owns:** `validation/reviews/E2E-016.md`.
- **Deps:** fix-f04a and fix-f04b merged.
- **Exit:** E2E-016 (review part) recorded with its blocking findings resolved, or new findings routed to owning items.

### fix-registry-2 — Registry-free platform proxy for the migration checker and fake D1 API (follow-up)
- Root cause: `ai/implementation/root-causes/2026-10-20-testing-dev-registry.md` (Review, required change 4). `check/migrations/databases.ts` and `provision/cloudflare/d1/fake-d1-api.ts` start `getPlatformProxy` the same way `createTestApp` did before fix-registry, so they join the machine-wide dev registry.
- **Owns:** `FW/src/testing/test-app.ts` (moves the helper out), a new shared helper under `FW/src/testing/` or `FW/src/targets/local/`, `FW/src/check/migrations/databases.ts`, `FW/src/provision/cloudflare/d1/fake-d1-api.ts`, their unit tests, and the core.md sentence the record proposes. `FW/src/cli/dev/*` keeps the registry (normal `wrangler dev` behaviour).
- Red-green: one red test per caller (`fake-d1-api.ts` first), using the scratch-registry pattern of fix-registry. Checks per §1 rule 1, plus the migration-checker offline run (rule 4).

### F-EV — Final evaluation
- Judges DEMO-AC-001…-011 (local + Cloudflare; AWS parts not-run), CHECK-AC-005 (demo), E2E-002, E2E-004 (moved from C-EV, DEC-0391), E2E-015, E2E-016; then produces the full per-target status table of every `*-AC-*` and `E2E-*` (local, cloudflare, aws), confirming the §8 not-run lists, in `ai/implementation/evaluations/final.md`, and the generated release report (which must say "not working": AWS and Google certification outstanding, prompt §11).

---

## 8. Not-run rules (for every evaluator)

### 8.1 Google mocked (detail: "Google login mocked for this phase")
From prompt §4: GOOGLE-AC-001 (cloud part: certification step-1 check against a production deployment), GOOGLE-AC-005; AUTH-AC-005 (admin-list part), AUTH-AC-009 (cloud production part), AUTH-AC-011; COMPL-AC-005; SKILL-AC-006; E2E-006, E2E-007 (cloud part), E2E-008.
Added by the planner for the evaluator to confirm: **CLI-AC-001** (`certify-auth` on cloud: needs a production stage with a Google client).
Added for the evaluator to confirm (fix-auth005; root cause `2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test`): **AUTH-AC-005 contract part: successful callback (needs a real login provider)** on cloud. A test stage has the mock and no real provider (DEC-0171), so the 302 to `returnTo` with a session cookie first exists on `prodcheck` with Google. The rest of the contract part runs on cloud (`tests/compliance/criteria/auth/contract.test.ts`); locally the successful callback is covered in-process with the stub provider.

### 8.2 AWS (detail: "AWS phase not started")
- All of AWS-AC-001…-006.
- The AWS run of every criterion whose Where says cloud (each cloud criterion is recorded for `aws` as not-run).
- AWS parts of criteria otherwise run here: CORE-AC-002 (AWS start), CORE-AC-006 (AWS bundle part), SQL-AC-003/-004/-005/-006 (Data API results; SQL-AC-006's Data API retry loop, whose adapter is AWS code and is not built), KV-AC-004 (AWS), SEC-AC-003 (IAM simulation), LOG-AC-001 (AWS deny case), PROV-AC-001 (AWS deploy), PROV-AC-006 (region part, Open question 2), E2E-002 (AWS stage), E2E-004 / E2E-009 / E2E-011 / E2E-013 / E2E-014 (AWS runs), DEMO-AC-010 (AWS).

### 8.3 Milestone items (COMPL-REQ-006)
Run in this phase: E2E-010, E2E-012, PROV-AC-003, PROV-AC-004, PROV-AC-006 (CF part), COMPL-AC-008 (D-RUN-M); E2E-015 (F); E2E-016 review (F-04). Outstanding with reason: GOOGLE-AC-005, E2E-007 cloud, E2E-008, SKILL-AC-006, AUTH-AC-005 admin-list (Google mocked); all AWS runs.

---

## 9. Parallelism and serialisation

### 9.1 Waves (items in one wave touch disjoint paths)
| Wave | Items |
| --- | --- |
| A1 | A-01, A-09, A-10 |
| A2 | A-02, A-05, A-06, A-07, A-08 |
| A3 | A-03, A-04 → A-INT → A-EV |
| B1 | B-01 (alone) |
| B2 | B-02, B-T1, B-T2, B-T3, B-T4 |
| B3 | B-03, B-04, B-05, B-09, B-13 |
| B4 | B-06, B-10 |
| B5 | B-07, B-11, B-12, B-14 |
| B6 | B-08, B-15 |
| B7 | B-16 |
| B8 | B-17, B-18 → B-RUN → B-INT → B-EV |
| C1 | C-01, C-02, C-03, C-05 |
| C2 | C-04, C-T1, C-T2, C-T3, C-T4 → C-RUN → C-INT → C-EV |
| D1 | D-01, D-02, D-03, D-04, D-T1, D-T2 |
| D2 | D-05 → D-RUN → D-RUN-M → D-INT → D-EV |
| E1 | E-01, E-02, E-T1 → E-RUN → E-INT → E-EV |
| F | F-01 → (F-02 loop) → F-03, F-04 → (fix-f04a, fix-f04b in parallel) → F-04 re-review → F-EV |

Test authors in B2 run until their suites are complete; their suites are expected to fail until the implementation lands (red is fine; they must not be skipped).

### 9.2 Shared files and how they are serialised
- **Root `package.json`, workspace `package.json`s, `package-lock.json`, root configs:** created complete by B-01. Afterwards an item may add a dependency only to its own workspace's `package.json` and only at a version already pinned in parameters.md (or via a decision draft). The lockfile is **never hand-merged**: on a merge conflict, the orchestrator hands the merge to an ad-hoc integrator subagent (`<phase>-INT`), which takes the feature branch's lockfile and runs `npm install` to regenerate, then commits.
- **Hub files** (`FW/src/index.ts`, `client/index.ts`, `testing/index.ts`) and `FW/package.json` exports: B-01 writes them once; later changes only by the integrator on request.
- **`FW/src/core/errors.ts` and `errors.d.ts`:** B-02 owns (SQL-OQ-1 needed no new code, DEC-0102).
- **`framework.openapi.yaml`:** HTTP (B-03) owns non-auth paths; AUTH (B-12) owns `/api/auth/*`. They run in different waves.
- **`docs/decisions/decision-log.md`, `docs/parameters/parameters.md`:** only `-INT` items edit them (§10.4).
- **Component design docs:** owned by that component's current item; at most one item per doc per wave (as assigned above).
- **`FW/src/cli/**`:** B-17 owns; C-04 and D-05 own only their named command files.

---

## 10. Conventions for implementers

### 10.1 Test layers and commands (root)
- `npm run test:unit` — `FW/src/**/*.unit.test.ts` and tool unit tests; no network; red-green TDD per behaviour (prompt §6).
- `npm run test:integration` — `FW/test/integration/**` in-process with real local dependencies (Miniflare/workerd D1, R2; PGlite; local file system), plus `tests/compliance/criteria/**` against `--target` (default `local`).
- `npm run test:e2e` — `tests/compliance/e2e/**` against `--target`.
- `npm run compliance -- --target <t> [--stage <s>] [--milestone]` — runs the integration + E2E layers for the target (on local also the unit layer, for the unit-level criteria of §10.3 only; DEC-0319) and writes evidence.
- `npm run verify` — framework self-checks plus `npx <package> verify` in `apps/template` and `apps/reference`. Run once per merge batch by a test runner, and per item only as §1 "Test economy" allows; items run the per-item checks listed there.
- The test runner and file glob are PAR-116 (chosen by A-10).

### 10.2 Offline runs
"No network" runs use a network namespace: `unshare -rn sh scripts/offline.sh <command…>` (DEC-0108; before B-01 copied it, `ai/implementation/spikes/a-10/scripts/offline.sh` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md)). `ip` is not installed in this sandbox, so the wrapper brings loopback up (needed for `dev`/workerd) through `lo-up.py`. Never simulate offline by unsetting `HTTPS_PROXY` or disabling TLS.

### 10.3 Tagging
- Every integration/E2E test title starts with its IDs in brackets: `[KV-AC-001] put, overwrite, get …`; several: `[SQL-AC-003][KV-AC-004] …`. A test covering only part of a criterion says which clause in the title after the tag. Unit tests may carry tags but do not count as evidence on their own unless the criterion is a unit-level criterion (e.g. GOOGLE-AC-002, COMPL-AC-002/-007).
- Only the regex `\[((?:[A-Z]+-AC|E2E)-\d{3})\]` is parsed by the traceability generator. Do not tag a test with an ID it does not check.
- Never skip, delete or weaken a test to get a pass (prompt §8).

### 10.4 Decisions and parameters
- Each item writes its decisions to `ai/implementation/decisions/<item-id>.md`, one entry per decision, in the decision-log format with a placeholder ID:
  ```
  ### DEC-PENDING-<item-id>-<n> — <title>
  Origin: ai-proposed · Status: accepted · Affects: <IDs, docs>

  <decision, reason, evidence path; for spikes: result and fallback applied>
  ```
  and a "Parameter changes" section (`PAR-nnn: old → new, reason`, or new PAR entries).
- Design docs edited in the same item may cite `DEC-PENDING-<item-id>-<n>`.
- The phase's `-INT` item numbers pending entries sequentially from the next free `DEC-` ID, appends them to `docs/decisions/decision-log.md` under a heading for this implementation phase, replaces every `DEC-PENDING-…` reference repo-wide, applies parameter changes to `docs/parameters/parameters.md`, and replaces each draft file's content with a list of the assigned IDs. Never edit `owner` entries; never renumber or reuse IDs.

### 10.5 Evidence, root causes, evaluations
- Evidence records: `validation/<target>/<runId>.json` (schema `evidence.schema.json`) with raw output in `validation/<target>/<runId>/raw/`; committed by the runner, never by implementers.
- Root-cause records: `ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md` with sections Symptom, Evidence, Causal chain (evidence per link), Alternatives ruled out, Proposed fix, Verification plan, and Review (verdict + reasons, written by the reviewer). No "probably/flaky/timing" without evidence.
- Evaluator verdicts: `ai/implementation/evaluations/<phase>[-<target>].md`.

### 10.6 Credentials and Cloudflare (prompt §10)
- **Never print, log, or commit a credential value** — including in RESULT.md, evidence, raw output, and root-cause records. Redact before committing raw output; the runner scans for test secret values (CLI-AC-004, SEC-AC-002).
- **Credentials (DEC-0420, owner, 2026-10-24):** the proxy no longer injects a token for `api.cloudflare.com`; the owner put a real API token in the environment as `CLOUDFLARE_API_TOKEN`. Tools (wrangler, SST, the framework, curl with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`) use it directly. **Never set `CLOUDFLARE_API_TOKEN=placeholder` any more** (that overrides the real token), and never print, log or commit its value; grep evidence for it before committing. Account ID: `$CLOUDFLARE_ACCOUNT_ID`. (Earlier: the proxy replaced every Authorization header, which made Workers static-asset uploads fail with 401, pass 1b.)
- Node `fetch` needs `NODE_USE_ENV_PROXY=1`; CA bundle `/root/.ccr/ca-bundle.crt`. Proxy problems: `/root/.ccr/README.md`, `curl -sS "$HTTPS_PROXY/__agentproxy/status"`.
- R2's S3 endpoint `<account>.r2.cloudflarestorage.com` uses the framework-created R2 token. A host refused by the proxy (403 / failed CONNECT) is reported to the owner, never worked around.
- Never invent credentials (no placeholder Google client IDs in `config/**`, docs or deployed stages).
- Non-browser clients calling `workers.dev` set their own User-Agent; Cloudflare refuses some default ones with 403 / error 1010 (DEC-0089).
- The account's `workers.dev` subdomain contains the owner's name: it is personal, not secret. Redact it in every committed artefact (RESULT.md, evidence, raw output); it is computed at run time (DEC-0086).
- The account allows at most 10 D1 databases (PAR-219), shared with every other stage and spike; remove promptly and check before creating more.
- Cost: create only what the item needs; names start with `test-` (stages) or `spike` (spikes); remove after use; report anything left billable (shared `prototype-logs` bucket and SST state home stay by design).

---

## 11. Open questions for the owner

1. **Phase C exit vs later-phase components.** Prompt §9 C's exit requires every Local criterion to pass, but SKILL-AC-001…-004 and CHECK-AC-003 (skill, phase E), DEMO-AC-* and CHECK-AC-005's demo part, E2E-002 (local part) and E2E-015 (demo, phase F) cannot pass before their components exist, nor can E2E-004, whose coverage part needs the demo's tests (DEC-0391). The plan judges those at E-EV/F-EV; likewise E2E-011 on Cloudflare (needs the skill's troubleshooting commands) moves from D-EV to E-EV. To keep C's exit otherwise literal, the plan moves small pieces earlier: `build --target cloudflare` (B-16), `secrets set --target local` (B-17), the target-neutral PROV core with a fake target and the Cloudflare log-bucket ownership check offline (C-03), `smoke --target local` (C-04), and the scaffolder script (C-05). Proceeding on this reading unless the owner objects.
2. **PROV-AC-006 on Cloudflare.** The region is an AWS account setting (DEC-0075); Cloudflare has none. The plan runs the "deploy from a clean machine with no local CLI state" part on Cloudflare and records the region part as not-run ("AWS phase not started"). Confirm.
3. **`./targets/aws` subpath.** CORE-REQ-005 lists `./targets/aws`, but this phase must not build AWS code. The plan omits that subpath until the AWS phase ("one subpath per supported target"); CORE-AC-005's fixture importing `./targets/aws` still fails `verify` through `allowed-imports`. Recorded as an `ai-proposed` decision by B-01 unless the owner prefers otherwise.
4. **FILES-AC-003 on Cloudflare (DEC-0101).** R2 sends no CORS headers on 403, so the browser cannot read storage's status for an expired or mismatched ticket; on Cloudflare the helpers report status null and `no response: network or cross-origin blocked`. FILES-REQ-006's wording ("null otherwise") is arguably met, but FILES-AC-003's expired-ticket clause (storage's status, `rejected by storage (HTTP n)`) cannot pass on Cloudflare. The requirement and criterion are unchanged; the clause is recorded as failing on Cloudflare until the owner chooses an option listed in DEC-0101.
5. **Assumptions taken without asking** (owner instruction "make an assumption and continue"), open for review; each shows `owner review open` in its status line. Phase A: `workers.dev` subdomain treated as personal, not secret (DEC-0086); a deploy may re-enable the route, the CLI still calls `startApp` (DEC-0091); revised `sql.d.ts` contract (DEC-0103); always the fallback D1 copy (DEC-0096); Cloudflare tool environment (DEC-0107); offline wrapper (DEC-0108); `@pulumi/cloudflare` dependency rule (DEC-0109). Phase B: no `./targets/aws` subpath (DEC-0110, also Q3); secret redaction in responses and logs (DEC-0123); dialect variable `PROTOTYPE_FRAMEWORK_DIALECT` (DEC-0134); SQL queries, `atomic`, failures (DEC-0137…DEC-0141); MIG local engine and local reading of MIG-AC-002/-003 (DEC-0142…DEC-0145); KV (DEC-0146…DEC-0150); CHECK rules, skill reference names, migration checker (DEC-0179…DEC-0187); build, runtimes, `createTestApp` incl. the `testing.d.ts` contract change (DEC-0188…DEC-0198); CLI (DEC-0199…DEC-0204); template (DEC-0206…DEC-0209); test authors' readings of criteria (DEC-0210…DEC-0241); framework lint scope (DEC-0242). Phase C: reference app layout, error and secret fixture routes, router typing, schema overlays, data fixture, case-set handover (DEC-0250…DEC-0256); the driver's root-script wiring (DEC-0266); ownership of the Cloudflare log bucket read from HTTP 404/403/409, **unverified against the live API, verified in D-03/D-RUN** (DEC-0270); how `smoke` finds the base URL (DEC-0272); the test secret's value as a run prerequisite (DEC-0277); the cloud test hooks' E2E part (DEC-0279); C-T1's readings of criteria (DEC-0280); C-T2's shared case sets, in-process runs, SQL/KV readings, MIG stages and the edit to C-01's test (DEC-0281, DEC-0282, DEC-0284…DEC-0287); C-T3's FILES/AUTH/E2E-009 readings (DEC-0288…DEC-0301); C-T4's E2E readings (DEC-0302…DEC-0310); download file names (DEC-0313); LOG-AC-004's outside-request clause (DEC-0314, also Q8); cloud runs in passes with ≤ 2 D1 databases (DEC-0318). Phase C follow-ups: unit-level criteria in the driver and E2E-004's coverage from the runners' listing (DEC-0319, DEC-0320); COMPL-AC-001/-003 by nested real runs and their readings (DEC-0321, DEC-0322). Phase D: Cloudflare log writer with the `LOGS` binding and its fallback (DEC-0323); `.`/`..` name segments on R2 URLs (DEC-0328); download names on Cloudflare (DEC-0329); fixed Cloudflare stage resource names (DEC-0331); the `workers.dev` subdomain read on every deploy and the `pf-…` name registered (DEC-0333); the token-permission preflight by reads only, and PROV-AC-002's restricted-credential clause always `blocked` in this sandbox (DEC-0335, DEC-0363); **`remove` refuses a non-`test-` stage unless `--confirm-production <stage>` repeats its name** (DEC-0350); SST's `assets` option for the static-asset settings, `@internal` in SST 4.17.2 (DEC-0356); the driver's leftover check through the framework's `listStageResources`, which needs `NODE_USE_ENV_PROXY=1` (DEC-0357); D-T1/D-T2's cloud hooks, resource probe and criterion readings (DEC-0359, DEC-0360, DEC-0362…DEC-0365); DEC-0270's 403 "foreign" reading cannot be produced with one account and stays an assumption (DEC-0334 item 1). Phase E: examples as whole copied files and `skill/templates/` (DEC-0367, DEC-0368); router front matter and named pins (DEC-0371); the API token's four permissions (DEC-0374); **stop and start are owner steps in the dashboard or the API, with no CLI command** (DEC-0376; the design names no such command); the template's record-backed files with a finalize route, the wire-form upload in its test, and the HMAC helper (DEC-0380…DEC-0382); **the unused `vitest.config.ts` deleted from `apps/template` and `apps/reference`** (DEC-0390). Evaluation: E2E-004 judged at F-EV, not C-EV (DEC-0391, also Q1). Phase F: the in-page clauses of DEMO-AC-001/-003/-009 verified by a compliance-layer browser spec, not the demo's smoke test (DEC-0393). F-04 fixes: **every download is `attachment; filename*=…` on every target, raster images included**, superseding the raster-`inline` part of DEC-0313 and the content-type part of DEC-0329 (DEC-0414). **Visible change:** locally, photo links opened with `target=_blank` (the demo's post view) and the template's `window.open` of a download now download the image instead of displaying it in a new tab, as they already did on Cloudflare; images shown with `<img src>` still display, and no requirement or test depends on the old behaviour. Also: COMPL-REQ-006's "code" read as covering PROV, MIG, CF and AWS, so docs-only portability notes invalidate no milestone record (DEC-0413). Final integration: the driver deploys, sets the run stage's `apiKey` through `secrets set` and deploys again (DEC-0398); a criterion is defined only by a row of a `| ID | Criterion | Verifies | Where |` table (DEC-0408); `TestApp.dispose`'s doc comment states that in-process views share disposal (DEC-0409); the demo-pages spec's demo origin through `COMPLIANCE_DEMO_BASE_URL`, its assumed accessible names and page flow, and what each test asserts (DEC-0410…DEC-0412).
6. **KV-AC-002 vs KV-REQ-002 (DEC-0146).** KV-AC-002 says empty "keys and values" are rejected "with the specified codes"; KV-REQ-002 (binding) rejects only empty keys, and no catalogue code means "empty value". Implementation and tests follow the requirement: `put(k, "")` stores `""`. Neither text was edited. Owner: drop "and values" from KV-AC-002's "Empty" clause, or add an empty-value rule and code to KV-REQ-002.
7. **FILES-REQ-006 failure classes (DEC-0165).** FILES-REQ-006 (binding) lists the message classes a `FILES.TRANSFER_FAILED` must name; a value passed to `uploadFile`/`downloadUrl` that is not a ticket of the right kind fits none of them. The helpers use `rejected before sending: not an upload ticket` (or `download`), status null. Only untyped or cast app code can reach this case. Owner: add the class to FILES-REQ-006, or name the class to use instead.
8. **LOG-AC-004 "one written outside a request has a random final part" (DEC-0314).** No framework or app path writes a log entry outside a request: writers are per request, and there are no scheduled jobs or queues. So the clause cannot be observed, and its test reports `blocked`. LOG-REQ-004's random-value rule is unit-tested in D-01. Owner: drop the clause from LOG-AC-004 (keeping the rule), or name the source of out-of-request entries the framework should support.
9. **E-T2's readings DEC-0403…DEC-0407 (accepted by the orchestrator under the owner's "make an assumption" instruction; owner review open).** History: E-T2 drafted them with the status `proposed`, not `accepted`, and they amend accepted entries: DEC-0403 strengthens DEC-0386's third bullet (each reference must link every example tied to it, by a fixed table); DEC-0404 and DEC-0405 extend DEC-0389 and DEC-0384 (the template's browser examples run in root `verify`; the byte-for-byte check runs through `test:unit`); DEC-0406 extends DEC-0187's CHECK-AC-003 coverage to the five migration-checker rules; DEC-0407 tags the coverage control and checks "exactly one". The integrator kept the status as drafted. Item fix-e3 has already acted on DEC-0403 (link added to `deploying.md`) and DEC-0404 (root `verify` wiring), and the committed tests apply all five. The orchestrator accepted all five on 2026-10-20 because the committed tests already apply them. Owner: reject any one if you disagree; a rejected one must then remove the matching test check by its own decision (`ai/implementation/root-causes/2026-10-20-SKILL-AC-001-deploying-missing-example-link.md`, Precondition).
10. **Testing contract: a simulated file failure cannot reach a stored file (F-EV2, weak assertion W5 in `ai/implementation/evaluations/final.md`).** DEMO-AC-003 asks that "in a local test, a simulated file-deletion failure produces a `warn` log entry". The testing contract gives one way to simulate a failure, `unavailable: ["files"]`, and that switch holds for the whole test app from creation (`docs/contracts/ts/testing.d.ts:40-41`; `skill/reference/testing.md:16`). Each `createTestApp` gets fresh, empty storage (`testing.d.ts:93`). There is no seed API. And `createUploadTicket` checks reachability with `store.head` before it issues a ticket (`packages/framework/src/files/service.ts:140-144`), so no upload can succeed in such an app. A test can therefore never delete a post that holds a stored photo while file storage is failing. The committed test (`tests/compliance/e2e/demo-criteria.spec.ts:656`) passes only because the demo also tries to clean up posts with no photos (`apps/demo/src/server/posts.ts:109-120`), so its failing call is the `list` of an empty prefix. It would wrongly fail a correct app that cleans up only posts with photo rows, and wrongly pass an app with a separate, unlogged path for a failed `delete`. F-EV2 records DEMO-AC-003 as `passed` with W5 open, because no plan §8 rule allows `not-run`. Changing `testing.d.ts` is a contract change, so the owner must choose. Options:
    - **(a) A per-request (or switchable) failure switch:** for example `t.setUnavailable(["files"])`, or a per-request option, so that a test can store a file normally and then make the cleanup request fail. This is the smallest change. It also lets app tests check a failed cleanup after real data exists (template, skill `testing.md`).
    - **(b) A seed API:** for example `createTestApp(app, { seed: { files: { "<name>": bytes } } })`, or a `t.seedFile(name, bytes)` that writes to storage directly even when `files` is unavailable. This keeps the whole-app switch, but it adds a way past the FILES service that app code never has.
    - **(c) No change:** accept W5 for DEMO-AC-003. The evaluator's source reading of `deletePost` then stands in for the missing test, and `skill/reference/testing.md` keeps its single-`try`/`catch` advice.

    Whichever is chosen, a test author then strengthens the DEMO-AC-003 warn test (and the template's equivalent, if any) to delete a post holding a stored photo, and a runner re-runs it. Until the owner answers, W5 stays open and DEMO-AC-003 stays `passed` on local.
11. **R2 API `DELETE` of a `..` key on real Cloudflare (pass 0 F-1; DEC-PENDING-fix-pass0-2; `ai/implementation/root-causes/2026-10-23-pass0-F1-r2-api-delete-traversal-403.md`).** In the sandbox, `DELETE /accounts/<id>/r2/buckets/<bucket>/objects/x%2F..%2Fy` answered 403 "request rejected: path contains traversal sequence", most likely from the egress proxy, but its headers were not captured. Owner item: send one API `DELETE` of a `..` key (`encodeURIComponent("x/../y")`) to `api.cloudflare.com` from a machine outside the sandbox proxy, on a test object in a test bucket, and capture the status, the body and the `Server` and `cf-ray` headers. Alternatively, the proxy operators confirm the filter. If real Cloudflare also refuses it, stage removal breaks PROV-REQ-003 for valid FILES-REQ-002 names, and `deleteObjects` needs the S3-DELETE fallback described in the root-cause record. Until then, the D-RUN rule in §5 handles such leftovers in the sandbox.
