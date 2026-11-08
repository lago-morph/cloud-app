# Root cause: two test files resolve mock-oauth2-server's classpath at once, and both Maven runs copy into the same `lib/`

Status: accepted (attempt 2; attempt 1 rejected on the fix and the verification plan)

## Symptom

Release workflow run 42434367751, job 128589944270, commit `dc5473a` (tag `v0.2.0-rc01`), step "Integration tests the harness does not run (tagged with no criterion or scenario)": `Test Files 1 failed | 16 passed | 37 skipped (54)`.

- Failed suite: `packages/framework/test/integration/admin-app/admin-app-flow.test.ts`, all 9 tests skipped because `beforeAll` threw (`admin-app-flow.test.ts:49:17` → `startMockOAuth2` `launcher.ts:89:15` → `ensureClasspath` `launcher.ts:49:11`).
- `Error: mock-oauth2-server: could not resolve its classpath with Maven into /home/runner/.cache/prototype-framework/mock-oauth2-server/6.1.4/lib (exit 1).`
- Maven: `maven-dependency-plugin:3.11.0:copy-dependencies … Failed to copy artifact 'org.jetbrains.kotlin:kotlin-reflect:jar:2.2.21:runtime' (…/6.1.4/repo/org/jetbrains/kotlin/kotlin-reflect/2.2.21/kotlin-reflect-2.2.21.jar) to …/6.1.4/lib/kotlin-reflect-2.2.21.jar: Failed to copy full contents from … to … -> [Help 1]`.
- In the same step, `packages/framework/test/integration/auth-app/sign-in-flow.test.ts`, which also starts the mock server, passed (11 tests).
- The previous release run, 42429796126 (job 128575950155, `de75082`), passed both files in the same step (it failed later for an unrelated reason, `2026-11-08-rc01-role-refresh-pglite.md`).

## Evidence

1. **Two files in this step start the mock server.** `grep startMockOAuth2|ensureClasspath`: callers are `admin-app-flow.test.ts:49` and `auth-app/sign-in-flow.test.ts:24` (both in `beforeAll`), plus `tests/compliance/e2e/E2E-017-setup.spec.ts:192` and `tests/compliance/e2e/support/signin-stack.ts:94` (Playwright, run later by the compliance step, not by this one). The step's `DIRECT` (log, classify output) includes both `packages/framework/test/integration/admin-app` and `packages/framework/test/integration/auth-app`.
2. **They run in separate processes at the same time, against one cache directory.** `vitest.integration.config.ts`: `pool: "forks"`, no `maxWorkers: 1`, no `fileParallelism: false`, no `globalSetup`. `release.yml` sets no `MOCK_OAUTH2_URL` and no `MOCK_OAUTH2_HOME`, so every caller takes the local path with `home() = ~/.cache/prototype-framework/mock-oauth2-server/6.1.4`. The runner is fresh (no `actions/cache`; `package-manager-cache: false`), so the cache is empty when the step starts. Log timestamps, failing run: admin-app-flow reported at 01:33:11.957 after 11 686 ms (started ≈01:33:00.27); sign-in-flow reported at 01:33:17.113 after 15 305 ms (started ≈01:33:01.81). Both `beforeAll`s were resolving the classpath in overlapping windows. Previous run: admin-app-flow (18 596 ms) and sign-in-flow (17 685 ms) reported 0.18 s apart (00:30:50.55 and 00:30:50.74), so they overlapped there too and happened to win.
3. **`ensureClasspath` has no lock and no atomic publish** (`tests/support/mock-oauth2/launcher.ts:37–53`, identical on `dc5473a` and `origin/main`: `git diff dc5473a origin/main -- tests/support/mock-oauth2` is empty). The only guard is `existsSync(lib/.complete)`, a check-then-act: both processes see no `.complete`, both rewrite `settings.xml`, both run `mvn dependency:copy-dependencies -DoutputDirectory=<the same lib>` with the same `-Dmaven.repo.local=<the same repo>`, and each writes `.complete` when its own Maven exits 0. No `rename`, no temporary directory, no lock file.
4. **What the Maven message means.** "Failed to copy full contents from X to Y" is the size check after a file copy (plexus-utils `FileUtils.copyFile`, used by the dependency plugin's copy; the string is in `org/codehaus/plexus/util/FileUtils.class` of plexus-utils 4.0.1, which the plugin resolved in the reproduction): it throws when `Y.length() != X.length()` after the copy. The source `X` is in the local repository and is complete; a different length of `Y` means something else wrote `Y` during or after this process's copy, i.e. the other Maven truncating and rewriting the same destination file.
5. **Reproduction (scratch scripts, not committed: `one.ts` calls `ensureClasspath()` once; `race.sh` starts N such processes at once with `MOCK_OAUTH2_HOME` set to a fresh directory). Local Maven 3.9.11, dependency plugin 3.7.0, Java 21, 4 CPUs.**
   - *Warm repo, empty `lib/` (`repo/` copied from an existing cache), 2 processes, 8 runs:* **2 of 8 failed**, with the same error form: `Failed to copy artifact 'io.netty:netty-codec-native-quic:jar:linux-x86_64:4.2.19.Final:runtime' … Failed to copy full contents from …/repo/…/netty-codec-native-quic-4.2.19.Final-linux-x86_64.jar to …/lib/netty-codec-native-quic-4.2.19.Final-linux-x86_64.jar` and `… 'org.bouncycastle:bcprov-jdk18on:jar:1.86:runtime' … Failed to copy full contents from …/bcprov-jdk18on-1.86.jar to …/lib/bcprov-jdk18on-1.86.jar`. In each failing run the other process succeeded and wrote `lib/.complete`.
   - *Control, warm repo, 1 process, 8 runs:* 0 of 8 failed.
   - *Cold (empty home, as on a fresh runner), 2 processes, 7 runs:* **2 of 7 failed**, `kotlin-logging-jvm-3.0.5.jar` and `bcprov-jdk18on-1.86.jar`, same message. The failing jar varies between runs (kotlin-reflect in CI); the failures are on larger jars, where the copy windows are longest.
6. **PR CI never takes this path.** `ci.yml:136–140`: whenever the auth-app or admin-app suite is selected, it starts the Docker image `ghcr.io/navikt/mock-oauth2-server:6.1.4` and exports `MOCK_OAUTH2_URL=http://localhost:8080`, so `startMockOAuth2` returns at `launcher.ts:84–87` and never calls `ensureClasspath`. `release.yml` has no such step, so the release workflow is the only CI place where `ensureClasspath` runs, and it runs from an empty cache every time. Locally, developers usually have a warm cache with `.complete`, so the fast path at `launcher.ts:40` hides the race too.

## Causal chain

1. The release step runs `admin-app-flow.test.ts` and `sign-in-flow.test.ts` in parallel forked workers, and both call `startMockOAuth2()` in `beforeAll` (evidence 1, 2).
2. With no `MOCK_OAUTH2_URL` in `release.yml` (unlike `ci.yml`), both take the local path into the same default cache directory, which is empty on a fresh runner (evidence 2, 6).
3. `ensureClasspath` guards only with a non-atomic `.complete` check, so both processes start Maven at the same time with the same `-DoutputDirectory` (evidence 3, log timings in evidence 2).
4. Both Mavens copy the same jars into the same `lib/`; when one rewrites a destination file while the other is copying it, the other's post-copy length check fails with "Failed to copy full contents" and Maven exits 1 (evidence 4; reproduced on demand at about 1 in 4 with two processes, never with one: evidence 5).
5. `ensureClasspath` turns exit 1 into the thrown error, `beforeAll` fails, and the admin-app file's 9 tests are reported as a failed suite (symptom). Whether it hits depends on how the two copies interleave, which is why the previous run passed (evidence 2, 5).

## Alternatives ruled out

- **Network or mirror failure.** The failing goal is `copy-dependencies`' copy from the local repository (`…/repo/…`) to `lib/`, after resolution; the message names two local paths. The same artifacts resolved fine in the other process of the same run.
- **A corrupt or stale cache from an earlier run.** The release runner starts with an empty home (no `actions/cache`); the reproduction uses a fresh directory per run and still fails.
- **Disk space.** The whole cache is 62 MB; a single process never fails on the same disk (evidence 5 control), and the other process in the same failing run completes the identical copy.
- **The dependency plugin version (3.11.0 in CI, 3.7.0 locally).** Both fail with the same message under concurrency, and neither fails alone.
- **A concurrent write to the local repository (`repo/`) rather than to `lib/`.** Every observed failure (CI and 4 local) names a complete source in `repo/` and a short destination in `lib/`. Maven's resolver writes downloads to a temporary file and moves it into place, so a partly written source is not what the size check saw. The shared `repo/` is still used by two processes at once (see the fix), but it is not what failed here.
- **Load on the runner (the "re-run alone first" rule).** The failure needs a second process writing the same files; it never occurs with one process (evidence 5 control), so it is not a load effect of the run but a defect in how the cache is filled.

## Proposed fix

In `tests/support/mock-oauth2/launcher.ts` (owner: the auth app item, A; the launcher is shared by AUTH and SETUP per `scripts/ci/path-map.json`), make filling the cache safe for concurrent callers, so that no two Maven runs ever share an output directory and `lib/` appears only when complete:

1. **Private staging directory per call.** Resolve into `join(home(), \`lib.staging-${process.pid}-${randomUUID()}\`)` (same filesystem as `lib/`), pass it as `-DoutputDirectory`, and write `.complete` inside the staging directory after Maven exits 0. Write `settings.xml` per call too (`settings-<pid>-<uuid>.xml`, or inside the staging directory) so one caller never rewrites the file another Maven is reading.
2. **Atomic publish by `renameSync(staging, lib)`.** `rename(2)` of a directory is atomic. If it fails with `ENOTEMPTY`/`EEXIST` because another caller already published `lib/`, verify that `lib/.complete` exists (as the fast path does), delete this caller's staging directory and return `lib`. After this change `lib/` can only exist complete; a `lib/` left by the old code without `.complete` is moved aside with an atomic rename to a unique name and deleted before publishing.
3. **Always remove the staging directory** (success, lost race or Maven failure) in a `finally`.
4. **Shared local repository.** Keep one `repo/`, and make concurrent Maven processes safe on it with Maven 3.9's cross-process named locks: `-Daether.syncContext.named.factory=file-lock -Daether.syncContext.named.nameMapper=file-gav`. The fixer verifies that these properties are honoured by the Maven on `ubuntu-24.04` (and locally, 3.9.11); if not, each call uses its own `repo` inside the staging directory instead (deterministic, at the cost of a second download).

No retry, sleep or polling is part of the fix: concurrent callers may each run Maven once, and the rename decides deterministically which result is published. The same fix covers the Playwright callers (`E2E-017-setup.spec.ts`, `signin-stack.ts`).

Not proposed as the fix: a Vitest `globalSetup` that resolves once before the workers start. It would remove the overlap in this one step but leave `ensureClasspath` unsafe for Playwright workers and for any two concurrent runs; it may be added later as an optimisation on top of the launcher fix.

## Verification plan

1. **Red test first** (unit layer, e.g. `tests/support/mock-oauth2/launcher.unit.test.ts`, which `vitest.unit.config.ts` includes via `tests/**/*.unit.test.ts`). Put a fake `mvn` first on `PATH` that appends its `-DoutputDirectory` value to a log file and writes a small jar named `mock-oauth2-server-6.1.4.jar` into it. Start two child processes that each call `ensureClasspath()` with the same fresh `MOCK_OAUTH2_HOME`, and assert: the two invocations' output directories differ from each other and from `home/lib`; `home/lib/.complete` exists; both calls return `home/lib`; no staging directory is left. On the current code it fails deterministically (both output directories are `home/lib`), with no timing involved. A second case: a pre-existing `lib/` without `.complete` is replaced, and a pre-existing complete `lib/` is returned without running `mvn`.
2. **Green:** the same test passes with the fix.
3. **Reproduction re-run:** the scratch reproduction (two real Maven processes, warm and cold, at least 8 runs each) gives 0 failures with the fix, against about 1 in 4 before.
4. **Re-check (step 4):** `admin-app-flow.test.ts` and `sign-in-flow.test.ts` together in one `vitest run --config vitest.integration.config.ts` with `MOCK_OAUTH2_HOME` pointing to an empty directory; then the next release candidate run's step "Integration tests the harness does not run".

## Review

Reviewer: independent root-cause reviewer subagent (`failure-diagnosis.md`, step 2). Date: 2026-11-08. I did not write this diagnosis or the launcher. Base: `v0.2.0/rc01-mock-oauth2-fix` at b4205bc. Owner's rule: I ran only launcher experiments, in the foreground, in my scratchpad, and deleted them afterwards.

**Verdict: rejected.** The cause is accepted. The proposed fix and the red test are not, for three reasons below:
- the fix leaves the shared `repo/` as an either/or;
- the fix's "move aside" step is itself a race;
- the red test passes or fails on the fixed code by timing.

Only "Proposed fix" and "Verification plan" need to change. Symptom, Evidence, Causal chain and Alternatives can stay.

### What I checked
1. **Symptom, with `get_job_logs` on job 128589944270.** The checkout is `dc5473a`. The step's `DIRECT` includes both `…/integration/admin-app` and `…/integration/auth-app`. The log has `admin-app-flow.test.ts (9 tests | 9 skipped) 11686ms` at 01:33:11.957 and `sign-in-flow.test.ts (11 tests) 15305ms` at 01:33:17.113. The error is `could not resolve its classpath with Maven into /home/runner/.cache/prototype-framework/mock-oauth2-server/6.1.4/lib (exit 1)`, with `maven-dependency-plugin:3.11.0 … kotlin-reflect-2.2.21.jar … Failed to copy full contents from …/repo/… to …/lib/…`. Then `Test Files 1 failed | 16 passed | 37 skipped (54)`. Confirmed.
2. **Code.** `launcher.ts:37–53` as described: the `.complete` check, then a shared `settings.xml` rewrite, a shared `-Dmaven.repo.local`, and a shared `-DoutputDirectory=lib`, with no lock, temporary directory or rename. `vitest.integration.config.ts` uses `pool: "forks"`, with no file serialisation and no `globalSetup`. `release.yml` has no `MOCK_OAUTH2_URL`. The callers are exactly the four the record lists. Confirmed.
3. **Reproduction (two real `ensureClasspath()` calls, same fresh `MOCK_OAUTH2_HOME`, warm `repo/` copied in; Maven 3.9.11, Node 22, launcher.ts run directly).** 8 runs: **1 of 8 failed**, with `Failed to copy full contents from …/repo/io/netty/… to …/lib/…`, and the other process passed. This agrees with the record's 2 of 8. In all 8 runs the final `lib/` had 48 jars byte-identical to `repo/` and `.complete`. So the losing run left no corrupt jar here, but its failure is real.
4. **Maven's cross-process locks (Maven 3.9.11).**
   - With `-Daether.syncContext.named.factory=file-lock -Daether.syncContext.named.nameMapper=file-gav`, the run succeeded and created `repo/.locks`, so the properties are honoured.
   - `factory=no-such-factory` makes Maven fail, so a misspelt factory is not silently ignored on 3.9.
   - Older Maven (before 3.9) does not know these properties, and nothing in the launcher pins the Maven version.

Links 1–5 are supported by 1–3. The alternatives (network, a stale cache, disk, plugin version, load) are ruled out adequately. A reproduction alone, in two processes with no other load, settles rule 7.

### Why rejected
1. **The shared `repo/` must be one definite choice (major). The safe one is a private repository per call.**
   - The shared `repo/` is a latent race in its own right. Maven 3.9's default sync context is in-process only, so two Mavens resolving into one local repository have no cross-process coordination. Artifact files are written to a temporary file and moved, but the tracking files (`_remote.repositories`, `*.lastUpdated`, resolver status) are read-modify-write. The observed failures were all in `lib/`, but on a cold runner both Mavens also download into the same `repo/`.
   - `file-lock` works on 3.9.11 (check 4). But its safety depends on the Maven on each machine, and in an earlier Maven the properties are ignored.
   - A private repository costs nothing in steady state. `home()` is already per version, and once `lib/` is published Maven never runs again for that home. Only callers that actually race on a cold cache each download the jars (about 62 MB).
   - **Required:** each call resolves with `-Dmaven.repo.local=<its own staging area>/repo`, outside the directory that will be published, and deletes it in the `finally`. Drop the shared `repo/` and the `file-lock` alternative.
2. **The "move aside a `lib/` without `.complete`" step is itself a race (major).** Caller B can see an incomplete `lib/` (left by the old code) just before caller A publishes a complete one. B then renames A's complete `lib/` aside, while A is about to start `java -cp lib/*`. That is the same check-then-act defect again.
   - **Required:** publish to a directory name the old code never wrote (for example `classpath/`), and write `.complete` inside the staging directory before the rename. Under the new code a published directory is then complete by construction, and no move-aside step is needed. A `lib/` left by the old code is simply ignored. That also stops reuse of a `lib/` the old race may have rewritten while its winner was running `java`.
   - Keep the rest: a staging directory per call on the same filesystem, a per-call `settings.xml`, `renameSync`, treating `ENOTEMPTY`/`EEXIST` as "another caller won" after checking its `.complete`, cleanup in a `finally`, and no retry, sleep or poll.
3. **The red test does not decide the green case deterministically (major).** The fake `mvn` returns at once. If the second child reaches `ensureClasspath` after the first has published, it takes the fast path, so there is only one `mvn` invocation. The assertion "the two invocations' output directories differ" then fails on the **fixed** code too, depending on process start-up timing.
   - **Required:** make the fake `mvn` a barrier. Each invocation records its `-DoutputDirectory` and `-Dmaven.repo.local`, then waits until two invocations have registered (by polling a directory, with a timeout of a few seconds after which it exits non-zero, so a broken test fails loudly instead of hanging). Only then does it write the jar.
   - Both callers are then inside `mvn` at the same time on both the old and the new code. On the old code both output directories are `home/lib`: red, every run. On the new code they are distinct staging directories, neither is the published path, the repositories are distinct, exactly one publish wins, both calls return the published path, and no staging directory is left: green, every run.
   - Keep the second case, adapted to 2: a published complete directory is returned without running `mvn`, and an old `lib/` is ignored.

### Coverage of callers
The fix is inside `ensureClasspath`, so it covers all four callers. Those are the two Vitest `beforeAll`s and the Playwright callers `E2E-017-setup.spec.ts:192` and `support/signin-stack.ts:94`. `playwright.config.ts` sets no `workers`, so Playwright's parallel workers can race in the same way on a cold cache, for example in a local compliance run. No change is needed per caller.

### The release.yml Docker alternative
- Starting the pinned Docker mock server in `release.yml`'s `verify` job, as `ci.yml:136–140` does, would align release with PR CI. Setting `MOCK_OAUTH2_URL` through `$GITHUB_ENV` would also reach the later compliance step's Playwright callers. The release would then skip Maven, Java start-up and the external mirror.
- It is a workflow change for the owner to install, and it does not remove the defect. Local and sandbox runs (no Docker; the launcher header names this case) still start several workers on a cold cache, and hit the same race.
- **So the launcher fix is needed either way, and it alone unblocks rc01 without a workflow install.** The Docker step is an optional parity change for the owner. If it is adopted, the launcher's unit test from 3 remains the only CI guard of the local path, because the release would no longer exercise it.

## Attempt 2

Author: the same diagnosing subagent, after the review above rejected attempt 1's fix and verification plan and accepted its cause. The coordinator also relayed the owner's question: why does each parallel test file run the same setup? Could the classpath be prepared once, in a `globalSetup`, before any worker starts? This attempt evaluates that design first (A2-E1), then gives the fix. Owner's rule: only launcher experiments, in the foreground, in my scratchpad (not committed).

### Symptom

Unchanged from attempt 1, whose symptom the review confirmed. In release run 42434367751, job 128589944270, `admin-app-flow.test.ts`'s `beforeAll` fails in `ensureClasspath` with `copy-dependencies … Failed to copy full contents from …/repo/…/kotlin-reflect-2.2.21.jar to …/lib/kotlin-reflect-2.2.21.jar`, while `sign-in-flow.test.ts` resolves at the same time and passes.

### Evidence

Attempt 1's evidence 1–6 stand; the review confirmed them. New evidence:

**A2-E1. Does a `globalSetup` cover every caller? Not alone.**
- *Which runners start the mock server.*
  - Vitest `vitest.integration.config.ts` runs `admin-app-flow.test.ts` and `sign-in-flow.test.ts`. It is used by the release step, by `ci.yml`, and by the harness's `vitest` selection (`tests/compliance/harness/selection.ts:30`).
  - Playwright `playwright.config.ts` (project `e2e-api` or `e2e-ui`) runs `E2E-017-setup.spec.ts` and the specs that use `support/signin-stack.ts`.
  - A bare `npx vitest run <file>` loads `vitest.config.ts`, which has no `include` and no setup. Its own comment says such runs are used for PGlite suites.
  - No config has a `globalSetup` today (grep).
- *What a `globalSetup` guarantees.* Vitest runs `test.globalSetup` once per project in the main process, before it starts the worker pool. Playwright runs `globalSetup` once in the runner process, before any worker. This is from their documentation; under the owner's rule I did not run either runner to check it. So within one runner process, a `globalSetup` does remove the race between workers, which is the CI failure.
- *Where builds can still be concurrent: separate runner processes sharing one `home()`.* `home()` defaults to `~/.cache/prototype-framework/mock-oauth2-server/6.1.4`, shared by every checkout and worktree for one user.
  - This repository's own process runs independent items in parallel, each in its own worktree on the same machine (`CLAUDE.md`; there are 13 worktrees under `/home/user/cloud-app/.claude/worktrees` now).
  - Two sessions running the integration config at once, or one running Vitest while another runs Playwright, give two `globalSetup`s. On a cold cache, both build at once. That is the same check-then-act race, only between runners instead of workers.
  - The harness is not a source: it runs its selections one after another (`driver.ts:489–509`, `await` in a `for` loop). CI steps are sequential too.
- *A `globalSetup` cannot tell whether the selected files need the server.*
  - Vitest and Playwright call it before, and independently of, the file and `-t`/`--grep` selection.
  - If it always prepares, then every integration or Playwright run without `MOCK_OAUTH2_URL` needs Maven, Java 21 and the mirror. That includes every PR CI run that does not select the auth-app or admin-app suites, because `ci.yml:137` sets `MOCK_OAUTH2_URL` only when one of them is selected.
  - Today, nothing else in the repository needs Java (grep for `java` spawns: `launcher.ts` only).
  - If it prepares only when the selection needs the server, it has to parse argv, which is fragile.
- *Conclusion.* A `globalSetup` cannot make concurrent builds impossible by construction, because builds in separate processes remain. It also cannot cover the bare `vitest.config.ts` path. So, as the coordinator's brief provides, the fix falls back to a builder that is safe under concurrency. The review's three requirements apply, and a private Maven repository per call is kept because more than one process can still build.

**A2-E2. Prototype of the fix, with a barrier fake `mvn` (scratch: `proto/launcher-proto.ts`, `proto/fake-mvn/mvn`, `proto/barrier.sh`; not committed).**
- *The fake `mvn`.* It records `-DoutputDirectory`, `-Dmaven.repo.local` and `-s` in a log directory. It then waits until 2 invocations have registered: it checks the directory every 20 ms, and after 10 s it exits 3 with `barrier timeout`. Then it writes `mock-oauth2-server-6.1.4.jar` and one more jar into its output directory.
- *Run.* Two child processes call `ensureClasspath()` with the same fresh `MOCK_OAUTH2_HOME`.
- *Current `launcher.ts`:* 5 of 5 runs had 2 invocations with the **same** output directory (`home/lib`) and the **same** repository (`home/repo`). Both calls returned `home/lib`. So an assertion of distinct directories is red on every run.
- *Prototype:* 5 of 5 runs had 2 invocations with **distinct** output directories and **distinct** repositories. Exactly one `renameSync` won; the other failed with `ENOTEMPTY` and took the winner's directory. Both calls returned `home/classpath`, and the home held only `classpath/`, with no staging directory left.
- *Why this is deterministic.* The first caller is held inside `mvn` until the second has registered. A published directory appears only after `mvn` returns. So neither caller can take the fast path, on either version of the code.

**A2-E3. Prototype with real Maven (Maven 3.9.11; two concurrent calls; empty home; private repository per call).**
- 6 of 6 runs: both calls succeeded, and each run had exactly one `lost publish race (ENOTEMPTY)`.
- `classpath/` held 48 jars, and `kotlin-reflect-2.2.21.jar` is byte-identical (`cmp`) to a cache resolved by a single process.
- Each call took 17–22 s, because each downloads its own repository.
- Before the fix, the same setup failed in 2 of 7 cold runs (attempt 1, evidence 5).

**A2-E4. Rename semantics the design relies on.**
- `rename(2)` of a directory is atomic. On Linux it fails with `ENOTEMPTY` or `EEXIST` when the target is a non-empty directory, as A2-E2 and A2-E3 show for `ENOTEMPTY`. So a published directory is never replaced and never written to again.
- An *empty* target directory would be replaced, but the new code never creates `classpath/` except by the rename.
- On other platforms the error code may differ (for example `EPERM` on Windows). So the design treats a failed rename as a lost race only when a complete `classpath/` exists afterwards, and as an error otherwise. It does not branch on the code.

### Causal chain

Unchanged from attempt 1, links 1–5, which the review accepted. A2-E1 adds one point for the fix: the race needs two processes building into one `home()`. Within one runner those are workers; across runners they are separate sessions or worktrees. So removing the race between workers alone does not remove the defect.

### Alternatives ruled out

Attempt 1's alternatives stand (accepted). For the fix:
- **A `globalSetup` as the fix, with `ensureClasspath` only reading.** It does not cover concurrent runners sharing `~/.cache`, nor the bare `vitest.config.ts` path. It would also make Maven and Java a dependency of runs that do not use the mock server (A2-E1). It is not adopted. It could be added later on top of the fix below to save time, but it is not needed for correctness, and this record does not propose it.
- **Maven's `file-lock` named locks on a shared repository.** Maven before 3.9 ignores them, and nothing pins the Maven version (review, check 4). Replaced by a private repository per call.
- **A pointer (symlink or small file naming a uniquely named directory) replaced atomically.** It would also be race-free. But the classpath for a version never changes once built, because `home()` is per version. So publishing once, to a directory that is never replaced, needs no pointer and no replacement step. It is also simpler to verify.
- **Moving a stale `lib/` aside.** It is itself a race (review, reason 2). The new code never reads, moves or deletes `lib/`.

### Proposed fix

All changes are in `tests/support/mock-oauth2/launcher.ts`, in `ensureClasspath`. The owner is the auth app item (A); SETUP shares the launcher (`scripts/ci/path-map.json`). No caller, config or workflow changes.

1. **Published path.** The published path is `join(home(), "classpath")`, a name the old code never wrote. The fast path returns it if `classpath/.complete` exists and a `mock-oauth2-server-<version>*` jar is in it. A `lib/`, `repo/` or `settings.xml` left by the old code is ignored, and never read, moved or deleted.
2. **Private staging area per call.** It is `join(home(), \`staging-${process.pid}-${randomUUID()}\`)`, on the same filesystem as `classpath/`, and it holds three things:
   - its own `settings.xml`;
   - its own Maven repository (`-Dmaven.repo.local=<staging>/repo`);
   - its own output directory (`-DoutputDirectory=<staging>/lib`).

   No two calls share any path Maven writes.
3. **`.complete` before publishing.** After Maven exits 0, write `.complete` into `<staging>/lib`, then `renameSync(<staging>/lib, classpath)`.
4. **A failed rename.** If `classpath` is then published (as in 1), another caller won: return `classpath`. Otherwise rethrow the rename error. Never retry, sleep or poll.
5. **Cleanup.** `rmSync(staging, { recursive: true, force: true })` in a `finally`, after success, a lost race or a Maven failure. A staging directory left by a killed process is never read again. It is not cleaned up by others, because it might belong to a live caller.
6. **Unchanged behaviour.** The Maven failure message, the 540 s timeout, `MOCK_OAUTH2_URL` and `MOCK_OAUTH2_MAVEN_MIRROR` stay the same, and `startMockOAuth2` keeps using `join(<returned dir>, "*")`. Update the comments in the header and at `launcher.ts:39`.

Cost: on a cold cache, each racing caller downloads its own repository, about 62 MB, as in A2-E3. Once `classpath/` is published, Maven never runs again for that version.

### Verification plan

1. **Red test first:** `tests/support/mock-oauth2/launcher.unit.test.ts`, which the unit layer includes through `tests/**/*.unit.test.ts`.
   - Because `ensureClasspath` is synchronous (`spawnSync`), the concurrent case needs two child processes, each of which imports `launcher.ts` and calls `ensureClasspath()` once. A temporary directory with the fake `mvn` goes first on their `PATH`.
   - **Concurrent build:** the fake `mvn` is the barrier from A2-E2: it records its paths, waits until 2 have registered, and exits non-zero after a timeout of a few seconds.
     - Assert that both children exit 0 and return the same path, `home/classpath`.
     - Assert exactly 2 invocations, with distinct `-DoutputDirectory` values (neither is `home/classpath` or `home/lib`), distinct `-Dmaven.repo.local` values (neither is `home/repo`) and distinct `-s` files.
     - Assert that `home/classpath/.complete` exists, that the jar there came from exactly one of the two invocations (the fake writes its PID into it), and that no `staging-*` remains.
     - On the current code this is red on every run: same output directory and same repository (A2-E2). On the fix it is green on every run.
   - **Published:** with a complete `home/classpath` present, `ensureClasspath()` returns it and the fake `mvn` (no barrier) is never invoked. On the current code this is red, because the code looks at `lib/` and runs `mvn`.
   - **Old `lib/` ignored:** with a complete old `home/lib` (`.complete` and jar) and no `classpath/`, the fake `mvn` is invoked once, `classpath/` is published, and `lib/` is left byte for byte as it was. On the current code this is red, because the code returns `lib/` without running `mvn`.
   - **Maven failure:** with a fake `mvn` that exits 1, the call throws the existing message, and neither `classpath/` nor any `staging-*` remains.
2. **Green:** the same tests pass with the fix.
3. **Real Maven (launcher experiment):** run the scratch reproduction against the fixed `launcher.ts`, two concurrent calls on an empty home, at least 6 runs. Expect 0 failures, one `ENOTEMPTY` loser per run and 48 jars, as the prototype gave in A2-E3, against 2 of 7 failures before.
4. **Re-check (step 4):** run `admin-app-flow.test.ts` and `sign-in-flow.test.ts` together in one `vitest run --config vitest.integration.config.ts`, with `MOCK_OAUTH2_HOME` set to an empty directory. Then check the next release candidate's step "Integration tests the harness does not run".

### Review

Reviewer: the same independent root-cause reviewer as attempt 1 (`failure-diagnosis.md`, step 2). Date: 2026-11-08. I did not write this diagnosis, the prototype or the launcher. Base: `v0.2.0/rc01-mock-oauth2-fix` at 41c02fb. Owner's rule: only launcher experiments (the rename semantics the publish step relies on), in the foreground, in my scratchpad, deleted afterwards.

**Verdict: accepted.** All three of attempt 1's requirements are met. The publish step is race-free for writers and readers. The `globalSetup` rejection is sound. The barrier test is deterministic in both directions. Two minor points for the fixer follow at the end.

### The three requirements
1. **A private Maven repository per call: met.** `-Dmaven.repo.local=<staging>/repo` lies outside the directory that is published (`<staging>/lib`) and is removed with the staging area in the `finally` (fix 2, 5). Nothing two calls write is shared, `settings.xml` included. The `file-lock` alternative is dropped.
2. **A new published name, with no move-aside step: met.**
   - The code publishes `classpath/`, which the old code never wrote, after writing `.complete` inside the staging copy (fix 1, 3).
   - The old `lib/`, `repo/` and `settings.xml` are never read, moved or deleted.
   - A failed rename counts as a lost race only if a complete `classpath/` then exists. Otherwise the error is rethrown, and the code never branches on the platform's error code (fix 4, A2-E4).
3. **A barrier fake `mvn` with a timeout: met.** The fake waits until two invocations have registered and exits non-zero (3, `barrier timeout`) instead of hanging (A2-E2, plan 1).

### Is the publish race-free?
- **Two writers.** Each Maven writes only inside its own staging area. `rename(2)` is serialised by the kernel. I checked in Node: a first `renameSync` onto a missing `classpath` succeeds; a second, from another staging `lib`, fails with `ENOTEMPTY` and leaves the winner's `.complete` in place. The loser's check then sees a complete `classpath/` and returns it.
  - A rename onto an *empty* directory does replace it (I checked that too). The new code never creates `classpath/` except by the rename, so that case cannot arise from the launcher.
- **A reader during the rename.** `classpath/` either does not exist or is the complete directory, with `.complete` already inside, because a directory rename has no intermediate state. Nothing is written into it after the rename, so a `java -cp classpath/*` started at any time sees a fixed set of whole jars.
  - Stress check: one process published 200 prepared directories (20 jars plus `.complete` each) by `renameSync` while another read them in a loop. 306 200 observations of an existing `classpath/` saw **0** without `.complete` or with fewer than 21 entries.
- **A crash.**
  - Killed before the rename: only a `staging-<pid>-<uuid>` directory is left. No caller ever reads one, and the next caller builds its own.
  - Killed during the rename: the rename is atomic.
  - Killed after it: `classpath/` is complete.
  - A leftover staging area costs only disk space (about 62 MB, because it holds a repository). Leaving it alone instead of deleting other callers' staging areas is right: it may belong to a live caller.

### The `globalSetup` rejection: sound
The defect needs two processes building into one `home()`, and A2-E1 shows that separate runner processes do that.
- Worktrees and sessions on one machine share `~/.cache`, and CLAUDE.md has independent items run in parallel worktrees.
- A Vitest run and a Playwright run are separate processes.
- The bare `vitest.config.ts` path has no setup.

A `globalSetup` therefore cannot make concurrent builds impossible. It would also make Maven, Java and the mirror a dependency of every run without `MOCK_OAUTH2_URL`, including PR CI runs that select neither suite. The two runners' `globalSetup` semantics are taken from their documentation, not run. That does not matter, because the design is not adopted, and adding it later on top of this fix would be an optimisation only.

### The red test: deterministic
- With the barrier, the first caller cannot return from `mvn` until the second has entered it. Nothing is published until `mvn` returns, so neither caller can take the fast path, on the current code or on the fix.
  - On the current code the two output directories and repositories are equal (`home/lib`, `home/repo`): red on every run, as A2-E2 found in 5 of 5.
  - On the fix they are distinct and exactly one publish wins: green on every run, 5 of 5.
- Every assertion is symmetric in which caller wins: same returned path, one jar origin (by PID), no `staging-*` left.
- The other three cases are each red on the current code for a structural reason, not a timing one:
  - published `classpath/` returned without `mvn`;
  - old `lib/` ignored and left byte for byte;
  - a Maven failure leaves nothing behind.

### Minor points for the fixer
1. Set the barrier timeout well above child-process start-up under load (for example 30 s, below the test's own timeout). The unit layer runs files in parallel, and a timeout that is too short gives a false red, though never a false green.
2. The fake `mvn` must create its `-DoutputDirectory` itself, as Maven does. `ensureClasspath` should not create `<staging>/lib` in advance, or must create it only as Maven would, so the red-and-green check stays faithful to real Maven.
