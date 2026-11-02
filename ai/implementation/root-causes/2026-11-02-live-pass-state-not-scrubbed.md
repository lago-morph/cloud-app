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

Status: awaiting review (the independent root-cause reviewer has not run: this evaluator could not start a subagent).
