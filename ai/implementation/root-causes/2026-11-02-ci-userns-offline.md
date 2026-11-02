# Root cause: CI `compliance` fails every offline test with `unshare: write failed /proc/self/uid_map: Operation not permitted`

Author: diagnosing subagent (`.claude/skills/testing-standards/resources/failure-diagnosis.md`, step 1). I did not write the code, the tests or the workflows. This is a diagnosis only: no code, test or workflow was changed. It needs an independent review (step 2) before anyone fixes it. No Cloudflare calls were made.

**Finding in one line.** The tests and the framework are not at fault. Under the GitHub-hosted `ubuntu-24.04` runner, `unshare -rn` runs as the unprivileged `runner` user. It can create the user namespace but cannot write its own `uid_map`, which is what Ubuntu 24.04's AppArmor user-namespace restriction (`kernel.apparmor_restrict_unprivileged_userns=1`) does. So `unshare` exits 1 before `scripts/offline.sh` runs. These offline tests had never run on GitHub Actions before the owner installed the v0.2.0 `ci.yml` (a632b8c, 2026-10-31). They fail the first time the path map selects them, on the same runner image as the last green run.

## Symptom

The `compliance` job of `.github/workflows/ci.yml` fails at the step "Criteria and scenarios through the compliance harness" in every run since 2026-10-31 that selects the offline tests:

| run / job | PR, head | compliance summary | failing tests |
|---|---|---|---|
| 41232661020 / 124629947865 | #164, af84816 | 63 passed, 60 not-run, **3 failed** | CLI-AC-002 (verify.test.ts), E2E-001 + LOCAL-AC-001 (E2E-001-E2E-003.spec.ts:87) |
| 41376381848 / 125067753380 (attempt 2) | #165, 0a8292e | 116 passed, 7 not-run, **3 failed** | same three |
| 41379125150 / 125065874957 | #166, 02dae34 | 94 passed, 31 not-run, **1 failed** | CLI-AC-002 (E2E-001 was not selected: 19 Playwright tests ran, all passed) |

`ci.yml` triggers only on `pull_request`, so "main is red" means the PR merge commits: af84816 (#164), then #165 and #166, which are merged into c8ecba1.

Failure text, identical in all three jobs (ANSI codes removed):

```
FAIL packages/framework/test/integration/cli/verify.test.ts > verify on the template > [CLI-AC-002] two consecutive verify runs with networking disabled give identical results
AssertionError: verify exit 1:

unshare: write failed /proc/self/uid_map: Operation not permitted
: expected 1 to be +0 // Object.is equality
 ❯ packages/framework/test/integration/cli/verify.test.ts:76:39
```

```
1) [e2e-ui] › tests/compliance/e2e/E2E-001-E2E-003.spec.ts:87:1 › [E2E-001][LOCAL-AC-001] a scaffolded app installs the framework ... with no credentials and no network
   Error: a cloud provider was reachable from the offline namespace:
   unshare: write failed /proc/self/uid_map: Operation not permitted
   Expected: 0
   Received: 1
   > 102 |   expect(probe.status, ...).toBe(0);
```

In #166 the same CLI-AC-002 failure is also reported by Vitest as an "Unhandled Error":

```
Error: write EPIPE
 ❯ Socket.end node:net:737:31
 ❯ packages/framework/test/fixtures/support/app.ts:215:17
    215|     child.stdin.end(options.stdin ?? "");
Serialized Error: { errno: -32, code: 'EPIPE', syscall: 'write' }
The last test to run before this error was "[CLI-AC-002] two consecutive verify runs with networking disabled give identical results".
```

## Evidence

The logs were fetched with the GitHub MCP `get_job_logs` (full logs: af84816 1076 lines, #165 1415 lines, #166 1380 lines, last green 672 lines). They were kept in my scratchpad (`/tmp/claude-0/-home-user-cloud-app/40acaefa-30e9-5664-9b0f-2d72e2fb0b88/scratchpad/logs/`), which is ephemeral. The excerpts here are the record.

### E1. The runner image did not change between the last green run and the failures

"Set up job" of each `compliance` job:

| job | result | Image | Image version | Provisioner | Region |
|---|---|---|---|---|---|
| 124622206075 (#163, 35a1278, 2026-10-31 18:34Z) | **success** | ubuntu-24.04 (Ubuntu 24.04.5 LTS) | 20261025.353.1 | 20261021.618 | westus |
| 124629947865 (#164, af84816, 19:07Z) | failure | ubuntu-24.04 | 20261025.353.1 | 20261021.618 | westus3 |
| 125067753380 (#165, 0a8292e, 2026-11-02) | failure | ubuntu-24.04 | 20261025.353.1 | 20261021.618 | eastus |
| 125065874957 (#166, 02dae34, 2026-11-02) | failure | ubuntu-24.04 | 20261025.353.1 | 20261021.618 | centralus |

`runs-on: ubuntu-24.04` is the same in the old and the new `ci.yml`, and in `release.yml`.

### E2. The last green `compliance` run did not select any offline test

The last green run's job env shows `IDS: SKILL-AC-001,…,SKILL-AC-008` and `DIRECT: packages/create-prototype-app/test tests/skill`. Its log has 0 occurrences of `unshare`. The failing runs select `CLI-AC-002` (and `CHECK-AC-005`, `E2E-001`, `LOCAL-AC-001` in #164/#165), with `DIRECT` including `packages/framework/test/integration/cli`.

### E3. No GitHub-hosted job had ever run `unshare` before a632b8c

- `unshare` is used only by `packages/framework/test/fixtures/support/app.ts:199` (`run(..., { offline: true })`, used only by `packages/framework/test/integration/cli/verify.test.ts`) and by `tests/compliance/e2e/E2E-001-E2E-003.spec.ts:60` (`offline()`). Found with `grep -rn "unshare\|offline.sh"` outside docs, and `grep -rln "offline: true\|OFFLINE_WRAPPER"`.
- The CI before the owner applied the v0.2.0 workflows (`.github/workflows/ci.yml` at a519cd8) ran: build, typecheck, lint, `test:unit`, the template and reference apps' `verify`, `tests/skill`, and `packages/create-prototype-app`. It ran no framework integration suite and no compliance harness.
- The release workflow, before v0.2.0 (228f122 for v0.1.0, d961306 for v0.1.1), ran `npm run verify` (the same list plus `tests/skill/example-pages.test.ts`) and `tests/skill packages/create-prototype-app`. It had no offline test.
- a632b8c "Apply the v0.2.0 workflows" (owner, 2026-10-31 13:28 -0500 = 18:28Z) replaced `ci.yml` with the classify/checks/compliance/verify layout. The first CI run on its base that selected the CLI suite or E2E-001 is af84816's, and it failed. Between a632b8c and af84816 the only `compliance` runs were 41229720004 (cancelled) and 41230005634 (green, skill-only selection, E2).

### E4. The error is printed by `unshare` itself, after `unshare(2)` succeeded and before `offline.sh` ran

- util-linux `unshare -r` (Ubuntu 24.04 ships util-linux 2.39.3, the same version as this sandbox) calls `unshare(2)` and then writes `0 <uid> 1` to `/proc/self/uid_map`, before `/proc/self/setgroups` and `gid_map` (order corrected in attempt 2, per the reviewer's strace). A failed `unshare(2)` prints `unshare: unshare failed: <errno>`. A failed map write prints `unshare: write failed <file>: <errno>`. The observed message is the second form for `uid_map`. So the namespace was created and the first map write, `uid_map`, was refused with EPERM.
- Experiment, to show that the message tells the two cases apart (this sandbox; a nested user namespace with `max_user_namespaces=0`, so nothing else is affected):
  ```
  $ unshare -Ur sh -c 'echo 0 > /proc/sys/user/max_user_namespaces && unshare -rn true; echo inner_rc=$?'
  unshare: unshare failed: No space left on device
  inner_rc=1
  ```
  So a kernel or seccomp refusal to create the namespace gives a different message from the CI one.
- In the kernel, a write to `uid_map` requires `CAP_SYS_ADMIN` in the new namespace (`map_write` → `file_ns_capable(..., CAP_SYS_ADMIN)`). The creator normally has every capability there. With Ubuntu's restriction on, an unconfined unprivileged process that creates a user namespace is moved to AppArmor's `unprivileged_userns` profile. That profile allows the namespace but denies every capability in it. So the `uid_map` write fails with EPERM. This is exactly the observed state: the namespace was created, and the map write was refused.
- External corroboration of the same symptom on Ubuntu 24.04 with the same mechanism (a user namespace plus a network namespace to cut networking):
  - AMD UG1144, "Workaround for uid_map error on Ubuntu 24.04": BitBake's `disable_network` fails with `Errno 1 Operation not permitted` when it "attempts to write to the file /proc/self/uid_map". The documented fix is `echo 0 > /proc/sys/kernel/apparmor_restrict_unprivileged_userns`. (https://docs.amd.com/r/en-US/ug1144-petalinux-tools-reference-guide/Workaround-for-uid_map-error-on-Ubuntu-24.04)
  - actions/runner-images#10443: `unshare(...)` gives `Operation not permitted` on the `ubuntu-24.04` hosted image. Running on 22.04 or in a privileged container works around it. (https://github.com/actions/runner-images/issues/10443)
  - Ubuntu's own description: unconfined applications may create user namespaces but are denied capabilities inside them, under the `kernel.apparmor_restrict_unprivileged_userns` knob (https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007; Qualys, https://www.qualys.com/2025/three-bypasses-of-Ubuntu-unprivileged-user-namespace-restrictions.txt).

### E5. The same tests pass where unprivileged user namespaces are not restricted

This sandbox runs Linux 6.18 (Firecracker) with no AppArmor: there is no `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` and no `/sys/module/apparmor`, and `max_user_namespaces` is 64278.
- An unprivileged user (uid 65534, all inheritable capabilities dropped) can run the exact form the tests use:
  ```
  $ setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all unshare -rn sh -c 'id; cat /proc/self/uid_map'
  uid=0(root) gid=0(root) groups=0(root)
           0      65534          1
  rc=0
  ```
- The failing test, on `origin/main` 459fdfb (the c8ecba1 tree plus only `release.yml`), after `npm ci` and the framework build:
  ```
  $ npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/cli/verify.test.ts -t "two consecutive verify runs with networking disabled"
   Test Files  1 passed (1)
        Tests  1 passed | 11 skipped (12)
   Duration  137.47s
  ```
  (The sandbox runs it as root; the next bullet shows that the wrapper also works for a non-root user here.)
- The exact wrapper, as the unprivileged user, gives a namespace with loopback only:
  ```
  $ setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
           0      65534          1
  Inter-|   Receive ...
      lo:       0       0    0 ...
  ``` I did not run E2E-001 locally. Its failure in CI is at its first `offline()` call (the probe at line 102/103), with the same `unshare` message, before any framework code runs.

### E6. The EPIPE in #166 is a consequence of `unshare` exiting at once

`run()` in `packages/framework/test/fixtures/support/app.ts` spawns the child with a stdin pipe and calls `child.stdin.end(options.stdin ?? "")` synchronously right after `spawn`, with no `'error'` listener on `child.stdin`. If the child has already exited, which is what `unshare` does when the map write fails, the write raises EPIPE as an uncaught exception. Minimal model (scratchpad `epipe.mjs`: spawn, optional busy wait, then `stdin.end("")`, counting EPIPE through a listener):

```
/bin/false, no delay:      48/300 runs raised EPIPE on child.stdin.end("")
/bin/false, 20 ms delay:  100/100 runs raised EPIPE
/bin/cat,   20 ms delay:    0/100 runs raised EPIPE   (a child that stays alive)
```

So the EPIPE occurs only some of the time (af84816 and #165 show the plain assertion and no EPIPE), and only when the child is already gone. It is a secondary symptom, not a cause. See "Proposed fix", open item.

## Causal chain

1. **The owner's v0.2.0 `ci.yml` (a632b8c, 2026-10-31) added a `compliance` job that runs the selected framework integration suites and the compliance harness on `ubuntu-24.04` GitHub-hosted runners.** Evidence: E3 (the old `ci.yml` and the old `release.yml` contents; a632b8c's diff).
2. **When a PR's changes select CLI-AC-002 (or E2E-001/LOCAL-AC-001), the job runs tests that cut networking with `unshare -rn sh scripts/offline.sh …`, as the unprivileged `runner` user.** Evidence: E2 (the IDS/DIRECT selections of the failing jobs versus the green one); E3 (the only callers of `unshare`); `app.ts:199`; `E2E-001-E2E-003.spec.ts:60`; testing-standards rule 9 mandates this form.
3. **On that runner, `unshare(2)` succeeds but writing `/proc/self/uid_map` is refused with EPERM, so `unshare` exits 1 without running `offline.sh` or the command.** Evidence: E4 (the message form proves the map write failed after the namespace was created; the experiment shows the alternative message); the identical line in all three jobs (E1/Symptom).
4. **The refusal comes from Ubuntu 24.04's AppArmor restriction on unprivileged user namespaces (`kernel.apparmor_restrict_unprivileged_userns=1`), which denies capabilities inside the new namespace, and `map_write` needs `CAP_SYS_ADMIN` there.** Evidence: E4 (the kernel requirement; Ubuntu's documented behaviour; the identical `uid_map` EPERM on Ubuntu 24.04 with the same sysctl as the fix in AMD UG1144; runner-images#10443 on this image); E5 (the same command and test succeed on a kernel without the restriction, as an unprivileged user too). **Not directly observed:** no job has printed the runner's sysctl value. See "Unproven link".
5. **The tests therefore see exit status 1 and fail their first assertion: CLI-AC-002 at `verify.test.ts:76`, E2E-001/LOCAL-AC-001 at `E2E-001-E2E-003.spec.ts:102/103`.** When `unshare` has already exited before `child.stdin.end`, the test support also throws EPIPE (E6). Evidence: Symptom; E6.

**Unproven link (4).** The value of `kernel.apparmor_restrict_unprivileged_userns` on runner image 20261025.353.1 has not been read. This session cannot push `.github/workflows/*`, and no existing job prints it. Everything else about link 4 is consistent and corroborated: the exact error form, the kernel requirement, Ubuntu 24.04's documented default, identical third-party reports and fixes, and the success where the restriction is absent. The first step of the verification plan reads the value directly; if it is `0` or absent, this record is wrong and goes back to step 1.

## Alternatives ruled out

- **Runner image change.** E1: the same image `ubuntu-24.04` 20261025.353.1 and the same provisioner 20261021.618 in the last green job and in all three failures; `runs-on` unchanged.
- **Load, timing, flakiness.** The failure is deterministic: 3 of 3 jobs that selected CLI-AC-002, and 2 of 2 that selected E2E-001, failed with the same message, in four regions on different days. `unshare` refuses in milliseconds, at its own start; no timeout is involved. The same test passes alone locally (E5), and the CI failure is not a "fails only alongside other suites" case: the message comes from a permission check, not from contention.
- **A test defect.** The test passes locally (E5). Its assertion fails because the offline wrapper never ran, not because of what `verify` printed. The wrapper form is the one the standards require (rule 9), so the test is right to use it. The EPIPE (E6) is a robustness defect in the test support that makes the report noisier; it does not cause the failure (af84816 and #165 fail without it).
- **A code change in #165 or #166.** The failure first appears on af84816 (#164, 2026-10-31), before either PR existed. Neither PR touches the failing path: `scripts/offline.sh`, `scripts/lo-up.py`, `app.ts` and `verify.test.ts` are unchanged from 35a1278 to 459fdfb (`git diff --stat`). The only change in `E2E-001-E2E-003.spec.ts` is two lines of its version pin, not its `offline()` helper. In any case `unshare` fails before any repository code runs.
- **`offline.sh` itself (for example, `ip link set lo up` failing).** If `offline.sh` had run and failed, the error would come from `ip` or `lo-up.py`. The message is from `unshare`, before `exec`. `offline.sh` was last changed before a632b8c and works locally.
- **User namespaces disabled outright (`max_user_namespaces=0`, a Debian-style `unprivileged_userns_clone=0`, or seccomp denying `unshare`).** All of these make `unshare(2)` fail and print `unshare failed: …` (E4 experiment). The CI message shows `unshare(2)` succeeded.
- **The workflow move (`scripts/ci/workflows/` → `.github/workflows/`) changing the environment.** The move changed which tests run (link 1), not how a job runs: the same `runs-on`, no `container:`, and no step that touches AppArmor or sysctls.

## Proposed fix

Workflow change only; no test or framework change. The owner installs it (the session cannot push `.github/workflows/*`). The fixer stages it as full replacement files under `scripts/ci/staged/` with the "STAGED COPY (DEC-0637)" header convention.

1. **`ci.yml`, job `compliance`: add a step right after `actions/setup-node`, before `npm ci`:**
   ```yaml
   # Ubuntu 24.04's AppArmor denies capabilities inside unprivileged user namespaces, so
   # `unshare -rn` cannot write /proc/self/uid_map and every offline test fails (root cause
   # ai/implementation/root-causes/2026-11-02-ci-userns-offline.md). Lift the restriction on this
   # throwaway runner, then prove the offline wrapper works before any test relies on it.
   - name: Allow unprivileged user namespaces (offline tests use unshare -rn)
     run: |
       echo "before: $(sysctl -n kernel.apparmor_restrict_unprivileged_userns)"
       sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
       unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
   ```
   - The `sysctl -n` line reads the value that link 4 needs. (Corrected in attempt 2: inside `echo "$(...)"` a missing key would not fail the step; attempt 2's step reads it in a command of its own.)
   - The last line runs the exact wrapper the tests use, without sudo, and shows the namespace's map and its only interface. A green step means the namespace, the map and loopback-up all work before ten minutes of tests are spent.
2. **`release.yml`, job `verify`: the same step, in the same place (after setup-node, before `npm ci`).** The release job runs every local criterion and scenario with no `--only`, so CLI-AC-002, E2E-001 and LOCAL-AC-001 would fail the next release tag the same way. No release has run since v0.1.1, so this has not been observed yet.
3. **Why this addresses the cause and not the symptom.** The cause is the runner's LSM policy refusing capabilities in the new user namespace. Setting the documented knob to 0 restores the kernel's default rule, under which the namespace creator is root inside it. That is the condition the tests already assume (E5). The tests keep cutting networking the way rule 9 requires; nothing is skipped, weakened or run with sudo. The change is limited to an ephemeral, single-tenant hosted VM that is discarded after the job.
   - The narrower alternative, for the reviewer to weigh, is an AppArmor profile that grants `userns,` to `/usr/bin/unshare` only, loaded with `sudo apparmor_parser -r`. It keeps the restriction for every other program, but it is more moving parts, and how children exec'd under that profile behave would need its own proof. On a throwaway runner, I recommend the sysctl.
   - Rejected: `sudo unshare -n` (it runs the tests as root, which changes file ownership and the code paths under test), and simulating offline any other way (forbidden by rule 9).
4. **Open item, not part of this fix (test-support owner):** `packages/framework/test/fixtures/support/app.ts` `run()` has no `'error'` listener on `child.stdin`, so a child that exits before `stdin.end` raises an uncaught EPIPE that Vitest reports as an unhandled error (E6). It should be ignored or recorded as part of the result, so that the assertion with the child's own output is the only report. A red-green unit or integration test can model it with a command that exits at once. It is independent of the CI cause; fixing it alone would not make any test pass.

## Verification plan

The session cannot push `.github/workflows/*`, so the workflow check is done in two parts:

- **Before the owner installs it (fixer, red-green where possible):**
  - *Red (already on record):* the three failing jobs above. No new run is needed.
  - *Static check:* extend `tests/ci-classify.unit.test.ts`, which already reads `.github/workflows/ci.yml`, `release.yml` and a staged `scripts/ci/staged/release.yml` when one exists. Add a test that the `compliance` job of `ci.yml`, and the `verify` job of `release.yml`, have a step that sets `kernel.apparmor_restrict_unprivileged_userns=0` and runs `unshare -rn sh scripts/offline.sh` before `npm ci`. It reads the staged copy when one exists, and the installed file otherwise. It is red against the current workflows and green against the staged copies.
  - *Local:* the proof line `unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev` already runs here as an unprivileged user (E5). This sandbox has no AppArmor, so it cannot show the restriction itself.
- **After the owner installs the staged files (owner, then the test runner and the evaluator, step 4):**
  1. In the new step's log, `before:` should print `1` (this proves link 4). After it, the `sysctl -w` line should print `= 0`, and the wrapper line should print a `uid_map` of `0 <runner uid> 1` and a `/proc/net/dev` listing only `lo`. If `before:` prints `0`, or the key is missing, the diagnosis is wrong: reopen at step 1.
  2. Re-run `compliance` on a PR that selects CLI-AC-002 and E2E-001/LOCAL-AC-001 (re-run #165's or #166's checks against the new base, or open a PR touching `packages/framework/test/integration/cli/`). CLI-AC-002 "two consecutive verify runs with networking disabled give identical results", E2E-001 and LOCAL-AC-001 must pass, and the log must contain no `unshare:` line and no unhandled EPIPE.
  3. `release.yml` has no `workflow_dispatch`, so its new step first runs on the next RC tag. Its log must show the same lines as in 1, and the full local compliance run must have no `unshare:` failure.

## Review

Written by the independent root-cause reviewer (step 2).

Reviewer: independent root-cause reviewer subagent (`failure-diagnosis.md`, step 2). Date: 2026-11-02. I did not write this diagnosis, the tests or the workflows. Base: `v0.2.0/ci-userns-fix` at f489413.

**Verdict: rejected.** The cause is very probably right and the fix very probably works, but link 4 is left unproven although this session can prove it, and the fix itself, on the real runner, before the owner installs anything. Two factual errors also need correcting. Return to step 1 for one evidence run and the corrections below; everything else can stay.

### What I checked
- **CI logs, with `get_job_logs`:** #164's job 124629947865 (westus3), #166's job 125065874957 (centralus) and the last green job 124622206075. All three show image `ubuntu-24.04` 20261025.353.1 and provisioner 20261021.618 (E1). #164 has `unshare: write failed /proc/self/uid_map: Operation not permitted` at CLI-AC-002 and at E2E-001-E2E-003.spec.ts:87, then `compliance: 63 passed, 60 not-run, 3 failed`. #166 has the same line, the EPIPE, and `94 passed, 31 not-run, 1 failed`. The green job's `DIRECT` is `packages/create-prototype-app/test tests/skill`, it reports `118 not-run, 7 passed`, and it contains no `unshare` (E2). Confirmed.
- **Git history:** a632b8c (owner, 2026-10-31 13:28 -0500) replaced `ci.yml` and `release.yml`. `ci.yml` at a519cd8 ran build, typecheck, lint, `test:unit`, the two apps' `verify`, `tests/skill` and `packages/create-prototype-app`, and no framework integration suite and no harness (E3). `git diff --stat 35a1278 459fdfb` touches only `E2E-001-E2E-003.spec.ts`, and only its version-pin regex. Confirmed.
- **Callers of the wrapper:** `grep` outside `docs/` and `ai/` finds `unshare` only in `packages/framework/test/fixtures/support/app.ts:199` (used only at `packages/framework/test/integration/cli/verify.test.ts:74-75`) and `tests/compliance/e2e/E2E-001-E2E-003.spec.ts:60`. `tests/skill/example-pages.test.ts` uses `template-pages.ts` without `unshare`.
- **util-linux 2.39.3 order of writes, with `strace -f unshare -rn true` here:** `unshare(CLONE_NEWUSER|CLONE_NEWNET) = 0`, then `/proc/self/uid_map`, then `/proc/self/setgroups`, then `/proc/self/gid_map`.

### Accepted parts
- Links 1, 2, 3 and 5, and E6: the evidence supports each one.
- Alternatives: the runner image, load or flakiness, a test defect, a code change in #165/#166, `offline.sh` itself, and namespaces disabled outright are each ruled out with evidence. The "write failed" form (namespace created, map write refused) against the "unshare failed" form is a sound discriminator.
- Fix: lifting `kernel.apparmor_restrict_unprivileged_userns` addresses the cause (the LSM denies capabilities in the new namespace, and `map_write` needs `CAP_SYS_ADMIN` there). It is not a symptom fix: the tests still cut networking the way rule 9 requires, without sudo or skips. The AppArmor LSM reads the sysctl when each namespace is created, so one early step covers every later step of the job. Rejecting `sudo unshare` and keeping the EPIPE as a separate open item are both right.
- Coverage: only two jobs run `offline.sh`-based tests, and the record covers both. They are `ci.yml` `compliance` (CLI-AC-002 through the harness, and any untagged `cli/` test through the "not run by the harness" step) and `release.yml` `verify` (both the direct step and the full harness run). Because the new step runs first in each job, it covers both steps there. `ci.yml` `checks` runs only the unit layer, which never calls `unshare`. `classify`, `verify` (the aggregate job) and `release.yml` `publish` run no tests.

### Why rejected
1. **Link 4 is unproven, although the session can prove it (major).** The process says an unproven link calls for more evidence, not for a deferral. The record says the value cannot be read because the session cannot push `.github/workflows/*`. That is true, but it does not need to. `ci.yml` runs code from the PR's own merge commit: `classify` runs `node scripts/ci/classify.mjs`, and `compliance` runs the selected tests. A throwaway diagnostic PR, which is never merged and is closed afterwards, can change that script on the same runner image and run a few commands there. The GitHub-hosted runner user has passwordless sudo. Those commands are:
   - print `cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns`;
   - run `unshare -rn true` (expected: the CI message, exit 1);
   - run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`;
   - run `unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev` (expected: map `0 <uid> 1`, only `lo`).

   That one run proves link 4 directly, and it reproduces the failure and the fix on image 20261025.353.1. The orchestrator decides whether a diagnostic PR is acceptable. The record must either carry that evidence or say why it could not be gathered.
2. **The verification plan makes the owner's install the first real test of the fix (major, follows from 1).** As written, a wrong diagnosis costs an owner install cycle. For `release.yml` the cost is higher: the first test is the next RC tag, and PR #167 (0.2.0-rc01) is open now. With the diagnostic run from 1, the after-install steps confirm the fix instead of testing it. Keep them.
3. **Factual errors to correct (minor):**
   - E4 says `unshare -r` writes `setgroups` and then `uid_map`, and that "the setgroups write passed". util-linux 2.39.3 writes `uid_map` first (strace above), so nothing about `setgroups` is shown. The conclusion (`unshare(2)` succeeded, and the first map write got EPERM) is unchanged.
   - The proposed step says the `sysctl -n` line "fails loudly if the key does not exist". It does not: in `echo "before: $(sysctl -n …)"`, GitHub's `bash -e` does not catch a failed command substitution in a command's arguments, so the step prints `before: ` and goes on. Only the `sudo sysctl -w` line would then fail. Read the value in its own command (for example `v=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)` and then `echo "before: $v"`), or test it explicitly, so a missing key fails at the line that states it.


## Attempt 2

Author: the same diagnosing subagent, after the review above rejected attempt 1 because link 4 was unproven. This attempt adds one evidence run on the real runner and corrects the two factual errors. Everything in attempt 1 that the review accepted still stands and is not repeated here.

### Symptom

Unchanged from attempt 1: CLI-AC-002, E2E-001 and LOCAL-AC-001 fail in `ci.yml` `compliance` with `unshare: write failed /proc/self/uid_map: Operation not permitted` (jobs 124629947865, 125067753380, 125065874957). In #166 the failure also shows as an uncaught EPIPE at `packages/framework/test/fixtures/support/app.ts:215`.

### Evidence

**E7. A probe on the real runner reproduces the failure and the fix.** I ran it from a throwaway branch, `v0.2.0/ci-userns-probe` (e50c64a), through throwaway PR #168 ("THROWAWAY probe, do not merge"), which was closed unmerged after the log was read. The branch is listed for deletion in `ai/branch-cleanup.md`.
- **How it ran:** `ci.yml` runs only on `pull_request`, and its `classify` job runs `node scripts/ci/classify.mjs` from the PR's merge commit. On `GITHUB_ACTIONS=true`, the probe's `classify.mjs` ran `scripts/ci/userns-probe.sh`, then exited 1 on purpose, so `checks` and `compliance` were skipped. The probe runs each command on its own and prints its exit status.
- **Where it ran:** run 41390447617, job 125100444324 (classify), 2026-11-02 04:48Z, region eastus3, image `ubuntu-24.04` **20261025.353.1**, provisioner 20261021.618. This is the same image and provisioner as the last green job and all three failures (E1).
- **Log excerpt** (timestamps removed):

```
=== PROBE $ uname -a
Linux runnervm48cm3 7.0.0-1017-azure #17~24.04.1-Ubuntu SMP PREEMPT Thu Sep 24 18:46:57 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
=== PROBE $ cat /etc/os-release
PRETTY_NAME="Ubuntu 24.04.5 LTS"
=== PROBE $ id
uid=1001(runner) gid=1001(runner) groups=1001(runner),4(adm),100(users),118(docker),999(systemd-journal)
=== PROBE $ unshare --version
unshare from util-linux 2.39.3
=== PROBE $ sysctl -n kernel.apparmor_restrict_unprivileged_userns
1
=== PROBE exit status: 0
=== PROBE $ cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
1
=== PROBE $ cat /proc/sys/user/max_user_namespaces
58109
=== PROBE $ cat /sys/module/apparmor/parameters/enabled
Y
=== PROBE $ unshare -rn true
unshare: write failed /proc/self/uid_map: Operation not permitted
=== PROBE exit status: 1
=== PROBE $ unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
unshare: write failed /proc/self/uid_map: Operation not permitted
=== PROBE exit status: 1
=== PROBE $ sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
kernel.apparmor_restrict_unprivileged_userns = 0
=== PROBE exit status: 0
=== PROBE $ sysctl -n kernel.apparmor_restrict_unprivileged_userns
0
=== PROBE $ unshare -rn true
=== PROBE exit status: 0
=== PROBE $ unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
         0       1001          1
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
=== PROBE exit status: 0
=== PROBE $ unshare -rn sh scripts/offline.sh node -e "fetch('https://api.cloudflare.com/client/v4/').then(...)"
unreachable: EAI_AGAIN
=== PROBE exit status: 0
=== PROBE $ sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
kernel.apparmor_restrict_unprivileged_userns = 1
=== PROBE $ unshare -rn true
unshare: write failed /proc/self/uid_map: Operation not permitted
=== PROBE exit status: 1
```

- **What it shows:**
  - The knob exists and is `1`, AppArmor is enabled, and user namespaces are not otherwise limited (`max_user_namespaces` 58109).
  - As the unprivileged `runner` user (uid 1001), `unshare -rn` fails with exactly the CI message.
  - With the knob at `0`, the exact wrapper the tests use works without sudo. Its map is `0 1001 1`, its only interface is `lo`, and E2E-001's own reachability probe gets `EAI_AGAIN`, which means no network.
  - Setting the knob back to `1` brings the failure back. The knob alone switches the failure on and off, on this image.

**Corrections to attempt 1 (from the review):**
- **E4:** util-linux 2.39.3 writes `/proc/self/uid_map` first, then `setgroups`, then `gid_map`, so nothing about `setgroups` was shown. The conclusion is unchanged: `unshare(2)` succeeded, and the first map write got EPERM. E7 confirms it on the runner with the same util-linux 2.39.3. The E4 text is corrected in place.
- **The proposed step:** `echo "before: $(sysctl -n …)"` would not fail on a missing key under `bash -e`. The step below reads the value in a command of its own.

### Causal chain

Links 1, 2, 3 and 5 are as in attempt 1, which the review accepted. Link 4 is now directly observed:

4. **On runner image 20261025.353.1, `kernel.apparmor_restrict_unprivileged_userns` is `1`. With it at `1`, `unshare -rn` as uid 1001 fails at the `uid_map` write with EPERM. With it at `0`, the same command and the offline wrapper succeed. Setting it back to `1` restores the failure.** Evidence: E7, which supports both directions on the real runner. The mechanism is the same as in attempt 1: the AppArmor `unprivileged_userns` mediation denies capabilities in the new namespace, and `map_write` needs `CAP_SYS_ADMIN` there. The external corroboration in E4 is now supplementary.

No link is unproven.

### Alternatives ruled out

As in attempt 1, which the review accepted. E7 adds two more:
- **A kernel or user-namespace limit other than AppArmor:** `max_user_namespaces` is 58109, and with only the AppArmor knob changed, `unshare -rn` works.
- **A probe-only artefact:** the probe ran on the same image and provisioner as the failing jobs, and `unshare` printed the CI's exact message.

### Proposed fix

Unchanged in substance from attempt 1, with the value read in its own command; E7 has already run this sequence on the real image. Add this step to `ci.yml` job `compliance`, and to `release.yml` job `verify`, right after `actions/setup-node` and before `npm ci`:

```yaml
# Ubuntu 24.04's AppArmor denies capabilities inside unprivileged user namespaces
# (kernel.apparmor_restrict_unprivileged_userns=1 on this image), so `unshare -rn` cannot write
# /proc/self/uid_map and every offline test fails (root cause
# ai/implementation/root-causes/2026-11-02-ci-userns-offline.md). Lift the restriction on this
# throwaway runner, then prove the offline wrapper works before any test relies on it.
- name: Allow unprivileged user namespaces (offline tests use unshare -rn)
  run: |
    before=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)
    echo "kernel.apparmor_restrict_unprivileged_userns before: $before"
    sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
    unshare -rn sh scripts/offline.sh cat /proc/self/uid_map /proc/net/dev
```

- **The value is read in its own command:** under GitHub's `bash -e`, a failed `before=$(...)` assignment fails the step at that line, so a missing key would show there.
- **The other lines:** the `sudo sysctl -w` line is the fix. The `unshare` line proves the wrapper works for the unprivileged user before any test runs.
- **Why it addresses the cause:** the cause is the knob being `1`, and E7 shows that setting it to `0` is sufficient, on the real image. The tests are unchanged and still cut networking as rule 9 requires: no skip, no sudo for the tests. The narrower per-binary AppArmor profile and the rejected options are as in attempt 1.
- **Staging:** the fixer stages both files under `scripts/ci/staged/` (DEC-0637 header), and the owner installs them.
- **Open item:** the EPIPE in `app.ts` `run()` stays separate, as in attempt 1 (E6).

### Verification plan

The fix has already been demonstrated on the real image (E7). The steps below confirm it after it is installed; they no longer test it for the first time.
- **Fixer, before the owner installs it:**
  - Add a check to `tests/ci-classify.unit.test.ts`: the `compliance` job of `ci.yml` and the `verify` job of `release.yml` must have a step, before `npm ci`, that reads `kernel.apparmor_restrict_unprivileged_userns` in its own command, sets it to `0` with `sudo sysctl -w`, and runs `unshare -rn sh scripts/offline.sh`. It reads the staged copy when one exists. It is red against the installed workflows and green against the staged ones.
  - The probe's lines (E7) are the runner-side red and green for the step itself.
- **Owner, after installing; then the test runner and the evaluator (step 4):**
  1. The new step's log shows `before: 1`, then `= 0`, then the map `0 1001 1` and only `lo`.
  2. Re-run `compliance` on a PR that selects CLI-AC-002, E2E-001 and LOCAL-AC-001 (for example, re-run #166's checks against the new base). All three must pass, with no `unshare:` line and no unhandled EPIPE.
  3. The next RC tag's `release.yml` `verify` job shows the same step output, and its full local compliance run has no `unshare:` failure. PR #167 (0.2.0-rc01) is open: the release fix should be installed before that tag is pushed.

### Review

Status: awaiting review
