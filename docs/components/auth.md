# AUTH — Current user

Classifies every request as anonymous, user, or admin and gives app code a stable opaque user ID. Owns login and logout, sessions, request-forgery protection, the login-provider interface, and the authentication mock. All protocol details live behind the provider interface.

Contracts: [auth.d.ts](../contracts/ts/auth.d.ts), [client.d.ts](../contracts/ts/client.d.ts) (`getCurrentUser`, `login`, `logout`), [framework.openapi.yaml](../contracts/http/framework.openapi.yaml) (`/api/auth/*`), [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts), [testing.d.ts](../contracts/ts/testing.d.ts) (`mockUsers`), [errors.d.ts](../contracts/ts/errors.d.ts) (`AUTH.*`).

## 1. Requirements

#### AUTH-REQ-001 — App sees only the current user
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-017

`c.var.user` MUST be a `CurrentUser` carrying only the access level, the user ID, and an optional display name. No framework interface available to app code may expose the provider, protocol, tokens, email addresses, or validation results.

#### AUTH-REQ-002 — Stable opaque user ID
Origin: owner · Derives from: SYS-REQ-017

The user ID MUST be derived deterministically from the provider's name and the provider's stable identifier for the person. It is the same in every stage and target, cannot be reversed into the provider identifier, and changes if the person signs in through a different provider.

#### AUTH-REQ-003 — Admin by configuration
Origin: owner · Derives from: SYS-REQ-017, SYS-REQ-018

With a real provider, a logged-in user MUST be `admin` exactly when their user ID is in the configured admin list, evaluated on every request. With the authentication mock, the level chosen by the test is used directly (AUTH-REQ-009).

#### AUTH-REQ-004 — Route protection
Origin: provenance-unclear · Derives from: SYS-REQ-010, SYS-REQ-017

`requireUser()` MUST reject anonymous requests with 401 `AUTH.UNAUTHENTICATED`. `requireAdmin()` MUST additionally reject users with 403 `AUTH.FORBIDDEN`.

#### AUTH-REQ-005 — Framework routes and "who am I"
Origin: owner · Derives from: SYS-REQ-018

The framework MUST provide the `/api/auth/*` routes in the HTTP contract. `/api/auth/me` MUST show a logged-in user their user ID. The skill and the app template's README MUST give copy-and-paste steps for adding that ID to the admin list.

#### AUTH-REQ-006 — Sessions
Origin: owner-approved · Derives from: SYS-REQ-017

After a successful login, the framework MUST keep the user logged in with a signed session cookie that lasts PAR-250. The cookie MUST be HttpOnly and SameSite=Lax, and on cloud targets also Secure and host-only. No session may be created before the provider has validated the login. Logout MUST clear the cookie. Sessions are stateless: a copied cookie stays valid until it expires (DEC-0028).

#### AUTH-REQ-007 — Request forgery protection
Origin: provenance-unclear · Derives from: SYS-REQ-017

A state-changing request (POST, PUT, PATCH, DELETE) that carries a session MUST be rejected with `AUTH.REQUEST_FORGERY` unless its `Origin` header equals the deployment's public origin. Together with SameSite=Lax session cookies, this is the whole protection (DEC-0072). State-changing behavior on GET routes, including the framework's own, is not allowed.

#### AUTH-REQ-008 — Provider interface
Origin: owner · Derives from: SYS-REQ-019

Each login provider MUST implement the internal provider interface. All protocol validation MUST happen inside the provider. The callback URL MUST be built from the deployment's resolved public origin, never from request headers.

#### AUTH-REQ-009 — Authentication mock
Origin: owner · Derives from: SYS-REQ-020

A mock provider and the `/api/auth/mock-login` route MUST let tests choose any identity — access level, user ID (used as given, not derived), and display name — without contacting a real provider. Both MUST be present only locally and in test stages, and MUST be absent from production deployments.

#### AUTH-REQ-010 — Failed login
Origin: provenance-unclear · Derives from: SYS-REQ-010

A failed login MUST NOT create a session. It MUST redirect to `/?authError=login_failed` and log the provider's reason without exposing it to the browser.

## 2. Design

**User ID.** `u_` followed by the first 26 characters of the base32 encoding of SHA-256(`<provider id>:<subject>`) (DEC-0067).

**Login.**
1. `/api/auth/login` asks the stage's provider to begin a login.
2. It stores the provider's transaction state, the sanitized `returnTo` path, and an expiry (PAR-251) in a signed, HttpOnly transaction cookie, and redirects.
3. `/api/auth/callback` verifies the transaction cookie, asks the provider to complete the login, creates the session, clears the transaction cookie, and redirects to `returnTo`.

A new login replaces any login in progress.

**Session cookie.** Named `__Host-session` on cloud targets and `session_local` locally. It holds a format version, user ID, display name, issued-at and expiry times, signed with HMAC-SHA-256 using the framework-internal session key (at least PAR-253 bytes, SEC). There is a single key; replacing it logs everyone out, which is acceptable at this scale. Admin status is not stored in the session; it is evaluated per request (AUTH-REQ-003).

**Request forgery.** Browsers send `Origin` on state-changing requests; the check compares it with the resolved public origin. No token is used (DEC-0072).

**More than one provider.** If a deployment is later configured with several real providers, `/api/auth/login` shows a framework-owned page for choosing one. The app-facing contracts (`login()`, `/api/auth/login`) do not change.

**Provider per stage.** Production deployments use the real provider (GOOGLE). Test stages and local development use the mock. `createTestApp` installs the mock directly. The `./testing` subpath and the mock module are excluded from production bundles (CORE-REQ-006).

## 3. Uses

HTTP (routes, error handler), CFG (admin list, public origin, test-stage flag), SEC (session key), LOG (failed logins), GOOGLE (real provider).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AUTH-AC-001 | Type inspection and a reference route dumping `c.var.user` show only the specified fields at each access level. | AUTH-REQ-001 | Local |
| AUTH-AC-002 | The same mock identity yields the same user ID on local, Cloudflare, and AWS test stages; two subjects or two providers yield different IDs. | AUTH-REQ-002 | Local, cloud |
| AUTH-AC-003 | Adding and removing a user ID in the admin list (with redeploy) changes that user's level accordingly. | AUTH-REQ-003 | Local, cloud |
| AUTH-AC-004 | Protected reference routes return 401 and 403 as specified for each level. | AUTH-REQ-004 | Local, cloud |
| AUTH-AC-005 | `/api/auth/*` responses validate against the HTTP contract. Following the documented steps, a tester copies their ID from `/api/auth/me` into the admin list and gains admin after redeploy. | AUTH-REQ-005 | Local, cloud |
| AUTH-AC-006 | Cookie attributes are as specified on each target. Tampered, expired, and future-dated session cookies are treated as anonymous. Logout clears the cookie. | AUTH-REQ-006 | Local, cloud |
| AUTH-AC-007 | A POST with a session is rejected when `Origin` is missing or wrong and accepted when it equals the public origin, both directly and through the deployed router. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-008 | The callback URL is unaffected by a forged Host header. | AUTH-REQ-008 | Local, cloud |
| AUTH-AC-009 | `/api/auth/mock-login` works on test stages and returns 404 on a production deployment. Production bundles contain no mock module. | AUTH-REQ-009 | Local, cloud |
| AUTH-AC-010 | A callback with an invalid or replayed transaction creates no session, redirects as specified, and writes a log entry. | AUTH-REQ-010 | Local, cloud |

## 5. Portability note

AUTH depends on no cloud service: it needs only HTTP, a secret, and configuration. A new login provider is one adapter behind the provider interface. A new target needs no AUTH changes.
