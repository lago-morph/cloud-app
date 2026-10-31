# ADR: Autonomous implementation runs deliver stacked, unmerged pull requests

- **ID**: ADR-7cdd316489
- **Status**: Draft (not yet adopted to docs/adr/)
- **Date**: 2026-10-31
- **Source retrospective**: ../2026-10-31-57.md
- **PRs covered**: #57 (the plan the run implements). The convention itself is set by the v0.2.0 implementation prompt written in this session.

## Context

The owner asked for a prompt to implement v0.2.0 overnight. It had to run with no owner input, and its output had to be stacked pull requests small enough to review.

The earlier implementation prompt (`ai/prompts/implement-local-cloudflare.md`) worked differently:
- one feature branch and one pull request per phase;
- merges into that branch as items finished;
- a stop to ask the owner when blocked.

A whole phase in one PR can't be reviewed in one sitting. A run that stops to ask wastes a night.

v0.2.0 adds three things to that:
- a large removal (about 3,700 source and 3,200 unit-test lines);
- several independent items (auth app, framework provider, bootstrap, admin app, spec, CI and hooks);
- a review rule (plan §7a.1.9) under which every change to a once-green test needs an independent review, grouped by reason.

## Decision

An unattended implementation run delivers its work as small stacked pull requests, one concern each and based on the branch they depend on, which it never merges and only ever updates by merging a changed lower branch upward, never by rebasing or force-pushing.

**The rules:**
- **Size:** about 400 changed lines at most, not counting lockfiles, generated files and pure deletions.
- **Removals:** separate PRs, containing only deletions plus their test-change review record.
- **Base:** the branch of the PR the work depends on, or `main`. Independent plan items get independent stacks.
- **Branch names:** `v0.2.0/<nn>-<slug>`, with `<nn>` the merge order.
- **Descriptions:** each PR states:
  - its stack position and base;
  - what to review and what to skim;
  - the plan sections it implements;
  - its test impact;
  - its decisions;
  - what's left open.
- **The index:** `ai/implementation/v0.2.0-pr-stack.md` lists every PR in merge order.
- **The run never merges and never pushes to `main`.** The owner merges bottom-up; GitHub retargets an upper PR when its base branch is merged and deleted.
- **Undecided points** become `ai-proposed` decisions, logged with how to reverse them. They never block the run.

## Alternatives considered

- **One feature branch and one PR per phase** (the first implementation's convention): rejected. It can't be reviewed in one sitting, and a single wrong decision makes the whole PR suspect.
- **Independent PRs, all based on `main`:** rejected. Dependent items would duplicate code or fail CI until their dependencies merge.
- **Rebasing the stack when a lower PR changes:** rejected. Force-pushes break review comments and anyone's checkout. Merging upward keeps history and threads intact, at the cost of merge commits.
- **Letting the run merge green PRs:** rejected. Merging needs the owner's own ask, and green CI doesn't amount to review.

## Consequences

- **Easier:** the owner can review one concern at a time, in any stack order. Removals are easy to approve as a group. A rejected decision touches one PR and the PRs above it.
- **Harder:** the run must keep the index and the progress file current. Merge-up commits make upper PRs' histories noisier. A long stack can't merge until every PR under it is approved.
- **Accepted:** CI runs on every PR in a stack (`ci.yml` triggers on `pull_request` for any base), so a deep stack costs CI minutes. And until wave 0's CI restructuring lands, every PR runs the full `verify` job.

## References

- [`../2026-10-31-57.md`](../2026-10-31-57.md): the source retrospective (Phase 5).
- [`./SKILL-SPEC-0ea82c623f-verify-plan-claims.md`](./SKILL-SPEC-0ea82c623f-verify-plan-claims.md): the claim check that should run before such a plan is handed off.
- `ai/implementation/plan-v0.2.0-testing-auth.md` §9 (work breakdown) and §7a.1.9 (once-green test changes).
- `ai/prompts/implement-local-cloudflare.md` §1 and §5 (the earlier convention).
- PR #57.
