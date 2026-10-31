# MAIL — Outgoing email (retired)

Status: retired in v0.2.0 (DEC-0696). With sign-in through Cloudflare no email is sent, so the sender, the test mailbox, the mail sink (`prototype-mailsink`) and the email domain setting go (plan-v0.2.0 §5.3, §6). The code (`packages/framework/src/mail/`, the `mail` command, the mail-sink provisioning) leaves with items B and C. The admin app offers an optional cleanup of the v0.1.x email resources (plan-v0.2.0 §8). This document is kept for the record. Its design, uses and portability sections are in git history, last at commit `fc9f8b9` (branch `v0.2.0/37-auth-doc-rewrite`).

## 1. Retired requirements

| Retired ID | Former title | Former origin | Retired by |
| --- | --- | --- | --- |
| MAIL-REQ-001 | Sending never shapes the response | ai-proposed | SYS-REQ-019 as amended (DEC-0691): no email is sent |
| MAIL-REQ-002 | A sender per kind of stage | ai-proposed | SYS-REQ-019 as amended (DEC-0691): no email is sent |
| MAIL-REQ-003 | One domain setting | owner | SYS-REQ-019 as amended (DEC-0691): no email is sent |
| MAIL-REQ-004 | Message content | ai-proposed | SYS-REQ-019 as amended (DEC-0691): no email is sent |
| MAIL-REQ-005 | Mail sink for real-delivery checks | owner | SYS-REQ-027 as amended (DEC-0692) |

## 2. Retired acceptance criteria

Retired criteria (DEC-0696). They are kept here for the record, outside any criteria table, so the compliance catalogue no longer reads them. Until item B removes the mail code and its tests (PR 46), tests still tagged with them are listed by the traceability report as tags naming no defined criterion.

| Retired ID | Former criterion | Former Where | Replaced by |
| --- | --- | --- | --- |
| MAIL-AC-001 | In `createTestApp`, a sign-up sent with a forged `Host` header puts one message in the outbox whose link is on the public origin and which contains the display name and no password, secret or user ID. With a sender that never completes, the sign-up response still arrives. | Local | none: no email is sent (DEC-0691) |
| MAIL-AC-002 | With a sender whose every send fails, sign-up, forgot and resend answer exactly as with a working sender, and each failed send writes one `MAIL` log entry naming the error code and no address. | Local | none: no email is sent (DEC-0691) |
| MAIL-AC-003 | Under `dev`, a sign-up writes one `.mail/<timestamp>-<id>.json` file, `.mail/` is git-ignored, and `mail last --to <address>` prints that message. `reset-local` clears `.mail/`. | Local | none: no email is sent (DEC-0691) |
| MAIL-AC-004 | A local build check: Cloudflare builds for stages not named `test-*` (`prod`, `prodcheck`, `mytest-1`) contain no capture sender and no test-mail route, and their Worker settings bind `EMAIL` with exactly the allowed sender `no-reply@<emailDomain>` taken from a stubbed account record; a `test-<id>` build contains the capture sender and binds no `EMAIL`. | Local | none: no email is sent (DEC-0691) |
| MAIL-AC-005 | A repository scan of `packages/`, `apps/`, `skill/` and `tests/` (dependencies and build output excluded) finds no email address whose domain is not a reserved name (`localhost`, or ending in `.test`, `.example` or `.invalid`). The stage-config schema rejects any `framework.email` field other than `senderName`. | Local | none: no email is sent (DEC-0691) |
| MAIL-AC-006 | On a Cloudflare test stage, after a sign-up, `GET /api/__framework/test-mail?to=<address>` returns the verification message; on the redeployed `prodcheck` stage the same route returns 404. | Cloud | none: no email is sent (DEC-0691) |
| MAIL-AC-007 | Running `setup-account --target cloudflare` twice changes nothing the second time, and afterwards the domain's sending entry is verified, Email Routing on `t.<emailDomain>` routes `sink@t.<emailDomain>` to `prototype-mailsink` with subaddressing on, the bucket's lifecycle rule is PAR-241, and a message sent to `sink+<run ID>@t.<emailDomain>` is readable with `mail last --target cloudflare`. Removing a stage leaves all of these. | Cloud (milestone) | none: the mail sink is removed, and MAIL-AC-007 leaves COMPL-REQ-006's milestone list (DEC-0692, DEC-0693) |

Retired IDs: MAIL-REQ-001 to MAIL-REQ-005 and MAIL-AC-001 to MAIL-AC-007 (DEC-0696). They are never reused.
