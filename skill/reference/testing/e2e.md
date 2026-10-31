# End-to-end tests

Read this when you add or change a flow (something a person or an operator does from start to finish), after a framework upgrade, or when an e2e test fails or must change.

## What e2e covers

Every user-facing flow, on its **happy path**, its **expected errors** and its **edge cases**. A flow is not done until all three are covered end to end. When a flow changes, change its e2e tests in the same work; after `npm run upgrade`, run them and fix what the release changed. A change to an e2e test that passed before is reviewed like any other ([test-changes.md](test-changes.md)).

## API first, a few UI tests

The template ships two Playwright projects (`playwright.config.ts`), against a local `dev` server that Playwright starts and stops:

- **`e2e-api`** (`tests/e2e/api/*.spec.ts`): most e2e tests. They drive the app's HTTP API with Playwright's `request` fixture, which needs no browser. `npm run verify` runs this project after the unit tests; `npm run test:e2e:api` runs it alone.
- **`e2e-ui`** (`tests/e2e/ui/*.spec.ts`): only what a browser alone shows: a page renders the data, the login button signs in, a file uploads or downloads from the page, a cookie is set. At most a few per flow; every other case of the flow is an API test. `npm run test:e2e:ui` runs it; only this project needs Chromium (`npm exec --no -- playwright install chromium` once, when the user agrees). If Chromium cannot be installed, report the UI run as `not-run` with the reason (hard rule 8) and do not declare the page done.

The config hides the server's own log. If the server does not start (Playwright times out waiting for it), run `npm run dev` to see why.

Write a spec from the flow, not from the code:

- Requests go to paths (`/api/notes`); the config sets the base URL and the `Origin` header the framework's forgery check needs.
- Sign in as a test identity with the authentication mock, which every local server has: `` await request.post("/api/auth/mock-login", { data: { level: "user", id: `e2e-${crypto.randomUUID()}` } }) ``. Use a fresh ID per test: local data is kept between runs, so never assert totals.
- Check status codes and `(await res.json()).error.code`, never messages.
- In UI specs, find elements by role and visible text (`page.getByRole("button", { name: "Log in" })`).
- Never wait in real time, and never test expiry here: use fake timers in-process ([../testing.md](../testing.md)).
- `playwright.config.ts` is part of the gate: a change to it that could run fewer tests or pass more easily (projects, `testIgnore`, `retries`, timeouts) is reviewed like a change to a once-green test ([test-changes.md](test-changes.md)).

## Edge cases

Before writing a flow's tests, list its edge cases in the spec's header comment, and cover each that applies; for each prompt that does not apply, say why in a few words:

- **Boundaries:** empty, one, exactly at a documented limit, one past it. Locally only; on a cloud, keep data small.
- **Text:** Unicode, case and normalisation; `..`, `/` and percent-encoding in names; one name a prefix of another.
- **Order and time:** sort order and paging; expiry at and just past the limit (fake `Date`, in-process).
- **Access:** anonymous, user, admin, and another user's data.
- **Repetition:** repeated and concurrent requests; reuse of one-time links or tickets.
- **Failures:** an unavailable capability (in-process with `setUnavailable`); local versus cloud differences.

## Examples

- [examples/tests.md](../../examples/tests.md): the template's tests, including its e2e specs.

## Stopping condition

Stop reading when every flow you added or changed has API tests for its happy path, expected errors and listed edge cases, at most a few UI tests for what only a browser shows, and `npm run verify` (and `npm run test:e2e:ui` if you changed a page) passes.
