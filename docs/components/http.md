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

The `api` helper MUST send the request-forgery header (AUTH) on state-changing requests, MUST parse `ErrorResponse` bodies into `ApiError` with the catalogue code, and MUST report unreachable APIs as `HTTP.NETWORK_ERROR`.

## 2. Design

**Validation** uses Zod, re-exported at the framework's pinned version (PAR-112) so apps have exactly one validation library (DEC-0059). `jsonBody` checks `Content-Length` and the streamed size against PAR-200 before parsing.

**Error handler.** One Hono `onError` handler maps `FrameworkError` codes through the catalogue. A Hono 404 under `/api` becomes `HTTP.NOT_FOUND`, and a matched path with the wrong method becomes `HTTP.METHOD_NOT_ALLOWED`.

**Request size.** Large files never pass through the API; they move directly between browser and storage (FILES, DEC-0058). PAR-200 therefore only has to cover ordinary JSON. It stays well under the smallest platform request limit (PAR-201, PAR-202).

### Local
Vite serves the client and proxies `/api` to the Worker running under Wrangler (`wrangler dev`, workerd). Both run under one origin, `http://localhost:<port>`.

### Cloudflare
One Worker serves both: static assets are uploaded with the Worker, the Worker runs first for `/api` and `/api/*`, and the assets layer serves everything else with single-page-app fallback to `index.html`.

### AWS
A CloudFront distribution (SST Router) sends `/api` and `/api/*` to the HTTP Lambda's Function URL (DEC-0044) and every other path to the static site bucket, with `index.html` fallback. API behaviors use a no-caching policy and forward cookies, query strings, and the request-forgery header. The router's read timeout (PAR-271) is at least the Lambda timeout (PAR-270).

## 3. Uses

CORE (error catalogue), AUTH (request-forgery header name), LOG (uncaught errors).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| HTTP-AC-001 | `GET /api/does-not-exist` returns 404 `HTTP.NOT_FOUND` JSON; `GET /some/deep/link` returns the client entry page. | HTTP-REQ-001 | Local, cloud |
| HTTP-AC-002 | For every catalogue code with a status, a reference route throwing it returns that status and a schema-valid `ErrorResponse` with the request's ID; a route throwing an error containing a known secret value does not echo it. | HTTP-REQ-002 | Local, cloud |
| HTTP-AC-003 | A body of PAR-200 + 1 bytes is rejected with 413 before the handler runs; a schema-invalid body is rejected with 400 `HTTP.INVALID_INPUT`. | HTTP-REQ-003 | Local, cloud |
| HTTP-AC-004 | The deployed client calls the API with no CORS preflight and no cross-origin requests to the API. | HTTP-REQ-004 | Cloud |
| HTTP-AC-005 | Two different mock users requesting the same personal route through the deployed router each receive their own response; API responses carry `no-store`. | HTTP-REQ-005 | Cloud |
| HTTP-AC-006 | In a browser test, `api` sends the forgery header on POST, throws `ApiError` with the server's code on an error response, and throws `HTTP.NETWORK_ERROR` when the API is unreachable. | HTTP-REQ-006 | Local |

## 5. Portability note

The HTTP contract is plain HTTP plus Web APIs. A new target needs only a way to route `/api` to the runtime and serve static files from the same origin.
