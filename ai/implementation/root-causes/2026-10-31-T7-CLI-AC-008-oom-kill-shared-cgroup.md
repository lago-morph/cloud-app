# Root cause: CLI-AC-008 failed in T1's full local run because the cgroup OOM killer ended the template's "no repository" `verify` mid-run. Every bash command of the session's concurrent agents shares one 13.4 GiB memory cgroup. Environment, not code.

Author: item T7 (diagnosis, plan-v0.2.0 §7a.1.8 step 1), 2026-10-31. Base: `origin/v0.2.0/71n-path-map-after-removals` (PR #134) at `60b5e8e`. T1's failing run was on `origin/v0.2.0/75-setup-criteria-tests` at `93eab74` (71n plus T1's tests). Node 22.23.4, Chromium shim per progress §6, local apiKey set on stdin (DEC-0779). I wrote none of the code or tests involved.

## Symptom
T1's full run `npm run compliance -- --target local` (run `elfokkdfd656tww`, 12:05:33–13:22:34 UTC, evidence under the session scratchpad `full2/validation/local/`) records CLI-AC-008 `failed`, 1 of 5 tests:

```
[CLI-AC-008] verify on the template: not ignored, tracked (and listed in .gitignore), clean and outside a repository; …
AssertionError: no repository, run 1: exit status equals the clean run's
verify: type checking: passed … verify: zod version: passed (4.6.7)
verify: tests (sqlite): passed (19 passed, 0 failed, 0 skipped)
verify: tests (postgres)
: expected -1 to be +0
```

The output stops after `verify: tests (postgres)`, with no verdict line.

## Evidence
1. **`-1` means the process ended by a signal.** `git-warnings.test.ts:221` maps a result to `r.status ?? -1`. `runCommand` (`tests/compliance/criteria/core/support/processes.ts:39–58`) resolves `status` from the child's `close` event, which is `null` when the child was killed by a signal.
2. **Not the test's own timeout.** On timeout, `runCommand` appends `[c-t1] timed out after <ms> ms` to the output and kills the group. T1's `vitest.log` has 0 occurrences of `timed out after`. Each verify's limit is 10 min (`git-warnings.test.ts:209`). The whole test took 666 s for four verifies.
3. **A cgroup OOM kill at the same second.** `vitest.json` of T1's run: the `git-warnings.test.ts` file ran 12:16:46.523 → **12:27:58.599** UTC. The "no repository" verify is the last of its four. `dmesg -T`:
   - `[Sat Oct 31 12:27:58 2026] … oom_memcg=/process_api/01a1909e-…/claude-code-bash … Memory cgroup out of memory: Killed process 21556 (node)`
   - a second kill followed at 12:28:08 (pid 21422, `node`).

   Boot time (`btime` 1793427642 = 06:20:42 UTC) plus uptime matches the wall clock, so the `dmesg -T` times are accurate.
4. **The cgroup is shared and was full.** `/sys/fs/cgroup/memory/process_api/01a1909e-…/claude-code-bash/` holds every bash command of this Claude Code session, so every concurrent subagent (68 processes when read):
   - `memory.limit_in_bytes` 14341885952 (13.36 GiB);
   - `memory.max_usage_in_bytes` 14341890048 (the limit reached);
   - `memory.failcnt` 8856470, `oom_kill` 6.

   The machine has 4 CPUs and no swap. The load average was 19–29 during my runs.
5. **The same mechanism, seen again.** At 13:49–13:54 UTC the kernel logged four more cgroup OOM kills of `node` processes. In that window, my `apps/demo` verify's postgres step crashed (`[vitest-pool]: Worker forks emitted error`, its file not run), and the same verify passed cleanly when re-run with more memory free (CHECK-AC-005 record, evidence 4).
6. **Not reproducible without memory pressure.** On `60b5e8e`:
   - `--only CHECK-AC-005,CLI-AC-008,CORE-AC-001,E2E-016,SEC-AC-002` (run `hv2yas3d80t67es`): CLI-AC-008 **passed**, 5 of 5; the template verify part took 278 s.
   - My full local run, at load ~29: CLI-AC-008 **passed**, 5 of 5; the template part took 573 s.
7. **Nothing in the code path changed.** `git diff --stat origin/main...60b5e8e -- tests/compliance/criteria/cli/git-warnings.test.ts packages/framework/src/provision/cloudflare/git-safety.ts packages/framework/src/cli/cloudflare-settings.ts packages/framework/src/cli/commands/verify.ts apps/template` shows only `apps/template/package.json | 2 --` (two npm scripts of removed commands). The git-warning logic and `verify` are unchanged since main, where CLI-AC-008 passed. The other three conditions of the same test (not ignored, clean, tracked) passed in T1's run. Only the condition whose process was killed differs.

## Causal chain
1. The session runs many agents at once. All of their bash commands share one memory cgroup limited to 13.36 GiB, and it hit the limit (evidence 4).
2. At 12:27:58 the kernel's cgroup OOM killer killed a `node` process (evidence 3). That was the moment T1's CLI-AC-008 file ended, while its last verify ("no repository") was in its postgres tests step (Symptom).
3. The killed verify had `status: null`. The test recorded `-1`, with no timeout marker (evidence 1, 2).
4. `-1` ≠ the clean run's `0`, so the assertion failed (Symptom). With the memory available, the same test passes, alone and in a full run (evidence 6).

## Alternatives ruled out
- **A defect in the git warnings or in `verify`.** No. The three other conditions passed in the failing run. The test passes in two runs on the same code. The output shows no failing step, only a truncated one (evidence 6, 7).
- **The test's own 10-min timeout.** No. There is no timeout marker in the output, and the file's total time does not reach the limit for that verify (evidence 2).
- **A test-order or shared-state effect from T1's added tests.** Unlikely, and no evidence for it. The added files (`auth/*`, `setup/bootstrap-v020.test.ts`) do not touch the template copy or git. The failure is a signal exit, which no assertion in another test can cause. The OOM kill matches to the second (evidence 3).
- **Covered by a pending PR.** No. None of #143, #150, #123 or T2's 78–81 touches CLI-AC-008 or the runner's memory.

## Proposed fix
No code or test change. It is an environment cause (class c):
- **Runner rule.** Run `npm run compliance -- --target local` (full) only when no other heavy job (another compliance run, an app `verify`, an e2e run) is running in the same session's sandbox. Or treat a run that overlapped one as unreliable, and re-run the affected IDs alone. Before reporting a `-1` exit status as a failure, check the kernel log for a cgroup OOM kill in the test's window: `dmesg -T | grep 'Killed process'`. This belongs in the orchestration notes (progress §6, owned by R). It is listed as open.
- **Optional harness improvement, not made here.** `runCommand` could append `[c-t1] ended by signal <name>` when `close` reports a signal, so a killed child is named in the evidence. It is outside T7's owned paths, so it is listed as a suggestion for S3 / the harness owner, not an item.

## Similar cases (§7a.1.8 step 4)
- **Disk, the other shared resource.** My full run on `60b5e8e` (run `pe62vhrw8mv2yhe`, 13:35–14:24 UTC) also failed E2E-003 and E2E-009. Neither failed in T1's run.
  - E2E-003's output shows `verify failed (exit 228)` with `npm error code ENOSPC … no space left on device` at 14:18.
  - E2E-009 failed with `download.saveAs: canceled` while saving a 100 MB download.
  - `df -h /` then showed 1.1 GB free (98%). The session's agents share one disk too, and my own four extra worktrees (about 575 MB of `node_modules` each) were part of the load. Removing them freed it to 3.1 GB.

  Same class and the same runner rule: a full local run needs free disk (several GB for scratch copies and downloads) as well as memory. A run that hits ENOSPC is unreliable for the IDs that failed then. These two IDs are not in T1's list. I did not diagnose them further, and they need a clean re-run.
- **E2E-004 on 71n alone.** E2E-004's coverage part failed in my run because AUTH-AC-012, AUTH-AC-013 and AUTH-AC-015 have no tagged test on 71n. T1's PRs #131/#132 add those tests, and T1's run on branch 75 did not fail E2E-004. This is covered, not environmental.

## Verification plan
- Re-run `npm run compliance -- --target local --only CLI-AC-008` with no concurrent heavy job. Expect 5 passed, as in `hv2yas3d80t67es`.
- On any future `-1` (null status) in a CLI criterion, the kernel log shows a matching `Killed process` line in the test's window. If none appears, this record does not explain that failure, and it needs its own diagnosis.

## Review
Status: awaiting review
