# Current user

Read this when a route or page depends on who is logged in, you add an admin page, someone must become an admin, or you test logins and access levels.

## What the app sees

`c.var.user` is a `CurrentUser`, and nothing else about the person reaches app code (no email, no provider, no tokens):

- `{ level: "anonymous" }`, or
- `{ level: "user" | "admin", id, displayName }`. `id` is a stable, opaque user ID (`u_…`), the same on every stage and cloud for the same login account. `displayName` may be `null`.

Store `c.var.user.id` in your rows to record ownership (an `ownerId: text()` column), and filter by it on every read and write of private data. Never trust a user ID sent by the browser.

## Levels

- **Only members of the owner's Cloudflare account can sign in.** Level `user` means *any member of that account*, not a person this app trusts; an app that needs finer trust keeps its own records (for example a table of allowed user IDs).
- **Admins** are members with an administrator role in the account. There is no "user" role, and no list of allowed people.
- The level is confirmed with the account's auth app at sign-in and again every 5 minutes (PAR-425), so a role change shows at the next sign-in or within that time, with no deploy. If the role cannot be confirmed, the person is signed out: a protected route then answers 401.
- Configuration holds no admins or users: `framework.admins` and `framework.users` are rejected by the build.

How someone becomes an admin: [owner-tasks.md](owner-tasks.md) §7. In short: the owner gives them an administrator role in the Cloudflare dashboard (Manage Account → Members); another role takes it away. `/api/auth/me` shows a person's level and user ID.

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
| Local `dev` | The authentication mock: the login button signs in a test user. |
| Test stages (`test-*`) | The authentication mock only, for tests (`mockUsers`, `connectTestStage`) |
| Production stages | Sign-in with Cloudflare through the account's auth app ([owner-tasks.md](owner-tasks.md) §6) |

The mock chooses the level directly: it reads no roles.

## Testing

- Choose the identity per test app: `createTestApp(app, { user: mockUsers.user("alice") })`, or `t.as(mockUsers.admin())` for further requests with another identity (sharing the same storage). `mockUsers.user(id?)` and `mockUsers.admin(id?)` use the ID as given.
- To test the **real sign-in and role changes**, use `createTestApp(app, { authAppLoginProvider: true })`: `await t.loginWithAuthApp({ sub: "cf-1", email: "a@example.com", role: "user" })` signs in through a fake auth app. `t.authApp.setRole("cf-1", "admin")` changes the role the next refresh reads; move `t.clock.advance(…)` past PAR-425 to see it, with no new login. `t.authApp.setUnavailable(true)` makes the refresh fail, which signs the person out. `as()` is not available on such a test app.
- Assert 401 `AUTH.UNAUTHENTICATED` for anonymous and 403 `AUTH.FORBIDDEN` for a user on admin routes. See [testing.md](testing.md).

## Examples

- [examples/admin-and-current-user.md](../examples/admin-and-current-user.md): the account page with login and logout, an admin route and page, and the three guards.
- [examples/tests.md](../examples/tests.md): tests with `mockUsers`, `as()` and the `user` option.

## Stopping condition

Stop reading when every private route has a guard and filters by `c.var.user.id`, admin routes use `requireAdmin()`, your tests cover anonymous, user and admin callers, and `npm run verify` passes.
