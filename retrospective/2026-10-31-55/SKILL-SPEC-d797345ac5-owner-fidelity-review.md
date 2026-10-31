# Spec: `owner-fidelity-review`

- **ID**: SKILL-SPEC-d797345ac5
- **Source retrospective**: ../2026-10-31-55.md

## Intent

Before a spec, plan or standard drafted from an owner conversation goes back to the owner, have an independent subagent check it against the owner's own words, quoted verbatim, for omissions, distortions and inventions. In this session that review caught three major defects that would otherwise have reached the owner. The owner's later review still found the same kinds of defect, because no check ran on the second revision.

## Trigger

- **Direct:** "check this against what I said", "did you capture everything", "review the spec before I read it".
- **Proactive:** run it every time, before handing the owner any document written from their instructions: a spec, a plan addendum, a standards text or a decision table. Run it again on every revision made from the owner's review comments, before reporting the revision as done.
- **Negative:** don't run it for documents with no owner instructions behind them (pure research reports, code), or for a one-line change the owner dictated word for word.

## Inputs

- The path of the document under review.
- The owner's messages that the document is built from, **verbatim**, in order, each labelled with its position (MESSAGE 1, MESSAGE 2, …). Where a message answers questions the agent asked, add one line of context per question label (for example "D7 = mocks in integration tests"). That context is the only thing not verbatim.
- The repository files that the document cites as existing practice, so the reviewer can tell a cited practice from an invention.
- Any standing owner rules that limit sources (in this repository, for example: nothing under `retrospective/` may be used).

## Outputs

- A findings list from the reviewer, each finding with:
  - a severity (major or minor);
  - the document section;
  - the owner quote it relates to;
  - what's wrong;
  - a concrete rewording.
- A one-line verdict.
- The revised document, with every major finding applied and every minor one applied or answered.
- A line in the document's header saying a fidelity review ran, and on which revision.

## Workflow

1. **Collect the owner's words.** Copy every owner message the document depends on, verbatim, into the brief. Later messages override earlier ones; say so in the brief. Never paraphrase. A paraphrase is exactly where the distortion the review hunts for comes from.
2. **Write the brief.** Give the reviewer:
   - the document path;
   - the messages;
   - the cited sources;
   - this checklist:
     - (1) **omissions:** an owner instruction that is missing or weakened;
     - (2) **distortions:** a statement that changes an instruction's meaning;
     - (3) **inventions:** a normative rule, mechanism, number or limit that the owner didn't ask for and that isn't a cited existing practice. Separate a minimal mechanism needed to carry out an instruction (fine, but marked as such) from an invented requirement (flag it). Flag any invented number, and pay special attention when the owner has said not to encode numbers.
     - (4) **citations:** spot-check the repo facts the document cites;
     - (5) **scope:** a statement that applies to only part of the system but is written as universal.

   Make the reviewer read-only, with a word budget for its answer (about 700 words).
3. **Run it independent of the author.** Start a fresh subagent: not a fork of the author's context, and not the subagent that drafted the document. Run it in parallel with any other review of the same document, for example a factual review of one section, to save wall-clock time.
4. **Triage the findings.** Apply every major finding. Apply a minor one unless it conflicts with a later owner instruction; in that case the owner's words win, and the conflict is reported to the owner in one line.
5. **Revise only what the findings and the owner's comments touch.** Don't take the chance to re-open parts the owner has already reviewed without objection. They stand.
6. **Repeat for each revision.** When the owner returns review comments, apply them, then run steps 1–4 again on the revision. Add the new owner message to the brief.
7. **Report.** Tell the owner in plain words what the review changed. Never hand over a bare list of identifiers: say what each one means.

## Concrete examples

**Example 1: first draft of the v0.2.0 testing-standards addendum.**
- **Input:** the draft `ai/implementation/plan-v0.2.0-testing.md` and four owner messages, quoted verbatim, including "D7 you are taking something I said in passing, once, and misinterpreting it and inventing new requirements."
- **The reviewer's major findings:**
  - Marking the existing e2e scenarios as owner-reviewed would lock them under CONVENTIONS §4 ("only the owner may change `owner-approved`"). That contradicts "E2E tests should be allowed to be expanded without my review".
  - The retrospective ban covered only files named `SKILL-SPEC-*`, `ADR-*` and `AGENTS-MD-*`, but retrospective reports copy the same rules inline.
  - The three-round limit applied to review rounds only. A fix that failed its re-check had no path, although the owner had asked "why it didn't get fixed after one retry".
- **It also flagged inventions:** a parameter per fuzz target, and a lint that scans tests for the paths they read.
- **Output:** all were applied before the owner saw the draft.

**Example 2: the revision after the owner's first review (the review that did not run).**
- **Input:** the owner's comments, among them "Don't do both, run in Claude pre commit hook" and "Hooks are only to be run against changes in this repo".
- **What happened without the skill:**
  - **Inventions reached the owner:** the agent's reply proposed a new rule that agents commit only with `git`, which the owner rejected: "I did not ask for that and I do not want it."
  - **Over-correction:** the agent then offered to move already-accepted draft content into a "recommendations" list. The owner: "I did not ask you to revert decisions I've already made."
- **What step 2(3) and step 5 would have done:** caught both before the owner saw them.

## Anti-patterns

- **Paraphrasing the owner** in the brief ("the owner wants linting in hooks"). The paraphrase hides the very misreading the review exists to catch, as with "lint in Claude, not git".
- **A forked reviewer.** A fork shares the author's reading of the conversation, so it confirms the author's interpretation.
- **Reviewing only the first draft.** Revisions made in response to the owner's comments are where new inventions slip in.
- **Re-opening what the owner has reviewed** while applying findings.
- **Reporting findings as identifiers**, for example "needs SYS-REQ-018/019/027 amendments", without saying what they mean. The owner: "I will not go back and cross reference all of those things to understand your comment."

## Acceptance criteria

1. The brief contains every relevant owner message verbatim, and nothing paraphrased except the labelled one-line context per question.
2. The reviewer is a fresh, read-only subagent that didn't draft the document.
3. Every major finding is applied, or answered with an owner quote that overrides it.
4. Each revision sent to the owner had its own fidelity review.
5. The report to the owner explains every finding in plain words.

## Files this skill creates / modifies

- The document under review: revised in place.
- The document's header: one line recording that a fidelity review ran, and on which revision.
- No other files. The review's findings live in the reviewer's reply, not in the repository.
