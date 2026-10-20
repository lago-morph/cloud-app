/**
 * The Cloudflare log sink (LOG-REQ-001, LOG-REQ-004; log.md §2 "Cloudflare"): each entry is one
 * JSON object in the account's shared log bucket (`prototype-logs`), reached through the Worker's
 * R2 write binding, under the key of `keys.ts`. The write is handed to the request's `waitUntil`,
 * so the response never waits for it; a failed write is dropped. Without the binding (a
 * misconfigured Worker) entries are printed as marked Worker output lines, as locally, so they
 * still show in the Worker's logs and the request is unaffected. Workers-compatible.
 */
import type { LogEntry } from "../entry.js";
import { formatLogLine } from "../local.js";
import type { LogSink } from "../writer.js";
import { logObjectKey } from "./keys.js";

/** The part of an R2 bucket binding the sink uses. */
export interface LogBucket {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface R2LogSinkOptions {
  /** The log bucket binding from the Worker env; undefined when the Worker has none. */
  readonly bucket: LogBucket | undefined;
  /** The request's `ctx.waitUntil`. */
  readonly waitUntil: (pending: Promise<unknown>) => void;
  /** Where entries go without a bucket binding (default `console.log`). */
  readonly print?: (line: string) => void;
  /** Random final key part for entries without a request ID (tests). */
  readonly random?: () => string;
}

function ignore(): void {}

export function r2LogSink(options: R2LogSinkOptions): LogSink {
  const { bucket, waitUntil } = options;
  const print = options.print ?? ((line: string) => console.log(line));
  return (entry: LogEntry) => {
    if (bucket === undefined) {
      print(formatLogLine(entry));
      return;
    }
    let write: Promise<void>;
    try {
      const key = logObjectKey(entry, options.random);
      write = Promise.resolve(bucket.put(key, JSON.stringify(entry), { httpMetadata: { contentType: "application/json" } })).then(ignore, ignore);
    } catch {
      return; // A failed write is dropped (LOG-REQ-001).
    }
    try {
      waitUntil(write);
    } catch {
      // No execution context: the write still runs, unawaited.
    }
  };
}
