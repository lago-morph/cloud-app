# Failure diagnosis and review

Read this when a test, build, deploy or spike fails outside red/green, or when you are the diagnoser, the root-cause reviewer, the similar-case searcher, the fixer, or the orchestrator of such a failure.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.8 (TS-3, TS-4, TS-5, TS-20).

## Scope

This workflow applies to every failure except a test that is red on purpose during red/green. It covers:
- unit regressions;
- every integration and e2e failure, on any target;
- failed builds, deploys and spikes.

"Probably", "flaky" and "timing" are not causes unless evidence shows them.

## The record

- **Path:** `ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md`.
- **Sections, in this order:**
  1. Symptom
  2. Evidence
  3. Causal chain, with the evidence for each link
  4. Alternatives ruled out
  5. Proposed fix
  6. Verification plan
  7. Review, which the reviewer writes
- Until the reviewer writes its verdict, the record carries the line `Status: awaiting review`.
- Later sections are added as the steps below need them: `Response (round n)`, `Similar cases`, `Attempt n`, and `Non-convergence note`.

## Steps

An attempt is steps 1 to 6. Each step is done by its own subagent.

1. **Diagnose.** The diagnoser:
   - reproduces the failure;
   - gathers evidence:
     - the exact output and logs;
     - the requests and responses;
     - the state;
     - a debugger session, for example `node inspect`, or Vitest `--inspect-brk` driven from the command line;
     - variations of the test that confirm or rule out each hypothesis;
     - a minimal reproduction;
   - writes the record.

   If a link in the chain is not proven, the diagnoser gathers more evidence. It never fills the gap with a guess.
2. **Review.** The root-cause reviewer has not diagnosed this failure and did not write the code. It:
   - first decides whether the evidence supports every link and rules out the alternatives;
   - only if it does, evaluates the fix: the fix must address the cause, not the symptom;
   - reproduces the failure once, plus one experiment for each hypothesis it doubts (test economy rule 8, `ai/implementation/plan.md` §1).

   Its verdict is one of:
   - `accepted`;
   - `accepted-with-changes`, which binds the fixer;
   - `rejected`.

   Each of its reasons is marked **major** or **minor**.
3. **Respond.** On `rejected`, or on any major issue, the diagnoser answers each major issue point by point, in a `Response (round n)` section. Each answer is one of:
   - more evidence;
   - a corrected chain;
   - a revised fix;
   - a rebuttal with evidence.

   The diagnoser also fixes or answers each minor issue in the same section. The record then goes back to step 2.
4. **Similar cases.** After acceptance and before the fix, a subagent searches for the same defect pattern elsewhere: other call sites, other components that make the same assumption, and the other target.
   - It lists what it found, with evidence, in the record's `Similar cases` section.
   - It adds a failing test for each case it found.
   - A case outside the fixing item's owned paths becomes a new item. It is not fixed silently (`ai/implementation/plan.md` §1, ownership).
5. **Fix.** A fixer subagent fixes red-green:
   - the reproduction test and the similar-case tests fail first, then pass;
   - it follows the accepted record as amended by its Review.
6. **Re-check.** The test runner and the evaluator re-run the affected tests. The evaluator checks that the record's Review verdict came before the fix commit.

## Attempts and non-convergence

- A failed re-check starts a new attempt at step 1, in the same record, under its own `Attempt n` section.
- There are at most **3 attempts** per failure, and at most **3 review rounds** per attempt.
- A failure that needed a second attempt or a second review round gets a short `Non-convergence note`:
  - a subagent other than the diagnoser and the reviewer writes it;
  - it says why the first try did not succeed;
  - if it shows that the standards or this skill were not specific enough, the orchestrator has the skill changed. That change goes through the skill review (`SKILL.md`, rule 10).
- A failure still open after 3 attempts or 3 review rounds stops. The orchestrator reports it to the owner, with the record and the notes.

## Done

You can stop reading when the failure has an accepted record, its fix has passed the re-check, and every similar case is either tested and fixed or recorded as a new item. You can also stop when the failure has stopped under the limits above and has been reported.
