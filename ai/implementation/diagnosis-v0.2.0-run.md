# Diagnosis of the v0.2.0 overnight run, and a plan to salvage it

Written 2026-10-31 after the owner stopped the run. Nothing here changes code. The run's state is in `progress-v0.2.0.md` (status note at the top), `v0.2.0-pr-stack.md` and `owner-questions-v0.2.0.md`.

## 1. What happened, in numbers

| Measure | Value | Source |
|---|---|---|
| Open PRs from the run | 97 (#59–#160, minus #58, which is the previous session's retrospective) | GitHub |
| Actual size of v0.2.0, top branch vs `main` | ~316 files, ~15,200 insertions, ~14,400 deletions | `git diff --shortstat` |
| Merge-only PRs (no change of their own) | 6: #94, #96, #107, #122, #125, #127 | PR index |
| Fix PRs for single findings | 18: #97, #112, #113, #123, #126, #134, #143, #144, #147, #153, #155, #156, #157, #158, #160, #149, #136, #151 | PR index |
| Records-only or wording-only PRs | 4: #59, #130, #159, #152 | PR index |
| Root-cause and test-change records | 60 | branches |
| Subagents launched by the orchestrator | 43 | transcript |
| Separate cloud sessions started by subagents as "independent reviewers" | ~60 (43 seen by the orchestrator; others only in PR bodies) | transcript, PR bodies |
| Times the orchestrator was woken by a PR event (CI finished, new PR, comment) | 301 | transcript |
| Subagent token use, second half of the run only (17 agents) | ~6.8M | completion notices |

The code change itself is ordinary in size. The cost came from process multiplied by count: 97 PRs × (CI run + reviewer session + orchestrator wake-ups), and up to 6 subagents per failure.

## 2. Where each problem came from

### 2.1 The PR proliferation

**Source A: the prompt's §4, written by the previous session.** The overnight prompt (the first user message of this session) says:

> **One concern per PR.** Aim for at most about 400 changed lines, not counting lockfiles, generated files and pure deletions. Split larger items into a sequence of PRs, each of which builds and passes CI. … **Stack by dependency.** Each PR's base is the branch of the PR it depends on … Name branches `v0.2.0/<nn>-<slug>` … Never merge a PR … If a lower PR changes after upper PRs exist … merge that branch up into each branch above it.

The owner did not write this rule. PR #58 (the previous session's retrospective) says that session drafted an ADR, `ADR-7cdd316489-autonomous-runs-deliver-stacked-unmerged-prs.md`, "the stacked-PR convention for unattended runs", and that "nothing [was] adopted". The previous session then wrote its own un-adopted ADR into the prompt as a binding rule. That is the root of the stacking model.

**Source B: the orchestrator (me) applied the rule mechanically and never questioned the total.** A 400-line cap on a 15k-line change arithmetically yields 40+ PRs before any fix. I split the admin app alone into 17 PRs. The prompt also said "Independent plan items get independent stacks", which I turned into 9 parallel stacks that then needed joining.

**Source C: joining the stacks, my invention.** Items depended on each other but the prompt said "nothing merges during the run", so I recorded DEC-0620 ("after X merged" means "after X is pushed") and DEC-0623 ("merge-only PRs join two stacks"). Every join became a PR (#94, #96, #107, #122, #125, #127), and every join had to be re-merged whenever a lower branch changed, which re-ran CI on every PR above it. Retargeting a PR's base does not re-run CI, so each retarget also needed a real merge commit.

**Source D: one PR per finding.** Three inputs:
1. The prompt's "one concern per PR".
2. My planning subagent wrote the work list (`progress-v0.2.0.md` §3) with T7 as `91-fix-<slug>`…`94-fix-<slug>` ← main, one branch per fix. The plan §9 only says "red-green fixes, each failure through the diagnosis and review workflow of §7a.1.8"; the branch-per-fix layout is the planning subagent's reading of the prompt.
3. My own choice, the largest factor: for every new finding I launched a new agent with its own branch and PR (18 fix PRs), instead of returning the finding to the agent that owned the code to fold into its open PR. I also created records-only PRs (#159) and wording-only PRs (#136, #151, #152), which nothing required.

### 2.2 The heavy process around every defect

**Source A: the plan's §7a.1.8, which the owner approved in PR #57.** It prescribes, for *every* failure ("unit regressions, all integration and e2e failures, and failed builds, deploys and spikes"), up to seven steps with distinct subagents: a diagnoser, a root-cause reviewer (with up to 3 review rounds), a similar-case searcher, a fixer, a test runner, an evaluator, and a non-convergence note "by a subagent other than the diagnoser and the reviewer". §7a.1.9 adds an independent test-change reviewer for any change to a once-green test. §7a.2.6 adds a skill reviewer. The TS table (TS-3, TS-4, TS-5, TS-20) makes these standards, not guidance. The plan has no cost model and no tiering: a 2-line stale fixture gets the same process as a security defect.

**Source B: the old prompt's §8, inherited.** `ai/prompts/implement-local-cloudflare.md` §8 already had diagnoser → independent reviewer → fix. The plan expanded it; the new prompt's §3 re-affirmed it ("Failures follow plan §7a.1.8: a diagnoser, an independent reviewer, at most 3 attempts").

**Source C: subagents cannot spawn subagents, so every "independent reviewer subagent" became a separate cloud session.** This is a tooling fact I knew and worked around rather than escalated. Each of the ~60 reviewer sessions started with a fresh context, re-read the plan and the code, and often ran the suites itself ("reproduces once, plus one experiment per hypothesis"). Several reported to this session instead of their parent, so I relayed them (6 relays), spending orchestrator context on reviewer output.

**Source D: a feedback loop I created.** I ran up to 9 agents at once on one 13 GiB cgroup. That produced load failures: E2E-004 timeouts, `native-copy` "fetch failed", `admins.unit.test` timeouts, a CLI-AC-008 OOM kill, ENOSPC on e2e, a disk at 93%. The plan forbids calling these "flaky", so each one entered the full §7a.1.8 process, which launched more agents, which added more load. At least 4 of the 18 fix PRs (#123, #126, #134's second round, #159's CLI-AC-008 record) exist mainly because of load I caused.

**Source E: CI was partly meaningless but still drove process.** The session's GitHub credential lacks `workflow` scope, so S3's new `ci.yml` was staged under `scripts/ci/workflows/` and never ran. Every PR ran the old workflow instead. Red runs on the old workflow (for example the 3 `ci-classify` failures on every branch built from an early join) still triggered merges, re-runs and agent messages across ~10 PRs.

### 2.3 Why old prompts and plans were referenced

1. **The new prompt said so, explicitly.** Its §1: "The governing prompt `ai/prompts/implement-local-cloudflare.md` still applies, as the plan cites it ('prompt §n'): §1 (orchestrator only), §5, §6–§8, and §10." The previous session wrote the v0.2.0 plan against the old prompt and, rather than restate the rules, pointed at it. So the old prompt's model (one feature branch, merge subagent branches into it, one PR per phase, §1 and §5) was in force at the same time as the new prompt's §4 (many stacked unmerged PRs). I resolved the conflict in favour of §4 because the prompt said "Where it conflicts with this prompt, this prompt wins", and never flagged that the two models are incompatible.
2. **The plan cites the old prompt throughout** ("prompt §8", "prompt §1"), so subagents reading the plan were also reading the old prompt.
3. **My planning subagent reached further back.** The progress file header says "`plan.md` §9.2/§10 conventions apply", and the DEC/PAR allocation scheme cites `handoff-setup-wizard.md`. Those are the v0.1 plan and a v0.1 handoff document under `ai/implementation/`. Nothing in the prompt asked for them; the subagent found them while reading the directory and adopted their conventions (per-item decision drafts, pre-allocated ID ranges, integration PRs I1/I2). That is where the DEC-range exhaustion and ID borrowing came from.

The general failure: three generations of instructions (v0.1 prompt, v0.1 plan and handoffs, v0.2.0 plan, v0.2.0 prompt) were all live at once, and no one, including me, reconciled them.

### 2.4 Orchestrator wake-ups

I subscribed this session to every PR I or a subagent opened (about 100). GitHub sent an event for every CI completion, new PR, comment and subscription: 301 wake-ups. Each wake-up re-read this session's full context (hundreds of thousands of tokens by the end) to conclude "no action". The prompt said "Don't wait idle for [CI]" and "Check each PR's CI when you come back to it"; subscribing was my choice, and the harness guidance that came with each subscription told me to subscribe after creating a PR. Subagents handled their own PRs, so the subscriptions bought nothing.

### 2.5 What I should have done at the first sign

By mid-run the count was already past 40 PRs and the token notices from subagents were 300–600k each. The prompt said never to stop for the owner, but it did not say to burn the budget. The right move was to stop, write the status note, and end the turn with a clear message: "this process is producing N PRs and M tokens per item; here is the state; continuing needs your decision." Autonomy rules are not a licence to exceed any reasonable cost; I treated them as one.

## 3. What is actually in good shape

Despite the process cost, the content is mostly done and reviewed:
- Every plan §9 item except the live pass has code on a branch with green CI (old workflow) and an independent review with no open major, except C 34c (#160), whose CI was pending when stopped.
- 60 root-cause and test-change records, all independently reviewed.
- The leaf branches together hold the whole release. The join branch `v0.2.0/71n-path-map-after-removals` plus the leaves above it (`34c`, `96b`, `97b`, `57z`, `69`, `69r`, `75`, `81`, `86`, `96`, `94`, `95`, `97`, `98`, `99`, `39c`, `70b`, `50`, `93a`, `89b`, `91`, `92`, `00`) contain every change.
- Owner-facing artefacts exist: 56 owner questions, the live-pass runbook, the PR index.

Known gaps: T6 (independent review of the whole), I2 (decision integration for wave 2), V (version bump), the final report, and the 6 owner decisions below.

## 4. Salvage plan: one integration branch, a handful of PRs, no new process

Goal: get v0.2.0 into a form the owner can review in an afternoon, using one session and a small token budget, without discarding the reviewed work.

### 4.1 Steps for the new session (a single agent, no reviewer sessions)

1. **Build `v0.2.0/integration` from `main`** by merging the leaf branches in this order (each is already a superset of its stack): `17-ci-no-duplicates`, `11-claude-commit-hook`, `06-compliance-tiers`, `20-coverage-fuzz-list`, `08-baseline-root-causes`, `91-fix-native-copy-fetch`, `92-fix-mig-record-order`, `93a-fix-selection-e2e004`, `57z-everyday-switch`, `34c-fix-bootstrap-token-rules`, `96b-fix-deploy-without-email`, `97b-fix-testing-types-email`, `69-fix-template-signing`, `69r-reference-removed-scripts`, `75-setup-criteria-tests`, `81-e2e-starter-upgrade`, `86-integration-client`, `96-fix-remove-registry-first`, `94-fix-release-login-check`, `95-fix-demo-signing`, `97-fix-testing-type-exports`, `98-fix-demo-role-refresh`, `99-records-harness-failures`, `39c-role-change-wording`, `70b-readme-wording`, `89b-fix-return-to-decoded-tab-newline`, `50-int-decisions-w1`, then `00-run-records` last. Expected conflicts, all small and already documented: #156 vs #144 (`operations.ts`, `target.ts`); #155 vs #157 (`test-app.ts`: keep 97b's inline types and adapter plus 97's two exports); #130's draft replacements (keep #130's version); `2026-10-31-E.md` (keep both sides); lockfile (regenerate with `npm install`, never hand-merge).
2. **Run the exit checks once, serially, on that branch:** `npm ci`, build, typecheck, lint, `test:unit`, `npm run compliance -- --target local`, `test:e2e:api`, `test:e2e:ui`, template and reference `verify`. Expect these known reds: E2E-007 (deliberate, owner question 56); cloud and prodcheck rows `not-run`; E2E-003/009 need a clean run. Anything else red is fixed **in place on the integration branch** with a short note in the PR, not a new PR. No new root-cause process unless the cause is unclear after one look.
3. **Open one PR, `v0.2.0/integration` → `main`.** Its body is a review guide by component (auth app, framework provider and removals, bootstrap, admin app, secrets and deploy, spec and docs, skill and template, CI and standards, tests), each pointing to the existing stacked PRs' descriptions as the detailed notes, and listing the 60 records as evidence. If the owner prefers smaller units, split the integration tree by directory into at most 8 PRs that merge in order; do not re-stack 97.
4. **Close the 97 stacked PRs** with one comment each: "Superseded by #<integration>; branch kept." Keep the branches, so nothing is lost and every per-PR review note stays readable. Close #59 last, after merging its files.
5. **Leave the owner decisions open and listed at the top of the integration PR:**
   - question 56: roles in existing sessions (E2E-007 red by design) — approve #151's wording or ask for a design change;
   - questions 18, 19, 53, 55: the "owner approval of wording needed" text (DEC-0690/0691/0692/0699/0700/0703), now folded into the integration branch;
   - question 9: apply the staged `ci.yml`/`release.yml` (`cp scripts/ci/workflows/*.yml .github/workflows/`), which needs the `workflow` scope the session lacks;
   - question 1: no Cloudflare token; the live pass is in `live-pass-v0.2.0.md`.
6. **Then, and only then:** the version bump and CHANGELOG as a second small PR; the final report as a file in the integration branch. Skip T6 as a separate review round: the 60 records and ~60 reviews already exceed it. Replace it with the owner's own review of the integration PR.
7. **Archive the ~60 reviewer cloud sessions** listed in the progress file and PR bodies (`archive_session`), so they stop being billable or confusing.

Budget for this: one session, at most 2 subagents in flight (one to build and test the integration branch, one to write the review guide), no reviewer sessions, no PR subscriptions. Target well under 2M tokens.

### 4.2 Prompt for the salvage session

Self-contained; it must not say "the old prompt still applies".

- Role: single agent; subagents only for the two tasks above; no independent-reviewer sessions.
- Inputs: this file §4.1, `v0.2.0-pr-stack.md`, `progress-v0.2.0.md` (status note only), `owner-questions-v0.2.0.md`.
- Rules: never force-push, never merge to `main`, never tag. Fix reds in place. Stop and report if the integration branch needs more than one day's work, if any suite is red for a reason not in the list above, or at 1.5M tokens.
- Output: the integration PR, the closed-PR comments, the archived sessions, a 20-line summary.

## 5. Prevention: what to change before the next autonomous run

### 5.1 In prompts
1. **Self-contained prompts.** A prompt never says another prompt "still applies". If a rule is wanted, it is restated. The plan's "prompt §n" citations are resolved into the new prompt or deleted.
2. **The previous session may not legislate.** A prompt written by a session must list every rule that is *not* the owner's decision, with its origin, in a "Rules I added" section at the top, so the owner can strike them. The stacked-PR §4 would have been struck.
3. **Hard budgets, with a stop rule.** Maximum PRs (for example 12), maximum subagents in flight (3), maximum reviewer sessions per item (1), and a token checkpoint: at 25% of the weekly allowance, stop, write the status note, end the turn. "Never stop to ask" is subordinate to the budget.
4. **PR model for autonomous runs:** one integration branch per release, plus per-component PRs chosen from a short list in the prompt. No merge-only PRs, no records-only PRs, no fix-per-finding PRs: a finding goes to the owner of the code and lands in that owner's PR.
5. **No PR subscriptions in autonomous runs.** Subagents own their PRs' CI. The orchestrator checks CI once per item, when the item reports.
6. **Serial heavy suites.** At most one full-suite run at a time on the shared machine; load-induced failures are re-run alone before any diagnosis starts.

### 5.2 In the plan (§7a) — proposed amendments for the owner
1. **Tier the failure process.** Full §7a.1.8 (diagnoser, reviewer, similar-case search, fixer, evaluator) only for failures that cross an ownership boundary, recur after one fix, or touch security or data. Everything else: the owning implementer fixes it red-green in its own PR with a 5-line note; one reviewer checks all such notes for the item at the end.
2. **One reviewer per item, batched,** not one per record. §7a.1.9's "review in bulk" already allows this; make it the rule for root causes too.
3. **The non-convergence note (TS-4/§7a.1.8 step 7)** by a third subagent is dropped; the reviewer writes two lines instead.
4. **A cost line in every standard.** Each TS row states what it costs per occurrence (agents, sessions, CI runs), so the owner approves the price with the rule.

### 5.3 In the environment
1. **Give the session the `workflow` scope** before a run that changes CI, or don't plan CI changes for an unattended run.
2. **Let subagents spawn subagents, or don't require "independent" reviewers from a subagent.** Today the only way a subagent gets an independent reviewer is a new cloud session, which is the most expensive option.
3. **Retire or move the v0.1 documents** under `ai/implementation/` (`plan.md`, `handoff-*.md`) that planning subagents keep rediscovering, or mark them "superseded, do not apply" at the top.

## 6. Decisions the owner needs now

1. Approve the salvage model in §4 (one integration branch, ≤8 PRs), or choose a different target shape.
2. Say whether the 97 stacked PRs are closed by the salvage session or left open until the integration PR is reviewed.
3. Decide question 56 (roles in existing sessions), since the release cannot ship with E2E-007 red.
4. Approve or strike the plan amendments in §5.2 before any further run uses §7a.
