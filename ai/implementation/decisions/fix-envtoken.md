# Decision drafts — fix-envtoken

### DEC-PENDING-fix-envtoken-1 — Test hooks always send the environment token; PROV-AC-002's restricted-credential clause no longer refuses HTTPS_PROXY (applies DEC-0420)
Origin: ai-proposed · Status: accepted · Affects: DEC-0420, DEC-0083, DEC-0335, DEC-0363, PROV-AC-002, plan §10.6, `tests/compliance/criteria/_cloud/api.ts`, `tests/compliance/criteria/prov/deploy-sequence.test.ts`, `tests/compliance/criteria/prov/support/restricted-token.ts`, `tests/compliance/criteria/mig/support/stage.ts`, `tests/compliance/e2e/support/cloud.ts`

DEC-0420 removed the proxy's token injection for `api.cloudflare.com` and put a real token in `CLOUDFLARE_API_TOKEN`. Code written for DEC-0083 still assumed injection:

- `_cloud/api.ts` `authHeader()` sent no `Authorization` header whenever `HTTPS_PROXY` was set, so every cloud test hook request in the sandbox was unauthenticated (400 since DEC-0420). It now sends `Bearer $CLOUDFLARE_API_TOKEN` whenever the variable is set, proxy or not, and takes the environment as a parameter so it can be unit tested.
- Two further direct Cloudflare API callers sent no header by design ("the proxy injects the token"): the D1 HTTP reads in `mig/support/stage.ts` and the E2E probes in `e2e/support/cloud.ts`. Both now spread `authHeader()` into their headers.
- PROV-AC-002's restricted-credential clause refused to run when `HTTPS_PROXY` was set, because the proxy replaced the restricted token (DEC-0335, DEC-0363). The refusal is removed. The gate moved to `prov/support/restricted-token.ts` (`restrictedToken(env)`); the clause is still `blocked` when `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION` is unset, and runs in the sandbox when the operator supplies it.
- Comments that described the sandbox token as a placeholder the proxy replaces were updated: `packages/framework/src/provision/cloudflare/api.ts`, `environment.ts`, and the module headers above. The framework's own code already sent the bearer token unconditionally; no behaviour change there. Framework unit tests that use the literal fake value `"placeholder"` are fake tokens, not the DEC-0083 convention, and are unchanged.

Not done here: the restricted token itself is not provisioned, so the clause stays `blocked` until the owner supplies one. No live Cloudflare call was made.

Evidence: `tests/compliance/criteria/_cloud/api.unit.test.ts` and `tests/compliance/criteria/prov/support/restricted-token.unit.test.ts` (with `HTTPS_PROXY` and a fake token set, the header is sent / the token is returned; both failed before the fix and pass after). `vitest related` (unit config) 26 files / 204 tests pass; typecheck and lint pass.

## Parameter changes

None.
