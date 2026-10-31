# Diagnosing a failure

Read this when a test, `verify`, an e2e run, a build, a deploy or a smoke test fails, other than a test that is red on purpose during red/green, or when you are asked to diagnose, review or fix such a failure.

"Probably", "flaky" and "timing" are not causes without evidence. Never change a test or the code to make the failure go away before its cause is reviewed.

## Who does what

Each role is its own subagent. None of them wrote the code that failed, and the reviewer never reviews a cause it found itself. The main session briefs them with file paths, not file contents, and they answer with short summaries; the details go in the record.

## The record

One record per failure, in the app's repository: `test-records/root-causes/<yyyy-mm-dd>-<slug>.md`. Its sections, in this order:

1. **Symptom**: the exact command and output.
2. **Evidence**: logs (`.logs/`, or the stage's log entry for the `requestId`, [troubleshooting.md](../troubleshooting.md)), requests and responses, state, variations of the test that confirm or rule out each hypothesis, and a minimal reproduction.
3. **Causal chain**, with the evidence for each link.
4. **Alternatives ruled out.**
5. **Proposed fix.**
6. **Verification plan.**
7. **Review**, which the reviewer writes. Until then the record says `Status: awaiting review`.

An unproven link means more evidence, never a guess.

## Steps

1. **Diagnose.** The diagnoser reproduces the failure, gathers the evidence and writes the record.
2. **Review.** The reviewer checks that the evidence supports every link, that the alternatives are ruled out, and that the fix addresses the cause, not the symptom. Its verdict is `accepted` or `rejected`, with reasons. A rejected record goes back to step 1.
3. **Fix, red then green.** A fixer adds the reproduction test, sees it fail, then fixes the code as the accepted record says, and sees it pass. Where the same defect is plainly in other code it is changing, it fixes and tests that too.
4. **Re-check.** A subagent that changed nothing re-runs the affected tests and `npm run verify`, and checks that no test was skipped or weakened. Its verdict is the only pass.

## Limits

- At most **3 attempts** (steps 1–4) per failure.
- Still open after 3 attempts: stop and tell the user, in plain words, what fails, what was tried, and the record's path.
- A suspected framework defect goes to `FRAMEWORK-ISSUE.md` (`SKILL.md` hard rules 6 and 7), with the record as its evidence.

## Examples

- [examples/tests.md](../../examples/tests.md): the tests a reproduction test is added beside.

## Stopping condition

Stop reading when the failure has an accepted record and its fix passed the re-check, or when it stopped at the limits and you told the user.
