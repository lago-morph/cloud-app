# Root cause: CORE-AC-002, HTTP-AC-002, SEC-AC-001, SEC-AC-002, E2E-013 blocked: the local runner step that sets the reference app's test secret `apiKey` was not done (a setup step, not a defect)

Author: diagnosing subagent for P0 (plan-v0.2.0 §7a.1.8 step 1, prompt §8 step 1). I wrote none of the files involved. This record is a diagnosis only: I changed no code, test or doc. The secret value I set for the experiments below was a throwaway random value. I piped it from `/dev/urandom` to `secrets set` on stdin, and it went only into the git-ignored `apps/reference/.dev.vars`. It was never printed or written to a tracked file. It needs an independent review.

Base: `origin/main` at `1e0c289`. Node 22.23.4. Chromium shim per progress-v0.2.0 §6.

## Symptom
On a fresh worktree of `1e0c289` with no `apps/reference/.dev.vars`, `npm run compliance -- --target local --only …` (record `y6qa0drbpq3riqs`) records five IDs as `blocked`, with these details:
- HTTP-AC-002, SEC-AC-001, SEC-AC-002: `PREREQUISITE MISSING: the reference app's test secret apiKey has no value in apps/reference/.dev.vars (SECRET_API_KEY): set it before the run with \`npm run secrets -- set apiKey --target local --stage local\` in apps/reference (value on stdin)`. The stack shows `testSecretValue tests/compliance/criteria/core/support/stores.ts:73`, called from `http/errors.test.ts:100`, `secrets/read.test.ts:19` and `secrets/no-leak.test.ts:61`.
- CORE-AC-002: `the reference app's declared secret apiKey has no value on this deployment, so its health route answers SEC.MISSING; set it before the run` (`core/deployment.test.ts:39`).
- E2E-013: `the reference app's secret apiKey has no value on this target (set it with \`secrets set apiKey\`)` (`tests/compliance/e2e/support/secrets.ts:32`, `apiKeyDigest`, on `GET /api/ref/secret` answering 500 `SEC.MISSING`).

## Evidence
1. **The run left no app secret in place.** After the run, `apps/reference/.dev.vars` (git-ignored: `.gitignore:11`) held only the keys `SECRET_FRAMEWORK_SESSION_KEY`, `SECRET_FRAMEWORK_AUTH_SECRET` and `SECRET_FRAMEWORK_LOCAL_TICKET_KEY`. I printed the keys only, with the values redacted. `dev` generates the framework's own secrets. It does not generate app-declared ones. The reference app declares exactly one secret, `apiKey` (`apps/reference/src/server/env.ts:12`).
2. **The prerequisite is a designed, documented runner step.**
   - DEC-0277 ("Run prerequisites: the test secret's value"; Affects SEC-AC-001, SEC-AC-002, HTTP-AC-002, CORE-AC-002): "locally `SECRET_API_KEY` in `apps/reference/.dev.vars` (`dev` does not reload `.dev.vars` while running, so the runner sets it *before* the run with `npm run secrets -- set apiKey --target local --stage local` in `apps/reference`, value on stdin; a long random value …). Without a value (or one under 12 characters) the tests report a missing prerequisite (`blocked`), never pass."
   - DEC-0398 (driver sets `apiKey` on cloud): "Only for a run stage the driver deploys itself … Local runs are unchanged: the value stays in `apps/reference/.dev.vars`, set by the operator (DEC-0277)."
   - The same step is documented in `apps/reference/ROUTES.md:124` and `apps/template/README.md:27`.
   - Reporting `blocked` rather than `failed` is COMPL-REQ-003's missing-prerequisite path (`tests/compliance/harness/blocked.ts`).
3. **Experiment: the step alone changes all five results.**

   | run | `.dev.vars` before the run | result for the 5 IDs |
   | --- | --- | --- |
   | `y6qa0drbpq3riqs` (control) | absent | 5 blocked |
   | `9mu5tqphxee3nxv` | framework keys + `SECRET_API_KEY` (set with `secrets set` after the control run) | **5 passed** (`130 not-run, 5 passed`, exit 0) |
   | `fc9ihkg289azi8b` | file deleted, then **only** `SECRET_API_KEY` set (the order a fresh runner uses) | **5 passed** (exit 0). Afterwards the file holds `SECRET_API_KEY` plus the three framework keys, so `dev` keeps the app secret and adds its own |

   `secrets set` printed `set secret apiKey for target local as SECRET_API_KEY in .dev.vars` and no value (CLI-REQ-004).
4. **No leak from the experiment.** A count-only check (scratchpad `blocked/leakcheck.sh`) of the 32-character value found 0 files under the scratchpad (all run logs and evidence records) and 0 tracked files (`git grep -lF`). `git status --short` was empty.
5. **Same cause for E2E-013.** Its route `GET /api/ref/secret` reads `apiKey` (`apps/reference/src/server/routes/ref.ts:59`). Without a value it answers `SEC.MISSING`, and with one it passed (item 3).
6. **CI does not run compliance today.** `.github/workflows/ci.yml` and `release.yml` contain no `compliance` run and no `apiKey` step. S3 is to make CI run criteria through the harness (progress §3 P0, S3).

## Causal chain (each link evidenced)
1. A fresh checkout has no `apps/reference/.dev.vars`, because it is git-ignored, and `dev` creates only the framework keys (item 1).
2. The local driver deliberately does not set `apiKey`: that is the operator's step, per DEC-0277 and DEC-0398 (item 2).
3. With no `SECRET_API_KEY`, `testSecretValue()` (stores.ts:73) and the reference app's `SEC.MISSING` answers (health route; `/api/ref/secret`) raise `prerequisiteMissing`, which the driver records as `blocked` (Symptom, item 5).
4. Doing the step makes all five pass, in both orders (item 3).

## Alternatives ruled out
- **A product defect in the secrets component or the reference app.** Ruled out. With the value set, SEC-AC-001, SEC-AC-002 and HTTP-AC-002 pass, and so do CORE-AC-002's health check and E2E-013 (item 3).
- **The tests should fail rather than block.** Ruled out. Blocking is the specified behaviour for a missing run prerequisite (DEC-0277; COMPL-REQ-003).
- **`dev` overwrites or drops a pre-set `SECRET_API_KEY`.** Ruled out by the third run in item 3.

## Decision: runner setup step, not a defect
No code, test or doc change is needed, and nothing is committed with a value. Runners and CI do the step **before** `npm run compliance -- --target local` (`dev` does not reload `.dev.vars`), with a fresh throwaway value on stdin, for example:

```sh
# in apps/reference; never echo the value, never pass it as an argument
LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 | npm run secrets -- set apiKey --target local --stage local
```

- **Value.** Any value of at least 12 characters works locally. No stored CI secret is needed: a GitHub Actions secret would add nothing and would be one more value to protect. The value lives only in the runner's git-ignored `.dev.vars`.
- **Where this lands:**
  - progress-v0.2.0 §6 "Baseline" (already states it; owned by R);
  - every runner brief that runs local compliance;
  - S3's CI job that runs criteria through the harness, as a step before the compliance step.
- **Not proposed: having the local driver generate the value, as it does on cloud stages.** DEC-0398 excludes local runs on purpose, so that would be a design change with its own decision. It is not needed to fix this baseline.
- **Retired by v0.2.0?** No. SEC, HTTP, CORE and E2E-013 all stay in v0.2.0.

## Verification plan
- On a fresh checkout of the branch under test, run the step above, then `npm run compliance -- --target local --only CORE-AC-002,HTTP-AC-002,SEC-AC-001,SEC-AC-002,E2E-013`. Expect 5 passed, exit 0, as in run `fc9ihkg289azi8b`.
- In S3's CI job, the step runs before the compliance step. The job's evidence record shows the five IDs `passed`, not `blocked`. A count-only leak check like item 4 (SEC-AC-002 itself scans the repository, build output and stored logs) shows the value nowhere.

## Review
(pending: independent root-cause reviewer)
