# AUTH — Current user

Classifies every request as anonymous, user, or admin and gives app code a stable opaque user ID. Owns login and logout, sessions, request-forgery protection, the login-provider interface, and the authentication mock. All protocol details live behind the provider interface.

Contracts: [auth.d.ts](../contracts/ts/auth.d.ts), [client.d.ts](../contracts/ts/client.d.ts) (`getCurrentUser`, `login`, `logout`), [framework.openapi.yaml](../contracts/http/framework.openapi.yaml) (`/api/auth/*`), [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts) (`LoginProvider`, `CredentialProvider`), [internal/auth-password.openapi.yaml](../contracts/http/internal/auth-password.openapi.yaml) (the password provider's pages and endpoints, PWD), [testing.d.ts](../contracts/ts/testing.d.ts) (`mockUsers`, stub login provider, password provider, `grantRole` and `revokeRole`), [errors.d.ts](../contracts/ts/errors.d.ts) (`AUTH.*`).

## 1. Requirements

#### AUTH-REQ-001 — App sees only the current user
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-017

`c.var.user` MUST be a `CurrentUser` carrying only the access level, the user ID, and an optional display name. No framework interface available to app code may expose the provider, protocol, tokens, email addresses, or validation results.

#### AUTH-REQ-002 — Stable opaque user ID
Origin: owner · Derives from: SYS-REQ-017

The user ID MUST be derived deterministically from the provider's name and the provider's stable identifier for the person. It is the same in every stage and target, cannot be reversed into the provider identifier, and changes if the person signs in through a different provider.

#### AUTH-REQ-003 — Levels from the account (amended; formerly admin by configuration)
Origin: owner · Derives from: SYS-REQ-017, SYS-REQ-018 · Decision: DEC-0080 (superseded), DEC-0521, DEC-0522, DEC-0524

With a real provider, a logged-in user MUST be `admin` exactly when their user ID is in the configured admin list, evaluated on every request. When the optional `framework.users` list is present, a validated login whose ID is in neither `framework.users` nor `framework.admins` MUST be treated as anonymous, also evaluated on every request. Without the list, level `user` means any account the login provider accepts. With the authentication mock, the level chosen by the test is used directly (AUTH-REQ-009).

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522; the per-request read: ai-proposed, DEC-0524): the paragraph above is replaced by the following. There is no admin list and no users list. With a real provider, the level MUST be evaluated on every request from the account's current state, read through the provider:
- `anonymous`: the request has no valid session, or its session's account does not exist or is not verified;
- `user`: a valid session whose account exists and is verified;
- `admin`: a user whose role list contains `admin`.

A grant or revoke MUST take effect on the next request, with no new login. The account MUST be read at most once per request, and only for a request that carries a valid session (good signature, not expired) from a real provider. A request without one MUST cause no database read for its level. If the read fails, the request MUST be anonymous. With the authentication mock, the level chosen by the test is used directly, with no read (AUTH-REQ-009).

#### AUTH-REQ-004 — Route protection
Origin: provenance-unclear · Derives from: SYS-REQ-010, SYS-REQ-017

`requireUser()` MUST reject anonymous requests with 401 `AUTH.UNAUTHENTICATED`. `requireAdmin()` MUST additionally reject users with 403 `AUTH.FORBIDDEN`. `requireCurrentUser(c)` MUST return the logged-in user, or throw `AUTH.UNAUTHENTICATED` for an anonymous request.

#### AUTH-REQ-005 — Framework routes and "who am I"
Origin: owner · Derives from: SYS-REQ-018 · Decision: DEC-0080 (superseded), DEC-0521, DEC-0522, DEC-0523

The framework MUST provide the `/api/auth/*` routes in the HTTP contract. `/api/auth/me` MUST show a logged-in user their user ID, including a validated login that `framework.users` makes anonymous. The skill and the app template's README MUST give copy-and-paste steps for adding that ID to the admin list or to `framework.users`.

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522, DEC-0523): there are no lists to copy an ID into. `/api/auth/me` MUST show a logged-in user their level and user ID, and MUST NOT return `unlistedId`. The skill and the app template's README MUST give copy-and-paste steps for granting and revoking the `admin` role with the `admins` command (CLI-REQ-005).

#### AUTH-REQ-006 — Sessions
Origin: owner-approved · Derives from: SYS-REQ-017

After a successful login, the framework MUST keep the user logged in with a signed session cookie that lasts PAR-250. The cookie MUST be HttpOnly and SameSite=Lax, and on cloud targets also Secure and host-only. No session may be created before the provider has validated the login. Logout MUST clear the cookie. Sessions are stateless: a copied cookie stays valid until it expires (DEC-0028).

#### AUTH-REQ-007 — Request forgery protection
Origin: provenance-unclear · Derives from: SYS-REQ-017 · Decision: DEC-0516

A state-changing request (POST, PUT, PATCH, DELETE) that carries a session MUST be rejected with `AUTH.REQUEST_FORGERY` unless its `Origin` header equals the deployment's public origin. Every POST to a path under `/api/auth/` MUST be rejected in the same way whether or not it carries a session, so that no sign-in, sign-up, verification, reset or resend can be submitted from another site (login forgery). Together with SameSite=Lax session cookies, this is the whole protection (DEC-0072); the credential library's own origin check is not relied on. State-changing behavior on GET routes is not allowed, except the framework's `/api/auth/login` and `/api/auth/callback`, which set login cookies; the callback is protected by the transaction state.

#### AUTH-REQ-008 — Provider interface
Origin: owner · Derives from: SYS-REQ-019

Each login provider MUST implement the internal provider interface. All protocol validation MUST happen inside the provider. The callback URL MUST be built from the deployment's resolved public origin, never from request headers.

Amendment for release 1 (Origin: owner · Decision: DEC-0509, DEC-0510): a provider implements either the redirect interface (`LoginProvider`) or the credential interface (`CredentialProvider`); release 1's real provider, PWD, is a credential provider. All credential validation MUST happen inside the provider, the provider MUST return only a stable identifier and a display name, and links the provider sends by email MUST be built from the deployment's resolved public origin, never from request headers.

#### AUTH-REQ-009 — Authentication mock
Origin: owner · Derives from: SYS-REQ-020

A mock provider and the `/api/auth/mock-login` route MUST let tests choose any identity — access level, user ID (used as given, not derived), and display name — without contacting a real provider. Both MUST be present only locally and in test stages, and MUST be absent from production deployments.

#### AUTH-REQ-010 — Failed login
Origin: provenance-unclear · Derives from: SYS-REQ-010 · Decision: DEC-0516

A failed login MUST NOT create a session, and MUST log the provider's reason without exposing it to the browser. A failed redirect-provider login MUST redirect to `/?authError=login_failed&requestId=<id>`, where `<id>` is the request's ID. A failed credential sign-in MUST answer as the internal HTTP contract specifies: a catalogue error in JSON, or a redirect to the sign-in page with a generic message for a form; both are identical for an unknown account and a wrong password (PWD-REQ-005).

## 2. Design

**Levels** (DEC-0521, DEC-0522, DEC-0524). Anyone who signs up and verifies their address is a `user`. An admin is a user whose account holds the role `admin`. "user" is a level, not a role: a new account has no roles, and nothing writes `user` into the role list. The levels are:
- `anonymous`: no valid session;
- `user`: a valid session for an existing, verified account;
- `admin`: a user whose role list contains `admin`.

There is no admin list or users list in configuration (CFG-REQ-005).

**How the level is evaluated.** On each request, AUTH first checks the session cookie: signature, format version and expiry. Then:
- With no session cookie, or an invalid one, the request is anonymous, and nothing is read.
- A session made by the authentication mock carries its level, which is used as is, with no read. Only test stages and local builds have the mock (AUTH-REQ-009).
- A valid real-provider session names its provider and the provider's subject. AUTH asks that provider for `accountStatus(subject)` (internal/login-provider.d.ts), once per request; the result is kept for the rest of that request only.
  - An unknown account (`null`) or an unverified one makes the request anonymous.
  - Otherwise the level is `user`, or `admin` when the roles include `admin`.
  - The password provider answers with one primary-key read of `__framework_auth_user` (`email_verified`, `role`; PWD §2).
- If the read fails, the request is anonymous. One `warn` entry with component `AUTH` and message `role lookup failed (<code>)` names the error code (never the subject).

So a grant or a revoke through `admins` (CLI-REQ-005) takes effect on the person's next request, with no new login and no deploy. The cost is one D1 read per authenticated request, which DEC-0524 accepts against DEC-0028's stateless sessions for low-volume apps. Sessions stay stateless: a revoke lowers a copied session's level on its next request, but does not end it.

**Role list.** The role column holds role names separated by commas, and is NULL when there are none. AUTH splits it on commas, trims each name and drops empty ones. `admin` is the only name it acts on; unknown names are ignored, so a later release can add roles without breaking older code.

**User ID.** `u_` followed by the first 26 characters of the base32 encoding of SHA-256(`<provider id>:<subject>`) (DEC-0067).

**Login.**
1. `/api/auth/login` asks the stage's provider to begin a login.
2. It stores the provider's transaction state, the sanitized `returnTo` path, and an expiry (PAR-251) in a signed transaction cookie, and redirects. The transaction cookie has the session cookie's attributes: HttpOnly, SameSite=Lax (mandatory, so that the provider's redirect back carries it), and on cloud targets a `__Host-` name, Secure, Path=/, and no Domain. It is named `__Host-login` on cloud targets and `login_local` locally (DEC-0167).
3. `/api/auth/callback` verifies the transaction cookie, asks the provider to complete the login, creates the session, clears the transaction cookie, and redirects to `returnTo`.

A new login replaces any login in progress.

**Credential login** (PWD, DEC-0510). `/api/auth/login` redirects to the framework's sign-in page (`/api/auth/sign-in`), carrying the sanitized `returnTo`. The page's form posts to `/api/auth/password/sign-in`; AUTH passes the credentials to the stage's `CredentialProvider`, derives the user ID from `password` and the returned subject, creates the session, and redirects to `returnTo` (or answers JSON). No transaction cookie is used. Sign-up, verification, resend, forgot and reset are PWD's endpoints and create no session.

**Failed login.** The log entry names one fixed reason: transaction missing or expired; state mismatch; provider refused; token exchange rejected, with its HTTP status; or token check failed, naming the check. It never contains authorization codes, state, or tokens. It is one `warn` entry with component `AUTH` and message `login failed: <reason>`; an invalid or tampered transaction cookie counts as "transaction missing or expired". The transaction cookie is cleared by every callback, successful or not (DEC-0168).

**Session cookie.** Named `__Host-session` on cloud targets and `session_local` locally. It holds a format version, user ID, display name, issued-at and expiry times, signed with HMAC-SHA-256 using the framework-internal session key (at least PAR-253 bytes, SEC). There is a single key; replacing it logs everyone out, which is acceptable at this scale. Admin status is not stored in the session; it is evaluated per request (AUTH-REQ-003). Format version 2 (DEC-0524) adds the provider id and the provider's subject of a real-provider session, so that AUTH can read the account. The cookie is HttpOnly and never reaches app code, and the user ID still cannot be reversed into the subject (AUTH-REQ-002). A version 1 cookie is treated as anonymous, so the change logs everyone out once. A future issued-at beyond PAR-252 makes the cookie invalid. A session created by the authentication mock also holds the level the test chose; such a session is honoured only where the mock is installed (DEC-0169).

**Request forgery.** Browsers send `Origin` on state-changing requests; the check compares it with the resolved public origin. No token is used (DEC-0072). A request "carries a session" when it sends a session cookie, valid or not, or when `createTestApp` gives it a fixed logged-in identity (DEC-0170).

**More than one provider.** If a deployment is later configured with several real providers, `/api/auth/login` shows a framework-owned page for choosing one. The app-facing contracts (`login()`, `/api/auth/login`) do not change.

**Provider per stage.** Every stage installs the real provider, PWD: production deployments, test stages (stages named `test-*`, PROV-REQ-005) and local development. Test stages and local development also install the mock, which tests use through `mock-login`. `createTestApp` installs the mock directly, or PWD with its in-memory outbox when the test asks for `passwordLoginProvider` (testing.d.ts). Installing the mock on any other stage is `CORE.MISCONFIGURED`. `/api/auth/login` always redirects to the sign-in page (DEC-0516, superseding DEC-0171's default-user login). The `./testing` subpath and the mock module are excluded from production bundles (CORE-REQ-006).

**Stub provider.** Because the mock bypasses ID derivation and the role lookup, real-provider paths are tested locally with a test-only stub provider that implements [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts). It is available only under `./testing` and speaks no protocol: its provider id is `stub`, its login redirects straight to the callback URL it was given with a fresh `state` and single-use `code`, and the subject, display name and failure to simulate are query parameters that `loginWithStub` adds (DEC-0172). The stub keeps one in-memory account per subject that has logged in. Each is verified and starts with no roles, and its `accountStatus` reads that account. `TestApp.grantRole` and `revokeRole` change these accounts' roles, or the password provider's `role` column (testing.d.ts, DEC-0525). Local tests use the stub to verify level evaluation, callback-URL building under a forged Host header, failed and replayed callbacks, and per-provider ID derivation. On each cloud, the production-check stage (`prodcheck`, COMPL) is checked with real logins by `check-login` (PWD §2).

## 3. Uses

HTTP (routes, error handler), CFG (public origin), CORE (test-stage flag, derived from the stage name: PROV-REQ-005), SEC (session key), LOG (failed logins and failed role lookups), PWD (real provider, and the account's verification flag and roles through `accountStatus`).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AUTH-AC-001 | Type inspection and a reference route dumping `c.var.user` show only the specified fields at each access level. A handler behind `requireUser()`, or one calling `requireCurrentUser(c)`, reads the user ID without a type assertion. | AUTH-REQ-001 | Local |
| AUTH-AC-002 | With the stub provider, the same provider and subject always yield the same user ID, matching the specified derivation; two subjects or two providers yield different IDs. | AUTH-REQ-002 | Local |
| AUTH-AC-003 | With `createTestApp` using `passwordLoginProvider`: after sign-up, verification and sign-in, `/api/auth/me` and a reference route dumping `c.var.user` show level `user`. After `grantRole(<that ID>, "admin")`, the very next request with the same session shows `admin` and passes `requireAdmin()`, with no new login and no rebuild. After `revokeRole`, the next request shows `user` and `requireAdmin()` answers 403 `AUTH.FORBIDDEN`, and the account's `role` column is NULL (not `user`). The same holds with `stubLoginProvider` and `loginWithStub`. | AUTH-REQ-003 | Local |
| AUTH-AC-004 | Protected reference routes return 401 and 403 as specified for each level. `requireCurrentUser(c)` returns the user when logged in and throws `AUTH.UNAUTHENTICATED` when anonymous. | AUTH-REQ-004 | Local, cloud |
| AUTH-AC-005 | `/api/auth/*` responses validate against the HTTP contract, and no `/api/auth/me` response has an `unlistedId`. Admin-role part, automated on each cloud's `prodcheck` stage: a test signs up with a sink address `sink+<run ID>@t.<domain>` (DEC-0527), verifies through the mail sink and signs in, and `/api/auth/me` shows `user`. Following the documented steps, it runs `admins grant <address> --target <t> --stage prodcheck --confirm-production prodcheck`, and the next request with the same session shows `admin`. It then runs `admins revoke` the same way, and the next request shows `user`. | AUTH-REQ-005 | Local, cloud |
| AUTH-AC-006 | On each target, session and transaction cookie attributes are as specified, a tampered session cookie is treated as anonymous, and logout clears the cookie. Locally, expired and future-dated session cookies are also treated as anonymous. | AUTH-REQ-006 | Local, cloud |
| AUTH-AC-007 | A POST with a session is rejected when `Origin` is missing or wrong and accepted when it equals the public origin, both directly and through the deployed router. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-008 | With the stub provider, the callback URL it receives is built from the public origin despite a forged Host header. | AUTH-REQ-008 | Local |
| AUTH-AC-009 | `/api/auth/mock-login` works on test stages and returns 404 on a production deployment. Production bundles contain no mock module. | AUTH-REQ-009 | Local, cloud |
| AUTH-AC-010 | With the stub provider, a refused callback and one with a missing, invalid, or replayed transaction create no session, redirect as specified, and write a log entry naming one fixed reason. Login with `returnTo` set to `//evil.example`, `/\evil.example`, `https://evil.example`, `/%2F%2Fevil.example`, or `javascript:` redirects to `/` after login. | AUTH-REQ-010 | Local |
| AUTH-AC-011 | On each cloud's `prodcheck` stage, through `check-login` (PWD §2): a sign-up sent with a forged `Host` header produces a verification email whose link is on the stage's public origin, and verifying with a bogus token gets 400 `AUTH.LOGIN_FAILED`, sets no cookie and leaves `/api/auth/me` anonymous. | AUTH-REQ-008, AUTH-REQ-010 | Cloud |
| AUTH-AC-012 | An unverified account is never a user. With `createTestApp` using `passwordLoginProvider`: sign-in before verification is refused and sets no cookie. For a signed-in, verified user, a test then marks the account unverified in `__framework_auth_user`: the next request is anonymous (a `requireUser()` route answers 401 `AUTH.UNAUTHENTICATED`, and `/api/auth/me` shows level `anonymous` with no `unlistedId`). An account granted `admin` and then marked unverified is anonymous, not admin. Likewise, after the account's row is deleted, the next request is anonymous. When the role read fails (for example, after a test drops `__framework_auth_user` while the session is valid), the request is anonymous and one `warn` entry `role lookup failed (<code>)` is written. A version 1 session cookie is anonymous. | AUTH-REQ-003, AUTH-REQ-005 | Local |
| AUTH-AC-013 | With `createTestApp` using `passwordLoginProvider`: after sign-up, verification through `app.mail` and sign-in, the user ID equals the specified derivation from provider id `password` and the provider's subject, a second sign-in yields the same ID, and the account's role decides the level as in AUTH-AC-003. A failed sign-in creates no session, answers as the internal HTTP contract specifies, and writes one log entry naming a fixed reason. | AUTH-REQ-002, AUTH-REQ-003, AUTH-REQ-008, AUTH-REQ-010 | Local |
| AUTH-AC-014 | A POST without any session to each of `/api/auth/password/sign-in`, `sign-up`, `resend`, `verify`, `forgot` and `reset`, with `Origin` missing or naming another origin, gets 403 `AUTH.REQUEST_FORGERY` and has no effect (no session, no mail, no account); with `Origin` equal to the public origin it is accepted. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-015 | With the statements sent to the stage's database recorded, in `createTestApp` on both dialects: a request without a session cookie, one with a tampered or expired cookie, and one with a mock session each cause no read of `__framework_auth_user`. A request with a valid password-provider session causes exactly one. A route that reads `c.var.user` several times still causes one. | AUTH-REQ-003 | Local |

## 5. Portability note

AUTH depends on no cloud service: it needs only HTTP, a secret, and configuration. A new login provider is one adapter behind the provider interface. A new target needs no AUTH changes.
