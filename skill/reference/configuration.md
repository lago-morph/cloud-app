# Configuration

Read this when your app needs a non-secret setting that can differ per stage (a title, a page size, a feature switch, a list of allowed values), when you add a stage's values file, or when a `verify` diagnostic names this file (`no-env-access`).

For secret values read [secrets.md](secrets.md); for admins (a role, not configuration) read [current-user.md](current-user.md).

## Declaring keys

Declare every key in `config` in `src/server/env.ts`:

| Helper | Value type |
| --- | --- |
| `configString({ default? })` | `string` |
| `configInteger({ default? })` | `number` (whole) |
| `configBoolean({ default? })` | `boolean` |
| `configStringList({ default? })` | `readonly string[]` |

Key names are lowerCamelCase. A default must have the key's type. Read a value with `c.var.config.get("greeting")`; the result is typed from the declaration, and an undeclared key fails with `CFG.UNDECLARED_KEY` (and does not type-check). Values are fixed when a stage is deployed: they cannot change at run time, and a change takes effect at the next deploy.

## Values files

Values are committed JSON files, one per target and stage:

| Stage | File |
| --- | --- |
| Local development (`dev`) | `config/local.json` |
| Every test stage of a cloud (`test-*`) | `config/<target>/test.json`, for example `config/cloudflare/test.json` |
| A production stage (any other name) | `config/<target>/<stage>.json`, for example `config/cloudflare/prod.json` |

Each file has exactly two members:

```json
{
  "values": { "greeting": "Hello from production" },
  "framework": {}
}
```

- `values` holds values for your declared keys; keys with a default may be left out. A key you did not declare, a missing value for a key without a default, or a wrong type fails the build with `CORE.MISCONFIGURED`, naming the file and every bad field.
- `framework` is empty (`{}`): the framework sends no email, and who may sign in comes from the owner's Cloudflare account ([current-user.md](current-user.md)). `framework.admins` and `framework.users` fail the build.
- A production stage reads only its own file and never falls back to `test.json`, so create `config/<target>/<stage>.json` before its first deploy.
- Never put a secret in these files: there is no place for one.

## What not to read

App code reads configuration only through `c.var.config`. Never read `process.env`, `import.meta.env`, Hono's `c.env` or `c.executionCtx`, or platform bindings, and never replace the framework's error or not-found handler (`app.onError`, `app.notFound`). The app must not know which cloud it runs on: `c.var.deployment` gives only `{ app, stage }`.

## In tests

`createTestApp(app, { config: { greeting: "Hi there" } })` overrides declared values; an undeclared key makes it throw. The reserved key `framework` takes no `admins` or `users`: they make it throw, as the build does. Test role changes with the fake auth app ([current-user.md](current-user.md)).

## Check rules that send you here

- `prototype-framework/no-env-access`: the code read `process.env`, `import.meta.env`, `c.env`, `c.executionCtx`, or called `onError`/`notFound`. Declare a config key (or a secret) and read it through `c.var.config` (or `c.var.secrets`); for a capability use `c.var.sql`, `kv`, `files` or `log`; let the framework handle errors and unknown routes, and throw `FrameworkError` from your routes ([http-and-validation.md](http-and-validation.md)).

## Examples

- [examples/configuration.md](../examples/configuration.md): a string key read by a route, the template's values files, and every key type from the reference app.

## Stopping condition

Stop reading when each setting is declared with a type, read through `c.var.config.get`, given values in each stage's committed file (or a default), and `npm run verify` passes.
