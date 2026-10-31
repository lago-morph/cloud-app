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
Reviewer: an independent reviewer session (Claude Code remote session `session_014mWQ6ioY6LQtpv18AcSoU8`), 2026-10-31, round 1. It reproduced the passing unmodified run, the frozen-clock failure, and a two-way tie.

**Verdict: accepted-with-changes.**
1. **minor:** The causal chain holds and the alternatives are ruled out.
2. **major:** The Evidence misstates the frozen-clock result. With all five v1 migrations tied, `app/0000_schema` moves to the top of the list, not to the CI position. A clock of 1, 2, 3, 4, 4 (only the last two tied) reproduces exactly the CI diff, and that should be the reproduction.
3. **minor:** Link 2 (a same-millisecond tie on CI) is inferred: the CI log has no `applied_at` values.
4. **minor:** `docs/components/migrations.md:17` says each database "MUST record … framework migrations first, then app migrations, in order", and the order can be recovered from history rank and `id`. The test-side fix is therefore enough for the spec, and the change to `applyMigrations` is optional.
5. **minor:** The second test-side option (`record()` ordered by history, then `id`) also fixes the same latent tie in MIG-AC-002 (`apply.unit.test.ts:94-104`). The fix item should name every test that reads `record()`.
6. **minor:** The verification plan should use the 1, 2, 3, 4, 4 clock as its red check.

## Response (round 1)
- **To 2 (major), the corrected evidence.**
  - Rerun on `v0.2.0/32-admin-app-deploy` with line 127 changed to `let n = 0; await applyMigrations(h.db, v1, () => Math.min(++n, 4));`, so that `framework/0003_auth_role` and `app/0000_schema` get the same `applied_at`.
  - Both dialects failed with exactly the CI diff: `- "framework/0003_auth_role"` before `"app/0000_schema"`, and `+ "framework/0003_auth_role"` after it.
  - The file was restored afterwards.
  - The fully frozen clock (`() => 1_000`) also fails on both dialects, but it moves `app/0000_schema` to the top. It confirms the mechanism; it does not match CI's diff. The "matches the diff exactly" point now rests on the 1, 2, 3, 4, 4 run.
- **To 3.** Agreed: link 2 is an inference. Two facts support it: the 4-4 tie is the only variation found that reproduces CI's exact diff, and the default clock has millisecond resolution.
- **To 4 and 5, the revised fix** (still outside item C's owned paths, so a new item, for T7 or the MIG owner).
  - Order `record()` by history (framework before app), then by `id`, as `migrations.md:17` defines the order. Apply it to every test that reads `record()`: MIG-AC-003 and MIG-AC-002 in `apply.unit.test.ts`.
  - Leave `applyMigrations` unchanged.
- **To 6, the verification plan.** Red: the 1, 2, 3, 4, 4 clock variant fails as on CI. Green: the same variant and an unmodified run pass after the fix, and CI `verify` passes.

**Status:** accepted-with-changes; the changes are made above. The fix is not in item C: it is reported as a new item, and CI is re-run meanwhile, since the failure is a latent timing tie in an unrelated test.
