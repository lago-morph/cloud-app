# Example: login, access levels and an admin page

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `pages/account.ts`: `login()`, `logout()` and the current user's level from `getCurrentUser()` (called in `main.ts`, see endpoint-and-page.md).
- `routes/admin.ts`: a route guarded with `requireAdmin()`; `pages/admin.ts`: the page shown only to admins (`main.ts` adds it when `user.level === "admin"`).
- From the reference app, `routes/levels.ts`: `requireUser()`, `requireAdmin()`, and `requireCurrentUser(c)` for a handler without a guard on the route.

## `apps/template/src/client/pages/account.ts`

<!-- example-source: apps/template/src/client/pages/account.ts -->
```ts
import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { el, section } from "../dom";

/** Who is logged in, with login and logout buttons. */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."));
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    page.append(button);
    return page;
  }
  page.append(el("p", `Logged in as ${user.displayName ?? user.id} (${user.level}).`));
  const button = el("button", "Log out");
  button.addEventListener("click", () => {
    void logout().then(() => window.location.reload());
  });
  page.append(button);
  return page;
}
```

## `apps/template/src/server/routes/admin.ts`

<!-- example-source: apps/template/src/server/routes/admin.ts -->
```ts
import { requireAdmin } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { SecretCheck } from "../../shared/types";
import type { Env } from "../env";

/** Secrets and access levels: only an admin may check that the secret is set. Never return its value. */
export function adminRoutes(api: Hono<Env>): void {
  api.get("/admin/secret", requireAdmin(), async (c) => {
    const apiKey = await c.var.secrets.get("apiKey");
    const body: SecretCheck = { configured: apiKey.length > 0 };
    return c.json(body);
  });
}
```

## `apps/template/src/client/pages/admin.ts`

<!-- example-source: apps/template/src/client/pages/admin.ts -->
```ts
import { api } from "@lago-morph/prototype-framework/client";
import type { SecretCheck } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Admins only: check that the app's secret is set (never shows its value). */
export function adminPage(): HTMLElement {
  const page = section("Admin");
  const check = el("button", "Check secret");
  const message = el("p");
  page.append(check, message);
  check.addEventListener("click", () => {
    void api<SecretCheck>("/admin/secret")
      .then(({ configured }) => {
        message.textContent = configured ? "The secret apiKey is set." : "The secret apiKey is empty.";
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });
  return page;
}
```

## `apps/reference/src/server/routes/levels.ts`

<!-- example-source: apps/reference/src/server/routes/levels.ts -->
```ts
import { requireAdmin, requireCurrentUser, requireUser } from "@lago-morph/prototype-framework";
import type { Api } from "../env";

/** Protected routes per access level (AUTH-AC-004, E2E-005). */
export function levelRoutes(api: Api): void {
  api.get("/levels/anyone", (c) => c.json({ level: c.var.user.level }));

  for (const method of ["get", "post"] as const) {
    api[method]("/levels/user", requireUser(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
    api[method]("/levels/admin", requireAdmin(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
  }

  api.get("/levels/current", (c) => {
    const user = requireCurrentUser(c);
    return c.json({ level: user.level, id: user.id });
  });
}
```
