# Root cause: the live pass's durable state is stored without passing the scrubber

Author: the independent test author and evaluator of the live-pass runner (review of PR #166, branch `v0.2.0/live-pass-test-review`). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New test `scripts/live-pass/resume.unit.test.ts` › "the durable state in the records bucket › holds no credential value, even when an owner's skip reason contains one" fails on `origin/main` (459fdfb):
```
AssertionError: runs/lp-20261102-044238/state.json holds the admin token: expected true to be false
```
The step record of the same skip (`steps/NNN-S2.json`) and `results.md` are scrubbed; `state.json`, which the analyst downloads with the other records (`live-pass-analysis.md` section 2), is not. The owner's requirement: credential values are never stored.

## Evidence
- E1. The test runs `start` (to the P3 prompt), then `skip S2 "the owner pasted <admin token> by mistake"`. Only `runs/<id>/state.json` holds the value; every other object holds `[REDACTED:LIVE_PASS_ADMIN_TOKEN]`.
- E2. `scripts/live-pass/live-pass.mjs`: `const save = async (s) => { await saveState(store, s); };` and the `start` branch's `saveState(store, holder.state)`. `saveState` (`lib/checkpoint.mjs`) writes `JSON.stringify(s)`; no scrubber is involved. Every other record goes through `recorder.json`/`text`/`append`, which scrub (`lib/records.mjs`).
- E3. The state holds free text from outside the runner's control: skip reasons, blocked-step error messages (`pending.blocked`, from `message(e)`), the observations and notes of the step in progress (`pending.record`), and facts. The engine copies the same texts into the step records, scrubbed.

## Causal chain
1. Text that may contain a credential reaches the state (E1, E3).
2. The state is saved to the records bucket without the scrubber (E2).
3. `state.json` stores the value (E1).

## Alternatives ruled out
- The scrubber not knowing the value: no; the same value is scrubbed in the step record and in `results.md` (E1).

## Proposed fix
Save the state through the run's scrubber (`scrubber.value(state)`) wherever the runner stores it (`save` and the `start` branch). The step records already hold the same content scrubbed, so the stored state stays consistent with them; IDs, URLs, emails and user IDs are not altered by the scrubber (`scrub.unit.test.ts`, "keeps what the records may hold").

## Verification plan
The test above turns green; `run.unit.test.ts` (which reloads the stored state in every invocation) and `resume.unit.test.ts` stay green.

## Review

Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed these defects nor wrote the runner or its fixes), 2026-11-02, on `e790cb7` in a separate worktree. Common checks, for all five records: the live-pass unit suite is red at `562334d` (pre-fix code, new tests) with exactly the five failures quoted in the records, and green at `e790cb7` (100 passed). Each fix was reverted alone at `e790cb7`: only its own record's tests turned red. The PR's test changes are additions; the one removed line in `exec.unit.test.ts` is the vitest import. `resume.unit.test.ts` is new in this PR (not on `main`). Its switch from `transcript` to `printed` in `661099b` drops only the `$ live-pass …` lines the test writes with its own arguments (the skip reason holds the admin token by design), so it still checks everything the runner prints. No once-green assertion was weakened.

**Verdict: accepted.**
1. Reproduced: at `562334d` only `runs/<id>/state.json` holds the admin token. With only the two `scrubber.value(...)` wrappers reverted at `e790cb7`, this test is the only failure.
2. E2 checks out: `saveState` is called only at `live-pass.mjs:150` (start) and `:168` (`save`), and it writes `JSON.stringify(s)`. E3 checks out: the engine puts skip reasons, `blocked` messages and the pending record into the state. Every link is supported.
3. The alternative is ruled out: the same value is scrubbed in the step record and in `results.md`.
4. The fix covers both call sites, which is every write of the state. Scrubbing does not break resumption:
   - the facts hold IDs, URLs and emails;
   - no state key is in `SECRET_KEYS`;
   - the runner SHA is all hex, so `TOKEN_LIKE` keeps it;
   - the four-container offline run, which reloads the stored (scrubbed) state in every invocation, passes.
   The unscrubbed state lives only in memory within one invocation.
