/**
 * Core error handling (CORE-REQ-004, core.md §2 "Errors"): the default for the HTTP
 * error-handler slot of `assembleApp`.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { LogService } from "../log/public.js";
import { ERROR_CATALOGUE, FrameworkError, type ErrorCode, type ErrorResponseBody } from "./errors.js";

/** A thrown value that is not an `Error`, wrapped so it can be handled and logged like one. */
export class ThrownValue extends Error {
  constructor(readonly value: unknown) {
    super(String(value));
    this.name = "ThrownValue";
  }
}

/** Any thrown value as an `Error` (non-`Error` values become `ThrownValue`). */
export function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new ThrownValue(thrown);
}

/** The code a thrown value surfaces as: its own for `FrameworkError`, else `CORE.INTERNAL`. */
export function errorCode(thrown: unknown): ErrorCode {
  return thrown instanceof FrameworkError ? thrown.code : "CORE.INTERNAL";
}

/** The catalogue status for `code`; browser-only codes (status null) never reach HTTP and map to 500. */
export function errorStatus(code: ErrorCode): ContentfulStatusCode {
  return (ERROR_CATALOGUE[code].status ?? 500) as ContentfulStatusCode;
}

/** One `error` entry for a failed request: method, path (no query), code, and the error's name, message and stack. */
export function errorLogMessage(c: Context, code: ErrorCode, thrown: unknown): string {
  const error = asError(thrown);
  const heading = `${error.name}: ${error.message}`;
  // V8 writes the name current at construction into the stack, so subclasses that set `name`
  // afterwards (FrameworkError) start with "Error:"; put the real heading first then.
  const stack = error.stack === undefined ? heading : error.stack.startsWith(heading) ? error.stack : `${heading}\n${error.stack}`;
  return `${c.req.method} ${c.req.path} failed with ${code}\n${stack}`;
}

/**
 * Default HTTP error handler. A `FrameworkError` becomes an `ErrorResponse` with its catalogue
 * status; anything else becomes 500 CORE.INTERNAL with the catalogue meaning as its message, the
 * original error going only to the log. Every response with status 500 or above leaves exactly
 * one `error` entry, with component set to the code's owning component (LOG-REQ-005). The path
 * is logged without the query string (HTTP-REQ-007). B-03 may supply a fuller handler in its slot.
 */
export function coreErrorHandler(thrown: unknown, c: Context): Response {
  const code = errorCode(thrown);
  const status = errorStatus(code);
  if (status >= 500) {
    const log = c.get("log") as LogService | undefined;
    log?.write(code.slice(0, code.indexOf(".")), "error", errorLogMessage(c, code, thrown));
  }
  const message = thrown instanceof FrameworkError && thrown.message !== "" ? thrown.message : ERROR_CATALOGUE[code].meaning;
  const body: ErrorResponseBody = { error: { code, message, requestId: c.get("requestId") ?? "" } };
  return c.json(body, status);
}
