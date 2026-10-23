# Root cause: MIG-AC-002 / MIG-AC-003 local deploy tests — "expected exactly one local D1 database, found 2"

Author: diagnosing subagent (prompt §8 step 1); did not write the code or the tests. Date: 2026-10-19. Diagnosis only: no code or test changed. Needs independent review (§8 step 2) before any fix.

## Tests explained
In `packages/framework/test/integration/mig/deploy-local.test.ts`:
1. `[MIG-AC-002] local: the initial deployment creates the schema; a second one with no changes …`
2. `[MIG-AC-003] local: a supported schema change, including a column drop on a table with child rows, preserves every row and reference not explicitly dropped`
3. `[MIG-AC-003] local: a data-dependent failing migration (unique over duplicates) fails the deployment …`: a knock-on failure of test 2. It never reaches its own assertions.

## Symptom
Phase-B run (`validation/local/phase-B/05a-integration-vitest-json.log` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) lines 1790–1819, same in `04-test-integration.log`):
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

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). Did not diagnose this failure or write the code or tests. Date: 2026-10-19. No code or test changed.

**Verdict: ACCEPTED.**

Reasons:
1. **Link 1 (Miniflare writes `metadata.sqlite` per namespace) independently reproduced.** In a scratch dir outside the repo, with only `wrangler@4.149.0` and `miniflare@5.20261006.1-alpha` (the `package-lock.json` versions) and no framework code, `getPlatformProxy({ persist: true })` with one D1 binding, one batch (`CREATE TABLE t`, one insert) and `dispose()` leaves exactly three `.sqlite` files: `cache/miniflare-CacheObject/metadata.sqlite`, `d1/miniflare-D1DatabaseObject/metadata.sqlite` and `d1/miniflare-D1DatabaseObject/e833abeb…7854.sqlite`. The D1 `metadata.sqlite` holds only `_cf_ALARM (actor_id, scheduled_time, actor_name) WITHOUT ROWID`. That is workerd's Durable Object alarm table, not a database. The same file exists in the Cache namespace, which has no D1. Miniflare's own explorer excludes `metadata.sqlite` when it lists Durable Object instances (`explorer.worker.js:8834`, `:14982`, `:15074`, confirmed).
2. **Links 2–4 confirmed by reading the code.** `d1DatabaseFiles` (`local-d1.ts:21`) keeps every `*.sqlite` under `.wrangler/…/d1/`, and `onlyD1Database` throws when the count is not 1. `afterV2` is set only after the throw point, so the third test's failure is a knock-on.
3. **The question asked of this review: does MIG-AC-002/-003 mean to catch this file, and should `dev` prevent it?** No, on both counts.
   - **What the criterion means.** MIG-AC-003's "no new database behind" is about the deployment leaving a copy or second database (the Cloudflare copy-and-migrate path, migrations.md §2). DEC-0144 makes local application in place ("no copy and no second database"). The merged B-T2 reading turns this into "exactly one local D1 database file".
   - **What creates the file.** Wrangler/workerd create `metadata.sqlite` for every persisted Durable Object namespace, whether or not the app has D1 and before any migration runs. It is not a database the framework creates.
   - **Can the framework stop it?** The framework's own code makes no database files or copies: `src/` has no `copyFile` or `.sqlite` writes, `dev` only passes `--persist-to .wrangler/state` and `getPlatformProxy({ persist })`, and the applier runs in place. `dev` could avoid the file only by turning off persistence, and local.md / LOCAL-REQ-002 forbid that. So the file is not something `dev` should prevent, and excluding it does not loosen the criterion.
4. **The fix addresses the cause and keeps the check strict.** Exclude `metadata.sqlite`, and preferably also require `^[0-9a-f]{64}\.sqlite$`. A real second D1 database would still be counted. The verification plan's mutation step (copy the database under another 64-hex name and expect the length-1 assertion to fail) has to be carried out, not skipped, so the assertion's discriminating power is shown.
5. **Alternatives.** Leftover state, timing and a framework-made copy are ruled out with evidence (fresh `mkdtemp` dirs; the file persists after `dispose()`; the plain-wrangler reproduction). The diagnoser's confirming experiment (3/3 passing with only the filter changed) shows no second cause is hidden behind this one.

Minor note, not a reason to reject: the wording "exactly one local D1 database file" comes from B-T2's merged draft inside DEC-0144 (decision-log.md:1127), not from DEC-0144's main paragraph. The record cites both, so this is fine.

## Fix

Author: test-case author (prompt §8 step 3); did not write the framework code, the diagnosis or the review. Date: 2026-10-20. No framework code changed.

### What changed (commit `b6cfc80`, branch `claude/implement-local-cloudflare-fix-mig`)
- `packages/framework/test/integration/mig/local-d1.ts`: `d1DatabaseFiles` skips files named exactly `metadata.sqlite` (constant `NAMESPACE_METADATA`, with a comment citing this record). Only that name is skipped. Every other `.sqlite` file under `.wrangler/…/d1/` still counts, including any `<64 hex>.sqlite` D1 database, so the check is no looser for real databases.
- The test assertions are unchanged.

### Red (before the fix, framework built, `origin/claude/implement-local-cloudflare` at `0d658e1`)
`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/mig/`: 4 failed, 2 passed. MIG-AC-002 and the first MIG-AC-003 test failed with `Error: expected exactly one local D1 database, found 2: …/d1/miniflare-D1DatabaseObject/9ba2b04b…4248.sqlite, …/d1/miniflare-D1DatabaseObject/metadata.sqlite`. The second MIG-AC-003 test failed with `depends on the previous test's version 2 deployment: expected undefined to be defined`. This matches the recorded symptom.

### Green
Same command with both fixes (this record and MIG-AC-001's): **6 passed (6)**, exit 0.

### Mutation check (review point 4)
Temporary edit to the MIG-AC-002 test, not committed and reverted with `git checkout`: after the second `dev` stopped, the real database file was copied under a 64-hex name in the same directory, and `expect(d1DatabaseFiles(dir)).toHaveLength(1)` was asserted. Output, verbatim:
```
MUTATION files: [
  '/tmp/fw-b-t2-nI2icA/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite',
  '/tmp/fw-b-t2-nI2icA/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.sqlite'
]
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
      Tests  1 failed | 2 skipped (3)
```
So the corrected helper still detects a genuine second D1 database, and only `metadata.sqlite` is excluded. After the revert, `git status` was clean.
