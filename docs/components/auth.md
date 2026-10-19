# AUTH — Current user

Classifies every request as anonymous, user, or admin and gives app code a stable opaque user ID. Owns login and logout, sessions, request-forgery protection, the login-provider interface, and the authentication mock. All protocol details live behind the provider interface.

Contracts: [auth.d.ts](../contracts/ts/auth.d.ts), [client.d.ts](../contracts/ts/client.d.ts) (`getCurrentUser`, `login`, `logout`), [framework.openapi.yaml](../contracts/http/framework.openapi.yaml) (`/api/auth/*`), [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts), [testing.d.ts](../contracts/ts/testing.d.ts) (`mockUsers`, stub login provider), [errors.d.ts](../contracts/ts/errors.d.ts) (`AUTH.*`).

## 1. Requirements

#### AUTH-REQ-001 — App sees only the current user
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-017

`c.var.user` MUST be a `CurrentUser` carrying only the access level, the user ID, and an optional display name. No framework interface available to app code may expose the provider, protocol, tokens, email addresses, or validation results.

#### AUTH-REQ-002 — Stable opaque user ID
Origin: owner · Derives from: SYS-REQ-017

The user ID MUST be derived deterministically from the provider's name and the provider's stable identifier for the person. It is the same in every stage and target, cannot be reversed into the provider identifier, and changes if the person signs in through a different provider.

#### AUTH-REQ-003 — Admin by configuration
Origin: owner · Derives from: SYS-REQ-017, SYS-REQ-018 · Decision: DEC-0080

With a real provider, a logged-in user MUST be `admin` exactly when their user ID is in the configured admin list, evaluated on every request. When the optional `framework.users` list is present, a validated login whose ID is in neither `framework.users` nor `framework.admins` MUST be treated as anonymous, also evaluated on every request. Without the list, level `user` means any account the login provider accepts. With the authentication mock, the level chosen by the test is used directly (AUTH-REQ-009).

#### AUTH-REQ-004 — Route protection
Origin: provenance-unclear · Derives from: SYS-REQ-010, SYS-REQ-017

`requireUser()` MUST reject anonymous requests with 401 `AUTH.UNAUTHENTICATED`. `requireAdmin()` MUST additionally reject users with 403 `AUTH.FORBIDDEN`. `requireCurrentUser(c)` MUST return the logged-in user, or throw `AUTH.UNAUTHENTICATED` for an anonymous request.

#### AUTH-REQ-005 — Framework routes and "who am I"
Origin: owner · Derives from: SYS-REQ-018 · Decision: DEC-0080

The framework MUST provide the `/api/auth/*` routes in the HTTP contract. `/api/auth/me` MUST show a logged-in user their user ID, including a validated login that `framework.users` makes anonymous. The skill and the app template's README MUST give copy-and-paste steps for adding that ID to the admin list or to `framework.users`.

#### AUTH-REQ-006 — Sessions
Origin: owner-approved · Derives from: SYS-REQ-017

After a successful login, the framework MUST keep the user logged in with a signed session cookie that lasts PAR-250. The cookie MUST be HttpOnly and SameSite=Lax, and on cloud targets also Secure and host-only. No session may be created before the provider has validated the login. Logout MUST clear the cookie. Sessions are stateless: a copied cookie stays valid until it expires (DEC-0028).

#### AUTH-REQ-007 — Request forgery protection
Origin: provenance-unclear · Derives from: SYS-REQ-017

A state-changing request (POST, PUT, PATCH, DELETE) that carries a session MUST be rejected with `AUTH.REQUEST_FORGERY` unless its `Origin` header equals the deployment's public origin. Together with SameSite=Lax session cookies, this is the whole protection (DEC-0072). State-changing behavior on GET routes is not allowed, except the framework's `/api/auth/login` and `/api/auth/callback`, which set login cookies; the callback is protected by the transaction state.

#### AUTH-REQ-008 — Provider interface
Origin: owner · Derives from: SYS-REQ-019

Each login provider MUST implement the internal provider interface. All protocol validation MUST happen inside the provider. The callback URL MUST be built from the deployment's resolved public origin, never from request headers.

#### AUTH-REQ-009 — Authentication mock
Origin: owner · Derives from: SYS-REQ-020

A mock provider and the `/api/auth/mock-login` route MUST let tests choose any identity — access level, user ID (used as given, not derived), and display name — without contacting a real provider. Both MUST be present only locally and in test stages, and MUST be absent from production deployments.

#### AUTH-REQ-010 — Failed login
Origin: provenance-unclear · Derives from: SYS-REQ-010

A failed login MUST NOT create a session. It MUST redirect to `/?authError=login_failed&requestId=<id>`, where `<id>` is the request's ID, and log the provider's reason without exposing it to the browser.

## 2. Design

**Levels.** Without `framework.users`, level `user` means any account the login provider accepts, not a person this app trusts. An app that should admit only known people lists their IDs in `framework.users` (CFG). With the list present, a login on neither list still gets a session, but every request with it is anonymous: `c.var.user` is `{ level: "anonymous" }`, and guarded routes answer 401 `AUTH.UNAUTHENTICATED`. Like admin status, membership is evaluated per request, so adding or removing an ID takes effect at the next deploy without logging anyone out. `/api/auth/me` alone also returns such a login's ID, as `unlistedId` (HTTP contract), so the person can copy it for the owner; app code never sees it (AUTH-REQ-001).

**User ID.** `u_` followed by the first 26 characters of the base32 encoding of SHA-256(`<provider id>:<subject>`) (DEC-0067).

**Login.**
1. `/api/auth/login` asks the stage's provider to begin a login.
2. It stores the provider's transaction state, the sanitized `returnTo` path, and an expiry (PAR-251) in a signed transaction cookie, and redirects. The transaction cookie has the session cookie's attributes: HttpOnly, SameSite=Lax (mandatory, so that the provider's redirect back carries it), and on cloud targets a `__Host-` name, Secure, Path=/, and no Domain. It is named `__Host-login` on cloud targets and `login_local` locally (DEC-PENDING-B-12-2).
3. `/api/auth/callback` verifies the transaction cookie, asks the provider to complete the login, creates the session, clears the transaction cookie, and redirects to `returnTo`.

A new login replaces any login in progress.

**Failed login.** The log entry names one fixed reason: transaction missing or expired; state mismatch; provider refused; token exchange rejected, with its HTTP status; or token check failed, naming the check. It never contains authorization codes, state, or tokens. It is one `warn` entry with component `AUTH` and message `login failed: <reason>`; an invalid or tampered transaction cookie counts as "transaction missing or expired". The transaction cookie is cleared by every callback, successful or not (DEC-PENDING-B-12-3).

**Session cookie.** Named `__Host-session` on cloud targets and `session_local` locally. It holds a format version, user ID, display name, issued-at and expiry times, signed with HMAC-SHA-256 using the framework-internal session key (at least PAR-253 bytes, SEC). There is a single key; replacing it logs everyone out, which is acceptable at this scale. Admin status is not stored in the session; it is evaluated per request (AUTH-REQ-003). A future issued-at beyond PAR-252 makes the cookie invalid. A session created by the authentication mock also holds the level the test chose; such a session is honoured only where the mock is installed (DEC-PENDING-B-12-4).

**Request forgery.** Browsers send `Origin` on state-changing requests; the check compares it with the resolved public origin. No token is used (DEC-0072). A request "carries a session" when it sends a session cookie, valid or not, or when `createTestApp` gives it a fixed logged-in identity (DEC-PENDING-B-12-5).

**More than one provider.** If a deployment is later configured with several real providers, `/api/auth/login` shows a framework-owned page for choosing one. The app-facing contracts (`login()`, `/api/auth/login`) do not change.

**Provider per stage.** Production deployments use the real provider (GOOGLE). Test stages (stages named `test-*`, PROV-REQ-005) and local development use the mock. `createTestApp` installs the mock directly. Installing the mock on any other stage is `CORE.MISCONFIGURED`. With the mock and no real provider, `/api/auth/login` logs in as the mock's default user and returns to `returnTo` (DEC-PENDING-B-12-6). The `./testing` subpath and the mock module are excluded from production bundles (CORE-REQ-006).

**Stub provider.** Because the mock bypasses ID derivation and the admin list, real-provider paths are tested locally with a test-only stub provider that implements [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts). It is available only under `./testing` and speaks no protocol: its provider id is `stub`, its login redirects straight to the callback URL it was given with a fresh `state` and single-use `code`, and the subject, display name and failure to simulate are query parameters that `loginWithStub` adds (DEC-PENDING-B-12-7). Local tests use it to verify admin-list and users-list evaluation, callback-URL building under a forged Host header, failed and replayed callbacks, and per-provider ID derivation. On each cloud, the production-check stage (`prodcheck`, COMPL) keeps only the checks that need no login.

## 3. Uses

HTTP (routes, error handler), CFG (admin list, users list, public origin), CORE (test-stage flag, derived from the stage name: PROV-REQ-005), SEC (session key), LOG (failed logins), GOOGLE (real provider).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AUTH-AC-001 | Type inspection and a reference route dumping `c.var.user` show only the specified fields at each access level. A handler behind `requireUser()`, or one calling `requireCurrentUser(c)`, reads the user ID without a type assertion. | AUTH-REQ-001 | Local |
| AUTH-AC-002 | With the stub provider, the same provider and subject always yield the same user ID, matching the specified derivation; two subjects or two providers yield different IDs. | AUTH-REQ-002 | Local |
| AUTH-AC-003 | With the stub provider, adding and removing a user ID in the admin list (with rebuild) changes that user's level accordingly. | AUTH-REQ-003 | Local |
| AUTH-AC-004 | Protected reference routes return 401 and 403 as specified for each level. `requireCurrentUser(c)` returns the user when logged in and throws `AUTH.UNAUTHENTICATED` when anonymous. | AUTH-REQ-004 | Local, cloud |
| AUTH-AC-005 | `/api/auth/*` responses validate against the HTTP contract. Admin-list part, a milestone item run on each cloud's `prodcheck` stage: following the documented steps, a tester copies their ID from `/api/auth/me` into the admin list, commits the change to `config/<target>/prodcheck.json`, and gains admin after redeploy. | AUTH-REQ-005 | Local, cloud; admin-list part: cloud (milestone) |
| AUTH-AC-006 | On each target, session and transaction cookie attributes are as specified, a tampered session cookie is treated as anonymous, and logout clears the cookie. Locally, expired and future-dated session cookies are also treated as anonymous. | AUTH-REQ-006 | Local, cloud |
| AUTH-AC-007 | A POST with a session is rejected when `Origin` is missing or wrong and accepted when it equals the public origin, both directly and through the deployed router. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-008 | With the stub provider, the callback URL it receives is built from the public origin despite a forged Host header. | AUTH-REQ-008 | Local |
| AUTH-AC-009 | `/api/auth/mock-login` works on test stages and returns 404 on a production deployment. Production bundles contain no mock module. | AUTH-REQ-009 | Local, cloud |
| AUTH-AC-010 | With the stub provider, a refused callback and one with a missing, invalid, or replayed transaction create no session, redirect as specified, and write a log entry naming one fixed reason. Login with `returnTo` set to `//evil.example`, `/\evil.example`, `https://evil.example`, `/%2F%2Fevil.example`, or `javascript:` redirects to `/` after login. | AUTH-REQ-010 | Local |
| AUTH-AC-011 | On each cloud's `prodcheck` stage, `/api/auth/login` with a forged Host header redirects with the correct callback URL, and a bogus callback creates no session and redirects as specified. | AUTH-REQ-008, AUTH-REQ-010 | Cloud |
| AUTH-AC-012 | With `createTestApp` using `stubLoginProvider` and `framework.users` set to one user ID: after `loginWithStub` as the subject with that ID, the level is `user`; as a subject whose ID is only in `framework.admins`, the level is `admin`; as any other subject, the request is anonymous (a `requireUser()` route returns 401 `AUTH.UNAUTHENTICATED`, and `/api/auth/me` returns level `anonymous` with the login's ID as `unlistedId`). Without `framework.users`, every validated login is at least `user`. | AUTH-REQ-003, AUTH-REQ-005 | Local |

## 5. Portability note

AUTH depends on no cloud service: it needs only HTTP, a secret, and configuration. A new login provider is one adapter behind the provider interface. A new target needs no AUTH changes.
