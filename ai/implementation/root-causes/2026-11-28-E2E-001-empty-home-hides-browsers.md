# Root cause: E2E-001 / LOCAL-AC-001 cannot launch Chromium ("Executable doesn't exist at <tmp>/home/.cache/ms-playwright/…")

Status: awaiting review

## Symptom

CI run 46100846636 (PR #180, head 48742a11), job `compliance` 140842762480, e2e-ui:

```
[E2E-001][LOCAL-AC-001] … works through the template's pages under dev …
Error: the template pages run printed no result (status 1):
browserType.launch: Executable doesn't exist at /tmp/e2e-scaffold-zHl94t/home/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
  at tests/compliance/e2e/support/template-pages.ts:99
```

The scaffold (starter `npm install`) and the earlier offline steps (probe, subpath imports, `tsc`, `secrets set`) now pass; the failure is the first step that launches a browser.

## Evidence

1. **Where CI put the browser.** The same job's step "Playwright browser" (`npx playwright install --with-deps chromium`, `.github/workflows/ci.yml`) logged
   `Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248) downloaded to /home/runner/.cache/ms-playwright/chromium_headless_shell-1248`.
   Same revision (1248, `@playwright/test`/`playwright-core` 1.64.1 from the lockfile) as the one the test asks for; only the directory differs.
2. **Where the test looked.** `<root>/home` is `offlineHome`, the empty directory `E2E-001-E2E-003.spec.ts` creates in `beforeAll` (`offlineHome = join(root, "home"); mkdirSync(offlineHome)`) and passes as `HOME` to every `offline()` call (`noCredentials(offlineHome)` sets `out.HOME = home`). The template-pages run is one of them (`offline([process.execPath, PAGES_SCRIPT, …])`, spec line 131).
3. **Playwright's rule.** `node_modules/playwright-core/lib/coreBundle.js` (1.64.1), `computeDefaultCacheDirectory`: on Linux `process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")`; the registry directory is that plus `ms-playwright`, unless `PLAYWRIGHT_BROWSERS_PATH` is set. `os.homedir()` returns `$HOME`. Neither `XDG_CACHE_HOME` nor `PLAYWRIGHT_BROWSERS_PATH` is set in CI (`grep -rn PLAYWRIGHT_BROWSERS_PATH` outside `node_modules`: no hits; the job env shows neither).
4. **Control in the same job.** SKILL-AC-004 (`tests/skill/example-pages.test.ts`) runs the same driver script `template-pages.ts` with the same Chromium in the same job, without overriding `HOME`, and passed (`✓ [SKILL-AC-004] runs every example … in Chromium under dev`, 10.7 s).
5. **Local reproduction (2026-11-28, this machine, official Node 22.22.1, `unshare -rn` allowed).** With chromium-headless-shell 1248 installed in `/home/claude/.cache/ms-playwright/` and the code at 48742a11, `npx playwright test --project=e2e-ui -g E2E-001 tests/compliance/e2e/E2E-001-E2E-003.spec.ts` fails with the same message, pointing at `/tmp/e2e-scaffold-nlu1wk/home/.cache/ms-playwright/chromium_headless_shell-1248/…`. Deterministic: every attempt.
6. **History: E2E-001 has never passed in CI.** The `compliance` job exists since a632b8c (2026-10-31 18:28Z, "Apply the v0.2.0 workflows"). Every non-cancelled `ci.yml` run since then whose IDS selected E2E-001 failed it (runs 41232661020, 41367591282, 41376381848, 41389986076, 41395093210, 42428765817, 42437101662, 46095089770, 46097246249, 46100846636), each before the browser step:
   - 41232661020 … 41395093210: "a cloud provider was reachable from the offline namespace" / `unshare` refused (root cause `2026-11-02-ci-userns-offline.md`, fixed 4e5092a4);
   - 42428765817 … 46097246249: the starter's `npm install` crashed with `edgesOut` (root cause `2026-11-27-starter-npm-install-edgesout.md`, fixed in PR #180);
   - 46100846636: first run that reached the browser, and the failure above.
   The runs that passed `compliance` (41230005634, 42434148946) did not select E2E-001. The empty `HOME` (`out.HOME = home`) dates from the first version of the spec, 33a9b53d (2026-10-23); `template-pages.ts`'s `chromium.launch()` from 263c8f73 (2026-10-25). Neither changed since.

## Causal chain

1. E2E-001 runs every step after scaffolding with `HOME=<root>/home`, an empty directory (evidence 2), to keep the owner's home and credentials out.
2. The template-pages step launches Chromium through `@playwright/test`, which looks for browsers in `$XDG_CACHE_HOME or $HOME/.cache` + `/ms-playwright` when `PLAYWRIGHT_BROWSERS_PATH` is unset (evidence 3), so it looks in `<root>/home/.cache/ms-playwright` (evidence 1 and 5: the exact path in the error).
3. The browser is installed under the real home (`/home/runner/.cache/ms-playwright`, evidence 1), so the launch fails, the driver exits 1 before printing `E2E-001-RESULT`, and the spec's assertion at line 133 fails (evidence 5; control: the same script with the real `HOME` works, evidence 4).
4. The defect was present since the test was written, and hidden in CI by earlier failures in the same test, each before the browser step (evidence 6).

## Alternatives ruled out

- **Browser not installed / wrong revision.** CI installed revision 1248 (evidence 1), the revision the error names; SKILL-AC-004 launched it in the same job (evidence 4).
- **Install step skipped by the classifier** (`needs.classify.outputs.chromium`). The step ran and downloaded the browser in this job (evidence 1).
- **The offline namespace hides the file system.** `unshare -rn` makes a new user and network namespace only; the error's path is the empty home, not `/home/runner`, and the same reproduction passes once Playwright is told the real directory (verification below).
- **A change since the last green.** There is no green CI run of E2E-001 (evidence 6); the relevant code is unchanged since October.
- **Load, timing, flakiness.** Deterministic in CI (one of one run that reached the step) and locally (evidence 5); the error is a missing file, not a timeout.

## Proposed fix

Keep the empty `HOME` (it is part of the scenario: no owner home, no credentials), and tell Playwright where the machine's browsers are: when the offline environment overrides `HOME`, it sets `PLAYWRIGHT_BROWSERS_PATH` to the directory Playwright would use with the real home (`PLAYWRIGHT_BROWSERS_PATH` if already set; else, on Linux, `$XDG_CACHE_HOME` or `<real home>/.cache`, plus `ms-playwright`). The environment builder moves from the spec to `tests/compliance/e2e/support/offline-env.ts` so a unit test can hold the rule.

## Verification plan

1. Red: `tests/compliance/e2e/support/offline-env.unit.test.ts` — with `HOME` overridden, the environment points Playwright at the real browser directory; an existing `PLAYWRIGHT_BROWSERS_PATH` and `XDG_CACHE_HOME` are honoured; credentials are still removed. Fails before the fix.
2. Green: the unit test passes; E2E-001 passes locally, alone, with the browser only in `~/.cache/ms-playwright`.
3. CI: PR #180's `compliance` job passes E2E-001 / LOCAL-AC-001 (E2E-019 is out of scope: it installs the published 0.1.1 starter, open with the owner).

Results so far (2026-11-28, fixer; the fix was made before review at the orchestrator's request, so the review below also covers it):

- Red: 3 of the 5 cases failed before the fix (`PLAYWRIGHT_BROWSERS_PATH` undefined); the two that hold today's behaviour passed. Green: 5 of 5 after it.
- Local E2E-001 after the fix: Playwright now launches `/home/claude/.cache/ms-playwright/chromium_headless_shell-1248/…` (the real home); the run then stops on this machine with `libnspr4.so: cannot open shared object file`, a missing system library (CI installs them with `--with-deps`; installing system packages here is not allowed). So local evidence covers link 2–3 of the chain; the pass is CI's to show.

## Review

Status: awaiting review (to be written by an independent reviewer)
