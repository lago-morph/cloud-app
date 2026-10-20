# C-T4 decision drafts — E2E scenarios (except E2E-009)

Tests: `tests/compliance/e2e/*.spec.ts` (Playwright project `e2e`, the only E2E layer the driver runs), helpers in `tests/compliance/e2e/support/`, term list `tests/compliance/e2e/terms.txt`. Written from `docs/acceptance/e2e-scenarios.md`, the contracts, `compliance.md`, and `apps/reference/ROUTES.md`; taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.

### DEC-PENDING-C-T4-1 — Target-specific parts are defined only on their targets
Origin: ai-proposed · Status: accepted · Affects: E2E-007, E2E-011, E2E-014, COMPL-REQ-001

Where a scenario states different steps per target (E2E-007 local in-process part; E2E-011 local failing-writer part; E2E-014 cloud scan part and local rebuild part), the test for one target's part is defined only when `target()` is that target (`if (target().target === "local") test(...)`), not skipped elsewhere: the driver turns each skipped tagged test into a `not-run` entry, which would misstate a part that does not apply. Shared parts (E2E-011's entry lookup, E2E-014's committed-values check) run on every target and branch only on where the target stores its entries.

### DEC-PENDING-C-T4-2 — E2E-001: offline namespace after scaffolding; capabilities through the template's pages
Origin: ai-proposed · Status: accepted · Affects: E2E-001, LOCAL-AC-001

Scaffolding (`skill/scripts/scaffold`) needs the npm registry for the template's other pinned dependencies (DEC-PENDING-C-05-1), so it runs with cloud credentials removed from the environment (`CLOUDFLARE_*`, `CF_*`, `AWS_*`, `GOOGLE_*`, `GCLOUD*`, `CLOUDSDK_*`, `AZURE_*`, `SST_*`) but with the proxy. Every later step runs under `unshare -rn sh scripts/offline.sh` (no network at all, stronger than "cloud providers blocked"), with the same credentials removed and `HOME` an empty directory; the test first shows `api.cloudflare.com` is unreachable there. Because the browser must reach `dev` inside the namespace, `support/template-pages.ts` (run by Node with type stripping) starts `dev` and Chromium inside it and prints one result line. "Imports every public subpath" = every key of the installed package's `exports` map imports in Node and type-checks (`tsc --strict --skipLibCheck`, Bundler resolution). "Each capability through the template's pages": CFG (heading shows `greeting` set in `config/local.json`), AUTH (Log in / Log out; admin via mock-login), SQL (Notes), KV (Status, kept after reload), FILES (upload, list, download same bytes), SEC (Admin "Check secret" after `secrets set apiKey`), LOG (the note's entry in `.logs/`). Selectors are the template pages' visible texts (the template has no test IDs). The scaffolded app lives in the OS temp directory and is removed afterwards.

### DEC-PENDING-C-T4-3 — E2E-003: violations, expected rules and references
Origin: ai-proposed · Status: accepted · Affects: E2E-003, CHECK-REQ-003

E2E-001 and E2E-003 share one scaffolded app (one spec file, serial). Each violation is one new file under `src/server/` (or the edited `migrations/sqlite/0000_schema.sql`), restored after its `verify` (run offline). Pass per violation: `verify` exits non-zero and a diagnostic line names the file, the rule ID and `(read skill/reference/<file>.md` per check.md §2 "Diagnostics" and DEC-0181: AWS SDK import and `node:fs` → `prototype-framework/allowed-imports` + `http-and-validation.md`; `c.env.DB` → `no-env-access` + `configuration.md`; raw `sql` → `no-raw-sql`, `rightJoin` → `no-dialect-features`, edited migration → `migration-checksums`, all + `sql-and-migrations.md`; `any` → `@typescript-eslint/no-explicit-any` + `troubleshooting.md`. `caches.default` may instead fail type checking (a TS error line naming the file). "A SQLite-only function" has no Drizzle helper, so it is `strftime` through Drizzle's `sql` template; either `no-dialect-features` or `no-raw-sql` counts. The test fails while the skill reference files do not exist only if `verify` stops printing them; their existence is CHECK-AC-003's (E-01).

### DEC-PENDING-C-T4-4 — E2E-004: in-run coverage part; the pass part is read from the run's own record
Origin: ai-proposed · Status: accepted · Affects: E2E-004, COMPL-REQ-006

E2E-004's pass condition is a property of a whole run's evidence record, which is written after every test finishes, so no test of that run can observe it (running the suite recursively would double cloud usage). The tests check what a run can: (a) coverage — every criterion the driver expects to run on this target and tier (`expectedCriteria`) has at least one tagged test in the files this target's run executes (`tests/compliance/**`, plus `packages/framework/test/integration/**` locally; driver.ts limits cloud runs to `tests/compliance/`); (b) the evidence writer's schema matches the contract's required fields and properties and rejects invalid records. Titles say "coverage part" / "record part". The evaluator judges E2E-004 itself from that run's record (every other applicable result `passed`, record schema-valid). Expected to fail until every component's tests exist (SKILL, DEMO criteria in phases E/F; other C-T* items until merged).

### DEC-PENDING-C-T4-5 — E2E-005: browser fetches from the app page; exposure detectors
Origin: ai-proposed · Status: accepted · Affects: E2E-005

The browser logs in via `/api/auth/mock-login` and calls ROUTES.md's protected routes with `fetch` from the app's own page (`/`), so cookies and `Origin` are the browser's. Permitted actions per level: `/levels/anyone` all; `/levels/user` (GET, POST), `/levels/current`, `/kv/value`, `/files/head` user and admin; `/levels/admin` (GET, POST) admin only; refusals 401 `AUTH.UNAUTHENTICATED` (anonymous) / 403 `AUTH.FORBIDDEN` (user). Every `/api` response's body and headers (except `Set-Cookie`, which carries the framework's own session) is checked for the words google, oidc, oauth, openid, issuer, iss, email, id token, access token, refresh token, jwt (camel/snake case split, case-insensitive), email addresses and JWT-shaped strings. "App-facing types" = the shipped declaration files of `.`, `./client`, `./testing` (CORE-REQ-005's app-importable subpaths) and every declaration file they import; identifiers and string literals are checked with the same detector, comments are not (they are documentation, not types).

### DEC-PENDING-C-T4-6 — E2E-013/E2E-014 secret checks without printing values
Origin: ai-proposed · Status: accepted · Affects: E2E-013, E2E-014, SEC-REQ-002, CLI-REQ-004

E2E-013 finds the secret `apiKey` in responses through its digest (`GET /api/ref/secret` → SHA-256; every substring of each short response text is hashed), so it needs no copy of the value and runs on every target; locally it also checks every `.dev.vars` value (≥ 8 characters). E2E-014 sets a fresh value with `secrets set apiKey` (standard input) — on a cloud on the run's stage, then deploys that stage again; locally in a copy of the reference app under the git-ignored `.framework/e2e/` (the tree stays clean). Scans: repository = `git ls-files` plus untracked non-ignored files; build outputs = the app's `.framework/` (LOCAL §2 "Build output"); browser assets = everything reachable from `/` (same origin, outside `/api`, ≤ 300 files); logs = `.logs/` locally, the stage's entries of the day in the shared bucket on a cloud. `.wrangler/` (local runtime state) and `.dev.vars` (the local secret store itself) are not scanned. Assertion messages name where a value was found, never the value. Local "rebuild" = restarting `dev`, which builds (DEC-0215); the served value is checked unchanged for 10 s after the edit.

### DEC-PENDING-C-T4-7 — Cloud hooks the E2E tests expect from D-T2
Origin: ai-proposed · Status: accepted · Affects: E2E-011, E2E-012, E2E-014, D-T2

Log-bucket listing and the stage-resource probe belong to D-T2 (`tests/compliance/criteria/_cloud/**`). The E2E tests load them at run time and report a missing prerequisite (`blocked`) while they do not exist:
- `_cloud/logs.ts` exporting `listLogEntries({ target, app, stage, day }): Promise<{ key: string; body: string }[]>` — every object under `<app>/<stage>/<day>/` (`day` = `yyyy/mm/dd`) in the account's shared log bucket, with its body;
- `_cloud/stage-resources.ts` exporting `listStageResources({ target, app, stage }): Promise<string[]>` — every resource of PROV's removal list still present for the stage, as the driver's leftover strings (`database <name>`, `<kind> <id>`).
If D-T2 chooses other names, a C-T4 follow-up adapts `support/cloud.ts` (plan: "gaps found in them go back to a C-T* follow-up item"). The D1 database probe (PROV-REQ-002's exact pattern) and the shared-bucket existence check use the Cloudflare API directly (`support/cloud.ts`, no Authorization header; the proxy injects the token). Cloud log waits use `CLOUD_WAITS.requestMs` (an entry is written within its request's lifetime, PAR-270); waiting for a newly set secret uses `CLOUD_WAITS.routeToggleMs`.

### DEC-PENDING-C-T4-8 — E2E-010 and E2E-012 stage handling
Origin: ai-proposed · Status: accepted · Affects: E2E-010, E2E-012, D-RUN-M

Each scenario creates its own `test-<random>` stages (`newTestStage()`) and removes them in `finally`; each deploy runs from its own copy of the app under `.framework/e2e/` so concurrent deploys never share a build directory. The first Cloudflare deploy of a stage stops when `apiKey` is unset (provisioning.md "First Cloudflare deploy"); the helper then sets a fresh value and deploys again. E2E-010: v2 = the `versions/v2/` overlay; "applies nothing" = the stage keeps the same single database (a schema-changing deploy copies to a new one, MIG-REQ-006) and the dump is unchanged; "no downtime" = every probe of `/api/ref/schema-version` (no database rows) during the second v2 deploy answers 200, one per second. E2E-012: the kept stage holds the migration fixture plus its own KV value and file; the removed stage its own KV value and file and one log entry, which must remain after removal. Data per scenario: tens of rows (fixture 3 + 5 rows, 2–3 files, 1–2 KV keys), within the plan's cloud usage limits.

### DEC-PENDING-C-T4-9 — E2E-016 scan details
Origin: ai-proposed · Status: accepted · Affects: E2E-016

Scanned: `docs/contracts/ts/**/*.ts` except `internal/`, and `docs/contracts/http/framework.openapi.yaml`. TypeScript files are tokenised with the TypeScript scanner (identifiers, string and template literals, comments); the YAML file line by line. Case-sensitive whole-word matching; in identifiers a word boundary is also a camel-case boundary (`getS3Client`, `OAuthToken`), a lower-case term also matches its capitalised camel-case form (`tokenIssuer`), and multi-word terms also match their identifier spellings (`idToken`, `IDToken`, `access_token`). A test checks `terms.txt` equals the scenario's list, and positive/negative controls check the scanner. The scan test also runs in a local milestone run, where the driver records E2E-016's "review" part from it; the review itself is F-04's `validation/reviews/E2E-016.md` (the evaluator must not read the scan as the review).

### DEC-PENDING-C-T4-10 — In-process reference app from Playwright
Origin: ai-proposed · Status: accepted · Affects: E2E-007, E2E-011

The in-process parts import `apps/reference/src/app.ts` at run time (its `app` export, DEC-0214) and call `createTestApp` with the working directory set to `apps/reference` (restored afterwards), so the committed migrations apply. E2E-007's "copy the user ID from the account page" reads `/api/auth/me`, the account page's data (framework.openapi.yaml); "redeploy" is a second `createTestApp` with `framework.admins` (testing.d.ts: each call is one build).

## Parameter changes

None.

## Missing routes or fixtures

None found: every route the scenarios need is in `apps/reference/ROUTES.md`. The template has no test IDs; E2E-001 uses its visible texts (headings, button names, placeholders, "Uploaded.", "Saved.", "The secret apiKey is set.").
