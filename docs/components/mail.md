# MAIL — Outgoing email

Sends the framework's own email (verification, reset, "someone tried to register") for PWD, and captures it wherever real delivery is not wanted: locally, in `createTestApp`, and on test stages. Owns the account-level mail sink through which the real-provider check reads delivered mail. Framework-internal: apps cannot send email in release 1.

Contracts: [testing.d.ts](../contracts/ts/testing.d.ts) (`TestApp.mail`, `MailMessage`), [internal/auth-password.openapi.yaml](../contracts/http/internal/auth-password.openapi.yaml) (`GET /api/__framework/test-mail`), [stage-config.schema.json](../contracts/schemas/stage-config.schema.json) (`framework.email`).

## 1. Requirements

#### MAIL-REQ-001 — Sending never shapes the response
Origin: ai-proposed · Derives from: SYS-REQ-007, SYS-REQ-017 · Decision: DEC-0518, DEC-0519

Mail MUST be sent after the response, inside the request's background-task mechanism, so that neither the response nor its timing depends on the send. A failed send MUST NOT fail or change the request; it MUST be recorded as one log entry naming a fixed reason and the provider's error code, and MUST NOT contain the recipient's address.

#### MAIL-REQ-002 — A sender per kind of stage
Origin: ai-proposed · Derives from: SYS-REQ-019, SYS-REQ-020, SYS-REQ-022 · Decision: DEC-0511, DEC-0518

Production stages MUST deliver mail through Cloudflare Email Service, restricted to the stage's sender address. Local `dev` MUST capture mail into the git-ignored `.mail/` directory, `createTestApp` into an in-memory outbox, and test stages into a capture readable through `GET /api/__framework/test-mail`; none of these sends real mail or needs a cloud account (SYS-REQ-022). The test-stage capture and its route MUST be absent from production deployments, like the authentication mock (PROV-REQ-005).

#### MAIL-REQ-003 — One domain setting
Origin: owner · Derives from: SYS-REQ-016, SYS-REQ-023 · Decision: DEC-0511, DEC-0514

The email domain MUST be exactly one setting: the key `emailDomain` of the Cloudflare account settings record, set by `setup-account --target cloudflare --email-domain <domain>`. Every address the framework uses on a cloud MUST derive from it: the sender `no-reply@<emailDomain>` and the test mailbox subdomain `t.<emailDomain>`. No other file, source, configuration value or test MAY contain the domain or an address on it. The stage configuration MAY set only the sender's display name (`framework.email.senderName`).

#### MAIL-REQ-004 — Message content
Origin: ai-proposed · Derives from: SYS-REQ-015, SYS-REQ-017 · Decision: DEC-0516

Links in mail MUST be built from the deployment's resolved public origin, never from request headers. A message MUST contain only fixed text, the display name the person entered, and the link; never a password, a secret, or the user ID.

#### MAIL-REQ-005 — Mail sink for real-delivery checks
Origin: owner · Derives from: SYS-REQ-027 · Decision: DEC-0512, DEC-0518

`setup-account` MUST set up, idempotently, the account-level mail sink: mail to any address under `t.<emailDomain>` is stored for PAR-241 and then deleted, and can be read by recipient through the CLI. The sink is a shared account resource: stage removal MUST NOT touch it (PROV-REQ-003).

## 2. Design

**Interface** (`src/mail/`, framework-internal). `MailSender.send({ to, subject, text, html })` returns a promise that PWD hands to BA's `advanced.backgroundTasks.handler`, which is the request's `waitUntil`. The sender's `from` is `"<senderName> <no-reply@<emailDomain>>"`; `senderName` is `framework.email.senderName`, defaulting to the app name.

**Senders.**
- **Production stages:** the Email Service binding `EMAIL` (binding type `send_email`, allowed sender `no-reply@<emailDomain>`), and the Worker variable `FRAMEWORK_MAIL_FROM` that `deploy` sets from the account record. How SST/Pulumi express the binding is spike S5 (DEC-0518).
- **`test-*` stages:** a capture sender that writes each message to the framework table `__framework_test_mail` in the stage's database (the table is in the framework migration history of every stage, and stays empty on production stages), readable through `GET /api/__framework/test-mail?to=<address>` (x-test-stage-only; the latest message to that address, or 404). The module and the route are imported only by test-stage entries, like the mock (CORE-REQ-006, PROV-AC-005). `FRAMEWORK_MAIL_FROM` is set, but nothing is sent.
- **Local `dev`:** a capture sender that prints one marked line per message; `dev` writes it to `.mail/<timestamp>-<id>.json` (`{ to, subject, text, html, time }`), like `.logs/`. `dev` binds no `send_email`. The sender is `no-reply@localhost`.
- **`createTestApp`:** an in-memory outbox, read with `app.mail` (testing.d.ts).

**Failures.** A rejected send is one `error` entry, component `MAIL`, message `mail send failed: <code>`, where `<code>` is Email Service's error code (for example `E_SENDER_NOT_VERIFIED`) or `unknown`. The address is never logged (DEC-0519).

**Mail sink** (account level, created by `setup-account`, DEC-0518):
- Email Routing enabled on the subdomain `t.<emailDomain>` of the domain's zone, with a catch-all rule that sends to the Worker `prototype-mailsink`;
- `prototype-mailsink` writes each raw message to the R2 bucket `prototype-mailsink` under `<recipient>/<timestamp>-<id>.eml`, and does nothing else;
- the bucket has a lifecycle rule deleting objects after PAR-241;
- the sending side: `setup-account` lists the zone's sending subdomains (`GET /zones/{zone}/email/sending/subdomains`), creates the domain's entry only if absent, polls its verification status, and records the result.

Each step lists before creating, so a second run changes nothing (PROV-REQ-004). Changing `--email-domain` onboards and routes the new domain and updates the record; the old domain's entries are left in place and printed.

**Reading mail.** `mail last --to <address> [--target local|cloudflare]` prints the latest message to that address as JSON: locally from `.mail/`, on Cloudflare from the sink through the R2 REST API (the address must be under `t.<emailDomain>`). Agents use it in owner-task steps; `check-login` uses the same code.

## 3. Uses

LOG (send failures), CFG (sender display name, public origin), PROV (account settings record, bindings), CLI (`mail`, `dev` capture).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| MAIL-AC-001 | In `createTestApp`, a sign-up sent with a forged `Host` header puts one message in the outbox whose link is on the public origin and which contains the display name and no password, secret or user ID. With a sender that never completes, the sign-up response still arrives. | MAIL-REQ-001, MAIL-REQ-004 | Local |
| MAIL-AC-002 | With a sender whose every send fails, sign-up, forgot and resend answer exactly as with a working sender, and each failed send writes one `MAIL` log entry naming the error code and no address. | MAIL-REQ-001 | Local |
| MAIL-AC-003 | Under `dev`, a sign-up writes one `.mail/<timestamp>-<id>.json` file, `.mail/` is git-ignored, and `mail last --to <address>` prints that message. `reset-local` clears `.mail/`. | MAIL-REQ-002 | Local |
| MAIL-AC-004 | A local build check: Cloudflare builds for stages not named `test-*` (`prod`, `prodcheck`, `mytest-1`) contain no capture sender and no test-mail route, and their Worker settings bind `EMAIL` with exactly the allowed sender `no-reply@<emailDomain>` taken from a stubbed account record; a `test-<id>` build contains the capture sender and binds no `EMAIL`. | MAIL-REQ-002, MAIL-REQ-003 | Local |
| MAIL-AC-005 | A repository scan of `packages/`, `apps/`, `skill/` and `tests/` (dependencies and build output excluded) finds no email address whose domain is not a reserved name (`localhost`, or ending in `.test`, `.example` or `.invalid`). The stage-config schema rejects any `framework.email` field other than `senderName`. | MAIL-REQ-003 | Local |
| MAIL-AC-006 | On a Cloudflare test stage, after a sign-up, `GET /api/__framework/test-mail?to=<address>` returns the verification message; on the redeployed `prodcheck` stage the same route returns 404. | MAIL-REQ-002 | Cloud |
| MAIL-AC-007 | Running `setup-account --target cloudflare` twice changes nothing the second time, and afterwards the domain's sending entry is verified, Email Routing on `t.<emailDomain>` routes to `prototype-mailsink`, the bucket's lifecycle rule is PAR-241, and a message sent to an address under `t.<emailDomain>` is readable with `mail last --target cloudflare`. Removing a stage leaves all of these. | MAIL-REQ-005 | Cloud (milestone) |

## 5. Portability note

The sender interface is target-neutral: a new target supplies its own production sender and, if it has no email service, uses an external one behind the same interface. Cloudflare names (Email Service, Email Routing, R2) stay in this document's design, CF and PROV. The local and in-process capture senders do not change for a new target.
