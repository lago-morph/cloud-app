# Decision drafts — B-T3 (integration test cases: files, auth, google)

Assumptions the B-T3 suites (`packages/framework/test/integration/{files,auth,google}/`) make where the
requirements, acceptance criteria or contracts are silent or ambiguous. The owner said not to stop for
questions; each entry is the simplest reasonable reading. Implementers (B-11, B-12, B-13, B-16) either
honour it or raise it, and the test is then corrected by a test author, never weakened to pass.

### DEC-PENDING-B-T3-1 — `framework.admins` / `framework.users` reach `createTestApp` through `config.framework`; a rebuild is a new `createTestApp`
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-003, AUTH-AC-012, CFG-AC-005, E2E-007, AUTH-AC-005; testing.d.ts (`TestAppOptions.config`), B-12, B-16

AUTH-AC-012 says "With `createTestApp` using `stubLoginProvider` and `framework.users` set to one user ID", but `TestAppOptions.config` is documented as "Config values overriding the app's defaults. A key the app did not declare makes `createTestApp` throw", and no other option carries the framework lists. Assumption: `config` also accepts the reserved key `framework`, holding the stage-config schema's `framework` object (`{ admins?, users? }`), and it is not an undeclared app key. E2E-007 and AUTH-AC-003 say the redeploy "is a rebuild" locally; the suites treat each `createTestApp` call as one build. CFG-AC-005's "only after the next build" is checked by mutating the very object passed to `createTestApp` after the build (no effect) and then building again (effect). Suggest testing.d.ts document the `framework` key (contract owner: B-16).

### DEC-PENDING-B-T3-2 — The stub login provider's `id` is `"stub"`; base32 case is not compared
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-002; auth.md §2 "User ID", B-12

AUTH-AC-002 requires the ID to match the specified derivation (`u_` + first 26 characters of base32(SHA-256(`<provider id>:<subject>`))), which needs the stub's provider id; no document names it. Assumed `"stub"`. auth.md does not fix the base32 alphabet's letter case, so the suite uses RFC 4648 and compares case-insensitively. "Two providers yield different IDs": locally only the stub completes a non-mock login through `createTestApp` (the Google provider cannot without Google), so the suite checks that the stub's ID is the derivation for its own provider name and differs from the derivation under `"google"`. That is the strongest local form; record it as such for the evaluator.

### DEC-PENDING-B-T3-3 — The stub provider redirects straight to the callback URL; the transaction cookie is the non-session cookie `/api/auth/login` sets
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-005, AUTH-AC-006, AUTH-AC-008, AUTH-AC-010; B-12 (`FW/src/auth/testing.ts`)

auth.md says the stub "speaks no protocol" but not what its `beginLogin` returns. Assumption: its `redirectUrl` is the `callbackUrl` it was given (built from the public origin) plus stub-specific query parameters, so a test can follow `/api/auth/login` → `Location` → `/api/auth/callback` in-process with `TestApp.request` and the transaction cookie. This is how the suites observe the callback URL (AUTH-AC-008), the transaction cookie's attributes (AUTH-AC-006), missing / tampered / crossed / expired transactions and `returnTo` sanitising (AUTH-AC-010). Refused and replayed callbacks use `loginWithStub(…, { stubFailure })`, since only the stub can produce them.

### DEC-PENDING-B-T3-4 — `TestApp` request semantics the suites rely on
Origin: ai-proposed · Status: accepted · Affects: all B-T3 AUTH and FILES tests; testing.d.ts, B-16

- `request(path)` takes the full path including `/api` (e.g. `/api/auth/me`).
- An explicit `Cookie` header in `init` is sent as given and takes precedence over any session the test app keeps.
- Without a `user` option, a session cookie from `/api/auth/mock-login` decides the current user (the mock's default anonymous identity does not override it).
- `loginWithStub` with a `stubFailure` may resolve or reject (the contract does not say); tests accept either and assert only the observable outcome (no session, log entry).
- Failed-login log entries name the fixed reasons with auth.md's words ("transaction missing or expired", "state mismatch", "provider refused", "token exchange rejected", "token check failed"), matched case-insensitively, and carry the failing request's `requestId`.
- Time checks use `Date`; tests fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`) so local storage I/O keeps running (core.md §2 "Testing" says the runner's fake timers govern session and ticket expiry).

### DEC-PENDING-B-T3-5 — AUTH-AC-007's missing-Origin and deployed-router clauses are not testable in-process
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-007; testing.d.ts, C-phase compliance authors

`TestApp.request` always sends the deployment's origin on state-changing requests unless `init` sets one, so a request with no `Origin` cannot be sent through it, and "through the deployed router" needs the `dev` server or a deployed stage. The B-T3 tests cover the in-process ("directly") part: wrong origins (`https://evil.example`, `null`, a look-alike host) rejected with `AUTH.REQUEST_FORGERY` for POST/PUT/PATCH/DELETE and logout, and the public origin accepted. Their titles say "in-process". The missing-Origin clause and the router part are left to the compliance criteria tests against `dev` and the test stage (C-phase), which can send raw HTTP.

### DEC-PENDING-B-T3-6 — FILES browser tests run the in-process app behind a local bridge; an unrelated origin is a `127.0.0.1` page with `<base href>` to the app
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-004 (browser part), FILES-AC-006 (browser part); B-11

`files/browser-harness.ts` serves the bundled `<package>/client` and forwards `/api/*` to `TestApp.request`, at `http://localhost:<port>`. Assumption: local ticket URLs are same-origin (relative, or absolute to the page's origin), as files.md §2 Local says ("a same-origin framework route"). The unrelated origin is `http://127.0.0.1:<other port>`, whose page sets `<base href="<app origin>/">` so the same ticket targets the app's transfer route cross-origin; the browser must refuse it (`uploadFile` → `FILES.TRANSFER_FAILED`, status null, `no response: network or cross-origin blocked`, nothing stored; a download `fetch` fails with `TypeError`). A same-origin control proves the tickets work. Interruption (FILES-AC-006) is the bridge pausing a transfer-route PUT after 2 MiB of a 16 MiB body, then dropping the connection; with bytes already sent, the expected class is `interrupted after n bytes` (0 < n < size) with status null. The harness mechanics were checked against Chromium with a fake app (cross-origin PUT blocked before reaching the server; upload error after ~6 MB reported by XHR progress).

### DEC-PENDING-B-T3-7 — The Google provider is reached as `createGoogleLoginProvider(): LoginProvider` from `FW/src/google/public.ts`
Origin: ai-proposed · Status: accepted · Affects: GOOGLE-AC-001 (local), GOOGLE-AC-002, GOOGLE-AC-003; B-13

No contract names GOOGLE's factory. Assumed a no-argument `createGoogleLoginProvider()` exported from `FW/src/google/public.ts`, returning the internal `LoginProvider` (docs/contracts/ts/internal/login-provider.d.ts); the suite loads it with a dynamic import so the shared type-check stays green until B-13 adds it. Configuration and secret come only through `ProviderContext`: `getConfig` answers `framework.google.clientId` (or the enclosing `framework.google` / `framework` objects), and `getSecret` answers any name containing "google" (case-insensitive) with the client secret. Global `fetch` is stubbed (prompt §4); Google's discovery, JWKS and token endpoints answer from memory, and every other URL is recorded as unexpected and must stay empty, so nothing contacts Google (jose 6's `createRemoteJWKSet` uses global `fetch`). The client ID is obviously fake (`fake-test-client-id.invalid`) and exists only in test files.

### DEC-PENDING-B-T3-8 — GOOGLE-AC-002 also gets an integration form; the "never fetch token URLs" clause is tagged under it
Origin: ai-proposed · Status: accepted · Affects: GOOGLE-AC-002

GOOGLE-AC-002 names unit tests; B-13's unit tests remain its primary evidence. The B-T3 suite feeds the same hand-built tokens through the provider's `completeLogin` (expecting `AUTH.LOGIN_FAILED` for wrong signature, issuer, audience, expired, future issued-at beyond PAR-252, wrong or missing nonce), with controls that tokens inside the 60 s skew and the documented issuer `accounts.google.com` are accepted. GOOGLE-REQ-002's "MUST NOT fetch URLs taken from the token" is checked in a test tagged GOOGLE-AC-002 (a token with `jku`/`x5u` headers), because no AC names that clause.

### DEC-PENDING-B-T3-9 — Parts of B-T3 criteria covered elsewhere or not-run
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-005, AUTH-AC-009, GOOGLE-AC-001, FILES-AC-004, FILES-AC-006

- AUTH-AC-005: contract part only. No OpenAPI/JSON-Schema validator is a declared dependency (ajv is only transitive), so `auth/support.ts` hand-codes the `CurrentUser` and `ErrorResponse` schemas of framework.openapi.yaml; keep them in step with the YAML. Admin-list part: cloud milestone, not-run ("Google login mocked for this phase").
- AUTH-AC-009: local part (mock-login works with the identity used as given). The production-404 and "production bundles contain no mock" parts need a production build: bundle inspection is CORE-AC-006 (B-T4); the cloud production part is not-run.
- GOOGLE-AC-001: local part (redirect parameters and the token request with the client secret and PKCE verifier). The certification step-1 check against a production deployment is not-run.
- FILES-AC-004 / FILES-AC-006: the "type inspection" and "server part" tests are Vitest; the browser parts are Playwright (`files/transfers.spec.ts`, project `integration`). FILES-AC-004's forbidden vocabulary (storage services, signing, credentials, CORS, bindings) is the list in `files/app-facing-types.test.ts`.

## Parameter changes

None.
