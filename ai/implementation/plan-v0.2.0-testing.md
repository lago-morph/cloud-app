# Plan addendum: v0.2.0 testing standards

Status: draft for owner review (2026-10-31). This is a standalone file so it can be reviewed in isolation. Once approved, it is merged into `plan-v0.2.0-auth.md` as the merge map in §0 says, and then deleted.

- **Why v0.2.0:** v0.2.0 is the next implementation work. Applying these standards before it would write many tests for code that v0.2.0 removes (about 3,500 test lines go, `plan-v0.2.0-auth.md` §6). So the v0.2.0 work is the first to run under these standards, and it brings the existing tests up to them.
- **Spec only:** this addendum changes specs and plans. The work it describes happens during the v0.2.0 implementation.
- **Sources used:**
  - the governing prompt `ai/prompts/implement-local-cloudflare.md` (cited as "prompt §n");
  - `ai/implementation/plan.md` §1 and §10;
  - `docs/CONVENTIONS.md` and `docs/components/compliance.md`;
  - `skill/reference/testing.md`;
  - the CI workflows;
  - the root-cause records and evaluations;
  - the owner's instructions of 2026-10-31.
- **Sources not used:** no retrospective content (TS-17).
- **Reviews:** two independent subagents reviewed this draft on 2026-10-31. One checked it against the owner's instructions; the other checked §3.5 and §5 against the repository (`accepted-with-changes`). Their changes are applied.

## 0. Merge map

| This addendum | Goes into `plan-v0.2.0-auth.md` |
|---|---|
| §1 Scope, §2 decisions TS-1…TS-19 | §1, as a second decision table "Testing standards (2026-10-31)" |
| §3 Standards, §4 Apps | New §7a "Testing standards". The standards' lasting text lands in the files listed in §6. |
| §5 E2E scope | §7 Testing, as a sub-section. It goes in its own PR, separate from the rest of this addendum (TS-15). |
| §6 Where the standards land | §6 (Spec) and §9 |
| §7 Work breakdown | §9, as wave 0 plus additions to the other waves and to "Then" |
| §8 Open points | Resolved before the merge. Nothing from §8 is merged. |

## 1. Scope

1. These standards apply to **the framework repository** and to **every app built with the framework**, at the same level (TS-14). App builders may not know what TDD, Playwright or fuzzing are. The skill and the template give their agents these practices automatically.
2. **Tests evolve with the system.** When the framework's intent changes, the tests change to match, in the same work: unit, integration and e2e tests, and the E2E scenarios. **E2E scenarios MUST be updated whenever the framework changes.** They are not a fixed, once-approved list. A feature is not done until its happy path and its expected error scenarios are covered end to end (§3.5).
3. **Existing practice stays.** The roles, the diagnosis workflow, the test layers, tagging, evidence and test economy of the first implementation stay. This addendum adds to them and changes them only where §2 says so.

## 2. Owner decisions (2026-10-31)

| # | Decision |
|---|---|
| TS-1 | **Every session's main agent orchestrates.** It keeps its context small and reduces wall-clock time by making aggressive use of subagents, running them in parallel where they don't touch the same files (prompt §1, kept and made permanent). |
| TS-2 | **Unit tests use red/green/refactor TDD** (prompt §6, kept). |
| TS-3 | **Any failure outside red/green gets an evidence-based root cause, never a guess.** That covers unit regressions, every integration and e2e failure, and builds and deploys. A **diagnoser subagent**, never the code's author, finds it (prompt §8, kept). Evidence includes logs, a debugger, and several variations of the test. |
| TS-4 | **An independent reviewer subagent** first decides whether the evidence supports the root cause. Only then does it evaluate the fix. Major issues must be answered. At most **3 attempts** per failure. A failure that needed a second attempt, or a second review round, gets an analysis of why, and the skill is made more specific if that analysis shows a gap (§3.8). |
| TS-5 | **Similar cases before the fix.** After approval and before the fix, search for similar cases and add tests for them too. |
| TS-6 | **Integration tests per component, using the existing layer definition and strategy:** real local dependencies (Miniflare/workerd, PGlite, the file system, local stand-ins such as mock-oauth2-server); fakes only for external platforms with no local stand-in. No new mocking rule. Every component has a comprehensive integration suite. |
| TS-7 | **E2E covers every happy path and every expected error scenario,** with creatively chosen edge cases. It is API-first: e2e tests drive the API, and a limited number of Playwright UI tests cover what only a browser shows. |
| TS-8 | **Fuzzing is local, limited and targeted.** It is never run against a cloud stage. Use it a little where it makes sense: chosen APIs and well-defined client/server interfaces, especially code with repeated regressions. Never brute-force every API. |
| TS-9 | **Every change carries its test impact,** and its implementer makes the needed test changes in the same work, without being asked. |
| TS-10 | **Changes to once-green tests are reviewed by an independent subagent,** in every layer. That covers any change to a once-green test's expected results, its removal, or its weakening. "Green once" means it passed in this session, or it is on `main`. Review may be in bulk, grouped by reason. The aim: agents fix real defects instead of deleting or changing tests (§3.9). |
| TS-11 | **CI runs tests intelligently, on PRs only.** Component integration tests run when that component changes. E2E runs on PRs that change application behaviour, never when only unit or integration tests, docs or specs change. Every test, e2e included, runs at release. No test runs twice in one run without a recorded reason. Chromium is installed only when a UI test is selected (§3.12). |
| TS-12 | **Linters run in the agent harness (Claude Code hooks) and in a git pre-commit hook,** only against changes in this repository. The new root-cause record linter is not added to CI (§3.12). |
| TS-13 | **Any change to a skill that can affect testing is reviewed by a subagent first,** for test quality not being weakened and for strict progressive disclosure (§3.13). |
| TS-14 | **Apps built with the framework get the same level of testing as the framework.** The rule "app tests use the API only and add no browser driver" (`skill/reference/testing.md`, "What runs your tests", last bullet) is removed (§4). |
| TS-15 | **Agents keep E2E scenarios current without owner approval.** Scenario additions, changes and retirements are reviewed and validated by an independent subagent instead (§3.5). The e2e scope changes for v0.2.0 (§5) go in their own PR. |
| TS-16 | **CI economy is the orchestrator's call.** The owner leaves the docs-only CI question to the implementation: choose the method that safely reduces wall-clock time without compromising test quality. §3.12 records the choice. |
| TS-17 | **Retrospectives are suggestions only.** A retrospective recommendation the owner has not adopted is never used in any decision. Agents never read retrospective proposals in any form: skill specs, ADR drafts and agents-file rules, including the copies inside retrospective reports under `retrospective/`. This is a hard rule in `CLAUDE.md`. |
| TS-18 | **Review loops answer comments.** Before, a rejected record went back to diagnosis with no limit and no step for answering comments (prompt §8 step 2). TS-4 fills the gap. |
| TS-19 | **CI must run the integration and e2e layers.** Today it never does, although `compliance.md` §2 "Tiers" says automated criteria and scenarios run for every commit. TS-11 replaces "every commit" with the selection rules of §3.12. |

## 3. Standards

These sections are normative. §6 says which file each one lands in.

### 3.1 Orchestration (TS-1)
- **What the orchestrator does and doesn't do:** prompt §1 applies to every session's main agent. The main agent plans nothing, writes no code, tests or documents, runs no suites and diagnoses nothing. It briefs subagents, tracks items, merges branches and relays questions to the owner.
- **Briefs and replies:** a brief gives file paths, not file contents. Subagents return short summaries, and details go into files in the repository.
- **Parallel work:** independent items run in parallel in their own worktrees and branches whenever that saves wall-clock time. Bounded research is delegated, and only its conclusions return to the main context.
- **Item rules from plan §1 stay:** ownership, per-item checks before return, merging only green items.

### 3.2 Roles
Each of the following is a separate subagent, and none may be the author of the code under test. The first six are kept from prompt §7 and §8 and plan §1:
- **Implementer.**
- **Test-case author.** Writes from the requirements, criteria, contracts and scenarios, not from the implementation.
- **Test runner.** Records results only. It changes nothing.
- **Evaluator.** Its verdict is the only pass. It flags skipped tests, assertions weaker than the criterion and wrong tags.
- **Diagnoser.**
- **Root-cause reviewer.** It may not review a record whose cause it found itself.

New in this addendum:
- **Test-change reviewer** (§3.9).
- **Skill reviewer** (§3.13).

### 3.3 Unit tests (TS-2)
- Red/green/refactor, one behaviour at a time. Confirm the test fails for the expected reason before writing code. Unit tests need no network (prompt §6).
- Every fix is red-green: first a test that reproduces the failure and fails, then the fix (prompt §8 step 3).

### 3.4 Integration tests (TS-6)
- **Layer definition, unchanged (prompt §6; plan §10.1):** one suite per component. Each test exercises the component with what it really uses: locally Miniflare/workerd, PGlite, the file system, and local stand-ins such as v0.2.0's mock-oauth2-server; on Cloudflare a `test-` stage where a criterion's Where column says Cloud.
- **Fakes:** only for external platforms with no local stand-in, such as the fake Cloudflare APIs (DEC-0347; `tests/compliance/criteria/_fakes/`). A run against fakes only is not evidence for a criterion whose Where column says Cloud.
- **Coverage:**
  - Every framework component in the v0.2.0 end state has a comprehensive integration suite, under `packages/framework/test/integration/<component>/` or in its compliance criteria.
  - A planning subagent lists the components that have neither. Today `packages/framework/test/integration/` has no suite for `provision`, `evidence`, `testing`, `targets` or `client`. Some of these are covered by `tests/compliance/criteria/`, and the planner confirms which.
  - Each gap becomes a test-author item.

### 3.5 End-to-end tests (TS-7, TS-15)
- **What e2e covers:** every user-facing and operator-facing flow, on its happy path and its expected errors. Every new or changed flow adds or extends an E2E scenario and its tests in the same work (§1.2).
- **API-first:**
  - Most e2e tests drive the app's HTTP API, the CLI or both.
  - Playwright UI tests are limited to what only a browser shows: page rendering, sign-in pages, file transfer in the page, cookies.
  - Each user-facing flow has at most a few UI tests. The rest of its cases are API tests.
- **Two Playwright projects:** `e2e-api` and `e2e-ui`. Only `e2e-ui` (and the browser criteria in project `integration`) launches a browser. A test that uses only HTTP (Playwright's `request` fixture or the harness client) needs no browser. A spot check on 2026-10-31 showed such a test passing with no browser installed.
- **Scenario governance:**
  - CONVENTIONS §4 is extended to E2E scenarios. Each scenario gets an `Origin` line. The existing scenarios get `Origin: ai-proposed (reviewed by the owner before 2026-10-31)`.
  - CONVENTIONS §4 gains this rule: agents may add, change and retire E2E scenarios of any origin to match the framework's current intent, each with a decision-log entry and an independent subagent's review, and with no owner approval (TS-15).
  - The `docs/README.md` status row "Reviewed by owner" gets a note that it is not an approval gate for later changes.
  - Changes and retirements also go through the test-change review (§3.9).
- **IDs and mechanics:**
  - New IDs continue from the highest one (E2E-017 is next). IDs are never reused or deleted (CONVENTIONS §2).
  - A new scenario has a `Where:` line (required by `tests/compliance/harness/catalogue.ts`) and a `Verifies:` line (CONVENTIONS §3). Its tagged tests land in the same change: E2E-004's coverage part fails for an automated-tier scenario with no tagged test. Live-only parts use the `(milestone)` flag, because a bare `(manual)` counts as automated.
  - **Retiring a scenario:** its entry moves to a "Retired scenarios" list with its reason and no `Where:` line, as retired criteria were handled in `google.md`. The catalogue adds every entry that has a `Where:` line, so a retired one would otherwise stay expected.

### 3.6 Edge cases (TS-7)
For each criterion and scenario, the test author lists edge cases before writing tests and covers the ones that apply. Prompts for that list:
- **Boundaries:** empty, one, exactly at a PAR limit, one past it. These run in-process or locally only; on a cloud, follow the cloud usage limits (plan §1).
- **Text:**
  - Unicode, case and normalisation; `..`, `/` and percent-encoding in names.
  - One name being a prefix of another. The R2 list order defect showed this one (`root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`).
- **Order and time:** sort order and paging cursors; expiry at and just past the limit (fake `Date` only).
- **Access:** anonymous, user, admin, and another user's data.
- **Repetition:** repeated and concurrent requests, reuse of single-use tokens or codes.
- **Failures:** an unavailable capability (`setUnavailable`); local versus cloud behaviour differences.

### 3.7 Fuzzing (TS-8)
- **Where:** targets are chosen one by one, only where fuzzing finds what example tests would miss:
  - parsers, validators and encoders at a trust boundary (names, cursors, redirect and return URLs, codes and tokens, request bodies);
  - especially components with repeated regressions, judged from their root-cause records.

  Having a contract or a schema makes an interface eligible, not required. The target list stays short, and a reviewer confirms each entry is justified (§7 s4).
- **How much:**
  - Each fuzz target keeps its run small, and states in the test its run count and fixed seed, with a one-line reason.
  - Fuzz targets run in the normal unit or integration layer and add only seconds.
  - No fuzzing of every endpoint, and no long or exhaustive runs.
- **Local only:** fuzzing runs in-process or against the local `dev` server, never against a cloud stage (plan §1 cloud usage limits).
- **Findings:** a failure found by fuzzing goes through §3.8. Its case becomes a plain regression test.
- **Tool:** the implementation chooses it, with a decision-log entry. It must run offline in Node, so apps need no other toolchain.

### 3.8 Failure diagnosis and review (TS-3, TS-4, TS-5, TS-18)
This applies to every failure except a test that is red on purpose during red/green. It covers unit regressions, all integration and e2e failures, and failed builds, deploys and spikes. "Probably", "flaky" and "timing" are not causes without evidence (prompt §8).

1. **Diagnose.** A diagnoser subagent:
   - reproduces the failure;
   - gathers evidence: exact output and logs, requests and responses, state, a debugger session (for example `node inspect`, or Vitest `--inspect-brk` driven from the command line), variations of the test that confirm or rule out each hypothesis, and a minimal reproduction;
   - writes the record in `ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md`, with sections Symptom, Evidence, Causal chain (evidence per link), Alternatives ruled out, Proposed fix, Verification plan, and Review (plan §10.5).

   An unproven link means more evidence, never a guess.
2. **Review.** A root-cause reviewer subagent:
   - first decides whether the evidence supports every link and rules out the alternatives;
   - only if it does, evaluates the fix (cause, not symptom);
   - reproduces once, plus one experiment per hypothesis it doubts (plan §1 test economy rule 8).

   Its verdict is one of `accepted`, `accepted-with-changes` (binding on the fixer) or `rejected`. Each reason is marked **major** or **minor**.
3. **Respond.** On `rejected`, or on any major issue, the diagnoser answers each major issue point by point in a `Response (round n)` section: more evidence, a corrected chain or a revised fix, or a rebuttal with evidence. The record then goes back to review. Minor issues are fixed or answered in the same section.
4. **Similar cases.** After acceptance and before the fix, a subagent searches for the same defect pattern elsewhere: other call sites, other components with the same assumption, the other target. It lists what it found with evidence and adds failing tests for each case.
   - A case outside the fixing item's owned paths becomes a new item. It is not fixed silently (plan §1 ownership).
5. **Fix.** A fixer subagent fixes red-green: the reproduction test and the similar-case tests fail first, then pass. It follows the accepted record as amended by its Review.
6. **Re-check.** The test runner and the evaluator re-run the affected tests (prompt §8 step 4). The evaluator checks that the record has a Review verdict that came before the fix commit.
7. **Attempts and non-convergence.**
   - An attempt is steps 1–6. A failed re-check starts a new attempt at step 1 in the same record, with its own section.
   - At most 3 attempts per failure, and at most 3 review rounds per attempt.
   - A failure that needed a second attempt or a second review round gets a short non-convergence note. A subagent other than the diagnoser and the reviewer writes it: why the first try did not succeed. If the note shows the standards or the skill were not specific enough, the orchestrator has the skill changed (§3.13).
   - A failure still open after 3 attempts or 3 rounds stops. The orchestrator reports it to the owner with the record and the notes.

### 3.9 Changes to once-green tests (TS-10)
- **What counts as once-green:** a test is once-green if it passed in the current session or is on `main`.
- **Which layers:** unit, integration, compliance criteria, e2e, smoke and fuzz.
- **What is reviewed:** any change to such a test's expected results or assertions, its removal, a skip, a widened tolerance or timeout, or a changed tag.
- **Who reviews:** an independent test-change reviewer subagent, which wrote neither the change nor the code, before the change is merged.
- **Review in bulk:**
  - The author groups the changes by reason code:
    - `code-removed`, `component-removed` or `behaviour-changed`, each citing the requirement, decision or plan section;
    - `test-was-wrong`, citing its root-cause record;
    - `strengthened`;
    - `refactor-only`.
  - The reviewer judges each group as a whole and samples within it as far as the risk needs. For example, the unit tests of a removed module are one group with one reason, not one review each.
  - The reviewer looks closely at any change where a test was weakened while the code it covers stayed.
- **The record:** one review record per change set, in `ai/implementation/test-reviews/<yyyy-mm-dd>-<item-id>.md`: the groups, the verdict per group, and its reasons. The evaluator checks that every once-green test change in its scope is covered by an accepted review.
- **Never weaken to pass:** never skip, delete or weaken a test to get a pass. A wrong test is a root-cause finding (prompt §8).

### 3.10 Test impact of every change (TS-9)
- **Briefs:** every implementation brief has a "Tests" section with:
  - the unit, integration and e2e tests to add, change or remove;
  - the E2E scenarios affected;
  - the fuzz targets affected.
- **Delivery:** the implementer makes these changes in the same work. The test author covers the criteria and scenarios.
- **Reports:** the item's report lists the test impact and every test change by reason code (§3.9).
- **Plans:** plans include a "Tests" section and an "E2E" section for every work item.

### 3.11 Kept practices
The following stay as they are:
- **Tagging (plan §10.3):** `[ID]` in titles, and never an ID the test does not check. Unit tests count as evidence only for unit-level criteria (DEC-0319).
- **Evidence (plan §10.5; compliance.md):** records under `validation/<target>/`, the four statuses, and milestone invalidation.
- **Test economy rules 1–9 (plan §1, owner, 2026-10-20).** They govern what agents run; CI selection follows §3.12. Rule 2 (docs-only items) now runs the linters in hooks plus only the tests listed for the changed docs (§3.12).
- **Cloud usage limits (plan §1).**
- **Offline runs:** `unshare -rn sh scripts/offline.sh`; never unset the proxy (plan §10.2).
- **Unit timeout:** 30 s under load (`vitest.unit.config.ts`).
- **Order-dependence checks:** economy rule 6.

### 3.12 CI and hooks (TS-11, TS-12, TS-16, TS-19)
**Triggers.**
- `ci.yml` runs on `pull_request` only. The `push: branches: [main]` trigger is removed.
- `release.yml` keeps its version-tag trigger.

**Change classification.** A first step classifies the PR's changed files against a committed path map:
- **Docs, specs and plans** (`docs/**`, `ai/**`, `*.md`, `retrospective/**`): no test runs. The exceptions are the few files that a unit or integration test or the build reads (for example contracts and skill text). The path map lists them in a short, reviewed list, with the tests that read them, and only those tests run. The exception never selects e2e tests. The release run covers anything the list misses.

  This is the TS-16 choice: prose changes cost nothing, and the few docs that are test inputs still get their tests.
- **Unit tests:** the whole unit layer runs on any change to code or unit tests. It is the cheapest layer. Selecting by import graph would miss tests that read files without importing them.
- **Integration tests:**
  - Each component's integration suite and compliance criteria run when that component's source or tests change, and when a component it depends on changes. The dependencies come from `docs/architecture/component-map.md`.
  - Shared inputs run every component's integration tests: the lockfile, root configs, `core`, `config`, `testing`, the build and the compliance harness.
- **E2E:**
  - The local e2e projects run when application behaviour changes: framework source and `bin`, the template, reference and demo apps' source, migrations and config, the starter package's source, the skill's scripts, the lockfile, and the e2e support code.
  - Changes only to unit tests, integration tests, docs or specs never run e2e.
  - A change only to e2e specs runs only the changed specs.
- **Chromium:** installed only when a selected test needs a browser (`e2e-ui`, the Playwright `integration` project, the template's browser test).

**No duplicates.** Each test file belongs to exactly one layer and is selected at most once per run. A deliberate exception needs a decision-log entry with its reason. To fix today:
- `tests/skill/**/*.test.ts` (integration config) also collects `*.unit.test.ts` files that the unit layer already runs. DEC-0405 made this deliberate, because the integration run is what evidences SKILL-AC-004 for the compliance driver. Supersede DEC-0405 with an entry that keeps SKILL-AC-004 evidenced with a single run.
- `tests/skill/examples.test.ts` runs the template and reference `verify`, which `ci.yml` also runs directly.
- `release.yml` re-runs `example-pages` and `examples` after `npm run verify`.

**Release.** `release.yml` runs every test once: unit, all integration (Vitest and Playwright `integration`), and both local e2e projects, with Chromium. Cloud passes and milestone items keep their compliance tiers (compliance.md §2), because GitHub Actions has no cloud credentials.

**Linters.**
- All linters run in two places:
  - a Claude Code hook in `.claude/settings.json`, on changed files, at an event the implementation chooses so agents get feedback without paying for a run on every edit (for example before the agent reports done);
  - a git pre-commit hook, tracked in the repository and enabled by the root `prepare` script (`core.hooksPath`), so a fresh clone gets it with `npm ci`.
- Both run only on files changed in this repository: files outside the repository root, other repositories, `node_modules` and agent worktrees are ignored (open point O-6).
- The linters:
  - eslint;
  - typecheck;
  - the root-cause record lint: required sections, and a Review verdict or `Status: awaiting review`;
  - the test-review record lint.
- The new record linters do not run in CI (TS-12).
- Whether CI keeps eslint and typecheck as a gate is open point O-1.

### 3.13 Changes to skills that affect testing (TS-13)
- **What's covered:**
  - any change to `.claude/skills/testing-standards/**`;
  - any change to the product skill's testing references;
  - any change to `skill/SKILL.md`'s hard rules or its definition of done.
- **Who reviews:** a skill-reviewer subagent, before the change is committed.
- **What it checks:**
  - **Quality:** no rule that protects test quality is removed, loosened or made ambiguous.
  - **Progressive disclosure:**
    - `SKILL.md` holds only the rules that always apply, plus pointers.
    - Details live in reference files that each start with "Read this when…" and end with a stopping condition.
    - The product skill stays within PAR-070…072.

  Its verdict and reasons go in the commit message, or in the PR description for a batch.

## 4. Apps built with the framework (TS-14)
Apps get the same standards through the product skill (`skill/`), the template and the framework's `/testing` export. App builders' agents apply them without asking the user technical questions, and explain results in plain words.

- **Remove:** the rule that app tests reach the app only through its API and add no browser driver.
- **Layers in an app:**
  - unit tests (TDD) for the app's own logic;
  - integration tests: in-process with `createTestApp`, on both SQL dialects, as `verify` runs today;
  - e2e: API-first against `dev`, plus a few Playwright UI tests of the app's pages;
  - the smoke test on a deployed stage, unchanged.
- **The template ships:**
  - the e2e layer and its two Playwright projects;
  - a small fuzz helper for route inputs, driven by a route's zod schema. The skill says to use it only on routes that meet §3.7, not on every route.
  - pinned Playwright, added to the hard-rule-5 pins;
  - the hooks of §3.12, if open point O-6 confirms that hooks ship to apps.

  Chromium is installed only when UI tests run.
- **The skill tells the app's agent to:**
  - use red/green/refactor;
  - run the diagnosis and review workflow of §3.8 with subagents, with records stored in the app repository at a path the skill names;
  - search for similar cases;
  - review changes to once-green tests (§3.9);
  - state each change's test impact;
  - keep e2e current with every feature.
- **Disclosure:** each of these is a reference read only when needed, and the skill stays within PAR-070…072.
- **Hard rule 3** (`verify` before done) widens to cover the app's e2e projects.

## 5. E2E scope for v0.2.0 (TS-15; its own PR)
This is relative to the v0.2.0 end state: sign-in through the auth app, bootstrap plus the admin app, and password, mail and `admins` removed. Retirements and rewrites go through §3.9 and use the §3.5 retirement mechanics. Additions are `ai-proposed`. An independent subagent reviewed this section (verdict `accepted-with-changes`, changes applied). The implementation's test author turns each item into scenario text and tests, and that text is reviewed again (§3.5).

**Rewrite or retire (stale today or by v0.2.0):**
- **E2E-005:** rewritten for the auth app (`plan-v0.2.0-auth.md` §6). Its no-email check inspects real auth-app identities, which carry an email. Test stages use mock login only (auth plan §4.3), so that part runs locally against mock-oauth2-server: Where `Local, cloud`.
- **E2E-006:** the test-mail clause goes. A redirect to `<auth app>/start` is expected.
- **E2E-007** becomes "role from membership". Local, with mock-oauth2-server and a fake memberships API:
  - user and admin roles;
  - a promote, a demote, and a removed member each take effect at role refresh or renewal (auth plan §4.1 step 5).

  Its live part is `(milestone)`.
- **E2E-008:** the live owner sign-in becomes `Cloud (milestone)`. An automated `prodcheck` part checks the `/start` redirect, carrying the app ID and the registered return URL.
- **Password, mail and `admins`:** every scenario clause and test for them goes with those features. The harness pieces go too:
  - `tests/compliance/harness/expected.ts`'s `PASSWORD_PENDING` rules;
  - `prodcheck.ts`'s `check-login` mail and password steps;
  - `sign-up-budget.ts`;
  - E2E-001's sign-in page step (`template-pages.ts`).
- **AWS:**
  - E2E-011's AWS clause is marked "deferred (branch `aws`)" (DEC-0508).
  - E2E-002's Pass line still says "all three smoke runs" and is aligned with its existing deferral note.
- **The scenarios document's preamble** ("cloud scenarios run on test stages using the authentication mock") is corrected for the `prodcheck` scenarios.
- **E2E-016's term list (`terms.txt`)** is checked for v0.2.0 terms, for example Secrets Store and PKCE.
- **Invalidations (COMPL-REQ-006, compliance.md §2), after v0.2.0 changes PROV and CF code and setup:**
  - Invalidate E2E-010, E2E-012, E2E-015, E2E-016's review part (the auth and admin apps need portability notes) and SKILL-AC-006.
  - MAIL-AC-007 leaves the milestone list.
  - E2E-015 has no milestone record today (`validation/release/2026-10-24-33b3df7.md`). Its first record comes from the post-v0.2.0 run.

**Add (each with happy path, expected errors and edge cases):**
1. **Setup:** bootstrap, then the admin app, then account setup. Runs locally against the fake Cloudflare API and mock-oauth2-server. The fake Cloudflare API must accept mock-oauth2-server access tokens and enforce their scopes; that is part of this item. Expected errors:
   - a token expiring in over 1 day, or with no expiry, is deleted at once;
   - a token expiring at exactly 1 day is accepted, and one at 1 day plus one second is deleted;
   - a missing permission;
   - an interrupted run re-run;
   - an anonymous visitor, or a non-admin member, is refused by the admin app;
   - a page whose optional scope was not granted shows a clear message;
   - no bootstrap or everyday token value appears in any output or file.

   The live parts stay in auth plan §7's live list.
2. **Sign-in through the auth app**, API-driven over HTTP with mock-oauth2-server:
   - **Happy paths:**
     - user and admin roles;
     - sign-out;
     - `deploy` registers the app's return URL, and `remove` deregisters it.
   - **Errors and edge cases:**
     - a return URL not in the registry (open redirect), including one that differs only by trailing slash, case, port or percent-encoding;
     - an app-ID and return-URL mismatch;
     - a code that is reused, expired, or issued for another app;
     - two concurrent redemptions of one code, where exactly one succeeds;
     - consent denied;
     - an ID token with no `email`, using the `/user` fallback (auth plan §10);
     - the auth app unavailable: existing sessions keep working, and behaviour at role refresh is defined and tested.
   - Plus one UI test through the sign-in pages.
3. **Starter and upgrade:**
   - E2E-001 is extended to scaffold through the packed `npm create` starter instead of `skill/scripts/scaffold`, rather than adding a new scenario.
   - A new scenario covers `upgrade` from 0.1.x to 0.2.0 using a local 0.2.0 package tarball:
     - the app's own data survives;
     - the "re-run setup" pointer is printed;
     - the next `dev` drops the Better Auth tables through the framework migrations (auth plan §8).

**Considered and not added** (with the reason recorded in the PR):
- Stage lifecycle (`stop`, `start`, `deploy --start`) is covered by `prov/deploy-sequence.test.ts`. If the production-remove refusal, which is unit-level only today, needs e2e, it joins E2E-012's stages to stay within the D1 database cap (plan §1).
- Capability errors are covered by E2E-013 and the KV and FILES criteria. An expired-ticket e2e would need a 15-minute wait (PAR-233).
- `reset-local` is covered by LOCAL-AC-002.
- Template on Cloudflare: E2E-001 is Local by design. PROV-AC-001 and CLI-AC-005 cover the deployed template.

## 6. Where the standards land
- **`CLAUDE.md`:**
  - the orchestrator convention (TS-1);
  - the retrospective hard rule (TS-17);
  - one line requiring the testing-standards skill for any change to code or tests.
- **`docs/CONVENTIONS.md`:** §4 extended to E2E scenarios, and the agents' change rule (§3.5). A new section, "Testing standards", gives the binding summary of §3 and points to the skill. Testing standards are process rules, not `*-REQ-*` items (open point O-2).
- **`docs/acceptance/e2e-scenarios.md`, `docs/README.md`:** §3.5 and §5.
- **`docs/components/compliance.md`:** "Tiers" per TS-19 and §3.12, the two e2e Playwright projects, and the milestone list changes of §5.
- **`.claude/skills/testing-standards/`:** a short `SKILL.md`, with `resources/` for the diagnosis workflow (§3.8), test-change review (§3.9), fuzzing (§3.7), edge cases (§3.6) and the CI path map (§3.12). Reviewed per §3.13.
- **`skill/` (product skill):** `reference/testing.md` reworked, and new references per §4. Reviewed per §3.13.
- **`apps/template/`:** e2e projects, fuzz helper, hooks (§4).
- **`.github/workflows/ci.yml`, `release.yml`, `playwright.config.ts`, the Vitest configs, root `package.json`, the hooks:** §3.12.
- **`ai/implementation/plan.md`:** a pointer from §1 and §10 to the new standards, so later plans inherit them.

## 7. Work breakdown (into `plan-v0.2.0-auth.md` §9)
- **Wave 0, before wave 1, in parallel:**
  - (s1) standards text: CONVENTIONS, compliance.md, `CLAUDE.md`, and the testing-standards skill, reviewed per §3.13;
  - (s2) hooks and linters (§3.12);
  - (s3) CI and release restructuring, Playwright projects, and duplicate removal (§3.12), shown by a PR whose classification log matches the path map;
  - (s4) the integration coverage list (§3.4) and a short fuzz target list (§3.7), by a planning subagent, read-only. A reviewer confirms each fuzz target is justified.
- **Waves 1–2:** every item's brief carries its "Tests" and "E2E" sections (§3.10). Item (g), skill and quickstart, also does §4 in the product skill and the template.
- **Then (added to the existing list):**
  - the e2e scope of §5, in its own PR;
  - integration suites for the gaps found in (s4);
  - fuzz targets from (s4);
  - a test-change review of all v0.2.0 test removals, grouped by reason code (§3.9), before the removal merges.

## 8. Open points for the owner
- **O-1. CI and eslint/typecheck.** A pre-commit hook can be bypassed: `--no-verify`, edits in the GitHub web UI, or pushes through the GitHub API. Proposal: CI keeps eslint and typecheck, which take seconds, as the gate that can't be bypassed; the new record linters run only in hooks (TS-12). Or should all linting leave CI?
- **O-2. Where the standards are binding.** Proposal: a "Testing standards" section in `docs/CONVENTIONS.md` plus the skill, with no new `TEST-REQ-*` IDs, since those would need their own acceptance criteria and tests.
- **O-3. CI for apps.** The template ships no CI workflow today. Should apps get one, following §3.12?
- **O-4. Orchestration in apps.** Apps need subagents for the review roles (§4). Should the app skill also make the app's main session orchestrator-only (TS-1)?
- **O-5. The self-retrospective skill and TS-17.** That skill reads earlier retrospectives to scope a new one. Does TS-17 exempt it, or should it stop reading earlier retrospectives?
- **O-6. "Hooks only against changes in this repo".** There are two readings:
  - (a) hooks lint only files changed inside this repository, and ignore other repositories, worktrees and `node_modules`;
  - (b) this repository's hooks are not shipped to app repositories.

  This addendum assumes (a), with apps getting their own copy of the hooks (§4). Under (b), §4's hook bullet is dropped.
- **O-7. Owner-origin requirements v0.2.0 must amend.** The e2e review found that the rewrites of E2E-007 and E2E-008 need amendments to SYS-REQ-018, SYS-REQ-019 and SYS-REQ-027 and to COMPL-REQ-006's milestone list. SYS-REQ-027's amendment currently requires an automated real-provider check on every cloud run, which a human Cloudflare sign-in cannot meet. `plan-v0.2.0-auth.md` §6 does not list these. They are yours to amend.
