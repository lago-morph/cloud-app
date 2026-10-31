# PWD — Email and password login provider (retired)

Status: retired in v0.2.0 (DEC-0696). Email and password login is removed: the real login is sign-in with Cloudflare through the account's shared auth app (SYS-REQ-019 as amended by DEC-0691; [auth.md](auth.md)), and roles come from the Cloudflare account (SYS-REQ-018 as amended by DEC-0690). The provider's code (`packages/framework/src/auth/password/`), Better Auth (PAR-122) and its tables leave with item B (migrations drop the tables, plan-v0.2.0 §8). This document is kept for the record. Its design, uses and portability sections are in git history, last at commit `fc9f8b9` (branch `v0.2.0/37-auth-doc-rewrite`).

## 1. Retired requirements

| Retired ID | Former title | Former origin | Retired by |
| --- | --- | --- | --- |
| PWD-REQ-001 | Sign-up and verification | owner | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-002 | Password policy and storage | owner-approved | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-003 | Sign-in creates only the framework session | ai-proposed | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-004 | Password reset | owner-approved | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-005 | No account enumeration and no address exposure | ai-proposed | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-006 | Abuse limits | owner-approved | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-007 | Hardened library use | ai-proposed | SYS-REQ-019 as amended (DEC-0691) |
| PWD-REQ-008 | The account's role list | owner | SYS-REQ-018 as amended (DEC-0690) |

## 2. Retired acceptance criteria

Retired criteria (DEC-0696). They are kept here for the record, outside any criteria table, so the compliance catalogue no longer reads them. Until item B removes the password code and its tests (PR 45), tests still tagged with them are listed by the traceability report as tags naming no defined criterion.

| Retired ID | Former criterion | Former Where | Replaced by |
| --- | --- | --- | --- |
| PWD-AC-001 | With `createTestApp` and the password provider: sign-up answers `check-email`; sign-in before verification gets 403 `AUTH.NOT_VERIFIED` and adds no mail to the outbox; resend adds one verification mail; posting the mailed token to verify sets no cookie; sign-in then succeeds and `/api/auth/me` shows level `user` with the entered display name. | Local | none: email and password login is removed (DEC-0691) |
| PWD-AC-002 | Sign-up with a password of PAR-254 − 1 or PAR-255 + 1 characters gets 400 `HTTP.INVALID_INPUT`; PAR-254 and PAR-255 characters are accepted. The stored credential matches the PAR-244 format, and a scan of the database, the log entries, the responses and the outbox finds no test password. | Local | none: email and password login is removed (DEC-0691) |
| PWD-AC-003 | A successful sign-in's response sets only the framework's session cookie (no cookie named `better-auth.*`, no other `Set-Cookie`), and `__framework_auth_session` is empty afterwards. Requests to credential-library paths such as `/api/auth/password/sign-in/email` get 404 `HTTP.NOT_FOUND`. | Local | AUTH-AC-006 (the framework session only) |
| PWD-AC-004 | Forgot, the mailed link, and reset work; the same token used again gets 400 `AUTH.LOGIN_FAILED`; the old password then fails and the new one works. With the clock advanced past PAR-257, a reset token is refused; past PAR-256, a verification token is refused. | Local | none: email and password login is removed (DEC-0691) |
| PWD-AC-005 | Sign-up, forgot and resend for an existing and an unknown address give byte-identical answers apart from the request ID, in both the JSON and the 303 form; a wrong password and an unknown address give identical sign-in answers. A sign-up for an existing address mails the "someone tried to register" message. With a mail sender that never completes, every response still arrives. No log entry or response of the test run contains a test address. | Local | none: email and password login is removed (DEC-0691) |
| PWD-AC-006 | From one client IP, sign-in requests beyond PAR-258 within its window get 429 `AUTH.RATE_LIMITED`, while another IP is unaffected; likewise sign-up beyond PAR-259. The same holds with `NODE_ENV` set to `test` and to `production`. | Local | none: email and password login is removed (DEC-0691) |
| PWD-AC-007 | With `NODE_ENV=test`, a sign-in, a sign-up, a forgot and a reset with a forged `Origin` are each refused with 403 `AUTH.REQUEST_FORGERY`. The installed better-auth version equals PAR-122 exactly, and the framework's source imports the library only as `better-auth/minimal` and `better-auth/adapters/drizzle`. With outbound network requests recorded, sign-up and sign-in make none (telemetry off). | Local | AUTH-AC-007, AUTH-AC-014 |
| PWD-AC-008 | On a Cloudflare test stage, sign-up, verification through the stage's test-mail route, sign-in and `/api/auth/me` work as in PWD-AC-001, and a sign-in burst gets 429 `AUTH.RATE_LIMITED`. | Cloud | none: email and password login is removed (DEC-0691) |
| PWD-AC-009 | On the `prodcheck` stage, redeployed, `check-login` runs steps 1–7 with real email delivery through the mail sink and writes an evidence record in which every step passed. | Cloud | AUTH-AC-011 and E2E-008 (automated part); the owner's real sign-in (E2E-007, E2E-008 live parts, DEC-0692) |
| PWD-AC-010 | With `createTestApp` and the password provider, on both dialects: after sign-up, the new account's `role` column is NULL, and it is still NULL after verification and sign-in, where `/api/auth/me` shows level `user`. A sign-up whose JSON body also carries `"role": "admin"` (and one carrying `"role": "user"`) is either refused with 400 `HTTP.INVALID_INPUT` or creates an account whose `role` is NULL, and that account signs in as `user`, never `admin`. No request to the provider's endpoints changes the column. After `grantRole` and `revokeRole`, the column is NULL again, never `user`. | Local | AUTH-AC-003 (roles from the Cloudflare account, DEC-0690) |

Retired IDs: PWD-REQ-001 to PWD-REQ-008 and PWD-AC-001 to PWD-AC-010 (DEC-0696). They are never reused.
