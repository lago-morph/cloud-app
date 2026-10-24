/**
 * Deferred wiring checks (core.md §2): adapters and the assembler check bindings, environment
 * variables and the embedded identity on the first request, never at module load, and raise
 * CORE.MISCONFIGURED there.
 */
import { FrameworkError } from "./errors.js";

/**
 * Wraps `check` so it runs on first use, not when created. A success is remembered; a failure
 * is not (the next request checks again). A `FrameworkError` passes through; any other failure
 * becomes CORE.MISCONFIGURED with the same message.
 */
export function deferredCheck<T>(check: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      try {
        value = check();
      } catch (err) {
        if (err instanceof FrameworkError) throw err;
        throw new FrameworkError("CORE.MISCONFIGURED", err instanceof Error ? err.message : String(err));
      }
      done = true;
    }
    return value;
  };
}
