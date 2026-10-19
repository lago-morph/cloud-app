/**
 * The log writer behind `log.write` (LOG-REQ-001, LOG-REQ-002). A target runtime creates one per
 * request (CORE's `createLog` slot) with a sink that stores entries for that target.
 */
import { buildEntry, type EntryContext, type LogEntry } from "./entry.js";
import type { LogService } from "./public.js";

/** Where entries go. May return a promise; the writer never waits for it. */
export type LogSink = (entry: LogEntry) => void | PromiseLike<void>;

function ignore(): void {}

/** The HTTP request a writer was created for (path without the query string). */
export interface RequestInfo {
  readonly method: string;
  readonly path: string;
}

export interface WriterContext extends EntryContext {
  /** Set for a writer created during an HTTP request; used by `logFailure`. */
  readonly request?: RequestInfo;
}

const requests = new WeakMap<LogService, RequestInfo>();

/** The request `log` was created for, when it is a writer created with one. */
export function requestOf(log: LogService): RequestInfo | undefined {
  return requests.get(log);
}

export function createLogWriter(context: WriterContext, sink: LogSink): LogService {
  const log: LogService = {
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
  if (context.request !== undefined) requests.set(log, { method: context.request.method, path: context.request.path });
  return log;
}
