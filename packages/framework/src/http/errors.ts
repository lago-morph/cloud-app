/**
 * HTTP error responses (HTTP-REQ-001, HTTP-REQ-002, HTTP-REQ-005; http.md §2 "Error handler").
 */
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { TrieRouter } from "hono/router/trie-router";
import type { RouterRoute } from "hono/types";
import { errorCode, errorLogMessage, errorStatus } from "../core/error-handler.js";
import { ERROR_CATALOGUE, FrameworkError, type ErrorCode, type ErrorResponseBody } from "../core/errors.js";
import type { LogService } from "../log/public.js";

/** An `ErrorResponse` with the catalogue status for `code`, the request's ID, and `no-store`. */
export function errorResponse(c: Context, code: ErrorCode, message: string = ERROR_CATALOGUE[code].meaning): Response {
  const body: ErrorResponseBody = { error: { code, message, requestId: (c.get("requestId") as string | undefined) ?? "" } };
  c.header("Cache-Control", "no-store");
  return c.json(body, errorStatus(code));
}

/** Secret values known to the request (SEC supplies them); never echoed or logged. */
export type SecretValues = (c: Context) => Iterable<string>;

/** `text` with every non-empty known secret value replaced by `[redacted]`. */
export function redact(text: string, secrets: Iterable<string>): string {
  const values = [...new Set(secrets)].filter((v) => v !== "").sort((a, b) => b.length - a.length);
  return values.reduce((out, value) => out.split(value).join("[redacted]"), text);
}

/**
 * The route path for log entries: the pattern of the matched route (`/api/notes/:id`), so path
 * values such as IDs or tokens are not logged; the plain path (never the query) when no route
 * matched.
 */
export function routePath(c: Context): string {
  const route = matchedRoutes(c).findLast((r) => r.method !== "ALL");
  return route?.path ?? c.req.path;
}

/** The HTTP-REQ-007 entry: method, route path, code, then the error's name, message and stack. */
function logMessage(c: Context, code: ErrorCode, thrown: unknown): string {
  const coreMessage = errorLogMessage(c, code, thrown);
  // CORE's message starts with "<METHOD> <path> failed with"; HTTP logs the route path instead.
  return `${c.req.method} ${routePath(c)}${coreMessage.slice(`${c.req.method} ${c.req.path}`.length)}`;
}

/**
 * The error handler (http.md §2): a `FrameworkError` becomes an `ErrorResponse` with its
 * catalogue status, anything else 500 `CORE.INTERNAL`. Responses with status below 500 keep
 * a `FrameworkError`'s own message; 500 and above give only the catalogue meaning, so
 * provider text and wiring details never leave the server. Known secret values are redacted.
 */
export function createErrorHandler(options: { readonly secretValues?: SecretValues } = {}): ErrorHandler {
  return (thrown, c) => {
    const code = errorCode(thrown);
    const status = errorStatus(code);
    const secrets = [...(options.secretValues?.(c) ?? [])];
    if (status >= 500) {
      const log = c.get("log") as LogService | undefined;
      log?.write(code.slice(0, code.indexOf(".")), "error", redact(logMessage(c, code, thrown), secrets));
    }
    const own = status < 500 && thrown instanceof FrameworkError && thrown.message !== "" ? thrown.message : undefined;
    return errorResponse(c, code, own === undefined ? undefined : redact(own, secrets));
  };
}

/**
 * Hono calls the not-found handler both for unknown paths and for known paths with another
 * method. `routes` (the assembled app's, read per call) tells them apart: a path some route
 * registers for another method is 405 `HTTP.METHOD_NOT_ALLOWED` with `Allow`; anything else
 * is 404 `HTTP.NOT_FOUND`. Middleware (method `ALL`) does not count as a route.
 */
export function createNotFoundHandler(routes: () => readonly RouterRoute[]): NotFoundHandler {
  let indexed: { count: number; router: TrieRouter<true>; methods: string[] } | undefined;
  const index = () => {
    const list = routes().filter((r) => r.method !== "ALL");
    if (indexed?.count !== list.length) {
      const router = new TrieRouter<true>();
      for (const r of list) router.add(r.method, r.path, true);
      indexed = { count: list.length, router, methods: [...new Set(list.map((r) => r.method))].sort() };
    }
    return indexed;
  };
  return (c) => {
    const { router, methods } = index();
    const allowed = methods.filter((m) => router.match(m, c.req.path)[0].length > 0);
    if (allowed.length === 0) return errorResponse(c, "HTTP.NOT_FOUND");
    c.header("Allow", allowed.join(", "));
    return errorResponse(c, "HTTP.METHOD_NOT_ALLOWED");
  };
}
