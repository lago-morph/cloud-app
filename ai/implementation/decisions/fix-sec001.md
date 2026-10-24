# Decision drafts — fix-sec001

### DEC-PENDING-fix-sec001-1 — The cloud SEC-AC-001 / HTTP-AC-002 test waits, bounded, for SEC.MISSING after deleting the secret; `CLOUD_WAITS.secretRolloutMs` names the DEC-0092 bound
Origin: ai-proposed · Status: accepted · Affects: DEC-0092, DEC-0280, SEC-AC-001, HTTP-AC-002, `tests/compliance/criteria/secrets/further-stage.test.ts`, `tests/compliance/criteria/core/support/secrets.ts`, `tests/compliance/harness/wait.ts`

Pass 2 failed SEC-AC-001 and HTTP-AC-002 because the further-stage test read `/api/ref/secret` once, 126 ms after `DELETE …/secrets/SECRET_API_KEY` answered 200. Cloudflare was still serving the previous Worker version, which has the secret (DEC-0092). The test was the only cloud secret-deletion check that did not wait. CF-AC-002 already waits.

Change (test-only):
- New helper `expectSecretMissing(c)` in `core/support/secrets.ts`. It first waits, using `waitFor` with `timeoutMs: CLOUD_WAITS.secretRolloutMs` and `intervalMs: 2_000`, until `GET /api/ref/secret` passes `c.expectError(…, catalogueStatus("SEC.MISSING"), "SEC.MISSING")`. Only that status with that code ends the wait. A stale 200, another code, SEC.MISSING with another status, or a body without a code all keep it waiting. If the bound passes, the test fails, and the timeout message carries the last HTTP check failure. After the wait, the earlier assertions run unchanged on fresh requests to both paths: status and code, `errorResponseViolations`, a UUID request ID, and two distinct IDs.
- `further-stage.test.ts`: the SEC-AC-001 / HTTP-AC-002 `it` calls the helper after `deleteSecret`. It gets its own `10 * 60_000` timeout (Review R1). Without that, the integration default of 60 s would stop the test before the 60 s wait could report.
- `CLOUD_WAITS.secretRolloutMs = 60_000` (DEC-0092; twice the route toggle's bound, the value CF-AC-002 uses inline). This follows Review R2. CF-AC-002 and SEC-AC-003 keep their inline bounds, which have the same value. Moving them to the constant is a later cleanup, not part of this fix.

Not changed:
- SEC-AC-005's test. Its "next request" wording waits on an owner decision (see that test's own root-cause record).
- `deleteSecret`'s catch-all (root cause, fix item 2, optional). It still hides an authorization failure, but the wait now catches that case anyway: the stage never answers SEC.MISSING, and the test fails at the bound.
- R3 (two consecutive SEC.MISSING answers). This is not adopted. Revisit it only if a flake shows up.

Red-green (local fakes, no cloud call): `tests/compliance/criteria/core/support/secrets.unit.test.ts`. The fake stage keeps answering 200 with the old hash for the first 2 requests after the delete, then answers SEC.MISSING.
- With the helper as the old single read, the test failed with pass 2's exact error: `GET /api/ref/secret → status 200, code none … (expected status 500 with code SEC.MISSING)`. 7 of 10 tests were red.
- With the wait, all of them pass.
- Further cases prove the wait accepts only SEC.MISSING, and that a stage which never reaches it fails at 60 s. Two more cases show the assertions after the wait still fail on an empty request ID and on a repeated one.

These tests show the wait, not Cloudflare's rollout delay. The delay is documented by the trace and by DEC-0092.

Still to verify live: the pass-2 re-run (`--only SEC-AC-001,HTTP-AC-002`) passes on the further stage.

Evidence: `ai/implementation/root-causes/2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early.md` (diagnosis and Review R1–R3).

## Parameter changes

None. The new value is a test-harness wait bound (`CLOUD_WAITS`), not a parameter.
