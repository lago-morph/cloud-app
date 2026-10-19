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
  const stack = error.stack ?? `${error.name}: ${error.message}`;
  return `${c.req.method} ${c.req.path} failed with ${code}\n${stack.startsWith(error.name) ? stack : `${error.name}: ${error.message}\n${stack}`}`;
}

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
