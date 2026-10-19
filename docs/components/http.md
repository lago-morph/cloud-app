# HTTP — HTTP and hosting

API routing conventions, the HTTP error format, request validation and size limits, serving the browser client from the same deployment as the API, and the browser-side `api` helper.

Contracts: [http.d.ts](../contracts/ts/http.d.ts), [client.d.ts](../contracts/ts/client.d.ts) (`api`, `ApiError`), [framework.openapi.yaml](../contracts/http/framework.openapi.yaml) (`ErrorResponse`), [errors.d.ts](../contracts/ts/errors.d.ts).

## 1. Requirements

#### HTTP-REQ-001 — API and client paths
Origin: provenance-unclear · Derives from: SYS-REQ-008

All API routes MUST be under `/api`. Every other path MUST serve the browser client, with unknown non-API paths serving the client's entry page. An unknown `/api` path MUST return 404 `HTTP.NOT_FOUND` as an `ErrorResponse`, never the client page.

#### HTTP-REQ-002 — Error format
Origin: owner-approved · Derives from: SYS-REQ-010

Every error response from an API route MUST be an `ErrorResponse` whose status is the catalogue status for its code and whose `requestId` matches the request. Responses MUST NOT contain stack traces, provider error text, or secret values.

#### HTTP-REQ-003 — Validated input
Origin: provenance-unclear · Derives from: SYS-REQ-007, SYS-REQ-010

JSON request bodies larger than PAR-200 MUST be rejected with `HTTP.PAYLOAD_TOO_LARGE` before parsing. `jsonBody` and `queryParams` MUST reject invalid input with `HTTP.INVALID_INPUT` before the handler runs.

#### HTTP-REQ-004 — One origin per deployment
Origin: ai-proposed · Derives from: SYS-REQ-008

On every target the browser client and the API MUST be served from one origin, so app browser code never needs cross-origin configuration (DEC-0040).

#### HTTP-REQ-005 — API responses are not cached
Origin: provenance-unclear · Derives from: SYS-REQ-017

API responses MUST carry `Cache-Control: no-store` unless a route sets its own caching, and no cache between the browser and the API may serve one user's response to another.

#### HTTP-REQ-006 — Browser API helper
Origin: owner-approved · Derives from: SYS-REQ-008, SYS-REQ-010

The `api` helper MUST send requests to the app's own API with the browser's session cookie, MUST parse `ErrorResponse` bodies into `ApiError` with the catalogue code, and MUST report unreachable APIs as `HTTP.NETWORK_ERROR`. Any response that is neither a valid `ErrorResponse` nor a successful response (2xx with a JSON body or no body) MUST become `HTTP.NETWORK_ERROR`, with `ApiError.status` set to the received status, `requestId` null, and the message `response did not come from the app (status N)`.

#### HTTP-REQ-007 — Server errors are logged
Origin: ai-proposed · Derives from: SYS-REQ-010, SYS-REQ-021

Every API response with status 500 or above MUST be accompanied by exactly one `error` log entry holding the method, the route path, the code, the underlying error's name, message, and stack, and, where relevant, the missing configuration key or secret name. Framework log entries MUST NOT include request headers, cookies, request or response bodies, OAuth codes, state, nonces or tokens, or ticket URLs.

## 2. Design

**Validation** uses Zod, re-exported at the framework's pinned version (PAR-112) so apps have exactly one validation library (DEC-0059). `jsonBody` checks `Content-Length` and the streamed size against PAR-200 before parsing, and stops reading at the first byte over the limit. It does not require a JSON `Content-Type`; a body that does not parse as JSON is `HTTP.INVALID_INPUT`. `queryParams` validates one string per name (the first value). `HTTP.INVALID_INPUT` messages name each failing field (`body.title: …`, `query.page: …`) without repeating input values (DEC-PENDING-B-03-4).

**Runtime parts.** HTTP fills the assembler's slots (core.md §2) through the framework-internal `createHttpParts({ healthChecks, secretValues })` (`src/http/runtime.ts`): the error handler, the not-found handler, and framework routes holding the `no-store` middleware and the health route. The target runtime then calls `attach(app)` with the assembled app so the not-found handler can see its routes (DEC-PENDING-B-03-1).

**Error handler.** One Hono `onError` handler maps `FrameworkError` codes through the catalogue; anything else is `CORE.INTERNAL`, and browser-only codes (status null) answer 500. Responses below 500 keep a `FrameworkError`'s own message; responses of 500 and above carry only the catalogue meaning, so provider text and wiring details stay in the log. Known secret values (supplied by the runtime from SEC) are replaced by `[redacted]` in both the response and the log entry (DEC-PENDING-B-03-2). A Hono 404 becomes `HTTP.NOT_FOUND`, and a path some route registers only for other methods becomes `HTTP.METHOD_NOT_ALLOWED` with an `Allow` header. Paths outside `/api` never reach the Worker on a deployed target; in-process they get the same `HTTP.NOT_FOUND` (DEC-PENDING-B-03-1). Error responses always carry `Cache-Control: no-store`. For any response with status 500 or above it writes the HTTP-REQ-007 entry through LOG's `logFailure`, so LOG-REQ-005's entry for the same failure (an adapter's `*.UNAVAILABLE`) is that entry, not a second one. The entry's path is the matched route's pattern (`/api/notes/:id`), never the query string, so IDs, tokens and ticket values in paths are not logged; the missing configuration key or secret name reaches the entry through the error's message, which CFG and SEC write to name it (DEC-PENDING-B-03-3).

**Health route.** `GET /api/__framework/health` ([framework.openapi.yaml](../contracts/http/framework.openapi.yaml)) is what the deploy health check calls (PROV-REQ-002). It runs the runtime's health checks in order (one trivial SQL read; every declared and every required framework secret has a value) and answers 204, or the first failure's `ErrorResponse` through the error handler (DEC-PENDING-B-03-5).

**Browser helper.** `api` requests `/api<path>` (relative, so the page's own origin) with `credentials: "same-origin"`, JSON-encodes `body` and URL-encodes `query`. A 2xx with an empty body resolves `undefined`; a 2xx with a JSON `Content-Type` resolves its parsed body. A non-2xx whose body is exactly an `ErrorResponse` with a catalogue code becomes `ApiError` with that code, the status, message and request ID. Anything else is `HTTP.NETWORK_ERROR` with the status, `requestId` null and `response did not come from the app (status N)`; a failed fetch is `HTTP.NETWORK_ERROR` with status null and `could not reach the API`. `ApiError`'s constructor is `(message?, { code?, status?, requestId?, cause? })`, compatible with the contract's inherited `Error` constructor; other browser helpers (AUTH, FILES) use it too (DEC-PENDING-B-03-6).

**Request size.** Large files never pass through the API; they move directly between browser and storage (FILES, DEC-0058). PAR-200 therefore only has to cover ordinary JSON. It stays well under the smallest platform request limit (PAR-201, PAR-202).

### Local
Vite serves the client and proxies `/api` to the Worker running under Wrangler (`wrangler dev`, workerd). Both run under one origin, `http://localhost:<port>`.

### Cloudflare
One Worker serves both: static assets are uploaded with the Worker, the Worker runs first for `/api` and `/api/*`, and the assets layer serves everything else with single-page-app fallback to `index.html`.

### AWS
A CloudFront distribution (SST Router) sends `/api` and `/api/*` to the HTTP Lambda's Function URL (DEC-0044) and every other path to the static site bucket, with `index.html` fallback. API behaviors use a no-caching policy and forward cookies, query strings, and the `Origin` header, but not `Host`, which must be the Function URL's own host. The router's read timeout (PAR-271) exceeds the Lambda timeout (PAR-270), so the framework's own error arrives before a gateway timeout.

## 3. Uses

CORE (error catalogue), LOG (error entries for server errors).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| HTTP-AC-001 | `GET /api/does-not-exist` returns 404 `HTTP.NOT_FOUND` JSON; `GET /some/deep/link` returns the client entry page. | HTTP-REQ-001 | Local, cloud |
| HTTP-AC-002 | For every catalogue code with a status, a reference route throwing it returns that status and a schema-valid `ErrorResponse` with the request's ID; a route throwing an error containing a known secret value does not echo it. | HTTP-REQ-002 | Local, cloud |
| HTTP-AC-003 | A body of PAR-200 + 1 bytes is rejected with 413 before the handler runs; a schema-invalid body is rejected with 400 `HTTP.INVALID_INPUT`. | HTTP-REQ-003 | Local, cloud |
| HTTP-AC-004 | The deployed client calls the API with no CORS preflight and no cross-origin requests to the API. | HTTP-REQ-004 | Cloud |
| HTTP-AC-005 | Two different mock users requesting the same personal route through the deployed router each receive their own response; API responses carry `no-store`. | HTTP-REQ-005 | Cloud |
| HTTP-AC-006 | In a browser test, `api` sends the session cookie, throws `ApiError` with the server's code on an error response, and throws `HTTP.NETWORK_ERROR` when the API is unreachable. A stubbed 502 HTML response and a non-JSON 200 each throw `HTTP.NETWORK_ERROR` with that status, `requestId` null, and the `response did not come from the app` message. | HTTP-REQ-006 | Local |
| HTTP-AC-007 | Through `TestApp.logs()`: reference routes raising `CORE.INTERNAL`, `CORE.MISCONFIGURED`, `CFG.UNDECLARED_KEY`, `SEC.MISSING`, and (with `unavailable: ["sql"]`) `SQL.UNAVAILABLE` each leave exactly one `error` entry with method, route path, code, error name, message, and stack, plus the key or secret name for the CFG and SEC cases. A failing request carrying a session cookie, a JSON body, and OAuth-like `code` and `state` query values leaves none of those values in any entry. | HTTP-REQ-007 | Local |

## 5. Portability note

The HTTP contract is plain HTTP plus Web APIs. A new target needs only a way to route `/api` to the runtime and serve static files from the same origin.
