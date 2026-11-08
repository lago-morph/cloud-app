# Root cause: after a lost container, S4 runs the bootstrap without its starter token and S5 records an owner skip

Author: the independent test author and evaluator of PR #171 (branch `v0.2.0/live-pass-agent-driven`, DEC-0793). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New tests in `scripts/live-pass/resume.unit.test.ts`, describe "a starter token pasted in a container that is lost during its bootstrap", fail on the branch at 2a88c8c with my test changes:
```
× does not run the bootstrap without a starter token
  expected [ { cmd: 'cloudflare-setup', …(4) } ] to deeply equal []
× asks for the S4 starter token again: the framework's link and the file to save it as
  expected 'CLOUDFLARE_API_TOKEN is not a valid t…' to contain 'https://dash.cloudflare.com/?to=/:acc…'
× does not record S5 as skipped by the owner when the owner pasted its token
  {"result":"n/a",…,"reason":"the owner skipped the second starter token"}: expected … not to match /skipped/i
```
The runbook (section 1, "If something goes wrong") promises: "The runner continues where it stopped … A starter token you pasted in the lost container may be asked for again." Neither happens for S4 or S5.

## Evidence
- E1. The test. The owner pastes the S4 starter token, the agent saves it and runs `answer saved`. The stand-in framework kills the runner (SIGKILL to its parent) at the start of S4's `cloudflare-setup` with that token: the container is lost in the middle of the bootstrap. A new container gets the owner's first message only, then `resume`.
- E2. `resume`'s output (transcript in the test run):
  ```
  $ live-pass resume → 1
  CLOUDFLARE_API_TOKEN is not a valid token
  === BLOCKED at S4: Bootstrap with the starter token ===
  the bootstrap printed no admin app URL and the test Cloudflare account has no workers.dev subdomain
  ```
  The framework was called with neither `CLOUDFLARE_BOOTSTRAP_TOKEN` nor `CLOUDFLARE_API_TOKEN` (`frameworkCalls` entry with `tokens: []`). The message names no starter token, no link and no file; it tells the agent to "retry once it is fixed". A plain `retry` cannot succeed, because the token is still missing.
- E3. `scripts/live-pass/lib/steps.mjs`, S4 `run`: `const value = ctx.secretValue(SECRET.starter);`, then `ctx.fw(["cloudflare-setup"], { set: { CLOUDFLARE_BOOTSTRAP_TOKEN: value } … })` with no check that `value` exists. `childEnv` (`lib/exec.mjs`) deletes a variable that is set to `undefined`, so the command runs without one.
- E4. `lib/engine.mjs`, `runStep`: the pending step is saved only after `step.run` returns (`setPending({ ...pending(), ran: true }); await save(...)`). A container lost during S4's `run` leaves C-1 recorded and S4 not started, so `resume` runs S4 afresh. C-1, the only step that checks the value, is not run again.
- E5. Same for S5. The stand-in kills the runner during S5's bootstrap, then `resume` in a new container. `steps.mjs` S5 `run`: `if (!value) { ctx.na("the owner skipped the second starter token"); return; }`. The stored state then has `done.S5 = { result: "n/a", reason: "the owner skipped the second starter token" }`, although the owner's TOK-S5 reply in the records is "saved".
- E6. The secrets directory of a new container holds only what the agent saves from the owner's first message (runbook "For the agent in the session", step 1; `lib/secrets.mjs`). So a starter token pasted in the lost container is always missing after `resume`.
- E7. C-1's own message for a missing value (`steps.mjs` C-1 `run`) says "Ask the owner for it again (runbook section 5)". It has no link, and runbook section 5 is "Cost and cleanup"; "If something goes wrong" is in section 1.

## Causal chain
1. A new container has only the account ID and the owner's token (E6).
2. A loss during a step's `run` re-runs that step from the start after `resume` (E4).
3. S4 reads the missing value and runs the bootstrap without it (E3). The step blocks with a reason that is about the framework's output, not the missing token (E2). No owner prompt or blocked message gives the owner the framework's link to make a new one.
4. S5 treats a missing value as the owner's skip (E5), so the records say the owner skipped a token they pasted, and the analyst reads S5 as not run by choice.

## Alternatives ruled out
- The stand-in framework's kill: it only ends the runner process. The state that `resume` loads is the one the runner itself saved before S4 started (E4), the same as a reclaimed container would leave.
- The real framework might answer differently without a token. That changes only the wording of E2's first line. The runner still calls it without the starter token, and still gives no way to supply a new one (E3).
- The agent could have saved the value again: in a new Claude session the pasted value is no longer in the chat (runbook section 1), so only the owner can make a new token, and nothing asks them to.

## Proposed fix
In `lib/steps.mjs`, for each starter token (S4, S5): tell "pasted, then lost" apart from "skipped". For example, the TOK step's `verify` records `facts.starterSkipped[name]` on `skip`. When the value is missing and was not skipped, the step asks for it again before it runs anything. Either an owner prompt in the DEC-0793 form: the framework's `BOOTSTRAP_LINK`, one to three sentences, "paste the value", `saveAs` the same file. Or, for S4 (blocking), a BLOCKED message that gives that link and the file and says to `retry` after saving. S5 records n/a with the owner's skip only when the owner replied `skip`. Correct C-1's section reference (section 1, "If something goes wrong") and give it the link too.

## Verification plan
- The four tests of the new describe in `resume.unit.test.ts` pass. The S4 tests check that the framework is never called without a starter token, and that the output holds `BOOTSTRAP_LINK` and the `LIVE_PASS_STARTER` file name. One test checks that the run goes on to TOK-S5 with a new token, another that S5 is not recorded as an owner skip.
- The rest of `scripts/live-pass` stays green: `npx vitest run --config vitest.unit.config.ts scripts/live-pass`.

## Review
Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed this failure nor wrote the runner or the tests), 2026-11-08, on `e398cd8` in a separate worktree. Following the owner's rule, I ran only the `scripts/live-pass` unit tests, in the foreground: 121 passed and 4 failed, which are exactly the four red reproductions of the two 2026-11-08 records. No fix is applied yet. The test changes in `d0b72fe` are additions. The lines it removes are imports, the frameworkCalls entry (rewritten to add `tokenEnv`) and the fake world's role list, which now spreads the roles over four pages. No once-green assertion was weakened.

**Verdict: accepted.**
1. Reproduced: the three quoted tests fail as stated. The describe's fourth test ("goes on with the new starter token") passes before the fix, so it is not yet a reproduction.
2. Every link is supported by the code:
   - E3: S4's `run` reads `secretValue(SECRET.starter)` with no check, and `childEnv` deletes a `set` entry whose value is `undefined`.
   - E4: `runStep` saves `ran: true` only after `step.run` returns, so a loss during S4 resumes S4 from the start, after C-1 is already recorded.
   - E5: S5's `run` treats a missing value as "the owner skipped", and the TOK-S5 `skip` branch of `starterTokenPart` records only an observation, so S5 cannot tell the two apart.
   - E6: the secrets directory is `~/.live-pass-secrets` (`lib/secrets.mjs`), which is lost with the container.
   - E7: `steps.mjs:326` says "runbook section 5", which is "Cost and cleanup"; "If something goes wrong" is under section 1.
3. The alternatives are ruled out: the stand-in only kills the runner, and the state that `resume` loads is the runner's own.
4. The fix addresses the cause, not the symptom. It separates "pasted, then lost" from "skipped" with a recorded skip fact, and it asks again, with `BOOTSTRAP_LINK` and the `saveAs` file, before anything runs.
5. Minor, for the fixer:
   - (a) A re-asked S4 token bypasses C-1's expiry check (at most 1 day), which the framework enforces. The re-ask, or S4 itself, should apply the same check to the new value.
   - (b) A loss after the bootstrap has finished but before `run` returns leaves the starter token deleted and the clients made. S4 would then run as a re-run and record "OAuth clients: created" as failed. Record that case plainly, or note it as an open item; it is a separate state from this defect.
   - (c) Make the fourth test of the describe red before the fix, or say why it is green.

## Fix

Author: the runner's implementer for PR #171 (DEC-0793), who neither diagnosed this failure nor reviewed it. Date: 2026-11-08. Red-green: the four reproduction tests in `scripts/live-pass/resume.unit.test.ts` ("a starter token pasted in a container that is lost during its bootstrap") are unchanged. Three of them were red before the fix and are green after it. The fourth is discussed under point (c) below.

### What changed
- **The engine can go back to an earlier step.**
  - `lib/engine.mjs` has a new `RewindRequest` (thrown by a step's run), and `lib/checkpoint.mjs` a new `rewind`.
  - The engine forgets the named steps' results, keeps the attempt as a step record with result `restarted` and its reason, and goes on from the first of those steps.
  - Unit tests in `engine.unit.test.ts` and `checkpoint.unit.test.ts` were red first.
- **S4** (`lib/steps.mjs`) never calls the framework without a starter token.
  - If the token is missing, or C-1's 1-day check fails for it, S4 goes back to `TOK-S4` and `C-1`. The owner then gets the starter token's prompt again: one link, pre-filled for the test Cloudflare account, and the file to save the value as. The new value then goes through C-1 again (the reviewer's note (a)).
- **C-1** goes back to `TOK-S4` with the reason, instead of blocking, when the token is missing or has more than 1 day left. The wrong "runbook section 5" message is gone.
- **S5** records "n/a, the owner skipped" only when the owner replied `skip` to TOK-S5. The new fact is `facts.starterSkipped`. A missing or unusable token goes back to `TOK-S5`.
- **The reviewer's note (b):**
  - When S4 finds the admin app and both OAuth clients already there, the bootstrap finished in a container that was lost before S4 was recorded.
  - S4 records that plainly (observation "bootstrap already finished", `pass: null`), checks the clients, the store and the admin Worker, and does not run the bootstrap again.
  - New test `(b) a container lost just after the bootstrap finished resumes cleanly`, red before the fix. The fake framework has a new `loseContainerAfterBootstrap`.
- **The reviewer's note (a):** new test `(a) a starter token with more than a day left is never used`, red before the fix.
- **The test reviewer's open case (a refused roll, then a container lost in part 2):**
  - A part-2 framework command whose everyday value is missing, and cannot be rolled again, goes back to R1.
  - R1 then asks the test account login, from one link to the test Cloudflare account's token page, to roll `prototype-framework` in the dashboard and paste the value.
  - New test, red before the fix.

### The reviewer's note (c)
The fourth test, "goes on with the new starter token: S4 passes and TOK-S5 is asked", was green before the fix. The test reacts to the exit code it gets after the loss.
- **Before the fix**, the runner blocked (exit 1). The test then pasted a new token and ran `retry`, and S4's run read the new file.
- **After the fix**, the runner asks TOK-S4 (exit 10). The test pastes and runs `answer saved`.

So the test checks that the run goes on, by either path. The defect itself is reproduced by the other three tests.

### Not changed
The framework, and the four reproduction tests' assertions.

### Verification
`npx vitest run --config vitest.unit.config.ts scripts/live-pass`: 12 files, 140 tests, all pass.
