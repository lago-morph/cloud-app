# Root cause: a new container overwrites the live pass's append-only logs in the records bucket

Author: the independent test author and evaluator of the live-pass runner (review of PR #166, branch `v0.2.0/live-pass-test-review`). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New tests in `scripts/live-pass/records.unit.test.ts` fail on `origin/main` (459fdfb):
```
× keeps the lines an earlier container uploaded when a new container appends to the same log
  AssertionError: expected [ { session: 2 } ] to deeply equal [ { session: 1 }, { session: 2 } ]
× never overwrites a log whose earlier lines it could not read, and uploads it once it can
  AssertionError: expected [] to have a length of 1 but got +0
```
In the live pass, session 2 always runs in a new container (runbook section 4), and a lost container is resumed in a new one (section 5). The analysis guide (`ai/implementation/live-pass-analysis.md` section 2) says `api-calls.jsonl` holds every API call of the run and `events.jsonl` the run's timeline; after session 2 they would hold session 2's lines only.

## Evidence
- E1. The first test: recorder A (directory 1) appends `{session:1}` to `events.jsonl` and syncs; recorder B (directory 2, same store) appends `{session:2}` and syncs. The stored object is `[{session:2}]`.
- E2. `scripts/live-pass/lib/records.mjs`: `append` does `appendFileSync` on the local file `<dir>/<rel>` and marks it dirty; `sync` uploads `readFileSync(<dir>/<rel>)` with `store.put`, replacing the whole object. Nothing reads the stored object first (the second test: `sync` never calls `get`, so the failing `get` produces no failure).
- E3. `scripts/live-pass/live-pass.mjs`: the recorder's directory is `<workdir>/records/<runId>`, with `workdir` defaulting to `~/live-pass`; a new container has an empty home directory. The append-only files are `events.jsonl`, `api-calls.jsonl`, `http.jsonl` and `observability.jsonl` (`recorder.append` call sites in `live-pass.mjs` and `lib/context.mjs`).

## Causal chain
1. A new container starts with no local copy of the run's append-only logs (E3).
2. The first `append` there creates a local file holding only the new lines (E2).
3. `sync` uploads that file over the stored object without merging (E1, E2).
4. Every line earlier containers uploaded is lost from the records bucket, the only copy the analyst reads.

## Alternatives ruled out
- The download command dropping lines: no; the stored object itself holds only the new lines (E1).
- Per-container file names: none are used; all containers write the same keys (E3).

## Proposed fix
In `createRecorder`, an append that creates a local file the recorder has never merged marks it as needing its stored lines. `sync` first reads the stored object for such a file and writes stored + local locally, then uploads. If the read fails, the file is not uploaded in that sync (reported as failed) and stays marked, so the stored lines are never overwritten. The mark is kept in the records directory (like `.unsynced.json`) so a later invocation in the same container keeps it.

## Verification plan
Both tests above turn green; the existing recorder tests stay green; `scripts/live-pass/resume.unit.test.ts` › "keeps every container's lines of the append-only logs in the records bucket" passes (an offline run over four containers).

## Review

Status: awaiting review (the independent root-cause reviewer has not run: this evaluator could not start a subagent).
