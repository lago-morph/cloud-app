# Release-1 cleanup of `claude/better-auth` (2026-10-25)

Back to [ARCHIVE-INDEX.md](../ARCHIVE-INDEX.md). These 591 files were moved here from branch `claude/better-auth` at commit `bd249784397a6f48186ced617e359758dbfa06c9` ("Cloudflare pass-auth-2 summary (orchestrator)"). The working branch dropped them in `claude/ba-cleanup` (`e5b0f53`). Every file keeps its original path. Read one with `git show origin/archive/implement-local-cloudflare:<path>`, or read the original tree with `git show bd24978:<path>`.

**Why archived.** Neither `tests/compliance/tools/report.mjs release` nor `report.mjs traceability` reads any of these records. Both reports were generated before and after the move: release at `bd24978`, at `dc00996` (Cloudflare pass-auth-2) and at `3162bd4` (local `xiu1uitdbzr2rx1`), plus traceability. No result changed. Root-cause records, evaluations, the final report or kept summaries still cite each item, so it was archived, not deleted. Each citing document on the working branch has an "**Archived 2026-10-25**" line under its title. The decision log, and comments in two test files, name `k9cc5zjcbm5mrkc` by run ID only. They were not edited.

**What stays on the working branch.** Each criterion's latest evidence stays there:
- local: `xiu1uitdbzr2rx1`;
- Cloudflare: `wxnforn019mo5ic`, `ykpjdoi5gccpsdv` and `g8np1sdqoq1yvgz` (folder `pass-auth-2/`), and the older trace and milestone records `xdryowrec3lephb` (`pass-1c/`), `xxiuurmy40pnr33`, `e22y1n7jn93xoz4`, `6e5ya5y8z05u4ce` and `0reagqr1j01rqfv` (`pass-M/`);
- records that something there still names: `g7586p3q4x45qyc` (`apps/demo/BUILD-RECORD.md`) and `r5nndia2aediccu.json` (a comment in `tests/compliance/criteria/mig/support/stage.ts`);
- folders cited by the decision log or the skill: `pass-0/`, `pass-1b/`, `pass-1c/` and `pass-2to5/`.

**Deleted outright, not here (in git history at `bd24978` only).** Nothing cited these:
- local runs `wgsciwwk0kx1ue7` (first full better-auth run, `e50ad72`, 13 not passed, superseded by `xiu1uitdbzr2rx1`) and `2043kegjz5b6nx1` (partial `--only` run, `263c8f7`);
- `lcmb7dvqcml3z4l` (`a191f9c`, full, 109 passed) with its runner folder `validation/local/final-local-release1/`;
- `ai/implementation/spikes/ba-s1-s3/package-lock.json`;
- the integrated decision-draft maps `ai/implementation/decisions/fix-{auth005,cloudtests,envtoken,pass1,r2order,sec001}.md`. Their DEC IDs are in `docs/decisions/decision-log.md` under each entry's `Item:` line.

Abbreviations: "rc/" means `ai/implementation/root-causes/`, "eval/" means `ai/implementation/evaluations/`, "FR" means `ai/implementation/final-report.md`, and "rel" means `validation/release/2026-10-24-33b3df7.md`. Result counts are passed / failed / blocked / not-run.

## Cloudflare: the first better-auth pass (superseded by `pass-auth-2/`)

| Path | Commit, date | What | Result | Superseded by | Cited by | You need it when |
|---|---|---|---|---|---|---|
| `validation/cloudflare/k9cc5zjcbm5mrkc.json` + `k9cc5zjcbm5mrkc/raw/` | `1d9623e`, 2026-10-25 07:28 | full cloud run (`npm run compliance -- --target cloudflare`), added in `402ea7a` | 49 / 13 / 12 / 2, exit 1. Failed: AUTH-AC-005, -006, -011, -014, CLI-AC-007, E2E-005, -007, -008, FILES-AC-003, PROV-AC-002, PWD-AC-008, -009, SEC-AC-005 | `wxnforn019mo5ic` | rc/2026-10-25-cf-error-1000-client-cf-connecting-ip, rc/2026-10-25-pwd-ac-008-burst-split-over-egress-ips (its evidence run); the decision log DEC-0528/DEC-0529 (run ID); comments in `tests/compliance/criteria/prov/deploy-sequence.test.ts` and `tests/compliance/harness/driver.unit.test.ts` | checking the Error 1000, PWD-AC-008 burst or prodcheck deploy-record diagnoses against the raw output |
| `validation/cloudflare/y5cuhf8fwk5khtd.json` + `raw/` | `1d9623e`, 2026-10-25 07:31 | milestone `--only PROV-AC-004,MAIL-AC-007` | 0 / 1 / 1 / 7, exit 1. Failed: MAIL-AC-007 | `ykpjdoi5gccpsdv` | `pass-auth/SUMMARY.md` | the first MAIL-AC-007 milestone failure |
| `validation/cloudflare/pass-auth/` (76 files: `SUMMARY.md`, step logs, `trace-1-full.log`, `measure/`, `sstlogs-*`, `readings.txt`, `tooling/`) | added `402ea7a`, `3f7ae9b` | the runner's logs for the two runs above | see records | `pass-auth-2/` | the two rc/ above, `pass-auth-2/SUMMARY.md` ("Fixed since pass-auth") | the request trace or SST logs of the first pass |

## Cloudflare: pre-auth passes (2026-10-23/24) whose records the reports no longer read

| Path | Commit, date | What | Result | Cited by | You need it when |
|---|---|---|---|---|---|
| `validation/cloudflare/pass-1/` (14 files) | added `cb18845`, 2026-10-23 | pass 1: the first deploy of stage R fails at step 3 (SST "Target not found: Files") | no driver record | rc/2026-10-23-pass1-sst-target-not-found, eval/D-cloudflare | the SST `--target` diagnosis |
| `validation/cloudflare/cleanup-R/` (16 files) | added `65ce779`, 2026-10-23 | removal of run stage R (`test-wxezkd4j5ye3oio`), before and after readings | no driver record | eval/D-cloudflare, FR | showing that stage R left nothing behind |
| `validation/cloudflare/pass-B/` (44 files) + records `5fgih0buv8i5tc3` (PROV-AC-001), `5kjbwwwpf3mvj95` (COMPL-AC-004), `ghref0pc0a9bwmp` (MIG-AC-002/003/006), `5swm2wowq7t3yho` (PROV-AC-002) | `24327c7`, 2026-10-24 04:23–04:45; added `5650063`, `d780c02` | pass B, no run stage | `5fgi…` and `5kjb…` 1 passed each, `ghref…` 3 passed; `5swm…` 0 / 0 / 1 / 69 | eval/D-cloudflare, eval/final, FR (`5swm…`) | the pass-B results per criterion |
| `validation/cloudflare/pass-C/` (80 files) + records `gblenqeyh7kuls5` (FILES), `651l3x1zgz7pbx5` (SEC-AC-001, HTTP-AC-002, SEC-AC-005) | `321e41c`, 2026-10-24 05:51–05:56; added `807ec12`, `360cb92` | pass C on stage `test-byxa6sar2ps05po` | `gblen…` 6 / 1 (FILES-AC-003) / 0 / 64; `651l…` 2 / 1 (SEC-AC-005) / 0 / 67 | eval/D-cloudflare, eval/final, FR | the FILES-AC-003 or SEC-AC-005 cloud failures of pass C |
| `validation/cloudflare/f-03/` (72 files) + records `vn8cm0ie7v2rhul` (Cloudflare smoke), `kbe5rzjb8ls9p8z` (local smoke, `validation/local/`), `nu3lt4mhjsn4ihq` (DEMO), `pqc4u7j4o1g4rpb` (DEMO-AC-008) | `321e41c`, 2026-10-24 06:01–06:06; added `807ec12`, `360cb92` | F-03: the demo deployed, smoke run on Cloudflare and locally, DEMO criteria on Cloudflare | all passed (7, 7, 7, 1) | eval/D-cloudflare, eval/final, FR, rel | the demo's deploy and smoke logs |
| `validation/cloudflare/pass-C1/` (66 files) + record `5nfl3uhrzxpuz4m` | `ad0e252`, 2026-10-24 06:41; added `6c98591`, `9283b7a` | E2E-009 re-run on a fresh stage after the R2 U+0001 key fix | 1 passed | eval/D-cloudflare, eval/final, FR | closing C-1 |
| records `cwcrlz8fxgo3ud4`, `5tr1c8w0x1b9lai`, `2nl855v5sscoqls`, `0ljocvikeb16ebm` (folder `pass-2to5/` stays on the working branch) | `71ac98d`, 2026-10-24 04:00–04:11 | passes 2–5 on stage `test-9mfkg261apxm7s2` | `cwcr…` 2 / 3 (HTTP-AC-002, SEC-AC-001, SEC-AC-005) / 1 / 64; the others 1 passed each (CF-AC-002, CLI-AC-005, E2E-014) | rc/2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early, rc/2026-10-24-pass2-SEC-AC-005-next-request-version-rollout, eval/D-cloudflare, eval/final, FR, `pass-2to5/SUMMARY.md` | the raw output of the pass-2 secret failures |
| record `sysad9rajoir4yt` (folder `pass-1c/` stays on the working branch) | `93e6d7d`, 2026-10-24 03:51 | milestone `--only PROV-AC-004` on stage R | 0 / 0 / 1 / 11 | rc/2026-10-24-G6-release-milestone-misread, eval/D-cloudflare, eval/final, FR, rel, `pass-1c/SUMMARY.md` | the G6 milestone-misread diagnosis |

## Local: superseded full runs

| Path | Commit, date | What | Result | Cited by | You need it when |
|---|---|---|---|---|---|
| `validation/local/final-local-4/`, `validation/local/batch-verify-4/` + record `pzeugkxrk1xcu2w` | `a5b2164`, 2026-10-21; added `8c53e2c` | full local compliance and online/offline `verify`, before better-auth | 109 passed, 2 not-run, exit 0 | eval/final, FR | comparing with the pre-auth local baseline |
| `validation/local/final-local-5/`, `validation/local/batch-verify-5/` + record `kex4v2xk3522i52` | `1b474c1`, 2026-10-24; added `5d7dc8f`, `ce53772` | the same at `1b474c1` (R5, BV5; L1 closed) | 109 passed, 2 not-run, exit 0 | eval/final, FR, rel | F-EV update 5's local basis |
| record `nhtt0ff3xx72qvn` | `75b68b9`, 2026-10-23 | `--only MIG-AC-002,MIG-AC-003,MIG-AC-006,PROV-AC-006,COMPL-AC-004,E2E-010,E2E-012,…` | 5 passed, 2 blocked, 102 not-run, exit 1 | eval/final | the local re-check of those criteria |

## Spike and decision map

| Path | Added | What | Cited by | You need it when |
|---|---|---|---|---|
| `ai/implementation/spikes/ba-s1-s3/logs/` (19 logs) | `0870783`, 2026-10-24 | output of spike BA-S1/S3 (+ S2 offline): Better Auth on workerd/D1 and PGlite, bundle sizes, scrypt timings, compatibility probes. The code, SQL and `RESULT.md` stay on the working branch; `package-lock.json` was deleted | `ai/implementation/spikes/ba-s1-s3/RESULT.md` | checking a number in `RESULT.md` against the run's output |
| `ai/implementation/decisions/fix-pass0.md` | `515b723`, 2026-10-23 | map of item fix-pass0's drafts to DEC-0421 and DEC-0422 | rc/2026-10-23-pass0-F1-r2-api-delete-traversal-403 | the draft-to-DEC mapping for fix-pass0 (also in the decision log under `Item: fix-pass0`) |
