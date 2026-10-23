# Current user

Read this when a route or page depends on who is logged in, you add an admin page, you restrict the app to known people, or you test logins and access levels.

## What the app sees

`c.var.user` is a `CurrentUser`, and nothing else about the person reaches app code (no email, no provider, no tokens):

- `{ level: "anonymous" }`, or
- `{ level: "user" | "admin", id, displayName }`. `id` is a stable, opaque user ID (`u_…`), the same on every stage and cloud for the same login account. `displayName` may be `null`.

Store `c.var.user.id` in your rows to record ownership (an `ownerId: text()` column), and filter by it on every read and write of private data. Never trust a user ID sent by the browser.

## Levels

- **Without a users list**, level `user` means *any account the login provider accepts*, not a person this app trusts. Anyone with a Google account can log in as `user`.
- **To admit only known people**, list their user IDs in `framework.users` in the stage's values file (`config/<target>/<stage>.json`). Then a login whose ID is on neither `framework.users` nor `framework.admins` is anonymous: `c.var.user` is `{ level: "anonymous" }` and `requireUser()` refuses it with 401 `AUTH.UNAUTHENTICATED`.
- **Admins** are the user IDs in `framework.admins`. They need not be repeated in `framework.users`.
- Both lists are read on every request; a change takes effect at the next deploy, without logging anyone out.

How the owner finds an ID and adds it to a list (copy-and-paste steps): [owner-tasks.md](owner-tasks.md). In short: the person logs in on a production stage and opens `/api/auth/me`; they copy `id`, or `unlistedId` if the users list currently makes them anonymous; the owner adds it to `framework.admins` or `framework.users` in `config/<target>/<stage>.json`, commits, and deploys again.

## Protecting routes

Guard each route on the route itself: `requireUser()` (anonymous → 401) or `requireAdmin()` (anonymous → 401, user → 403 `AUTH.FORBIDDEN`). The handler then sees a `LoggedInUser`. With a guard applied by `api.use(…)`, call `requireCurrentUser(c)` inside the handler. Details: [http-and-validation.md](http-and-validation.md).

A user who may see a record but not change it gets `AUTH.FORBIDDEN`; a record the user may not see at all is `HTTP.NOT_FOUND`, so its existence is not revealed.

## Admin pages

1. Add the server routes with `requireAdmin()`.
2. In the browser, call `getCurrentUser()` and show the admin page only when `user.level === "admin"`. Hiding the page is only convenience: the server guard is the protection.

## Browser helpers

From `@lago-morph/prototype-framework/client`: `getCurrentUser()` (the user as the server sees it), `login(returnTo?)` (navigates to the login; returns to `returnTo`, a same-origin path, default the current page), `logout()` (ends the session, then resolves; reload or re-render afterwards).

A failed login returns to `/?authError=login_failed&requestId=<id>`. Show a message with the request ID; the reason is in the log ([troubleshooting.md](troubleshooting.md)).

Sessions last 7 days (PAR-250). There is no server-side session list: logging out clears this browser's cookie only.

## Which login runs where

| Where | Login |
| --- | --- |
| Local `dev` | The authentication mock: the login button logs in as the default mock user (`mock-user`) |
| Test stages (`test-*`) | The authentication mock (`mockUsers`, `connectTestStage`) |
| Production stages | Google (set up by the owner, [owner-tasks.md](owner-tasks.md)) |

The mock ignores `framework.users` and `framework.admins`: the test chooses the level directly.

## Testing

- Choose the identity per test app: `createTestApp(app, { user: mockUsers.user("alice") })`, or `t.as(mockUsers.admin())` for further requests with another identity (sharing the same storage). `mockUsers.user(id?)` and `mockUsers.admin(id?)` use the ID as given.
- To test **list membership** (users list, admin list), use the stub login provider, because the mock ignores the lists: `createTestApp(app, { stubLoginProvider: true, config: { framework: { users: [...] } } })`, then `await t.loginWithStub("alice")`. The stub runs the real login, ID derivation and list code. Read the derived ID from `/api/auth/me` (`id`, or `unlistedId` when the list makes the login anonymous), then build a second test app whose `framework.users` contains it. `as()` is not available on a stub test app.
- Assert 401 `AUTH.UNAUTHENTICATED` for anonymous and 403 `AUTH.FORBIDDEN` for a user on admin routes. See [testing.md](testing.md).

## Examples

- [examples/admin-and-current-user.md](../examples/admin-and-current-user.md): the account page with login and logout, an admin route and page, and the three guards.
- [examples/tests.md](../examples/tests.md): tests with `mockUsers`, `as()` and the `user` option.

## Stopping condition

Stop reading when every private route has a guard and filters by `c.var.user.id`, admin routes use `requireAdmin()`, the stage's values file has the lists the owner wants, your tests cover anonymous, user and admin callers, and `npx prototype-framework verify` passes.
