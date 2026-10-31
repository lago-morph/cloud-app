# AUTH — Current user

Classifies every request as anonymous, user, or admin and gives app code a stable opaque user ID. Owns login and logout, sessions, request-forgery protection, the login-provider interface, and the authentication mock. All protocol details live behind the provider interface.

Contracts: [auth.d.ts](../contracts/ts/auth.d.ts), [client.d.ts](../contracts/ts/client.d.ts) (`getCurrentUser`, `login`, `logout`), [framework.openapi.yaml](../contracts/http/framework.openapi.yaml) (`/api/auth/*`), [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts) (`LoginProvider`), [internal/auth-app.d.ts](../contracts/ts/internal/auth-app.d.ts) (the auth app's service binding: `redeem` and `role`), [testing.d.ts](../contracts/ts/testing.d.ts) (`mockUsers`, stub login provider, `grantRole` and `revokeRole`), [errors.d.ts](../contracts/ts/errors.d.ts) (`AUTH.*`).

## 1. Requirements

#### AUTH-REQ-001 — App sees only the current user
Origin: owner · Derives from: SYS-REQ-005, SYS-REQ-017

`c.var.user` MUST be a `CurrentUser` carrying only the access level, the user ID, and an optional display name. No framework interface available to app code may expose the provider, protocol, tokens, email addresses, or validation results.

#### AUTH-REQ-002 — Stable opaque user ID
Origin: owner · Derives from: SYS-REQ-017

The user ID MUST be derived deterministically from the provider's name and the provider's stable identifier for the person. It is the same in every stage and target, cannot be reversed into the provider identifier, and changes if the person signs in through a different provider.

#### AUTH-REQ-003 — Levels from the account (amended; formerly admin by configuration)
Origin: owner · Derives from: SYS-REQ-017, SYS-REQ-018 · Decision: DEC-0080 (superseded), DEC-0521 (superseded), DEC-0522 (superseded), DEC-0524 (superseded), DEC-0690, DEC-0694

With a real provider, a logged-in user MUST be `admin` exactly when their user ID is in the configured admin list, evaluated on every request. When the optional `framework.users` list is present, a validated login whose ID is in neither `framework.users` nor `framework.admins` MUST be treated as anonymous, also evaluated on every request. Without the list, level `user` means any account the login provider accepts. With the authentication mock, the level chosen by the test is used directly (AUTH-REQ-009).

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522; the per-request read: ai-proposed, DEC-0524): the paragraph above is replaced by the following. There is no admin list and no users list. With a real provider, the level MUST be evaluated on every request from the account's current state, read through the provider:
- `anonymous`: the request has no valid session, or its session's account does not exist or is not verified;
- `user`: a valid session whose account exists and is verified;
- `admin`: a user whose role list contains `admin`.

A grant or revoke MUST take effect on the next request, with no new login. The account MUST be read at most once per request, and only for a request that carries a valid session (good signature, not expired) from a real provider. A request without one MUST cause no database read for its level. If the read fails, the request MUST be anonymous. With the authentication mock, the level chosen by the test is used directly, with no read (AUTH-REQ-009).

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0690; the role held in the session: ai-proposed, DEC-0694): the original text and the amendment above are replaced by the following. Levels come from the owner's Cloudflare account, through the auth app (SYS-REQ-018 as amended):
- `anonymous`: the request has no valid session, or its session was ended because its role could not be confirmed;
- `user`: a valid session whose confirmed role is `user`;
- `admin`: a valid session whose confirmed role is `admin`. The auth app maps a membership to `admin` when one of its role names is in PAR-413.

A sign-in MUST record in the session the role the auth app gave with the code, and the time. While the session lasts, AUTH MUST confirm the role again with the auth app's `role(sub)` once the role-refresh interval has passed since the last confirmation, and MUST NOT call the auth app otherwise. When the auth app has no such user, the session MUST end at once, with no retry. When it cannot answer, AUTH MUST retry within the same request, with a delay before each retry; if every try fails, AUTH MUST end the session (clear the cookie) and handle the request as anonymous, never keeping a role it could not confirm. The interval, the number of retries (2, plan-v0.2.0 §4.1) and the delay are parameters (item B's range, PAR-425…PAR-434). With the authentication mock, the level chosen by the test is used directly, with no call (AUTH-REQ-009).

#### AUTH-REQ-004 — Route protection
Origin: provenance-unclear · Derives from: SYS-REQ-010, SYS-REQ-017

`requireUser()` MUST reject anonymous requests with 401 `AUTH.UNAUTHENTICATED`. `requireAdmin()` MUST additionally reject users with 403 `AUTH.FORBIDDEN`. `requireCurrentUser(c)` MUST return the logged-in user, or throw `AUTH.UNAUTHENTICATED` for an anonymous request.

#### AUTH-REQ-005 — Framework routes and "who am I"
Origin: owner · Derives from: SYS-REQ-018 · Decision: DEC-0080 (superseded), DEC-0521 (superseded), DEC-0522 (superseded), DEC-0523 (superseded), DEC-0690

The framework MUST provide the `/api/auth/*` routes in the HTTP contract. `/api/auth/me` MUST show a logged-in user their user ID, including a validated login that `framework.users` makes anonymous. The skill and the app template's README MUST give copy-and-paste steps for adding that ID to the admin list or to `framework.users`.

Amendment (Origin: owner · Decision: DEC-0521, DEC-0522, DEC-0523): there are no lists to copy an ID into. `/api/auth/me` MUST show a logged-in user their level and user ID, and MUST NOT return `unlistedId`. The skill and the app template's README MUST give copy-and-paste steps for granting and revoking the `admin` role with the `admins` command (CLI-REQ-005).

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0690): the original text and the amendment above are replaced by the following. There is no `admins` command and there are no lists. `/api/auth/me` MUST show a logged-in user their level and user ID, and MUST NOT return `unlistedId`. The skill and the app template's README MUST say how a person becomes an admin: an administrator role in the owner's Cloudflare account (PAR-413), which takes effect at their next sign-in or role refresh.

#### AUTH-REQ-006 — Sessions
Origin: owner-approved · Derives from: SYS-REQ-017

After a successful login, the framework MUST keep the user logged in with a signed session cookie that lasts PAR-250. The cookie MUST be HttpOnly and SameSite=Lax, and on cloud targets also Secure and host-only. No session may be created before the provider has validated the login. Logout MUST clear the cookie. Sessions are stateless: a copied cookie stays valid until it expires (DEC-0028).

#### AUTH-REQ-007 — Request forgery protection
Origin: provenance-unclear · Derives from: SYS-REQ-017 · Decision: DEC-0516

A state-changing request (POST, PUT, PATCH, DELETE) that carries a session MUST be rejected with `AUTH.REQUEST_FORGERY` unless its `Origin` header equals the deployment's public origin. Every POST to a path under `/api/auth/` MUST be rejected in the same way whether or not it carries a session, so that no sign-in, sign-up, verification, reset or resend can be submitted from another site (login forgery). Together with SameSite=Lax session cookies, this is the whole protection (DEC-0072); the credential library's own origin check is not relied on. State-changing behavior on GET routes is not allowed, except the framework's `/api/auth/login` and `/api/auth/callback`, which set login cookies; the callback is protected by the transaction state.

#### AUTH-REQ-008 — Provider interface
Origin: owner · Derives from: SYS-REQ-019 · Decision: DEC-0509 (superseded), DEC-0510 (superseded), DEC-0691, DEC-0694

Each login provider MUST implement the internal provider interface. All protocol validation MUST happen inside the provider. The callback URL MUST be built from the deployment's resolved public origin, never from request headers.

Amendment for release 1 (Origin: owner · Decision: DEC-0509, DEC-0510): a provider implements either the redirect interface (`LoginProvider`) or the credential interface (`CredentialProvider`); release 1's real provider, PWD, is a credential provider. All credential validation MUST happen inside the provider, the provider MUST return only a stable identifier and a display name, and links the provider sends by email MUST be built from the deployment's resolved public origin, never from request headers.

Amendment for v0.2.0 (Origin: owner-approved · Decision: DEC-0691; the empty display name: ai-proposed, DEC-0694): the original text and the release-1 amendment above are replaced by the following. The real provider is the auth-app provider (`id` `cf-account`), a redirect provider (`LoginProvider`); the credential interface is removed. All protocol validation (Cloudflare's OAuth flow, PKCE, the ID token and the membership) MUST happen in the auth app. The provider MUST return only the stable identifier (`sub`) and the role, with no display name, so the email address the auth app holds never reaches app code (AUTH-REQ-001). The return URL the provider sends to the auth app MUST be the app's callback URL, built from the deployment's resolved public origin, never from request headers.

#### AUTH-REQ-009 — Authentication mock
Origin: owner · Derives from: SYS-REQ-020

A mock provider and the `/api/auth/mock-login` route MUST let tests choose any identity — access level, user ID (used as given, not derived), and display name — without contacting a real provider. Both MUST be present only locally and in test stages, and MUST be absent from production deployments.

#### AUTH-REQ-010 — Failed login
Origin: provenance-unclear · Derives from: SYS-REQ-010 · Decision: DEC-0516, DEC-0694

A failed login MUST NOT create a session, and MUST log the provider's reason without exposing it to the browser. A failed redirect-provider login MUST redirect to `/?authError=login_failed&requestId=<id>`, where `<id>` is the request's ID. A failed credential sign-in MUST answer as the internal HTTP contract specifies: a catalogue error in JSON, or a redirect to the sign-in page with a generic message for a form; both are identical for an unknown account and a wrong password (PWD-REQ-005).

Amendment for v0.2.0 (Origin: ai-proposed · Decision: DEC-0694): there is no credential sign-in, so the sentence on it no longer applies. A failed auth-app sign-in (refused at Cloudflare or by the auth app, a state mismatch, or a code the auth app refuses to redeem) is a failed redirect-provider login.

## 2. Design

**Levels** (DEC-0690). Only members of the owner's Cloudflare account can sign in. At each sign-in the auth app maps the member's account roles to `admin` (a role name in PAR-413) or `user` (any other accepted membership of the account), and records the result. "user" is a level, not a role: the session's role list is `["admin"]` for an admin and empty for a user (internal/auth-app.d.ts). The levels are:
- `anonymous`: no valid session, or a session ended because its role could not be confirmed;
- `user`: a valid session whose confirmed role list is empty;
- `admin`: a valid session whose confirmed role list contains `admin`.

There is no admin list or users list in configuration (CFG-REQ-005), and no operator command for roles. Unknown role names are ignored, so a later release can add roles without breaking older code.

**How the level is evaluated.** On each request, AUTH first checks the session cookie: signature, format and expiry. Then:
- With no session cookie, or an invalid one, the request is anonymous, and nothing is called.
- A session made by the authentication mock carries its level, which is used as is, with no call. Only test stages and local builds have the mock (AUTH-REQ-009).
- A valid real-provider session carries its provider, the provider's subject, the confirmed roles and when they were confirmed. Before the role-refresh interval has passed since then, the session's roles decide the level, and nothing is called.
- After it, AUTH asks the provider for `accountStatus(subject)` (internal/login-provider.d.ts) once, and the result is kept for the rest of the request. The auth-app provider answers through `env.AUTH.role(sub)`.
  - An unknown user (`null`) ends the session at once, with no retry: the cookie is cleared and the request is anonymous.
  - Otherwise AUTH re-issues the session cookie with the new roles and time, keeping its expiry, and the new roles decide the level.
  - When the provider cannot answer (the binding throws, the auth app answers an error, or its D1 is unavailable), AUTH retries up to the retry count, waiting the retry delay before each retry. If every try fails, it clears the cookie and handles the request as anonymous, so a protected route gives its usual 401. One `warn` entry with component `AUTH` and message `role refresh failed (<code>)` names the error code, never the subject.

So a role change in the Cloudflare account takes effect at the person's next sign-in or role refresh, with no deploy. A removed member keeps a session only until its next refresh. An auth-app outage that lasts past a refresh signs people out until the auth app recovers (plan-v0.2.0 §10). Between refreshes a request costs no call: this replaces DEC-0524's one database read per authenticated request.

**User ID.** `u_` followed by the first 26 characters of the base32 encoding of SHA-256(`<provider id>:<subject>`) (DEC-0067). For the auth-app provider, the provider id is `cf-account` and the subject is the Cloudflare user's `sub`.

**Login.**
1. `/api/auth/login` asks the stage's provider to begin a login.
2. It stores the provider's transaction state, the sanitized `returnTo` path, and an expiry (PAR-251) in a signed transaction cookie, and redirects. The transaction cookie has the session cookie's attributes: HttpOnly, SameSite=Lax (mandatory, so that the provider's redirect back carries it), and on cloud targets a `__Host-` name, Secure, Path=/, and no Domain. It is named `__Host-login` on cloud targets and `login_local` locally (DEC-0167).
3. `/api/auth/callback` verifies the transaction cookie, asks the provider to complete the login, creates the session, clears the transaction cookie, and redirects to `returnTo`.

A new login replaces any login in progress.

**The auth-app provider** (plan-v0.2.0 §3, §4.1; DEC-0691). The app Worker reaches the account's shared auth app only through the service binding `AUTH`, and holds no Cloudflare credential.
1. `beginLogin` redirects to `<auth app>/start?app=<app id>&return=<callback URL>&state=<s>`. The callback URL is the app's `/api/auth/callback` on its public origin.
2. The auth app checks `return` exactly against its registry of approved return URLs, which `deploy` writes and `remove` clears. It runs Cloudflare's authorization-code flow with PKCE S256, maps the membership to a role, revokes the Cloudflare tokens, and redirects to `return?code=…&state=…` with a one-time code. The code is single use, valid for PAR-414, and bound to the app ID and the return URL.
3. `completeLogin` checks the state, then redeems the code with `env.AUTH.redeem({ code, app })`. A `null` answer is a failed login. Otherwise it returns `sub` and the roles. The email address the auth app returns is dropped, and the session's display name is `null` (DEC-0694).

**Failed login.** The log entry names one fixed reason: transaction missing or expired; state mismatch; provider refused; code refused by the auth app; or the auth app could not answer. It never contains authorization codes, state, or tokens. It is one `warn` entry with component `AUTH` and message `login failed: <reason>`; an invalid or tampered transaction cookie counts as "transaction missing or expired". The transaction cookie is cleared by every callback, successful or not (DEC-0168).

**Session cookie.** Named `__Host-session` on cloud targets and `session_local` locally. It holds a format version, user ID, display name, issued-at and expiry times, signed with HMAC-SHA-256 using the framework-internal session key (at least PAR-253 bytes, SEC). There is a single key; replacing it logs everyone out, which is acceptable at this scale. A real-provider session also holds the provider id (`prv`: `cf-account`, or `stub` in tests; `password` goes), the provider's subject, the confirmed roles and the time they were last confirmed (DEC-0694). The cookie is HttpOnly and never reaches app code, and the user ID still cannot be reversed into the subject (AUTH-REQ-002). A cookie in an earlier format, and a `password` session, are anonymous, so v0.2.0 logs everyone out once (plan-v0.2.0 §8). A future issued-at beyond PAR-252 makes the cookie invalid. A session created by the authentication mock also holds the level the test chose; such a session is honoured only where the mock is installed (DEC-0169).

**Request forgery.** Browsers send `Origin` on state-changing requests; the check compares it with the resolved public origin. No token is used (DEC-0072). A request "carries a session" when it sends a session cookie, valid or not, or when `createTestApp` gives it a fixed logged-in identity (DEC-0170).

**More than one provider.** If a deployment is later configured with several real providers, `/api/auth/login` shows a framework-owned page for choosing one. The app-facing contracts (`login()`, `/api/auth/login`) do not change.

**Provider per stage** (plan-v0.2.0 §4.3). Production deployments install the auth-app provider, bound to the auth app. Test stages (stages named `test-*`, PROV-REQ-005) and local development install only the mock, and need no auth app. There, `/api/auth/login` sets a mock session for the default user and redirects to the sanitized `returnTo`, so the template's login button works (DEC-0171, restored by DEC-0694). `createTestApp` installs the mock directly, or the stub provider, or the auth-app provider over the fake binding when a test asks for it (testing.d.ts). Installing the mock on any other stage is `CORE.MISCONFIGURED`. The `./testing` subpath and the mock module are excluded from production bundles (CORE-REQ-006).

**Stub provider.** Because the mock bypasses ID derivation and the role refresh, real-provider paths are tested locally with a test-only stub provider that implements [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts). It is available only under `./testing` and speaks no protocol: its provider id is `stub`, its login redirects straight to the callback URL it was given with a fresh `state` and single-use `code`, and the subject, display name and failure to simulate are query parameters that `loginWithStub` adds (DEC-0172). The stub keeps one in-memory account per subject that has logged in. Each starts with no roles, and its `accountStatus` reads that account. `TestApp.grantRole` and `revokeRole` change these accounts' roles, and the change shows at the next role refresh (testing.d.ts, DEC-0525). Local tests use the stub, and the auth-app provider over the fake binding, to verify level evaluation, the role refresh and its failures, callback-URL building under a forged Host header, failed and replayed callbacks, and per-provider ID derivation. On each cloud, the production-check stage (`prodcheck`, COMPL) is checked by the automated part of the provider check (the `/start` redirect) on every run, and by the owner's real sign-in once per release (SYS-REQ-027 as amended).

## 3. Uses

HTTP (routes, error handler), CFG (public origin), CORE (test-stage flag, derived from the stage name: PROV-REQ-005), SEC (session key), LOG (failed logins and failed role refreshes), the auth app (sign-in, `redeem` and `role` through the `AUTH` service binding; internal/auth-app.d.ts).

## 4. Acceptance criteria

In v0.2.0, AUTH-AC-003, AUTH-AC-005 and AUTH-AC-011…AUTH-AC-015 are rewritten for the auth-app provider (DEC-0694). Their IDs are kept.

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AUTH-AC-001 | Type inspection and a reference route dumping `c.var.user` show only the specified fields at each access level. A handler behind `requireUser()`, or one calling `requireCurrentUser(c)`, reads the user ID without a type assertion. | AUTH-REQ-001 | Local |
| AUTH-AC-002 | With the stub provider, the same provider and subject always yield the same user ID, matching the specified derivation; two subjects or two providers yield different IDs. | AUTH-REQ-002 | Local |
| AUTH-AC-003 | With `createTestApp` using the auth-app provider over the fake binding: after a sign-in whose code carries role `user`, `/api/auth/me` and a reference route dumping `c.var.user` show level `user`. After the fake's record for that `sub` is set to `admin`, requests with the same session still show `user` until the role-refresh interval has passed. The first request after it shows `admin` and passes `requireAdmin()`, with no new login and no rebuild. After the record is set back to `user`, the first request after the next interval shows `user`, and `requireAdmin()` answers 403 `AUTH.FORBIDDEN`. The same holds with `stubLoginProvider`, `loginWithStub`, `grantRole` and `revokeRole`. | AUTH-REQ-003 | Local |
| AUTH-AC-004 | Protected reference routes return 401 and 403 as specified for each level. `requireCurrentUser(c)` returns the user when logged in and throws `AUTH.UNAUTHENTICATED` when anonymous. | AUTH-REQ-004 | Local, cloud |
| AUTH-AC-005 | `/api/auth/*` responses validate against the HTTP contract, and no `/api/auth/me` response has an `unlistedId`. | AUTH-REQ-005 | Local, cloud |
| AUTH-AC-006 | On each target, session and transaction cookie attributes are as specified, a tampered session cookie is treated as anonymous, and logout clears the cookie. Locally, expired and future-dated session cookies are also treated as anonymous. | AUTH-REQ-006 | Local, cloud |
| AUTH-AC-007 | A POST with a session is rejected when `Origin` is missing or wrong and accepted when it equals the public origin, both directly and through the deployed router. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-008 | With the stub provider, the callback URL it receives is built from the public origin despite a forged Host header. | AUTH-REQ-008 | Local |
| AUTH-AC-009 | `/api/auth/mock-login` works on test stages and returns 404 on a production deployment. Production bundles contain no mock module. | AUTH-REQ-009 | Local, cloud |
| AUTH-AC-010 | With the stub provider, a refused callback and one with a missing, invalid, or replayed transaction create no session, redirect as specified, and write a log entry naming one fixed reason. Login with `returnTo` set to `//evil.example`, `/\evil.example`, `https://evil.example`, `/%2F%2Fevil.example`, or `javascript:` redirects to `/` after login. | AUTH-REQ-010 | Local |
| AUTH-AC-011 | On each cloud's `prodcheck` stage, with no sign-in: `/api/auth/login` sent with a forged `Host` header redirects to the auth app's `/start` with the stage's app ID, a `return` equal to the stage's registered callback URL on its public origin, and a `state`, and sets the transaction cookie. A callback with that state and a bogus code redirects to `/?authError=login_failed&requestId=<id>`, sets no session cookie, and leaves `/api/auth/me` anonymous. | AUTH-REQ-008, AUTH-REQ-010 | Cloud |
| AUTH-AC-012 | A role that cannot be confirmed is never kept. With `createTestApp` using the auth-app provider over the fake binding, for a signed-in admin whose role-refresh interval has passed: when the binding fails once, the request is retried and shows `admin`. When every try fails (the fake made unavailable), the binding is called once plus the retry count, the session cookie is cleared, a `requireUser()` route answers 401 `AUTH.UNAUTHENTICATED`, `/api/auth/me` shows `anonymous`, and one `warn` entry `role refresh failed (<code>)` is written. When the fake has no record for the `sub`, the session ends at the first refresh, with one call and no retry. A session cookie in the format before v0.2.0, or with provider `password`, is anonymous. | AUTH-REQ-003, AUTH-REQ-005 | Local |
| AUTH-AC-013 | With `createTestApp` using the auth-app provider over the fake binding: after a sign-in, the user ID equals the specified derivation from provider id `cf-account` and the code's `sub`, a second sign-in yields the same ID, the display name is `null`, and no response or `c.var.user` contains the email address. `/api/auth/login` redirects to the fake auth app's `/start` with the app ID, the callback URL on the public origin, and a `state`. A code that the fake refuses (unknown, used, expired, or issued to another app), a state mismatch, and a binding that cannot answer each create no session, redirect as specified, and write one log entry naming a fixed reason. | AUTH-REQ-002, AUTH-REQ-003, AUTH-REQ-008, AUTH-REQ-010 | Local |
| AUTH-AC-014 | A POST without any session to each POST route under `/api/auth/` (`logout`, and `mock-login` where the mock is installed), with `Origin` missing or naming another origin, gets 403 `AUTH.REQUEST_FORGERY` and has no effect (no session is created or cleared); with `Origin` equal to the public origin it is accepted. | AUTH-REQ-007 | Local, cloud |
| AUTH-AC-015 | With the calls to the auth-app binding counted, in `createTestApp`: a request without a session cookie, one with a tampered or expired cookie, and one with a mock session each cause no call. A request with a valid auth-app session inside the role-refresh interval causes none. The first request after the interval causes exactly one `role` call when it succeeds, and the next request causes none. A route that reads `c.var.user` several times still causes at most one. | AUTH-REQ-003 | Local |

## 5. Portability note

AUTH depends on no cloud service: it needs only HTTP, a secret, and configuration. A new login provider is one adapter behind the provider interface. A new target needs no AUTH changes.
