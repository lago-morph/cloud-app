# Fix: D-04 `npm run verify` failures outside D-04's files (2026-10-20)

This file is the **Fix** section for the root-cause record
`ai/implementation/root-causes/2026-10-20-D-04-verify-unrelated-failures.md` and its accepted **Review**. Both are on
branch `claude/implement-local-cloudflare-rc-verify-review`, which also carries D-04 code that is not merged yet,
so this section is kept in its own file. Prompt §8 step 3. Fix branch: `claude/implement-local-cloudflare-fix-verify`,
from `origin/claude/implement-local-cloudflare`. Only test files changed. No product code changed and no assertion changed.

## Fix (b): evidence-writer unit test made hermetic (commit `9d866f4`)
`packages/framework/src/evidence/writer.unit.test.ts`:
- `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` are passed in the `git()` helper's `env`.
- They are also set in `process.env` in `beforeAll` and restored in `afterAll`, so the `gitState()` calls under
  test read the same isolated config.
- The helper already passes `-c user.email`/`-c user.name`, so no other identity config is needed.

- **Red** (before the change): `unshare -rn sh scripts/offline.sh npx vitest run --config vitest.unit.config.ts packages/framework/src/evidence/writer.unit.test.ts`
  → `Tests  9 failed (9)`, with 72 occurrences of
  `dial tcp 127.0.0.1:45463: connect: connection refused`. The record said 8 failures; this run had 9.
- **Green:** the same command → `Tests  9 passed (9)`. Online → `9 passed (9)`.

## Fix (a): explicit 30 s timeouts on the slow tests the Review names (commit `7eef8a8`)
Each timeout has a comment that cites the record, Review (a):
- `kv/service.unit.test.ts`: "2.5 pages", "limit above PAR-222" and "maximum page", through the constant
  `MANY_PUTS_TIMEOUT_MS`. These run on both sqlite and postgres.
- `sql/postgres.unit.test.ts`: "gives every call its own empty database" and "a query on a closed harness database",
  through `PGLITE_LOAD_TIMEOUT_MS`.
- `sql/queries.unit.test.ts`: "a database that cannot be reached", for both dialects.
- `cli/verify/type-check.unit.test.ts`: all three tests, since each one runs tsc, through `TSC_TIMEOUT_MS`.

The load test used the four files plus 8 extra `while :; do :; done` loops on `nproc` = 4. The script was in the
session scratchpad.

| Test | Before (load ≈ 22 + 8 loops) | After (load 8.5 → 19 + 8 loops) |
|---|---|---|
| type-check `[CLI-AC-002]` | 8,788 ms **timed out** | 6,370 ms ✓ |
| KV/sqlite "limit above PAR-222" | 7,549 ms **timed out** | 12,967 ms ✓ |
| postgres "gives every call its own empty database" | 6,410 ms **timed out** | 14,191 ms ✓ |
| KV/sqlite "2.5 pages" | 4,336 ms ✓ | 17,513 ms ✓ |
| KV/sqlite "maximum page" | 5,060 ms ✓ | 13,495 ms ✓ |
| Result | 3 failed, 62 passed | 2 failed, 63 passed (see below) |

**Outside this fix, reported and not changed.** The "after" run was more heavily loaded than the reviewer's runs.
In that run, two tests that the Review does **not** name also passed 5 s:
- `sql/postgres.unit.test.ts > PGlite harness > opens a fresh database created with LC_COLLATE 'C' and LC_CTYPE 'C'`:
  6,379 ms, `Test timed out in 5000ms.`
- `kv/service.unit.test.ts > KV on sqlite > [KV-AC-001][KV-AC-004] list matches the prefix literally and case-sensitively, in code point order`:
  11,112 ms, `Test timed out in 5000ms.`

Every test that got a timeout passed in that run. Giving these two tests timeouts needs its own §8 record and
review. This fix does not do it.

## Verification: full `npm run verify` on this branch
- **Online:** exit 0, load ≈ 17–21. Framework unit tests: `Test Files 140 passed (140)`, `Tests 1407 passed (1407)`.
  Both apps reported `verify passed`, with sqlite and postgres at 52 passed, 0 failed.
- **Offline** (`unshare -rn sh scripts/offline.sh npm run verify`): exit 0. Same results: 1407/1407, and both apps
  `verify passed`. D-03 reported a Miniflare socket error offline; it did **not** occur in this run.
