# C-T6 decisions (test-case author: CLI-AC-003 compliance-runner part; AWS not-run parts)

Ad-hoc item from the Phase C evaluation (`ai/implementation/evaluations/C-local.md`, Flags 1 and 2). Tests written from CLI-REQ-003 / CLI-AC-003 (`docs/components/cli.md`) and the driver section of `docs/components/compliance.md`, not from the driver's code. The driver was not changed.

### DEC-PENDING-C-T6-1 — Level and placement of the runner's CLI-AC-003 tests
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-003, tests/compliance/harness/driver.unit.test.ts

CLI-AC-003 speaks of *injected* failures, and it is in the driver's `UNIT_LEVEL` list, so the tests are unit tests of `runCompliance` with fake `DriverDeps` (the existing `harness()` fake in `driver.unit.test.ts`; no network, no Cloudflare). They are in a new `[CLI-AC-003]` describe block of that file, each title tagged `[CLI-AC-003]`, so the local run's unit layer folds them into CLI-AC-003 only. "The compliance runner's cleanup" is read as: stopping `dev` (local), removing the test stage, and the leftover check (cloud).

### DEC-PENDING-C-T6-2 — Readings of "non-zero exit statuses that reflect the original failure"
Origin: ai-proposed · Status: accepted · Affects: CLI-AC-003

- A failing tagged test: the run exits with the test runner's status (1 in the fake), and the record's `exitStatus` equals it.
- An original failure plus a failing cleanup: the exit status is still the original one (1), the record is still written, the original failure stays the recorded reason, and the cleanup failure is reported (raw remove log, `leftovers`, stage kept in the pending list).
- A cleanup failure after tests that all passed is a partial failure (CLI-REQ-003: "including partial failures"; `remove` with leftovers exits 1), so the run must exit non-zero. The exact value is not fixed by the criterion; the test asserts non-zero and that the record's `exitStatus` matches the process status.

### DEC-PENDING-C-T6-3 — Two tests failed against the driver; driver fixed, tests unskipped
Origin: ai-proposed · Status: accepted (resolved by the driver fix) · Affects: CLI-AC-003, tests/compliance/harness/driver.ts, tests/compliance/harness/cli.ts

The C-T6 test author found two `[CLI-AC-003]` tests failing and committed them as `it.skip` (the author does not change the code under test, prompt §7):

1. Local: when `dev`'s `stop()` rejected after a failing test, `runCompliance` threw out of its `finally` block. No record was written and `cli.ts` exited 64 (usage-error status), losing the original status 1.
2. Cloud: when every test passed but stage removal failed (leftovers remained) or the leftover check failed, the run exited 0.

Root cause and fix: `ai/implementation/root-causes/2026-10-20-CLI-AC-003-driver-cleanup-failures.md` (Review: ACCEPTED; Fix section). The driver now guards `local.stop()` (error text in raw `dev.log`, `exitStatus ||= 1`) and, after cleanup, sets `exitStatus ||= 1` when `leftovers` is non-empty, which includes a leftover check that could not run. `||=` keeps an earlier non-zero (original) status. Both tests are unskipped with no other test change; no `it.skip` remains in the harness tests. The `cli.ts` header and the Driver paragraph of `docs/components/compliance.md` state the rule. Cloud runs must be started with `NODE_USE_ENV_PROXY=1` in this sandbox (DEC-PENDING-D-06-2), or the leftover check cannot run and every cloud run correctly exits 1.

Open follow-ups from the review (not done here): F1, `cli.ts` gives the usage status 64 to any runtime exception from `runCompliance`; F2, `deps.pendingStages.remove` in `removeStage` is unguarded, so a failure to persist the pending list stops the record from being written.

### DEC-PENDING-C-T6-4 — AWS not-run parts for CORE-AC-006 and SQL-AC-006
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-006, SQL-AC-006, tests/compliance/harness/expected.ts

`PHASE_RULES` gains two part rules on `local`, automated tier, detail `AWS phase not started` (plan §8.2), shaped like CHECK-AC-005's demo part: CORE-AC-006 part "AWS-bundle clause" (no AWS bundle yet) and SQL-AC-006 part "Data API retry-loop clause" (the Data API adapter is AWS code, not built). Only `local`: the SQL-AC-006 clause is stated as local and deterministic, and CORE-AC-006 is Local only; on Cloudflare SQL-AC-006 has no not-run part. The AWS phase removes both rules when it adds their tests.
