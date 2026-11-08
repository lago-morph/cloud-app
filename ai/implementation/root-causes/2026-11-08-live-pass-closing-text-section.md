# Root cause: the live pass's closing text sends the owner to the runbook's section 4 for the analysis

Author: the independent test author and evaluator of PR #171 (branch `v0.2.0/live-pass-agent-driven`, DEC-0793). I did not write the runner. Local only.

## Symptom
New test `scripts/live-pass/run.unit.test.ts`, "the runner's closing text › names the runbook section that holds the analysis and the cleanup", fails at 2a88c8c with my test changes:
```
AssertionError: the closing text names the runbook's section 4: expected 'What the run checks' to match /analysis/i
```

## Evidence
- E1. `scripts/live-pass/live-pass.mjs`, `finishText`: "To have them done, start the analysis session as the runbook's section 4 says and give it these lines and that token."
- E2. `ai/implementation/live-pass-v0.2.0.md` headings: `## 3. After the run: analysis and cleanup`, `## 4. What the run checks`. The runbook's own section 1 says "start an analysis session (section 3)".
- E3. The runbook ("For the agent in the session", step 3, exit 0) tells the agent to relay the closing text to the owner word for word. So the owner is pointed to a section that holds no instructions for the analysis session.
- E4. The same offline run, before this change, already printed this text (`run.unit.test.ts`'s finish assertions). None of them checked the reference.

## Causal chain
1. The runbook was renumbered for DEC-0793; the analysis became section 3 (E2).
2. `finishText` kept "section 4" (E1).
3. The agent relays it word for word, so the owner reads the wrong section at the end of the pass (E3).

## Alternatives ruled out
- "Section 4" meant the analysis guide `live-pass-analysis.md`: the text says "the runbook's section 4", and that guide's own section 4 is the cleanup, not how to start the session.
- A test wording problem: the assertion reads the runbook's headings at test time, so it follows any future renumbering.

## Proposed fix
In `finishText`, name section 3 (or say "the runbook's section "After the run: analysis and cleanup""). The same review should check the other runbook references in the runner's texts. C-1's "runbook section 5" is wrong too; it is in `2026-11-08-live-pass-lost-starter-token.md`, E7.

## Verification plan
The failing test passes; the rest of `scripts/live-pass` stays green.

## Review
Status: awaiting review
