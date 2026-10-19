# Root cause: MIG-AC-002 / MIG-AC-003 local deploy tests — "expected exactly one local D1 database, found 2"

Author: diagnosing subagent (prompt §8 step 1); did not write the code or the tests. Date: 2026-10-19. Diagnosis only: no code or test changed. Needs independent review (§8 step 2) before any fix.

## Tests explained
In `packages/framework/test/integration/mig/deploy-local.test.ts`:
1. `[MIG-AC-002] local: the initial deployment creates the schema; a second one with no changes …`
2. `[MIG-AC-003] local: a supported schema change, including a column drop on a table with child rows, preserves every row and reference not explicitly dropped`
3. `[MIG-AC-003] local: a data-dependent failing migration (unique over duplicates) fails the deployment …`: a knock-on failure of test 2. It never reaches its own assertions.

## Symptom
Phase-B run (`validation/local/phase-B/05a-integration-vitest-json.log` lines 1790–1819, same in `04-test-integration.log`):
- Tests 1 and 2: `Error: expected exactly one local D1 database, found 2: <app>/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04b…4248.sqlite, <app>/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite`, thrown by `onlyD1Database` (`mig/local-d1.ts:66`). It is called from `deploy-local.test.ts:98` (test 1) and `:140` (test 2).
- Test 3: `AssertionError: depends on the previous test's version 2 deployment: expected undefined to be defined` (`deploy-local.test.ts:165`).

Reproduced on this branch (commit `origin/claude/implement-local-cloudflare` at branch point) with `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/mig/`, after `npm ci` and a framework build. It failed the same way with identical messages: 4 failed, 2 passed (the 4th failure is the separate cause in `2026-10-19-MIG-AC-001-seed-literal-ids-fail-framework-ids.md`).

## Evidence
1. **Minimal reproduction without the framework.** A scratch dir holds a `wrangler.jsonc` with one D1 binding (`DB`) and a trivial worker. The script calls wrangler's `getPlatformProxy({ persist: true })`, runs one batch (`CREATE TABLE t`, one `INSERT`) and disposes. It then lists every file under `.wrangler/` and dumps `sqlite_master` and rows of each `.sqlite`. Output (verbatim, trimmed to the D1 and cache dirs):
   ```
   FILE /.wrangler/state/v3/cache/miniflare-CacheObject/metadata.sqlite
       table _cf_ALARM | CREATE TABLE _cf_ALARM ( actor_id TEXT PRIMARY KEY, scheduled_time INTEGER, actor_name TEXT ) WITHOUT ROWID
       rows _cf_ALARM []
   FILE /.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e833abeb…7854.sqlite
       table t | CREATE TABLE t (id TEXT PRIMARY KEY)
       table _cf_METADATA | …
       rows t [{"id":"a"}]
   FILE /.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite
       table _cf_ALARM | CREATE TABLE _cf_ALARM ( … ) WITHOUT ROWID
       rows _cf_ALARM []
   ```
   With exactly one D1 database, the D1 namespace directory holds two `.sqlite` files. One is the database (`<hash>.sqlite`, with the data). The other is `metadata.sqlite`, which holds only workerd's per-namespace Durable Object alarm table `_cf_ALARM`. The same file appears in the Cache namespace, which has no D1 at all, so it is per-namespace storage metadata and not a database. Versions: wrangler 4.149.0, miniflare 5.20261006.1-alpha (from `package-lock.json`).
2. **Miniflare itself treats it as non-database.** `node_modules/miniflare/dist/src/workers/local-explorer/explorer.worker.js:8834` (also 14982, 15074) lists Durable Object instances as `entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite"`.
3. **The helper counts every `.sqlite` file.** `mig/local-d1.ts:21`, `d1DatabaseFiles` keeps any file whose name ends in `.sqlite` under `.wrangler/…/d1/`, with no exclusion. `onlyD1Database` (`:64–68`) throws when the count is not 1.
4. **The phase-B failure paths match evidence 1 exactly.** The second file in the error is `…/d1/miniflare-D1DatabaseObject/metadata.sqlite` (symptom).
5. **Test 3 depends on test 2.** `afterV2` is assigned only at `deploy-local.test.ts:150`, after the throw at `:140`. Test 3 starts by asserting `afterV2` is defined (`:165`).
6. **Confirming experiment** (temporary edit, reverted, not committed): add `&& entry !== "metadata.sqlite"` to the filter at `local-d1.ts:21` and change nothing else. `npx vitest run … mig/deploy-local.test.ts` then gives **3 passed (3)**, exit 0. This covers the in-place schema change, the failing unique-constraint migration (dev exits non-zero, the snapshot is unchanged, exactly one database file), the old version answering again and the re-run after correcting data. After the revert, `git status` is clean.

## Cause → symptom chain
1. Miniflare/workerd persists every Durable Object namespace (D1 is one: `miniflare-D1DatabaseObject`) as one `<object-id>.sqlite` per object plus one `metadata.sqlite` per namespace (evidence 1, 2).
2. `d1DatabaseFiles` counts every `.sqlite` in that directory, so it returns 2 for an app with one D1 database (evidence 3, 4).
3. `onlyD1Database` throws on count ≠ 1 before any snapshot is taken. Tests 1 and 2 fail at their first snapshot (symptom; lines 98 and 140).
4. Test 2 never assigns `afterV2`, so test 3 fails its precondition (evidence 5).
5. Removing only link 2 makes all three pass (evidence 6). Nothing else is needed for them to pass.

## Code or test?
The test helper is wrong. The code is not. DEC-0144 (B-07-3 merged with B-T2-7) defines "no new database behind" as "exactly one local D1 database file", and `metadata.sqlite` is not a D1 database file (evidence 1, 2). The framework's `dev` applied migrations in place to the single database: once the helper is corrected, schema, rows and record match (evidence 6). This is consistent with MIG-AC-002/-003 in `docs/components/migrations.md` and with DEC-0144.

## Alternatives ruled out
- **The framework creates a second database or copy.** Ruled out. The second file appears with plain wrangler and no framework code (evidence 1). Its only table is `_cf_ALARM`, with no app or framework tables. The framework's generated wrangler config has one D1 binding (`env.DB`, as listed by `dev` in B-RUN `08-dev-server.log` for the template app).
- **A leftover from an earlier run or another test.** Ruled out. Each suite uses a fresh `mkdtemp` dir (`/tmp/fw-b-t2-*`), and the minimal reproduction in an empty dir shows the file after a single run.
- **Timing (the file appears only while `dev` runs).** Ruled out. The reproduction lists files after `dispose()`, and the file persists.
- **The schema change or the applier being wrong.** Ruled out by evidence 6: all of MIG-AC-002/-003's local assertions pass once the count is fixed.

## Proposed fix (test only)
In `packages/framework/test/integration/mig/local-d1.ts`, `d1DatabaseFiles` should exclude Miniflare's per-namespace `metadata.sqlite`. The rule is the same one Miniflare's explorer uses: `entry !== "metadata.sqlite"`. Add a comment citing this record. To keep the check strict, a database file could also be required to match `/^[0-9a-f]{64}\.sqlite$/`. Either way, a real second D1 database would still be counted. No framework change.

## Verification plan (red-green, §8 step 3)
1. Red: a small helper test (or the existing suite) on an app dir after one `dev` run shows `d1DatabaseFiles` returning 2 with the current filter.
2. Green: with the fix it returns exactly the `<hash>.sqlite` file, and `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/mig/deploy-local.test.ts` passes 3/3.
3. Keep the discriminating power. A mutation that leaves a second real D1 database file (for example, copy the `<hash>.sqlite` under another 64-hex name) must still make `expect(d1DatabaseFiles(dir)).toHaveLength(1)` fail.
