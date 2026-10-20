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

### DEC-PENDING-C-T6-3 — Two tests fail against the current driver; committed as `it.skip`
Origin: ai-proposed · Status: proposed (needs an implementer fix) · Affects: CLI-AC-003, tests/compliance/harness/driver.ts

Found failing (commit with the tests unskipped is in this branch's history):

1. Local: when `dev`'s `stop()` rejects after a failing test, `runCompliance` throws out of its `finally` block. No record is written and `cli.ts` exits 64 (usage-error status), losing the original status 1.
2. Cloud: when every test passes but stage removal fails (leftovers remain) or the leftover check fails, the run exits 0. The leftovers are recorded but the exit status does not show the partial failure.

The test author does not change the code under test (prompt §7), and `npm run verify` must stay green, so both tests are `it.skip` with a comment naming this decision. Each skipped tagged test adds a `not-run` entry to CLI-AC-003's record, so the record does not claim these parts passed. When the driver is fixed, unskip them (no other change needed).

### DEC-PENDING-C-T6-4 — AWS not-run parts for CORE-AC-006 and SQL-AC-006
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-006, SQL-AC-006, tests/compliance/harness/expected.ts

`PHASE_RULES` gains two part rules on `local`, automated tier, detail `AWS phase not started` (plan §8.2), shaped like CHECK-AC-005's demo part: CORE-AC-006 part "AWS-bundle clause" (no AWS bundle yet) and SQL-AC-006 part "Data API retry-loop clause" (the Data API adapter is AWS code, not built). Only `local`: the SQL-AC-006 clause is stated as local and deterministic, and CORE-AC-006 is Local only; on Cloudflare SQL-AC-006 has no not-run part. The AWS phase removes both rules when it adds their tests.
