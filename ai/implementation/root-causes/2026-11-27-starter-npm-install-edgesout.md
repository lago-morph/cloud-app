# Root cause: a new app's `npm install` crashes in npm 10.9.4 ("Cannot read properties of null (reading 'edgesOut')")

Status: awaiting review

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

Status: awaiting review
