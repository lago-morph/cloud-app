# Current user

Read this when a route or page depends on who is logged in, you add an admin page, someone must become an admin, or you test logins and access levels.

## What the app sees

`c.var.user` is a `CurrentUser`, and nothing else about the person reaches app code (no email, no provider, no tokens):

- `{ level: "anonymous" }`, or
- `{ level: "user" | "admin", id, displayName }`. `id` is a stable, opaque user ID (`u_…`), the same on every stage and cloud for the same login account. `displayName` may be `null`.

Store `c.var.user.id` in your rows to record ownership (an `ownerId: text()` column), and filter by it on every read and write of private data. Never trust a user ID sent by the browser.

## Levels

- **Anyone who signs up and verifies their email address is a user.** Level `user` means *any verified account*, not a person this app trusts; there is no list of allowed people. An unverified account cannot sign in.
- **Admins** are users holding the `admin` role, stored with the account in the stage's own database. There is no "user" role: a new account has no roles.
- The level is read from the account on every request with a session, so a grant or revoke applies from the person's next request, with no deploy and no new login.
- Configuration holds no admins or users: `framework.admins` and `framework.users` are rejected by the build.

How someone becomes an admin (copy-and-paste steps): [owner-tasks.md](owner-tasks.md) §7. In short: they sign up and verify on the stage, then the owner (or an agent) runs `npm run admins -- grant <address> --target <t> --stage <s>`, adding `--confirm-production <s>` on a production stage; `admins revoke` takes it away and `admins list` shows the admins.

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
| Local `dev` | Email and password: the login button opens the sign-in page; mail is written to `.mail/` (`npm run mail -- last --to <address>`). Tests may also use the authentication mock. |
| Test stages (`test-*`) | Email and password, plus the authentication mock for tests (`mockUsers`, `connectTestStage`) |
| Production stages | Email and password only, with real mail ([owner-tasks.md](owner-tasks.md) §6) |

The mock chooses the level directly: it reads no roles.

## Testing

- Choose the identity per test app: `createTestApp(app, { user: mockUsers.user("alice") })`, or `t.as(mockUsers.admin())` for further requests with another identity (sharing the same storage). `mockUsers.user(id?)` and `mockUsers.admin(id?)` use the ID as given.
- To test the **real login and roles**, use `createTestApp(app, { passwordLoginProvider: true })`: sign up, read the mail with `t.mail.lastTo(address)`, verify and sign in through the app's requests. `t.grantRole(userId, "admin")` and `t.revokeRole(userId, "admin")` change that account's roles as `admins` does (the ID as `/api/auth/me` shows it); the next request sees the new level. `as()` is not available on such a test app.
- Assert 401 `AUTH.UNAUTHENTICATED` for anonymous and 403 `AUTH.FORBIDDEN` for a user on admin routes. See [testing.md](testing.md).

## Examples

- [examples/admin-and-current-user.md](../examples/admin-and-current-user.md): the account page with login and logout, an admin route and page, and the three guards.
- [examples/tests.md](../examples/tests.md): tests with `mockUsers`, `as()` and the `user` option.

## Stopping condition

Stop reading when every private route has a guard and filters by `c.var.user.id`, admin routes use `requireAdmin()`, the stage's values file has the lists the owner wants, your tests cover anonymous, user and admin callers, and `npm run verify` passes.
