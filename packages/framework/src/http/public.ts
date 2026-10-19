/**
 * HTTP public names, server side (contract: docs/contracts/ts/http.d.ts).
 * Stub written by B-01; implemented by B-03.
 */
import type { Env, MiddlewareHandler } from "hono";
import type { z } from "zod";

/** Zod, re-exported at the framework's pinned version (PAR-112). */
export { z } from "zod";

/** Validates the JSON request body against `schema` before the handler runs. */
export function jsonBody<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { json: z.input<T> }; out: { json: z.output<T> } }> {
  throw new Error("not implemented: jsonBody");
}

/** Validates query parameters likewise; parsed value via `c.req.valid("query")`. */
export function queryParams<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { query: z.input<T> }; out: { query: z.output<T> } }> {
  throw new Error("not implemented: queryParams");
}
