# Root cause: a token variable with surrounding whitespace is neither scrubbed nor counted in its bare form

Author: the independent test author and evaluator of the live-pass runner (review of PR #166, branch `v0.2.0/live-pass-test-review`). I did not write the runner. Local only: no Cloudflare calls.

## Symptom
New test `scripts/live-pass/scrub.unit.test.ts` › "scrubs and counts the bare value of a registered value that has surrounding whitespace" fails on `origin/main` (459fdfb):
```
Expected: "used [REDACTED:CLOUDFLARE_API_TOKEN]."
Received: "used sEcReT-everyday-value-0123456789abcdefXYZ."
```
A value pasted into the environment settings with a trailing newline or space is registered with it; a tool that trims the variable uses (and may print) the bare token, which the known-value layer then misses. `rawSecretHits`, which the analysis guide calls a finding whenever it is non-empty (SETUP-REQ-007), counts only the registered (whitespace) form, so it reports nothing.

## Evidence
- E1. The test registers `" <value>\n"` and scrubs `"used <value>."`: unchanged. `rawHits("used <value>")` is `{}`.
- E2. `scripts/live-pass/lib/scrub.mjs`, `add(name, value)`: registers `value` and `encodeURIComponent(value)` exactly; no trimmed form.
- E3. The runner itself already expects whitespace: `envProblems` (`lib/checkpoint.mjs`) compares the token variables with `.trim()`.
- E4. A 40-character token of `[A-Za-z0-9_-]` that is not all hex is still caught by the `TOKEN_LIKE` pattern (`[REDACTED:token-like]`), so the text in a record would usually be scrubbed anyway; the gap that remains is any value of another length and the `rawSecretHits` finding, which only the known-value layer feeds.

## Causal chain
1. An environment value can carry surrounding whitespace (E3).
2. The scrubber registers the value exactly as given (E2).
3. Text holding the bare value matches no registered form (E1), so the value is not scrubbed by name and `rawSecretHits` does not count it.

## Alternatives ruled out
- The pattern layer covers it: only for exactly 40-character token shapes, and never for `rawSecretHits` (E4).

## Proposed fix
In `add`, also register the trimmed value (and its URL-encoded form) under the same name when it differs and is long enough.

## Verification plan
The test above turns green; the other scrubber tests stay green.

## Review

Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed these defects nor wrote the runner or its fixes), 2026-11-02, on `e790cb7` in a separate worktree. Common checks, for all five records: the live-pass unit suite is red at `562334d` (pre-fix code, new tests) with exactly the five failures quoted in the records, and green at `e790cb7` (100 passed). Each fix was reverted alone at `e790cb7`: only its own record's tests turned red. The PR's test changes are additions; the one removed line in `exec.unit.test.ts` is the vitest import. `resume.unit.test.ts` is new in this PR (not on `main`). Its switch from `transcript` to `printed` in `661099b` drops only the `$ live-pass …` lines the test writes with its own arguments (the skip reason holds the admin token by design), so it still checks everything the runner prints. No once-green assertion was weakened.

**Verdict: accepted.**
1. Reproduced: at `562334d` the bare value is unchanged and `rawHits` is `{}`. With only `lib/scrub.mjs` reverted at `e790cb7`, this test is the only failure.
2. E2 checks out: `live-pass.mjs:80` registers `env[name]` exactly as given, and `add` registered only that form and its URL encoding. E3 supports link 1. As further support, the framework trims token values it reads from settings files (`packages/framework/src/provision/cloudflare/token-sources.ts:73-84`), so a tool can use the bare form. E4 correctly limits the `TOKEN_LIKE` fallback to 40-character shapes; it never feeds `rawSecretHits`.
3. The fix addresses the cause: the trimmed form and its URL encoding are registered under the same name, subject to `MIN_SECRET_LENGTH`. `rawHits` reads the same map, so the finding counts the bare form too. The added "every registered form in one text" test is an honest addition that also passes on `main`.
