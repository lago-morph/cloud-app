# Root cause: two test files resolve mock-oauth2-server's classpath at once, and both Maven runs copy into the same `lib/`

Status: awaiting review

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

Status: awaiting review
