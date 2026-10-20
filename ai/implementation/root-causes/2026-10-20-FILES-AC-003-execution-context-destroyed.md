# Root cause: FILES-AC-003 expired-ticket clause: `page.addScriptTag: Execution context was destroyed` (Phase C compliance run 2, local)

Author: diagnosing subagent (prompt §8 step 1). I did not write the code or the tests involved. This is a diagnosis only: no code or test was changed. It needs an independent review (§8 step 2) before anyone fixes it.

Branch: `claude/implement-local-cloudflare-diag-c4`, created from `origin/claude/implement-local-cloudflare` `496661f`. Run 2 used base `a5f8b43`, and the files involved here are the same in both. Vite 8.3.4, Playwright Chromium at `/opt/pw-browsers`. No Cloudflare calls were made.

## Symptom

Compliance run 2, `zcvgtq52o8niagx`, Playwright worker 0, started at 08:54:53.750Z and failed after 673 ms:

```
Error: page.addScriptTag: Execution context was destroyed, most likely because of a navigation
   at tests/compliance/criteria/files/browser.ts:62   (installHelpers)
   at browser.ts:69                                   (openAppPage)
   at tests/compliance/criteria/files/expired-ticket.spec.ts:29:5
```

Line 29 is the **first** `openAppPage(page)` call, before any ticket is issued. It is not the call after the 15-minute wait. C-T3's run `xc3s44jl2dbmqpv` passed the same test.

## Short answer

The page really was reloaded, and the reload came from Vite's HMR client in the page:

1. Earlier in the run, the vitest phase made `dev`'s Vite server put `packages/framework/dist/**` into its client module graph. SEC-AC-002 (`secrets/no-leak.test.ts`) did this when it crawled `/` and its imports over HTTP.
2. A later vitest test, SKILL-AC-005 (`skill/scaffold.test.ts`), ran the real scaffolder. The scaffolder's `npm pack` runs `prepack` (`npm run build`), which rewrote those `dist` files.
3. Vite answered the rewrite with a `full-reload`. No browser was connected yet, so Vite **buffered** the message and sent it to the first HMR client that connected.
4. That first client was the expired-ticket test's page. On connecting, it got the buffered `full-reload` and called `location.reload()` while `installHelpers` was running.

## Evidence

E1. **Run 2's request log shows two document loads of `/` in this test.** Run 2's `raw/dev.log`, lines 330–339:

```
330-332  POST /api/cases/run …            ← last vitest-phase requests
333      POST /api/auth/mock-login 204    ← ticketClient("c-t3-files-expiry") (first reference-app request of the Playwright phase)
334      GET  /api/auth/me 200            ← page load 1: src/client/main.ts → getCurrentUser()
335      GET  /api/files/list 200         ← finally { removeAll(u, prefix) } after the failure
336      GET  /api/auth/me 200            ← page load 2: the same page re-ran main.ts
337      POST /api/auth/mock-login 204    ← worker 2's first test (transfers.spec.ts 20 MB), 08:54:56
338      GET  /api/auth/me 200
339      POST /api/files/upload-ticket …
```

- At 08:54:53–54 the only other active worker ran `packages/framework/test/integration/http/api-helper.spec.ts`. That spec runs its own temporary app, not the reference app (see `playwright.json` start times and worker indexes).
- The reference app calls `/api/auth/me` only from `main.ts` at document start.
- No `GET /api/auth/login` appears, so the page did not navigate through `login()`.
- No `upload-ticket` request appears, so the failure came before the ticket was used.

E2. **Neither the test nor the app navigates on its own.**
- The test calls `page.goto("/")` once before line 29.
- The only page-side navigations in `apps/reference/src/client` and `packages/framework/src` are `login()` (`location.assign`, on click) and the logout button's `location.reload()` (on click).
- That leaves Vite's injected client. Its `location.reload()` call sites are at `node_modules/vite/dist/client/client.mjs` lines 1006 (`pageReload`, used by `full-reload`, line 1092ff), 1036 (error overlay on the first update) and 1088 (`vite:ws:disconnect` followed by a successful ping).

E3. **Vite buffers a `full-reload` sent while no client is connected and delivers it to the first client that connects.** In `node_modules/vite/dist/node/chunks/node.js`:
- Lines 24719–24723: `if ((payload.type === "error" || payload.type === "full-reload") && !wss.clients.size) { bufferedMessage = payload; return; }`
- Lines 24693–24696: on a new connection, the server sends `{"type":"connected"}` and then `bufferedMessage`.
- When a changed file has client-graph modules and no HMR boundary, Vite sends `full-reload` with `path: "*"` (around lines 25620–25638).

E4. **A plain HTTP GET of `/` puts the framework's `dist` files into Vite's client graph and watcher.** This is because `dev` serves the reference app's workspace-linked framework, whose real path is `packages/framework/dist`. That path is outside `node_modules`, so Vite does not ignore it.
- Experiment (dev log saved at `diag-c4/dev3.log`): start `dev`, `curl` `/`, then `npm run build -w packages/framework`.
- Result: Vite logs `vite:hmr [file change] …/packages/framework/dist/{core/errors,http/client,auth/client,files/tickets,files/client,client/index}.js`. Only the `(ssr)` environment logs `[no modules matched]`, so the client environment did match these modules.
- With no curl first, a build produces no such lines (rerun E7: nothing until 09:57).

E5. **Reproduction with the real tests, step for step as in run 2** (`diag-c4/dev4.log`):
1. Fresh `dev` for the reference app, with `apiKey` set to a generated dummy value.
2. `vitest run tests/compliance/criteria/secrets/no-leak.test.ts`: passed.
3. `vitest run tests/compliance/criteria/skill/scaffold.test.ts`: passed. Vite logs the six `dist` `[file change]` lines at 10:35:55–56.
4. Open the first Chromium page (`diag-c4/.diag-repro.mjs`):

```
   36ms framenavigated http://localhost:35469/
  106ms ws<- {"type":"connected"}
  112ms ws<- {"type":"full-reload","triggeredBy":"…/packages/framework/dist/client/index.js","path":"*"}
  137ms nav-request http://localhost:35469/        ← the page reloads itself
  160ms framenavigated http://localhost:35469/
```

E6. **The exact error, reproduced.** `diag-c4/.diag-repro2.mjs` does what `openAppPage` does: `goto("/")`, then `addScriptTag` with the real `<package>/client` esbuild bundle, then `waitForFunction(fw.uploadFile)`. It waits `DELAY` ms in place of the `await clientBundle()` time. Each attempt follows a rebuild with no browser connected:

```
control (no rebuild)  → helpers installed
DELAY=0  (6 runs)     → page.waitForFunction: Timeout 30000ms exceeded   (fw installed, then wiped by the reload)
DELAY=10              → page.waitForFunction: Timeout 30000ms exceeded
DELAY=20              → page.addScriptTag: Execution context was destroyed, most likely because of a navigation
DELAY=30/40/50        → helpers installed   (reload already finished before addScriptTag)
```

- The reload is deterministic once a message is buffered. Which error appears depends only on where `addScriptTag` falls relative to the reload, which comes about 20 ms after connect plus navigation time.
- With the real spec after a buffered reload (`dev3.log` lines 87–95: mock-login, `auth/me`, `auth/me`), the reload landed during `openAppPage`. That time, `installHelpers` ran after it, so the test went on.

E7. **Faithful rerun without run 2's precondition** (`diag-c4/1owr20jbxay0luf/`): `npm run compliance -- --target local` with `DEBUG=vite:hmr,vite:deps,vite:ws`, no secret set.
- SEC-AC-002 failed early at `testSecretValue()` with a missing prerequisite, so it never crawled `/`.
- `core/deployment.test.ts` first fetched `/` at 09:52:2x. That was after `scaffold.test.ts` finished (09:51:13–09:52:04).
- So no `dist` change was seen while no browser was connected, nothing was buffered, and FILES-AC-003's expired clause **passed**.
- In run 2, by contrast, `no-leak.test.ts` passed at 08:33:11–24, so `/` was crawled, and `scaffold.test.ts` rebuilt `dist` at 08:45:01–40, about 9 minutes before the first browser page (run 2's `raw/vitest.json`). `testSecretValue()` passed because run 2 set the secret first (`phase-C-run-2/03-secrets-set.log`).
- The same rerun also shows the live (unbuffered) form: E2E-001 packs the framework at 09:57:37–38 (it started at 09:57:28.9) → six `dist` change lines → `GET /api/auth/me` from each open reference page reloading.

E8. **Why C-T3's run passed.** `tests/compliance/criteria/skill/scaffold.test.ts` was added in `d887ead` (2026-10-20 05:22). That is after C-T3's run `xc3s44jl2dbmqpv` (no-leak at 04:00:54), and `d887ead` is not in C-T3's commit `a6b711e`. In C-T3's run, nothing in the vitest phase rewrote `dist` after the crawl.

## Chain (cause → symptom), with evidence for each link

1. `dev` serves the reference app with Vite, and the framework is a workspace link whose real path (`packages/framework/dist`) Vite watches. **E4**
2. SEC-AC-002's asset crawl (`GET /` and its imports) adds those `dist` modules to the client graph and the watcher. It runs only when the secret is set, as it was in run 2. **E4, E5, E7**
3. SKILL-AC-005 runs the real scaffolder later in the same vitest phase. Its `npm pack` → `prepack` → `tsc` rewrites `dist/**` (`skill/scripts/scaffold` lines 22–30; `packages/framework/package.json` `"prepack": "npm run build"`). **E5, E7**
4. Vite turns the rewrite into a `full-reload`. With no HMR client connected, it buffers the message. **E3, E4**
5. The first browser page on the reference app in run 2 was FILES-AC-003's expired-ticket page (E1: line 333 is the first Playwright request to the reference app). On connecting, it gets the buffered `full-reload` and reloads. **E1 (second load), E5**
6. The reload replaces the execution context while `installHelpers` runs `addScriptTag`, which gives exactly this error. **E6**

## Alternatives ruled out

- **Load or timing as the cause.** The reload is caused by a buffered message, not by slowness (E5, E6: it is deterministic once something is buffered). Timing only decides which Playwright call sees the reload. Run 2's machine load (other agents' vitest and workerd) is not needed for the failure, and no part of the chain depends on it.
- **The app navigating** (login, logout, error page). There is no login request in the window (E1), and the app navigates only on clicks (E2).
- **Vite dependency optimizer reload.** On a cold cache, Vite logs "no dependencies found by the scanner or crawling static imports" and never logs "optimized dependencies changed" (dev1, dev2 and the rerun logs). 60 page loads (3 in parallel) on a server with nothing buffered gave 0 extra navigations (`.diag-loop.mjs`).
- **HMR WebSocket disconnect → ping → reload.** In every reproduction, the socket opened and stayed connected, and the reload followed the `full-reload` frame (E5). Neither `cors:false` nor the host-check plugin touches the WebSocket upgrade: the control loads connect cleanly.
- **The Vite `cors:false` / proxy `changeOrigin:true` change (`69ae283`).** It affects HTTP responses on `/api`. The reload comes from the HMR channel, and reproductions on this code pass whenever nothing is buffered (control runs, E7).
- **D-02's download-name change (`files/local/route.ts`).** The failure comes before any ticket is issued or used (E1: no upload-ticket). The test passes on this same code in E7.
- **A defect in the expired-ticket test's own logic.** The clause it checks never ran in run 2. The same test passes whenever its first page is not reloaded (E7, and the targeted run in `pw-a.log`: 14 passed, including this test at 15.5 m).

## Which side is wrong

Neither FILES (code) nor the expired-ticket assertions are wrong. Two legitimate things combine:
- The compliance suite runs the real scaffolder, which by design rebuilds the framework's `dist` (DEC-0049; SKILL-AC-005 and E2E-001 must use the real scaffolder).
- `dev`, run in the monorepo, reloads every reference-app page when `dist` changes, and it reloads the *next* page if none is open.

The defect is in `dev` (code): it watches the framework package's files. An installed app never sees this, because there the framework lives under `node_modules`, which Vite ignores (default `server.watch.ignored` covers `**/node_modules/**`). The reference app is meant to use the framework as an installed app would (it imports `<package>/client` like any app), but here its `dev` reacts to framework rebuilds. The browser helpers' assumption that a page loaded with `goto` stays put is reasonable for an installed app's `dev`. That assumption breaks only because of this monorepo-only watching.

## Proposed fix

`packages/framework/src/cli/dev/runtime.ts`, `startClient`: exclude the framework package's own directory from Vite's watcher. For example, set `server.watch.ignored` to the real path of the package root (resolved from the running CLI's own location, `dirname(fileURLToPath(import.meta.url))` up to the package directory) plus `/**`, and keep Vite's defaults.

After this change:
- A rebuild of `dist` while `dev` runs neither reloads open pages nor buffers a reload for the next one, matching `dev` in an installed app.
- In the monorepo, edits to the framework then take effect after restarting `dev`, as they would after reinstalling the package.
- No test changes, and no weakening.

Considered, and not proposed as the main fix:
- **Making `openAppPage` wait out reloads.** That treats the symptom. E7 shows live reloads during Playwright too (E2E-001's pack at 09:57:37), and they could hit any browser test in the middle of an `evaluate`.
- **Running the scaffolder tests on a scratch copy of `packages/framework`.** That is heavier and still leaves `dev` behaving unlike an installed app.

## Verification

1. **Red first (§8 step 3).** Add an integration test, in the dev harness (`packages/framework/test/integration/...`, using `startDev` on a fixture app that links the framework as the reference app does):
   - fetch `/` over HTTP;
   - run `npm run build -w packages/framework` (or rewrite one `dist/client/*.js` file with identical content);
   - open a Chromium page and record main-frame navigations and HMR frames for about 2 s;
   - assert exactly one navigation and no `full-reload` frame. It must fail on the current code (as in E5) and pass with the fix.
2. **Repeat E5 on the fixed code.** Fresh `dev`, `no-leak.test.ts`, `scaffold.test.ts`, then first page: expect no `full-reload`, and run `.diag-repro2.mjs` at `DELAY=0/10/20` with "helpers installed" each time.
3. **Rerun FILES-AC-003** in a full `npm run compliance -- --target local` *with the `apiKey` secret set*, as in run 2, so that SEC-AC-002 crawls and SKILL-AC-005 rebuilds before Playwright. Expect the expired-ticket clause to pass. Also expect, from `dev.log` with `DEBUG=vite:hmr`, no `[file change]` lines for `packages/framework/dist` during the run.

## Evidence files

- Run 2: `validation/local/zcvgtq52o8niagx/raw/{playwright.log,playwright.json,dev.log,vitest.json}` and `validation/local/phase-C-run-2/`.
- Diagnosis scratch, not committed: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/diag-c4/`. It holds `dev1.log`–`dev4.log`, `.diag-repro.mjs`, `.diag-repro2.mjs`, `.diag-loop.mjs`, and the rerun record `1owr20jbxay0luf/` with its `raw/dev.log` (`DEBUG=vite:hmr,vite:deps,vite:ws`).

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this failure or write the code or tests involved. Branch `claude/implement-local-cloudflare-rc-c4-review` from `origin/claude/implement-local-cloudflare`. Local only; no Cloudflare calls. The `dev` server I started was stopped.

**Verdict: ACCEPTED.** The fix is the one proposed (in `dev`), with one implementation detail made exact below. No test change is needed or wanted.

### Links checked myself

- **Link 1 (Vite watches the linked framework's real path).** `node_modules/@lago-morph/prototype-framework -> ../../packages/framework` (workspace symlink). `startClient` in `packages/framework/src/cli/dev/runtime.ts` sets no `resolve.preserveSymlinks` and no `server.watch`, so Vite resolves the import to `packages/framework/dist/...`. Vite 8.3.4's `resolveChokidarOptions` (`node_modules/vite/dist/node/chunks/node.js` ~16836) ignores only `**/.git/**`, `**/node_modules/**`, `**/test-results/**` and the cache dir, then appends the user's `ignored`. A real path outside `node_modules` is watched; in an installed app the same files are under `node_modules` and ignored. Confirmed.
- **Links 2–5 (crawl, rebuild, buffered `full-reload`, first client gets it).** Reproduced on this branch with the real `dev` of `apps/reference` (`DEBUG=vite:hmr`) and a bare HMR WebSocket client (`vite-hmr` protocol):
  - control: `npm run build -w packages/framework` with nothing fetched, then connect → only `{"type":"connected"}`;
  - `curl /` (200), rebuild → six `[file change] …/packages/framework/dist/...` lines; then connect → `{"type":"connected"}` followed by `{"type":"full-reload","triggeredBy":"…/packages/framework/dist/client/index.js","path":"*"}`;
  - a second client then gets only `connected` (the buffer is one-shot, delivered to the first client).
  - Buffering code: node.js lines 24719–24724 (`full-reload` with `!wss.clients.size` → `bufferedMessage`) and 24694–24696 (sent on connect). Confirmed.
- **Link 3 source.** `skill/scripts/scaffold` runs `npm pack` in `packages/framework`; `packages/framework/package.json` has `"prepack": "npm run build"` (`tsc -p tsconfig.build.json`), which rewrites every `dist` file. SKILL-AC-005 (`tests/compliance/criteria/skill/scaffold.test.ts`) runs that real script; so does E2E-001 (`tests/compliance/e2e/E2E-001-E2E-003.spec.ts`), in the Playwright phase. The compliance harness starts one reference `dev` for both phases (`tests/compliance/harness/node-deps.ts` `startReferenceDev`). Confirmed.
- **Link 6 (reload during `addScriptTag` gives this exact error)** and run 2's double `/api/auth/me` (E1): I did not re-run E6 in a browser. The record's timing experiment plus the frame sequence I reproduced are enough: a `location.reload()` during `addScriptTag` is the documented cause of "Execution context was destroyed … because of a navigation", and E7 shows the test passing when nothing is buffered.
- **Alternatives.** The record rules out app navigation, optimizer reloads, WebSocket ping-reloads, the `cors`/proxy change and D-02, each with evidence. I also checked that wrangler does not restart the Worker on the `dist` rebuild (no restart lines in my `dev` log), so the Worker side is not a second path.

### Where the defect is: `dev`, not the test

- **The test is not doing anything wrong.** Rebuilding `dist` is inherent to the real scaffolder (DEC-0049: installation is verified from an `npm pack` tarball; SKILL-AC-005 and E2E-001 must use the real `skill/scripts/scaffold`). Any developer who runs the scaffolder in this repo while `dev` runs gets the same reload. The rebuild produces the same content from the same source; only `dev` reacts to it.
- **Test-side options are worse and incomplete:**
  - *Pack from a copy:* the scaffolder resolves `packages/framework` from its own location, so this means changing the scaffolder or copying the repo. Either way the test stops exercising the real scaffolder.
  - *Skip the prepack build:* that weakens SKILL-AC-005 and E2E-001 (stale or missing `dist` in the tarball), which §8 forbids.
  - *Run SKILL-AC-005 in its own pass:* this does not cover E2E-001. E2E-001 packs during the Playwright phase while other workers have reference pages open, and record E7 shows the live reload of every open page at 09:57:37. Fixing the tests would mean serialising every packing test against every browser test, which treats the symptom.
- **Can the reload hit other tests?** Yes, as long as `dev` watches the framework dir: any browser test on the reference app that is mid-`evaluate`/`addScriptTag` when either packing test runs, and the first browser page after any vitest-phase pack. The `dev` fix removes all of these at once. Test-side fixes would each remove one trigger.
- **Is ignoring the framework dir correct product behaviour?** Yes. `docs/components/local.md` (the `dev` paragraph) and `cli.md` specify no reloading on framework changes, and an installed app (the product's real case) never watches it, because it lives under `node_modules`. The change only makes the monorepo match what users get. The cost is that framework edits in this repo take effect after a `dev` restart, the same as reinstalling a package.

### Exact fix

In `packages/framework/src/cli/dev/runtime.ts`, `startClient`, add `server.watch.ignored` for the framework package's own root, resolved from the running module:
- walk up from `dirname(fileURLToPath(import.meta.url))` to the directory holding the framework's `package.json`;
- take its `realpathSync`;
- pass `watch: { ignored: [(p) => p === pkgRoot || p.startsWith(pkgRoot + sep)] }`.

Prefer a function matcher over a `${pkgRoot}/**` glob, so that glob metacharacters in a checkout path cannot break the match. Vite appends this to its defaults, so `node_modules`, `.git` and the cache dir stay ignored. Nothing else changes; no test is changed or weakened.

Verification as in the record: a red integration test first (fetch `/`, rebuild or rewrite a `dist/client/*.js`, then the first page sees one navigation and no `full-reload` frame), then the E5 repeat, then a full local compliance run with the `apiKey` secret set. Also check for the live form: with a reference page open, run the scaffolder, and the page must not reload.

Side note (not part of this cause, no change asked): Vite also logs `[file change]` for `apps/reference/.wrangler/state/**`. No client module matches those files, so they cause no reload today.

## Fix

Fixer: fixing subagent (prompt §8 step 3). Branch `claude/implement-local-cloudflare-fix-c4b` from `origin/claude/implement-local-cloudflare`. Local only; no Cloudflare calls. Every `dev` server I started was stopped.

### Change

The reviewed fix, as written; no test was changed or weakened.
- `packages/framework/src/cli/dev/runtime.ts`: a new `frameworkRoot()` walks up from `dirname(fileURLToPath(import.meta.url))` to the nearest directory with a `package.json` and returns its `realpathSync`. That directory is `packages/framework`, both from `dist/cli/dev` and from `src/cli/dev`.
- `startClient` passes `server.watch.ignored: [(p) => p === pkgRoot || p.startsWith(pkgRoot + sep)]`. It is a function, not a glob. Vite appends it to its defaults (`.git`, `node_modules`, `test-results`, the cache dir).

### Red, then green

- Added a unit test, `[FILES-AC-003] does not watch the framework package's own files…`, in `runtime.unit.test.ts`. It uses the Vite mock already in that file, and it checks that:
  - the framework's real root and `dist/client/index.js` are ignored;
  - `/apps/one/src/client/main.ts` and a sibling `<root>-other/x.js` are not.
- **Red on the original `runtime.ts`:** `AssertionError: expected false to be true` at the root assertion, line 54. The framework root was not ignored. 1 failed, 2 passed.
- **Green with the fix:** 3 passed.

### The original chain, reproduced on the fixed code

Fresh `dev` of `apps/reference` with `DEBUG=vite:hmr`:
1. **Crawl.** A crawler fetched `/` and every module it imports over HTTP: 13 paths, including the 6 `packages/framework/dist` modules.
2. **Rebuild, then connect.** I ran `npm run build -w packages/framework` (it did rewrite `dist/client/index.js`), then opened the first Chromium page. Frames: `framenavigated /`, `ws<- {"type":"connected"}`, and then nothing for 3 s. Result: **1 navigation, 0 `full-reload` frames.** Before the fix, the page got `{"type":"full-reload",…dist/client/index.js}` and reloaded (record E5).
3. **Live form.** With a page open, I rebuilt `dist` and watched for 15 s: 1 navigation, 0 `full-reload` frames.
4. **The dev log** had 0 `[file change]` lines for `packages/framework` across all of this.
5. **Control: app files are still watched.** With a page open, `touch apps/reference/src/client/main.ts` produced `[file change] src/client/main.ts` and a `full-reload` (2 navigations).

### Checks

- **`npm run verify`** passes online and offline (`unshare -rn sh scripts/offline.sh`). Unit tests: 1638 passed.
- **`npm run compliance -- --target local --only FILES-AC-003,SKILL-AC-005,E2E-001,SEC-AC-002`:**
  - Run `vhigthtzz589duv`, no `apiKey` set: FILES-AC-003, SKILL-AC-005 and E2E-001 passed; SEC-AC-002 failed.
  - Run `bgsa0djfwc7wl79`, with a dummy `apiKey` set as in run 2, so `no-leak.test.ts` passed and crawled `/` before `scaffold.test.ts` rebuilt `dist`: the same three passed, including the expired-ticket clause (15.5 m). Its `raw/dev.log` (with `DEBUG=vite:hmr`) has 0 lines naming `packages/framework`.
  - The dummy secret was removed from `.dev.vars` afterwards. Evidence for both runs is in scratch, outside the repo: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/fix-c4b/compliance{,2}/`.
- **SEC-AC-002's remaining failure is not caused by this change.** In both runs one test failed: `packages/framework/test/integration/secrets/cli.test.ts` `[SEC-AC-002] local: …` with `expected +0 to be 3` on `errorResponses.length`.
  - That array is filled only by the same file's SEC-AC-001 test, which `--only` filters out.
  - The file run unfiltered passes, 4 of 4.
  - So it is an ordering dependency between tests, exposed by `--only`. It needs its own root-cause record and is not part of this fix.
  - In the first run, `no-leak.test.ts` also failed with `PREREQUISITE MISSING` (no `apiKey`), as in record E7.
