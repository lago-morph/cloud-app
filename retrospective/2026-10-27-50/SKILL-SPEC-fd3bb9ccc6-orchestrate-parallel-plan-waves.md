# Spec: `orchestrate-parallel-plan-waves`

- **ID**: SKILL-SPEC-fd3bb9ccc6
- **Source retrospective**: ../2026-10-27-50.md

## Intent

Turn an approved implementation plan into merged, reviewed code by running independent batches as parallel worktree agents that build against a written interface contract, with per-batch number ranges, an independent reviewer per PR, a carried-forward list of minor findings, an integrator for semantic conflicts, and a handoff note committed after every wave, so the orchestrator's own context stays small and a restarted session can resume.

## Trigger

- Direct: "you are the orchestrator for <plan>", "implement this plan with agents", "run the waves".
- Proactive: a plan file lists three or more work batches with a dependency order, and the user wants it done unattended.
- Do not use for a single-file change, or when the user wants to review each step before the next.

## Inputs

- The plan file and its work breakdown (which batches depend on which).
- ID ranges for decisions and parameters, one per batch, plus a range for fixes.
- Owner rules: secrets never printed, warn-don't-block checks, paths the session can't push.
- A scratch directory outside the repository.

## Outputs

- One branch and one PR per batch, each merged after CI and an independent review.
- `ai/implementation/handoff-<plan>.md` (status, carried-forward findings, how to verify) and `ai/implementation/owner-questions.md` (each choice made in the owner's absence: question, choice, how to reverse it), on their own branch and PR, merged last.
- A clean-clone `npm run verify` result after each wave.

## Workflow

1. Read the plan; group the batches into waves by dependency. Anything with no dependency starts at once, even if the plan lists it later.
2. Write three scratch files: `common-brief.md` (branch naming, commit trailers, checks to run, owner rules, a ≤10-line report format), `wave-N-interfaces.md` (the exact exported names and signatures each batch provides; batches must not import each other, they take values as parameters), and `review-brief.md` (verdict MERGE / FIX FIRST; findings tagged blocker/major/minor with file:line and a failure scenario).
3. Launch every batch of the wave in ONE message, each with `isolation: "worktree"`, its plan sections, its ID range and the interface file.
4. When a batch reports, check its claims that matter (for example `git diff | grep -c` for the secrets), open the PR, and launch an independent reviewer with the review brief plus batch-specific attention points.
5. On FIX FIRST: send the findings to the ORIGINAL implementer with SendMessage, red-green required, then to the SAME reviewer for a check of the fix commits only.
6. Put minors that don't gate the merge into a numbered `minor-findings.md` and assign them to the next batch touching those files; pass the numbered list to that batch's reviewer, so claimed fixes are checked item by item.
7. Merge PRs in dependency order. On an append-only register conflict (decision log, parameters), resolve in a scratch clone by keeping both sides, run build, typecheck, lint and unit, then push the merge commit.
8. When two open PRs touch the same module, merge them locally and run the unit tests BEFORE merging either; if they conflict in meaning, make one agent the integrator and land them as one PR.
9. After each wave, run the full verify in a fresh clone outside `.claude/worktrees` (Playwright refuses to load twice under the worktree), then update and push the handoff note.
10. Defects found by tests or live runs: diagnosis, an independent review of the diagnosis, then a red-green fix. Never weaken a test unless the spec removed the clause.
11. After a container restart: list `.claude/worktrees/*` for unpushed commits, push them, and resume each agent with SendMessage.

## Concrete examples

**Example 1: wave 1 of plan-setup-wizard.** Batches b1 (permissions.ts), b2 (token-sources.ts, git-safety.ts) and b3 (setup-record.ts, setup-steps.ts) launched in one message with `wave1-interfaces.md`. b3 was told to take `expectedVersion` as a parameter because `ACCOUNT_SETUP_VERSION` lived in b1's not-yet-merged module. b5 (the starter) had no dependency and started at the same time. The reviews returned MERGE for #32 and #34 and FIX FIRST for #33: the parser kept the template's `(…)` hint as a value, so a user who uncommented the account line got a bogus account ID. The fix and a re-review took about 10 minutes.

**Example 2: semantic conflict.** #39 added a test "a dangling symlinked .env.cloudflare is written through by fillInSettings"; #40 made `fillInSettings` return `[]` when the file is missing (SETUP-AC-002). Each PR was green on its own. Merged locally: `AssertionError: expected [] to deeply equal ['CLOUDFLARE_EMAIL_DOMAIN']`. The fix-round agent became the integrator, rewrote the test to exercise write-through with `writeTemplateIfAbsent`, and #42 landed both.

## Anti-patterns

- Running wave 2 only after wave 1 merges when a wave-2 batch doesn't depend on wave 1. It wastes the wall-clock time parallelism buys.
- Trusting "items 1–12 fixed": two of twelve weren't. Give the reviewer the list.
- Running `cd` into an agent worktree from the orchestrator's shell: later commands run there, and stop hooks flag the agent's files.
- Delegating merge-conflict resolution of append-only registers to a new agent: it's mechanical, so do it yourself in a scratch clone.
- Letting an agent's DEC numbers drift outside its range: ranges are the only thing that prevents ID collisions across parallel branches.

## Acceptance criteria

- Every PR has a CI run on its final head and a review verdict of MERGE before merging.
- No two branches use the same DEC or PAR number.
- The handoff note on its branch is current after every wave and is the last commit merged.
- A full verify in a clean clone passes on the final `main`.
- Every owner-level choice appears in `owner-questions.md` with how to reverse it.

## Files this skill creates / modifies

- `<scratch>/common-brief.md`, `wave-N-interfaces.md`, `review-brief.md`, `minor-findings.md`: orchestration state, never committed.
- `ai/implementation/handoff-<plan>.md`: the resumable status note.
- `ai/implementation/owner-questions.md`: choices pending the owner's review.
