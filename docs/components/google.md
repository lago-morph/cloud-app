# GOOGLE — Google login provider

The Google implementation of AUTH's login-provider interface, and its guided certification. Nothing outside this component knows Google or OpenID Connect (OIDC) is involved.

Contracts: [internal/login-provider.d.ts](../contracts/ts/internal/login-provider.d.ts), [stage-config.schema.json](../contracts/schemas/stage-config.schema.json) (`framework.google`), [evidence.schema.json](../contracts/schemas/evidence.schema.json).

## 1. Requirements

#### GOOGLE-REQ-001 — Server-side login flow
Origin: provenance-unclear · Derives from: SYS-REQ-019

The adapter MUST use Google's OIDC authorization-code flow with PKCE, a random state, and a nonce. The token exchange MUST happen on the server using the client secret.

#### GOOGLE-REQ-002 — Validation
Origin: provenance-unclear · Derives from: SYS-REQ-017, SYS-REQ-019

The adapter MUST accept an ID token only if all of the following hold:
- its signature verifies against Google's published keys;
- its issuer is one of Google's documented issuer values;
- its audience is the configured client ID;
- its expiry and issued-at times are valid within PAR-252;
- its nonce matches the login transaction.

The adapter MUST NOT fetch URLs taken from the token itself.

#### GOOGLE-REQ-003 — Minimal scope
Origin: ai-proposed · Derives from: SYS-REQ-017

The adapter MUST request only the `openid` and `profile` scopes. No email is requested, because none is used.

#### GOOGLE-REQ-004 — Setup instructions
Origin: provenance-unclear · Derives from: SYS-REQ-019, SYS-REQ-023

The framework MUST document how to:
- create a Google OAuth web client;
- register `<public origin>/api/auth/callback` for each production stage;
- put the client ID in `framework.google.clientId`;
- set the client secret with the CLI.

#### GOOGLE-REQ-005 — Guided certification
Origin: owner · Derives from: SYS-REQ-027

The CLI MUST provide a guided manual certification against a production deployment that records an evidence record. It is required only after major framework restructuring or a substantive change to this adapter (DEC-0021).

## 2. Design

**Libraries.** Discovery and key handling use jose (PAR-106). The token's `sub` claim is the subject, and its `name` claim, if present, is the display name.

**Certification procedure** (`certify-auth --target <t> --stage <s>`):
1. The CLI checks automatically that `/api/auth/login` redirects to Google with the configured client ID and callback URL.
2. The CLI prints the stage's URL; the owner logs in with the dedicated test account.
3. The owner pastes the JSON shown at `/api/auth/me`; the CLI checks that the level is `user` and that the ID is well-formed.
4. The owner logs out and pastes `/api/auth/me` again; the CLI checks that the level is `anonymous`.
5. The CLI writes an evidence record with the results.

Only the automatic redirect check (step 1) is part of routine verification of production deployments.

## 3. Uses

AUTH (provider interface, transaction state), CFG (client ID, public origin), SEC (client secret), COMPL (evidence format).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| GOOGLE-AC-001 | The login redirect carries a PKCE challenge, state, and nonce. The token request is made from the server with the client secret. | GOOGLE-REQ-001 | Cloud (manual) |
| GOOGLE-AC-002 | Unit tests feeding the validator hand-built tokens reject a wrong signature, wrong issuer, wrong audience, expired token, future issued-at time beyond PAR-252, and wrong nonce. | GOOGLE-REQ-002 | Local |
| GOOGLE-AC-003 | The authorization request's scope is exactly `openid profile`. | GOOGLE-REQ-003 | Local |
| GOOGLE-AC-004 | Following the setup instructions on a fresh stage leads to a successful certification. | GOOGLE-REQ-004 | Cloud (manual) |
| GOOGLE-AC-005 | Certification runs end to end on each cloud and writes a valid evidence record. | GOOGLE-REQ-005 | Cloud (manual) |

## 5. Portability note

Another provider, such as GitHub, is a sibling adapter behind the same interface, whatever protocol it uses; this one does not change. Google is independent of the cloud target.
