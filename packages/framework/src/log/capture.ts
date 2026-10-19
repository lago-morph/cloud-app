/**
 * Capturing the local Worker's log lines into `.logs/<yyyy-mm-dd>.log` (LOG-REQ-003, DEC-0066).
 * The CLI's `dev` command (B-17) feeds Wrangler's output through `createLogCapture` and supplies
 * the file append; this module does no I/O.
 */
import { isLogEntry, type LogEntry } from "./entry.js";
import { LOG_LINE_MARKER } from "./local.js";

/** The entry in a marked output line, or undefined for any other line. */
export function parseLogLine(line: string): LogEntry | undefined {
  const at = line.indexOf(LOG_LINE_MARKER);
  if (at < 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(at + LOG_LINE_MARKER.length).trimEnd());
  } catch {
    return undefined;
  }
  return isLogEntry(value) ? value : undefined;
}

/** The app-relative file an entry belongs in: its UTC day. */
export function logFilePath(entry: LogEntry): string {
  return `.logs/${entry.time.slice(0, 10)}.log`;
}

export interface LogCaptureIo {
  /** Appends `text` to the app-relative file `path` (creating `.logs/` as needed). */
  append(path: string, text: string): void;
  /** Receives every output line that is not a log line. */
  other(line: string): void;
}

export interface LogCapture {
  /** Feeds a chunk of the Worker's output; complete lines are handled at once. */
  push(chunk: string): void;
  /** Handles a final line without a newline. */
  end(): void;
}

export function createLogCapture(io: LogCaptureIo): LogCapture {
  let partial = "";
  const handle = (line: string): void => {
    const entry = parseLogLine(line);
    if (entry === undefined) io.other(line.endsWith("\r") ? line.slice(0, -1) : line);
    else io.append(logFilePath(entry), `${JSON.stringify(entry)}\n`);
  };
  return {
    push(chunk) {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) handle(line);
    },
    end() {
      if (partial !== "") handle(partial);
      partial = "";
    },
  };
}
