# HTTP and validation

Read this when you add or change an API route, validate input, report an error from a route, write browser code that calls the API, or a `verify` diagnostic names this file (`allowed-imports`, `browser-api-only`, `app-error-codes`, `no-raw-html`).

## Where code goes

| Path | Holds | May import |
| --- | --- | --- |
| `src/app.ts` | The one `defineApp` call | `@lago-morph/prototype-framework`, server code |
| `src/server/**` | Route modules, tables, server helpers | `@lago-morph/prototype-framework`, `hono` (types and `Hono` itself), `zod`, shared and server code |
| `src/shared/**` | Response and request types, Zod schemas used by both sides | `zod` and other shared code only |
| `src/client/**` | Browser code | `@lago-morph/prototype-framework/client`, `zod`, browser code, and shared code with `import type` only |
| `tests/**` | Tests | `@lago-morph/prototype-framework`, `@lago-morph/prototype-framework/testing`, `vitest`, app code |

Server and shared code are type-checked against ES plus Web APIs only: no Node globals (`Buffer`, `process`), no Cloudflare or AWS types. Use Web APIs instead (`crypto.subtle`, `TextEncoder`, `btoa`/`atob`, `URL`, `ReadableStream`).

## Adding a route

1. Declare the response type once in `src/shared/types.ts` (for example `export interface NoteList { readonly notes: readonly Note[] }`). Shared code cannot name framework types such as ticket types (`allowed-imports`, CHECK-REQ-001), so give the shared type a type parameter (`interface Photo<T> { readonly ticket: T }`) and use `Photo<DownloadTicket>`, importing `type DownloadTicket` from `@lago-morph/prototype-framework` on the server and from `@lago-morph/prototype-framework/client` in the browser.
2. Write a route module in `src/server/routes/<name>.ts` exporting `function <name>Routes(api: Hono<Env>): void`, with `import type { Hono } from "hono"` and `import type { Env } from "../env"`. `Env` comes from `src/server/env.ts`: `type Env = AppEnv<typeof config, (typeof secrets)[number]>`.
3. Register it in `src/app.ts` inside `routes: (api) => { … }`.
4. Paths are written without `/api`; the framework mounts every route under `/api`. `api.get("/notes", …)` answers `GET /api/notes`.
5. Build the body as the shared type (`const body: NoteList = { … }; return c.json(body);`). Use `c.json(body, 201)` for a created resource and `c.body(null, 204)` for an empty answer.
6. Add a test (see [testing.md](testing.md)).

Everything a handler may use is on `c.var`: `sql`, `kv`, `files`, `config`, `secrets`, `log`, `user`, `deployment` (`{ app, stage }`) and `requestId`. Never read `c.env` or `c.executionCtx`, and never call `onError` or `notFound` (`no-env-access`, see [configuration.md](configuration.md)).

## Guards

Put the guard on the route itself, before the validator and the handler:

- `requireUser()`: anonymous → 401 `AUTH.UNAUTHENTICATED`; the handler sees `c.var.user` as a `LoggedInUser` (`id`, `level`, `displayName`).
- `requireAdmin()`: also rejects a non-admin user with 403 `AUTH.FORBIDDEN`.
- A route with no guard is open to anyone, including anonymous callers.
- Where a guard is applied with `api.use(…)`, types are not narrowed: inside the handler call `requireCurrentUser(c)` to get the `LoggedInUser` (it throws `AUTH.UNAUTHENTICATED` for anonymous).

Who counts as `user` or `admin` is configuration, not code: see [current-user.md](current-user.md).

Never change state in a `GET` route. State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) that carry a session must come from the app's own origin; the browser helper `api` does this for you, and a request from another origin gets 403 `AUTH.REQUEST_FORGERY`.

## Validating input

- JSON body: `jsonBody(schema)` as middleware, then `c.req.valid("json")` in the handler.
- Query string: `queryParams(schema)`, then `c.req.valid("query")`. Each query value is one string (the first one given); use `z.coerce.number().int()` for numbers and `.optional()` for optional ones.
- Import `z` from `@lago-morph/prototype-framework` in server code and from `zod` in shared or browser code; both are the same pinned version.
- An invalid body or query answers 400 `HTTP.INVALID_INPUT` whose message names each failing field; the handler does not run. A JSON body over 1,000,000 bytes (PAR-200) answers 413 `HTTP.PAYLOAD_TOO_LARGE`. Large content goes through files, never through the API ([files.md](files.md)).
- Path parameters (`api.get("/notes/:id", …)`, then `c.req.param("id")`) are not validated for you. IDs are UUIDs, and comparing an `id()` or `ref()` column with a value that is not one is 400 `SQL.INVALID_VALUE` ([sql-and-migrations.md](sql-and-migrations.md)). So check a path ID with `z.uuid().safeParse(c.req.param("id"))` before querying, and when it fails answer `HTTP.NOT_FOUND`, as for an ID that matches no row your caller may see.
- Put length limits on every string (`z.string().min(1).max(500)`), and `.trim()` where blank input should be refused.

## Reporting errors

Every error response is `{ "error": { "code", "message", "requestId" } }` with the code's status. When your code refuses a request, throw `FrameworkError` with exactly one of these codes:

| Reason | Code | Status |
| --- | --- | --- |
| The resource does not exist, or is private and the caller may not see it | `HTTP.NOT_FOUND` | 404 |
| The caller may see the resource but not change it | `AUTH.FORBIDDEN` | 403 |
| The input is invalid | `HTTP.INVALID_INPUT` | 400 |
| The current state or a limit does not allow the request | `HTTP.CONFLICT` | 409 |

`throw new FrameworkError("HTTP.NOT_FOUND", "note not found")`. Your message is returned to the browser for these codes, so never put private data or secret values in it. Never throw `SQL.*`, `KV.*`, `FILES.*`, `SEC.*` or `CFG.*` yourself: those come from the framework (`app-error-codes`). A uniqueness violation, for example, reaches the caller as 409 `SQL.CONFLICT` without any code of yours.

Any other thrown value becomes 500 `CORE.INTERNAL`: the response carries only the code's meaning, and the details (method, route, error name, message, stack) go to the log with the request ID ([log.md](log.md)). Each code's meaning is in the framework's error catalogue (`ERROR_CATALOGUE`, exported from `@lago-morph/prototype-framework`).

API responses are never cached (`Cache-Control: no-store`); you need not set caching headers.

## Browser code

- Call the API only with `api<T>(path, { method, body, query })` from `@lago-morph/prototype-framework/client`. `path` is relative to `/api` (`api<NoteList>("/notes")`). `body` is sent as JSON. Never use `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` (`browser-api-only`), and never import `@lago-morph/prototype-framework` or `/testing` from browser code.
- A failed call throws `ApiError` with `code`, `status` and `requestId`. `HTTP.NETWORK_ERROR` means no framework response arrived (`requestId` is null). Show the request ID to the user: it is what the owner looks up in the log.
- Session helpers: `getCurrentUser()`, `login(returnTo?)`, `logout()` ([current-user.md](current-user.md)). File helpers: `uploadFile`, `downloadUrl` ([files.md](files.md)).
- **Never insert user text as HTML.** Create elements with `document.createElement` and set `textContent`. Never write `innerHTML` or `outerHTML`, and never call `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `setHTMLUnsafe` or use `dangerouslySetInnerHTML` (`no-raw-html`).
- `index.html` loads the client with an absolute URL: `<script type="module" src="/src/client/main.ts"></script>`. Any path outside `/api` returns this page, so the client can route deep links itself.

## Check rules that send you here

- `prototype-framework/allowed-imports`: the import is not allowed in this kind of file (table above). Node built-ins (`node:fs`, `fs`, `crypto`, `buffer`, …), platform SDKs, database drivers, `drizzle-orm/*` subpaths, Hono platform adapters and framework subpaths such as `/targets/*`, `/provision` and `/check` are never allowed. Replace a Node API with its Web API equivalent; replace a platform service with the framework capability (`c.var.sql`, `kv`, `files`, `secrets`, `config`, `log`).
- `prototype-framework/browser-api-only`: browser code used `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`, or imported the framework other than `/client`. Use `api`, `uploadFile`, `downloadUrl`.
- `prototype-framework/app-error-codes`: a `FrameworkError` with a code outside the table above. Pick the row that matches the reason.
- `prototype-framework/no-raw-html`: a raw-HTML sink in browser code. Build elements and set `textContent`.
- Do not disable a rule, add `eslint-disable` or `@ts-…` comments, or edit lint configuration: `verify` ignores and rejects them. If the framework truly leaves no way to do the task, record a `FRAMEWORK-ISSUE.md` entry as the router says.

## Examples

- [examples/endpoint-and-page.md](../examples/endpoint-and-page.md): an open route, shared types, `api`, error display, `index.html`.
- [examples/notes-sql.md](../examples/notes-sql.md): guarded routes with `jsonBody`.
- [examples/admin-and-current-user.md](../examples/admin-and-current-user.md): `requireAdmin()` and `requireCurrentUser(c)`.

## Stopping condition

Stop reading when your route has a guard (or is deliberately open), validates its input, throws only the four codes above, returns a shared type, has a test, and `npm run verify` passes. For storage inside the route, read only the reference for that capability.
