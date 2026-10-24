# CHECK — Static checks

Executable portability rules for app code, and the migration checker. These are what make SYS-REQ-006 ("enforced, not remembered") real; the verification command runs them (CLI).

Contracts: rule names and diagnostics below. Configuration is provided by `./check`.

## 1. Requirements

#### CHECK-REQ-001 — Portability rules
Origin: owner-approved · Derives from: SYS-REQ-004, SYS-REQ-006, SYS-REQ-011

The rules below MUST run on all app code. They MUST resolve aliases, re-exports, and dynamic imports rather than relying on identifier spelling.

App code is classified by path: `src/client/**` is browser code, `src/server/**` is server code, `src/app.ts` is server code, `src/shared/**` is shared code, and `tests/**` is test code. Shared code holds types and Zod schemas usable from both sides, and imports only `zod` and other shared code. Browser code MAY import `zod`, and MAY import from `src/shared/` only with type-only imports. In browser code, the shipped configuration MUST also enable existing lint rules that reject inserting raw HTML (§2).

| Rule | Rejects |
| --- | --- |
| `allowed-imports` | Imports of platform SDKs, database drivers, Drizzle dialect modules, framework subpaths outside CORE-REQ-005's table, `node:*` modules, or bare Node built-in modules (for example `fs`, `crypto`, `buffer`). |
| `no-env-access` | Reading `process.env`, `import.meta.env`, platform bindings, Hono's `c.env` or `c.executionCtx`, or replacing the framework's error and not-found handlers. |
| `browser-api-only` | In browser code: imports from the framework other than `./client`, and direct `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` use; browser code reaches the server only through the `./client` helpers (SYS-REQ-008). |
| `no-raw-sql` | Raw SQL and low-level database execution APIs. |
| `no-dialect-features` | Query features outside SQL-REQ-002, including inside subqueries and common table expressions. |
| `framework-order` | Ordering other than the framework's `asc` and `desc`. |
| `no-transactions` | `.transaction()` and `.batch()`; use `atomic`. |
| `no-relational-queries` | Drizzle's relational `db.query` API. |
| `framework-ids` | ID values not from `newId()`, and updates to `id()` columns. |
| `app-error-codes` | Throwing `FrameworkError` from app code with a code outside the CORE-REQ-007 table. |

#### CHECK-REQ-002 — No type escapes
Origin: ai-proposed · Derives from: SYS-REQ-006

App code MUST NOT use `any`, unchecked type assertions, or comments that suppress type or lint errors (DEC-0043). `as const` and `satisfies` are allowed. Generated entry points and tooling have explicit, narrow exemptions.

#### CHECK-REQ-006 — Rules cannot be switched off by apps
Origin: ai-proposed · Derives from: SYS-REQ-006

`verify` MUST load the portability rules from the framework package, not from app-editable configuration. It MUST fail if app configuration disables or weakens any framework rule.

#### CHECK-REQ-003 — Actionable diagnostics
Origin: provenance-unclear · Derives from: SYS-REQ-006, SYS-REQ-029

Each diagnostic MUST name the offending construct, the rule, and the skill reference to read.

#### CHECK-REQ-004 — Migration checker
Origin: provenance-unclear · Derives from: SYS-REQ-011, SYS-REQ-012

The checker MUST enforce MIG-REQ-001 and MIG-REQ-003:
- both dialect histories yield the same logical schema;
- only the supported changes listed in MIG §2 are used; adding a NOT NULL column without a static default to an existing table, a column type change, and a rename fail with a diagnostic naming the add-copy-drop pattern;
- committed migrations still match `migrations/checksums.json`.

#### CHECK-REQ-005 — Fixtures
Origin: provenance-unclear · Derives from: SYS-REQ-006

Every rule MUST have failing fixtures and realistic passing fixtures, and the template and demo code MUST pass.

## 2. Design

The rules are ESLint rules using TypeScript type information, exported with a ready configuration from `./check`. The migration checker applies both histories to fresh local D1 and PGlite databases, then compares their introspected schemas.

**Zod version.** Shared and browser code cannot import `.`, so they import `zod` directly. Apps therefore depend on `zod` at exactly the version of PAR-112, the version `.` re-exports, and `verify` checks that the installed `zod` version matches PAR-112.

App server and shared code is type-checked against an ES plus Web API lib set, with no `@types/node` and no `@cloudflare/workers-types`, so Node and Workers globals (for example `Buffer`, `caches.default`) fail type checking without a dedicated rule. In browser code the shipped configuration enables existing raw-HTML sink rules (for example `no-unsanitized`, plus the UI library's no-danger rule where the app uses one). The `no-raw-sql` diagnostic also points to the "Common needs" list in SQL §2.3.

Static rules cannot prove arbitrary behavior. They are narrow by design and are backed by the compliance suite.

**Rule engine** (`src/check/`, DEC-0179). `runPortabilityRules(appDir)` lints every TypeScript file under `src/` and `tests/` with the shipped configuration only (ESLint with `overrideConfigFile: true` and inline configuration off), using a TypeScript program the engine builds itself with the app lib set (`APP_COMPILER_OPTIONS`, the same options as `tsconfig.app.json`), so app-editable `tsconfig.json` and lint files cannot change what the rules see. It reports rule diagnostics whether or not the app type-checks; `verify` runs the type check separately and reports both (DEC-0238). Rules resolve references through the type checker to the declaration they denote (aliases, re-exports, namespace imports, `const` copies), and recognise Drizzle databases, query builders and Hono values by the package that declares their types. Files under `src/` outside `client/`, `shared/` and `server/` are classified as server code.

**Shipped configuration.** `./check` exports `config` (also the default export) and `plugin`. Rules are named `prototype-framework/<rule>`: the ten CHECK-REQ-001 rules, plus `no-raw-html` (raw-HTML sinks in browser code: `innerHTML`/`outerHTML` writes, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `setHTMLUnsafe`, `dangerouslySetInnerHTML`; the framework's own rule, since no third-party plugin is pinned, DEC-0182) and `no-suppression-comments` (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable…`, inline `eslint`/`global` comments). The other CHECK-REQ-002 bans are typescript-eslint's `no-explicit-any`, `consistent-type-assertions` (`assertionStyle: "never"`, which still allows `as const`) and `no-non-null-assertion`. All are errors.

**What each rule takes as its construct** (DEC-0180):
- `allowed-imports`: static, dynamic, `require`-style and type-only imports and re-exports of `node:*` and Node built-ins, other `scheme:` modules, platform SDKs and database drivers (a fixed package list), `drizzle-orm/*` subpaths, platform Hono modules (`hono/adapter`, adapters), framework subpaths outside the importer's CORE-REQ-005 row (server: `.`; tests: `.` and `./testing`; shared: none); shared code importing anything but `zod` and shared code; browser code importing server or test code, or shared code with a value import; server code importing browser or test code. A named import from a local module is followed through that module's re-exports. A dynamic import with a computed specifier fails.
- `no-env-access`: `process.env` (any `process` binding), `import.meta.env`, `env`/`executionCtx` read from a Hono `Context` (by type, also destructured), `onError`/`notFound` on a Hono app.
- `browser-api-only` (browser code): any framework import other than `./client` (type-only too); references to the lib globals `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` (also as `globalThis.`/`window.` members).
- `no-raw-sql`: references to Drizzle's `sql` and its relatives (`SQL`, `placeholder`, `param`, `name`, …); `execute`/`run`/`all`/`get`/`values`/`$client`/`session` on a database handle.
- `no-dialect-features`: Drizzle SQL expressions and functions the framework does not export (`like`, `ilike`, `exists`, Drizzle's `sum`, …); `rightJoin`, `fullJoin`, `crossJoin`, lateral joins, set operations and `.for(…)` on Drizzle builders; `$with(…).as(<insert/update/delete>)`; `min`/`max` on boolean columns and `sum`/`avg` on columns other than `integer`/`number` (the column's helper is read from its `defineTable` call; otherwise its data type).
- `framework-order`: references to Drizzle's `asc`/`desc`; `orderBy` arguments that are not calls of the framework's `asc`/`desc`.
- `no-transactions` / `no-relational-queries`: `transaction`/`batch` and `query` read from a database handle (member access or destructuring); Drizzle's `relations`.
- `framework-ids`: in `insert(…).values(…)`, an `id()` column value that is a literal, a template, or a call or construction other than the framework's `newId` (also through `const` bindings); untraceable values (parameters, properties) pass and are left to SQL-REQ-004's run-time rule. Any `id()` key in `update(…).set(…)` or `onConflictDoUpdate({ set })`.
- `app-error-codes`: `new FrameworkError(code)` (the framework's class, however imported) whose code's type includes anything but the four CORE-REQ-007 codes.

**Diagnostics** (CHECK-REQ-003). One line each: `<file>:<line>:<col>  error  <message naming the construct>  <rule ID>  (read skill/reference/<file>.md)`. The reference names are fixed in `src/check/references.ts` (one file per skill.md §2 topic plus `owner-tasks.md`); E-01/E-02 create exactly those files (DEC-0181). A closing count line names each kind present: `<n> portability problem(s)`, `<n> migration problem(s)`, or both separated by a comma (DEC-0198).

**Migration checker** (CHECK-REQ-004, `src/check/migrations/`; exported from `./check` as `runMigrationChecker(appDir)` and `MIGRATION_CHECKS`). Offline file checks first (DEC-0186): every `migrations/<dialect>/*.sql` has its SHA-256 recorded in `migrations/checksums.json` (a missing entry means it was not made by `generate-migration`, a different one that it was edited after generation), every entry names an existing file, names are `<nnnn>_<slug>.sql` numbered from 0000 without gaps or repeats per dialect, and both dialects have the same base names. It then applies the framework history and the app history one migration at a time, through MIG's applier, to fresh local D1 (`getPlatformProxy`, not persisted) and PGlite, introspects the schema after each, and judges each migration by its schema effect, not its statements (DEC-0184): adding or dropping a table, an index or a unique constraint, adding a nullable or statically defaulted column, and dropping a column are supported; a rename (a table, or a column within one table, removed and another added in one migration), a NOT NULL column without a default added to an existing table, a change to an existing column's type, nullability, default or primary key, and a reference added to or removed from a kept column are rejected, each naming the add-copy-drop pattern; so are statements that change data, except drizzle-kit's own table-rebuild copy. A migration that fails to apply is reported with the database error and stops that dialect's later judgements. "Same logical schema" compares, per table, columns (SQL name, type by SQLite storage class, nullability, static default, primary key), indexes, unique column sets and references; with paired file names the dialects are compared after each pair and only the first divergence is reported, otherwise only the final schemas (DEC-0185). Diagnostics use the portability rules' layout at line 1 of the migration file (or `checksums.json`), with rule IDs `prototype-framework/migration-checksums`, `-history`, `-apply`, `-supported-changes`, `-dialects` and the reference `skill/reference/sql-and-migrations.md`; they are not ESLint rules (DEC-0187).

**App lint configuration** (CHECK-REQ-006). `verify` never uses the app's `eslint.config.{js,mjs,cjs,ts,mts,cts}` for its rules. It loads that file and fails, naming the file and the rule, when any entry sets a shipped rule (also under a renamed plugin namespace) to a lower severity or different options; a file that cannot be loaded also fails (DEC-0183).

## 3. Uses

CORE (export list), SQL (supported subset), MIG (migration rules), SKILL (reference names in diagnostics), LOCAL (registry-free platform proxy for the migration checker's local D1).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CHECK-AC-001 | Each rule fails its failing fixtures, including aliased and re-exported variants, and passes its passing fixtures. Fixtures include a `node:fs` and a bare `fs` import, a server-side `Buffer` use (fails type checking), one raw-HTML insertion in browser code, a value import from `src/shared/` in browser code (fails), a `FrameworkError` thrown from app code with `SQL.CONFLICT` (fails `app-error-codes`), and a type-only import from `src/shared/` plus a `zod` import in browser code (pass). | CHECK-REQ-001 | Local |
| CHECK-AC-002 | Fixtures using `any`, `as` casts to unrelated types, and `@ts-ignore` / `eslint-disable` comments fail; fixtures using `as const` and `satisfies` pass. | CHECK-REQ-002 | Local |
| CHECK-AC-003 | Every rule's diagnostic names its construct, rule, and an existing skill reference. | CHECK-REQ-003 | Local |
| CHECK-AC-004 | Mismatched dialect histories, an edited applied migration, and each unsupported change (a NOT NULL column without a static default added to an existing table, a column type change, a rename) fail the checker, each unsupported change with a diagnostic naming the add-copy-drop pattern. Each supported change in MIG §2 passes. | CHECK-REQ-004 | Local |
| CHECK-AC-005 | The template and demo pass all rules. | CHECK-REQ-005 | Local |
| CHECK-AC-006 | An app lint configuration that turns off a framework rule makes `verify` fail. | CHECK-REQ-006 | Local |

## 5. Portability note

The rules enforce one target-neutral surface (CORE-REQ-005's subpaths, SQL-REQ-002's subset); only `allowed-imports`' list of rejected platform packages and Hono platform modules names platforms. A new target adds its platform SDK, driver and Hono adapter packages to that list; its target subpath needs no new rule, because app code may import only the framework subpaths of its CORE-REQ-005 row. The migration checker compares the two supported dialects; a target with a third dialect would add one history and one database to it (CHECK-REQ-004).
