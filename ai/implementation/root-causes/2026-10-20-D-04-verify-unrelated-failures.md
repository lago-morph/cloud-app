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
(pending: independent reviewer)
