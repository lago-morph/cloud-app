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

App name, stage, target, and the test-stage flag MUST be fixed when a deployment is built. They MUST NOT be derived from request data such as the Host header. App code MUST see only the app name and stage. The target and the test-stage flag stay framework-internal, so app code cannot behave differently per cloud or under test.

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
| `./targets/<target>`, one subpath per supported target (`./targets/local`, `./targets/cloudflare`, `./targets/aws`) | Target runtimes | Generated entry points only |
| `./provision` | Provisioning | CLI only |
| `./check` | Portability rules and migration checker | CLI and lint configuration only |

#### CORE-REQ-006 — Clean runtime bundles
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-004, SYS-REQ-020

Each target's runtime bundle MUST exclude other targets' adapters, provisioning and tooling code. Cloud bundles MUST also exclude the test-only stub login provider, the local file-transfer route (`/api/__framework/files/*`), and that route's ticket key. Production deployments MUST also exclude the authentication mock.

#### CORE-REQ-007 — Codes for app-reported failures
Origin: ai-proposed · Derives from: SYS-REQ-010

When app code rejects a request for one of the reasons below, it MUST throw `FrameworkError` with the listed code.

| Reason | Code |
| --- | --- |
| The resource does not exist, or is private and the caller may not see it | `HTTP.NOT_FOUND` |
| The caller may see the resource but not change it | `AUTH.FORBIDDEN` |
| The input is invalid | `HTTP.INVALID_INPUT` |
| The current state or a limit does not allow the request | `HTTP.CONFLICT` |

App code MUST NOT throw codes owned by capability components (`SQL.*`, `KV.*`, `FILES.*`, `SEC.*`, `CFG.*`).

## 2. Design

**Hono.** An app is a Hono application (DEC-0023). `defineApp` returns a definition, not a running app; each target runtime builds the Hono app, mounts `routes` under `/api`, and installs framework middleware in this order: request ID → log writer → error handler → deployment and services → current user → request forgery check → app routes. The log writer is created right after the request ID, before any other service, so every later failure can be logged. Adapters defer binding and environment-variable checks to the first request and raise `CORE.MISCONFIGURED` there, instead of throwing at module load.

**Runtime assembly.** The target runtimes share one framework-internal assembler (`src/core/assemble.ts`). It takes the app definition and the target's runtime parts: the embedded deployment, a log-writer factory (LOG), the `createServices` factory, the current-user middleware and the request forgery check (AUTH), and optionally the error handler, the not-found handler (HTTP) and the framework's own `/api` routes, which are registered after the framework middleware and before app routes. The request ID is a fresh random UUID per request, never read from request headers. When no error handler is supplied, a core default maps `FrameworkError` codes through the catalogue and turns anything else, including thrown non-`Error` values, into `CORE.INTERNAL`; it writes one `error` entry for each response of status 500 or above, with the method, path without query string, code, and the error's name, message and stack (DEC-0119). The assembler itself re-checks the embedded identity against the name rules and the app definition's name on the first request, not at assembly, and answers `CORE.MISCONFIGURED` there; adapters use the same deferred-check helper (DEC-0120).

**Services per request.** Each target exports a `createServices(env, deployment, log)` factory used by its runtime; it receives the request's log writer, which already exists, and returns the other services. Cheap, binding-backed objects are created per request on Cloudflare and locally. On AWS, SDK clients are created once per cold start and reused, but nothing request-specific is cached across requests.

**Deployment identity** is embedded by the build (CLI) from the app definition and the stage configuration. App names use lowercase letters and digits only, with no hyphens, up to PAR-290 characters, so a `<app>-<stage>-` prefix belongs to exactly one app; the build rejects any other app name. Stage names use lowercase letters, digits, and hyphens, up to PAR-291 characters. The test-stage flag is true exactly when the stage name starts with `test-` (PROV-REQ-005); it is computed by the build, not read from configuration or a command-line flag. A name that breaks a rule fails with `CORE.MISCONFIGURED` and a message naming the app-name or stage-name rule (DEC-0118).

**Errors.** `FrameworkError` carries a code; the HTTP error handler (HTTP) maps the code to its catalogue status. Any other thrown value becomes `CORE.INTERNAL`; the original error is written to the log with the request ID and never returned.

**Testing.** `createTestApp` runs app code in the test runner's Node process against fresh local storage (Miniflare-backed D1 and R2, or PGlite for the Postgres dialect; SQL §2), with migrations applied and the authentication mock installed. Because it shares the runner's process, the runner's fake timers also govern framework time checks such as session and ticket expiry. It echoes every framework `error` log entry to stderr as it is written, and `logs()` returns the entries written so far. The `unavailable` option makes the named capabilities fail with their `*.UNAVAILABLE` codes. The dialect is fixed per test process: `verify` runs the suite once per supported dialect, each in its own process (CLI), so dialect-specific tables built at import are never shared between dialects. `connectTestStage` gives the same `TestApp` shape for the deployed test stage that `smoke` (CLI) runs against.

## 3. Uses

AUTH (current user middleware), HTTP (error handler), all capability adapters (via target runtimes), CFG (deployment identity values).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CORE-AC-001 | A fixture app using only `.` exports type-checks, and `c.var` has exactly the `RequestVars` members. A second fixture with routes in a separate file type-checks config value types (a wrong value type fails type checking). Every framework type appearing in a public signature can be imported from the subpath whose signatures use it. | CORE-REQ-001, CORE-REQ-005 | Local |
| CORE-AC-002 | One unmodified app module builds and starts on local, Cloudflare, and AWS. | CORE-REQ-002 | Local, cloud |
| CORE-AC-003 | Requests with forged Host or forwarding headers do not change `c.var.deployment`; `c.var.deployment` has exactly the members `app` and `stage`. | CORE-REQ-003 | Local, cloud |
| CORE-AC-004 | Every code thrown by framework source appears in the catalogue; an app throwing a plain `Error` yields 500 `CORE.INTERNAL` with no stack trace or message details in the response. | CORE-REQ-004 | Local |
| CORE-AC-005 | The package's exports map equals the subpath table; a fixture importing `./targets/aws` from app code fails the verification command. | CORE-REQ-005 | Local |
| CORE-AC-006 | Bundle inspection: the Cloudflare bundle contains no AWS SDK, provisioning, or Postgres harness modules; the AWS bundle contains no Cloudflare-only modules; no cloud bundle contains the stub login provider, the local file-transfer route, or its ticket key; production bundles contain no mock. | CORE-REQ-006 | Local |
| CORE-AC-007 | Building a fixture app whose name contains a hyphen fails with a message naming the app-name rule. | CORE-REQ-003 | Local |
| CORE-AC-008 | Fixture routes throwing each code in the CORE-REQ-007 table return that code with its catalogue status; a fixture app that throws a capability-owned code (for example `SQL.CONFLICT`) from its own code fails `verify`. | CORE-REQ-007 | Local |

## 5. Portability note

`Services` and `RequestVars` contain no target concepts. A new target adds one adapter per capability, a `./targets/<target>` subpath (CORE-REQ-005), and its identifier to the target enumerations listed in the component map (§1). Those additions are contract changes; the app-facing contracts in this component do not change.
