# Final local run, release 1 scope (local + Cloudflare), 2026-10-24

Written by the orchestrator from the runner's report (subagents may not write report files).

- **Run** `lcmb7dvqcml3z4l` at `a191f9c`, after the AWS target was removed from `main` (DEC-0508, branch `aws`). The record and raw logs are in `validation/local/lcmb7dvqcml3z4l.json` and `validation/local/lcmb7dvqcml3z4l/`.
- **Command:** `npm run compliance -- --target local`. Exit 0.
- **Result:** 109 passed, 0 not-run, 0 failed, 0 blocked. Playwright 42/42.
- **Change from earlier runs:** the 2 AWS-clause not-runs (CORE-AC-006 and SQL-AC-006) are gone, because those clauses are deferred with the AWS target.
- **The same commit also passed:**
  - `npm run verify`: exit 0, including build, typecheck and lint;
  - `npm run test:unit`: 1,820/1,820;
  - the files, build, core and cli integration suites: 62/62.
- **The release report** judges only local and Cloudflare. Still outstanding: a Cloudflare record for the release commit, and the local milestone records for E2E-015 and E2E-016 (G5).
- **The runner's own logs** for this folder were not committed, because the runner's worktree was removed. The record above is the evidence.
