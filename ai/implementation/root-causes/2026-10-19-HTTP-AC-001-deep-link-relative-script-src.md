# Root cause: HTTP-AC-001 "GET /some/deep/link returns the client entry page" — fixture page uses a relative script URL that Vite rewrites on deep links

Author: diagnosing subagent (prompt §8 step 1); did not write the code or the test. Date: 2026-10-19. Local only, no Cloudflare calls. No code or test left changed. Needs independent review (§8 step 2) before any fix.

Branch diagnosed: `origin/claude/implement-local-cloudflare` at `9c09143` (Phase B run evidence: `b229c57`, `validation/local/phase-B/05a-integration-vitest-json.log` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) lines 1766–1786, failure 12 in `SUMMARY.md`).

## Symptom
`packages/framework/test/integration/http/dev-paths.test.ts` › "[HTTP-AC-001] GET /some/deep/link returns the client entry page" fails on its last assertion, `expect(deepHtml).toBe(entryHtml)` (line 59). Status 200, `text/html` and the marker assertions pass. The only difference:
```
- <body><div id="app">bt1-client-entry-page</div><script type="module" src="./main.ts"></script></body></html>
+ <body><div id="app">bt1-client-entry-page</div><script type="module" src="/main.ts"></script></body></html>
```
(expected = `GET /`, received = `GET /some/deep/link`). The sibling `/api/does-not-exist` test passes.

## Reproduction
`npm ci && npm run build -w packages/framework`, then `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/http/dev-paths.test.ts` → 1 failed, 1 passed, same diff (reproduced at `9c09143`).

Minimal reproduction without the framework: `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/probe-vite.mjs` (plain `vite.createServer({ root, appType: "spa", configFile: false })`, Vite 8.3.4 from the workspace `node_modules`, same page shape as the fixture). Output verbatim:
```
rel: / -> ./main.ts | /some/deep/link -> /main.ts | identical: false
abs: / -> /main.ts | /some/deep/link -> /main.ts | identical: true
```

## Evidence
1. Fixture page: `packages/framework/test/integration/core/harness/harness.ts:129–132`, `CLIENT_PAGE` has `<script type="module" src="./main.ts">` (relative). `baseAppFiles` writes it at the app root and at `src/client/index.html` (DEC-0213).
2. Framework `dev` serves the client with plain Vite: `packages/framework/src/cli/dev/runtime.ts:101–133`, `createServer({ configFile: false, root, appType: "spa", … })`, plus only a Host-check middleware and an `/api` proxy. It does not touch HTML (`grep transformIndexHtml packages/framework/src/cli/dev` → none). DEC-0204 (`docs/decisions/decision-log.md:1571`) records the same (`appType: "spa"` so deep links get the entry page).
3. Vite's dev HTML transform, `node_modules/vite/dist/node/chunks/node.js:18155` (`processNodeUrl`):
   `if (url[0] === "/" && url[1] !== "/" || (url[0] === "." || isBareRelative(url)) && originalUrl && originalUrl !== "/" && htmlPath === "/index.html") url = path.posix.join(config.base, url);`
   i.e. for a request other than `/` that falls back to `/index.html`, relative URLs are made absolute against `base` (`./main.ts` → `/main.ts`); for `/` they stay as written.
4. Minimal reproduction above: relative `src` → pages differ exactly as in the symptom; absolute `src` → byte-identical. Framework not involved.
5. Experiment with the real framework (temporary one-line edit to `CLIENT_PAGE`, `src="/src/client/main.ts"`, reverted with `git checkout` afterwards, `git status` clean): `dev-paths.test.ts` → `Tests 2 passed (2)`.
6. Phase B manual check of the template (`validation/local/phase-B/09-exercise-api.log:38` (archived), `10-exercise-pages.log`): `/some/deep/link` → 200 with the same HTML and `#app` present; `apps/template/index.html:10` uses the absolute `/src/client/main.ts`.

## Cause → symptom chain
- The fixture page loads its script with a relative URL `./main.ts` (evidence 1).
- `dev` serves the page through Vite's SPA fallback unchanged by framework code (evidence 2).
- For `GET /` Vite leaves `./main.ts`; for `GET /some/deep/link` it rewrites it to `/main.ts` (evidence 3, reproduced without the framework in evidence 4). It must: unrewritten, `./main.ts` on `/some/deep/link` would resolve to `/some/deep/main.ts` and the page would not load its script.
- The test requires byte identity of the two responses (DEC-0213), so it fails on that one attribute (symptom). With an absolute URL the rewrite is a no-op and the test passes against the unchanged framework (evidence 4, 5).

## Which is wrong: code, test or contract
- **Requirement/AC** (`docs/components/http.md` HTTP-REQ-001, HTTP-AC-001): unknown non-API paths serve "the client's entry page"; `GET /some/deep/link` "returns the client entry page". The framework does serve the entry page (same file, same marker, 200 `text/html`); the URL rewrite is what makes that page work at a deep path. **The code meets the requirement.**
- **Contracts**: no contract under `docs/contracts/**` defines the client page bytes or its location (DEC-0213: "not contracted"). No contract is involved.
- **Test input is wrong**: DEC-0213 chose byte identity as the check, which is a reasonable, strict reading, but the fixture page it pairs with uses a relative script URL, which Vite's dev server by design does not serve byte-identically on nested paths. The fixture also contradicts the fixture convention recorded with DEC-0213/B-T4 (`docs/decisions/decision-log.md:1649`: "The Vite entry page is `index.html` at the app root loading `/src/client/main.ts`"), and with the root page chosen by `dev` (`src/cli/dev/plan.ts:54–58`, app root first) `./main.ts` points at a file that does not exist (`main.ts` is only in `src/client/`).

## Alternatives ruled out
- *Framework `dev` modifies the HTML or serves a different file for deep links.* Ruled out: no HTML handling in `src/cli/dev` (evidence 2); plain Vite reproduces the difference (evidence 4); both responses carry the same marker and the same `/@vite/client` injection.
- *Timing/HMR query (`?t=`) differences.* Ruled out: the only difference is the `./` → `/` rewrite, and the absolute-URL runs are byte-identical (evidence 4, 5).
- *Weaken the assertion (compare after normalising URLs, or only check the marker).* Rejected: §8 forbids weakening a test, and an equal-strength fix exists.
- *Change `dev` to undo Vite's rewrite.* Rejected: it would break relative-URL pages on deep links, the opposite of HTTP-REQ-001's intent.

## Proposed fix (not applied; owner: the test author, B-T1)
In `packages/framework/test/integration/core/harness/harness.ts`, change `CLIENT_PAGE`'s script to the absolute `src="/src/client/main.ts"` (matching `apps/template/index.html` and the DEC-0213/B-T4 convention; it resolves to the real `src/client/main.ts` when the root page is served). Keep every assertion of `dev-paths.test.ts`, including byte identity. Update DEC-0213's text to say the fixture page uses an absolute script URL because Vite rewrites relative URLs on fallback paths.
- Files touched: `packages/framework/test/integration/core/harness/harness.ts`; `docs/decisions/decision-log.md` (DEC-0213 wording; via the decision process if that file is integrator-owned).
- **Contract files: none touched.** No framework code changed.

## Verification
- Red: the current test fails at `9c09143` with the diff above (reproduction); §8 step 3 records that run as the red.
- Green: after the fixture change, `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/http/dev-paths.test.ts` → 2/2 pass (already shown by experiment 5).
- Regression: the other tests using `baseAppFiles`/`devFixtureFiles` still pass: `log/dev-files.test.ts`, `config/dev.test.ts`, `config/build.test.ts`, `http/api-helper.spec.ts`, `secrets/cli.test.ts`, `core/build.test.ts`, `core/types.test.ts`.

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2); did not diagnose this failure or write the code or the test. Date: 2026-10-19. Local only, no Cloudflare calls. No code or test changed.

**Verdict: ACCEPTED.**

Reasons, each re-checked on `origin/claude/implement-local-cloudflare`:
- *Fixture link.* `test/integration/core/harness/harness.ts:129–132`: `CLIENT_PAGE` uses `src="./main.ts"`, written at the app root and at `src/client/index.html`; `main.ts` exists only in `src/client/`. `dev`'s `clientRoot` (`src/cli/dev/plan.ts`) picks the app root first, so the fixture's root page points at a non-existent `/main.ts` even for `GET /`: it is not a page a real app would ship.
- *Framework link.* `src/cli/dev/runtime.ts:101–133` passes plain `createServer({ configFile: false, root, appType: "spa" })` plus a Host-check middleware and the `/api` proxy; no HTML handling. Confirmed.
- *Vite link.* `node_modules/vite/dist/node/chunks/node.js:18155` (Vite 8.3.4) contains exactly the quoted `processNodeUrl` condition: relative or bare URLs are joined to `base` only when `originalUrl !== "/"` and the page is the `/index.html` fallback.
- *Is it only a fixture artefact, or would a real app break? (the key question).* Independent probe (`/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/rev/probe.mjs`; plain Vite 8.3.4 with the framework's `dev` options, a real `src/client/main.ts`, then fetching the module script URL the way a browser resolves it against the requested page URL) for `/`, `/some/deep/link` and `/some/deep/link/`:
  - root `index.html` with `/src/client/main.ts` (the template, `apps/template/index.html:10`), `./src/client/main.ts`, or bare `src/client/main.ts`: every case resolves to `/src/client/main.ts` → `200 text/javascript`;
  - `src/client/index.html` as root with `./main.ts` or `/main.ts`: every case → `/main.ts` `200 text/javascript`.
  So a real app, built as the template is or with any relative script URL that is correct at `/`, loads its script on deep links under `dev`. The rewrite is what makes relative pages work; the only observable effect is that the deep-link HTML differs from `/` in that attribute when the page uses a relative URL. The framework is not wrong. `docs/components/skill.md` §2 does not prescribe the script URL form, and the skill package (`skill/`) does not exist yet, so nothing in the skill tells apps to use a form that breaks; the template uses the absolute form. Production serving is not affected by this finding: the framework has no client `vite build` yet (only `dev` imports Vite), and Cloudflare/AWS serve built assets via SPA fallback (`http.md` §2), outside this test.
- *Alternatives.* Framework changing HTML: ruled out (no HTML code; plain Vite reproduces). Timing/HMR: ruled out (single-attribute diff; absolute-URL runs identical). Undoing the rewrite in `dev`: correctly rejected, it would break relative pages on deep links (as the probe shows they currently work). Normalising the comparison: correctly rejected as weakening.
- *Fix and test strength.* Changing only the fixture's script to `/src/client/main.ts` keeps every assertion, including DEC-0213's byte identity, matches the B-T4/DEC-0213 fixture convention (`decision-log.md:1649`) and the template, and makes the fixture page actually loadable. The test stays at least as strong as HTTP-AC-001 ("returns the client entry page"). Byte identity is a stricter reading than the AC that holds only for pages with absolute URLs; the proposed DEC-0213 wording update should state that limitation so nobody later "fixes" the framework for relative-URL apps. I did not re-run evidence 5 (framework `dev` with the edited fixture); the probe covers the same mechanism, and the fixer's green run (§8 step 3) will confirm it.

## Fix

Fixer: test-case author (prompt §8 step 3); did not write the framework code, diagnose or review. Date: 2026-10-20. Local only, no Cloudflare calls. Branch `claude/implement-local-cloudflare-fix-http001` from `origin/claude/implement-local-cloudflare`.

- **Change (commit `3d57cc0`):** `packages/framework/test/integration/core/harness/harness.ts`: `CLIENT_PAGE` now loads `<script type="module" src="/src/client/main.ts">` (absolute, as `apps/template/index.html:10`); `src/client/main.ts` is already written by `baseAppFiles`, so the root page `dev` serves (`clientRoot`, app root first) now loads a real file. Comment added explaining why. No assertion changed; byte identity kept. No framework code, contract or decision-log change.
- **Red** (before the change, after `npm run build -w packages/framework`): `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/http/dev-paths.test.ts` → `Tests 1 failed | 1 passed (2)`, × "[HTTP-AC-001] GET /some/deep/link returns the client entry page", diff exactly the recorded one (`src="./main.ts"` vs `src="/main.ts"`).
- **Green** (after): same command → `Tests 2 passed (2)`.
- **Regression** (other users of the harness fixture): vitest `log/dev-files`, `config/dev`, `config/build`, `secrets/cli`, `core/build`, `core/types` → 26 passed, 1 failed; Playwright `--project=integration api-helper` → 5 passed. The one failure, `core/types.test.ts` "[CORE-AC-001] every framework type in a public signature is importable…" (`ApiErrorInit (used by ApiError)` not exported from `/client`), fails identically with the harness change reverted, so it is pre-existing and unrelated to this fixture; it needs its own §8 diagnosis.
- `npm run verify` → passed.
- **Follow-up for the decision owner (not done here):** DEC-0213's text should state that byte identity of the deep-link and `/` responses holds only for entry pages that load their scripts with absolute URLs, because Vite's dev server rewrites relative URLs on SPA-fallback paths; the fixture uses an absolute URL for that reason. The framework must not be "fixed" for relative-URL apps.

Closed by C-INT (2026-10-20): DEC-0312 records the limitation.
