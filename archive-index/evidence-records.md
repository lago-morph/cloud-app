# Evidence records (compliance-driver output)

Back to [ARCHIVE-INDEX.md](../ARCHIVE-INDEX.md). Each record is `validation/local/<runId>.json` (run ID, commit, target, command, start and finish, `exitStatus`, one `{id, status}` per criterion) plus `validation/local/<runId>/raw/` (`build.log`, `typecheck.log`, `vitest.json`/`.log`, sometimes `vitest-unit.*`, `playwright.json`/`.log`, `dev.log`, `expected.json`, sometimes `run-errors.log`). The runner logs for each run are in [validation-runs.md](validation-runs.md).

All targets are `local`; all dates are 2026-10-20. None of these is a `--milestone` record, so archiving them changes no regenerated release report. "rc/" means `ai/implementation/root-causes/`; "eval/" means `ai/implementation/evaluations/`.

| Run ID | Commit | Command scope | Passed / failed / not-run | Failed IDs | Runner dir | Cited by | You need it when |
|---|---|---|---|---|---|---|---|
| `xc3s44jl2dbmqpv` | `4ff83c4` | full | 79 / 4 / 26, exit 1 | CHECK-AC-003, CLI-AC-002, E2E-004, MIG-AC-001 | phase-C-run | eval/C-local.md, rc/2026-10-20-{CLI-AC-002-MIG-AC-001, E2E-004 (reproduces from `raw/expected.json`), FILES-AC-003}, comment in `tests/compliance/harness/selection.unit.test.ts` | re-running the E2E-004 coverage scan, or reading C-RUN 1 raw output |
| `zcvgtq52o8niagx` | `0528fe4` | full | 91 / 2 / 17, exit 1 | E2E-004, FILES-AC-003 | phase-C-run-2 | eval/C-local.md, rc/2026-10-20-FILES-AC-003 | the FILES-AC-003 Playwright and `dev.log` timeline |
| `qrst96in89gbitx` | `1833e24` | full | 96 / 1 / 13, exit 1 | E2E-004 | phase-C-run-3 | eval/C-local.md (record "R") | the phase-C local gate, per-criterion |
| `2au29i3yycjzbas` | `4d73f39` | `--only SKILL-AC-001…005,CHECK-AC-003` | 6 / 0 / 103, exit 1 | none (exit 1 from a Where-parser error, `raw/run-errors.log`) | phase-E-run | eval/E.md, rc/2026-10-20-{COMPL-AC-001-where-parser, F-02-round-1} | the phase-E gate, or the Where-parser error |
| `emckebxm5x3kxd1` | `8d65a70` | full | 98 / 2 / 12, exit 1 | DEMO-AC-009, E2E-004 | final-local | eval/final.md (R1), rc/2026-10-20-{demo-ac-009, mig-ac-002-workerd-crash} | DEMO-AC-009 history |
| `cmzgvk4zb2o6ako` | `ed1f51b` | `--only DEMO-AC-001…011,E2E-002,E2E-004` | 13 / 0 / 96, exit 0 | none | demo-rerun (deleted; only in git history at `c512ad6`) | eval/final.md (R2) | demo re-check after the DEMO-AC-009 fix |
| `q3qgbyunuxaz1fw` | `26128b1` | full | 109 / 0 / 2, exit 0 | none | final-local-2 | eval/final.md (R3), rc/2026-10-20-mig-ac-002-workerd-crash | F-EV2's basis |
| `r5nndia2aediccu` — **`raw/` only**; the `.json` stays on the working branch | `760e7b7` | full | 108 / 1 / 2, exit 1 | MIG-AC-002 | final-local-3 | the run ID is cited by final-report.md (U1), eval/final.md (R3b), the release report, rc/2026-10-20-mig-ac-002-workerd-crash, comment in `tests/compliance/criteria/mig/support/stage.ts`; no one cites `raw/` by path | open defect U1 recurs: read `raw/dev.log` and `raw/vitest.log` for the workerd crash |
