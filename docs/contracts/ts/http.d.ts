/**
 * HTTP and hosting (HTTP), server side. Behavior: docs/components/http.md.
 * Browser API helper: client.d.ts. Error response format: errors.d.ts and
 * contracts/http/framework.openapi.yaml.
 */
import type { Env, MiddlewareHandler } from "hono";
import type { z } from "zod";

/** Zod, re-exported so app code has one validation library at the framework's pinned version. */
export { z } from "zod";

/**
 * Validates the JSON request body against `schema` before the handler runs. Rejects
 * with HTTP.INVALID_INPUT or HTTP.PAYLOAD_TOO_LARGE. The parsed value is available via
 * `c.req.valid("json")`.
 */
export declare function jsonBody<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { json: z.input<T> }; out: { json: z.output<T> } }>;

/** Validates query parameters likewise; parsed value via `c.req.valid("query")`. */
export declare function queryParams<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { query: z.input<T> }; out: { query: z.output<T> } }>;
