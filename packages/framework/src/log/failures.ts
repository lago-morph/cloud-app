/**
 * Framework failures are logged (LOG-REQ-005, HTTP-REQ-007). `logFailure` is the one way the
 * framework records an uncaught error (`CORE.INTERNAL`) or a `*.UNAVAILABLE` failure: adapters
 * call it when they raise `*.UNAVAILABLE` (so a failure the app catches is still logged), and
 * the HTTP error handler calls it for every response with status 500 or above. Each error
 * object is logged once, so a failure reported by both leaves exactly one `error` entry.
 */
import { asError, errorCode } from "../core/error-handler.js";
import type { LogService } from "./public.js";
import { requestOf } from "./writer.js";

const logged = new WeakSet<object>();

/** True once `error` has been written by `logFailure`. */
export function wasLogged(error: unknown): boolean {
  return typeof error === "object" && error !== null && logged.has(error);
}

/**
 * Writes one `error` entry for `thrown`, with component = its code's owning component
 * (`CORE.INTERNAL` for anything that is not a `FrameworkError`), and message
 * `<METHOD> <path> failed with <code>` (method and path only for a request's writer), then the
 * error's name, message and stack. Never throws.
 */
export function logFailure(log: LogService, thrown: unknown): void {
  try {
    if (wasLogged(thrown)) return;
    const code = errorCode(thrown);
    const error = asError(thrown);
    const request = requestOf(log);
    const heading = `${error.name}: ${error.message}`;
    // V8 writes the name current at construction into the stack; FrameworkError sets it later.
    const stack = error.stack === undefined ? heading : error.stack.startsWith(heading) ? error.stack : `${heading}\n${error.stack}`;
    const where = request === undefined ? "" : `${request.method} ${request.path} `;
    if (typeof thrown === "object" && thrown !== null) logged.add(thrown);
    log.write(code.slice(0, code.indexOf(".")), "error", `${where}failed with ${code}\n${stack}`);
  } catch {
    // LOG-REQ-001: logging never fails the caller.
  }
}
