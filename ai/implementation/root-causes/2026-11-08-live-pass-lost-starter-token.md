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
Status: awaiting review
