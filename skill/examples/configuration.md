# Example: configuration keys and per-stage values

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- Template `env.ts` and `routes/hello.ts`: one string key with a default, read with `c.var.config.get`.
- The template's values files for local development and for Cloudflare test stages.
- From the reference app: every key type (`configString`, `configInteger`, `configBoolean`, `configStringList`) and a local values file that sets a value.

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

## `apps/template/config/local.json`

<!-- example-source: apps/template/config/local.json -->
```json
{
  "values": {},
  "framework": {}
}
```

## `apps/template/config/cloudflare/test.json`

<!-- example-source: apps/template/config/cloudflare/test.json -->
```json
{
  "values": {},
  "framework": {}
}
```

## `apps/reference/src/server/env.ts`

<!-- example-source: apps/reference/src/server/env.ts -->
```ts
import { configBoolean, configInteger, configString, configStringList, type AppDefinition, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
  pageSize: configInteger({ default: 20 }),
  featureOn: configBoolean({ default: false }),
  tags: configStringList({ default: [] }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. `apiKey` is the compliance test secret. */
export const secrets = ["apiKey"] as const;

export type Secret = (typeof secrets)[number];

/** The Hono environment every route module's handlers see. */
export type Env = AppEnv<typeof config, Secret>;

/** The `/api` router each route module registers on (the `Hono<Env>` that `routes` receives). */
export type Api = Parameters<AppDefinition<typeof config, Secret>["routes"]>[0];
```

## `apps/reference/config/local.json`

<!-- example-source: apps/reference/config/local.json -->
```json
{
  "values": { "greeting": "Hello from local" },
  "framework": {}
}
```
