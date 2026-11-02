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

## Attempt 2

Author: the same diagnosing test author, after the review above. Local only: no Cloudflare calls.

### Symptom
The symptom is the same as attempt 1's: `resume` exits 3 with "the environment is not as the runbook says for session 1" after the owner followed the S8 prompt. This time it happens on a state that the attempt-1 fix (`e790cb7`) does not cover: the owner's reply was saved, but S8 was not yet recorded (reproduced by the reviewer, and by E6 below).

### Evidence
- E5. The reviewer's reproduction holds. `lib/engine.mjs` `answer` pushes the reply into `pending.record.owner`, removes `prompt` and `askedAt`, sets `part: 1` and saves. Only after that does `runStep` → `complete` run, and `complete` ends by saving `done.S8`. S8's `verify` sets `everydayTokenId` only when it lists the token (`lib/steps.mjs`, `if (tokens.length >= 1)`).
- E6. New test `scripts/live-pass/resume.unit.test.ts` › "resume in session 1 after the owner's S8 reply was saved but before S8 was recorded › accepts session 2's variables, finishes S8 and asks S10". It runs session 1 to the S8 prompt, then writes the stored state that `answer` saves (reply recorded, no prompt, part 1, no `everydayTokenId`, no `done.S8`). It sets session 2's variables and runs `resume` in a new container. On the attempt-1 fix (`e790cb7`) it fails with exit 3: "CLOUDFLARE_BOOTSTRAP_TOKEN is not set; session 1 needs it" and "CLOUDFLARE_API_TOKEN is set in session 1 …".

### Causal chain
2. These are every stored state from the moment the S8 prompt is printed until `done.S8` is saved:
   - (a) `pending.stepId === "S8"` with `prompt` set (saved before the prompt is printed);
   - (b) `pending.stepId === "S8"`, part 1, `prompt` removed, the reply recorded (saved by `answer`), with or without `everydayTokenId`;
   - (c) `done.S8` set and `pending` cleared (saved by `complete`).

   The owner can have changed the variables in every one of them. They cannot have changed them earlier, because the prompt is saved before it is printed. Attempt 1 keyed on `prompt` being set, so it missed (b) when the token check found no token.

### Alternatives ruled out
- Keying on the prompt, as attempt 1 did, misses state (b) (E6).
- Keying on `everydayTokenId` alone misses (a), and also (b) whenever the token check found no token (E5).
- Accepting session 2's variables earlier than S8 would accept them before the owner was told to change them. Session 1's commands up to S5 need the starter tokens, so that is wrong.

### Proposed fix
`checkEnv` (`live-pass.mjs`) accepts session 2's variables in session 1 once S8 has been reached: `pending.stepId === "S8"` at any part, or `done.S8`, or `facts.everydayTokenId`. It now treats `CLOUDFLARE_BOOTSTRAP_TOKEN` as set only when it is not blank, the same way `envProblems` does (the reviewer's minor point).

### Verification plan
- E6's test is red on `e790cb7` and green with the fix.
- Attempt 1's case ("resumes session 1 in a new container … and asks S8 again") stays green.
- The whole `scripts/live-pass` suite and `lint-records` are green.

Out of scope, noted: in state (b) without `everydayTokenId`, S8 is recorded with its failed token check, and session 2's R1 then blocks with exit 1, because it cannot match `CLOUDFLARE_API_TOKEN` to an unknown token ID. That is R1's documented BLOCKED path (`retry`/`skip`), not this defect.

### Review

Status: accepted

Reviewer: the same independent root-cause reviewer as attempt 1 (it did not diagnose the defect or write the fix), 2026-11-02, on `8f2d804` in a separate worktree.

**Verdict: accepted.**
1. The attempt-1 reproduction is now covered. I re-ran the experiment against the `s8Reached` and `bootstrapSet` expressions as they stand at `8f2d804`, with session 2's variables, in these states:
   - S8 pending at part 0 before its prompt;
   - (a), the prompt waiting;
   - (b), the reply saved, both with and without `everydayTokenId`;
   - (c), `done.S8` set with S10 pending;
   - S8 skipped.

   Each state gives `asSession` 2 and no stops. A blank `CLOUDFLARE_BOOTSTRAP_TOKEN` gives the same result. With session 1's variables, every one of these states stays `asSession` 1 with no stops. Before S8 (E-1 pending), session 2's variables are still refused, which is correct.
2. Link 2's list of states is complete. `skip` clears `pending` only for the step it skips, and S8 skipped sets `done.S8` in the same save. `retry` clears `pending` only for a blocked step, and S8 is not blocking. After `done.S8`, every later state in session 1 keeps `done.S8`, and the checkpoint phase resumes as session 2. No stored state has S8 reached that the new predicate misses.
3. The fix addresses the cause: the switch now follows the moment the prompt is saved, which is before the owner can act on it. The blank-token check matches `envProblems`. The alternatives are ruled out with evidence.
4. The tests:
   - The full suite at `8f2d804` passes, 101/101.
   - With only `live-pass.mjs` restored to `ce486d0` (the attempt-1 fix), the new test is the only failure, with exit 3 and "CLOUDFLARE_BOOTSTRAP_TOKEN is not set; session 1 needs it".
   - The new test's stored state matches what `engine.answer` saves. It leaves out only the failed check's observations, which `checkEnv` does not read.
   - The attempt's test change is 66 added lines and nothing removed, so no once-green assertion was changed.
5. Agreed with the out-of-scope note: in (b) without the token ID, R1's BLOCKED path (`retry`/`skip`) is the documented outcome, not this defect.
