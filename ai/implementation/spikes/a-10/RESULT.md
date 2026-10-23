# Spike A-10 — dependency pins install and work together

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

**Question.** Do the pinned versions PAR-100…PAR-109 install and work together on Node 22.22 in this
sandbox, and which exact versions should PAR-111 (Node, TypeScript, ESLint), PAR-112 (Zod),
PAR-113 (Vite), PAR-114 (Playwright) and PAR-116 (test runner and glob) be? Also: does PGlite give
C collation?

**Verdict.** All existing pins work together; nothing needed replacing. Proposed new pins:
Node 22.22.0, TypeScript **6.0.3** (not 7.x; typescript-eslint excludes it), ESLint 10.13.0 +
typescript-eslint 8.72.0, Zod 4.6.7, Vite 8.3.4, Playwright 1.64.1, Vitest 5.0.5 with glob
`tests/**/*.test.ts`. Two findings for later items: (1) Wrangler 4.149.0 ships **Miniflare
5.20261006.1-alpha**, whose constructor API differs from Miniflare 3/4 (README is outdated);
`getPlatformProxy` from `wrangler` works and is the simpler path for `createTestApp`. (2) PGlite's
default database orders by code point (`datcollate = C`) but has `datctype = C.UTF-8`, so `lower()`
folds non-ASCII (`lower('ÀB') = 'àb'`); a database created with `LC_CTYPE 'C'` folds only ASCII
(`'Àb'`), as sql.md §2 assumes. Nothing touched the cloud.

Everything is local only. Throwaway code; not a workspace member. Raw output: `out/` (ANSI codes
stripped, worktree path replaced by `<repo>`; no credentials appear in any output).

## Environment

- Node v22.22.0, npm 10.9.4 (`out/node-version.txt`); registry `https://registry.npmjs.org/` through the
  sandbox proxy (CA bundle `/root/.ccr/ca-bundle.crt`, already configured; no extra settings needed).
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is preset in this sandbox.
- `ip` (iproute2) is **not installed** in this sandbox, so plan §10.2's `ip link set lo up` fails.
  `scripts/offline.sh` brings loopback up with an ioctl via `python3 -I scripts/lo-up.py` instead.
  Usage: `unshare -rn sh scripts/offline.sh <command…>`.

## Versions installed (exact, `package.json`; tree in `out/npm-ls.txt`)

| Dependency | Version | Pin | Notes |
| --- | --- | --- | --- |
| sst | 4.17.2 | PAR-100 | `npx sst version` → `sst 4.17.2` |
| wrangler | 4.149.0 | PAR-101 | latest is 4.151.2 (2026-10-19); kept the pin |
| drizzle-orm | 0.45.4 | PAR-102 | |
| drizzle-kit | 0.31.11 | PAR-103 | |
| hono | 4.13.13 | PAR-104 | |
| aws4fetch | 1.0.20 | PAR-105 | |
| jose | 6.2.12 | PAR-106 | |
| @electric-sql/pglite | 0.5.8 | PAR-107 | latest 0.5.10; kept the pin. Reports `PostgreSQL 18.3 (PGlite 0.5.8)` |
| @pulumi/cloudflare | 6.15.0 | PAR-108 | pulls `@pulumi/pulumi` 3.270.0 when installed directly; SST's own platform uses 3.215.0 |
| @pulumi/aws | (not installed) | PAR-109 | AWS phase not started; `sst install` downloaded provider plugin `resource-aws-v7.20.0` |
| zod | 4.6.7 | PAR-112 | latest 4.x (published 2026-10-12) |
| typescript | 6.0.3 | PAR-111 | 7.0.2 is latest but `typescript-eslint@8.72.0` peer range is `>=4.8.4 <6.1.0` |
| eslint | 10.13.0 | PAR-111 | |
| typescript-eslint | 8.72.0 | PAR-111 (new) | peer `eslint ^8.57 \|\| ^9 \|\| ^10` |
| vite | 8.3.4 | PAR-113 | engines `^20.19 \|\| >=22.12` |
| vitest | 5.0.5 | PAR-116 | peer `vite ^6.4 \|\| ^7 \|\| ^8`; engines `^22.12 \|\| ^24 \|\| >=26` |
| @playwright/test | 1.64.1 | PAR-114 | Chrome Headless Shell 156.0.8078.4 (`chromium-headless-shell v1248`) |
| @types/node | 22.20.5 | (new, framework/tests only) | latest 22.x line, matches Node 22 |
| miniflare | 5.20261006.1-alpha | (new) | exactly what wrangler 4.149.0 depends on; workerd 1.20261006.1 deduped |
| @cloudflare/workers-types | 5.20261006.1 | (new, framework dev only) | needed to type-check framework code that calls Miniflare's API (see below) |

`npm audit`: 4 moderate, all from `drizzle-kit`'s `@esbuild-kit/*` → old esbuild (dev-server CORS
advisory GHSA-67mh-4wv8-2f99). drizzle-kit never runs that dev server here; accepted for a dev tool
(`out/npm-audit.txt`).

## Commands and results

All from `ai/implementation/spikes/a-10/` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md).

| # | Command | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `npm install` | 420 packages, no peer errors (deprecation warnings for `@esbuild-kit/*` from drizzle-kit only) | `out/npm-ls.txt` |
| 2 | `npx vitest run --reporter=verbose` | **6/6 pass** (PGlite + drizzle; `CREATE DATABASE … C`; getPlatformProxy D1+R2+drizzle-d1; Miniflare 5 direct D1+R2; fake timers; zod) | `out/vitest.txt` |
| 3 | `unshare -rn sh scripts/offline.sh npx vitest run` | **6/6 pass with no network** | `out/vitest-offline.txt` |
| 4 | `sh scripts/dev-smoke.sh` (`wrangler dev` + curl) | all endpoints OK: Hono routing, Zod 400 on bad input, jose HS256 sign/verify, aws4fetch SigV4 sign, Drizzle on local D1, R2 put/get | `out/wrangler-dev.txt` |
| 5 | `unshare -rn sh scripts/offline.sh sh scripts/dev-smoke.sh` | same, **offline** (`Ready on http://127.0.0.1:8799`, every endpoint OK) | `out/dev-offline.txt`, `out/wrangler-dev-offline.txt` |
| 6 | `npm run typecheck` (app set: `lib ES2023+DOM`, `types: []`; node set: `types: ["node"]`) | exit 0 both | `out/typecheck.txt` |
| 7 | `npx eslint src test e2e client *.config.ts` (typescript-eslint `strictTypeChecked`, type info via `parserOptions.project`) | exit 0 | `out/eslint-good.txt` |
| 8 | `npx eslint fixtures/bad.ts` | exit 1: `no-explicit-any`, `ban-ts-comment` fire | `out/eslint-bad.txt` |
| 9 | `npx drizzle-kit generate --config drizzle.{sqlite,pg}.config.ts` (`casing: "snake_case"`) | both dialects generated | `out/drizzle-kit.txt`, `drizzle/` |
| 10 | `npx vite build` | built (99 modules, 0.4 s) | `out/vite-build.txt` |
| 11 | `npx playwright install chromium` | downloaded from cdn.playwright.dev through the proxy | `out/playwright-install.txt` |
| 12 | `npx playwright test` (webServer: `wrangler dev` + `vite` with `/api` proxy) | **2/2 pass**: page served by Vite fetched `/api/health` from the Worker through the proxy | `out/playwright.txt` |
| 13 | `unshare -rn sh scripts/offline.sh npm run e2e` | **2/2 pass offline** | `out/playwright-offline.txt` |
| 14 | `node scripts/pulumi-import.mjs` | `@pulumi/cloudflare` 6.15.0 imports; `WorkersScript`/`R2Bucket`/`D1Database` exported | `out/pulumi-import.txt` |
| 15 | `cd sst-app && npx sst install --stage spikea10` | `✓ Installed providers`; `.sst/provider-lock.json` = cloudflare 6.15.0; `.sst/platform/package.json` pins `@pulumi/cloudflare 6.15.0`, `@pulumi/aws 7.20.0`, `@pulumi/pulumi v3.215.0`; plugins under `~/.config/sst/plugins` | `out/sst-install.txt` |
| 16 | A-09's sql.d.ts checks recompiled with TypeScript 6.0.3 (copy of `a-09/` resolved against this spike's drizzle-orm 0.45.4; copy removed afterwards) | identical to A-09's 5.9.3 / 7.0.2 results: as-is → same 5 errors; revised contract → exit 0 | `out/a09-checks-ts6-*.txt` |

`sst install` downloads Pulumi and provider plugins (GitHub / Pulumi hosts) but makes no Cloudflare
API call and creates nothing. No deploy was attempted (A-01 covers SST against the cloud).

## Findings

1. **TypeScript 6.0.3, not 7.x.** TypeScript 7.0.2 is the npm `latest`, but typescript-eslint 8.72.0
   (latest) declares `typescript >=4.8.4 <6.1.0`, and CHECK's rules need typescript-eslint with type
   information (check.md §2). 6.0.3 is the highest version inside that range. A-09's typing results
   are the same on 6.0.3.
2. **Miniflare 5 alpha.** Wrangler 4.149.0 depends on `miniflare@5.20261006.1-alpha`. Its constructor
   takes `{ workers: [{ config: { name, compatibilityDate, manifest: { mainModule, modules }, env: { DB: { type: "d1" }, FILES: { type: "r2" } } } }] }`;
   the Miniflare 3/4 shape (`modules`, `script`, `d1Databases`, `r2Buckets`) is rejected with a Zod
   "Unrecognized keys" error. `getD1Database`/`getR2Bucket`/`dispatchFetch`/`dispose` still work.
   `getPlatformProxy({ configPath, persist: false })` from `wrangler` reads `wrangler.jsonc` and gives
   working D1/R2 bindings in Node with no Miniflare-specific config; recommended for `createTestApp`.
   Pin `miniflare` (if imported directly) to exactly the version wrangler depends on so there is one
   workerd.
3. **Miniflare's `.d.ts` imports `@cloudflare/workers-types`** without depending on it; without it the
   R2 types degrade (`tsc` error: `put` does not exist on `Request_2<any>`). Installing
   `@cloudflare/workers-types@5.20261006.1` as a framework dev dependency fixes it; it is not added to
   any `types` array, so the app lib set stays free of workers-types (CHECK §2).
4. **PGlite collation.** Default DB: `datcollate = C`, `datctype = C.UTF-8`, `datlocprovider = c`;
   text ordering is code-point (`B < a < b < é`, same as D1). But `lower('ÀB')` = `àb` (Unicode
   folding) under the default ctype, contradicting sql.md §2's "lower() under the C collation folds
   only ASCII". `lower('ÀB' COLLATE "C")` = `Àb`. `CREATE DATABASE appdb TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`
   works in PGlite, and `PGlite.create(dir, { database: "appdb" })` opens it with `lower('ÀB') = 'Àb'`
   (`out/pg-lower.txt`). So the PGlite harness must create and use such a database (as MIG §2 does on
   Postgres), or `containsText` must apply `COLLATE "C"`.
5. **SST pins confirmed.** The SST 4.17.2 binary embeds `@pulumi/cloudflare 6.15.0` and `@pulumi/aws
   7.20.0` (PAR-108/109 notes are right). Installing `@pulumi/cloudflare` as an npm dependency is not
   needed for SST itself (SST installs its own copy in `.sst/platform`), and doing so pulls a newer
   `@pulumi/pulumi` (3.270.0) than SST's (3.215.0).
6. **Offline.** `wrangler dev`, Vitest (PGlite, Miniflare) and Playwright + Vite all run inside
   `unshare -rn` once loopback is up. Wrangler prints "Proxy environment variables detected" but does
   not need the network for local dev.
7. **Vitest** runs in Node with `pool: "forks"` (one process per file), supports `vi.useFakeTimers()` /
   `vi.setSystemTime()` (governs `Date.now`, as core.md §2 needs), and keeps Playwright specs separate
   by glob (`e2e/**/*.spec.ts` for Playwright, `test/**/*.test.ts` for Vitest here). Running the suite
   once per dialect = two `vitest run` processes with an env var selecting the dialect (B-16).

## Leftovers

None in the cloud. Local only: `node_modules/`, `sst-app/node_modules/`, `sst-app/.sst/` (gitignored),
`~/.config/sst/` (SST's Pulumi/plugins cache), `/opt/pw-browsers/` (Playwright browser).
