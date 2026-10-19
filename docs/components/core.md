# CORE — App contract

Defines what app code is given and how an app is defined: the services and named context shapes, the app definition, deployment identity, the structure of the error catalogue, and the package's public export list.

Contracts: [core.d.ts](../contracts/ts/core.d.ts), [errors.d.ts](../contracts/ts/errors.d.ts), [index.d.ts](../contracts/ts/index.d.ts), [testing.d.ts](../contracts/ts/testing.d.ts).

## 1. Requirements

#### CORE-REQ-001 — Capabilities only through named contexts
Origin: owner-approved · Derives from: SYS-REQ-004, SYS-REQ-009

Server-side app code MUST obtain capabilities only through the named context shapes `Services` and `RequestVars` (`c.var` in HTTP handlers). The SQL write handle `WriteDb` is the only other context shape and is defined by SQL.

#### CORE-REQ-002 — One app definition, generated entry points
Origin: ai-proposed · Derives from: SYS-REQ-001, SYS-REQ-004

An app MUST be defined by one `defineApp` call in its entry module. Target entry points MUST be generated from that module; app code MUST NOT construct adapters or select a target.

#### CORE-REQ-003 — Deployment identity is fixed
Origin: provenance-unclear · Derives from: SYS-REQ-002, SYS-REQ-020

App name, stage, target, and the test-stage flag MUST be fixed when a deployment is built. They MUST NOT be derived from request data such as the Host header.

#### CORE-REQ-004 — Single error catalogue
Origin: owner-approved · Derives from: SYS-REQ-010

`errors.d.ts` MUST be the single source of error codes. Every framework failure surfaced to app code, browser helpers, or HTTP MUST carry a catalogue code. Uncaught errors that are not `FrameworkError` MUST surface as `CORE.INTERNAL`, with details only in the log.

#### CORE-REQ-005 — Public export list
Origin: owner-approved · Derives from: SYS-REQ-004, SYS-REQ-006

The package MUST expose exactly the subpaths below, and the portability rules MUST reject imports outside each subpath's allowed importers.

| Subpath | Contents | Importable by |
| --- | --- | --- |
| `.` | Server-side app API ([index.d.ts](../contracts/ts/index.d.ts)) | App server code, app tests |
| `./client` | Browser helpers ([client.d.ts](../contracts/ts/client.d.ts)) | App browser code |
| `./testing` | Test helpers ([testing.d.ts](../contracts/ts/testing.d.ts)) | App test files |
| `./targets/local`, `./targets/cloudflare`, `./targets/aws` | Target runtimes | Generated entry points only |
| `./provision` | Provisioning | CLI only |
| `./check` | Portability rules and migration checker | CLI and lint configuration only |

#### CORE-REQ-006 — Clean runtime bundles
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-004, SYS-REQ-020

Each target's runtime bundle MUST exclude other targets' adapters, provisioning and tooling code, and, for production deployments, the authentication mock.

## 2. Design

**Hono.** An app is a Hono application (DEC-0023). `defineApp` returns a definition, not a running app; each target runtime builds the Hono app, mounts `routes` under `/api`, and installs framework middleware in this order: request ID → error handler → deployment and services → current user → request forgery check → schema readiness → app routes.

**Services per request.** Each target exports a `createServices(env, deployment)` factory used by its runtime. Cheap, binding-backed objects are created per request on Cloudflare and locally. On AWS, SDK clients are created once per cold start and reused, but nothing request-specific is cached across requests.

**Deployment identity** is embedded by the build (CLI) from the app definition and the stage configuration.

**Errors.** `FrameworkError` carries a code; the HTTP error handler (HTTP) maps the code to its catalogue status. Any other thrown value becomes `CORE.INTERNAL`; the original error is written to the log with the request ID and never returned.

**Testing.** `createTestApp` runs the app in-process against fresh local storage with migrations applied and the authentication mock installed. With `dialect: "postgres"` it uses the Postgres harness instead of local D1 (SQL §2).

## 3. Uses

AUTH (current user middleware), HTTP (error handler), all capability adapters (via target runtimes), CFG (deployment identity values).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CORE-AC-001 | A fixture app using only `.` exports type-checks, and `c.var` has exactly the `RequestVars` members. | CORE-REQ-001 | Local |
| CORE-AC-002 | One unmodified app module builds and starts on local, Cloudflare, and AWS. | CORE-REQ-002 | Local, cloud |
| CORE-AC-003 | Requests with forged Host or forwarding headers do not change `c.var.deployment`. | CORE-REQ-003 | Local, cloud |
| CORE-AC-004 | Every code thrown by framework source appears in the catalogue; an app throwing a plain `Error` yields 500 `CORE.INTERNAL` with no stack trace or message details in the response. | CORE-REQ-004 | Local |
| CORE-AC-005 | The package's exports map equals the subpath table; a fixture importing `./targets/aws` from app code fails the verification command. | CORE-REQ-005 | Local |
| CORE-AC-006 | Bundle inspection: the Cloudflare bundle contains no AWS SDK, provisioning, or Postgres harness modules; the AWS bundle contains no Cloudflare-only modules; production bundles contain no mock. | CORE-REQ-006 | Local |

## 5. Portability note

`Services` and `RequestVars` contain no target concepts. A new target adds one runtime subpath and one adapter per capability; no contract in this component changes.
