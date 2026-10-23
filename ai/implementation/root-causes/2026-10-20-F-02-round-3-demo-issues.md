# Root cause: F-02 round 3, demo FRAMEWORK-ISSUE #1 (no way to test the page in a browser)

- **Diagnosed by:** diagnosing subagent (prompt §8 step 1), branch `claude/implement-local-cloudflare-diag-f4`; did not write the framework, skill or demo.
- **Source:** `apps/demo/FRAMEWORK-ISSUE.md` entry 1; `apps/demo/BUILD-RECORD.md` (round 3).
- **Scope:** local reading and inspection only; no Cloudflare calls (plan §1 "Test economy"). Nothing was changed.

## Classification

**(c) Not required of the app's own tests**, plus a documentation gap in two places. Not (a): no framework code is wrong. Not (d): the builder read the rules correctly, did not work around them, and raised the issue as the skill says to.

The design gives apps no browser test layer, on purpose. The only browser driver (Playwright, PAR-114) is a framework dev dependency for compliance tests. But `docs/demo/demo-spec.md` §2 says the smoke test covers DEMO-AC-001 and DEMO-AC-009 in full, including their in-page clauses. The smoke test cannot do that by contract. The skill also never says how page-only behaviour gets verified. Faced with a spec that asks for something the skill gives no means to do, the builder raised the issue.

## Symptom

The demo has no automated check of "the copy button copies it" (DEMO-AC-009) or "a title containing `<script>` renders as text" in the page (DEMO-AC-001). Its smoke test checks only the API side of each: `/api/auth/me` returns the ID, and a `<script>` title round-trips as JSON. The features are built: `apps/demo/src/client/pages/account.ts` lines 19–31 use `navigator.clipboard.writeText(user.id)`, and the client uses only `textContent`, which `no-raw-html` enforces.

## Evidence

1. **The spec gives these clauses to the smoke test.** `docs/demo/demo-spec.md` §2 preamble (line 72) says: "The smoke test (DEMO-REQ-010) covers each criterion on a deployed stage, except: DEMO-AC-006 …, DEMO-AC-011 …, the failure clause of DEMO-AC-003, and the expiry clause of DEMO-AC-007 …; DEMO-AC-008 on cloud is verified by the compliance driver." The in-page clauses of DEMO-AC-001 and DEMO-AC-009 (line 76, line 84) are not in the exception list. Neither is "displays" in DEMO-AC-003, which has the same problem; the builder did not raise that one.
2. **By contract, the smoke test is HTTP only.** `docs/components/cli.md` line 79: `smoke` "runs Vitest in its own process on `tests/smoke/**/*.test.ts`" through `connectTestStage()`. `skill/reference/testing.md`, "The smoke test" and "In-process tests": the only tools are `createTestApp` and `connectTestStage` with `t.request` (an HTTP `Response`), `t.as`, `t.logs` and Vitest fake timers. `verify` runs only `tests/**/*.test.ts` with Vitest in Node (PAR-116).
3. **Apps get no browser driver.**
   - PAR-114 (`docs/parameters/parameters.md` line 124): Playwright is for "Browser-level compliance tests".
   - `docs/components/compliance.md` line 51: browser-level tests belong to the compliance layer.
   - `@playwright/test` is a `devDependency` of `packages/framework/package.json` and of the root `package.json`. It is absent from `apps/template/package.json`, whose devDependencies are only `typescript`, `vite` and `vitest`.
   - `playwright.config.ts` matches only `packages/framework/test/integration/**`, `tests/compliance/criteria/**` and `tests/compliance/e2e/**`.
4. **The skill forbids adding one.** `skill/SKILL.md` hard rule 1, and `skill/reference/http-and-validation.md` "Where code goes" line 13, say `tests/**` may import only the framework, `/testing`, `vitest` and app code. (The CHECK rule is looser: `packages/framework/src/check/rules/allowed-imports.ts` line 35 limits only framework subpaths in test code. That does not change this finding, because the skill is what the builder follows.)
5. **The framework's own suites test page behaviour themselves.** The template's pages are not tested by the template's app tests. `tests/skill/example-pages.test.ts` (header, lines 1–14) says: "The app tests of `verify` exercise server routes only, so the template's `index.html` and client modules … are … never executed there". It drives them in Chromium through `tests/compliance/e2e/support/template-pages.ts`, the same script E2E-001 uses. No such framework-side spec exists for the demo: `grep -rln apps/demo tests/` finds only the workspace list in `tests/compliance/criteria/compl/support.ts`.
6. **The plan leaves the in-page clauses unowned.** `ai/implementation/plan.md` F-01 (line 384): the builder "writes the demo's tests and smoke test, and passes `verify`". F-03 (line 394) runs the demo smoke test and the compliance driver's DEMO-AC-008 check. F-EV (line 400) "judges DEMO-AC-001…-011" from evidence, and per prompt §7 it reads criteria and evidence only. No step produces browser evidence for these clauses.
7. **The skill says nothing about page-only behaviour.** `grep -i "browser test|playwright|clipboard|manual"` over `skill/` finds no statement about how page behaviour is verified or that app tests do not cover it. The only hit is the scaffolder's ignore list (`skill/scripts/scaffold.mjs` line 17).

## Chain from cause to symptom

1. Apps have no browser test layer by design (evidence 3 and 4). §3 "don't over-engineer" is consistent with that.
2. The demo spec still gives the in-page clauses to the app's smoke test (evidence 1), which is HTTP only (evidence 2).
3. The skill does not say that page-only behaviour lies outside app tests (evidence 7).
4. The builder therefore saw a criterion that its tests must cover but could not. It recorded the gap without working around it. That is correct behaviour under `skill/templates/FRAMEWORK-ISSUE.md` and SKILL.md hard rule 1.
5. Nothing on the framework side covers these clauses either (evidence 5 and 6), so they have no verification anywhere today.

## Alternatives ruled out

- **(a) Framework defect.** No contract promises apps a browser driver. `testing.d.ts`, `cli.md` `smoke` and PAR-116 all describe HTTP and Vitest only, and the framework behaves as specified.
- **(b) Skill gap meaning "apps should write browser tests".** Nothing in `docs/` asks apps to write browser tests. Making them do so would add a pinned browser, a second runner and a second CLI path to every app, and widen `smoke`. That is the machinery §3 tells us not to build. The skill gap that does exist is only the missing sentence (fix 2).
- **(d) Builder misunderstanding.** The builder's reading of the skill is accurate (evidence 2 and 4), and the spec does say the smoke test covers these clauses (evidence 1).

## Proposed fix (smallest, consistent with the design)

1. **Demo spec, §2 preamble (one clause).** Add to the exception list: "the in-page clauses (DEMO-AC-001 'renders as text', DEMO-AC-003 'displays', DEMO-AC-009 'the copy button copies it') are verified in a browser by the E2E-015 check; the smoke test covers their API side." The criteria themselves are unchanged; only who verifies them changes. Record this as an `ai-proposed` decision-log entry (prompt §5).
2. **Skill, `skill/reference/testing.md` "What runs your tests" (one sentence).** "App tests and the smoke test reach the app only through its API; an app has no browser tests. Behaviour that exists only in the page (how text renders, the clipboard, images displaying) is checked outside the app's tests: keep page text to `textContent` (`no-raw-html`) and test the API side. Do not add a browser driver, and do not raise this as a framework issue."
3. **Framework side, for F-EV evidence.** A test author writes one Playwright spec in the existing `e2e` project, for example `tests/compliance/e2e/E2E-015-demo-pages.spec.ts`, tagged DEMO-AC-001, DEMO-AC-003 and DEMO-AC-009. It drives the demo under `dev`, as `template-pages.ts` drives the template, and checks three things:
   - a post titled `<script>…</script>` shows that literal text, with no script element added;
   - an uploaded JPEG's `<img>` loads (`naturalWidth > 0`);
   - after `context.grantPermissions(["clipboard-read", "clipboard-write"])`, clicking "Copy ID" puts the `/api/auth/me` ID on the clipboard.

   It needs no new dependency, because Playwright 1.64.1 and Chromium are already pinned (PAR-114). For the cloud part, the same spec can run against the F-03 test stage through the authentication mock if F-03 already deploys one. Otherwise, record the cloud part of these clauses as `not-run` with a reason.

Rejected: a skill section that shows an app browser test with Playwright. It contradicts PAR-114's scope, SKILL.md hard rule 1 and the template's dependencies. It would also not run under `verify` or `smoke`, which run only Vitest `*.test.ts` files.

## How the fix will be verified

- **Fix 3.** Run the new spec once on unchanged demo code. It must pass, because the features are built. Then show it would fail without them: replace a `textContent` with `innerHTML` in a scratch copy, or stub the clipboard write to a no-op. Each change must turn the matching assertion red, so the spec is not vacuous. The test runner records the evidence, and F-EV judges it.
- **Fix 2.** `tests/skill/budgets-and-links.test.ts` and `tests/skill/hard-rules.test.ts` still pass after the sentence is added.
- **Round 4.** The next demo build should not raise this issue, and FRAMEWORK-ISSUE #1 can be closed as resolved by the spec and skill changes.

## The grep outside the three sources (BUILD-RECORD "Incidental")

The builder grepped the installed package's `dist/index.d.ts` once and printed its SQL export line. This does not affect this issue: it concerns SQL column helpers, not testing. The one fact it gave, that `number()` exists, is already in the allowed inputs (`skill/reference/sql-and-migrations.md` line 16: "`number()` | Finite double"), so the build used no knowledge the skill lacks. For E2E-015 ("only the skill, the template, and the demo specification"), F-EV should note it as a minor, disclosed deviation. It is not a reason to repeat the round. If the owner wants a strict reading, the next round's prompt can forbid reading `node_modules`.

## Review

- **Reviewer:** independent root-cause reviewer (prompt §8 step 2), branch `claude/implement-local-cloudflare-rc-f4-review`; did not diagnose this, or write the framework, skill, spec text or demo. Read-only; no Cloudflare calls.
- **Verdict: ACCEPTED, with fix 1 replaced and fixes 2 and 3 amended as below.** The fix subagent must implement the fix as stated here, not as proposed above.

### Checks

1. **Evidence supports every link.** Confirmed: `demo-spec.md` line 72 preamble and the DEMO-AC-001/-003/-009 rows (lines 76, 78, 84); `skill/reference/testing.md` "What runs your tests" (Vitest `*.test.ts` only, `smoke` on `tests/smoke/**`); PAR-114 scopes Playwright to compliance tests; F-01/F-03/F-EV in `plan.md` (lines 384–400) produce no browser evidence. No link rests on a guess.
2. **Classification (c) is right.** Apps have no browser layer by design (PAR-114, compliance.md, template dependencies, SKILL.md hard rule 1); nothing in `docs/` requires apps to write browser tests. (a), (b) and (d) are correctly ruled out. The record's own note that DEMO-AC-003 "displays" has the same gap is correct and must be fixed too.
3. **Is the proposed spec edit binding text?** By CONVENTIONS §1 and prompt §2, binding text is `*-REQ-*` items and `docs/contracts/`; the line-72 preamble is neither, and its history (editor pass `3a10800`; `f97c8a4` only added DEMO-AC-011 as a consequence of DEC-0080) shows it is not an owner decision. So it is guidance. But it states *how the binding criteria are verified*, it is read together with DEMO-REQ-010 (binding, `owner-approved`: "a smoke test that exercises each requirement"), and `demo-spec.md` is one of the three inputs of the fresh F-01 builder (E2E-015). Rewriting it in place would change a binding item's verification story and the E2E-015 inputs silently. **Fix 1 as proposed is rejected: do not edit `demo-spec.md`.**
4. **Fix 3 as proposed weakens a criterion in two places**, contrary to prompt §5 and §8 ("never weaken a test"):
   - It allows the Cloudflare part to be recorded `not-run`. DEMO-AC-001/-003/-009 say Where "Local, cloud", and plan §8 has no not-run rule for them. F-03 already deploys a `test-` stage, where the authentication mock is installed (AUTH-REQ-009, auth.md "Provider per stage"), so the check is feasible on Cloudflare and must run there. Only the AWS part is `not-run`, under plan §8.2.
   - Its display check uses "an uploaded JPEG"; DEMO-AC-003 says a **20 MB** JPEG displays. The check must use a JPEG of at least 20 MB.
   It also names the file `E2E-015-…`, which suggests a tag it does not verify (COMPL-REQ-002; the evaluator flags "a test tagged with an ID it does not check").

### Exact fix requirements

1. **Spec: no edit.** `docs/demo/demo-spec.md` stays unchanged. Add one `ai-proposed` decision-log entry (Affects: DEMO, COMPL, SKILL) that records the deviation from the §2 preamble: the in-page clauses of DEMO-AC-001 ("renders as text"), DEMO-AC-003 ("displays") and DEMO-AC-009 ("the copy button copies it") are verified by a compliance-layer browser spec, locally and on the Cloudflare test stage; the demo's smoke test covers their API side; DEMO-REQ-010's "exercises each requirement" is read as met by that API-side exercise. Mark it `owner review open` and list it in plan §11 item 5 (Phase F). The ACs and DEMO-REQ-010 are unchanged.
2. **Skill (`skill/reference/testing.md`, "What runs your tests"): one sentence, app-generic,** as proposed in fix 2 (no mention of the demo, no browser driver, no new section). `tests/skill/budgets-and-links.test.ts` and `tests/skill/hard-rules.test.ts` must still pass.
3. **Compliance-layer Playwright spec**, written by a test-case author who did not write the demo or this fix (prompt §7), from the criteria, in the existing `e2e` Playwright project and outside `apps/demo/**`:
   - Name it without a scenario ID, e.g. `tests/compliance/e2e/demo-pages.spec.ts`; tag it exactly DEMO-AC-001, DEMO-AC-003, DEMO-AC-009. No new dependency (PAR-114 pins are reused).
   - Assertions: (a) a post whose title contains `<script>` shows that literal text and adds no `script` element; (b) a JPEG of at least 20 MB uploaded to a post displays (`<img>` `complete` and `naturalWidth > 0`); (c) with clipboard permissions granted, clicking the account page's copy control puts exactly the `/api/auth/me` user ID on the clipboard. Locate controls by accessible role and name, not by the demo's internal structure.
   - Targets: local against the demo under `dev`; **Cloudflare against the F-03 `test-` stage before it is removed** (add this step to F-03 in `plan.md`, keeping its cloud-usage limits). AWS part `not-run` under plan §8.2 only. If the Cloudflare run proves impossible, that is a §5 blocker to record and ask the owner about, not a `not-run`.
   - Red-green non-vacuity: show each assertion fails on a scratch copy with the feature broken (`innerHTML` for a title; clipboard write stubbed; image `src` broken), and passes on the unchanged demo. The runner commits the evidence; F-EV judges it.
4. **Round 4:** the fresh rebuild must not raise this issue; FRAMEWORK-ISSUE #1 closes only after items 1–3 are in and the new spec passes against the rebuilt demo locally (Cloudflare at F-03).
5. **Incidental `node_modules` grep:** agreed as a minor, disclosed deviation for F-EV to note; no change required.

## Fix (docs)

- **Writer:** fix subagent, branch `claude/implement-local-cloudflare-fix-f4a`; did not diagnose or review this, or write the demo. No Cloudflare calls.
- **Item 1:** `docs/demo/demo-spec.md` unchanged. Added DEC-0393 (`ai-proposed`, owner review open, under the owner's "Do not stop and ask me questions" instruction; Affects DEMO, COMPL, SKILL) recording that the in-page clauses of DEMO-AC-001, -003 and -009 are verified by `tests/compliance/e2e/demo-pages.spec.ts` locally and on the Cloudflare `test-` stage, the smoke test covers the API side, and why (apps have no browser tests by design; PAR-114). Listed in plan §11 item 5 (Phase F).
- **Item 2:** one app-generic sentence added to `skill/reference/testing.md` "What runs your tests" (7,325 bytes, within PAR-071).
- **Not done here:** item 3 (the spec and the F-03 step in `plan.md`), written by a separate test-case author.
- **Checks (plan §1 "Test economy", docs-only):** typecheck, lint, `tests/skill`.
