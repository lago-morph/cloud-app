# Root cause: CLI-AC-002 (offline repeat `verify`) and MIG-AC-001 (verify before the edit) — `verify failed: fetch failed` at the migration checker

Author: diagnosing subagent (prompt §8 step 1; did not write the code or the tests). Diagnosis only; no code or test changed. Needs independent review (§8 step 2) before any fix.

Status: IN PROGRESS (skeleton committed early because sandboxes are ephemeral; evidence is being gathered).

## Symptom
C-RUN (`validation/local/phase-C-run/SUMMARY.md`, record `validation/local/xc3s44jl2dbmqpv.json`):

- CLI-AC-002 `two consecutive verify runs with networking disabled give identical results`: the first offline run exited 0, the second printed `verify: migration checker` and then `verify failed: fetch failed` (exit 1).
- MIG-AC-001 `editing a generated migration makes the checker fail`: the unedited control `verify` (not offline) printed the same `verify failed: fetch failed`.

## Evidence
(being gathered)
