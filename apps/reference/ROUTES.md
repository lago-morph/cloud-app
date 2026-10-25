# Reference app routes

The compliance reference app (`apps/reference`, app name `reference`, COMPL §2). Compliance tests (C-T1…C-T4, and the cloud runs in D) address it only through the routes below. Every path is under `/api`. Unless a route says otherwise:

- request and response bodies are JSON;
- a route marked **user** needs a logged-in user (`requireUser()`; anonymous → 401 `AUTH.UNAUTHENTICATED`), **admin** needs an admin (`requireAdmin()`; user → 403 `AUTH.FORBIDDEN`); unmarked routes are open to anyone;
- state-changing requests that carry a session need `Origin` equal to the public origin (AUTH-REQ-007), as for every app;
- errors are the framework's `ErrorResponse` (`{ error: { code, message, requestId } }`).

Config keys, secret names, tables and the migration fixtures are listed at the end. Decisions: DEC-0250…DEC-0258 (`docs/decisions/decision-log.md`, `Item: C-01`).

## Core and HTTP fixtures

| Method and path | Access | Does | Response | For |
| --- | --- | --- | --- | --- |
| `GET /ref/deployment` | | Returns `c.var.deployment` unchanged | `{ deployment: { app, stage } }` | CORE-AC-003 |
| `GET /ref/request-id` | | Returns `c.var.requestId` | `{ requestId }` | HTTP-AC-002, LOG-AC-002 |
| `GET /ref/throw-plain` | | Throws `new Error("reference plain error")` | 500 `CORE.INTERNAL` | CORE-AC-004, HTTP-AC-007, LOG-AC-002, LOG-AC-005, E2E-011, E2E-013 |
| `GET /ref/throw-secret` | | Reads secret `apiKey` and throws a plain `Error` whose message contains its value | 500 `CORE.INTERNAL` (value redacted) | HTTP-AC-002, SEC-AC-002 |
| `GET /ref/throw-secret-app` | | Reads secret `apiKey` and throws `FrameworkError("HTTP.CONFLICT", …)` whose message contains its value | 409 `HTTP.CONFLICT` (value redacted) | HTTP-AC-002, SEC-AC-002 |
| `POST /ref/log` | | Body `{ severity: "debug"\|"info"\|"warn"\|"error", message: string }`; writes one entry with component `reference` | `{ requestId }` | LOG-AC-001…-004, E2E-011 |
| `GET /ref/two-cookies` | | Sets two cookies, `refOne=1` and `refTwo=2` (`Path=/; HttpOnly; SameSite=Lax`), as two `Set-Cookie` headers | `{ cookies: ["refOne", "refTwo"] }` | COMPL §2 fixture |
| `POST /ref/echo` | | Body `{ text: string }` (no length limit of its own; the framework's PAR-200 applies) | `{ length }` (UTF-16 length of `text`) | HTTP-AC-003, AUTH-AC-007, E2E-013 (invalid input) |
| `GET /ref/echo?text=` | | Query `text` (required, non-empty) | `{ text }` | HTTP-AC-003 (query form) |
| `GET /ref/config` | | Every declared config value | `{ greeting, pageSize, featureOn, tags }` | CFG-AC-001, CFG-AC-003, E2E-014 |
| `GET /ref/secret` | | Reads secret `apiKey`; never returns it | `{ sha256 }` (lowercase hex SHA-256 of the UTF-8 value) | SEC-AC-001, SEC-AC-005, MIG-AC-006 |
| `GET /ref/schema-version` | | Version of the migration fixture compiled in | `{ version: "v1" }` (`"v2"`, `"unique-fail"` with an overlay applied) | E2E-010, MIG-AC-003 |
| `GET /ref/me` | | Returns `c.var.user` unchanged (anonymous: `{ level }`; user/admin: `{ level, id, displayName }`) | `{ user }` | AUTH-AC-001, HTTP-AC-005, E2E-005 |

## Access levels

| Method and path | Access | Response | For |
| --- | --- | --- | --- |
| `GET /levels/anyone` | | `{ level }` | AUTH-AC-004, E2E-005 |
| `GET /levels/user`, `POST /levels/user` | user | `{ level, id }` | AUTH-AC-004, AUTH-AC-007, E2E-005, E2E-013 |
| `GET /levels/admin`, `POST /levels/admin` | admin | `{ level, id }` | AUTH-AC-004, E2E-005, E2E-013 |
| `GET /levels/current` | none as middleware; the handler calls `requireCurrentUser(c)` | `{ level, id }`; anonymous → 401 `AUTH.UNAUTHENTICATED` | AUTH-AC-004 |

## Error routes (HTTP-AC-002, HTTP-AC-007, CORE-AC-008, E2E-013)

One literal route per catalogue code that has an HTTP status: `/errors/<CODE>` (for example `GET /errors/SQL.CONFLICT`). There are no path parameters, so the route path in the HTTP-REQ-007 log entry equals the request path. App code may throw only the CORE-REQ-007 codes (`app-error-codes`), so every other code is raised by the framework itself, by really doing what causes it.

| Route | How the code arises | Caller must |
| --- | --- | --- |
| `GET /errors/CORE.INTERNAL` | throws a plain `Error` | — |
| `GET /errors/CORE.MISCONFIGURED` | calls `defineTable` with an invalid table name inside the handler (schema rule → `CORE.MISCONFIGURED`) | — |
| `GET /errors/HTTP.INVALID_INPUT` | `queryParams` rejects the missing required query value | send no query |
| `GET /errors/HTTP.NOT_FOUND` | app throws `FrameworkError("HTTP.NOT_FOUND")` | — |
| `POST /errors/HTTP.METHOD_NOT_ALLOWED` | the route exists for `POST` only | send `GET` (→ 405 with `Allow: POST`) |
| `POST /errors/HTTP.PAYLOAD_TOO_LARGE` | `jsonBody` rejects a body over PAR-200 | send a body of more than PAR-200 bytes |
| `GET /errors/HTTP.CONFLICT` | app throws `FrameworkError("HTTP.CONFLICT")` | — |
| `GET /errors/SQL.CONFLICT` | inserts the same unique `authors.name` twice (the first row is deleted afterwards) | — |
| `GET /errors/SQL.INVALID_VALUE` | inserts `posts.votes = 2147483648` (rejected before the database) | — |
| `GET /errors/SQL.UNAVAILABLE` | one `select` on `authors` | run with `createTestApp(…, { unavailable: ["sql"] })`; answers 200 otherwise |
| `GET /errors/SQL.RESULT_TOO_LARGE` | inserts one `blobs` row of 300,000 characters, selects it (over PAR-215), deletes it | — |
| `GET /errors/KV.INVALID_KEY` | `kv.get("")` | — |
| `GET /errors/KV.INVALID_CURSOR` | `kv.list("ref:", { cursor: "not-a-cursor" })` | — |
| `GET /errors/KV.VALUE_TOO_LARGE` | `kv.put("ref:too-large", <PAR-223 + 1 bytes>)` | — |
| `GET /errors/KV.UNAVAILABLE` | `kv.get("ref:probe")` | `unavailable: ["kv"]` (or `["sql"]`); 200 otherwise |
| `GET /errors/FILES.INVALID_NAME` | `files.head("")` | — |
| `GET /errors/FILES.INVALID_CURSOR` | `files.list("ref/", { cursor: "not-a-cursor" })` | — |
| `GET /errors/FILES.NOT_FOUND` | `files.createDownloadTicket("ref/missing-<random>")` | — |
| `GET /errors/FILES.UNAVAILABLE` | `files.head("ref/probe")` | `unavailable: ["files"]`; 200 otherwise |
| `GET /errors/CFG.UNDECLARED_KEY` | reads config key `undeclaredKey`, which the app does not declare | — |
| `GET /errors/SEC.UNDECLARED` | reads secret `undeclaredSecret`, which the app does not declare | — |
| `GET /errors/SEC.MISSING` | reads secret `apiKey` | run where `apiKey` has no value; 200 otherwise |
| `GET /errors/SEC.UNAVAILABLE` | reads secret `apiKey` | `unavailable: ["secrets"]`; 200 otherwise |
| `GET /errors/AUTH.UNAUTHENTICATED` | behind `requireUser()` | be anonymous |
| `GET /errors/AUTH.FORBIDDEN` | app throws `FrameworkError("AUTH.FORBIDDEN")` (any level) | — |
| `POST /errors/AUTH.REQUEST_FORGERY` | the framework's forgery check | carry a session and a missing or wrong `Origin` |

A route that answers 200 because the condition is absent returns `{ raised: false }`. `AUTH.LOGIN_FAILED` (400) has no app route: app code may not raise it, and the framework's `/api/auth/callback` answers a failed login with a redirect, not with an `ErrorResponse` (DEC-0168). `AUTH.NOT_VERIFIED` (403) and `AUTH.RATE_LIMITED` (429) have no app route either: only the password provider's own routes raise them (PWD §2, DEC-0520). Status-null codes (`HTTP.NETWORK_ERROR`, `FILES.TRANSFER_FAILED`) never cross HTTP.

## KV (user)

| Method and path | Does | Response |
| --- | --- | --- |
| `GET /kv/value?key=` | `kv.get(key)` | `{ value }` (`null` when absent) |
| `PUT /kv/value` | body `{ key, value }`; `kv.put` | 204 |
| `DELETE /kv/value?key=` | `kv.delete(key)` | 204 |
| `GET /kv/list?prefix=&limit=&cursor=` | `kv.list(prefix, { limit, cursor })`; `limit` an integer, `cursor` optional | `{ items: [{ key, value }], nextCursor }` |

Keys and values are passed as given (empty and over-long ones reach the framework, which rejects them with `KV.*` codes).

## Files (user)

| Method and path | Does | Response |
| --- | --- | --- |
| `GET /files/list?prefix=&limit=&cursor=` | `files.list` | `{ items: [{ name, size, contentType }], nextCursor }` |
| `GET /files/head?name=` | `files.head` | `{ file: { name, size, contentType } \| null }` |
| `GET /files/content?name=` | `files.get` | `{ file: { name, size, contentType, base64 } \| null }` |
| `PUT /files/content` | body `{ name, contentType?, base64 }`; `files.put` (server-side write) | 204 |
| `DELETE /files/content?name=` | `files.delete` | 204 |
| `POST /files/upload-ticket` | body `{ name, contentType? }`; `files.createUploadTicket` | `{ ticket }` |
| `POST /files/download-ticket` | body `{ name }`; `files.createDownloadTicket` | `{ ticket }` |

Names are passed as given (no prefix is added), so FILES-AC-002 names round-trip exactly and invalid ones reach the framework.

## Migration data fixture (user; E2E-010, MIG-AC-002, MIG-AC-003, MIG-AC-006)

| Method and path | Does | Response |
| --- | --- | --- |
| `POST /fixture/load` | inserts the data fixture (3 `parents`, 5 `children`, 2 files under `fixture/`); 409 `HTTP.CONFLICT` if `parents` already has rows | 201 `{ parents: 3, children: 5, files: 2 }` |
| `GET /fixture/dump` | reads every fixture table and file | `{ version, parents, children, files }`, each list sorted (see below) |

Dump shapes: `parents: [{ name, note }]` sorted by `name` (`note` is absent from v2 rows, since v2 drops it); `children: [{ parent, label, rank }]` sorted by `parent`, then `label` (`parent` is the parent's `name`; `rank` is present only in v2, default `0`); `files: [{ name, size, contentType, sha256 }]` sorted by `name`. IDs are generated by `newId()`, so dumps compare by content. Two children share the label `shared` (needed by the `unique-fail` overlay).

## Shared case sets (user; C-T2)

| Method and path | Does | Response |
| --- | --- | --- |
| `GET /cases` | lists the registered case sets | `{ sets: { <set>: [<case>, …] } }` |
| `POST /cases/run` | body `{ set, name, input? }`; runs one case | `{ outcome: "value", value }` or `{ outcome: "undefined" }`; a thrown error is the normal `ErrorResponse`; an unknown set or case is 404 `HTTP.NOT_FOUND` |

A case is `(services: CaseServices, input: unknown) => Promise<unknown>` with `CaseServices = { sql, kv, files, log }`; a case set is `Record<string, Case>`. Types: `src/server/case-types.ts`. The run route takes its sets from `src/server/case-registry.ts`, which ships empty; C-T2's `src/server/cases/index.ts` should export `caseSets: CaseSets`, and the registry then re-exports it (see C-01 decisions). Case tables available: `authors`, `posts`, `tags` (below). Cases should remove the rows and files they create, since cloud stages are shared by every criterion of a run.

## Client

`GET /` (and any non-`/api` path) serves the client entry page. It shows the account section (`data-testid="account"`, buttons `login` / `logout`) and, for a logged-in user, a files section for E2E-009 and FILES-AC-003: a file input `data-testid="file-input"`, button `upload`, status text `upload-status` (`Uploaded.` when done), and one list item `data-testid="file"` per file in `files-list` (filled after each upload, before the status turns `Uploaded.`), each with an `<img data-testid="preview">` and a download link `data-testid="download"`, both using `downloadUrl`. Uploaded files go under `photos/<user id>/`.

## Configuration and secrets

- Config keys: `greeting` (string, default `"Hello"`), `pageSize` (integer, default `20`), `featureOn` (boolean, default `false`), `tags` (string list, default `[]`). `config/local.json` sets `greeting` to `"Hello from local"`; `config/cloudflare/test.json` sets it to `"Hello from a test stage"`. Both have an empty `framework` section. No `prodcheck.json` in this phase.
- Secret: `apiKey` (the test secret). Set locally with `npm run secrets -- set apiKey --target local --stage local` (value on stdin).

## Tables

- Case tables: `authors(id, name unique)`, `posts(id, authorId → authors, title, body?, votes = 0, score = 0, done = false, createdAt, rating?, weight?, flag?, seenAt?)` (`?` nullable; `rating` integer, `weight` number, `flag` boolean, `seenAt` timestamp), `tags(id, postId → posts, label)` with unique `(postId, label)` and an index on `label`.
- `blobs(id, body)`: only for the `SQL.RESULT_TOO_LARGE` route.
- Migration fixture (v1): `parents(id, name, note?, createdAt)`, `children(id, parentId → parents, label)`.

## Migration overlays (E2E-010, MIG-AC-003)

The app as committed is version 1. Each overlay under `versions/<name>/` holds the files that replace the app's own when copied over a copy of the app directory: `src/server/evolution.ts` and the complete `migrations/` tree (remove the app's `migrations/` first, then copy). Each was generated with `generate-migration` from the app at version 1.

- `versions/v2/`: adds `children.rank` (integer, default `0`), adds an index on `children(parentId, rank)`, and drops `parents.note` (a drop on a table with child rows). Only MIG §2 supported changes. One new migration pair `0001_v2`.
- `versions/unique-fail/`: adds a unique constraint on `children.label`; applying it over the data fixture fails (two children are labelled `shared`). One new migration pair `0001_unique_label`.
