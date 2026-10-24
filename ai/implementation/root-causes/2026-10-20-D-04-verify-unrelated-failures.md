# D-04: `npm run verify` failures outside D-04's files (2026-10-20)

## Symptom
On branch `claude/implement-local-cloudflare-d-04`, `npm run verify` exited 1 twice:
- online: 4 tests timed out at vitest's default 5,000 ms — `kv/service.unit.test.ts` (KV-AC-003/-004 2.5 pages),
  `sql/postgres.unit.test.ts` ("gives every call its own empty database"), `sql/queries.unit.test.ts` (postgres
  SQL.UNAVAILABLE);
- offline (`unshare -rn sh scripts/offline.sh npm run verify`): the same kind of timeouts (also
  `cli/verify/type-check.unit.test.ts`) plus 8 failures in `evidence/writer.unit.test.ts`.
No D-04 test (`provision/cloudflare/d1/**`, `mig/cloud/**`) failed in either run.

## Evidence
- `uptime` during the runs: load average 16–23 on `nproc` = 4. `ps` showed other worktrees' vitest, eslint,
  workerd, playwright and a scaffolded app's `prototype-framework verify` taking most CPU (other agents).
- The three timing-out files run alone (no D-04 file in the run) still had one timeout ("gives every call its own
  empty database", 6,086 ms) at load ≈ 19.
- The five failing files pass with only the timeout raised:
  `npx vitest run --config vitest.unit.config.ts --testTimeout=60000 <the 5 files>` → 5 files, 74 tests passed.
- Offline evidence-writer failures: `Error: Command failed: git … commit -q -m init` with
  `failed to call MCP server … Post "http://127.0.0.1:45463/mcp": dial tcp 127.0.0.1:45463: connect: connection refused`.
  `git config commit.gpgsign` = `true`, `gpg.format` = `ssh`: commits are signed through a helper on the host's
  loopback, which the network namespace of `offline.sh` cannot reach.

## Causal chain
1. Other agents' test runs load the shared 4-CPU machine (ps, uptime) → 2. tests with vitest's 5 s default that
   start PGlite/KV/tsc take longer than 5 s (timeouts reproduced without D-04 files; pass with 60 s) → 3. verify
   exits 1. Separately: offline namespace → signing helper unreachable (connection refused) → `git commit` in the
   evidence tests' temporary repositories fails.

## Alternatives ruled out
- D-04's added test files causing the load: the timeout reproduced in a run containing none of them.
- A code defect in KV/SQL/evidence: the same tests pass with a longer timeout and online.

## Proposed fix
None in D-04 (files not owned). For the orchestrator: run verify when the machine is not shared, or give the
PGlite/KV/type-check tests explicit timeouts (their owners); for offline runs, the evidence tests need
`-c commit.gpgsign=false` in their temporary repositories (owner of `evidence/**`).

## Verification plan
Re-run `npm run verify` (online and offline) on an idle machine after the fix; expect 0 failures.

## Review
**ACCEPTED**: diagnosis accepted, proposed fix made concrete below. Independent reviewer (prompt §8 step 2), 2026-10-20,
branch `claude/implement-local-cloudflare-rc-verify-review`. No code or tests changed. Scratch scripts only in the session scratchpad.

**(b) Offline evidence-writer failures. Test defect (non-hermetic), not a product defect.**
- `git config --show-scope` shows that `commit.gpgsign=true`, `gpg.format=ssh` and `gpg.ssh.program=/tmp/code-sign` all
  come from the *global* `/root/.gitconfig`. The test helper `git()` in `evidence/writer.unit.test.ts` passes only
  `-c user.email`/`-c user.name`, so its temporary repo inherits the developer's signing setup. Even online, every
  `commit` in the test calls a loopback MCP signing helper. That breaks the unit layer's "No network" rule
  (`vitest.unit.config.ts`).
- Reproduced: `unshare -rn sh scripts/offline.sh npx vitest run … evidence/writer.unit.test.ts` fails with the record's
  `connection refused` at 127.0.0.1:45463. With only `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false`,
  the same offline run passes 9/9. With `GIT_CONFIG_GLOBAL=/dev/null` it also passes 9/9. Online it passes 9/9.
- Product code does not depend on signing. `gitState()` in `evidence/writer.ts` runs only `git rev-parse HEAD` and
  `git status --porcelain`, and nothing else in `writer.ts` calls git. No other unit test makes git commits (grep).
- **Correct fix:** make the test hermetic in `packages/framework/src/evidence/writer.unit.test.ts` only. Add
  `-c commit.gpgsign=false` to the helper. Better: run the helper's git, and the `gitState()` calls made in the
  test, with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, for example by setting them in `process.env`
  in `beforeAll` and restoring them in `afterAll`. That also shields the test from other global settings. No
  assertion changes. Red step: the offline run above.

**(a) Timeouts under load. Machine load is causal. No defect found in the code or the tests.**
The record supports this link mostly by correlation. These reviewer experiments close it:
1. Contention reproduced. Load average was ~10 for the baseline. 8 extra busy-loop processes were then added and
   `kv/service` + `sql/postgres` were rerun:
   - KV/sqlite "2.5 pages": 2,378 → 5,212 ms, over the default;
   - KV/sqlite "limit above PAR-222": 1,866 → 3,202 ms;
   - KV/postgres "2.5 pages": 10,178 → 13,334 ms (the first postgres test also pays the per-process template in its
     `beforeEach`).
   Durations grow with CPU contention, as in the B-05 review.
2. Where the time goes in each test body. `--testTimeout=2500` and `--testTimeout=1000` at load ~13–17 show which
   bodies, not only hooks, are long. All of them do expensive work inside the test body, by design:
   - postgres "gives every call its own empty database": two PGlite loads, ~0.5 s each when idle (B-05), and the two
     loads are what the test checks;
   - postgres "closed harness … SQL.UNAVAILABLE": one PGlite load;
   - queries "a database that cannot be reached": `open()` in the body, which is a PGlite load or a whole workerd via
     `getPlatformProxy`;
   - KV "2.5 pages", "limit above", "maximum page": 50–61 *sequential* `put`s, each a round trip to workerd or PGlite;
   - `type-check`: a real tsc run, 1.2–2.3 s at load ~10. Its offline timeout was not reproduced here.
3. Product defect ruled out by reading the code. `kv.put` is a single upsert statement (`kv/service.ts`).
   `openPostgres()` already memoises the C/C template per process (`sql/postgres.ts`, the B-05 fix), so no
   cheaper-template fix is left to make. `nice -n -20` cut durations only slightly (the workerd children do the
   work), which is consistent with contention.
- **Correct fix:** give an explicit, commented per-test timeout (e.g. 30 s, citing this record and the measured
  costs) to exactly these tests:
  - `packages/framework/src/kv/service.unit.test.ts`: "2.5 pages", "limit above PAR-222", "maximum page";
  - `packages/framework/src/sql/postgres.unit.test.ts`: "gives every call its own empty database" and
    "a query on a closed harness database";
  - `packages/framework/src/sql/queries.unit.test.ts`: "a database that cannot be reached";
  - the tsc-running tests in `packages/framework/src/cli/verify/type-check.unit.test.ts`.
  This does not weaken them: no spec requirement bounds these latencies, every assertion is unchanged, and a hang
  still fails. Moving the database opens into hooks is not correct for the two postgres tests or the queries test,
  because opening is the behaviour under test. Batching the KV puts would change the reverse insertion order the
  "2.5 pages" test relies on. A global `testTimeout` raise in `vitest.unit.config.ts` would be broader than needed.
  "Run verify when the machine is not shared" is not a fix.
- Verification: rerun the touched files under +8 busy loops, then run `npm run verify` online and offline.
