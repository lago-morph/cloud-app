# Root cause: two test files resolve mock-oauth2-server's classpath at once, and both Maven runs copy into the same `lib/`

Status: rejected

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
