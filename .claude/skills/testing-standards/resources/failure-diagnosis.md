# Failure diagnosis and review

Read this when a test, build, deploy or spike fails outside red/green, or when you are the diagnoser, the root-cause reviewer, the fixer, or the orchestrator of such a failure.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.8 (TS-3), which keeps the first implementation's process (`ai/prompts/implement-local-cloudflare.md` §8) and adds an attempt cap.

## Scope

This workflow applies to every failure except a test that is red on purpose during red/green: any failing test on any layer and target, and failed builds, deploys and spikes.

"Probably", "flaky" and "timing" are not causes unless evidence shows them. A failure seen only while other suites ran on the same machine is re-run alone first. If it passes alone, it is a load problem of the run: note it, don't diagnose it.

## The record

- **Path:** `ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md`.
- **Sections, in this order:** Symptom; Evidence; Causal chain, with the evidence for each link; Alternatives ruled out; Proposed fix; Verification plan; Review, which the reviewer writes.
- Until the reviewer writes its verdict, the record carries the line `Status: awaiting review`.

## Steps

1. **Diagnose.** A diagnosing subagent reproduces the failure, gathers evidence (exact output and logs, requests and responses, state, a minimal reproduction, experiments that confirm or rule out each hypothesis) and writes the record. If a link in the chain is not proven, it gathers more evidence; it never fills the gap with a guess.
2. **Review.** An independent subagent, which did not diagnose the failure or write the code, checks that the evidence supports every link, that the alternatives are ruled out, and that the fix addresses the cause, not the symptom. It writes `Verdict: accepted` or `Verdict: rejected`, with reasons. A rejected record goes back to step 1.
3. **Fix.** Only after acceptance, a subagent fixes red-green: first a test that reproduces the failure and fails, then the fix that makes it pass. It fixes the same defect where it sees it in the code it owns. Anything outside its ownership is an open item for that owner, named in the PR. The fix lands in the PR of the item that owns the code.
4. **Re-check.** The test runner and the evaluator re-run the affected tests.

## Cap

At most **3 attempts** (steps 1–4) per failure. A failure still open after 3 attempts stops: the orchestrator reports it to the owner, with the record.

## Done

You can stop reading when the failure has an accepted record and its fix has passed the re-check, or when it has stopped at the cap and has been reported.
