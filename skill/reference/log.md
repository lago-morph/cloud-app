# Log

Read this when your code should record what happened (an action, a refused request, a background problem), when you need to know what the framework logs by itself, or when you test log entries. To *find* entries for a failing request, read [troubleshooting.md](troubleshooting.md).

## Writing entries

`c.var.log.write(component, severity, message)`:

- `component`: a short name for the part of your app (`"notes"`, `"billing"`). The framework uses its component codes (`CORE`, `SQL`, `KV`, `FILES`, `SEC`, `AUTH`, …) for its own entries.
- `severity`: `"debug"`, `"info"`, `"warn"` or `"error"`. There is no filtering: every entry is stored.
- `message`: plain text. Include IDs that help later (`note ${noteId} created`).

`write` never throws, never fails the request, and does not await: call it without `await`. The framework adds the time, app, stage, target and the request ID to each entry.

Never log secret values, session cookies, tokens, request bodies, email addresses, ticket URLs, or other personal data. Log IDs instead.

## What the framework logs by itself

- Every response with status 500 or above: one `error` entry with the method, the route pattern (`/api/notes/:id`, never the query string), the code, and the error's name, message and stack. A plain `Error` thrown by your code becomes 500 `CORE.INTERNAL` with its details here, not in the response.
- Every `*.UNAVAILABLE` failure (`SQL`, `KV`, `FILES`, `SEC`), once, under that component.
- Failed logins: one `warn` entry, component `AUTH`, `login failed: <reason>`.

So do not log an error you are about to rethrow; the framework already does. Log what only your code knows (a refused action and why, a decision taken).

## Request IDs

Every request has an ID (`c.var.requestId`), returned in every error response (`error.requestId`) and written with every entry of that request. In the browser, `ApiError.requestId` holds it; show it in error messages (the template's `describeError` does), so the owner can look the entry up.

## Where entries go

| Where | Location |
| --- | --- |
| `createTestApp` | In memory: `t.logs()` returns the entries so far; framework `error` entries are also printed to stderr |
| Local `dev` | `.logs/<yyyy-mm-dd>.log` in the app directory (UTC day), one JSON entry per line; git-ignored |
| A cloud stage | The account's shared log bucket (`prototype-logs` on Cloudflare), one object per entry, under `<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<id>.json` (UTC; `<id>` is the request ID, or a random value outside a request) |

Entries are never deleted by the framework, and removing a stage keeps its entries. The commands to list a day's entries and find one by request ID are in [troubleshooting.md](troubleshooting.md). `smoke` prints the day's log location for the stage it ran against.

## Testing

`t.logs()` returns entries with `component`, `severity`, `message` and `requestId`; filter by component and severity rather than matching whole messages:

`expect(t.logs().filter((e) => e.component === "notes" && e.severity === "info")).toHaveLength(3);`

On a connected test stage (`connectTestStage`) `logs()` throws: entries are in the stage's bucket. Keep log assertions in in-process tests, not in the smoke test.

## Examples

- [examples/notes-sql.md](../examples/notes-sql.md): `c.var.log.write("notes", "info", …)` after an insert.
- [examples/tests.md](../examples/tests.md): asserting entries with `logs()`.

## Stopping condition

Stop reading when your code logs what only it knows, without secrets or personal data, does not duplicate the framework's error entries, your error displays show the request ID, and `npx prototype-framework verify` passes.
