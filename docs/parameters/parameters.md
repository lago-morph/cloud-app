# Parameters Register

Tunable values used by the framework — limits, sizes, timeouts, defaults, and dependency version pins — are recorded here and nowhere else. Design documents and contracts refer to values by `PAR-…` ID. A value is added only when a component design or contract actually uses it; spec-level requirements and decisions do not reference concrete values (DEC-0057).

IDs are never reused. IDs 010–013, 020–022, 030–033, 040, 050–053, 061–066, and 080 belonged to entries removed by DEC-0057, and 211 to an entry removed by DEC-0076; all stay retired.

Categories (see [CONVENTIONS.md §5](../CONVENTIONS.md)):

- **owner** — set by the owner; only the owner changes it.
- **platform** — imposed by a cloud platform or dependency; re-verify against the cited source during implementation and whenever the platform changes.
- **ai-proposed** — chosen by an AI with no external basis required; free to change during implementation and testing. When changed, update the value here.

## General

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-001 | Design load | A few simultaneous users | owner | Qualitative; see SYS-REQ-007. |

## HTTP

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-200 | Maximum JSON request body | 1,000,000 bytes | ai-proposed | Used by HTTP-REQ-003. Must stay below PAR-201 and PAR-202. |
| PAR-201 | AWS Lambda request payload limit | 6 MB, less for binary bodies, which are base64-encoded | platform | AWS Lambda quotas. Why large files bypass the API (DEC-0058). |
| PAR-202 | Cloudflare Workers request body limit | 100 MB (Free and Pro plans) | platform | Cloudflare Workers limits. |

## SQL and migrations

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-210 | Time budget for reaching the database, including resume from pause | 45 seconds | ai-proposed | SQL-REQ-006 and the deploy-time wait. Must be below PAR-270. |
| PAR-212 | Aurora capacity range | 0 to 4 ACU | ai-proposed | 0 lets the database pause when idle. |
| PAR-213 | Aurora auto-pause delay | 5 minutes | ai-proposed | Platform minimum is 300 seconds. |
| PAR-214 | Data API maximum response size | 1 MiB | platform | RDS Data API quotas. |
| PAR-215 | Portable maximum query result size | 256 KiB | ai-proposed | Enforced on every target, measured as defined in sql.md §2.3. Leaves room for the Data API's JSON encoding within PAR-214. |

## KV

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-220 | Maximum key length | 1,024 UTF-8 bytes | ai-proposed | |
| PAR-221 | Default list page size | 20 | ai-proposed | |
| PAR-222 | Maximum list page size | 50 | ai-proposed | 50 × (PAR-220 + PAR-223) stays within PAR-215. |
| PAR-223 | Maximum value size | 4,096 UTF-8 bytes | ai-proposed | |

## Files

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-230 | Maximum file name length | 1,024 UTF-8 bytes | platform | S3 and R2 object key limit. |
| PAR-231 | Default list page size | 100 | ai-proposed | |
| PAR-232 | Maximum list page size | 1,000 | platform | S3 `ListObjectsV2` returns at most 1,000 keys per call. |
| PAR-233 | Transfer ticket lifetime | 15 minutes | ai-proposed | On AWS, also capped by the Lambda role credentials' expiry. |
| PAR-234 | Maximum single-upload file size | About 5 GB (S3: 5 GB; R2: 5 GiB) | platform | Not a framework limit; larger files would need multipart upload (DEC-0062). |

## Secrets

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-240 | Maximum cache lifetime of a secret value read on AWS | 60 seconds | ai-proposed | |

## Authentication

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-250 | Session lifetime | 7 days | ai-proposed | The owner has no preference (DEC-0057). |
| PAR-251 | Validity of an in-progress login | 10 minutes | ai-proposed | |
| PAR-252 | Clock skew tolerated when validating provider responses | 60 seconds | ai-proposed | |
| PAR-253 | Minimum session signing key length | 32 bytes | ai-proposed | |

## Log

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-260 | Maximum time a response waits for pending log writes | 2 seconds | ai-proposed | Matters on AWS, where a frozen Lambda would lose pending writes. |

## AWS deployment

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-060 | Default AWS region | `us-east-1` | ai-proposed | Used by `setup-account` unless another region is chosen there (SYS-REQ-023, DEC-0075). |
| PAR-270 | HTTP Lambda timeout | 60 seconds | ai-proposed | Must exceed PAR-210. |
| PAR-271 | API read timeout at the AWS router | 60 seconds | ai-proposed | At least PAR-270. |

## AI skill

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-070 | Maximum size of the skill's top-level router document | 8,000 UTF-8 bytes | ai-proposed | |
| PAR-071 | Maximum size of each capability reference document | 12,000 UTF-8 bytes | ai-proposed | |
| PAR-072 | Maximum size of each complete example | 20,000 UTF-8 bytes | ai-proposed | |

## Testing

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-280 | Floating-point comparison tolerance in compliance tests | `abs(actual − expected) ≤ max(1e-12, 1e-12 × abs(expected))` | ai-proposed | |

## Names

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-290 | Maximum app name length | 20 characters | ai-proposed | Lowercase letters, digits, hyphens. Keeps `<app>-<stage>-<purpose>` within cloud resource-name limits. |
| PAR-291 | Maximum stage name length | 20 characters | ai-proposed | Same character set as app names. |

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
| PAR-110 | Aurora PostgreSQL engine | 17.x | The highest 17.x minor that the region supports with Data API and auto-pause, resolved at implementation start. |
| PAR-111 | Node.js, TypeScript, ESLint, test runner, AWS SDKs | To be recorded | Pin at implementation start. |
| PAR-112 | Zod | 4.x; exact version at implementation start | Re-exported to apps (DEC-0059). |
| PAR-113 | Vite | To be recorded | Client build and local dev server. |
| PAR-114 | Playwright | To be recorded | Browser-level compliance tests. |
