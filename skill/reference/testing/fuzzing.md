# Fuzzing a route input

Read this when a route takes input at a trust boundary (a name, a cursor, a return path, a code or token, a request body) and its example tests keep missing cases, or the same route has failed more than once.

## Where it is worth it

Fuzzing is **local, limited and targeted**. Use it only where it finds what example tests would miss:

- a parser, validator or encoder at a trust boundary;
- especially a route with repeated failures (see its records under `test-records/root-causes/`).

Having a zod schema makes a route eligible, not required. Never fuzz every route, never run long or exhaustive runs, and never fuzz a deployed stage. Fuzzing never replaces the route's example tests ([../testing.md](../testing.md)).

## The template's helper

`tests/support/fuzz.ts` drives a route from its zod schema with the `fast-check` package (pinned in the template's `package.json`): it sends generated bodies, both valid and invalid for the schema, and checks that the route never answers a server error, answers 400 `HTTP.INVALID_INPUT` when the schema rejects the body, and never answers it when the schema accepts the body (the route's own rules may still refuse it, for example with 404 or 409). Each use states its run count and fixed seed, with a one-line reason, so a run is small and repeatable and adds only seconds to `verify`. See `tests/fuzz.test.ts` for the template's one use.

## A finding

A failing run prints the seed and the smallest body that fails. Treat it as any failure ([failures.md](failures.md)), and add that body as a plain example test before the fix.

## Examples

- [examples/tests.md](../../examples/tests.md): the in-process tests the helper runs beside.

## Stopping condition

Stop reading when you have decided the route does not qualify, or its fuzz test states its run count, seed and reason, passes in `npm run verify`, and any finding is a plain regression test.
