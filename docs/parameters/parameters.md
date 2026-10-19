# Parameters Register

Tunable values used by the framework — limits, sizes, timeouts, defaults, and dependency version pins — are recorded here and nowhere else. Design documents and contracts refer to values by `PAR-…` ID. A value is added only when a component design or contract actually uses it; spec-level requirements and decisions do not reference concrete values (DEC-0057).

Categories (see [CONVENTIONS.md §5](../CONVENTIONS.md)):

- **owner** — set by the owner; only the owner changes it.
- **platform** — imposed by a cloud platform or dependency; re-verify against the cited source during implementation and whenever the platform changes.
- **ai-proposed** — chosen by an AI with no external basis required; free to change during implementation and testing. When changed, update the value here.

## General

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-001 | Design load | A few simultaneous users | owner | Qualitative; see SYS-REQ-007. |

## AWS deployment

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-060 | Default AWS region | `us-east-1` | ai-proposed | Deployment setting, overridable per stage (SYS-REQ-023, DEC-0045). |

## AI skill

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-070 | Maximum size of the skill's top-level router document | 8,000 UTF-8 bytes | ai-proposed | |
| PAR-071 | Maximum size of each capability reference document | 12,000 UTF-8 bytes | ai-proposed | |
| PAR-072 | Maximum size of each complete example | 20,000 UTF-8 bytes | ai-proposed | |

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
