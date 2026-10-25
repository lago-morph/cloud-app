# I-G — `check-login`, the retirement of `certify-auth` and GOOGLE, the owner documentation: decision drafts

Implementer's note for item I-G (plan-auth.md §6), 2026-10-25. No live Cloudflare call was made by this item; the live findings below were reported by the coordinator from its own diagnostic run the same day.

## D-I-G-1 — The sink rule is read back, then `setup-account` waits 60 s before reporting success

Origin: ai-proposed (from live evidence) · Affects: MAIL-REQ-005, MAIL-AC-007, PROV-REQ-004, cloudflare.md `setupAccount`, `provision/cloudflare/email.ts`

Evidence (live, 2026-10-25, coordinator's diagnostic):
- Cloudflare Email Sending from `no-reply@<domain>` to `sink+diag1@t.<domain>` answered `delivered`, and the message was in the R2 bucket `prototype-mailsink` 2 s later, under `sink+diag1@t.<domain>/<UTC timestamp>-<id>.eml`. The real mail path works end to end.
- A send made right after the routing rule `sink@t.<domain>` was created got a permanent `550 5.1.1 Address does not exist` (`errorCause=routing_unknown_address`): the rule had not spread yet. The send API had answered `queued`.

Decision: after `setup-account` creates or changes the sink rule (step 7 of i-f.md), it polls `GET /zones/<z>/email/routing/rules` until the rule is listed as wanted (enabled, the literal `sink@t.<domain>`, one Worker action to `prototype-mailsink`), within the setup's poll bound (120 s), and then waits `RULE_SETTLE_MS` = 60 s before it reports success. A run that finds the rule already in place neither polls nor waits. A rule that never reads back fails `setup-account`, naming the rule. The 60 s is not a PAR: it is a margin on an observed propagation delay, not a behaviour parameter of the framework, and it costs only the run that creates the rule.

## D-I-G-2 — When a mail does not arrive, `check-login` reports Email Sending's last delivery event

Origin: ai-proposed (from live evidence) · Affects: PWD §2 "Real-provider check", `provision/cloudflare/email-delivery.ts`

Evidence (live, 2026-10-25): the send API's `queued` says nothing about delivery. The delivery status is in the GraphQL Analytics dataset `emailSendingAdaptive` of the sending domain's zone, filtered by `to` with `isLastEvent: 1`, which gives `status`, `errorCause` and `errorDetail`. `emailRoutingAdaptive` is empty for mail rejected at RCPT. Both datasets lag by over a minute.

Decision: when the verification or reset mail is not in the sink within `check-login`'s bound (180 s, polled every 5 s), `check-login` sends one `POST /graphql` query of `emailSendingAdaptive` for the run's address since one minute before the send, and its failure message reads `no <kind> mail reached the mail sink within 180 s; Email Sending's last event for the recipient (emailSendingAdaptive, <time>): status <s>, errorCause <c>, errorDetail "<d>"`. With no event yet it says so, naming the dataset's lag; a failing query is reported as such. The address in `errorDetail` is redacted like every other value of the run. The query needs the token's Analytics read on the zone; without it, the message says the status could not be read.

## D-I-G-3 — `check-login`'s steps and their deviations from password.md §2

Origin: ai-proposed · Affects: PWD §2, PWD-AC-009, AUTH-AC-011, E2E-008, COMPL-REQ-005

- **The admin step.** The coordinator's item description adds a step between sign-in and log out: `admins grant` (the `admins` command's own code, `changeAdminRole`, against the stage's current D1 through the D1 HTTP API) makes the next request `admin`, and `admins revoke` makes it `user` again. The role is revoked before the check ends, also when a later check fails (DEC-0526). PWD §2's list has seven steps without it; `check-login` has eight, and the report's step numbers follow its own list. Its results are PWD-AC-009, AUTH-AC-011 and E2E-008, as PWD §2 says; the admin step is part of PWD-AC-009's run, and AUTH-AC-005's and E2E-007's admin-role parts keep their own tests.
- **The forged host.** PWD §2 says "a forged `Host` header is sent". Through Cloudflare's edge the `Host` header selects the zone, so a request with another `Host` never reaches the stage's Worker. The sign-up therefore forges `X-Forwarded-Host` and `Forwarded: host=…`, the headers a proxy would set, and the check is that the mailed link is still on the public origin (BA's links are built from `baseURL`, RESULT.md S3).
- **"No new mail arrives" (step 2)** is checked once the verification mail has been read: after a 10 s settle, the sink holds exactly one message for the run's address.
- **The rate-limit burst (step 8)** sends at most PAR-258 + 1 wrong-password sign-ins and needs one 429 `AUTH.RATE_LIMITED`; until then each must be 400 `AUTH.LOGIN_FAILED`.
- **Refusals.** Target `local` and `test-*` stages are usage errors (exit 2) before any request. The spec defines no local variant, so none is provided.

## D-I-G-4 — The cloud run's production checks: the driver redeploys `prodcheck` and runs `check-login` last

Origin: ai-proposed · Affects: COMPL-REQ-005, COMPL §2 "Production-check stage", `tests/compliance/harness/prodcheck.ts`, `driver.ts`, `tools/listing.ts`

- On an automated cloud run that selects a criterion with a part on `prodcheck`, the driver redeploys `prodcheck` after the run stage and before the test layers. Its first deploy stops on the reference app's unset `apiKey`; the driver then sets a fresh value (standard input, redacted) and deploys again. It never adds `prodcheck` to the pending list and never removes it.
- `check-login --target <cloud> --stage prodcheck` runs **after** the test layers: its burst leaves the run's client IP rate-limited for PAR-258's window, and the admin-role tests sign in on `prodcheck` from the same IP.
- Its record's results for PWD-AC-009, AUTH-AC-011 and E2E-008 are folded into the run's record as outcomes of one driver check per ID (`[ID] check-login --stage prodcheck, run by the compliance driver …`), so the listing and E2E-004's coverage part count them like tagged tests. A failed redeploy fails those three with the reason, without running `check-login`.
- Their not-run rules are removed. COMPL-AC-005's rule stays until its test exists (test-author item T3).
- `apps/reference/config/cloudflare/prodcheck.json` is added (COMPL §2: the stage's committed values file).

## D-I-G-5 — The release report's login-provider list (COMPL-REQ-006 as amended)

Origin: ai-proposed · Affects: COMPL-AC-006, `tests/compliance/tools/release.ts`

The reference point is the newest record (any target or tier, never a dry run) whose PWD-AC-009 entries all passed: `check-login`'s own record, or a cloud run that folded it in. The listed paths are PWD (`src/auth/password/`, `auth-password.openapi.yaml`), MAIL (`src/mail/`) and the login-provider interface (`src/auth/login-provider.ts`, `internal/login-provider.d.ts`). GOOGLE-AC-005 is no longer looked for.

## D-I-G-6 — GOOGLE's code leaves the release branch

Origin: owner (DEC-0513) · Affects: CLI-REQ-001, PAR-106, `internal/login-provider.d.ts`

`src/google/`, its unit and integration tests, `certify-auth` (command, CLI table, the apps' npm scripts) and the `jose` dependency are removed; the code is on the branch `google`. PAR-106 is marked retired. With no provider lacking it, `LoginProvider.accountStatus` is required in the internal contract and the source, as the contract's note said it would be once I-G removed the Google adapter.
