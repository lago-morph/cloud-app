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
Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed this failure nor wrote the runner or the tests), 2026-11-08, on `e398cd8` in a separate worktree. Following the owner's rule, I ran only the `scripts/live-pass` unit tests, in the foreground: 121 passed and 4 failed, which are exactly the four red reproductions of the two 2026-11-08 records. No fix is applied yet. The test changes in `d0b72fe` are additions. The lines it removes are imports, the frameworkCalls entry (rewritten to add `tokenEnv`) and the fake world's role list, which now spreads the roles over four pages. No once-green assertion was weakened.

**Verdict: accepted.**
1. Reproduced: `names the runbook section that holds the analysis and the cleanup` fails with `expected 'What the run checks' to match /analysis/i`.
2. Every link is supported:
   - E1: `live-pass.mjs:295` says "the runbook's section 4".
   - E2: the headings are `## 3. After the run: analysis and cleanup` and `## 4. What the run checks`.
   - E3: the agent section's exit 0 rule says to relay the closing text word for word.
   - Link 1 checks out: before `b85ba1a` the runbook's section 4 was "Session 2 … and the hand-over", and its steps 11–12 held the analysis hand-over. The renumbering for DEC-0793 moved that to section 3, and `finishText` kept "4".
3. The alternatives are ruled out. `live-pass-analysis.md` section 4 is "Clean up", and the test reads the headings at run time.
4. The fix addresses the cause.
5. Minor, for the fixer: the new test covers only the "runbook's section N" form inside `finishText`. The other references are written "runbook section N, step M" (`lib/cloudflare.mjs:142`, `lib/steps.mjs:219`; both are correct, section 1 steps 2 and 3) and C-1's message (see the other record). The proposed "check the other references" is worth doing as a test over every such reference in `scripts/live-pass/**`.

## Fix

Author: the runner's implementer for PR #171 (DEC-0793), who neither diagnosed this failure nor reviewed it. Date: 2026-11-08. Red-green: the reproduction test "names the runbook section that holds the analysis and the cleanup" (`run.unit.test.ts`) is unchanged, and was red before the fix and green after it.

### What changed
- **`live-pass.mjs`, `finishText`:** it now says `the runbook's section 3 ("After the run: analysis and cleanup")`.
- **Every runbook reference in the runner's text** (`live-pass.mjs`, `lib/cloudflare.mjs`, `lib/steps.mjs`) has one checkable form:
  - `the runbook's section N ("Heading")`, or `the runbook's section "Heading"` for an unnumbered section;
  - optionally followed by `, step M`.
- **New test `scripts/live-pass/runbook-refs.unit.test.ts`**, red before the fix with 4 references in other forms. It reads every printed line of the runner's sources and the runbook's headings and numbered steps at run time, and checks that:
  - no reference is in another form;
  - each named section exists with that number and heading;
  - each named step exists in that section;
  - the closing text names the analysis section.
- C-1's "runbook section 5" message is gone (see `2026-11-08-live-pass-lost-starter-token.md`).

### Verification
`npx vitest run --config vitest.unit.config.ts scripts/live-pass`: 12 files, 140 tests, all pass.

### Open item
CI's path map (`scripts/ci/path-map.json`) does not list `ai/implementation/live-pass-v0.2.0.md` as read by a test. So a runbook-only change does not run `run.unit.test.ts` or `runbook-refs.unit.test.ts`. Adding a `testInputs` entry touches `scripts/ci/`, so it is left to the orchestrator.
