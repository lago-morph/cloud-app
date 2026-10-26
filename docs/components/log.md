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

On each cloud, entries MUST be stored one object per entry in the account's shared log bucket, under `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json`, where the date and time are the entry's UTC time and `<id>` is the entry's request ID, or a random value when it has none. The bucket MUST be created once per account, outside any app or stage, and MUST NOT be removed when a stage is removed.

#### LOG-REQ-005 — Framework failures are logged
Origin: owner · Derives from: SYS-REQ-007, SYS-REQ-021

The framework MUST log uncaught errors (`CORE.INTERNAL`) and every `*.UNAVAILABLE` failure, with component set to the failing component's code.

## 2. Design

There is no severity filtering, no batching, no retention rule, and no per-app isolation within the bucket (DEC-0018).

**Finding entries.** The key layout puts the time, severity, and request ID in the object key, so the entries for a request ID from an error response, or all `error` entries of a day, are found by listing keys alone.

**What entries never contain.** Framework entries never include request headers, cookies, request or response bodies, OAuth codes, state, nonces or tokens, or ticket URLs (HTTP-REQ-007), and never secret values (SEC-REQ-002).

**Writer and sinks.** Each target runtime creates one writer per request in CORE's log slot, right after the request ID, giving it the request's ID, method and path (without query), and a *sink* that stores entries for that target. `write` builds the entry, hands it to the sink, and returns: it never awaits the sink, drops a sink's thrown error or rejected promise, and so never throws or delays the response, whatever the sink does (DEC-0128). Tests inject a sink that throws, rejects, or never completes (LOG-AC-001).

**Framework failures** (LOG-REQ-005) are written through one helper, `logFailure(log, error)`: one `error` entry with component = the code's owning component (`CORE` for anything that is not a `FrameworkError`) and message `<METHOD> <path> failed with <code>`, then the error's name, message and stack (HTTP-REQ-007). It remembers each error object it has logged and writes nothing the second time, so an adapter that logs a `*.UNAVAILABLE` failure when it raises it and the HTTP error handler that logs the resulting 5xx response together leave exactly one entry (DEC-0129).

### Local
Worker code cannot write files directly under workerd. Entries are therefore printed to the Worker's output as single marked lines — the marker `[prototype-framework:log] ` followed by the entry's JSON — and the CLI's `dev` command, which owns the Wrangler process, feeds that output through the framework's line capture, which appends each entry as a JSON line to `.logs/<yyyy-mm-dd>.log` (the entry's UTC day) and passes every other line on (DEC-0066, DEC-0130). `createTestApp` collects entries in memory and echoes each `error` entry to stderr as a JSON line when it is written; tests read them through `TestApp.logs()` (DEC-0131).

### Cloudflare
An R2 binding to the shared log bucket, named `LOGS` on the stage Worker. Each entry is one object (`application/json`) at the LOG-REQ-004 key, whose `<id>` is the request ID or, for an entry without one, a random UUID. Each write is scheduled with the request's `waitUntil` so it does not delay the response, and a failed write is dropped. Without a `LOGS` binding (a misconfigured Worker), entries are printed as the marked Worker output lines of the local runtime instead, and requests are unaffected (DEC-0323; code in `src/log/cloudflare/`).

### AWS — deferred (branch `aws`)

Deferred to a later release (DEC-0508): this section describes the AWS target, which is not part of release 1. Its code is on the branch `aws`.
An S3 `PutObject` to the shared log bucket using the Lambda role, which may only put objects there. A frozen Lambda would lose pending writes, so the runtime waits up to PAR-260 for them before completing a response.

The shared bucket is named `prototype-logs-<account-id>` on AWS (in the account's region) and `prototype-logs` on Cloudflare. It is created by the CLI's one-time account setup (PROV; per-target operations: PROV §2). (The AWS bucket: deferred, branch `aws`.)

## 3. Uses

CORE (deployment identity, request ID), PROV (account setup, write permission).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| LOG-AC-001 | Locally, with an injected log writer that fails and one that never completes, a request that writes log entries still succeeds, and its response time grows by no more than PAR-260. On AWS, with a deny on the stage role's `PutObject` to the log bucket, such a request still succeeds; on Cloudflare only the local case applies. The shared bucket itself is never altered. (AWS clause: deferred, branch `aws`.) | LOG-REQ-001 | Local, cloud |
| LOG-AC-002 | Stored entries validate against the schema and carry the request ID from the matching error response. | LOG-REQ-002 | Local, cloud |
| LOG-AC-003 | After `dev`, entries written by the app appear in `.logs/` as JSON lines; `.logs/` is ignored by git. | LOG-REQ-003 | Local |
| LOG-AC-004 | Entries appear under the specified key layout: an entry written during a request has that request's ID and its severity in its key. After a stage is removed, the bucket and other stages' entries remain. (Amended by DEC-0541, owner: the random final part of an entry written outside a request is LOG-REQ-004's rule, verified by the R2 key builder's unit test, because no framework or app path writes such an entry.) | LOG-REQ-004 | Cloud |
| LOG-AC-005 | An app route throwing a plain `Error` produces an `error` entry from the framework, locally and on each cloud. Locally, a SQL outage forced with `createTestApp`'s `unavailable: ["sql"]` also produces one. | LOG-REQ-005 | Local, cloud |

## 5. Portability note

Any object store, or any append-only destination, can back this; only the adapter changes.
