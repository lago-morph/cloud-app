# LOG — Log

A minimal write-only log for debugging and for recording failures. Entries go to local files, or to one log bucket per cloud account that all apps share. The owner reads logs directly with the cloud CLI or console.

Contracts: [log.d.ts](../contracts/ts/log.d.ts), [log-entry.schema.json](../contracts/schemas/log-entry.schema.json).

## 1. Requirements

#### LOG-REQ-001 — Write only, never fails the caller
Origin: owner · Derives from: SYS-REQ-021

`log.write(component, severity, message)` is the only operation. It MUST NOT throw, MUST NOT delay the response beyond PAR-260, and a failed write MUST NOT fail the calling operation.

#### LOG-REQ-002 — Entry contents
Origin: owner · Derives from: SYS-REQ-021

Each stored entry MUST conform to the log entry schema. The framework adds the time, app, stage, target, and, during an HTTP request, the request ID.

#### LOG-REQ-003 — Local files
Origin: ai-proposed · Derives from: SYS-REQ-021

Locally, entries MUST be appended as JSON lines to `.logs/<yyyy-mm-dd>.log` in the app directory, which is git-ignored.

#### LOG-REQ-004 — Shared cloud bucket
Origin: owner (one shared bucket per account); ai-proposed (key layout) · Derives from: SYS-REQ-021, SYS-REQ-024

On each cloud, entries MUST be stored one object per entry in the account's shared log bucket, under `<app>/<stage>/<yyyy>/<mm>/<dd>/<time>-<random>.json`. The bucket MUST be created once per account, outside any app or stage, and MUST NOT be removed when a stage is removed.

#### LOG-REQ-005 — Framework failures are logged
Origin: owner · Derives from: SYS-REQ-007, SYS-REQ-021

The framework MUST log uncaught errors (`CORE.INTERNAL`) and every `*.UNAVAILABLE` failure, with component set to the failing component's code.

## 2. Design

There is no severity filtering, no batching, no retention rule, and no per-app isolation within the bucket (DEC-0018).

### Local
Worker code cannot write files directly under workerd. Entries are therefore printed to the Worker's output as single marked lines, and the CLI's `dev` command, which owns the Wrangler process, appends them to `.logs/` (DEC-0066). `createTestApp` collects entries in memory for assertions.

### Cloudflare
An R2 binding to the shared log bucket. Each write is scheduled with the request's `waitUntil` so it does not delay the response.

### AWS
An S3 `PutObject` to the shared log bucket using the Lambda role, which may only put objects there. A frozen Lambda would lose pending writes, so the runtime waits up to PAR-260 for them before completing a response.

The shared bucket is named `prototype-logs-<account-id>` on AWS (in the account's region) and `prototype-logs` on Cloudflare. It is created by the CLI's one-time account setup (PROV).

## 3. Uses

CORE (deployment identity, request ID), PROV (account setup, write permission).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| LOG-AC-001 | With the log bucket unavailable, a request that writes log entries still succeeds, and its response time grows by no more than PAR-260. | LOG-REQ-001 | Local, cloud |
| LOG-AC-002 | Stored entries validate against the schema and carry the request ID from the matching error response. | LOG-REQ-002 | Local, cloud |
| LOG-AC-003 | After `dev`, entries written by the app appear in `.logs/` as JSON lines; `.logs/` is ignored by git. | LOG-REQ-003 | Local |
| LOG-AC-004 | Entries appear under the specified key layout. After a stage is removed, the bucket and other stages' entries remain. | LOG-REQ-004 | Cloud |
| LOG-AC-005 | An app route throwing a plain `Error`, and a forced SQL outage, each produce an `error` entry from the framework. | LOG-REQ-005 | Local, cloud |

## 5. Portability note

Any object store, or any append-only destination, can back this; only the adapter changes.
