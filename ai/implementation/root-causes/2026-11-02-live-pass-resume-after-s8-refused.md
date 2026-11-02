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

Status: rejected (back to step 1 of `failure-diagnosis.md`, attempt 2)

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed these defects nor wrote the runner or its fixes), 2026-11-02, on `e790cb7` in a separate worktree. Common checks, for all five records: the live-pass unit suite is red at `562334d` (pre-fix code, new tests) with exactly the five failures quoted in the records, and green at `e790cb7` (100 passed). Each fix was reverted alone at `e790cb7`: only its own record's tests turned red. The PR's test changes are additions; the one removed line in `exec.unit.test.ts` is the vitest import. `resume.unit.test.ts` is new in this PR (not on `main`). Its switch from `transcript` to `printed` in `661099b` drops only the `$ live-pass …` lines the test writes with its own arguments (the skip reason holds the admin token by design), so it still checks everything the runner prints. No once-green assertion was weakened.

**Verdict: rejected.**
1. Reproduced: at `562334d` the harness stops with `expected the owner prompt of S8, got exit 3` and the quoted message, and the four-container block is skipped. With only the `checkEnv` change reverted at `e790cb7`, the same setup fails. E2 to E4 check out, and the alternatives are ruled out.
2. **Major: the fix still leaves a reachable state with the same symptom, so it does not fully remove the cause.** The cause is that `checkEnv` asks for session 1's variables after the owner was told to change them. The fix detects "the S8 prompt was shown" from three proxies: `facts.everydayTokenId`, `done.S8`, or `pending.prompt` on S8. Together they miss the window after the owner's reply:
   - `engine.answer` (`lib/engine.mjs:196`) removes `prompt` and saves `{ stepId: "S8", part: 1 }`.
   - Only then does `runStep` → `complete` run `after`/`afterStep`, which takes a snapshot, sets Workers Logs and uploads, and then saves `done.S8`.
   - S8's `verify` sets `everydayTokenId` only when it finds the token (`lib/steps.mjs:485`, `if (tokens.length >= 1)`). It finds none if the owner replied before the token was listed after `eventually`'s six tries, or if a snapshot failed.
   - A container lost in that window leaves no prompt, no `done.S8` and no fact.
   Experiment: the predicate as it stands at `e790cb7`, run on that stored state with session 2's variables, gives `s8Shown: false`, `asSession: 1` and the stops "CLOUDFLARE_BOOTSTRAP_TOKEN is not set; session 1 needs it" and "CLOUDFLARE_API_TOKEN is set in session 1…". That is the same exit 3, and the owner still cannot satisfy it.
3. Required for the next attempt:
   - Causal chain link 2 should name every stored state between the moment the S8 prompt is printed and the moment `done.S8` is saved. The proposed fix should then key on S8 having been reached, for example `pending?.stepId === "S8"` at any part, or `done.S8`, or the fact. The prompt is saved before it is printed, so the owner cannot have changed the variables any earlier.
   - Add a test that resumes from the stored state after the reply (prompt removed, part 1, no `everydayTokenId`) with session 2's variables.
4. Minor, optional: `checkEnv` tests `!env.CLOUDFLARE_BOOTSTRAP_TOKEN`, but `envProblems` treats a whitespace-only value as unset. Using the same test in both places would avoid a contradictory message.
