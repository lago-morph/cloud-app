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
| TS-1 | **The main session orchestrates.** It keeps its context small and reduces wall-clock time by making aggressive use of subagents, running them in parallel where they don't touch the same files (prompt §1, kept and made permanent). |
| TS-2 | **Unit tests use red/green/refactor TDD** (prompt §6, kept). |
| TS-3 | **Any failure outside red/green gets an evidence-based root cause, never a guess.** That covers unit regressions, every integration and e2e failure, and builds and deploys. A **diagnoser subagent**, never the code's author, finds it (prompt §8, kept). Evidence includes logs, a debugger, and several variations of the test. |
| TS-4 | **An independent reviewer subagent** first decides whether the evidence supports the root cause. Only then does it evaluate the fix. Major issues must be answered. At most **3 review rounds**; a record that needed more than one round gets an analysis of why, and the skill is updated if that analysis shows a gap (§3.8). |
| TS-5 | **Similar cases before the fix.** After approval and before the fix, search for similar cases and add tests for them too. |
| TS-6 | **Integration tests per component, using the existing layer definition:** real local dependencies (Miniflare/workerd, PGlite, the file system, local stand-ins such as mock-oauth2-server); fakes only where no local stand-in exists. No new mocking rule. Every component has a comprehensive integration suite. |
| TS-7 | **E2E covers every happy path and every expected error scenario,** with creatively chosen edge cases. It is API-first: e2e tests drive the API, and a limited number of Playwright UI tests cover what only a browser shows. |
| TS-8 | **Fuzzing is local, limited and targeted.** Use it where it makes sense: APIs and well-defined client/server interfaces, especially code with repeated regressions. Never brute-force every API, never fuzz a cloud stage. |
| TS-9 | **Every change carries its test impact,** and its implementer makes the needed test changes in the same work, without being asked. |
| TS-10 | **Changes to once-green tests are reviewed by an independent subagent.** That covers any change to a once-green test's expected results, its removal, or its weakening. "Green once" means it passed in this session, or it is on `main`. Review may be in bulk, grouped by reason. The aim: agents fix real defects instead of deleting or changing tests (§3.9). |
| TS-11 | **CI runs tests intelligently, on PRs only.** Component integration tests run when that component changes. E2E runs on PRs that change application behaviour, never when only tests or docs and specs change. Every test, e2e included, runs at release. No test runs twice in one run without a recorded reason. Chromium is installed only when a UI test is selected (§3.12). |
| TS-12 | **Linters run in the agent harness (Claude Code hooks) and in a git pre-commit hook,** only against changes in this repository. The new root-cause record linter is not added to CI (§3.12). |
| TS-13 | **Any change to a testing skill is reviewed by a subagent first,** for test quality not being weakened and for strict progressive disclosure (§3.13). |
| TS-14 | **Apps built with the framework get the same level of testing as the framework.** The rule "app tests use the API only and add no browser driver" (`skill/reference/testing.md`, "What runs your tests", last bullet) is removed (§4). |
| TS-15 | **Agents keep E2E scenarios current without owner approval.** Scenario additions and changes are reviewed and validated by an independent subagent instead (§3.5). The e2e scope changes for v0.2.0 (§5) go in their own PR. |
| TS-16 | **CI economy is the orchestrator's call.** The owner leaves the docs-only CI question to the implementation: choose the method that safely reduces wall-clock time without compromising test quality. §3.12 records the choice. |
| TS-17 | **Retrospectives are suggestions only.** Their recommendations are never used in any decision unless the owner adopts them. Agents never read retrospective skill specs (`SKILL-SPEC-*`), proposed ADRs (`ADR-*`) or proposed agents-file rules (`AGENTS-MD-*`). This is a hard rule in `CLAUDE.md`. |
| TS-18 | **Review loops answer comments.** Before, a rejected record went back to diagnosis with no round limit (prompt §8 step 2). That had no step for answering comments and no limit. TS-4 fills the gap. |
| TS-19 | **CI must run the integration and e2e layers.** Today it never does, although `compliance.md` §2 "Tiers" says automated criteria and scenarios run for every commit. TS-11 replaces "every commit" with the selection rules of §3.12. |

## 3. Standards

These sections are normative. §6 says which file each one lands in.

### 3.1 Orchestration (TS-1)
- **What the orchestrator does and doesn't do:** prompt §1 applies to every implementation run, not only the first. The main session plans nothing, writes no code, tests or documents, runs no suites and diagnoses nothing. It briefs subagents, tracks items, merges branches and relays questions to the owner.
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
- **Fakes:** only for external platforms with no local stand-in (for example the fake Cloudflare API, DEC-0347). A run against fakes only is not evidence for a criterion whose Where column says Cloud.
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
  - `docs/acceptance/e2e-scenarios.md` gets an `Origin` line per scenario (CONVENTIONS §4). Existing scenarios are marked as the owner reviewed them. The `docs/README.md` status row "Reviewed by owner" gets a note that it is not an approval gate for later changes.
  - Agents add scenarios as `ai-proposed`, each with a decision-log entry, and may extend or rewrite scenarios to match the framework's current intent.
  - Every addition, change or removal is reviewed and validated by an independent subagent; the owner does not review them (TS-15).
  - Removals and weakenings also go through the test-change review (§3.9).
- **IDs:** new IDs continue from the highest one (E2E-017 is next) and are never reused (CONVENTIONS §2). A new scenario has `Where:` and `Verifies:` lines. Its tagged tests land in the same change, since E2E-004's coverage part fails until they exist.

### 3.6 Edge cases (TS-7)
For each criterion and scenario, the test author lists edge cases before writing tests and covers the ones that apply. Prompts for that list:
- **Boundaries:** empty, one, exactly at a PAR limit, one past it.
- **Text:**
  - Unicode, case and normalisation; `..`, `/` and percent-encoding in names.
  - One name being a prefix of another. The R2 list order defect showed this one (`root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`).
- **Order and time:** sort order and paging cursors; expiry at and just past the limit (fake `Date` only).
- **Access:** anonymous, user, admin, and another user's data.
- **Repetition:** repeated and concurrent requests, reuse of single-use tokens or codes.
- **Failures:** an unavailable capability (`setUnavailable`); local versus cloud behaviour differences.

### 3.7 Fuzzing (TS-8)
- **Where:** fuzz only where it makes sense:
  - parsers, validators and encoders at a trust boundary (HTTP inputs, names, cursors, redirect and return URLs, codes and tokens);
  - interfaces with a contract (the OpenAPI files under `docs/contracts/http/`, zod schemas);
  - components with repeated regressions, judged from their root-cause records.
- **How much:** small and fixed:
  - Each fuzz target has a small, fixed run budget, recorded as a PAR with its reason. No PAR value is copied between targets without a reason.
  - Seeds are fixed, so runs are reproducible.
  - Fuzz targets run in the normal unit or integration layer and add only seconds.
  - No fuzzing of every endpoint by default, and no long or exhaustive runs.
- **Local only:** fuzzing never runs against a cloud stage (plan §1 cloud usage limits: no stress or load tests).
- **Findings:** a failure found by fuzzing goes through §3.8. Its case becomes a plain regression test.
- **Tool:** the implementation chooses it, with a decision-log entry. It must run offline in Node, so apps need no other toolchain (candidates: fast-check for properties; a property-based HTTP fuzzer driven by the OpenAPI contracts and zod schemas).

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
4. **Round limit.**
   - At most 3 review rounds.
   - A record that needed a second round gets a short non-convergence note. A subagent other than the diagnoser and the reviewer writes it: why the first submission failed. If the note shows the standards or the skill were unclear, the orchestrator has the skill changed (§3.13).
   - A record still rejected after round 3 stops. The orchestrator reports it to the owner with the record and the note.
5. **Similar cases.** After acceptance and before the fix, a subagent searches for the same defect pattern elsewhere: other call sites, other components with the same assumption, the other target. It lists what it found with evidence and adds failing tests for each case.
   - A case outside the fixing item's owned paths becomes a new item. It is not fixed silently (plan §1 ownership).
6. **Fix.** A fixer subagent fixes red-green: the reproduction test and the similar-case tests fail first, then pass. It follows the accepted record as amended by its Review.
7. **Re-check.** The test runner and the evaluator re-run the affected tests (prompt §8 step 4). The evaluator checks that the record has a Review verdict that came before the fix commit.

### 3.9 Changes to once-green tests (TS-10)
- **What counts as once-green:** a test is once-green if it passed in the current session or is on `main`.
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
- **Test economy rules 1–9 (plan §1, owner, 2026-10-20).** They govern what agents run; CI selection follows §3.12. Rule 2 (docs-only items) now runs the linters in hooks plus only the tests that read the changed docs (§3.12).
- **Cloud usage limits (plan §1).**
- **Offline runs:** `unshare -rn sh scripts/offline.sh`; never unset the proxy (plan §10.2).
- **Unit timeout:** 30 s under load (`vitest.unit.config.ts`).
- **Order-dependence checks:** economy rule 6.

### 3.12 CI and hooks (TS-11, TS-12, TS-16, TS-19)
**Triggers.**
- `ci.yml` runs on `pull_request` only. The `push: branches: [main]` trigger is removed.
- `release.yml` keeps its version-tag trigger.

**Change classification.** A first step classifies the PR's changed files against a committed path map:
- **Docs, specs and plans** (`docs/**`, `ai/**`, `*.md`, `retrospective/**`): no test runs. Exceptions are files that a test or the build reads. The path map lists, per such file, the tests that read it (for example the scenario catalogue, contracts, skill text), and only those tests run. A hook lint keeps that list current by scanning the tests for the repository paths they read.

  This is the TS-16 choice: no test that depends on a changed file is ever skipped, and prose changes cost nothing.
- **Unit tests:** the whole unit layer runs on any change to code or tests. It is the cheapest layer. Selecting by import graph would miss tests that read files without importing them.
- **Integration tests:**
  - Each component's integration suite and compliance criteria run when that component's source or tests change, and when a component it depends on changes. The dependencies come from `docs/architecture/component-map.md`.
  - Shared inputs run every component's integration tests: the lockfile, root configs, `core`, `config`, `testing`, the build and the compliance harness.
- **E2E:**
  - The local e2e projects run when application behaviour changes: framework source and `bin`, the template, reference and demo apps' source, migrations and config, the starter package's source, the skill's scripts, the lockfile, and the e2e support code.
  - Changes only to unit tests, integration tests, docs or specs never run e2e.
  - A change only to e2e specs runs only the changed specs.
- **Chromium:** installed only when a selected test needs a browser (`e2e-ui`, the Playwright `integration` project, the template's browser test).

**No duplicates.** Each test file belongs to exactly one layer and is selected at most once per run. A deliberate exception needs a decision-log entry with its reason. To fix today:
- `tests/skill/**/*.test.ts` (integration config) also collects `*.unit.test.ts` files that the unit layer already runs (DEC-0405's check runs in the unit layer).
- `tests/skill/examples.test.ts` runs the template and reference `verify`, which `ci.yml` also runs directly.
- `release.yml` re-runs `example-pages` and `examples` after `npm run verify`.

**Release.** `release.yml` runs every test once: unit, all integration (Vitest and Playwright `integration`), and both local e2e projects, with Chromium. Cloud passes and milestone items keep their compliance tiers (compliance.md §2), because GitHub Actions has no cloud credentials.

**Linters.**
- All linters run in two places:
  - a Claude Code hook in `.claude/settings.json`, after edits;
  - a git pre-commit hook, tracked in the repository and enabled by the root `prepare` script (`core.hooksPath`), so a fresh clone gets it with `npm ci`.
- Both run only on files changed in this repository: files outside the repository root, other repositories, `node_modules` and agent worktrees are ignored.
- The linters:
  - eslint;
  - typecheck;
  - the root-cause record lint: required sections, and a Review verdict or `Status: awaiting review`;
  - the test-review record lint;
  - the path-map lint.
- The new record linters do not run in CI (TS-12).
- Whether CI keeps eslint and typecheck as a gate is open point O-1.

### 3.13 Changes to testing skills (TS-13)
- **What's covered:** any change to a testing skill or reference. That includes `.claude/skills/testing-standards/**` and the product skill's testing references under `skill/`.
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
  - a bounded fuzz helper for route inputs, driven by the routes' zod schemas;
  - pinned Playwright, added to the hard-rule-5 pins;
  - the hooks of §3.12 in `.claude/settings.json` and a pre-commit hook.

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
This is relative to the v0.2.0 end state: sign-in through the auth app, bootstrap plus the admin app, and password, mail and `admins` removed. Removals and rewrites go through §3.9. Additions are `ai-proposed` and reviewed by an independent subagent (§3.5). The implementation's test author turns each item into scenario text and tests.

**Rewrite or remove (stale today or by v0.2.0):**
- E2E-005…008: rewritten for the auth app (`plan-v0.2.0-auth.md` §6). E2E-005's no-email check inspects real auth-app identities, which carry an email, not mock identities only.
- Every scenario clause and test for password sign-in, mail, `admins` and `check-login`'s mail and password steps goes with those features.
- E2E-002: its AWS part is marked "deferred (branch `aws`)" like other AWS lines (DEC-0508). Its Cloudflare part states how it is shown, since today it always reports `blocked` in the suite.
- E2E-004 and E2E-011: their AWS clauses are marked deferred.
- The scenarios document's preamble ("cloud scenarios run on test stages using the authentication mock") is corrected for the `prodcheck` scenarios.
- E2E-015: an invalidation entry after v0.2.0 (compliance.md §2), since its evidence predates password login, the setup wizard and v0.2.0.

**Add (each with happy path, expected errors and edge cases):**
1. **Setup:** bootstrap, then the admin app, then account setup. Run locally against the fake Cloudflare API and mock-oauth2-server. Errors: a token expiring in over 1 day, or with no expiry, is deleted at once; a missing permission; an interrupted run re-run. The live parts stay in the plan §7 live list.
2. **Sign-in through the auth app**, API-driven over HTTP with mock-oauth2-server:
   - Happy paths: user and admin roles, sign-out.
   - Errors and edge cases:
     - a return URL not in the registry (open redirect);
     - a code that is reused, expired, or issued for another app;
     - consent denied;
     - the auth app unavailable while existing sessions keep working.
   - Plus one UI test through the sign-in pages.
3. **The starter and versions:**
   - `npm create` → `verify` → `dev`;
   - `version-check`;
   - `upgrade` from 0.1.x to 0.2.0, which drops the Better Auth tables (§8 of the auth plan).
4. **Stage lifecycle:** `stop`, `start` and `deploy --start`; refusal to remove a production stage without its confirmation. Each is tagged with its Where per the cloud usage limits.
5. **Capability errors at e2e level:** one representative expected error per capability through the reference app. Examples: a KV invalid key, a file too large, an expired ticket, a failing migration on deploy.
6. **`reset-local`.**
7. **Template on Cloudflare (E2E-001's cloud part):** added only if PROV-AC-001 and SKILL-AC-006 don't already show it. The reviewer decides and records why.

## 6. Where the standards land
- **`CLAUDE.md`:**
  - the orchestrator convention (TS-1);
  - the retrospective hard rule (TS-17);
  - one line requiring the testing-standards skill for any change to code or tests.
- **`docs/CONVENTIONS.md`:** Origin lines for E2E scenarios, and agents may add and change scenarios (§3.5). A new section, "Testing standards", gives the binding summary of §3 and points to the skill. Testing standards are process rules, not `*-REQ-*` items (open point O-2).
- **`docs/acceptance/e2e-scenarios.md`, `docs/README.md`:** §3.5 and §5.
- **`docs/components/compliance.md`:** "Tiers" per TS-19 and §3.12, and the two e2e Playwright projects.
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
  - (s4) the integration coverage list (§3.4) and the fuzz target list (§3.7), by a planning subagent, read-only.
- **Waves 1–2:** every item's brief carries its "Tests" and "E2E" sections (§3.10). Item (g), skill and quickstart, also does §4 in the product skill and the template.
- **Then (added to the existing list):**
  - the e2e scope of §5, in its own PR;
  - integration suites for the gaps found in (s4);
  - fuzz targets from (s4);
  - a test-change review of all v0.2.0 test removals, grouped by reason code (§3.9), before the removal merges.

## 8. Open points for the owner
- **O-1. CI and eslint/typecheck.** A pre-commit hook can be bypassed: `--no-verify`, edits in the GitHub web UI, or pushes through the GitHub API. Proposal: CI keeps eslint and typecheck, which take seconds, as the gate that can't be bypassed; the new record and path-map linters run only in hooks (TS-12). Or should all linting leave CI?
- **O-2. Where the standards are binding.** Proposal: a "Testing standards" section in `docs/CONVENTIONS.md` plus the skill, with no new `TEST-REQ-*` IDs, since those would need their own acceptance criteria and tests.
- **O-3. CI for apps.** The template ships no CI workflow today. Should apps get one, following §3.12?
- **O-4. Orchestration in apps.** Apps need subagents for the review roles (§4). Should the app skill also make the app's main session orchestrator-only (TS-1)?
- **O-5. The self-retrospective skill and TS-17.** That skill reads earlier retrospectives to scope a new one. Does TS-17 exempt it, or should it stop reading earlier retrospectives?
- **O-6. "Hooks only against changes in this repo".** This addendum reads it as: hooks lint only files changed inside this repository, and ignore other repositories, worktrees and `node_modules`. Correct?
