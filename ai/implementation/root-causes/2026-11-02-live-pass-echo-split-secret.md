# Root cause: the live-pass runner can print a credential value that arrives split across two output chunks

Author: the independent test author and evaluator of the live-pass runner (review of PR #166, branch `v0.2.0/live-pass-test-review`). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New test `scripts/live-pass/exec.unit.test.ts` › "never echoes a secret to the terminal when it arrives split across two output chunks" fails on `origin/main` (459fdfb):
```
AssertionError: expected 'a very-secret-value-123 b\n' not to contain 'very-secr'
```
The command record (`rec.stdout`) is scrubbed correctly (`a [REDACTED:SECRET] b\n`); only the echo to the runner's own standard output holds the raw value. The owner's requirement: credential values are never printed, logged or stored.

## Evidence
- E1. The test's child writes `a very-secr`, waits 300 ms, then writes `et-value-123 b\n`. The runner's stdout (spied `process.stdout.write`) received `a very-secr` and `et-value-123 b\n` as two writes, each unchanged.
- E2. `scripts/live-pass/lib/exec.mjs`, `runCommand`: `child.stdout.on("data", (d) => { stdout += d; if (echo) process.stdout.write(scrubber.text(String(d))); })` (and the same for stderr). The scrubber is applied to each chunk on its own. The record is built in `finish` from the whole `stdout`, so it is scrubbed as a whole.
- E3. `scrubber.text` replaces whole registered values and whole pattern matches (`scripts/live-pass/lib/scrub.mjs`); a fragment of a value matches neither the known-value layer nor `TOKEN_LIKE` (40 characters) nor the bearer pattern.
- E4. The echo goes to the cloud session's terminal, which the agent reads into the conversation (runbook "For the agent in the session", rule 1: the agent runs the runner with the Bash tool).

## Causal chain
1. A child process's output reaches the runner as pipe chunks of arbitrary size (E1; Node delivers what each `read` returns, up to 64 KiB).
2. The echo scrubs each chunk separately (E2).
3. A value split across chunks is not matched by any layer of the scrubber (E3), so both halves are written unscrubbed.
4. The halves are adjacent in the terminal, so the full value is printed into the session transcript (E1, E4).

## Alternatives ruled out
- The scrubber misses the value itself: no; the same text scrubbed whole gives `[REDACTED:SECRET]` (the record in E1).
- The test's own timing: the 300 ms gap only forces two chunks; any output larger than one pipe read can split anywhere, so the defect does not depend on timing.

## Proposed fix
Echo by line: keep the not-yet-ended line of each stream in a buffer, scrub and write only complete lines (`\n` or `\r` ended), and flush the rest, scrubbed, when the command closes. Credential values never contain line ends, so a value is always whole when scrubbed.

## Verification plan
The new test above turns green; the companion test "still echoes output that ends without a newline, once the command ends" stays green; the whole live-pass unit suite stays green.

## Review

Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed these defects nor wrote the runner or its fixes), 2026-11-02, on `e790cb7` in a separate worktree. Common checks, for all five records: the live-pass unit suite is red at `562334d` (pre-fix code, new tests) with exactly the five failures quoted in the records, and green at `e790cb7` (100 passed). Each fix was reverted alone at `e790cb7`: only its own record's tests turned red. The PR's test changes are additions; the one removed line in `exec.unit.test.ts` is the vitest import. `resume.unit.test.ts` is new in this PR (not on `main`). Its switch from `transcript` to `printed` in `661099b` drops only the `$ live-pass …` lines the test writes with its own arguments (the skip reason holds the admin token by design), so it still checks everything the runner prints. No once-green assertion was weakened.

**Verdict: accepted.**
1. Reproduced: at `562334d` the echo holds `a very-secret-value-123 b\n` while the record holds `a [REDACTED:SECRET] b\n`. With only `lib/exec.mjs` reverted at `e790cb7`, this test is the only failure.
2. E2 and E3 check out. On `main`, `runCommand` scrubs each `data` chunk on its own, and neither the known-value layer nor `TOKEN_LIKE` nor the bearer pattern matches a fragment. Every link is supported.
3. The alternatives are ruled out: the whole text is scrubbed in the record, and the 300 ms gap only forces the split.
4. The fix addresses the cause. It scrubs whole lines (`\n` or `\r`) and flushes the rest at `close`. A `\r\n` split across chunks is handled, and the companion test covers output with no final newline.
5. Minor: "credential values never contain line ends" holds for the bare value. A value registered with a trailing newline matches across lines only through its trimmed form, which the fix in `2026-11-02-live-pass-scrub-whitespace-value.md` adds. The two fixes belong together.
6. Minor, accepted trade-off: a partial line (for example an interactive prompt) is echoed only at the next line end or when the command ends.
