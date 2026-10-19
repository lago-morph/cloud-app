/**
 * The log writer behind `log.write` (LOG-REQ-001, LOG-REQ-002). A target runtime creates one per
 * request (CORE's `createLog` slot) with a sink that stores entries for that target.
 */
import { buildEntry, type EntryContext, type LogEntry } from "./entry.js";
import type { LogService } from "./public.js";

/** Where entries go. May return a promise; the writer never waits for it. */
export type LogSink = (entry: LogEntry) => void | PromiseLike<void>;

function ignore(): void {}

export function createLogWriter(context: EntryContext, sink: LogSink): LogService {
  return {
    write(component, severity, message) {
      // LOG-REQ-001: never throws, never waits, and a failed write never fails the caller.
      try {
        const pending = sink(buildEntry(context, component, severity, message));
        if (pending !== undefined && typeof pending.then === "function") pending.then(undefined, ignore);
      } catch {
        // A failed write is dropped.
      }
    },
  };
}
