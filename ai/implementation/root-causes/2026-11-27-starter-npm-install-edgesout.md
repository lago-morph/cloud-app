# Root cause: a new app's `npm install` crashes in npm 10.9.4 ("Cannot read properties of null (reading 'edgesOut')")

Status: reviewed (accepted, with corrections; fixed by DEC-0803)

## Symptom

During SETUP-AC-011's live run (2026-11-27), the starter made the app (`create-prototype-app.js my-app --framework file:<packed framework>`), then its `npm install --no-audit --no-fund` failed:

```
npm error Cannot read properties of null (reading 'edgesOut')
create-prototype-app: npm install failed; run it again in /tmp/live-setup-…/my-app
```

Running `npm install` again fails the same way. The live run went on with a lockfile cut from the repository's (the offline tests' `appLockfile`), so this did not block the setup check, but a real new user's first command fails.

## Evidence

1. **Not the packed framework.** The same `package.json` with the published `"@lago-morph/prototype-framework": "0.2.0-rc01"` instead of the `file:` tarball fails the same way. So `npm create @lago-morph/prototype-app@next` fails today for everyone with this npm.
2. **Minimal reproduction.** A `package.json` with only `"devDependencies": {"vitest": "5.0.5"}` and no lockfile: `npm install --dry-run` crashes with the same error (stack: `@npmcli/arborist` `build-ideal-tree.js` `#loadPeerSet`, recursively). With `vitest` `5.1.2` it succeeds.
3. **Time dependency.** The same minimal case with `--before=2026-11-01` succeeds; with `--before=2026-11-05`, `-11-10`, `-11-17`, `-11-24` and `-11-26` it crashes. `vitest`/`@vitest/browser-playwright` `5.1.0` was published on 2026-11-02 (`npm view @vitest/browser-playwright time`). `@vitest/browser-playwright@5.1.x` has the peer `vitest: "5.1.x"` (exact); `vitest@5.0.5` has the optional peers `@vitest/browser-playwright: "5.0.5"` and `@vitest/browser-webdriverio: "^5.0.0-beta.5 || >=5.0.0"`. The debug log fetches `@vitest/browser-playwright@5.1.0` (later `5.1.2`) right before the crash.
4. **Which npm.** Node 22.22.0 (the framework's pinned engine) and 22.22.1 both bundle npm 10.9.4 (nodejs.org/dist/index.json). `npx npm@11 install --dry-run` on the minimal case succeeds. Ubuntu's npm 9.2.0 also fails (`npm ERR!`).
5. **Workarounds that succeed** on the minimal case and on the full app `package.json`: adding `"@vitest/browser-playwright": "5.0.5"` to `devDependencies`; `--legacy-peer-deps`. **Ones that fail:** `overrides` for `vitest` (`"$vitest"`), for `@vitest/browser-webdriverio`, or for `@vitest/browser-playwright`/`-preview`/`-webdriverio` together; adding `@vitest/browser-webdriverio@5.0.0` directly.
6. **Why the repository's tests did not see it.** The repository installs from its own lockfile (`npm ci`), and the starter's offline tests write a lockfile cut from it (`packages/create-prototype-app/test/lockfile.ts`) before installing. No test installs a new app without a lockfile against the live registry.

## Causal chain

1. The template pins `vitest` `5.0.5` (and the framework depends on `vitest` `5.0.5`), and the starter installs with no lockfile (evidence 1, 6). →
2. npm 10.9.4's tree builder, resolving `vitest`'s optional peer set, loads the newest `@vitest/browser-playwright`, whose exact peer is a newer `vitest` than the root's (evidence 3). →
3. Instead of an ERESOLVE, arborist dereferences a null node in `#loadPeerSet` and crashes (evidence 2; an npm defect, absent in npm 11, evidence 4). This holds whenever the pinned `vitest` is older than the newest `@vitest/browser-playwright`, so bumping `vitest` alone only postpones it to the next vitest release.

## Alternatives ruled out

- The `file:` framework tarball (evidence 1); the network or cache (the registry answered every fetch; the dry runs with `--before` dates before 2026-11-02 succeed with the same cache); this branch's changes (the minimal case has no framework at all).

## Proposed fix (not applied; outside this item, for the orchestrator to brief)

The least change that holds across future vitest releases: the template declares `"@vitest/browser-playwright"` at the same version as `vitest` in `devDependencies` (evidence 5), and `npm run upgrade` keeps it with the companion pins (`COMPANION_PINS` in `src/cli/commands/upgrade.ts`). Alternatives: the starter ships a lockfile cut from the repository's (as the offline tests do), or installs with `--legacy-peer-deps` (riskier: required peers are then not installed). Whichever is chosen needs a test that installs a starter-made app without a lockfile from the registry (network; a release-time check), since none exists.

## Verification plan

On a fresh directory with npm 10.9.4: `npm create` from the packed starter, with no lockfile, installs; the same after `npm run upgrade`; the minimal reproduction stays in the record.

## Review

Verdict: accepted, with two corrections that do not change the cause.

Reviewer: an independent subagent that did not diagnose this failure (2026-11-27). Reproduced with the official nodejs.org v22.22.0 linux-x64 tarball (SHASUMS256 verified; npm 10.9.4), used only through PATH, against the live registry:

- **Reproduced.** The packed starter (`npm exec --package=<starter tgz> -- create-prototype-app my-app --framework file:<framework tgz>`) fails its `npm install` with the same error. The minimal case (`devDependencies: {vitest: "5.0.5"}`, no lockfile) crashes in `npm install --dry-run`; it succeeds with `--before=2026-11-01`, with `--legacy-peer-deps`, and with `npx npm@11`. Adding `"@vitest/browser-playwright": "5.0.5"` makes it succeed. The same holds for `vitest` 5.0.0 and 5.0.3 (crash alone, success with the matching `@vitest/browser-playwright`), which supports link 3's claim that any pin older than the newest `@vitest/browser-playwright` crashes and that the matching pin fixes it whatever is published later. `vitest` 4.0.10 alone succeeds (its peer set differs).
- **Correction 1 (evidence 1).** `@lago-morph/prototype-framework@0.2.0-rc01` is not on the public registry (`npm view` lists only 0.0.0-stage, 0.1.0 and 0.1.1, and `npm install` of 0.2.0-rc01 is ETARGET), so that experiment cannot have run as written. The conclusion stands on other evidence: a project whose only dependency is the packed framework tarball crashes the same way (the framework depends on `vitest` 5.0.5), and so does the minimal case with no framework. It also means a project that depends on the framework without the template's pin still crashes; the fix below covers apps made by the starter.
- **Correction 2 (proposed fix).** Adding the name to `COMPANION_PINS` would do nothing: `repin` takes those versions from the release's own `dependencies`, which do not include `@vitest/browser-playwright`. The pin has to follow the release's `vitest` version instead (`VITEST_COMPANION_PINS`).
- **Alternatives.** Agreed with those ruled out. Also checked: `@vitest/browser-playwright` in the framework's dependencies fixes the bare-framework case too (a stand-in package depending on both installs), but adds a runtime dependency (and the required peer `playwright`) to every framework install; left to the owner (DEC-0803 "Rejected").
- **Fix (DEC-0803), red-green.** Red first: `create.unit.test.ts` "the template pins @vitest/browser-playwright at its vitest version", `upgrade.unit.test.ts` "moves @vitest/browser-playwright to the release's vitest version, only when the app has it", and the new registry test `create.registry.test.ts` (packed starter, its own `npm install` with no lockfile from the registry, then `verify`), which failed under npm 10.9.4 with this error. Then the template pin, `repin` and the lockfile; all three pass. Skill hard rule 5 now names it; `skill/SKILL.md` was 8,098 bytes at this branch's head, over PAR-070's 8,000, and was trimmed in the merge into PR 180. The registry test runs in `vitest.registry.config.ts`, which the release workflow runs before publishing.
- **Verification.** With npm 10.9.4: the packed starter from the branch makes an app in a fresh folder, its `npm install` succeeds, and `npm run verify` passes (app tests and its 3 e2e-api tests). The unit layer, typecheck, lint, the duplicate check and the offline create test (`unshare -rn`) pass. "The same after `npm run upgrade`" is covered by the `repin` unit test only: no newer framework release exists to upgrade to.
- **Roles.** The orchestrator asked this one subagent to review, implement and run the tests; the test-case author, runner and evaluator roles were not separate subagents.
