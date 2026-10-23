# Archive index: `archive/implement-local-cloudflare`

Written for AI agents. Read this file first, then open only the category index you need (level 2), then the files themselves (level 3).

## What this branch is

- **Content:** superseded test-run evidence and spike code from the local + Cloudflare implementation phase. Kept records still cite these files, but nothing on the working branches needs them any more.
- **Made:** 2026-10-23, by the cleanup of `claude/implement-local-cloudflare`. The owner asked for files that were no longer needed to be removed. Files that were to be deleted but that someone might still need were moved here.
- **Source:** branch `claude/implement-local-cloudflare` at commit `c512ad6a4c488e1af023ba4b0726ef13e77b2766` ("Merge F-EV3, release report at c016e7e and final report update"). Tag `archive-evidence-2026-10-23` points at that commit, so the full tree, including what is archived here, is at `git show archive-evidence-2026-10-23:<path>`.
- **Base:** `main`, plus only the archived files. **Every file keeps its original path.** A citation such as `validation/local/phase-B/SUMMARY.md` in a kept document resolves on this branch at the same path.
- **Not here (deleted outright, only in git history at the tag):** the spike `package-lock.json` files; the runs `validation/local/{batch-verify-1,batch-verify-2,demo-rerun,phase-D-merge}/` and record `iz5xn8erxm3l5ne`; the release reports `validation/release/2026-10-20-{3caff76,903d0f9}.md` (they can be regenerated with `tests/compliance/tools/report.mjs release --commit <sha>`); and the decision-draft maps `ai/implementation/decisions/*.md`, whose DEC IDs are listed in `docs/decisions/decision-log.md` under each entry's `Item:` line.
- **Still on the working branch (not archived):** the spike `RESULT.md` files; the root-cause records; the evaluations; the current evidence (`pzeugkxrk1xcu2w`, `final-local-4/`, `batch-verify-4/`, `g7586p3q4x45qyc`, and `r5nndia2aediccu.json` without its `raw/`); and the latest release report `2026-10-21-c016e7e.md`.

## Reading it without checking out

```sh
git fetch origin archive/implement-local-cloudflare
git show origin/archive/implement-local-cloudflare:ARCHIVE-INDEX.md
git show origin/archive/implement-local-cloudflare:archive-index/validation-runs.md
git ls-tree -r --name-only origin/archive/implement-local-cloudflare -- validation/local/phase-B
git show origin/archive/implement-local-cloudflare:validation/local/phase-B/SUMMARY.md
```

## Categories

| Category | Look here when … | Index | Files |
|---|---|---|---:|
| Validation runs | a document cites a runner directory such as `validation/local/phase-B/`, `phase-C-run*/`, `phase-E-run/`, `final-local{,-2,-3}/` or `batch-verify-3/`, or you need the exact commands, logs or exit codes of an earlier local run | [archive-index/validation-runs.md](archive-index/validation-runs.md) | 149 |
| Evidence records | a document cites a compliance-driver run ID (a 15-character ID such as `xc3s44jl2dbmqpv`) or its `raw/` output, or you need per-criterion results, `vitest.json`, `playwright.json` or `dev.log` of an earlier run; this includes the raw output of `r5nndia2aediccu` (the MIG-AC-002 failure, U1) | [archive-index/evidence-records.md](archive-index/evidence-records.md) | 82 |
| Spikes | the decision log (DEC-0083…DEC-0109) or a spike `RESULT.md` cites a spike's `logs/`, `out/`, scripts or source, or you want to re-run a phase-A spike | [archive-index/spikes.md](archive-index/spikes.md) | 310 |
