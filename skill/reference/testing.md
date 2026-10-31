# Testing

Read this when you write or fix app tests, write the smoke test or the e2e tests, test time-dependent behaviour, or need to know what `verify`, the e2e projects and `smoke` run.

## How you work on tests

These hold for every change, without asking the user technical questions. Explain results to the user in plain words.

- **Red, green, refactor.** For app logic, write one failing test first, run it and see it fail for the expected reason, then write the code, then tidy up. Every fix starts with a test that reproduces the failure and fails.
- **State each change's test impact** and make the test changes in the same work: the unit, integration and e2e tests to add, change or remove, and any fuzz target ([testing/test-changes.md](testing/test-changes.md)).
- **Keep e2e current.** A flow is not done until its happy path, its expected errors and its edge cases are covered end to end. When a flow changes, and after a framework upgrade, update its e2e tests ([testing/e2e.md](testing/e2e.md)).
- **A failure is diagnosed before anything changes.** Any failure other than a test that is red on purpose gets an evidence-based root cause from a subagent that did not write the code, an independent review, and only then a red-green fix ([testing/failures.md](testing/failures.md)). "Flaky" or "timing" is not a cause without evidence.
- **Never skip, delete or weaken a test to get a pass.** Any change to a test that passed once (its expected results, its removal, a skip, a wider tolerance or timeout) is reviewed by an independent subagent first ([testing/test-changes.md](testing/test-changes.md)).
- **Orchestrate.** The main session briefs subagents, in parallel where they touch different files, and keeps its own context small, unless the user says otherwise. Roles that must be separate: the code's author never diagnoses or reviews its own failure.
- **CI is the user's.** Installing or upgrading the framework never creates or changes the app's CI. You may suggest a CI change to the user, who decides. Apps have no commit hooks: run the checks yourself.

## The layers

| Layer | What | Where | Runs with |
| --- | --- | --- | --- |
| Unit and integration | App logic and routes, in process, with real local storage on both SQL dialects | `tests/**/*.test.ts` | `npm run verify` |
| E2E, API | Each flow through the running app's HTTP API | `tests/e2e/api/*.spec.ts` | `npm run verify` (project `e2e-api`, no browser) |
| E2E, UI | What only a browser shows: page rendering, the login button, file transfer in the page, cookies; a few per flow | `tests/e2e/ui/*.spec.ts` | `npm run test:e2e:ui` (project `e2e-ui`, installs Chromium) |
| Fuzz | A route input at a trust boundary, from its zod schema, only where [testing/fuzzing.md](testing/fuzzing.md) says | `tests/**/*.test.ts` | `npm run verify` |
| Smoke | A short check on a deployed `test-` stage | `tests/smoke/**/*.test.ts` | `npm run smoke` |

- `npm run verify` runs every `tests/**/*.test.ts` file (PAR-116) with Vitest twice, once on SQLite and once on Postgres, each in its own process, with 60 s test and hook timeouts, then the `e2e-api` project against a local `dev` server it starts. It fails if any test fails or if no test passed. Tests need no network.
- `npm run smoke -- --target <t> --stage <s>` runs only `tests/smoke/**/*.test.ts`, against the running `dev` server (`--target local`) or against a deployed **test** stage. It refuses to run when tracked files differ from the last commit, writes an evidence record to `validation/<target>/<runId>.json` at the top of the git repository that holds the app (commit it with the run's commit), and prints the stage's log location for the day.
- An app is not done on a cloud until its smoke test has passed on a deployed stage there.

## In-process tests

Import from `@lago-morph/prototype-framework/testing` (only in `tests/**`):

- `await createTestApp(app, options?)` starts your app in the test process with fresh, empty storage and migrations applied. Options: `user` (identity for every request, default anonymous), `config` (override declared values), `secrets` (values), `unavailable` (e.g. `["sql"]`: every operation of that capability fails with its `*.UNAVAILABLE` code), `authAppLoginProvider` (see [current-user.md](current-user.md)). `t.setUnavailable([...])` replaces the unavailable set from the next request on (`[]` makes everything available again; stored data is kept), so a test can store data, make `files` unavailable, run the request that cleans up, and check its status and the `warn` entry in `t.logs()`. Not available against a deployed stage.
- `await t.request("/api/notes", init?)` sends a request and returns a `Response`. Include `/api` in the path. For JSON bodies set `headers: { "content-type": "application/json" }` and `body: JSON.stringify(…)`. State-changing requests get the right `Origin` automatically.
- `t.as(mockUsers.user("alice"))` returns a test app that sends requests as Alice and shares storage with `t`; use two of them to test that one user cannot see another's data. `mockUsers.admin(id?)` and `mockUsers.anonymous` likewise. `t` and every test app made from it share one app: dispose them only at the end of the test.
- `t.logs()` returns the log entries written so far ([log.md](log.md)). `await t.dispose()` after each test.

What to test for each route: the success case with its body; anonymous (401 `AUTH.UNAUTHENTICATED`) and, for admin routes, a plain user (403 `AUTH.FORBIDDEN`); invalid input (400 `HTTP.INVALID_INPUT`); another user's data (not visible, usually 404 `HTTP.NOT_FOUND` or an empty list); and the error codes your route throws. Check error codes through `(await res.json()).error.code`, never through messages. Type response bodies with the shared types: `const body: NoteList = await res.json();`.

## Time-dependent behaviour

Expiry and other time checks are tested in-process with Vitest's fake timers: `vi.useFakeTimers({ toFake: ["Date"] })`, then `vi.setSystemTime(…)` or `vi.advanceTimersByTime(…)`, and `vi.useRealTimers()` afterwards. Fake only `Date`. Never test expiry in the smoke or e2e tests, and never wait in real time.

## The smoke test

One file under `tests/smoke/` runs both ways: under `verify` it is an ordinary in-process test (`createTestApp`); under `smoke`, `inject("prototypeFrameworkSmoke")` is `true` and it uses `connectTestStage()`, which connects to the stage `smoke` targets and logs in through the authentication mock.

Keep it short: the health route (`GET /api/__framework/health` answers 204), one open route, and one write-then-read per capability your app depends on. Use a fresh mock user per run (`` mockUsers.user(`smoke-${crypto.randomUUID()}`) ``) because stage data is kept between runs. `logs()` is not available against a stage. Copy the template's file and change the routes ([examples/tests.md](../examples/tests.md)).

`t.request` sends only to the app; a URL on any other origin is refused. A ticket's `url` is a path on the app locally (send it with `t.request`) and an absolute signed storage URL on a cloud (send it with plain `fetch`, no cookie): choose with `/^\/(?![\/\\])/.test(ticket.url)`. Behind a proxy, `smoke` needs `NODE_USE_ENV_PROXY=1` for that `fetch`. To run it on a cloud, deploy a test stage, run `npm run smoke -- --target cloudflare --stage test-1`, then remove the stage ([deploying.md](deploying.md)).

## Failures

- A test that passes on SQLite but fails on Postgres (or the reverse) uses something the portable subset does not promise: check ordering (end with the `id` column), NULL handling and text comparison ([sql-and-migrations.md](sql-and-migrations.md)).
- A framework `error` entry printed to stderr during a test shows the real cause of a 500 response.
- A failing deployed smoke test prints the method, path, status, error code and request ID; find the request's entry with [troubleshooting.md](troubleshooting.md). Then follow [testing/failures.md](testing/failures.md).

## Examples

- [examples/tests.md](../examples/tests.md): the template's app tests and smoke test, and the reference app's shared test helper.

## Stopping condition

Stop reading when each route has tests for success, access level, invalid input and other users' data, each flow has its e2e tests, the smoke test covers each capability you use, and `npm run verify` passes on both dialects. For a failure, an e2e test, a test change or fuzzing, read the one file under `testing/` linked above.
