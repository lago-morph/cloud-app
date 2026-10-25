# Root cause: pass 2. SEC-AC-001 (cloud, "without a value" clause) and HTTP-AC-002 (SEC.MISSING on a cloud) fail because the test reads once, 126 ms after deleting the Worker secret. Cloudflare was still serving the previous Worker version, which has the secret. The test does not wait the bounded delay that DEC-0092 requires, as CF-AC-002's test does.

**Archived 2026-10-25** to branch `archive/implement-local-cloudflare` (same paths; `ai/ARCHIVE.md`, then `ARCHIVE-INDEX.md` there): the records `cwcrlz8fxgo3ud4` and `5tr1c8w0x1b9lai` (`validation/cloudflare/<runId>.json` and `raw/`) cited below; `validation/cloudflare/pass-2to5/` stays here.

Author: diagnosing subagent (prompt §8). I did not write the code under diagnosis, and I did not run pass 2. This is a diagnosis only. No code or test was changed, and no Cloudflare call was made.

Base: `origin/claude/implement-local-cloudflare` `24327c7` (the run was on `71ac98d`). Evidence: `validation/cloudflare/cwcrlz8fxgo3ud4.json`, `validation/cloudflare/cwcrlz8fxgo3ud4/raw/vitest.log`, `validation/cloudflare/pass-2to5/logs/{2-pass2.log,trace-2-pass2.log}`, `validation/cloudflare/pass-2to5/SUMMARY.md`.

A different subagent must review this record.

## Symptom
`SEC-AC-001` and `HTTP-AC-002` `failed`, from one test: `tests/compliance/criteria/secrets/further-stage.test.ts:86-105` `[SEC-AC-001][HTTP-AC-002] on the cloud, the declared secret without a value fails with SEC.MISSING …`, failing at `:99` with `GET /api/ref/secret → status 200, code none, requestId none (expected status 500 with code SEC.MISSING)` (`raw/vitest.log`, failure 3/3).

The rest of SEC-AC-001 (value read, SEC.UNDECLARED: `secrets/read.test.ts`) and of HTTP-AC-002 (`http/errors.test.ts`) passed on the run stage in the same run.

## Evidence
E1. **The order of events on the further stage** (`reference-test-sm1igld0v1slpgl`). The trace logs each request when its response headers arrive (`logs/tooling/fetch-trace.mjs:8,20`):
- `trace-2-pass2.log:94` 03:59:27.928 `PUT …/secrets` 200 (SEC-AC-003's `secrets set`, value B).
- `:97` 03:59:29.276 `GET /api/ref/secret` 200. SEC-AC-003's `waitFor` saw value B on its first probe, about 1.3 s after the PUT.
- `:98` 03:59:30.890 `PUT …/secrets` 200 (SEC-AC-005's `secrets set`, value C). `:99` 03:59:31.050 `GET /api/ref/secret` 200, the stale value. SEC-AC-005 fails at `further-stage.test.ts:78`, so its own deletion at `:80` never runs (see the SEC-AC-005 record).
- `:100-101` 03:59:31.265 `GET …/workers/scripts`, then 03:59:31.740 `DELETE …/secrets/SECRET_API_KEY` **200**. This is the SEC-AC-001 test's `hooks.deleteSecret` (`further-stage.test.ts:91`, `_cloud/index.ts:38-43`). The delete succeeded.
- `:102` 03:59:31.866 `GET /api/ref/secret` **200**, 126 ms after the DELETE answered. This is the read at `further-stage.test.ts:98-99`. The test fails here, so `/api/errors/SEC.MISSING` is never requested.

E2. **The test reads once, straight after the delete.** `further-stage.test.ts:90-99`: `deleteSecret` (errors swallowed), then `c.expectError(await c.get(path), …)` with no wait.

E3. **Cloudflare applies a secret change by rolling out a new Worker version, after a delay.** DEC-0092 (`docs/decisions/decision-log.md:658-662`): "Immediately after `wrangler secret put` the Worker still served the version without the secret; a few seconds later the new version (triggered by the secret) served it. Cloud tests that set a secret and then read it poll for the expected result (bounded) instead of reading once." It names SEC-AC-001 in "Affects". DEC-0340 (`decision-log.md:2691`) relies on the same delay. A Worker secret is a binding of a Worker version. `PUT`/`DELETE …/secrets` creates and deploys a new version, and isolates of the previous version keep serving with the previous `env` until the new version reaches them.

E4. **The same deletion is awaited where it passed.** `tests/compliance/criteria/cf/stage-resources.test.ts:119-121` (CF-AC-002): `deleteSecret(b, "apiKey")`, then "DEC-0092: a secret change reaches requests after a short, bounded delay", then `waitFor(… errorCode === "SEC.MISSING" …, { timeoutMs: CLOUD_WAITS.routeToggleMs * 2, intervalMs: 2_000 })`. CF-AC-002 passed in pass 3 (`SUMMARY.md`, Results, record `5tr1c8w0x1b9lai`). So on Cloudflare, `SEC.MISSING` is reached once the new version serves.

E5. **The framework reads the binding on every request. It has no cache across requests.**
- `packages/framework/src/core/assemble.ts:78`: `createServices(c.env, …)` runs in per-request middleware.
- `packages/framework/src/targets/cloudflare/stage.ts:136`: a new `createSecretsService` for each request.
- `packages/framework/src/targets/cloudflare/public.ts:51` → `packages/framework/src/secrets/service.ts:16-21` (`envSecretReader`): reads `env["SECRET_<NAME>"]` on each call.
- `service.ts:62-78`: the `Map` of found values lives inside one service, so one request. A missing or empty value raises `SEC.MISSING` (`:73-75`).
- The route reads it on each request: `apps/reference/src/server/routes/ref.ts:59`, `errors.ts:146-149`.

So the stale value comes from the `env` of the previous Worker version, not from a framework cache.

E6. **The further stage had its own value, not one inherited from the run stage.** `withFurtherStage` (`tests/compliance/criteria/core/support/stages.ts:76-83`) deploys, sets `apiKey` with `secrets set` when the first deploy names it, and deploys again. In the trace, the first deploy (pid 5851) makes three `PUT …/secrets` calls (`:64,68,69`). Those are `ensureFrameworkSecrets` (`packages/framework/src/provision/cloudflare/target.ts:94-104`: session key, then the two R2 credentials). The `apiKey` value comes from pid 6688 (`:72`, `secrets set`), and the second deploy (pid 6717, `:73-92`) makes no secret PUT. Child processes inherit `process.env` (`core/support/processes.ts:31-33`), which includes `COMPLIANCE_SECRET_API_KEY`. No framework code reads that name (`grep -rn COMPLIANCE_SECRET packages/framework/src` finds nothing), and SST never declares `SECRET_*` bindings (`provision/cloudflare/sst.ts:15-17,69`). `keepBindings: ["secret_text","secret_key"]` (`sst.ts:134`) keeps Worker secrets across redeploys, which is what makes the value from `:72` survive the second deploy. Every value the stage held was set explicitly, and the last one was deleted at `:101`.

E7. **SEC.MISSING is reachable on Cloudflare even though deploy requires declared secrets.** The first deploy stops on unset declared secrets (`stages.ts:38-41,77`; DEC-0280 "Sequence", `decision-log.md:3286`). So the only way to reach SEC.MISSING on a cloud is to delete the secret after deploy. The test does that, and CF-AC-002 shows it works once the delay has passed (E4).

## Causal chain
1. The test deletes `SECRET_API_KEY` and gets 200 (E1 `:101`). → Cloudflare creates a new Worker version without the binding and rolls it out over a few seconds (E3).
2. → 126 ms later, the read is served by an isolate of the previous version, whose `env` still has the value (E1 `:102`). The framework reads that `env` per request (E5).
3. → 200 with the hash instead of 500 `SEC.MISSING`. The test reads only once (E2), so it fails, and both IDs it carries (`SEC-AC-001`, `HTTP-AC-002`) are `failed`.

## Alternatives ruled out
- **A framework cache across requests.** Ruled out by E5. Also, SEC-AC-003's read 1.3 s after a PUT already saw the new value (E1 `:97`).
- **The delete failed or targeted the wrong Worker.** Ruled out: 200 on `…/reference-test-sm1igld0v1slpgl/secrets/SECRET_API_KEY` (E1 `:101`). The hook throws on any non-200 (`_cloud/index.ts:42`).
- **The further stage inherited the run stage's secret, or SST re-declared it.** Ruled out by E6.
- **SEC.MISSING unreachable on Cloudflare.** Ruled out by E4 and E7.
- **A requirement problem.** SEC-AC-001's text (`docs/components/secrets.md:68`: "a declared name without a value fails with `SEC.MISSING`", Where "Local, cloud") has no "next request" timing. After the bounded delay, the stage has no value, and the criterion holds as written.

## Proposed fix (minimal, red-green)
Test-only, in `tests/compliance/criteria/secrets/further-stage.test.ts` (C-T1's path):
1. After `deleteSecret` at `:91`, wait with the same bound and form as `cf/stage-resources.test.ts:120`: `await waitFor(async () => ((await c.get("/api/ref/secret")).errorCode === "SEC.MISSING" ? true : undefined), { what: "the further stage answering SEC.MISSING after its secret was deleted", timeoutMs: CLOUD_WAITS.routeToggleMs * 2, intervalMs: 2_000 })`, citing DEC-0092. Then run the existing loop `:98-104` unchanged. That loop makes fresh requests whose request IDs are checked. Import `CLOUD_WAITS` from `../../harness/index.js`.
2. Do not catch every error from `deleteSecret` (`:90-94`). Catch only the "not found" answer (HTTP 404; the hook would have to expose the status), so that an authorization failure is not hidden. This is optional, but it makes the precondition real.

**Red test (local fakes).** The failure exists only on a cloud, because local `.dev.vars` changes need a `dev` restart and SEC-AC-005 is cloud-only. To have a red/green test before pass 2's re-run, put the wait-then-assert step in a small helper in `tests/compliance/criteria/core/support/` (for example `awaitSecretState(c, predicate, what)`). Unit-test it in `core/support/stages.unit.test.ts` with a fake client that answers 200 twice and then 500 `SEC.MISSING`. The test is red with today's single read (`expectError` on the first answer throws) and green with the helper. Use the helper at `further-stage.test.ts:91` and in CF-AC-002 (`stage-resources.test.ts:120`). This is the only red test available without a cloud. It shows the wait, not the platform delay. The platform delay is documented by E1 and DEC-0092.

## How the fix will be verified
- `npx vitest run tests/compliance/criteria/core/support/stages.unit.test.ts`: red, then green.
- The pass-2 re-run on Cloudflare (`--only SEC-AC-001,…,HTTP-AC-002`): the further-stage test reaches 500 `SEC.MISSING` on both paths with two distinct request IDs. SEC-AC-001 and HTTP-AC-002 `passed`. The trace shows one or more 200 reads, then 500s, within 60 s of the DELETE.

## Review

Reviewer: independent root-cause reviewer (prompt §8). I did not write this diagnosis or the code under diagnosis. Base `75c0260`. No Cloudflare call was made. I checked the record against the code, `trace-2-pass2.log:88-104`, `docs/components/secrets.md`, `http.md:76`, DEC-0092 and DEC-0280.

**Verdict: diagnosis confirmed. The fix is accepted with one required correction (R1).**

Evidence checked:
- The trace lines `:94-102` match E1 as stated. The DELETE answered at 03:59:31.740 and the read at 31.866 got 200. The trace logs at response headers, so 126 ms is measured from the DELETE's answer.
- `further-stage.test.ts:90-99` reads once, with no wait (E2). `stage-resources.test.ts:119-121` waits after the same hook (E4).
- The framework reads `env` on every request and has no cross-request cache: `secrets/service.ts:16-21,62-78`, `targets/cloudflare/stage.ts:136` (E5).
- `/api/errors/SEC.MISSING` reads `apiKey` too (`apps/reference/src/server/routes/errors.ts:146-149`). So both paths in the loop depend on the rollout, and both are covered once the wait has passed.

**Does the wait weaken SEC-AC-001 or HTTP-AC-002? No.**
- SEC-AC-001 (`secrets.md:68`) and HTTP-AC-002 (`http.md:76`) are statements about a state. Neither has a timing clause. DEC-0280's readings of HTTP-AC-002 and SEC-AC-001 add none either. Only SEC-AC-005 carries "next request".
- DEC-0092 says by name that SEC-AC-001's cloud tests poll (bounded).
- The wait is only a precondition: "the stage has no value". Every assertion after it is unchanged and made on fresh requests: the status, the code, `errorResponseViolations`, the UUID request ID, and two distinct IDs.
- The predicate accepts only `errorCode === "SEC.MISSING"`, so a stale 200 or any other error cannot satisfy it. A stage that never reaches SEC.MISSING still fails, at the bound.
- Fix item 2 makes the test stricter: it swallows only "not found" from `deleteSecret`. Today an authorization failure would be hidden.

Required correction and remarks:
- **R1 (required).** The `it` at `further-stage.test.ts:86` has no timeout of its own. So it gets `testTimeout: 60_000` (`vitest.integration.config.ts:10`). The proposed `timeoutMs: CLOUD_WAITS.routeToggleMs * 2` is also 60 s, and the hook's own API calls come before it. Vitest would kill the test before `waitFor` can report its bounded failure. Give the `it` an explicit timeout like its siblings (`10 * 60_000`, as at `:66,83`).
- **R2 (advisory).** The bound is DEC-0090's route-toggle constant doubled. DEC-0092 states no number, and compliance.md "Time limits" asks for a bound derived from the behaviour being waited for. A named `CLOUD_WAITS.secretRolloutMs` (60 s, citing DEC-0092) would say what is meant. CF-AC-002, SEC-AC-003 (`:64`) and this test could share it. This is not needed for correctness.
- **R3 (advisory).** A rollout reaches the PoP's machines at slightly different times. So the loop's first read after `waitFor` could, rarely, still hit the old version. If that shows up as a flake, the waiting helper could require two consecutive SEC.MISSING answers. This is not a reason to change the fix now.
- The red test only shows that the helper waits. It does not show the platform delay. The record says so, and that is acceptable.

Owner decision needed: none. The fix is test-only and stays within DEC-0092 and DEC-0280.
