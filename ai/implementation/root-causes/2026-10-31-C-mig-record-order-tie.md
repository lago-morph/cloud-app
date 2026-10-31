# Root cause: MIG-AC-003 (postgres) fails when two migrations are recorded in the same millisecond. The test lists the record `ORDER BY applied_at, id`, and on a tie `id` puts `app/…` before `framework/…`.

Author: item C (diagnosis, §7a.1.8 step 1), 2026-10-31. Found on CI of PR #82 (`v0.2.0/32-admin-app-deploy`, head `fb7dfbf`), job 124488069162 (run 41184351223). Item C changed no file under `packages/framework/src/mig/`.

## Symptom
`npm run test:unit` on CI: 1 failed, 2554 passed. The failing test is `packages/framework/src/mig/apply.unit.test.ts > postgres > [MIG-AC-003] local: a data-dependent failing migration … a re-run after correcting the data succeeds`, at line 146:

```
- Expected  + Received
    "framework/0000_framework_tables",
    "framework/0001_auth_tables",
    "framework/0002_framework_test_mail",
-   "framework/0003_auth_role",
    "app/0000_schema",
+   "framework/0003_auth_role",
    "app/0001_schema",
```

The same test passed on CI for PRs #72 and #73 and locally (3 of 3 runs, unchanged code).

## Evidence
- **The test reads the record in a sorted order:** `const record = () => h.rows('SELECT * FROM "__framework_migrations" ORDER BY applied_at, id')` (`apply.unit.test.ts:92`). At line 146 it expects that order to equal the apply order (the framework migrations, then the app's).
- **`applied_at` is epoch milliseconds** (`mig/framework.ts:10`; a `bigint` or `integer` column). It comes from `clock()` (`apply.ts:65`, default `Date.now`), read once per migration.
- **Reproduction with the clock frozen.** `apply.unit.test.ts:127` was changed so the first `applyMigrations(h.db, v1)` passes the clock `() => 1_000` (all its migrations then get the same `applied_at`), and the test run with `-t MIG-AC-003`. Both dialects failed with the CI diff: `"app/0000_schema"` moved ahead of `"framework/0003_auth_role"`. With the file restored, 3 runs of 3 passed.
- **The tie order matches the diff exactly.** `framework/0003_auth_role` and `app/0000_schema` are the last migration of the framework history and the first of the app's, applied one after the other by the same call. With equal `applied_at`, `id` decides, and `"app/…" < "framework/…"`.
- **No production code orders the record by `applied_at`:** `grep -rn "ORDER BY applied_at\|applied_at, id" packages tests` finds only `apply.unit.test.ts:92`.

## Causal chain
1. `applyMigrations` records each migration with `applied_at = clock()` in milliseconds. Shown by `apply.ts:65` and `framework.ts:10`.
2. On a fast machine, two consecutive migrations in one call can be recorded within the same millisecond. Shown by the CI diff, which places exactly the two neighbouring migrations out of order, and reproduced deterministically by freezing the clock.
3. The test's `ORDER BY applied_at, id` breaks the tie by `id`, which is not the apply order across the `framework/` and `app/` prefixes. Shown by the frozen-clock run.
4. Line 146 compares that order with the apply order and fails. Shown by the CI log.

## Alternatives ruled out
- **A change by item C:** C's PRs touch only `provision/cloudflare/**`, `cli/commands/cloudflare-setup*`, `admin-app/**`, the SETUP criteria and docs tables. Nothing under `mig/` or `sql/` changed (`git diff origin/main...fb7dfbf --stat -- packages/framework/src/mig packages/framework/src/sql` is empty).
- **A wrong apply order in `applyMigrations`:** `result.applied` (line 145) and the earlier MIG-AC-002 check pass. With the frozen clock, only the `ORDER BY` read is out of order.
- **PGlite nondeterminism:** the frozen-clock reproduction fails identically on SQLite, so it is not dialect-specific. Postgres only showed it on CI by chance of timing.

## Proposed fix (outside item C's owned paths: a new item, not fixed here; §7a.1.8 step 4)
The test owns the defect: it assumes `applied_at` is strictly increasing. There are two possible fixes:
- **In the test:** make the expectation order-independent of ties, for example by giving the test's applies a strictly increasing fake clock (`let t = 0; () => ++t`). The assertion stays as strong.
- **In `applyMigrations`** (if MIG specs require the record's order to be recoverable): record `applied_at = max(previous + 1, clock())` within one call.

The first is the minimal fix. The second changes recorded data and needs the MIG owner's decision. In either case, check the other `apply.unit.test.ts` tests that read `record()`; they have the same latent tie.

## Verification plan
- **Red:** with the frozen clock `() => 1_000` at line 127, both dialects fail as above.
- **Green:** after the fix, the same frozen-clock variant and an unmodified run pass.
- **CI:** the `verify` job passes on the next push.

## Review
(pending: an independent reviewer session)
