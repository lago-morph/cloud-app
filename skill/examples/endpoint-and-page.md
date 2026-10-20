# Example: an endpoint and the page that calls it

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `src/app.ts`: the one `defineApp` call; route modules are registered in `routes`.
- `src/server/env.ts`: `config`, `secrets` and `type Env`; every route module takes `Hono<Env>`.
- `src/shared/types.ts`: response types declared once, used by the route (`const body: Greeting`) and by the page (`api<Greeting>`).
- `src/server/routes/hello.ts`: an open route (no guard).
- `src/client/main.ts` and `src/client/dom.ts`: browser code that calls the API only through `api`, shows text only through `textContent`, and shows the request ID of a failed call.
- `index.html`: loads the client script with an absolute URL (`/src/client/main.ts`), so deep links work.

## `apps/template/src/app.ts`

<!-- example-source: apps/template/src/app.ts -->
```ts
import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { adminRoutes } from "./server/routes/admin";
import { fileRoutes } from "./server/routes/files";
import { helloRoutes } from "./server/routes/hello";
import { noteRoutes } from "./server/routes/notes";
import { statusRoutes } from "./server/routes/status";
import { notes } from "./server/schema";

export const app = defineApp({
  name: "template",
  config,
  secrets,
  tables: { notes },
  routes: (api) => {
    helloRoutes(api);
    noteRoutes(api);
    statusRoutes(api);
    fileRoutes(api);
    adminRoutes(api);
  },
});

export default app;
```

## `apps/template/src/server/env.ts`

<!-- example-source: apps/template/src/server/env.ts -->
```ts
import { configString, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. */
export const secrets = ["apiKey"] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
```

## `apps/template/src/shared/types.ts`

<!-- example-source: apps/template/src/shared/types.ts -->
```ts
/** Response and request shapes shared by the server routes and the browser pages. */

export interface Greeting {
  readonly greeting: string;
}

export interface Note {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface NoteList {
  readonly notes: readonly Note[];
}

export interface Status {
  readonly status: string | null;
}

export interface StoredFile {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FileList {
  readonly files: readonly StoredFile[];
}

export interface SecretCheck {
  readonly configured: boolean;
}

```

## `apps/template/src/server/routes/hello.ts`

<!-- example-source: apps/template/src/server/routes/hello.ts -->
```ts
import type { Hono } from "hono";
import type { Greeting } from "../../shared/types";
import type { Env } from "../env";

/** Configuration: anyone may read the greeting configured for this stage. */
export function helloRoutes(api: Hono<Env>): void {
  api.get("/hello", (c) => {
    const body: Greeting = { greeting: c.var.config.get("greeting") };
    return c.json(body);
  });
}
```

## `apps/template/src/client/main.ts`

<!-- example-source: apps/template/src/client/main.ts -->
```ts
import { api, getCurrentUser } from "@lago-morph/prototype-framework/client";
import type { Greeting } from "../shared/types";
import { describeError, el } from "./dom";
import { accountPage } from "./pages/account";
import { adminPage } from "./pages/admin";
import { filesPage } from "./pages/files";
import { notesPage } from "./pages/notes";
import { statusPage } from "./pages/status";

async function start(root: HTMLElement): Promise<void> {
  const [{ greeting }, user] = await Promise.all([api<Greeting>("/hello"), getCurrentUser()]);
  root.replaceChildren(el("h1", greeting), accountPage(user));
  if (user.level === "anonymous") return;
  root.append(notesPage(), statusPage(), filesPage());
  if (user.level === "admin") root.append(adminPage());
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
```

## `apps/template/src/client/dom.ts`

<!-- example-source: apps/template/src/client/dom.ts -->
```ts
import { ApiError } from "@lago-morph/prototype-framework/client";

/** Creates an element with text content (never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** A titled section of the page. */
export function section(title: string): HTMLElement {
  const node = el("section");
  node.append(el("h2", title));
  return node;
}

/** A readable message for a failed call, including the request ID to look up in the log. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId === null ? `${error.code}: ${error.message}` : `${error.code}: ${error.message} (request ${error.requestId})`;
  }
  return error instanceof Error ? error.message : String(error);
}
```

## `apps/template/index.html`

<!-- example-source: apps/template/index.html -->
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>template</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>
```
