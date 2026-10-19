/**
 * Local log storage (LOG-REQ-003, DEC-0066). Worker code cannot write files under workerd, so
 * the Worker prints each entry as one marked line on its output; the CLI's `dev` command, which
 * owns the Wrangler process, picks those lines out (`capture.ts`) and appends them to `.logs/`.
 */
import type { LogEntry } from "./entry.js";
import type { LogSink } from "./writer.js";

/** Starts every log line on the Worker's output. Printable, and unlikely in app output. */
export const LOG_LINE_MARKER = "[prototype-framework:log] ";

/** One marked line: the marker, then the entry's JSON (JSON escapes line breaks). */
export function formatLogLine(entry: LogEntry): string {
  return LOG_LINE_MARKER + JSON.stringify(entry);
}

/** The local Worker's sink: prints each entry as a marked line (default `console.log`). */
export function workerOutputSink(print: (line: string) => void = (line) => console.log(line)): LogSink {
  return (entry) => print(formatLogLine(entry));
}
