# Decision drafts — B-T4 (integration tests: check, cli, local, build)

Suites: `packages/framework/test/integration/{check,cli,local,build}/`. Fixtures and harness: `packages/framework/test/fixtures/**`. Written from the criteria and contracts only; no implementation existed. Every assumption below was taken under the owner's "do not stop for questions" instruction and is open for review.

### DEC-PENDING-B-T4-1 — Fixture TypeScript files carry a `.fixture` suffix
Origin: ai-proposed · Status: accepted · Affects: `packages/framework/test/fixtures/**`, B-01 `packages/framework/tsconfig.json`

`packages/framework/tsconfig.json` includes `test/**/*.ts` with the framework (Node) lib set and NodeNext resolution. Fixture apps are app code (app lib set, Bundler resolution) and many fail type checking on purpose, so as `.ts` they would break `npm run typecheck`. They are stored as `*.ts.fixture`; the harness (`fixtures/support/app.ts`) strips the suffix when it copies a fixture app. The passing and failing apps were type-checked by hand against the B-01 contract stubs under the app lib set: the passing app is clean; the failing app's type errors are exactly the intended ones.

### DEC-PENDING-B-T4-2 — Suites drive the real binary on throwaway copies; the framework must be built first
Origin: ai-proposed · Status: accepted · Affects: B-16, B-17, B-RUN

Each test copies fixture layers into a fresh OS temp directory, symlinks `node_modules` to the workspace's, and runs `node_modules/.bin/prototype-framework <command>` there (what `npx <package> <command>` resolves to). The binary and exports point at `dist/` (DEC-PENDING-B-01-2), so the harness refuses to run when `packages/framework/dist/cli/public.js` is missing or older than `src/`, naming the command `npm --workspace packages/framework run build`. The runner (B-RUN) must build before `npm run test:integration`, or B-17 wires the build into that script.

### DEC-PENDING-B-T4-3 — Fixture apps hold no generated migrations; the harness runs `generate-migration`
Origin: ai-proposed · Status: accepted · Affects: B-07, B-17

Migrations are the framework generator's output (format, file names, `checksums.json`), which does not exist yet. After copying, the harness runs `generate-migration` once, as an owner does after defining tables; a failure there fails the test setup with the command's output. Tests that need a hand-changed history (`editMigrationKeepingChecksum`, `addHandWrittenMigration`) infer the `checksums.json` entry from the existing file's digest (sha256/sha1/sha512, hex/base64/base64url, optionally `algo:`/`algo-` prefixed) and fail with a clear harness message if the format is not recognisable; a drizzle `meta/_journal.json`, when present, gets an entry for a hand-written file.

### DEC-PENDING-B-T4-4 — Diagnostic layout the assertions rely on
Origin: ai-proposed · Status: accepted · Affects: CHECK-REQ-003, B-14, B-17

A diagnostic about a file is found by the file's base name (fixture base names are unique) on an output line, plus any indented continuation lines (so both one-line `path:line:col message rule` and ESLint "stylish" layouts work). The rule is "named" when its name appears as a whole word, plugin prefix allowed (`x/no-raw-sql`). Type errors are recognised by `TSnnnn`. CHECK-AC-003 additionally needs, in one diagnostic (the rule line up to the next diagnostic), a skill reference written as `skill/reference/<name>.md` or `reference/<name>.md` that exists under `skill/`, and the construct (per-fixture patterns in `fixtures/support/check-catalog.ts`, matched after removing the file name, rule name and reference path).

### DEC-PENDING-B-T4-5 — `verify` reports every static step's diagnostics, not only the first failing step's
Origin: ai-proposed · Status: accepted · Affects: CHECK-AC-001, CHECK-AC-003, SQL-AC-002, CLI-REQ-002, B-17

CHECK-AC-001 requires the rule (`allowed-imports`) to fail `node:fs` and bare `fs` imports, but under the app lib set (no `@types/node`) those also fail type checking; likewise `.transaction()`, `.batch()` and `db.query` are absent from `PortableDb` and fail type checking before `no-transactions` / `no-relational-queries` could be seen. The tests therefore require `verify`'s output to contain both the type error and the rule's diagnostic. The simplest reading: `verify` runs type checking and the portability rules and reports both before failing. All failing fixtures share one app and one `verify` run.

### DEC-PENDING-B-T4-6 — App entry and test-app conventions used by fixtures
Origin: ai-proposed · Status: accepted · Affects: cli.md §2 App layout, testing.d.ts, B-16, B-18

`src/app.ts` exports the `defineApp` result both as `default` and as `app` (cli.md says only that it "holds the defineApp call"). App tests call `createTestApp(app)` and `TestApp.request` with the full path (`/api/hello`). The Vite entry page is `index.html` at the app root loading `/src/client/main.ts`. Fixture `tsconfig.json` repeats the app lib set. Route handlers live inline in `defineApp` (no `hono` import needed).

### DEC-PENDING-B-T4-7 — Postgres-only failures used for CLI-AC-002 and LOCAL-AC-003
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-002, LOCAL-AC-003

Both use only supported features, so only the Postgres test process can catch them: `.limit(-1)` (SQLite: no limit; Postgres: "LIMIT must not be negative") for CLI-AC-002, and `selectDistinct` ordered by an unselected column (Postgres requires ORDER BY expressions of SELECT DISTINCT in the select list) for LOCAL-AC-003. The assertion is that `verify` fails and its output names the failing app test, which proves a test run (not a static check) failed. The output need not say which dialect failed (not specified), so "works on SQLite" is not separately asserted.

### DEC-PENDING-B-T4-8 — Bundle inspection reads `.framework/` and matches surviving strings
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-006, CF-AC-003, PROV-AC-005, LOCAL-AC-004, B-16

cli.md says `build` generates entry points under `.framework/`; the tests assume the whole build output is there and scan every file in it. Positive controls: a `.js`/`.mjs` file exists, the text contains `__framework/health` and the stage's own config marker. Modules are recognised by strings that survive bundling and minification: `mock-login` (mock); `stubLoginProvider`/`loginWithStub`/`stubFailure` (stub provider, `./testing`); `__framework/files` (local transfer route); `ticket_key`/`ticketKey`/`SECRET_*TICKET*` (local ticket key — assumes its framework-internal name contains "ticket"); `@aws-sdk`/`aws-sdk`/`amazonaws.com`; `pulumi`, `sst` specifiers or paths, `/provision/`, `setupAccount`, `listStageResources` (provisioning); `pglite`/`electric-sql`; import specifiers of `fs`, `fs/promises`, `child_process`, `worker_threads`, `cluster`, `repl`, `inspector`, `v8`, `tty`, `dgram` (with or without `node:`); tooling package specifiers or `node_modules/<pkg>/` paths (eslint, typescript, drizzle-kit, wrangler, vite, vitest, esbuild, miniflare). Comments mentioning these strings in bundled framework code would be false positives; the build should strip comments or minify.

### DEC-PENDING-B-T4-9 — Readings of individual criteria
Origin: ai-proposed · Status: accepted · Affects: listed IDs

- **CORE-AC-005**: the exports map must equal the CORE-REQ-005 table minus `./targets/aws` (DEC-PENDING-B-01-1, plan §11 Q3). The `./targets/aws` fixture must fail `verify` with a diagnostic naming the file (type error or `allowed-imports`).
- **CORE-AC-006**: only the Cloudflare-bundle part is covered; "the AWS bundle contains no Cloudflare-only modules" is not testable this phase (no AWS target; not-run).
- **PROV-AC-005**: run for target `cloudflare` only (stages `prod`, `prodcheck`, `mytest-1`, `test-b4t1`); the local target has no per-stage values files and AWS is not built. "Reads its own values file" is shown by a distinct `greeting` value per file appearing in exactly the matching bundle. These are local builds; nothing is deployed (prompt §4 forbids only cloud `prodcheck` stages).
- **LOCAL-AC-004 "cloud builds reject the local cookie settings"**: no knob for cookie settings is specified, so it is read as: a Cloudflare build contains the `__Host-session` cookie name and never the local `session_local` setting. Host-header rejection is tested on the printed dev port (status ≥ 400 or connection closed, with a `Host: localhost:<port>` control); loopback-only is tested on every TCP listener of the `dev` process group (from `/proc`) plus a connection attempt on each non-loopback IPv4 interface address. The dev URL is the first `http://localhost:<port>` `dev` prints.
- **LOCAL-AC-002**: the clause "each capability's local acceptance criteria pass" is the union of the other suites' results (B-T1…B-T3, C-T*); this suite covers "data survives a restart of `dev`, and the reset command clears it" for SQL, KV and files, and its title says so.
- **CLI-AC-002**: "mismatched migration" is read as dialect histories that disagree (checksums kept valid, so only the schema comparison catches it); the diagnostic must name the differing column (`extra`). "Zero tests" output must match `/no tests|zero tests|0 tests|no test files/i`. Identical offline runs compare exit codes and output after removing durations, clock times and the temp path. The template tests fail until B-18 exists.
- **CHECK-AC-003**: also covers `no-transactions` and `no-relational-queries` through DEC-PENDING-B-T4-5. It can pass only once phase E writes `skill/reference/` (plan §4 C-EV note: judged at E-EV).
- **CHECK-AC-004**: unsupported changes are hand-written migration pairs (the generator refuses renames, so only hand edits can produce them) registered with valid checksums; each must fail with a diagnostic matching `/add[ ,-]+copy[ ,-]+(and )?drop/i`. Supported changes are produced by `generate-migration` one per step (add table, add nullable column, add column with static default, add index, add unique, drop index, drop unique, drop column, drop table), each must create one new file per dialect, then `verify` must pass.
- **CHECK-AC-006**: the rule's full ID is discovered from the exports of `<package>/check` (a key ending in `/no-raw-sql`, or a plugin whose `rules` has it); the app config is `eslint.config.js` setting it to `"off"` or `0`. `verify` must fail, name the rule, and name `eslint.config`. If `./check` exposes no such ID the test fails saying so.
- **SQL-AC-002**: excluded features that Drizzle cannot express without raw SQL (window functions, JSON operators, full-text search) are fixtures of `no-raw-sql`; views are a `pgView` import (`allowed-imports`). Triggers and stored procedures have no fixture: they can only be created by raw DDL, which `PortableDb` cannot execute and `no-raw-sql` already rejects. `groupBy` is assumed supported (aggregates are, and grouping is how they are used); the passing fixture uses it.
- **CHECK-AC-001** raw-HTML insertion, value import from `src/shared/` in browser code, and the type-escape fixtures of CHECK-AC-002 name no rule, so any diagnostic naming the file counts.

## Parameter changes

None.
