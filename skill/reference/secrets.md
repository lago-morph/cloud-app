# Secrets

Read this when your app needs an API key, a signing key, or any other value that must never be committed, logged or shown; or when you sign and verify data (for example share links).

## Declaring and reading

1. Add the logical name to `secrets` in `src/server/env.ts`: `export const secrets = ["apiKey"] as const;`. Names are lowerCamelCase and must not start with `framework` (reserved).
2. Read it in a handler: `const apiKey = await c.var.secrets.get("apiKey");`. A name you did not declare fails with `SEC.UNDECLARED` (and does not type-check); a declared secret with no value in this stage fails with 500 `SEC.MISSING`; an unreachable store with 503 `SEC.UNAVAILABLE`.
3. Never return, log or put a secret value in an error message. The framework replaces known secret values with `[redacted]` in error responses and log entries, but that is a safety net, not a design.

Values are not cached across requests (a value is reused only within one request); do not keep one in a module-level variable either.

## Setting values

A secret's value is read from standard input, never from a command-line argument or a file in the repository.

- Local development: `printf '%s' 'the-value' | npx prototype-framework secrets set apiKey --target local --stage local`. It writes the git-ignored `.dev.vars` file and prints the name and location, never the value. `dev` also generates the framework's own local keys there on first start.
- A cloud stage: `npx prototype-framework secrets set apiKey --target cloudflare --stage <stage>`, then type or paste the value and end input. On Cloudflare the stage's Worker must exist, so on a stage's first deploy `deploy` stops, names each unset secret, and asks you to set them and deploy again.
- The owner's copy-and-paste steps for this are in [owner-tasks.md](owner-tasks.md).

A deploy's health check fails when any declared secret has no value, so a secret the app declares must be set on every stage it is deployed to.

## In tests

`createTestApp(app, { secrets: { apiKey: "test-value" } })` gives the test its values; without it a declared secret is missing (`SEC.MISSING`). `unavailable: ["secrets"]` makes reads fail with `SEC.UNAVAILABLE`. Assert that responses never contain the test value (see the admin test in [examples/tests.md](../examples/tests.md)).

## Signing and verifying with a secret (HMAC)

For a signed token such as a share link, copy the template's `src/server/signing.ts` and its tests from [examples/secrets.md](../examples/secrets.md). `signToken(key, subject, expiresAt)` returns `<subject>.<expiresAt>.<signature>`; `verifyToken(key, token)` returns the subject, or `null` for a tampered, wrongly keyed, malformed or expired token. It uses only `crypto.subtle` (HMAC-SHA-256, constant-time `verify`) and base64url through `btoa`/`atob`; never use `Buffer` or `node:crypto` (they fail type checking and `allowed-imports`).

1. Declare a secret for the key (for example `shareKey`) and set a long random value (at least 32 bytes) on every stage.
2. Pass `await c.var.secrets.get("shareKey")` as the key. Keep subjects free of `.` (use an `id()` value).
3. Answer `null` from `verifyToken` with `HTTP.NOT_FOUND`, so an invalid link looks like a missing one.
4. Test expiry with the test runner's fake timers, as `signing.test.ts` does (see [testing.md](testing.md)).

## Examples

- [examples/secrets.md](../examples/secrets.md): declaring `apiKey`, an admin route that reports whether it is set without revealing it, the tested HMAC token helper (`signing.ts` and its tests), and Web-API-only byte helpers with `crypto.subtle.digest`.

## Stopping condition

Stop reading when every secret is declared in `secrets`, read only through `c.var.secrets.get`, never returned or logged, set on each stage with `secrets set`, given a value in tests, and `npx prototype-framework verify` passes.
