# Root cause: `resume` refuses (exit 3) a lost session-1 container after the owner followed the S8 prompt

Author: the independent test author and evaluator of the live-pass runner (review of PR #166, branch `v0.2.0/live-pass-test-review`). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New test `scripts/live-pass/resume.unit.test.ts` (offline run, fake Cloudflare world) stops in its setup on `origin/main` (459fdfb):
```
Error: expected the owner prompt of S8, got exit 3:
$ live-pass resume → 3
live-pass: the environment is not as the runbook says for session 1:
  - CLOUDFLARE_API_TOKEN is set in session 1; the new account has no everyday token yet, so remove it from the environment
```
The S8 prompt tells the owner to put the everyday token into `CLOUDFLARE_API_TOKEN` and delete `CLOUDFLARE_BOOTSTRAP_TOKEN` and the other starter variables *now*, before replying. If the container is lost before the reply reaches the runner, the runbook (section 5) says: start a new session and run `resume`; nothing is lost. The new session sees the changed variables, and `resume` refuses them. The owner cannot satisfy the message: the starter token deleted itself at S4, and the everyday token the message tells them to remove is the one session 2 needs.

## Evidence
- E1. The test's steps: session 1 up to the S8 prompt (exit 10), the fake world gains the everyday token (page 2), the environment becomes session 2's column, the work directory is new; `resume` exits 3 with the message above.
- E2. `scripts/live-pass/live-pass.mjs`, `checkEnv`: `const asSession = session === 1 && state?.facts?.everydayTokenId && !env.CLOUDFLARE_BOOTSTRAP_TOKEN ? 2 : session;` then `envProblems(asSession, env)`.
- E3. `facts.everydayTokenId` is set only in S8's `verify` (`scripts/live-pass/lib/steps.mjs`, S8 owner part), which runs when the owner's reply is given with `answer`. While the S8 prompt waits, the state has `pending.stepId === "S8"` with a `prompt`, and no `everydayTokenId`.
- E4. `scripts/live-pass/lib/checkpoint.mjs`, `envProblems(1, …)`: stops when `CLOUDFLARE_BOOTSTRAP_TOKEN` is not set and when `CLOUDFLARE_API_TOKEN` is set.

## Causal chain
1. The S8 prompt asks the owner to change the variables before replying (the prompt text in `steps.mjs`).
2. A container lost in that window leaves the state with the S8 prompt waiting and no `everydayTokenId` (E3).
3. `resume` checks the variables as session 1's, because the switch to session 2's column waits for `everydayTokenId` (E2).
4. Session 1's check stops on the everyday token being set and the starter token being absent (E4): exit 3 (E1).

## Alternatives ruled out
- The owner changed the variables too early: no; the prompt says to do it before replying, and runbook step 3.5 says the same.
- The fake world: the refusal happens before any API call that the fake answers (`checkEnv` runs on the variables only).

## Proposed fix
In `checkEnv`, accept session 2's variables in session 1 from the moment the S8 prompt has been shown: when `everydayTokenId` is known, or S8 has a result, or the S8 prompt is waiting. The steps that remain in session 1 then (S8's check, S10, CP) use the admin token only, and `childEnv` keeps the everyday token from session-1 commands.

## Verification plan
The test's setup passes and its first case ("resumes session 1 in a new container … and asks S8 again") is green; the existing `run.unit.test.ts` stays green.

## Review

Status: awaiting review (the independent root-cause reviewer has not run: this evaluator could not start a subagent).
