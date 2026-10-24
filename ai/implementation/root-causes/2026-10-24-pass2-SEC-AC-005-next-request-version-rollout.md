# Root cause: pass 2. SEC-AC-005 fails because on Cloudflare a secret change takes effect through a Worker version rollout that lasts a few seconds. The request 160 ms after `secrets set` was still served by the previous version. The framework does not cache. As written, the criterion's "next request" cannot be met on Cloudflare: not the `secrets set` clause without a new framework wait, and not the store-deletion clause at all.

Author: diagnosing subagent (prompt §8). I did not write the code under diagnosis, and I did not run pass 2. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: `origin/claude/implement-local-cloudflare` `24327c7` (the run was on `71ac98d`). Evidence: `validation/cloudflare/cwcrlz8fxgo3ud4.json`, `validation/cloudflare/cwcrlz8fxgo3ud4/raw/vitest.log`, `validation/cloudflare/pass-2to5/logs/{2-pass2.log,trace-2-pass2.log}`.

A different subagent must review this record. A companion record covers the SEC-AC-001/HTTP-AC-002 failure: `2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early.md` (same platform cause, but a test-only fix).

## Symptom
`SEC-AC-005` `failed`: `further-stage.test.ts > [SEC-AC-005] … AssertionError: the next request after secrets set: expected { sha256 } to deeply equal { sha256 }` at `tests/compliance/criteria/secrets/further-stage.test.ts:78` (`raw/vitest.log`, failure 2/3; the digests are redacted). The deletion half (`:80-81`) never ran.

## Evidence
E1. **Timing** (the trace logs each request when its response headers arrive, `logs/tooling/fetch-trace.mjs:8,20`):
- `trace-2-pass2.log:94` 03:59:27.928 `PUT …/reference-test-sm1igld0v1slpgl/secrets` 200: SEC-AC-003's `secrets set` (value B).
- `:97` 03:59:29.276 `GET /api/ref/secret` 200. SEC-AC-003's poll (`further-stage.test.ts:64`, "DEC-0092 …", bounded 60 s) saw B on its first probe, about 1.3 s after the PUT. SEC-AC-003 passed.
- `:98` 03:59:30.890 `PUT …/secrets` 200 (pid 7079): SEC-AC-005's `secrets set` (value C) through `FurtherStage.setSecret` (`core/support/stages.ts:70`) → CLI `cloudSecretsBinding` (`packages/framework/src/cli/commands/secrets-cloud.ts:53-59`) → `setSecret` (`packages/framework/src/provision/cloudflare/worker.ts:25-29`). This is one `PUT` with `type: "secret_text"`. The CLI exits once Cloudflare answers.
- `:99` 03:59:31.050 `GET /api/ref/secret` 200, **160 ms after the PUT answered**. The value was not C. The test reads once (`further-stage.test.ts:78`) and fails.

E2. **A Worker secret change takes effect only through a new Worker version, after a delay.** DEC-0092 (`docs/decisions/decision-log.md:658-662`), from spike A-04: "Immediately after `wrangler secret put` the Worker still served the version without the secret; a few seconds later the new version (triggered by the secret) served it." DEC-0340 (`decision-log.md:2691`) budgets "a few seconds" for it in deploy's health step. On Workers, `env` belongs to a version. `PUT`/`DELETE …/secrets` creates and deploys a new version. Isolates of the previous version keep serving their own `env` until the new version reaches them, so the platform holds the old value per version, not the framework.

E3. **The framework does not cache across requests (SEC-REQ-005 holds).** A new `SecretsService` is created per request (`packages/framework/src/core/assemble.ts:78`, `packages/framework/src/targets/cloudflare/stage.ts:136`). It reads `env["SECRET_<NAME>"]` on each call (`packages/framework/src/secrets/service.ts:16-21`) and keeps found values only for that one service (`:62-78`). The route reads it each time (`apps/reference/src/server/routes/ref.ts:59`). The unit test `service.unit.test.ts:35` ("reuses a value within one service … and reads again in a new one") covers this.

E4. **No further-stage inheritance or redeploy effect.** Values were set only by explicit `PUT`s (`:72` value A, `:94` B, `:98` C). The deploy's own PUTs are the framework secrets (`provision/cloudflare/target.ts:94-104`). No deploy ran between `:94` and `:99`. `keepBindings` (`provision/cloudflare/sst.ts:134`) keeps secrets across SST uploads, and SST never declares `SECRET_*` (`sst.ts:15-17,69`). The stale value is B (or A), not a value from the run stage. The digests are redacted, so it cannot be told which one.

E5. **The criterion and the requirement.**
- SEC-REQ-005 (`docs/components/secrets.md:35-38`): "Values MUST NOT be cached across requests. A value MAY be reused within one request." This is a constraint on the framework, and E3 satisfies it.
- SEC-AC-005 (`secrets.md:72`, Where "Cloud"): "On each cloud, after `secrets set`, the next request sees the new value; after the test deletes the secret directly through the target's store (a test hook), the next request fails with `SEC.MISSING`." This is stronger than the requirement: it also demands that the platform's propagation is instant.
- DEC-0280 (`decision-log.md:2188`) took this risk knowingly: "asserted as written … DEC-0092 observed a short delay after a Cloudflare secret update, so this may fail on Cloudflare; it is not weakened (SEC-AC-003's cloud test polls, as DEC-0092 says)."
- **The deletion clause cannot be met on Cloudflare by any framework change.** The deletion goes "directly through the target's store", so the framework takes no part in it, and the next request is subject to the same rollout (companion record, E1 `:101-102`: still 200, 126 ms after the DELETE).
- **The `secrets set` clause can only be met if `secrets set` itself waits.** The CLI would have to exit only once the stage serves the new version. The test's next request comes from the same machine, so it would then usually, but not with certainty, reach an isolate that already has the new version. That needs a signal the framework does not have today: a Worker version ID visible in responses (a `version_metadata` binding, which `provision/cloudflare/sst.ts` does not declare), plus the version ID the PUT created.

## Causal chain
1. `secrets set` writes value C with one `PUT` and exits when Cloudflare answers (E1 `:98`). → Cloudflare starts rolling out a new Worker version with C (E2).
2. → The test's next request, 160 ms later, reaches an isolate of the previous version. Its `env` has B (E1 `:99`). The framework reads `env` correctly per request (E3).
3. → The response has B's digest. SEC-AC-005's single-read assertion, which demands the "next request" (E5), fails.

## Alternatives ruled out
- **A per-isolate framework cache.** Ruled out by E3. A cache would also have made SEC-AC-003's poll see B late or never, but it saw B 1.3 s after its PUT (E1 `:97`).
- **The PUT failed or went to the wrong Worker.** Ruled out: 200 on the further stage's script (E1 `:98`). `set.status` was 0 (`further-stage.test.ts:76` passed).
- **Inheritance from the run stage, the `COMPLIANCE_SECRET_API_KEY` environment variable, or a redeploy dropping or restoring the secret.** Ruled out by E4.
- **A harness ordering problem in `withFurtherStage`.** Ruled out: its set-then-redeploy sequence (`stages.ts:76-83`) ends before the tests start, and SEC-AC-003 passed on the resulting stage.

## Proposed fix
The failure is a gap between the criterion and the platform, not a framework defect. Changing the criterion's text is the owner's call. So the minimal fix is an owner decision plus a test change, with a framework alternative stated.

**Option A (recommended, minimal): amend SEC-AC-005 for the Cloudflare propagation delay, and test what SEC-REQ-005 forbids.**
1. Owner decision (decision log): on Cloudflare, "next request" in SEC-AC-005 reads as "every request once the change has reached the stage, within DEC-0092's bound (60 s)". The test must also show that the value is never cached across requests. Proposed text: "On each cloud, after `secrets set`, requests see the new value within a bounded delay (Cloudflare: DEC-0092) and never the old value again; after the test deletes the secret directly through the target's store (a test hook), requests fail with `SEC.MISSING` within the same bound and never return the value again." Update `secrets.md:72`, and supersede DEC-0280's SEC-AC-005 bullet (`decision-log.md:2188`).
2. Test (`further-stage.test.ts:69-84`): after `setSecret`, `waitFor` the digest of C (bounded `60_000`/`2_000`, as `:64`). Then make **N = 5 consecutive** reads, all of which must be C. After `deleteSecret`, `waitFor` `SEC.MISSING` (as `cf/stage-resources.test.ts:120`), then make 5 consecutive reads, all `SEC.MISSING`. The consecutive reads are what catch a per-isolate cache: an isolate that cached the value would go on answering the old value after the rollout.
3. **Red test (local fakes):** in a helper test (`core/support/stages.unit.test.ts`, or a new `secrets/support.unit.test.ts`), use a fake `/api/ref/secret` that serves the old digest for the first 2 requests after a change and the new one afterwards. Today's single-read assertion fails on it (red). The wait-then-repeat helper passes it (green). Add a second fake that alternates old and new forever (a cache in some isolates): the helper must fail it, which keeps the check strict. A framework-level red test of "no cache across requests" already exists and is green (`packages/framework/src/secrets/service.unit.test.ts:35`).

**Option B (keeps "next request" for the `secrets set` clause only; larger).** Make `secrets set` on Cloudflare wait until the stage serves the new version before exiting:
- Declare a `version_metadata` binding in the SST program (`provision/cloudflare/sst.ts`), and expose its ID on `GET /api/__framework/health` in a response header.
- After the `PUT`, read the new version's ID (`GET …/workers/scripts/<name>/versions` or `…/deployments`).
- Poll health until the header matches, bounded like DEC-0340 (30 s).

Red test: the existing fake Cloudflare API (`provision/cloudflare/fake-cloud.test-support.ts:87-91`) gains a version counter and a lagging health answer, and a `secrets-cloud.unit.test.ts` case expects `set` to resolve only after health reports the new version. That case is red today. Option B still cannot cover the deletion clause (E5), so it needs Option A's amendment for that half anyway. It also only reduces the chance of a stale read from another isolate or location; it does not remove it. Option B is not recommended unless the owner wants `secrets set` to block until the new value is live as a product behaviour.

## How the fix will be verified
- Option A: the helper's unit test goes red, then green (lagging fake passes, alternating fake fails). In the pass-2 re-run on Cloudflare, SEC-AC-005 `passed`. The trace shows a few reads with the old value or 200, then only the new value or `SEC.MISSING`, within 60 s of each change.
- Option B additionally: `secrets-cloud.unit.test.ts` goes red, then green, and on Cloudflare the read right after `secrets set` already has the new value (the health polls are counted against the request cap).

## Review
