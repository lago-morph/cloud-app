# GOOGLE — Google login provider

**Status: retired (DEC-0513, owner, 2026-10-25).** Google is dropped from release 1; the real login provider is email and password ([password.md](password.md), PWD). This document is kept for the record. Its requirements are retired with pointers to their replacements, its criteria are listed under "Retired criteria" in §4 and are no longer in any criteria table, and the code (`src/google/`, `certify-auth`) is preserved on the branch `google`. Nothing here is binding.

The Google implementation of AUTH's login-provider interface, and its guided certification. Nothing outside this component knows Google or OpenID Connect (OIDC) is involved.

Contracts: [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts), [stage-config.schema.json](../contracts/schemas/stage-config.schema.json) (`framework.google`), [evidence.schema.json](../contracts/schemas/evidence.schema.json).

## 1. Requirements

#### GOOGLE-REQ-001 — Server-side login flow
Origin: provenance-unclear · Derives from: SYS-REQ-019
Status: retired (DEC-0513) · Replaced by: PWD-REQ-003

The adapter MUST use Google's OIDC authorization-code flow with PKCE, a random state, and a nonce. The token exchange MUST happen on the server using the client secret.

#### GOOGLE-REQ-002 — Validation
Origin: provenance-unclear · Derives from: SYS-REQ-017, SYS-REQ-019
Status: retired (DEC-0513) · Replaced by: PWD-REQ-001, PWD-REQ-003

The adapter MUST accept an ID token only if all of the following hold:
- its signature verifies against Google's published keys;
- its issuer is one of Google's documented issuer values;
- its audience is the configured client ID;
- its expiry and issued-at times are valid within PAR-252;
- its nonce matches the login transaction.

The adapter MUST NOT fetch URLs taken from the token itself.

#### GOOGLE-REQ-003 — Minimal scope
Origin: ai-proposed · Derives from: SYS-REQ-017
Status: retired (DEC-0513) · Replaced by: PWD-REQ-005

The adapter MUST request only the `openid` and `profile` scopes. No email is requested, because none is used.

#### GOOGLE-REQ-004 — Setup instructions
Origin: provenance-unclear · Derives from: SYS-REQ-019, SYS-REQ-023
Status: retired (DEC-0513) · Replaced by: MAIL-REQ-003, SKILL-REQ-006

The framework MUST document how to:
- create a Google OAuth web client;
- register `<public origin>/api/auth/callback` for each production stage;
- put the client ID in `framework.google.clientId`;
- set the client secret with the CLI.

#### GOOGLE-REQ-005 — Guided certification
Origin: owner · Derives from: SYS-REQ-027
Status: retired (DEC-0512, DEC-0513) · Replaced by: PWD-AC-009 (`check-login`, SYS-REQ-027 as amended)

The CLI MUST provide a guided manual certification against a production deployment that records an evidence record. It is required only after major framework restructuring or a substantive change to this adapter (DEC-0021).

## 2. Design

**Libraries.** Google's discovery document is fetched with plain `fetch` from its fixed well-known URL. jose (PAR-106) handles the signing keys (`createRemoteJWKSet`) and token verification (`jwtVerify`). The token's `sub` claim is the subject, and its `name` claim, if present, is the display name.

**Certification procedure** (`certify-auth --target <t> --stage <s>`):
1. The CLI checks automatically that `/api/auth/login` redirects to Google with the configured client ID and callback URL, a PKCE challenge, a state, and a nonce.
2. The CLI prints the stage's URL; the owner logs in with the dedicated test account.
3. The owner pastes the JSON shown at `/api/auth/me`; the CLI checks that the level is `user` and that the ID is well-formed.
4. The owner logs out and pastes `/api/auth/me` again; the CLI checks that the level is `anonymous`.
5. The CLI writes an evidence record with the results.

Only the automatic redirect check (step 1) is part of routine verification of production deployments.

**Implementation** (`src/google/`, framework-internal; never app-facing):
- `createGoogleLoginProvider({ fetch?, now? })` returns the `LoginProvider` with `id` `"google"`. It reads the client ID from config key `framework.google.clientId` (missing → `CORE.MISCONFIGURED`) and the client secret from the framework-internal secret `frameworkGoogleClientSecret` (DEC-0176). `fetch` is looked up on each call, defaulting to the global one.
- Discovery is fetched once per provider instance from the fixed URL; a failure is not cached. Its `authorization_endpoint`, `token_endpoint` and `jwks_uri` must be https URLs. Signing keys come only from that `jwks_uri` (jose `createRemoteJWKSet`); token header URLs such as `jku` and `x5u` are ignored.
- The transaction state is JSON `{ state, nonce, verifier }`, each 32 random bytes in base64url. AUTH signs and stores it (auth.md).
- Validation: RS256 only; issuer `https://accounts.google.com` or `accounts.google.com`; audience = client ID; `sub`, `iat` and `exp` required; `exp` and `iat` checked with PAR-252 tolerance (a future `iat` is checked explicitly, because jose checks it only together with a maximum age); nonce equal to the transaction's.
- Every failure is `AUTH.LOGIN_FAILED`, and its message is exactly one of AUTH's fixed reasons: `transaction missing or expired`, `state mismatch`, `provider refused` (an `error` parameter or no code), `token exchange rejected (HTTP n)` (or `(no response)`), `token check failed: <check>` with check `signature`, `issuer`, `audience`, `expiry`, `issued-at`, `nonce`, or `subject`. The message never contains a code, state or token. A discovery failure is `provider discovery failed (…)` (DEC-0177).
- Certification: `checkLoginRedirect({ origin, clientId, fetch? })` is step 1. It sends `GET <origin>/api/auth/login` with `redirect: "manual"` and lists each failed check: the target must be `https://accounts.google.com`, with `response_type=code`, the client ID, the `<origin>/api/auth/callback` callback, scope exactly `openid profile`, an S256 challenge, a state and a nonce. `certifyAuth(options, io)` runs steps 1–5 with injected I/O (`print`, `ask`, `writeEvidence`, `now`, `fetch`). It refuses `test-` stages, stops at the first failed step, and always writes one evidence record. The record has results for `GOOGLE-AC-001` (step 1) and `GOOGLE-AC-005` (all steps) and exit status 0 only if every step passed. Step 3 accepts a user ID matching `u_` plus 26 base32 characters in either letter case (DEC-0178).

## 3. Uses

AUTH (provider interface, transaction state), CFG (client ID, public origin), SEC (client secret), COMPL (evidence format).

## 4. Acceptance criteria

Retired criteria (DEC-0513). They are kept here for the record, outside any criteria table, so the compliance catalogue no longer reads them. Until implementation item I-G removes `src/google/`, tests still tagged with them are listed by the traceability report as tags naming no defined criterion.

| Retired ID | Former criterion | Former Where | Replaced by |
| --- | --- | --- | --- |
| GOOGLE-AC-001 | The certification step-1 check finds a PKCE challenge, state, and nonce in the login redirect. A local test with `fetch` stubbed shows the token request is made from the server with the client secret and the PKCE verifier. | Local, cloud | PWD-AC-001, PWD-AC-003 |
| GOOGLE-AC-002 | Unit tests feeding the validator hand-built tokens reject a wrong signature, wrong issuer, wrong audience, expired token, future issued-at time beyond PAR-252, and wrong nonce. | Local | PWD-AC-001, PWD-AC-004 |
| GOOGLE-AC-003 | The authorization request's scope is exactly `openid profile`. | Local | PWD-AC-005 |
| GOOGLE-AC-005 | Certification runs end to end on each cloud's `prodcheck` stage, set up by following the setup instructions, and writes a valid evidence record. | Cloud (manual, milestone) | PWD-AC-009 |

## 5. Portability note

Another provider, such as GitHub, is a sibling adapter behind the same interface, whatever protocol it uses; this one does not change. Google is independent of the cloud target.

Retired IDs: GOOGLE-AC-004 (DEC-0077); GOOGLE-REQ-001 to GOOGLE-REQ-005, GOOGLE-AC-001, GOOGLE-AC-002, GOOGLE-AC-003 and GOOGLE-AC-005 (DEC-0513).
