# Example: one value per user in KV

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `routes/status.ts`: a per-user key (`status:<user id>`), `kv.get` (null when absent) and `kv.put`.
- `pages/status.ts`: the browser page for it.

## `apps/template/src/server/routes/status.ts`

<!-- example-source: apps/template/src/server/routes/status.ts -->
```ts
import { jsonBody, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Status } from "../../shared/types";
import type { Env } from "../env";

const newStatus = z.object({ status: z.string().max(100) });

/** KV: each logged-in user has one status line. */
export function statusRoutes(api: Hono<Env>): void {
  api.get("/status", requireUser(), async (c) => {
    const body: Status = { status: await c.var.kv.get(`status:${c.var.user.id}`) };
    return c.json(body);
  });

  api.put("/status", requireUser(), jsonBody(newStatus), async (c) => {
    const { status } = c.req.valid("json");
    await c.var.kv.put(`status:${c.var.user.id}`, status);
    const body: Status = { status };
    return c.json(body);
  });
}
```

## `apps/template/src/client/pages/status.ts`

<!-- example-source: apps/template/src/client/pages/status.ts -->
```ts
import { api } from "@lago-morph/prototype-framework/client";
import type { Status } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Read and change your status line (KV). */
export function statusPage(): HTMLElement {
  const page = section("Status");
  const input = el("input");
  input.placeholder = "Your status";
  const save = el("button", "Save");
  const message = el("p");
  page.append(input, save, message);

  save.addEventListener("click", () => {
    message.textContent = "";
    void api<Status>("/status", { method: "PUT", body: { status: input.value } })
      .then(() => {
        message.textContent = "Saved.";
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void api<Status>("/status")
    .then(({ status }) => {
      input.value = status ?? "";
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
```
