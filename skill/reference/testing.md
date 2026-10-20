# Testing

Read this when you write or fix app tests, write the smoke test, test time-dependent behaviour, or need to know what `verify` and `smoke` run.

## What runs your tests

- `npx prototype-framework verify` runs every `tests/**/*.test.ts` file (PAR-116) with Vitest twice, once on SQLite and once on Postgres, each in its own process, with 60 s test and hook timeouts. It fails if any test fails or if no test passed. Tests must need no network.
- `npx prototype-framework smoke --target <t> --stage <s>` runs only `tests/smoke/**/*.test.ts`, against the running `dev` server (`--target local`) or against a deployed **test** stage (a stage whose name starts with `test-`). It refuses to run when tracked files differ from the last commit (the evidence record names the commit), writes an evidence record to `validation/<target>/<runId>.json` at the top of the git repository that holds the app (the app directory when the app is its own repository; commit the record with the run's commit), and prints the stage's log location for the day.
- An app is not done on a cloud until its smoke test has passed on a deployed stage there.

## In-process tests

Import from `@lago-morph/prototype-framework/testing` (only in `tests/**`):

- `await createTestApp(app, options?)` starts your app in the test process with fresh, empty storage and migrations applied. Options: `user` (identity for every request, default anonymous), `config` (override declared values; `framework` takes `{ admins?, users? }`), `secrets` (values), `unavailable` (e.g. `["sql"]`: every operation of that capability fails with its `*.UNAVAILABLE` code), `stubLoginProvider` (see [current-user.md](current-user.md)).
- `await t.request("/api/notes", init?)` sends a request and returns a `Response`. Include `/api` in the path. For JSON bodies set `headers: { "content-type": "application/json" }` and `body: JSON.stringify(…)`. State-changing requests get the right `Origin` automatically.
- `t.as(mockUsers.user("alice"))` returns a test app that sends requests as Alice and shares storage with `t`; use two of them to test that one user cannot see another's data. `mockUsers.admin(id?)` and `mockUsers.anonymous` likewise. In-process, `t` and every test app made from it with `as` share one app: disposing any of them disposes all, and later requests through any of them throw. Dispose them only at the end of the test, as the examples do. On a deployed stage, disposing one only logs it out.
- `t.logs()` returns the log entries written so far ([log.md](log.md)).
- `await t.dispose()` after each test (an `afterEach` that disposes every test app the test opened, as in the examples).

What to test for each route: the success case with its body; anonymous (401 `AUTH.UNAUTHENTICATED`) and, for admin routes, a plain user (403 `AUTH.FORBIDDEN`); invalid input (400 `HTTP.INVALID_INPUT`); another user's data (not visible, usually 404 `HTTP.NOT_FOUND` or an empty list); and the error codes your route throws. Check error codes through `(await res.json()).error.code`, never through messages.

Type response bodies with the shared types: `const body: NoteList = await res.json();`.

## Time-dependent behaviour

Expiry and other time checks (share-link expiry, "edited within an hour") are tested in-process with Vitest's fake timers, because the framework's own time checks run in the test process too: `vi.useFakeTimers({ toFake: ["Date"] })`, then `vi.setSystemTime(…)` or `vi.advanceTimersByTime(…)`, and `vi.useRealTimers()` afterwards. Fake only `Date`, as the framework's own session-expiry tests do, so other timers keep running. Never test expiry in the smoke test, and never wait in real time.

## The smoke test

One file under `tests/smoke/` runs both ways:

- Under `verify`, it is an ordinary in-process test (`createTestApp`).
- Under `smoke`, `inject("prototypeFrameworkSmoke")` is `true` and it uses `connectTestStage()`, which connects to the stage `smoke` targets and logs in through the authentication mock.

Keep it short: the health route (`GET /api/__framework/health` answers 204), one open route, and one write-then-read per capability your app depends on. Use a fresh mock user per run (`` mockUsers.user(`smoke-${crypto.randomUUID()}`) ``) because stage data is kept between runs; do not assert totals that earlier runs would change. `logs()` is not available against a stage. Copy the template's file and change the routes ([examples/tests.md](../examples/tests.md)).

`t.request` sends only to the app: a URL on any other origin is refused before anything is sent, on both test apps, so the stage's session cookie never leaves the stage. An upload or download ticket a route returns is JSON `{ url, method?, headers?, expiresAt }` on every target. Locally and in-process its `url` is a path on the app, sent with `t.request(url, { method, headers, body })`; on a cloud it is an absolute signed storage URL, sent with plain `fetch(url, { method: ticket.method ?? "GET", headers: ticket.headers, body })` and no cookie. Choose with `/^\/(?![\/\\])/.test(ticket.url) ? t.request(…) : fetch(…)`, so `//host` and `/\host` URLs go to `fetch` too. Behind a proxy, `smoke` needs `NODE_USE_ENV_PROXY=1` for that `fetch`.

To run it on a cloud, deploy a test stage first, for example `npx prototype-framework deploy --target cloudflare --stage test-1`, then `npx prototype-framework smoke --target cloudflare --stage test-1`, and remove the stage afterwards ([deploying.md](deploying.md)). Test stages use `config/<target>/test.json` and the authentication mock and hold no real data.

## Failures

- A test that passes on SQLite but fails on Postgres (or the reverse) uses something the portable subset does not promise: check ordering (end with the `id` column), NULL handling and text comparison ([sql-and-migrations.md](sql-and-migrations.md)).
- A framework `error` entry printed to stderr during a test shows the real cause of a 500 response.
- A failing deployed smoke test prints the method, path, status, error code and request ID; find the request's entry with [troubleshooting.md](troubleshooting.md).

## Examples

- [examples/tests.md](../examples/tests.md): the template's app tests and smoke test, and the reference app's shared test helper.

## Stopping condition

Stop reading when each route has tests for success, access level, invalid input and other users' data, the smoke test covers each capability you use, and `npx prototype-framework verify` passes on both dialects. For deploying and running the smoke test on a cloud, read [deploying.md](deploying.md).
