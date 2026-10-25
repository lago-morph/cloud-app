# PWD — Email and password login provider

Release 1's real login provider (DEC-0509): accounts identified by an email address and a password, with mandatory email verification and password reset. It runs in the app's own deployment on every target, using Better Auth (BA, PAR-122) for credentials only; the framework keeps its own session (DEC-0510). Nothing outside this component, MAIL and the provisioning of the sender knows that BA, scrypt or email are involved.

Contracts: [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts) (`CredentialProvider`), [internal/auth-password.openapi.yaml](../contracts/http/internal/auth-password.openapi.yaml) (the sign-in pages and their POST endpoints), [testing.d.ts](../contracts/ts/testing.d.ts) (`passwordLoginProvider`, `TestApp.mail`), [errors.d.ts](../contracts/ts/errors.d.ts) (`AUTH.*`; see §2 "Error codes"), [evidence.schema.json](../contracts/schemas/evidence.schema.json) (`check-login`).

## 1. Requirements

#### PWD-REQ-001 — Sign-up and verification
Origin: owner · Derives from: SYS-REQ-017, SYS-REQ-019 · Decision: DEC-0509, DEC-0511, DEC-0516

A person MUST be able to create an account with an email address, a password and a display name. The display name MUST be what the person entered, never derived from the address. Sign-up MUST send a verification link to the address, and the account MUST NOT be able to sign in until the link has been used. A refused sign-in MUST NOT send any email; the sign-in page MUST instead offer an action that sends a new verification link. Using a verification link MUST NOT create a session.

#### PWD-REQ-002 — Password policy and storage
Origin: owner-approved · Derives from: SYS-REQ-015, SYS-REQ-019 · Decision: DEC-0517

A password MUST be between PAR-254 and PAR-255 characters long, with no composition rules. Passwords MUST be stored only as scrypt hashes with the parameters of PAR-244, and MUST NOT appear in any log entry, response, email, or error message.

#### PWD-REQ-003 — Sign-in creates only the framework session
Origin: ai-proposed · Derives from: SYS-REQ-017, SYS-REQ-019 · Decision: DEC-0510

A sign-in with a verified address and its correct password MUST log the person in through AUTH's session (AUTH-REQ-006), with the user ID derived from provider id `password` and the provider's stable identifier for the account (AUTH-REQ-002). No cookie, session or token of the credential library may reach the browser or outlive the request.

#### PWD-REQ-004 — Password reset
Origin: owner-approved · Derives from: SYS-REQ-019 · Decision: DEC-0517, DEC-0519

A person MUST be able to ask for a reset link, sent to the account's address, that is valid for PAR-257 and usable once. After a reset, the old password MUST fail and the new one MUST work.

#### PWD-REQ-005 — No account enumeration and no address exposure
Origin: ai-proposed · Derives from: SYS-REQ-005, SYS-REQ-017 · Decision: DEC-0516

For sign-up, forgot and resend, the status, headers other than the request ID, body and page MUST be the same whether or not an account exists for the address, and sending MUST happen after the response so that its timing does not tell either. A failed sign-in MUST answer the same for an unknown address and a wrong password. The email address MUST NOT leave this component and MAIL: it MUST NOT appear in a log entry, an error response, the session, or any app-facing interface (SYS-REQ-017).

#### PWD-REQ-006 — Abuse limits
Origin: owner-approved · Derives from: SYS-REQ-019 · Decision: DEC-0516, DEC-0517

Requests to the provider MUST be rate-limited per client IP and operation: sign-in by PAR-258; sign-up, forgot and resend by PAR-259; verify and reset submissions by PAR-242; any other credential-library path by PAR-243. A request over its limit MUST be refused with 429 `AUTH.RATE_LIMITED`. The limits MUST be enforced on every target and stage and in `createTestApp`, whatever the process environment (for example `NODE_ENV`).

#### PWD-REQ-007 — Hardened library use
Origin: ai-proposed · Derives from: SYS-REQ-006, SYS-REQ-019 · Decision: DEC-0516, DEC-0517

The credential library MUST be pinned exactly (PAR-122). Its origin check and rate limiter MUST be forced on whatever the process environment, its telemetry MUST be off, and its base URL MUST be the deployment's resolved public origin, never a request header. The framework MUST NOT forward the library's response bodies or headers to the browser.

#### PWD-REQ-008 — The account's role list
Origin: owner · Derives from: SYS-REQ-018 · Decision: DEC-0521, DEC-0522, DEC-0524

Each account MUST have a role list, stored in the column `role` of `__framework_auth_user` as role names separated by commas, or NULL when it has none. `admin` is the only role defined. A new account MUST have no roles: nothing may write `user`, or any other default, into the list. Only the `admins` command (CLI-REQ-005) and the test helpers (`TestApp.grantRole`, `revokeRole`) may change it. No request to the provider's pages or endpoints may set or change it, whatever its body holds. The provider MUST answer `accountStatus(subject)` with the account's verification flag and roles, in one read (AUTH-REQ-003).

## 2. Design

**Where.** `src/auth/password/`, framework-internal, Workers-compatible. One BA instance per request over the request's SQL binding (about 0.6 ms, RESULT.md S2), imported from `better-auth/minimal` with `better-auth/adapters/drizzle` (sqlite on D1, pg on PGlite in `createTestApp`).

**BA options** (RESULT.md "The BA options used", with DEC-0516's corrections):
- `baseURL`: the resolved public origin; `basePath: "/api/auth/password"`; `trustedOrigins: [origin]`; `secret`: the framework-internal secret `frameworkAuthSecret` (SEC);
- `telemetry: { enabled: false }` (LOCAL-REQ-001);
- `advanced`: `disableOriginCheck: false`, `ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`, `backgroundTasks.handler` = the request's `waitUntil`;
- `rateLimit`: `enabled: true`, `storage: "database"`, `modelName: "__framework_auth_rate_limit"`, the default rule PAR-243 and `customRules` for `/sign-in/email` (PAR-258), `/sign-up/email`, `/request-password-reset`, `/send-verification-email` (PAR-259), `/verify-email`, `/reset-password` (PAR-242). KV is eventually consistent, so it is not used for counters;
- `emailAndPassword`: `enabled`, `requireEmailVerification: true`, `autoSignIn: false`, `minPasswordLength` PAR-254, `maxPasswordLength` PAR-255, `revokeSessionsOnPasswordReset: true`, `resetPasswordTokenExpiresIn` PAR-257, `sendResetPassword`, `onExistingUserSignUp` (sends the "someone tried to register with this address" email);
- `emailVerification`: `sendOnSignUp: true`, `sendOnSignIn: false`, `autoSignInAfterVerification: false`, `expiresIn` PAR-256, `sendVerificationEmail`;
- `logger`: maps BA's levels to LOG entries with component `AUTH` and a fixed reason, never BA's message text;
- password hashing: BA's default scrypt, which on workerd is `node:crypto.scrypt` (PAR-244). A custom hasher in the same format, with a constant-time compare, is allowed.

The admin and test-utils plugins are not used. The admin plugin's `setRole` needs an existing admin, and its `defaultRole: "user"` would write a role that does not exist (DEC-0521). Admins are a role in the account table (PWD-REQ-008), granted with the `admins` command (CLI-REQ-005).

**Role column** (PWD-REQ-008, DEC-0521).
- `__framework_auth_user.role` is nullable text with no default. It is declared to BA as `user.additionalFields.role`, with `{ type: "string", required: false, input: false }`, so that BA's sign-up and update paths never take it from a request. The bridge also forwards only the fields it validated, so a `role` in a sign-up body never reaches BA.
- It holds role names separated by commas, as the admin plugin's field does. It is NULL when the account has none, including every new account.
- `accountStatus(subject)` is `SELECT email_verified, role FROM __framework_auth_user WHERE id = ?`, one read per authenticated request (AUTH §2). It answers null when there is no row.
- The `admins` command and `grantRole` add `admin` to the list. `revoke` and `revokeRole` remove it, writing NULL when no role is left, and never write `user`. Each change is one `UPDATE … WHERE id = ?` of the parsed list, with names kept unique and in order.

**Tables.** BA's models are renamed with `modelName`: `__framework_auth_user`, `__framework_auth_account`, `__framework_auth_session`, `__framework_auth_verification`, `__framework_auth_rate_limit`. They are defined in Drizzle in the framework package and added to the framework migration histories of both dialects by the existing engine (MIG §2); BA's own `migrate` is never used. The `role` column is added by its own framework migration, `<nnnn>_auth_role` (the next free number), after the tables' `0001_auth_tables` (MIG §2, DEC-0526). Apps cannot use the `__framework_` prefix, so app portability is unaffected; the D1 copy copies these tables like any other.

**Handler bridge** (DEC-0510). Each framework POST endpoint validates its input, then forwards `new Request(origin + basePath + baPath)` with a JSON body to `auth.handler()`. It copies only `Origin`, `CF-Connecting-IP` and `User-Agent`, never `Cookie`, `Host` or `X-Forwarded-*`. It returns none of BA's headers and never BA's body: the framework maps BA's status and code to its own answer. Verify is sent to BA as `GET /verify-email?token=` (P4). On a sign-in 200 the bridge reads `user.id`, `user.name` and `token`, deletes the row `__framework_auth_session` with that token, and returns the `ProviderIdentity`. Only the framework's own endpoints are routed; any other path under `/api/auth/password/` is 404 `HTTP.NOT_FOUND`, so BA's endpoints are never reachable directly.

**Provider.** `createPasswordProvider()` returns the `CredentialProvider` with `id` `"password"` (internal/login-provider.d.ts). AUTH calls it, derives the user ID with `deriveUserId("password", subject)` (DEC-0067), and issues the session.

**Routes and pages** (internal/auth-password.openapi.yaml; all under `/api/auth/`, so Worker routing and the Vite proxy do not change):
- GET pages, server-rendered with plain forms and no script: `sign-in`, `sign-up`, `forgot`, `verify?token=`, `reset?token=`. Pages never echo an address.
- POST endpoints: `password/sign-in`, `password/sign-up`, `password/resend`, `password/verify`, `password/forgot`, `password/reset`. Each answers with a 303 to a page, or with JSON when the request has `Accept: application/json`, so tests need no browser.
- Verification and reset links open a GET page whose button POSTs. This keeps state-changing GETs out (AUTH-REQ-007) and stops mail scanners from using up reset tokens.
- `GET /api/auth/login?returnTo=` redirects (302) to the sign-in page, carrying the sanitized `returnTo`. A successful sign-in returns there.

**Answers** (JSON form; the 303 form goes to the matching page):

| Endpoint | Success | Refusals |
| --- | --- | --- |
| `sign-up` | 200 `{ "result": "check-email" }`, for a new and an existing address alike | 400 `HTTP.INVALID_INPUT` (password length, missing display name) |
| `sign-in` | 200 `{ "result": "signed-in", "returnTo": … }` and the session cookie | 400 `AUTH.LOGIN_FAILED` (unknown address or wrong password, one body); 403 `AUTH.NOT_VERIFIED` |
| `resend`, `forgot` | 200 `{ "result": "check-email" }`, always | — |
| `verify` | 200 `{ "result": "verified" }` | 400 `AUTH.LOGIN_FAILED` (invalid or expired token) |
| `reset` | 200 `{ "result": "password-reset" }` | 400 `AUTH.LOGIN_FAILED` (invalid, used or expired token); 400 `HTTP.INVALID_INPUT` |

Every endpoint can also answer 403 `AUTH.REQUEST_FORGERY` (AUTH-REQ-007) and 429 `AUTH.RATE_LIMITED`.

**Error codes.** Two codes are new (DEC-0520). They join `errors.d.ts` with the error catalogue in implementation item I-C:
- `AUTH.NOT_VERIFIED`: status 403, not retryable, meaning "The account's email address has not been verified yet.";
- `AUTH.RATE_LIMITED`: status 429, retryable, meaning "Too many attempts from this client; try again later.".

**Failed login log entry** (AUTH-REQ-010). One `warn` entry, component `AUTH`, message `login failed: <reason>`, with reason `wrong credentials`, `not verified`, `rate limited`, `invalid token`, or `provider unavailable (<code>)`. Never the address, password or token.

**Mail.** Through MAIL's `MailSender`, inside `waitUntil`. Three messages: verification, reset, and "someone tried to register with this address". The links come from BA, built from `baseURL`, so a forged `Host` or `X-Forwarded-Host` never changes them (RESULT.md S3).

**Real-provider check** (`check-login --target cloudflare --stage <s>`, DEC-0512). It refuses `test-*` stages. The base URL comes from the recorded deploy output, the domain from the account settings record (DEC-0514), and the mail from the sink (MAIL §2). The steps, stopping at the first failure:
1. sign up `<run ID>@t.<domain>` with a random password; a forged `Host` header is sent with this request;
2. sign-in is refused with 403 `AUTH.NOT_VERIFIED`, and no new mail arrives;
3. read the verification mail from the sink; its link is on the public origin; a bogus token gets 400 `AUTH.LOGIN_FAILED` and sets no cookie; the real token verifies;
4. sign in; `/api/auth/me` shows level `user` and a well-formed ID;
5. log out; forgot; read the reset mail; reset to a new password;
6. the old password fails, the new one works;
7. a burst of sign-in requests from one client gets 429 `AUTH.RATE_LIMITED` within PAR-258.

It writes one evidence record with results for PWD-AC-009, AUTH-AC-011 and E2E-008, with exit status 0 only if every step passed. The address, password and tokens are never printed or recorded; the record names the run ID only.

## 3. Uses

AUTH (provider interface, session, forgery check, level from `accountStatus`), MAIL (sending), SQL and MIG (tables, the role column), CFG (public origin), SEC (`frameworkAuthSecret`), LOG (failed logins), COMPL (evidence format).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| PWD-AC-001 | With `createTestApp` and the password provider: sign-up answers `check-email`; sign-in before verification gets 403 `AUTH.NOT_VERIFIED` and adds no mail to the outbox; resend adds one verification mail; posting the mailed token to verify sets no cookie; sign-in then succeeds and `/api/auth/me` shows level `user` with the entered display name. | PWD-REQ-001, PWD-REQ-003 | Local |
| PWD-AC-002 | Sign-up with a password of PAR-254 − 1 or PAR-255 + 1 characters gets 400 `HTTP.INVALID_INPUT`; PAR-254 and PAR-255 characters are accepted. The stored credential matches the PAR-244 format, and a scan of the database, the log entries, the responses and the outbox finds no test password. | PWD-REQ-002 | Local |
| PWD-AC-003 | A successful sign-in's response sets only the framework's session cookie (no cookie named `better-auth.*`, no other `Set-Cookie`), and `__framework_auth_session` is empty afterwards. Requests to credential-library paths such as `/api/auth/password/sign-in/email` get 404 `HTTP.NOT_FOUND`. | PWD-REQ-003, PWD-REQ-007 | Local |
| PWD-AC-004 | Forgot, the mailed link, and reset work; the same token used again gets 400 `AUTH.LOGIN_FAILED`; the old password then fails and the new one works. With the clock advanced past PAR-257, a reset token is refused; past PAR-256, a verification token is refused. | PWD-REQ-004 | Local |
| PWD-AC-005 | Sign-up, forgot and resend for an existing and an unknown address give byte-identical answers apart from the request ID, in both the JSON and the 303 form; a wrong password and an unknown address give identical sign-in answers. A sign-up for an existing address mails the "someone tried to register" message. With a mail sender that never completes, every response still arrives. No log entry or response of the test run contains a test address. | PWD-REQ-005 | Local |
| PWD-AC-006 | From one client IP, sign-in requests beyond PAR-258 within its window get 429 `AUTH.RATE_LIMITED`, while another IP is unaffected; likewise sign-up beyond PAR-259. The same holds with `NODE_ENV` set to `test` and to `production`. | PWD-REQ-006 | Local |
| PWD-AC-007 | With `NODE_ENV=test`, a sign-in, a sign-up, a forgot and a reset with a forged `Origin` are each refused with 403 `AUTH.REQUEST_FORGERY`. The installed better-auth version equals PAR-122 exactly, and the framework's source imports the library only as `better-auth/minimal` and `better-auth/adapters/drizzle`. With outbound network requests recorded, sign-up and sign-in make none (telemetry off). | PWD-REQ-007 | Local |
| PWD-AC-008 | On a Cloudflare test stage, sign-up, verification through the stage's test-mail route, sign-in and `/api/auth/me` work as in PWD-AC-001, and a sign-in burst gets 429 `AUTH.RATE_LIMITED`. | PWD-REQ-001, PWD-REQ-003, PWD-REQ-006 | Cloud |
| PWD-AC-009 | On the `prodcheck` stage, redeployed, `check-login` runs steps 1–7 with real email delivery through the mail sink and writes an evidence record in which every step passed. | PWD-REQ-001, PWD-REQ-003, PWD-REQ-004, PWD-REQ-006 | Cloud |
| PWD-AC-010 | With `createTestApp` and the password provider, on both dialects: after sign-up, the new account's `role` column is NULL, and it is still NULL after verification and sign-in, where `/api/auth/me` shows level `user`. A sign-up whose JSON body also carries `"role": "admin"` (and one carrying `"role": "user"`) is either refused with 400 `HTTP.INVALID_INPUT` or creates an account whose `role` is NULL, and that account signs in as `user`, never `admin`. No request to the provider's endpoints changes the column. After `grantRole` and `revokeRole`, the column is NULL again, never `user`. | PWD-REQ-008 | Local |

## 5. Portability note

PWD needs only SQL, a secret, configuration, HTTP and MAIL, so it is independent of the cloud target: a new target gives it a SQL binding and a mail sender, and PWD does not change. The library is behind the internal `CredentialProvider`; replacing it, or adding a provider beside it (for example GitHub, through `LoginProvider`), does not change app-facing contracts.
