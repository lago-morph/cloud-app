# Decision drafts — fix-auth005

### DEC-PENDING-fix-auth005-1 — AUTH-AC-005's contract part runs over HTTP on every target; its successful-callback response is a cloud not-run part
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: AUTH-AC-005, AUTH-REQ-005, E2E-004, COMPL-AC-001, DEC-0171, plan §8.1, `tests/compliance/criteria/auth/contract.test.ts`, `tests/compliance/harness/expected.ts`, `tests/support/http-schemas.ts`

AUTH-AC-005's Where is "Local, cloud; admin-list part: cloud (milestone)", so its contract part ("`/api/auth/*` responses validate against the HTTP contract") is automated on cloud. Its only tests were in-process (`packages/framework/test/integration/auth/routes-contract.test.ts`), which the cloud selection rightly excludes. Pass 1c therefore recorded AUTH-AC-005 `not-run` on Cloudflare and failed E2E-004's coverage part.

Decision:
- **Location.** The contract part's cloud evidence is `tests/compliance/criteria/auth/contract.test.ts`, target-neutral through `client()`: `GET /api/auth/me` (anonymous, user, admin via mock-login; 200, `no-store`, CurrentUser), `POST /api/auth/mock-login` (204, empty body; four invalid bodies are 400 `HTTP.INVALID_INPUT`), `GET /api/auth/login?returnTo=%2Fafter` (302/303 to `/after` on the target's origin, the mock session of DEC-0171), `GET /api/auth/callback` without a transaction (302 to `/` with `authError=login_failed` and a `requestId`, no session), `POST /api/auth/logout` (204, empty body, with and without a session), and undefined methods (`GET logout`, `DELETE me`, `POST login`, `GET mock-login`: 405 `HTTP.METHOD_NOT_ALLOWED` with `Allow`). Every error assertion checks the exact catalogue status and code, and the ErrorResponse schema. Mock-login tests use per-test IDs (`fix-auth005-*`).
- **Shared schema checks.** `isCurrentUserResponse` and `isErrorResponse` move to `tests/support/http-schemas.ts`, which imports only the error catalogue (`packages/framework/src/core/errors.ts`). The framework AUTH suite's `support.ts` re-exports them; the compliance suite does not import that `support.ts` (it pulls in `createTestApp` and `node:crypto`).
- **No local successful-callback copy.** The local selection already runs `routes-contract.test.ts`, whose stub-provider test covers the successful callback in-process.
- **Part rule.** `{ id: "AUTH-AC-005", targets: CLOUD, mode: "automated", part: "contract part: successful callback (needs a real login provider)", detail: GOOGLE_MOCKED }`. A test stage has the mock and no real provider (DEC-0171), so the 302 to `returnTo` with a session cookie first exists on `prodcheck` with Google, like AUTH-AC-009's cloud production part. It is added to plan §8.1 "for the evaluator to confirm": prompt §4 names only the admin-list part.

Evidence: `ai/implementation/root-causes/2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test.md` (diagnosis and Review, changes 1-5). Red-green in the Review's order: the offline Cloudflare coverage check (`tests/compliance/harness/selection.unit.test.ts`, `uncovered` over `listDriverTests("cloudflare")`) was red with `["AUTH-AC-005"]` until the contract tests landed; the `expected.unit.test.ts` expectation (Cloudflare automated `notRunParts` = that part; local none) was red until the part rule landed. Local driver run `--target local --only AUTH-AC-005,E2E-004`: AUTH-AC-005 and E2E-004 passed (6 new HTTP tests plus the 3 in-process ones). No Cloudflare call was made.

Still to verify in pass 2 on Cloudflare: AUTH-AC-005 `passed` with the not-run part entry above, the admin-list milestone part still outstanding, and E2E-004's coverage part passed.

## Parameter changes

None.
