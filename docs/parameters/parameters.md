# Parameters Register

Every tunable value used by the framework — limits, sizes, timeouts, defaults, and dependency version pins — is recorded here and nowhere else. Design documents and contracts refer to values by `PAR-…` ID.

Categories (see [CONVENTIONS.md §5](../CONVENTIONS.md)):

- **owner** — set by the owner; only the owner changes it.
- **platform** — imposed by a cloud platform or dependency; re-verify against the cited source during implementation and whenever the platform changes.
- **ai-proposed** — chosen by an AI with no external basis required; free to change during implementation and testing. When changed, update the value here.

There are currently no numeric `owner` parameters. Platform values below were recorded from documentation during earlier AI-assisted work and have **not** been re-verified; treat them as "verify before relying on".

## General

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-001 | Design load | A few simultaneous users | owner | Qualitative; see SYS-REQ-007. |

## HTTP

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-010 | Maximum non-file request body | 1,000,000 bytes | ai-proposed | |
| PAR-011 | Maximum file size accepted through the app API | 4,000,000 bytes | ai-proposed | Must stay below the smallest platform request limit (PAR-012, PAR-013). |
| PAR-012 | AWS Lambda synchronous request payload limit | 6 MB; binary bodies are base64-encoded, so raw capacity is lower | platform | AWS Lambda quotas. |
| PAR-013 | Cloudflare Workers request body limit | 100 MB (Free and Pro plans) | platform | Cloudflare Workers limits. |

## KV

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-020 | Maximum key length | 1,024 UTF-8 bytes | ai-proposed | |
| PAR-021 | Default list page size | 100 | ai-proposed | |
| PAR-022 | Maximum list page size | 1,000 | ai-proposed | |

## Files

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-030 | Maximum file name length | 1,024 UTF-8 bytes | platform | S3 and R2 object key limit. |
| PAR-031 | Default list page size | 100 | ai-proposed | |
| PAR-032 | Maximum list page size | 1,000 | platform | S3 `ListObjectsV2` returns at most 1,000 keys per call. |
| PAR-033 | Default content type | `application/octet-stream` | ai-proposed | |

## Secrets

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-040 | Maximum cache lifetime of a secret value read from AWS | 60 seconds | ai-proposed | |

## Authentication

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-050 | Session lifetime | 7 days | ai-proposed | Sessions are stateless (DEC-0028). |
| PAR-051 | Validity of an in-progress login attempt | 10 minutes | ai-proposed | |
| PAR-052 | Clock skew tolerated when validating provider responses | 60 seconds | ai-proposed | |
| PAR-053 | Minimum session signing key length | 32 bytes | ai-proposed | |

## AWS deployment

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-060 | Default AWS region | `us-east-1` | ai-proposed | Deployment setting, overridable per stage (SYS-REQ-023). |
| PAR-061 | Aurora minimum capacity | 0 ACU | ai-proposed | Allows the database to pause when idle. |
| PAR-062 | Aurora maximum capacity | 4 ACU | ai-proposed | |
| PAR-063 | Aurora auto-pause delay | 5 minutes | ai-proposed | Platform minimum is 300 seconds. |
| PAR-064 | Time budget for waiting on a paused database to resume (requests and deployment) | 45 seconds | ai-proposed | |
| PAR-065 | HTTP Lambda timeout | 60 seconds | ai-proposed | |
| PAR-066 | API read timeout at the AWS router | 60 seconds | ai-proposed | |

## AI skill

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-070 | Maximum size of the skill's top-level router document | 8,000 UTF-8 bytes | ai-proposed | |
| PAR-071 | Maximum size of each capability reference document | 12,000 UTF-8 bytes | ai-proposed | |
| PAR-072 | Maximum size of each complete example | 20,000 UTF-8 bytes | ai-proposed | |

## Testing

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-080 | Floating-point comparison tolerance in compliance tests | `abs(actual − expected) ≤ max(1e-12, 1e-12 × abs(expected))` | ai-proposed | |

## Dependency pins

All pins are **ai-proposed**. They were selected around October 9, 2026, and confirmed published at that time; their combined compatibility was never tested. Re-verify at the start of implementation. A pin may be replaced when it cannot satisfy a requirement or a newer compatible version is preferable; record the new value here and rerun the affected acceptance criteria. Apps never change framework pins.

| ID | Dependency | Version | Notes |
| --- | --- | --- | --- |
| PAR-100 | SST | 4.17.2 | |
| PAR-101 | Wrangler | 4.149.0 | |
| PAR-102 | Drizzle ORM | 0.45.4 | |
| PAR-103 | drizzle-kit | 0.31.11 | |
| PAR-104 | Hono | 4.13.13 | |
| PAR-105 | aws4fetch | 1.0.20 | |
| PAR-106 | jose | 6.2.12 | |
| PAR-107 | PGlite | 0.5.8 | |
| PAR-108 | @pulumi/cloudflare | 6.15.0 | The provider generation SST 4.17.2 pins. |
| PAR-109 | @pulumi/aws | 7.20.0 | The provider generation SST 4.17.2 pins. |
| PAR-110 | Aurora PostgreSQL engine | 17.x | Prefer 17.3 if the region supports it with Data API and auto-pause; otherwise the highest supported 17.x minor. |
| PAR-111 | Node.js, TypeScript, ESLint, test and browser tools, AWS SDKs | To be recorded | Pin at implementation start. |
