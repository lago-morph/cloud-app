# Progress — v0.2.0 (sign-in with Cloudflare, testing standards)

Plan: `ai/implementation/plan-v0.2.0-testing-auth.md` ("plan §n"); governing prompt `ai/prompts/implement-local-cloudflare.md` ("prompt §n"); `plan.md` §9.2/§10 conventions apply. PR index: `v0.2.0-pr-stack.md`. Owner questions: `owner-questions-v0.2.0.md`. Live-pass runbook: `live-pass-v0.2.0.md`. Base: `main` at `1e0c289`.

**Status legend:** `todo` · `running` · `blocked` (reason in Open items) · `done` (merged, exit check met) · `not-run` (cannot run in this sandbox; reason given).

**Cloud token: not available at run start (2026-10-31).** `tokens/verify` returns "Missing Authorization header" and `CLOUDFLARE_API_TOKEN` is unset. Every Cloud, `test-` stage and `prodcheck` pass is `not-run`; items do local work only (unit, integration, local e2e, fakes, mock-oauth2-server). Owner question 1.

**Owner unavailable for the whole run.** Nothing waits on the owner. §6.1 wording goes in its own spec PR marked "owner approval of wording needed"; implementation proceeds on the proposed wording.

## 1. Decisions taken
<!-- one line each: date · ID · item · decision · where recorded -->
- 2026-10-31 · DEC-0620 · R · Nothing merges during the run, so "after X merged" in §3/§4 means "after X is pushed on its branch". Stacks still base on `main` unless they edit a file or import code that a lower PR changes; then they stack on that PR's branch. A and C start in batch 1 alongside wave 0 (their owned paths do not overlap S1–S4). · owner-questions 2
- 2026-10-31 · DEC-0621 · R · A's CI step and path-map entry move out of PR 28 into a separate small PR `29-auth-app-ci` based on S3's top branch (`17-ci-no-duplicates`), merged after 28 and 17. This avoids two stacks editing `ci.yml`. · owner-questions 3
- 2026-10-31 · DEC-0623 · R · Merge-only PRs join two stacks when a later item needs both. `55-merge-auth-app-into-bootstrap` (#94) merges A's 28 into C's 34; E and F stack on it. · owner-questions 15
- 2026-10-31 · DEC-0622 · R · C's pure-removal PR 34 is opened by C. T5 adds its test-change review record onto the branch before merge. · progress §3 T5

## Open items
<!-- blocked items, cross-stack merge preconditions still pending, owner questions raised -->
- From P0: (1) COMPL-AC-001: SETUP-AC-011 is missing from the COMPL-REQ-006 milestone list. The fix is a `compliance.md` amendment, and D 36 must keep SETUP-AC-011 when it rewrites the list. (2) MAIL-AC-005: three `@example.com` addresses in unit tests, `test-was-wrong`. A small fix, `08`, is proposed, even though B 46 retires the criterion. (3) The five blocked IDs are a runner step (local `apiKey`). S3 was told to add it to CI.
- **Blocked: no writes to `.github/workflows/*`.** `git push` and the GitHub MCP both refuse them ("refusing to allow an OAuth App to create or update workflow … without `workflow` scope"). S3 staged its workflows in `scripts/ci/workflows/`. A's CI step (DEC-0621, PR 29) must be staged the same way, on S3's top branch. CI on every PR still runs the old `ci.yml` until the owner applies the staged files.
- S3 saw `native-copy.unit.test.ts` fail intermittently ("fetch failed") under load. A diagnoser is running (branch `91-fix-native-copy-fetch`).
- **Live-pass items collected so far** (for L's runbook):
  - **A:** the "Administrator" role string (PAR-413).
  - **C:** the dashboard TTL picker's `expires_on` (is "tomorrow" more than 24 h?); the field names when an OAuth client is created and in its answer; the Secrets Store comment and store-create; script upload with `secrets_store_secret` bindings made with the bootstrap token.
  - **E:** the three unverified points on plan §5.2 page 2 (E-5: can the grant update a token it did not create? E-6/E-7: does each scope cover its group, and does the token hold exactly four groups? does a deploy with a Secrets Store binding need Secrets Store Read?); E-1, the token answer's `scope` omits unticked scopes; E-2, admin-app upload with `plain_text` bindings and `nodejs_compat`; E-4, the shape of a D1 query answer with a grant token; E-8, does `workers-r2.write` cover the signing token's group (release-blocking for page 1); E-9, auth-app upload with `d1` and `plain_text` bindings; E-10, R2 object and bucket deletes with a grant token.
  - **F:**
    - Pulumi `service` binding with `entrypoint`;
    - Pulumi `secrets_store_secret` upload made with the everyday token (does it need Secrets Store Read?);
    - the script settings' D1 field, `id` or `database_id`;
    - D1 `/query` on the auth app's DB with the everyday token;
    - delete-then-bind, and falling back to Worker secrets, on a live Worker;
    - whether Secrets Store `comment` round-trips;
    - the status a store listing returns without Secrets Store;
    - whether a store-bound stage signs R2 tickets.
- D follow-up also: AUTH-REQ-003 in `auth.md` still cites "PAR-425…PAR-434"; name PAR-425, 426, 427 (DEC-0695 follow-up). B's DEC-0667 cites DEC-0660 where it means DEC-0661 (copied as written into the log by I1; correct it in I2). I1 chose PAR categories `platform` for PAR-413/418 and `ai-proposed` for the other A/B PARs.
- D follow-up (one small spec PR, after B 43): the PROV-AC-002 text from F (*"For a production stage, without the account's auth app or its registry, deploy names it and stops before creating anything; a production deploy registers `<public origin>/api/auth/callback` for `<app>-<stage>` with the auth app, and `remove` clears it."*), plus the COMPL-REQ-005, COMPL-AC-005 and prodcheck paragraph amendments (owner-questions 19).
- Under full-suite load (load average up to 38, with other agents running), T4 also saw `admins.unit.test.ts` time out. It passes alone. `admins` is removed by B 47. T6 notes it; no diagnosis unless it recurs after B 47.
- New finding from T4: `apps/template/src/server/signing.ts`, copied into `apps/demo`, accepts 4 spellings of each share-link signature. The fix goes with G (template owner) through §7a.1.8; the record stub is on T4's 89.
- T5 assignments: `criteria/compl/prodcheck.test.ts` (MAIL-AC-006, PWD-AC-009) → B; the mail parts of `sst.unit.test.ts` → F; the email parts of `target.unit.test.ts` → C 34a. T5's advisory notes: no test covers the `free` plan getting past the plan check (C), and no test covers the mock-oauth2 CI step (A 29). Both go to T6.
- T5 queue also: E's #104 delete-guard group (pending).
- T5 queue (test-change records still to write): S3's PRs (G1–G3 are already in `2026-10-31-S3.md`; T5 reviews the coverage), C's #88 (pure removal), D's #83 (retirement), B's 43/45/46/47, #95's classifier assertion (`behaviour-changed`, done), and #97's `record()` helper (`test-was-wrong`).
- T7: `92-fix-mig-record-order` **done**, PR #97, CI green. The defect was in the test helper `record()` in `apply.unit.test.ts`: `test-was-wrong`, plus a new `bug-fix` red→green test. The MIG criteria pass through the harness. T5 still needs to write the test-change record for #97. `91-fix-native-copy-fetch` **done**, PR #123, CI green. Before the fix (red), ingest and query had 243 prepares with no event-loop turn; after it (green), the unit run passes 2529/2529. Under stress the fixed version failed 0/16 runs against 2/16 for the unfixed control, and the same `prepareAll` fix also covers `d1/check.unit.test.ts` (0/12 against 4/12). Test-change review accepted. Open: the record's headings don't match S2's lint format ("Causal chain", and Review reasons are not marked major/minor). Fix this before #87 merges. `93a-fix-selection-e2e004` **done**, PR #126 (base 17/#76), CI green. Red→green: a hung runner made the listing hang until an external kill; now the runner's whole process group is killed at its limit (`ListingTimeoutError`), a missing build fails in 0.2 s naming the build command, and the test moved to `tests/compliance/coverage/cloudflare-selection.test.ts` (integration layer, COMPL, new path-map entry). 8/8 copies pass at load 60. Limits re-derived 180 s→630 s and `E2E-004.spec.ts` 600 s→630/930 s, accepted by the independent reviewer as `test-was-wrong` with a derived limit (record `test-reviews/2026-10-31-T7-selection.md`); **T6 must check that the derivation is sound and not masking.** DEC-0782–0786. **#126 must not merge until the staged `ci.yml` is applied** (live CI only runs the test via `test:unit`, which no longer collects it): owner question 9 extended.
- From B (done): (1) Kept for C 34a, to delete after B 47: `src/mail/{mime,sink-worker,sender,local-files,capture,local}.ts`, `cli/commands/mail.ts` and their tests. (2) `pwd/support.ts`, the outbox and `TestApp.mail` stay while C's `setup-account.test.ts` and the unowned `secrets/password-no-leak.test.ts` use them; that test fails at runtime from 45 on → C 34a takes it (retire with the PWD criteria, `code-removed`). (3) The EMAIL binding and MAIL-AC-004 tests stay until F's `sst.ts` stops reading them → C 34a. (4) `harness/prodcheck.ts` still includes PWD-AC-009 because the unowned `driver.unit.test.ts` asserts it → T5/T2. (5) E2E-007 cloud part not-run until T2 rewrites it. (6) `mail`/`admins` scripts remain in `apps/reference` → G. (7) `frameworkAuthSecret` still generated by SEC and F's `target.ts` → T6 checks; follow-up if unused. (8) CHANGELOG §8 entry → V. (9) B edited files outside its paths because the removals broke them: `copy.unit.test.ts`, `expected.unit.test.ts`, `build.ts`, `build.unit.test.ts`, `databases.unit.test.ts`, the `auth-tables` integration suite (T6 checks). (10) Three auto merge commits (on 46, 47, 42) lack the attribution trailer; not rewritten (no force-push). (11) 41a review minors open: contract wording, `session.ts` header, `grantRole` after `setRole(null)` → T6.
- Reviewer cloud sessions from B: see B's PR bodies (archive at run end).
- **Batch 4 started (2026-10-31):** merge-only #127 `71m-merge-auth-provider-into-admin-app` (B's 42 into E's 61a; build/typecheck/lint clean; unit 2774/2777, 3 `ci-classify` failures from the path map naming B-deleted paths and PROV `dependsOn`) → T7 `71n-path-map-after-removals` (running, §7a.1.8). Running on 71m/71n: C 34a (+ merge into 57z #121), G (64–68 + 69 template-signing fix + `apps/reference` scripts), T1 (74–75), T5 batch 2 (records on 43/45/46/47, #104, #97; merge-up of B's and E's stacks). Next: T2, T3, I1.
- From L: page 2 updates every token named `prototype-framework` and has no list of protected token IDs; it can collide with an owner rule against changing an existing dashboard token (owner question 50; T6 checks). Role changes show only after a new sign-in (owner question 25).
- Sign-out: plan §4.2 makes `end_session` optional and linked from the auth app; A did not implement it (DEC-0660). The app clearing its cookie is B's. T6 checks this.
- Process deviations to report: P0 skipped the separate similar-case search subagent of §7a.1.8 step 4 and relied on the reviewer's repo-wide scan; T6 should check this. In A, the implementer itself diagnosed `2026-10-31-A-workerd-fetch-redirect-error`, not a separate diagnoser; the review accepted the record and disclosed it.
- Reviewer cloud session for P0's test review: `session_014mWQ6jKepuYeu9tYda2mJF` (archive at run end).
- C 32 (#82) raises an owner question: print the admin app's workers.dev URL despite DEC-0590 (DEC-0686).
- From S1: pointers to S2's test-reviews README, S3's path map and Playwright split, and S4's coverage file each carry a fallback until those files merge.
- From S4 (#61): (1) T4 adds `fast-check` (PAR-410, exact pin) to framework devDependencies, plus the template if G 68 needs it. T4 is the lockfile editor in its batch. (2) F's exit check "criteria/prov and cf green against fakes" passes vacuously, because those tests are Cloud-only placeholders locally. F's brief must name real local checks. (3) The F4 fuzz target is expected to expose that `files/base64url.ts` accepts 4 spellings of each local ticket MAC. T4 routes it through §7a.1.8. (4) The decision draft is `v020-S4.md`; I1 should match case-insensitively.
- Reviewer cloud sessions to archive at run end: S4 `session_014mWQ6k9PiPRJThvcqKpHAZ`, S1 `session_014mWQ6hMtDXz9kuyzneVQht`, H `session_014mWQ6kHRQG8NWqkKFQBcHn`, F `session_014mWQ6maJwGjBSMPhgwdafz` `session_014mWQ6iF3V1aHbQiquDwTzj` `session_014mWQ6kjez1KKbg1QE2iP2z`, P0 `session_014mWQ6jKepuYeu9tYda2mJF`, T4 `session_014mWQ6iUAmPMoYo2DWNgSsL` `session_014mWQ6mcJVQArdTDfvDdLZy`, E `session_014mWQ6jbw77ncRNujuLoG2x` `session_014mWQ6iLZ8MhVTXb6nZa4N3` `session_014mWQ6kP9h8DPZa59jbx7Tf` `session_014mWQ6jsz1Y5We59zFKsoaF`, T7 `session_014mWQ6igSCfnb9hLBkhmiVg`. The S4 reviewer ran as a separate cloud session, because subagents have no Agent tool. Archive it at the end of the run.
- **The local `main` branch is stale** (`deae62b`, PR #54) while `origin/main` is `1e0c289`. Create every worktree and branch from `origin/main` (or `git fetch && git branch -f main origin/main` first).
- `00-run-records` is numbered 00 because it opens first; it is kept open and merged last (nothing stacks on it).
- Plan gaps found while planning (handled in §3): deploy-side AUTH service binding and registry write/clear have no named item (assigned to F); `email-permissions.ts` holds generic token-policy helpers (assigned a refactor in C before its removal); §7.1 "own PR" vs §7a.2.3 "tagged tests land in the same change" (split as T2 below).

## 2. Conventions for every item

- **Owned paths:** an item edits only its "Owns" paths plus its own decision draft, root-cause records and test-review records (`plan.md` §1 ownership). Anything else: stop and return an open question.
- **Decision drafts:** one file per item, `ai/implementation/decisions/v020-<item>.md` (existing convention: `decisions/README.md`, `plan.md` §10.4). Entries use **real IDs from the item's pre-allocated range** (as the setup-wizard run did, `handoff-setup-wizard.md`), not `DEC-PENDING-…`, so docs can cite final IDs. Format: `### DEC-06nn — <title>` / `Origin: ai-proposed · Status: accepted · Affects: …`, plus a "Parameter changes" section (`PAR-nnn: old → new` or new `PAR-4nn` rows). Unused IDs stay unused (gaps are normal: DEC-0605…0612 were never used). Only INT items edit `docs/decisions/decision-log.md` and `docs/parameters/parameters.md`. Last on main: **DEC-0619**, **PAR-380** (PAR-381…399 were allocated to the setup-wizard run, unused; skipped).
- **Test-change records** (§7a.1.9): `ai/implementation/test-reviews/<yyyy-mm-dd>-<item>.md`; root causes: `ai/implementation/root-causes/<yyyy-mm-dd>-<item>-<slug>.md`.
- **Shared files** (serialised in §3): root `package.json`, `package-lock.json` (never hand-merged; regenerate with `npm install`), `CLAUDE.md`, `.github/workflows/*`, CI path map, `docs/components/compliance.md`, `docs/acceptance/e2e-scenarios.md`, `QUICKSTART.md` and `docs/components/provisioning.md` (generated permission tables, `scripts/permission-tables.mjs`), `packages/framework/src/provision/cloudflare/permissions.ts`, `apps/template/package.json`, `packages/framework/src/cli/main.ts`, `packages/framework/src/testing/test-app.ts`.
- **CI file token:** at most one item per batch edits `.github/workflows/*` or the path map: batch 1 → S3; batch 2 → A (PR 28); batch 3 → E (PR 61); Then → T7 only if a fix needs it.
- **Every brief** carries "Tests" and "E2E" sections (§7a.1.10) copied from the entry below; every report lists test changes by reason code.
- **Exit check, always:** `npm run build -w packages/framework && npm run typecheck && npm run lint && npm run test:unit` green on the branch, plus the item's own checks; CI green on the PR; independent review with no open major. Cloud parts `not-run`.

## 3. Work list

Format: **ID — title** · plan § · deps · status. Then Owns / PRs (`nn` branch ← base, concern, size) / Exit / Tests / E2E / IDs.

### Run records

**R — run records** · prompt §1 · — · `running` · PR #59
- Owns: `ai/implementation/{progress-v0.2.0.md, owner-questions-v0.2.0.md, v0.2.0-pr-stack.md, live-pass-v0.2.0.md, final-report-v0.2.0.md}`.
- PRs: `00-run-records` ← `main` (records; opened first, kept open and updated through the run, merged last — nothing stacks on it).
- Exit: files present and current at run end. Tests/E2E: none (docs). IDs: DEC-0620–0624 (orchestrator choices), no PAR.

**P0 — local compliance baseline on main** · §7a.1.8, TS-3 · — · `done` (PR #80, CI green; MAIL-AC-005 red→green; test-change review accepted; COMPL-AC-001 fixed in D 36 #74)
- Bare `npm run test:integration` / `npm run test:e2e` are not self-contained: 48 of 53 integration and 5 of 8 e2e failures on clean `1e0c289` are "COMPLIANCE_BASE_URL is not set" (criteria and scenarios must run through `npm run compliance -- --target local`). The baseline is `npm run compliance -- --target local`: 128 passed, 2 failed (COMPL-AC-001, MAIL-AC-005), 5 blocked (missing local test secret), §6. Any failure there gets a diagnoser + reviewer (§7a.1.8) before wave-1 exit checks rely on it; a fix is PR `08-fix-baseline-<slug>` ← main. S3 must make CI run criteria through the harness (or set the env), never bare.
- Owns: its root-cause records; fix paths named by the accepted record. IDs: DEC-0778–0779 (from T7's range), PAR-480.

### Wave 0 (batch 1, all parallel)

**S1 — standards text** · §6.2, §7a.1, §7a.2.3, §7a.2.6, TS-1/17/21 · — · `done` (PRs #67–#71; reviewer accepted-with-changes, fixes applied; DEC-0625–0629)
- Owns: `.claude/skills/testing-standards/**` (new), `CLAUDE.md`, `ai/implementation/plan.md` (§1/§10 pointer only), `docs/CONVENTIONS.md`, `docs/acceptance/e2e-scenarios.md` (Origin lines, empty "Retired scenarios" table, preamble untouched), `docs/README.md` (status-row note only), `docs/components/compliance.md` ("Tiers", two e2e projects; not COMPL-REQ-006).
- PRs: `02-standards-skill-core` ← main (SKILL.md + resources: diagnosis §7a.1.8, test-change review §7a.1.9; ~350) · `03-standards-skill-refs` ← 02 (resources: fuzzing §7a.1.7, edge cases §7a.1.6, CI path map pointer to `scripts/ci/path-map.json` §7a.2.4; ~300) · `04-claude-md-standards` ← 03 (CLAUDE.md TS-1, TS-17 hard rule, TS-21 line; plan.md pointer; ~40) · `05-e2e-governance` ← 04 (CONVENTIONS §4 + pointer, Origin lines on E2E-001…016, Retired table, README note; ~120) · `06-compliance-tiers` ← 05 (compliance.md Tiers per TS-19/§7a.2.4, e2e-api/e2e-ui; ~60).
- Exit: skill-reviewer verdict (§7a.2.6) in each PR description; `npx vitest run --config vitest.integration.config.ts tests/skill` green; `grep -c '^Origin:' docs/acceptance/e2e-scenarios.md` ≥ 16; catalogue unit tests green (`npx vitest run --config vitest.unit.config.ts tests/compliance/harness/catalogue.unit.test.ts`).
- Tests: none added (docs); catalogue must still parse the scenarios (Origin lines must not break `catalogue.ts`). E2E: no scenario change in meaning; E2E-004 unaffected. Fuzz: none.
- IDs: DEC-0625–0629, PAR-400–402.

**S2 — commit hook and record linters** · §7a.2.5, TS-12, TS-18 · — · `done` (#87 linters, #91 hook; 96/96 unit; hook verified blocking a real `claude -p` commit; reviews accepted / accepted-with-changes, no open major; PRs over size, see owner-questions 13)
- Owns: `.claude/settings.json` (new), `scripts/lint-records.mjs`, `scripts/claude-commit-hook.mjs` (new), `tests/lint-records.unit.test.ts`, `tests/claude-commit-hook.unit.test.ts`, `ai/implementation/test-reviews/README.md` (new, record format). Must not edit root `package.json` (S3 owns it in batch 1): scripts are run as `node scripts/…`.
- PRs: `10-record-linters` ← main (root-cause + test-review lint, unit tests; ~300) · `11-claude-commit-hook` ← 10 (PreToolUse hook on `git commit`: eslint + typecheck + record lints on staged files; ~150).
- Exit: `npx vitest run --config vitest.unit.config.ts tests/lint-records.unit.test.ts tests/claude-commit-hook.unit.test.ts` green; a scratch commit with a record missing "Review" is blocked by the hook (transcript in PR); existing records not linted unless staged; no `.git/hooks` file written; template has no hook (`git diff main -- apps/template` empty).
- Tests: new unit tests (red/green). E2E: none. Fuzz: none.
- IDs: DEC-0630–0634, PAR-403–405.

**S3 — CI and release restructuring** · §7a.2.4, TS-11/16/19 · — · `blocked` (PRs #65 #66 #75 #76 open, green; the new `ci.yml`/`release.yml` are staged under `scripts/ci/workflows/` because the session credential lacks GitHub `workflow` scope: pushes to `.github/workflows/*` are refused; owner-questions 9)
- Owns: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/ci/path-map.json`, `scripts/ci/classify.mjs` (new), `tests/ci-classify.unit.test.ts`, `playwright.config.ts`, `vitest.unit.config.ts`, `vitest.integration.config.ts`, `vitest.config.ts`, root `package.json` (scripts only), `tests/compliance/harness/playwright.ts` (project names), `tests/skill/examples.test.ts`, `tests/skill/example-copies.unit.test.ts` (layer only). The path map pre-declares planned paths: `packages/framework/src/auth-app/**`, `packages/framework/src/admin-app/**`, `tests/support/mock-oauth2/**`.
- PRs: `14-ci-classifier` ← main (path map + classifier + unit tests, incl. the short docs-that-are-test-inputs list; ~350) · `15-playwright-projects` ← 14 (`e2e-api`/`e2e-ui` split of `tests/compliance/e2e/*.spec.ts`, `test:e2e`, `test:e2e:api`, `test:e2e:ui` scripts; ~150) · `16-ci-pr-selection` ← 15 (ci.yml: `pull_request` only, classify step, per-layer selection, Chromium only when selected, linters per change; ~250) · `17-ci-no-duplicates` ← 16 (integration glob drops `*.unit.test.ts`, DEC-0405 superseded keeping SKILL-AC-004 single-run evidence, `examples.test.ts` vs ci.yml, release.yml runs every test once with Chromium; ~200).
- Exit: `npx vitest run --config vitest.unit.config.ts tests/ci-classify.unit.test.ts` green; each PR's CI log prints the classification and selected layers matching the path map (`gh run view <id> --log | grep -A20 'Classification'`); a docs-only PR (S1's 05) runs linters only; `npx playwright test --list --project e2e-api` lists no spec that opens a page; no test file collected by two layers (`node scripts/ci/classify.mjs --check-duplicates`).
- Tests: unit tests for the classifier; once-green test moves (`example-copies`) reviewed per §7a.1.9 (`refactor-only`). E2E: project split only, no scenario change. Fuzz: the classifier's path matcher is a candidate for S4's list.
- IDs: DEC-0635–0644, PAR-406–409.

**S4 — integration coverage list and fuzz target list** · §7a.2.2, §7a.1.7 · — · `done` (PR #61; reviewer confirmed all 6 fuzz targets)
- Owns: `ai/implementation/v0.2.0-coverage-fuzz.md` (new). Read-only otherwise.
- PRs: `20-coverage-fuzz-list` ← main (~150, doc).
- Exit: lists every v0.2.0-end-state component (`docs/architecture/component-map.md`) with its suite path or "gap" (today none under `packages/framework/test/integration/` for provision, evidence, testing, targets, client; confirm against `tests/compliance/criteria/`); ≤ 8 fuzz targets, each with trust boundary, root-cause evidence, run count and seed; recommends a fuzz tool that runs offline in Node; an independent reviewer's per-target verdict appended in the file.
- Tests/E2E: none (feeds T3, T4). IDs: DEC-0645–0649, PAR-410–412.

### Wave 1 (batch 2, after batch 1 merged)

**A — the auth app** · §3, §4.1 steps 1–3, §4.4, §2.1, D5/D6 · S1–S3 merged · `done` (8 PRs #60 #62 #63 #64 #77 #78 #79 #84, all green; integration 11/11 vs mock-oauth2-server; all reviews accepted-with-changes, fixed; CI step → PR 29 on staged workflow)
- Owns: `packages/framework/src/auth-app/**` (new: Worker entry, `/start`, `/callback`, OAuth/PKCE/JWKS, D1 store, codes, registry, `redeem`/`role` entrypoint, role mapping), `packages/framework/src/auth/auth-app-binding.ts` (new: interface + in-memory fake), `docs/contracts/ts/internal/auth-app.d.ts` (new), `packages/framework/test/integration/auth-app/**` (new), `tests/support/mock-oauth2/**` (new launcher: Java jar locally, Docker in CI), `.github/workflows/ci.yml` (mock-oauth2-server step only, PR 28), `scripts/ci/path-map.json` (auth-app entry only).
- PRs: `24-auth-app-contract` ← main (binding interface `redeem({code,app})`/`role(sub)`, fake, contract doc; ~200) · `25-auth-app-oauth` ← 24 (PKCE S256, state, ID-token check vs JWKS: iss/aud/nonce/exp, `/user` fallback, `/memberships` pick, role mapping PAR; ~400) · `26-auth-app-store` ← 25 (D1 schema `users`, `codes`, registry; hashed 60 s single-use codes bound to app + return; exact-match registry; ~350) · `27-auth-app-worker` ← 26 (routes, revoke in callback, binding entrypoint; ~350) · `28-auth-app-integration` ← 27 (mock-oauth2-server launcher, integration suite, CI step; ~350).
- Exit: unit tests in `packages/framework/src/auth-app/**/*.unit.test.ts` green; `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth-app` green with mock-oauth2-server running locally (`java -jar …`; Java 21 present); full redirect → code → redeem path over plain HTTP, no browser.
- Tests: unit per §7 (code lifecycle, open-redirect refused incl. trailing slash/case/port/percent-encoding, state/PKCE, wrong aud/nonce/expired, role mapping incl. "Administrator", tokens revoked, concurrent redemption exactly-one); integration suite new. E2E: feeds T2 add-item 2 (E2E-018); no scenario edit here. Fuzz: return-URL matcher and code parser are expected S4 targets (T4 writes them).
- IDs: DEC-0650–0664, PAR-413–424 (code lifetime, admin role names, …).

**B — auth-app provider, session, removals of Better Auth, MAIL, `admins`** · §4.1 steps 4–5, §6, §8 migrations · A's PR 24 pushed · `done` (9 PRs #89 #90 #114 #115 #122 #116 #117 #118 #124, all CI green; unit 2440/2440; framework auth integration green; migration test 0.1.x → six tables dropped, app data kept on D1 and PGlite; reviews accepted / accepted-with-changes, majors on 43 and 42 fixed; 41a minors left open; stack order changed, 42 on top, DEC-0671; DEC-0665–0674, PAR-425–427; `criteria/auth` not run through the harness → T1; cloud not-run)
- Owns: `packages/framework/src/auth/**` (incl. deleting `auth/password/**`), `packages/framework/src/mail/**` (delete), `packages/framework/src/targets/**`, `packages/framework/src/mig/framework.ts`, `packages/framework/migrations/**` (new drop migrations), `packages/framework/src/testing/**`, `packages/framework/src/cli/dev/**`, `packages/framework/src/cli/main.ts`, `packages/framework/src/cli/wiring.ts`, `packages/framework/src/cli/commands/{admins,mail,check-login}*.ts`, `packages/framework/src/provision/cloudflare/email-delivery.ts` (delete), `packages/framework/src/config/schema.ts`, `packages/framework/package.json` (drop `better-auth`), `package-lock.json` (batch-2 sole editor), `packages/framework/test/integration/auth/**`, `tests/compliance/criteria/{auth,pwd,mail}/**`, `tests/compliance/criteria/cli/admins.test.ts`, `tests/compliance/harness/{expected.ts,prodcheck.ts,sign-up-budget*.ts}`, `tests/compliance/e2e/support/template-pages.ts` (sign-in step), `apps/template/package.json` (`mail`/`admins` scripts only), `apps/template/src/client/**` (login link only).
- PRs: `40-auth-app-provider` ← 24 (auth-app provider on the existing redirect `LoginProvider` path, `prv: cf-account`, user ID from `sub`, mock stays; ~400) · `41-role-refresh` ← 40 (refresh every N min / renewal, 2 retries, fail closed to anonymous; PARs; ~300) · `42-drop-auth-mail-tables` ← 41 (framework migrations 0004 sqlite+postgres dropping five `__framework_auth_*` + `__framework_test_mail`, checksums; ~150) · `43-check-login-auth-app` ← 42 (check-login replaced by the auth-app `/start` check, E2E-008 automated part; `behaviour-changed` test record; ~300) · `45-remove-password` ← 43 (pure removal: `auth/password/**`, `better-auth`, lockfile, PWD criteria, password harness pieces; + test-review record; after **38**) · `46-remove-mail` ← 45 (pure removal: `src/mail/**`, `mail` command + template script, MAIL criteria, `email-delivery.ts`; + record; after **34**) · `47-remove-admins` ← 46 (pure removal: `admins` command + script, CLI-AC-006 test, `admin-role` tests; + record).
- Exit: unit + `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth tests/compliance/criteria/auth` green; `grep -rn better-auth packages/framework/src packages/framework/package.json` empty; `npm --workspace apps/template run verify` and `npm --workspace apps/reference run verify` green; migration test: an 0.1.x local DB loses the six tables on next `dev`, app data kept.
- Tests: unit per §7 role refresh (retry twice, fail closed, retry success keeps session); provider/redeem tests against the fake binding; removals grouped `code-removed`/`component-removed` (T5 reviews). E2E: E2E-005/006/007 specs' password clauses removed in 45/46 (`code-removed`); scenario text left to T2. Fuzz: session cookie parse unchanged.
- IDs: DEC-0665–0679, PAR-425–434 (refresh interval, retries, delay).

**C — bootstrap command** · §5.1, §2.1a/b, D9 · S1–S3 merged · `done` except 34a (PRs #72 #73 #82 #86 #88, CI green, no open major; deleting `email.ts`/`email-permissions.ts`/`mail-sink.ts` blocked on importers in B 43/46/47 and two unowned tests → follow-up `34a-remove-email-files` after B 47; MIG-AC-003 order-tie root cause found, fix assigned to T7 PR 92)
- Owns: `packages/framework/src/provision/cloudflare/{cloudflare-setup.ts, setup-steps.ts, setup-record.ts, permissions.ts (BOOTSTRAP, PERMISSIONS_VERSION), plan.ts, email.ts, email-permissions.ts, mail-sink.ts, token-policies.ts (new), r2-token.ts (import only), target.ts (email-domain check only), oauth-clients.ts (new), secrets-store.ts (new, create/put only), admin-app-deploy.ts (new), fake-cloud.test-support.ts, setup-world.test-support.ts}` and their unit tests, `packages/framework/src/cli/commands/{cloudflare-setup,setup-account}*.ts`, `packages/framework/src/admin-app/worker.ts` (new stub: "sign in" placeholder; E takes over in batch 3), `tests/compliance/criteria/setup/**`, `tests/compliance/criteria/prov/setup-account.test.ts`, `tests/compliance/criteria/_fakes/cloud-fakes.ts`, generated tables in `QUICKSTART.md` and `docs/components/provisioning.md` (via `node scripts/permission-tables.mjs` only).
- PRs: `30-bootstrap-token-rules` ← main (expiry ≤ 1 day else DELETE at once, delete at end, never written; BOOTSTRAP set of §5.1; tables regenerated; ~350) · `31-oauth-clients` ← 30 (create admin + sign-in clients, `response_types ["code","id_token"]`, secrets straight to Secrets Store; fake API; ~350) · `32-admin-app-deploy` ← 31 (stub Worker deployed and bound, URL printed; ~250) · `33-token-policies-move` ← 32 (`refactor-only`: `policyCovers`/`missingPermissions`/`tokenPolicies` from `email-permissions.ts` to `token-policies.ts`; ~150) · `34-remove-email-setup` ← 33 (pure removal: `email.ts`, `email-permissions.ts`, `mail-sink.ts`, email steps, Workers Paid stop; + record).
- Exit: unit tests for `provision/cloudflare/**` and `cli/commands/cloudflare-setup*` green; `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/setup` green with `CLOUDFLARE_*` unset; `node scripts/permission-tables.mjs --check` clean; a scan of all output and written files finds no token value (fake token sentinel).
- Tests: unit per §7 bootstrap rules incl. exactly 1 day accepted / 1 day + 1 s deleted; SETUP criteria tests changed `behaviour-changed`; email tests `code-removed`. E2E: feeds T2 add-item 1 (E2E-017). Fuzz: none.
- IDs: DEC-0680–0689, PAR-435–439 (bootstrap max expiry 1 day supersedes PAR-380).

**D — spec and docs** · §6, §6.1, §4.4, `auth.md` · S1 merged · `done` (PRs #74 #81 #83 #85 #92; all majors fixed; DEC-0690/0691/0692/0699 pending owner approval of wording) (36 based on S1 06 / #71)
- Owns: `docs/spec/system-spec.md`, `docs/components/compliance.md` (COMPL-REQ-006, "Testers"; after S1's 06), `docs/components/{auth,password,mail,setup,cloudflare,cli,secrets,skill}.md`, `docs/components/provisioning.md` (prose only; after C's 30), `docs/architecture/component-map.md`, `docs/README.md` ("Login in release 1"), `docs/contracts/ts/internal/login-provider.d.ts`, `docs/contracts/ts/auth.d.ts`, `docs/contracts/http/framework.openapi.yaml` (`/api/auth/*`), `docs/contracts/http/internal/auth-password.openapi.yaml` (delete). Not `docs/acceptance/**` (T2).
- PRs: `36-req-changes-6-1` ← main (SYS-REQ-018/019/026/027, COMPL-REQ-006, Testers; owner-amendment drafts; PR title and body: **"owner approval of wording needed"**; ~150) · `37-auth-doc-rewrite` ← 36 (auth.md for the auth-app provider, AUTH-* criteria rewritten, role mapping PAR, contracts; ~400) · `38-retire-password-mail-docs` ← 37 (password.md/mail.md marked retired, PWD/MAIL criteria to "Retired" tables, delete auth-password.openapi.yaml, README login section; mostly deletions; merge right before 45) · `39-setup-docs` ← 38 (setup/cloudflare/provisioning/cli/secrets/skill docs: bootstrap, admin app, removed commands, SKILL-AC-006 rewrite; after C's 30; ~350).
- Exit: `npx vitest run --config vitest.unit.config.ts tests/compliance/harness` green (catalogue parses every doc); `grep -rnE 'PWD-AC|MAIL-AC' docs --include=*.md` only in Retired tables and history; draft lists supersessions DEC-0509…0527, DEC-0512, PAR-122/241–244/254–259 and keeps/revises PAR-245/250–253/330.
- Tests: none directly; new/rewritten AUTH and SETUP criteria are written as tests by T1. E2E: none (T2). Fuzz: none.
- IDs: DEC-0690–0709 (three owner amendments + supersessions), PAR-440–444.

**T5 — test-change review of v0.2.0 removals** · §7a.1.9, TS-10 · runs as each removal PR is ready · `running` (batch 1 done: records on #88 accepted-with-changes, #83 accepted, #95 accepted, S3 coverage complete; batch 2 waits for B 43/45/46/47, C 34a, F)
- Owns: `ai/implementation/test-reviews/2026-*-{b,c,d,s3}.md` (written onto PRs 17, 43, 45, 46, 47, 34, 38 before they merge). Exit: each record has groups by reason code, verdict per group, sampling notes; evaluator confirms coverage. IDs: none.

**I1 — integrate decisions, waves 0–1** · `plan.md` §10.4 · batch 2 merged · `done` (PR #130 ← main, CI green; 72 DEC added (DEC-0620–0699 used IDs + P0 0778–0779), supersessions marked; 17 PAR added (PAR-410–418, 425–427, 435–439), PAR-331 1→2, superseded/kept PARs noted; DEC-0690/0691/0692/0699 and dependent supersessions "pending owner approval of wording"; no ID out of range; 10 drafts replaced by ID lists, add/add conflicts at merge resolved by keeping #130's version, command in PR body)
- Owns: `docs/decisions/decision-log.md`, `docs/parameters/parameters.md`, `ai/implementation/decisions/v020-{r,s1,s2,s3,s4,a,b,c,d}.md` (replaced by ID lists).
- PRs: `50-int-decisions-w1` ← main (append-only; ~500 of generated-from-drafts text, allowed as integration).
- Exit: every DEC/PAR cited in the repo exists in the log/register (`grep -rhoE 'DEC-0[67][0-9]{2}' . | sort -u` ⊆ log); no ID outside its item's range. IDs: none of its own.

### Wave 2 (batch 3, after batch 2 merged)

**E — the admin app** · §5.2, §8 cleanup, D3/D4/D8/D10 · A, C merged · `done` except 57z (17 PRs #98–#125; CI green on all but #121, which is BLOCKED on C 34a, a release blocker (DEC-0716); integration 9/9; all majors fixed; DEC-0710–0720, PAR-445–450, PAR-332 1→2)
- Owns: `packages/framework/src/admin-app/**`, `packages/framework/src/provision/cloudflare/permissions.ts` (EVERYDAY + PERMISSIONS_VERSION), `packages/framework/src/provision/cloudflare/{auth-app-deploy.ts, everyday-token.ts}` (new), `ACCOUNT_SETUP_VERSION` in `setup-record.ts`, generated tables in `QUICKSTART.md`/`provisioning.md`, `packages/framework/test/integration/admin-app/**`, `scripts/ci/path-map.json` and ci.yml (batch-3 CI token).
- PRs: `56-admin-app-signin` ← main (admin client sign-in reusing A's OAuth core, admin-only gate, short session; ~350) · `57-everyday-token-page` ← 56 (page 2: four-group EVERYDAY, show once, in-place PUT or create-new + delete-old fallback; tables regenerated; ~400) · `58-admin-status-page` ← 57 (page 3, read-only; ~200) · `59-account-setup-page` ← 58 (page 1: deploy auth app + D1, shared resources, setup record; uses F 54's signing-credential function, so starts after **54** merged; ~400) · `60-email-cleanup-offer` ← 59 (optional v0.1.x cleanup, §8; ~250) · `61-admin-app-integration` ← 60 (integration suite + CI entry; ~300).
- Exit: unit + `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/admin-app` green with mock-oauth2-server and the fake Cloudflare API enforcing scopes; anonymous and non-admin refused; un-granted optional scope shows a clear message; no token value in any output.
- Tests: §7 "admin pages request only their own scopes", "everyday set exactly four groups", "0.1.x token update drops email/zone groups". E2E: feeds T2 add-item 1. Fuzz: none.
- IDs: DEC-0710–0724, PAR-445–454.

**F — Secrets Store adoption, deploy bindings** · §3 registry, D7, §5.2 page 1 signing credential, §10 fallback · A, B, C merged · `done` (PRs #101 #102 #103, CI green, all reviews accepted; DEC-0725–0729, PAR-455; cloud deploy not-run)
- Owns: `packages/framework/src/provision/cloudflare/{target.ts, worker.ts, sst.ts, r2-token.ts, secrets-store.ts (bind/read parts), stage-record.ts}`, `packages/framework/src/provision/core/{deploy,remove}.ts`, `packages/framework/src/cli/commands/{deploy,remove,secrets-cloud}*.ts`, `tests/compliance/criteria/{prov,cf}/**` (except `setup-account.test.ts`).
- PRs: `52-deploy-auth-binding` ← main (AUTH service binding on deploy; registry write on `deploy`, clear on `remove` — plan gap, assigned here; ~350) · `53-secrets-store-bindings` ← 52 (`secrets_store_secret` bindings at deploy, SST `transform.worker` or script-upload fallback, Worker-secret fallback; ~350) · `54-signing-credential-secrets-store` ← 53 (signing credential in Secrets Store, deploy stops copying it into Worker secrets; ~300).
- Exit: unit for `provision/**` green; `npx vitest run --config vitest.integration.config.ts tests/compliance/criteria/prov tests/compliance/criteria/cf` green against fakes; Cloud deploy `not-run` (no token).
- Tests: deploy/remove registry unit tests; fallback path tests; changed deploy-sequence assertions `behaviour-changed`. E2E: E2E-018's deploy/remove registry case (T2). Fuzz: none.
- IDs: DEC-0725–0734, PAR-455–459.

**G — skill, quickstart, migration notes, §7a.3** · §5.3, §8, §7a.3, TS-14 · B, C merged; QUICKSTART after E's 57 · `todo`
- Owns: `skill/**`, `QUICKSTART.md` (prose; after 57), `packages/framework/src/cli/commands/upgrade*.ts` (re-run-setup pointer), `apps/template/**` (except scripts B removed), `packages/create-prototype-app/**` (template copy only), `package-lock.json` (batch-3 sole editor: template Playwright pin, fuzz tool), `tests/skill/**` (content checks).
- PRs: `64-skill-setup-flow` ← main (SKILL.md setup flow, owner-tasks, deploying, current-user, troubleshooting; ~350) · `65-quickstart-upgrade-notes` ← 64 (QUICKSTART, `upgrade` pointer; after 57; ~200) · `66-skill-testing-refs` ← 65 (reference/testing.md rework, new references per §7a.3, remove the API-only rule, hard rule 3 widened; skill-reviewer verdict; ~400) · `67-template-e2e-layer` ← 66 (template e2e-api/e2e-ui, pinned Playwright, hard-rule-5 pins; ~300) · `68-template-fuzz-helper` ← 67 (zod-schema fuzz helper, tool per S4 + DEC; ~250).
- Exit: `npx vitest run --config vitest.integration.config.ts tests/skill` green; skill within PAR-070…072 (`tests/skill/budgets-and-links.test.ts`); `npm --workspace apps/template run verify` green incl. its e2e-api project; `npx vitest run --config vitest.integration.config.ts packages/create-prototype-app` green; starter and `upgrade` write no CI files.
- Tests: hard-rules/structure tests updated `behaviour-changed`; template e2e new. E2E: E2E-001 starter path (T2 add-item 3). Fuzz: template helper unit-tested.
- IDs: DEC-0735–0744, PAR-460–464.

**H — root README** · §9 (h) · B, C merged · `done` (PR #93, CI green; review accepted-with-changes, no major; re-check the upgrade-note wording after E and G land)
- Owns: `README.md`. PRs: `70-readme-v020` ← main (~150). Exit: no "Workers Paid", "domain", "password", "mail", "admins" mention except in the upgrade note (`grep -niE 'workers paid|password|mail|admins' README.md`). Tests: `tests/skill` link checks if any read README. E2E: none. IDs: DEC-0745–0747.

### Then (batch 4 unless noted)

**T1 — criteria test author** · §7, §7a.1.2 · D 37/39, A, B, C, E merged · `todo`
- Owns: `tests/compliance/criteria/auth/**` (new auth-app criteria files), `tests/compliance/criteria/setup/**` (new admin-app/bootstrap files), `tests/compliance/criteria/_fakes/**` (scope-enforcing fake API, accepts mock-oauth2-server tokens).
- PRs: `74-auth-criteria-tests` ← main (~400) · `75-setup-criteria-tests` ← 74 (~400).
- Exit: every rewritten AUTH-*/SETUP-* criterion has a tagged test (`npm run compliance -- --target local` reports no missing ID); Cloud rows `not-run`. Tests: new integration tests from criteria, not from code. E2E: none. IDs: DEC-0748–0752, PAR-465–467.

**T2 — e2e scope of §7.1** · §7.1, §7a.2.3, TS-15 · D 36, S1 05, B 45–47, A, C, E · `todo`
- Owns: `docs/acceptance/e2e-scenarios.md`, `docs/components/compliance.md` (milestone list only), `tests/compliance/e2e/**`, `tests/compliance/harness/catalogue.ts` (if retirement mechanics need it), `validation/invalidations.md`.
- PRs: `78-e2e-scope` ← main (own PR, TS-15: rewrites E2E-005…008, retirements, preamble, E2E-002/011 AWS notes, terms.txt, invalidations, milestone list; matching spec edits; reviewer verdict; ~350) · `79-e2e-setup` ← 78 (new E2E-017 text + tagged tests; ~400) · `80-e2e-signin` ← 79 (E2E-018 text + API tests + one UI test; ~400) · `81-e2e-starter-upgrade` ← 80 (E2E-001 via packed `npm create`; E2E-019 upgrade 0.1.x → 0.2.0 from local tarball; ~350). New scenarios carry their text and tests in one PR (§7a.2.3), so only 78 is "scope only".
- Exit: `npm run test:e2e:api` and `npm run test:e2e:ui` green locally; E2E-004 coverage passes; cloud/`prodcheck` parts `not-run`. Tests: e2e changes reviewed per §7a.1.9. IDs: DEC-0753–0767, PAR-468–470.

**T3 — integration suites for S4's gaps** · §7a.2.2 · S4, wave 2 merged · `todo` — Owns: `packages/framework/test/integration/<component>/**` per gap. PRs: `84-…` to `87-…` ← main, one per component (~300 each). Exit: each gap's suite green. IDs: DEC-0768–0772, PAR-471–473.

**T4 — fuzz targets from S4** · §7a.1.7 · S4, G 68 · `done` pending final CI (PRs #111 #112 #113; F2, F3 and F5 pass; F1, F4 and F6 findings fixed red→green, with records reviewed and accepted; fuzz time 2.5–2.8 s total, within PAR-411) under review round 2; restructuring so every PR is green) — Owns: `*.fuzz.unit.test.ts` beside each target. PRs: `88-fuzz-targets` (+ `89-…` if > 400) ← main. Exit: each target states run count, seed, reason; adds seconds only (`npm run test:unit` time delta in PR). IDs: DEC-0773–0777, PAR-474–479.

**T6 — independent review** · §7a.1.2 · T1–T4 merged · `todo` — Owns: `ai/implementation/evaluations/v0.2.0-review.md`. PRs: `90-v020-review` ← main (doc). Exit: no open major; findings become T7 items. IDs: none.

**T7 — red-green fixes** · §7a.1.8 · on demand · `todo` — Owns: per fix brief + its root-cause record. PRs: `91-fix-<slug>`…`94-fix-<slug>` ← main. Exit: accepted Review verdict dated before the fix commit; reproduction test red then green. IDs: DEC-0780–0787, PAR-481–484 (P0 took DEC-0778–0779, PAR-480).

**T8 — live pass** · §7 Live · — · `not-run` (no token, owner unavailable). Replaced for this run by L.

**L — live-pass runbook** · §7 Live, §5.2 page 2, §4.4 · E, F merged · `done` (`live-pass-v0.2.0.md`, 283 lines, commit 3195cc7: preconditions, steps S1–S17, 22 checks incl. U1–U3 (§5.2 page 2), A-1 Administrator via `/roles`, E-8 release-blocking for page 1, failure → PAR/DEC table, cost and cleanup, results table; not concrete: C-3 store-create (n/a if a store exists), F-5 fallback (no manual trigger), A-1 everyday token likely lacks Account Settings Read (dashboard fallback), E-8 `/oauth/scopes` answer shape unrecorded, S2/S9 expected output taken from specs until 34a/57z exist, consent-screen toggles unknown) — Owns: `ai/implementation/live-pass-v0.2.0.md` (on branch 00). Exit: copy-paste steps for the 4 live steps of §7; the three *unverified* points of §5.2 page 2 (Secrets Store Read needed at deploy?; each scope covers its group?; grant can update a token it did not create?) and the *unverified* "Administrator" role string via `GET /accounts/{A}/roles`, each with the expected result and where to record it; no credential values. IDs: none.

**I2 — integrate decisions, wave 2 and Then** · `plan.md` §10.4 · T1–T7 merged · `todo` — PRs: `95-int-decisions-w2` ← main. Same exit as I1.

**V — 0.2.0 version bump and CHANGELOG** · §8, `docs/RELEASING.md` steps 1–3 · I2 merged · `todo` — Owns: `packages/{framework,create-prototype-app,prototype-framework-skill}/package.json` (version), `apps/template/package.json` (framework pin), `skill/.claude-plugin/plugin.json`, `package-lock.json`, `CHANGELOG.md`. PRs: `97-release-0.2.0` ← main (~120 + lockfile). Exit: `node scripts/release-check.mjs v0.2.0` passes; CHANGELOG states plainly that password accounts and sessions are dropped and setup must be re-run; **no tag, publish or release**. IDs: DEC-0788–0789.

**FR — final report** · prompt §12 · all · `todo` — Owns: `ai/implementation/final-report-v0.2.0.md` (on branch 00). Exit: per-item status, not-run list with reasons, billable resources (none expected), owner questions summary.

Spare IDs for splits and new items: DEC-0790–0799, PAR-485–499 (orchestrator assigns).

## 4. Parallel schedule

| Batch | Items in parallel | Starts when |
|---|---|---|
| 0 | R | now |
| 1 | S1, S2, S3, S4, P0 (runs and diagnoses only; edits nothing until its record is accepted) | now |
| 2 | A, C, D (36–38) → B (once 24 is pushed) → D 39 (once C 30 merged); T5 per removal PR | batch 1 merged |
| 2-int | I1 | batch 2 merged |
| 3 | F, E (56–58), G (64, 66–68), H → E 59–61 after F 54; G 65 after E 57 | batch 2 merged |
| 4 | T1, T2, T3, T4 (T2 and T1 touch different trees) → T6 → T7 as needed | batch 3 merged |
| 5 | L, I2 → V → FR | batch 4 merged |

**File-conflict reasoning.**
- Batch 1: S1 owns `CLAUDE.md`, `docs/**` and `.claude/skills/**`; S2 owns `.claude/settings.json` and `scripts/lint-records*`; S3 owns root `package.json`, CI, configs and `scripts/ci/**`; S4 writes one new file. No overlap. S2 and S3 both add unit tests under `tests/` but in distinct new files.
- Batch 2: A writes only new paths (+ the CI step, as batch-2 CI-token holder). B and C share no file after the split: C takes `email.ts`/`mail-sink.ts`/`email-permissions.ts`/`target.ts`(email check), B takes `email-delivery.ts`/`src/mail/**`. Edges: `mail-sink.ts` imports `src/mail/{mime,sink-worker,sender}` → **C 34 merges before B 46**; `mig/framework.ts` imports `auth/password/tables` → B 42/45 in one stack. D shares no file with A/B/C except `provisioning.md` (generated tables) → **D 39 after C 30**; `compliance.md` → **D 36 after S1 06** (batch 1). Docs retirement **D 38 merges before B 45, in the same merge batch,** so criteria docs and their tests leave together. Lockfile: only B 45.
- Batch 3: `permissions.ts` and generated tables: E only. `QUICKSTART.md`: E 57 regenerates tables, then G 65 edits prose. `target.ts`/deploy: F only. E 59 calls F 54's signing-credential function → after 54. Lockfile and `apps/template/**`: G only. `README.md`: H only. CI: E only.
- Batch 4: T1 (`criteria/**`), T2 (`docs/acceptance`, `e2e/**`), T3 (`packages/framework/test/integration/<gap>`), T4 (`*.fuzz.unit.test.ts`) are disjoint; T2 alone edits `compliance.md` (milestone list).
- Decision log: drafts are one file per item; only I1/I2 touch the log and register, each alone in its batch.

## 5. Stacked-PR layout (merge order)

| nn | Branch | Base | Stack | Note |
|---|---|---|---|---|
| 00 | v0.2.0/00-run-records | main | R | merged last |
| 02 | v0.2.0/02-standards-skill-core | main | S1 | |
| 03 | v0.2.0/03-standards-skill-refs | 02 | S1 | |
| 04 | v0.2.0/04-claude-md-standards | 03 | S1 | |
| 05 | v0.2.0/05-e2e-governance | 04 | S1 | |
| 06 | v0.2.0/06-compliance-tiers | 05 | S1 | |
| 08 | v0.2.0/08-fix-baseline-<slug> | main | P0 | if the record needs a fix |
| 10 | v0.2.0/10-record-linters | main | S2 | |
| 11 | v0.2.0/11-claude-commit-hook | 10 | S2 | |
| 14 | v0.2.0/14-ci-classifier | main | S3 | |
| 15 | v0.2.0/15-playwright-projects | 14 | S3 | |
| 16 | v0.2.0/16-ci-pr-selection | 15 | S3 | |
| 17 | v0.2.0/17-ci-no-duplicates | 16 | S3 | T5 record |
| 20 | v0.2.0/20-coverage-fuzz-list | main | S4 | |
| 24 | v0.2.0/24-auth-app-contract | main | A | |
| 25 | v0.2.0/25-auth-app-oauth | 24 | A | |
| 26 | v0.2.0/26-auth-app-store | 25 | A | |
| 27 | v0.2.0/27-auth-app-worker | 26 | A | |
| 28 | v0.2.0/28-auth-app-integration | 27 | A | CI token, batch 2 |
| 30 | v0.2.0/30-bootstrap-token-rules | main | C | |
| 31 | v0.2.0/31-oauth-clients | 30 | C | |
| 32 | v0.2.0/32-admin-app-deploy | 31 | C | |
| 33 | v0.2.0/33-token-policies-move | 32 | C | refactor-only |
| 34 | v0.2.0/34-remove-email-setup | 33 | C | T5 |
| 36 | v0.2.0/36-req-changes-6-1 | main | D | owner approval of wording needed |
| 37 | v0.2.0/37-auth-doc-rewrite | 36 | D | |
| 38 | v0.2.0/38-retire-password-mail-docs | 37 | D | T5; before 45 |
| 39 | v0.2.0/39-setup-docs | 38 | D | after 30 |
| 40 | v0.2.0/40-auth-app-provider | 24 | B | cross-stack base |
| 41 | v0.2.0/41-role-refresh | 40 | B | |
| 42 | v0.2.0/42-drop-auth-mail-tables | 41 | B | |
| 43 | v0.2.0/43-check-login-auth-app | 42 | B | T5 record |
| 45 | v0.2.0/45-remove-password | 43 | B | after 38; T5; lockfile |
| 46 | v0.2.0/46-remove-mail | 45 | B | after 34; T5 |
| 47 | v0.2.0/47-remove-admins | 46 | B | T5 |
| 50 | v0.2.0/50-int-decisions-w1 | main | I1 | |
| 52 | v0.2.0/52-deploy-auth-binding | main | F | |
| 53 | v0.2.0/53-secrets-store-bindings | 52 | F | |
| 54 | v0.2.0/54-signing-credential-secrets-store | 53 | F | |
| 56 | v0.2.0/56-admin-app-signin | main | E | |
| 57 | v0.2.0/57-everyday-token-page | 56 | E | tables regenerated |
| 58 | v0.2.0/58-admin-status-page | 57 | E | |
| 59 | v0.2.0/59-account-setup-page | 58 | E | after 54 |
| 60 | v0.2.0/60-email-cleanup-offer | 59 | E | |
| 61 | v0.2.0/61-admin-app-integration | 60 | E | CI token, batch 3 |
| 64 | v0.2.0/64-skill-setup-flow | main | G | |
| 65 | v0.2.0/65-quickstart-upgrade-notes | 64 | G | after 57 |
| 66 | v0.2.0/66-skill-testing-refs | 65 | G | skill review |
| 67 | v0.2.0/67-template-e2e-layer | 66 | G | lockfile |
| 68 | v0.2.0/68-template-fuzz-helper | 67 | G | lockfile |
| 70 | v0.2.0/70-readme-v020 | main | H | |
| 74 | v0.2.0/74-auth-criteria-tests | main | T1 | |
| 75 | v0.2.0/75-setup-criteria-tests | 74 | T1 | |
| 78 | v0.2.0/78-e2e-scope | main | T2 | own PR (TS-15) |
| 79 | v0.2.0/79-e2e-setup | 78 | T2 | |
| 80 | v0.2.0/80-e2e-signin | 79 | T2 | |
| 81 | v0.2.0/81-e2e-starter-upgrade | 80 | T2 | |
| 84–87 | v0.2.0/8n-integration-<component> | main | T3 | one per gap |
| 88–89 | v0.2.0/88-fuzz-targets | main | T4 | |
| 90 | v0.2.0/90-v020-review | main | T6 | |
| 91–94 | v0.2.0/9n-fix-<slug> | main | T7 | on demand |
| 95 | v0.2.0/95-int-decisions-w2 | main | I2 | |
| 97 | v0.2.0/97-release-0.2.0 | main | V | no tag/publish |

## 6. Commands (root `package.json`, checked 2026-10-31 in a clean clone of `1e0c289`, Node 22.23.4, `npm ci` 11 s)

| Layer | Command | Works here | Time |
|---|---|---|---|
| build | `npm run build -w packages/framework` | yes | 7 s |
| typecheck | `npm run typecheck` (needs build) | yes | 21 s |
| lint | `npm run lint` | yes | 6 s |
| unit | `npm run test:unit` | yes, 2527/2527 | 158 s |
| integration | `npm run test:integration` (build + Vitest integration + Playwright `integration`) | framework suites yes; bare run fails 53 tests in 30 criteria files (48 × `COMPLIANCE_BASE_URL is not set`); Playwright part skipped by `&&` | 15.5 min |
| e2e | `npm run test:e2e` (Playwright `e2e`; becomes `e2e-api`/`e2e-ui` in S3 15) | bare run: 23 passed, 8 failed (5 × `COMPLIANCE_BASE_URL`) | 10 min |
| verify | `npm run verify` (build, typecheck, lint, unit, template + reference `verify`, `example-pages`) | build/typecheck/lint/unit green; full run not repeated (needs the Chromium shim; last known green per `handoff-setup-wizard.md`) | ≈ 3.2 min + app verifies |
| compliance | `npm run compliance -- --target local` (the real way to run criteria + scenarios) | yes: 128 passed, 2 failed, 5 blocked | 32 min |

- **Chromium shim:** sandbox Chromium is build 1243, Playwright 1.64.1 wants 1248. Use a directory of symlinks to `/opt/pw-browsers/*` plus `chromium-1248 → chromium-1243` and `chromium_headless_shell-1248 → chromium_headless_shell-1243`, then `PLAYWRIGHT_BROWSERS_PATH=<dir>` (`handoff-setup-wizard.md`).
- **mock-oauth2-server:** Java 21 and Docker binaries are present; A 28 confirms how to fetch and run it through the proxy.
- **Offline runs:** `unshare -rn sh scripts/offline.sh <cmd>` (`plan.md` §10.2).
- **Baseline (P0):** `compliance --target local` on `1e0c289` (with the shim): failed COMPL-AC-001 (the milestone listing returns 12 items where the test expects 11; corrected by P0) and MAIL-AC-005 (3 addresses on a non-reserved domain under packages/apps/skill/tests); blocked CORE-AC-002, HTTP-AC-002, SEC-AC-001, SEC-AC-002, E2E-013, all because the reference app's test secret `apiKey` has no value in `apps/reference/.dev.vars` (set it with `npm run secrets -- set apiKey --target local --stage local` in `apps/reference`, value on stdin). Runners set it before a run. Not diagnosed here.
- **Use in exit checks:** framework suites run directly (`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/<c>`); criteria and scenarios run through `npm run compliance -- --target local` (optionally narrowed per the harness's selection options), never bare.
