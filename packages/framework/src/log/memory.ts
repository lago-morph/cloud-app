/**
 * In-memory log storage for `createTestApp` (log.md "Local", testing.d.ts `TestApp.logs()`):
 * entries are kept in order, and `error` entries are echoed to stderr as they are written.
 * Runs in the test runner's Node process only.
 */
import type { LogEntry } from "./entry.js";
import type { LogSink } from "./writer.js";

export interface MemorySink {
  readonly sink: LogSink;
  /** Entries written so far, in order (a frozen snapshot). */
  entries(): readonly LogEntry[];
}

/** `echo` receives each `error` entry as one JSON line; default: stderr. */
export function createMemorySink(echo: (line: string) => void = (line) => void process.stderr.write(`${line}\n`)): MemorySink {
  const kept: LogEntry[] = [];
  return {
    sink(entry) {
      kept.push(entry);
      if (entry.severity === "error") echo(JSON.stringify(entry));
    },
    entries: () => Object.freeze([...kept]),
  };
}
