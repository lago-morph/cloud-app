# Plan: replace Google sign-in with Better Auth (email + password), release 1

Status: draft by the planner, 2026-10-24. Owner decisions are in §7, and nothing in §6 beyond the offline spikes starts until they are answered. Written by the orchestrator from the planner's report; the planner read `claude/distribution` plus the Better Auth (BA) and Cloudflare docs.

**Owner decisions so far (2026-10-24):**
- BA, self-hosted in the app's Worker.
- The account is on Workers Paid, so scrypt fits the CPU limit.
- A domain is being transferred to Cloudflare.
- For self-hosted auth, email verification is mandatory, sent through Cloudflare Email Service. Arbitrary recipients need Workers Paid and a sender domain on Cloudflare DNS: https://developers.cloudflare.com/email-service/
- Setup and testing should be possible for an AI agent without manual steps or browser automation.

## 1. Architecture
### Who owns sessions
The framework keeps its own stateless `__Host-session` HMAC cookie (DEC-0028). BA handles credentials only. Reasons:
- `auth/runtime.ts` `identify()` needs no D1 read per request.
- The mock (`mockLevel`) uses the same cookie.
- Admins and users are judged per request from the cookie's user ID (`levels.ts`).
- System-spec §4 puts revocable sessions out of scope.
- MIG-AC-006 needs a session to survive a schema-changing deploy.
- AUTH-AC-006 fixes the cookie attributes.

BA-owned sessions would add a second cookie, a D1 read per request, and rework AUTH-REQ-006, AUTH-AC-006 and the mock.

### Provider contract
- Add a new internal `CredentialProvider` next to `LoginProvider` (`contracts/ts/internal/login-provider.d.ts`, `auth/login-provider.ts`), with `id: "password"`.
- Operations: signUp, signIn, sendVerification, verify, requestReset, reset. Each returns `ProviderIdentity { subject: <BA user.id>, displayName: <BA user.name> }`.
- AUTH derives the user ID with `deriveUserId("password", subject)` (DEC-0067) and issues the framework session.
- App code still sees only the access level, an opaque ID and the display name (SYS-REQ-017).
- The email address never leaves the provider. Sign-up asks for a display name, which is never derived from the email.

### Calling BA (`src/auth/password/`, Workers-compatible)
- One BA instance per request, over the request's DB binding.
- Options:
  - `baseURL` = the resolved public origin, never taken from request headers (AUTH-REQ-008);
  - `basePath: "/api/auth/password"`;
  - `trustedOrigins: [origin]`;
  - `telemetry: { enabled: false }` (LOCAL-REQ-001);
  - `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`;
  - `emailAndPassword: { enabled, requireEmailVerification: true, autoSignIn: false, min/maxPasswordLength, sendResetPassword, revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn }`;
  - `emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn }`;
  - `onExistingUserSignUp`: sends a "someone tried to register" email.
- **Handler bridge.** BA's `auth.api.*` server calls skip rate limiting, so framework routes forward a rebuilt Request to `auth.handler()`. That keeps BA's rate limiter, origin check and enumeration-safe responses. The framework then:
  - strips BA's `Set-Cookie`;
  - deletes the BA session row;
  - issues `__Host-session`.
- BA's admin plugin is not used: admins stay in config (SYS-REQ-018). The test-utils plugin never ships in a deployed bundle.

### Tables
- BA's models are renamed with `modelName`: `__framework_auth_user`, `__framework_auth_account`, `__framework_auth_session`, `__framework_auth_verification`, `__framework_auth_rate_limit`.
- They are defined in Drizzle in the package and added to the framework migration histories for both dialects by the existing engine (MIG §2).
- BA uses its Drizzle adapter: sqlite on D1, pg on PGlite in `createTestApp`. BA's own `migrate` is never used.
- App portability is unaffected, because apps can't use the `__framework_` prefix. The D1 copy (MIG) copies these tables like any other.

### Routes and pages (all under `/api/auth/`, so Worker routing and the Vite proxy don't change)
- **HTML pages, server-rendered, with plain forms:** GET `sign-in`, `sign-up`, `forgot`, `verify?token=`, `reset?token=`.
- **POST endpoints:** `password/sign-in`, `password/sign-up`, `password/resend`, `password/verify`, `password/forgot`, `password/reset`. Each answers with a 303 to a page, or JSON when `Accept: application/json`, so tests need no browser.
- **Verify and reset links** open a GET page whose button POSTs. That keeps state-changing GETs out (AUTH-REQ-007) and stops mail scanners using up tokens.
- **Unchanged flows:** `/api/auth/login?returnTo=` now 302s to the sign-in page. `login()`/`logout()`, `/me`, `/logout` and `/mock-login` keep their behaviour.
- **Internal HTTP contract:** the routes that carry email addresses go in `contracts/http/internal/auth-password.openapi.yaml`, so the app-facing contract and the E2E-016 scan stay clean.

### CSRF and origin
- `forgeryCheck` is extended: every POST to `/api/auth/*` must carry `Origin` equal to the public origin, with or without a session. This also blocks login CSRF.
- BA's trustedOrigins is a second layer. Cookies stay SameSite=Lax.

### Worker settings
- `compatibility_flags: ["nodejs_compat"]` (BA needs AsyncLocalStorage).
- CF-REQ-003 and the bundle inspection allow `node:async_hooks` and `node:crypto`.

## 2. Email: new component MAIL (`src/mail/`)
- **Interface:** `MailSender.send({to, subject, text, html})`, run inside `waitUntil` so response timing doesn't reveal whether an account exists. Failures are logged by user ID and error code, never with the address.
- **Senders:**
  - **Cloud production stages:** the Email Service binding `EMAIL`, restricted to the stage's sender address. SST/Pulumi binding type `send_email`, to be spiked.
  - **Local `dev`:** a capture sender. It prints a marked line that `dev` captures into git-ignored `.mail/<ts>-<id>.json`, like `.logs/`. Miniflare's own `email-text/` folder is not relied on, and `dev` binds no `send_email`.
  - **`createTestApp`:** an in-memory outbox (`app.mail.lastTo(addr)` in `testing.d.ts`).
  - **`test-*` stages:** a test-only capture sender plus `GET /api/__framework/test-mail?to=`. Both are excluded from production bundles like the mock (SYS-REQ-020, PROV-AC-005).
- **Config:**
  - `framework.email.from` (for example `"Demo <no-reply@<domain>>"`) in the stage values. The deploy preflight requires it for production stages, replacing the `framework.google` check.
  - The sender domain is an account setting: `setup-account --target cloudflare --email-domain <domain>`. The build checks that each stage's `from` is on that domain.
- **Provisioning, all through the API:**
  - `setup-account`: look up the zone ID, then `POST /zones/{zone}/email/sending/subdomains` (list first, so it is idempotent), poll the verification status, and record the result. For the test mailbox (§3) it also enables Email Routing on a subdomain, turns on subaddressing, adds a literal rule `sink@t.<domain>` to the sink Worker (catch-all rules are apex-only; DEC-0527), and deploys the sink.
  - `deploy`: adds the `EMAIL` binding on production stages.
  - `remove`: nothing extra to remove.
- **Token permissions to add** (exact names confirmed in spike S4; the preflight will name any that are missing):
  - Account: Email Sending Edit, and Email Routing Addresses Edit if needed;
  - Zone, for the owner's domain only: Zone Read, Email Sending Edit, Email Routing Rules Edit, and Zone Settings or DNS Edit (routing adds MX records).

## 3. Testing without a browser
- **Local:** tests sign up, read the link from the outbox or `.mail/`, POST verify, sign in, then forgot, read the mail and reset. `npm run mail -- last --to <addr>` does the same for agents.
- **Cloud test stages:** the capture sender plus the test-only route. It is deterministic, uses no quota and needs no domain, so this part can start before the transfer finishes.
- **Real-provider check (recommended): Email Routing.**
  - Mail to `sink@t.<domain>` and its subaddresses `sink+<tag>@t.<domain>` (DEC-0527) goes to a framework-owned account-level sink Worker, `prototype-mailsink`, which writes the raw MIME to the R2 bucket `prototype-mailsink` with a 1-day lifecycle rule.
  - The new command `check-login --target cloudflare --stage prodcheck` replaces `certify-auth`. It runs these steps:
    1. sign up `sink+<runid>@t.<domain>`;
    2. confirm sign-in is refused (403) before verification;
    3. read the email and verify;
    4. sign in and check `/me` shows `user`;
    5. log out, then forgot, read the email and reset;
    6. confirm the old password fails and the new one works;
    7. confirm a burst of wrong passwords gets 429.
  - It writes one evidence record, is fully automated, and runs on every compliance cloud run (COMPL-REQ-005). That is about 3 real sends per run.
  - Each run leaves one test user on prodcheck. That is accepted for now; a cleanup route can come later.
  - BA test-utils on prodcheck was rejected, because it is privileged and not allowed in production.

## 4. Security
- **Rate limiting:** BA `storage: "database"` on D1 (`__framework_auth_rate_limit`). KV is eventually consistent, so unsuitable; the Cloudflare Rate Limiting binding is the fallback. Rate limiting stays on in dev and tests, with custom rules for sign-in, sign-up, forgot, resend and verify.
- **Passwords:** 12 to 128 characters, no composition rules.
- **Reset:** a reset revokes BA sessions. Framework sessions stay valid until they expire (stateless, DEC-0028); this is an accepted limitation, to be recorded.
- **Enumeration:**
  - `requireEmailVerification` with `autoSignIn: false` gives the same 200 for a new or an existing email;
  - forgot always answers 200;
  - sends happen in `waitUntil`;
  - pages show the same message either way.
- **Cookies:** `__Host-session` and `__Host-login` are unchanged. BA's cookies are always stripped.
- **Secret:** `frameworkAuthSecret` (BA's `secret`), as Worker secret `SECRET_FRAMEWORK_AUTH_SECRET`. 32 random bytes per stage, like `frameworkSessionKey`, written locally into `.dev.vars`, and included in the health check. `frameworkGoogleClientSecret` is retired.
- **CPU:** Workers Paid gives a 30 s default. Measure scrypt in spike S2. If BA's JavaScript scrypt is slow, use a custom `password.hash/verify` on `node:crypto.scrypt` under nodejs_compat, in the same format.

## 5. Spec changes (owner-origin decisions from DEC-0509)
### Decisions
- **DEC-0509:** BA email+password replaces Google for release 1, self-hosted, and Workers Paid is required.
- **DEC-0510:** the framework owns sessions; BA handles credentials only.
- **DEC-0511:** email verification is mandatory, sent through Email Service.
- **DEC-0512:** an automated real-provider check replaces the guided certification.
- **DEC-0513:** Google is retired from release 1, or kept as an optional provider, depending on §7.

### System spec
- SYS-REQ-019: email+password is the real provider; others stay addable.
- SYS-REQ-027: verified by an automated check on a production deployment with real email delivery.
- SYS-REQ-026: "provider certification is current" becomes "the provider check passed".
- SYS-REQ-022: unchanged.

### Component docs
- **New:** `password.md` (PWD-REQ-001…006 and their criteria) and `mail.md` (MAIL-REQ and MAIL-AC), both added to the component map.
- **google.md:** marked retired. GOOGLE-REQ-001…005 and GOOGLE-AC-001/002/003/005 are retired and point to the PWD criteria. The code moves to branch `google`.
- **auth.md:**
  - AUTH-REQ-008 covers credential providers;
  - AUTH-REQ-007 requires Origin on every `/api/auth/*` POST;
  - AUTH-REQ-010 extends to failed password login;
  - AUTH-AC-011 is rewritten for prodcheck: a forged Host still gives correct links in the email, and a bogus verify token creates no session;
  - new AUTH-AC-013 (the password provider via the outbox) and AUTH-AC-014 (a login-CSRF POST is rejected).
- **SEC §2:** the framework secrets list.
- **CFG:** the stage schema adds `framework.email` and drops `google`.
- **PROV-REQ-002:** the preflight, and "Publishing the result".
- **PROV-REQ-004:** setup-account adds the email domain and the sink.
- **CF:** §2 bindings and the compat flag; CF-REQ-003.
- **LOCAL-REQ-002:** adds mail capture.
- **CLI-REQ-001 / CLI-AC-001:** `certify-auth` retired; `check-login` and `mail` added.

### Compliance
- COMPL-REQ-005 / COMPL-AC-005: prodcheck runs `check-login`.
- COMPL-REQ-006: GOOGLE-AC-005 leaves the milestone list, and "commits touching GOOGLE" becomes "touching PWD/MAIL". COMPL-AC-006 changes to match.

### E2E and skill
- E2E-006: `/login` redirects to the framework's sign-in page, and the mock is absent.
- E2E-007: the cloud part is automated in `check-login`.
- E2E-008: renamed "Real login provider check (automated)".
- E2E-016: the term list adds "Better Auth", "scrypt" and "Email Service".
- SKILL-AC-006 and the template README §5/§8 are rewritten around sign-up instead of Google.

### Parameters
- PAR-122: better-auth exact version;
- PAR-254: minimum password length, 12;
- PAR-255: maximum password length, 128;
- PAR-256: verification link validity, 24 h;
- PAR-257: reset link validity, 1 h;
- PAR-258: sign-in rate limit, 5 per 60 s per IP;
- PAR-259: sign-up/forgot/resend rate limit, 3 per 300 s;
- PAR-240: mailsink retention, 1 day;
- PAR-106 (jose): dropped if nothing else uses it.

The demo spec is unchanged. Its README and the owner tasks change.

## 6. Work breakdown
I = implementer; T = test author, writing from criteria only.

| Item | Work | Depends on |
| --- | --- | --- |
| 0. Spikes S1–S5 (I) | see §8 | blocks everything except the docs |
| 1. Spec PR | §5 docs and contracts, then owner review | starts T1–T4 |
| I-A | BA Drizzle tables and framework migrations, both dialects | 1 |
| I-B | `CredentialProvider` and `src/auth/password/`: the handler bridge, session issue, rate limiter | A |
| I-C | routes and pages, the forgeryCheck change, the `/login` redirect | B |
| I-D | MAIL: the interface, the capture senders, `.mail/` capture in `dev`, the test-only route, build exclusion | parallel with A–C |
| I-E | config, secrets and CF settings: `framework.email`, `frameworkAuthSecret`, `nodejs_compat`, the binding, the preflight | parallel with D |
| I-F | provisioning: email-domain onboarding, routing, the sink Worker and bucket, permission checks | E; **live parts need the domain** |
| I-G | `check-login`; retire `certify-auth` and `src/google/`; update the skill, the template README and owner tasks | C, F |
| T1 | local criteria: AUTH-AC-013/014, PWD-AC, MAIL-AC, the CFG and SEC updates (in-process and `dev` HTTP) | parallel with A–E |
| T2 | cloud test-stage tests through the test-mail route; PROV-AC-005 bundle exclusion | |
| T3 | the prodcheck `check-login` evidence; the COMPL-AC-005/006 report changes | |
| T4 | update `criteria/auth/*` and remove the Google criteria | |

**Live steps that need the domain:**
- the zone active on Cloudflare DNS;
- sending-subdomain onboarding and DNS verification;
- Email Routing and the sink;
- the first real send;
- a prodcheck redeploy with `framework.email`;
- the `check-login` run;
- checking the owner-tasks steps.

## 7. Owner inputs needed
1. The domain name, once the transfer is complete, and whether it receives other mail. Email Routing changes MX records; the plan avoids that by using the subdomain `t.`.
2. Confirmation that Workers Paid is active.
3. Google: keep it as an optional second provider, or drop it? The recommendation is to drop it for release 1 and keep the code on branch `google`.
4. A token with the §2 permissions, and whether account and zone permissions on one token are acceptable.
5. Approval of the password policy, link lifetimes and rate limits (the PARs in §5).
6. The sender display name and local part (for example `no-reply@`).

## 8. Spikes (risks to settle first)
- **S1:** the pinned BA version on workerd with D1 through the Drizzle adapter, with `__framework_` model names and an instance per request. Also BA on PGlite in `createTestApp`.
- **S2:** scrypt CPU per hash on a deployed Worker (JavaScript versus `node:crypto`). Also how `nodejs_compat` affects bundle size under CF-REQ-003.
- **S3:** the handler bridge:
  - do sign-in responses give the user ID;
  - are BA's cookies and session rows stripped cleanly;
  - does the rate limiter fire through the bridge;
  - does verify work with `autoSignInAfterVerification: false`.
- **S4:** the Email Service beta:
  - the new-account daily quota;
  - the sending-subdomain API on the apex domain;
  - the token permission names;
  - when `E_SENDER_NOT_VERIFIED` appears;
  - deliverability of workers.dev links sent from another domain.
- **S5:** SST 4.17.2 / Pulumi cloudflare 6.15 `send_email` with `allowed_sender_addresses`, and whether secrets survive the Worker update. Also the Email Routing API to a Worker on a subdomain, and reading R2 objects over REST.
- **Open risks:**
  - BA moves fast, so pin it exactly.
  - The R2 sink is a new account resource; it needs remove and leftover rules, and stage removal never deletes it.
  - An Email Service outage or account suspension blocks every sign-up. The page must show a clear error and the code must be logged.
