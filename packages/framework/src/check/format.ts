/**
 * Diagnostic text (CHECK-REQ-003): one line per diagnostic naming the file and position, the
 * offending construct (in the message), the rule, and the skill reference to read.
 */
import type { CheckDiagnostic } from "./engine.js";

export function formatDiagnostic(d: CheckDiagnostic): string {
  const message = d.message.replace(/\s*\r?\n\s*/g, " ");
  return `${d.file}:${String(d.line)}:${String(d.column)}  error  ${message}  ${d.rule}  (read ${d.reference})`;
}

/** All diagnostics, one per line, followed by a count line; empty text when there are none. */
export function formatDiagnostics(diagnostics: readonly CheckDiagnostic[]): string {
  if (diagnostics.length === 0) return "";
  const count = diagnostics.length;
  return [...diagnostics.map(formatDiagnostic), `${String(count)} portability problem${count === 1 ? "" : "s"}`].join("\n");
}
