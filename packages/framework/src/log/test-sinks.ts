/**
 * Log writers that fail, for tests (LOG-AC-001: "an injected log writer that fails and one that
 * never completes"). Framework-internal; B-16 decides how tests inject them.
 */
import type { LogSink } from "./writer.js";

/** A sink that fails on every write: throws, or with `"reject"` returns a rejected promise. */
export function failingSink(mode: "throw" | "reject" = "throw"): LogSink {
  return () => {
    const error = new Error("injected log writer failure");
    if (mode === "reject") return Promise.reject(error);
    throw error;
  };
}

/** A sink whose writes never complete. */
export function neverCompletingSink(): LogSink {
  return () => new Promise<void>(() => undefined);
}
