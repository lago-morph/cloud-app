# Diagnosing a failure

Read this when a test, `verify`, an e2e run, a build, a deploy or a smoke test fails, other than a test that is red on purpose during red/green, or when you are asked to diagnose, review or fix such a failure.

"Probably", "flaky" and "timing" are not causes without evidence. Never change a test or the code to make the failure go away before its cause is reviewed.

## Who does what

Each role is its own subagent. None of them wrote the code that failed, and the reviewer never reviews a cause it found itself. The main session briefs them with file paths, not file contents, and they answer with short summaries; the details go in the record.

## The record

One record per failure, in the app's repository: `test-records/root-causes/<yyyy-mm-dd>-<slug>.md`. Its sections, in this order:

1. **Symptom**: the exact command and output.
2. **Evidence**: logs (`.logs/`, or the stage's log entry for the `requestId`, [troubleshooting.md](../troubleshooting.md)), requests and responses, state, a debugger session (`node inspect`, or Vitest `--inspect-brk`), variations of the test that confirm or rule out each hypothesis, and a minimal reproduction.
3. **Causal chain**, with the evidence for each link.
4. **Alternatives ruled out.**
5. **Proposed fix.**
6. **Verification plan.**
7. **Review**, which the reviewer writes. Until then the record says `Status: awaiting review`.

An unproven link means more evidence, never a guess.

## Steps

1. **Diagnose.** The diagnoser reproduces the failure, gathers the evidence and writes the record.
2. **Review.** The reviewer first decides whether the evidence supports every link and rules out the alternatives; only then does it judge the fix (the cause, not the symptom). It reproduces once, plus one experiment per hypothesis it doubts. Its verdict is `accepted`, `accepted-with-changes` (binding on the fixer) or `rejected`, with each reason marked **major** or **minor**.
3. **Respond.** On `rejected` or any major reason, the diagnoser answers each one point by point in a `Response (round n)` section (more evidence, a corrected chain, a revised fix, or a rebuttal with evidence), and the record goes back to step 2.
4. **Similar cases.** After acceptance and before the fix, a subagent searches the app for the same pattern: other routes, other call sites, the other SQL dialect, local versus cloud. It lists what it found in a `Similar cases` section and adds a failing test for each.
5. **Fix, red then green.** A fixer adds the reproduction test (and the similar-case tests), sees them fail, then fixes the code as the accepted record says, and sees them pass.
6. **Re-check.** Run the affected tests and `npm run verify` again. The record's Review must be dated before the fix.

## Limits

- At most **3 attempts** (steps 1–6) per failure, and **3 review rounds** per attempt. A failed re-check starts the next attempt in the same record.
- A failure that needed a second attempt or round gets a short `Non-convergence note`, written by another subagent: why the first try failed.
- Still open after the limits: stop and tell the user, in plain words, what fails, what was tried, and the record's path.
- A suspected framework defect goes to `FRAMEWORK-ISSUE.md` (`SKILL.md` hard rules 6 and 7), with the record as its evidence.

## Examples

- [examples/tests.md](../../examples/tests.md): the tests a reproduction test is added beside.

## Stopping condition

Stop reading when the failure has an accepted record, its fix passed the re-check, and every similar case is tested and fixed; or when it stopped at the limits and you told the user.
