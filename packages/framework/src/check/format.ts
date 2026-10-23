/**
 * Diagnostic text (CHECK-REQ-003): one line per diagnostic naming the file and position, the
 * offending construct (in the message), the rule, and the skill reference to read.
 */
import type { CheckDiagnostic } from "./engine.js";
import { MIGRATION_CHECKS } from "./migrations/diagnostic.js";
import { PLUGIN_NAME } from "./rule-names.js";

const MIGRATION_RULES: ReadonlySet<string> = new Set(MIGRATION_CHECKS.map((check) => `${PLUGIN_NAME}/${check}`));

function counted(count: number, kind: string): string {
  return `${String(count)} ${kind} problem${count === 1 ? "" : "s"}`;
}

export function formatDiagnostic(d: CheckDiagnostic): string {
  const message = d.message.replace(/\s*\r?\n\s*/g, " ");
  return `${d.file}:${String(d.line)}:${String(d.column)}  error  ${message}  ${d.rule}  (read ${d.reference})`;
}

/**
 * All diagnostics, one per line, followed by a count line naming each kind present
 * ("2 portability problems", "1 migration problem", or both); empty text when there are none.
 */
export function formatDiagnostics(diagnostics: readonly CheckDiagnostic[]): string {
  if (diagnostics.length === 0) return "";
  const migration = diagnostics.filter((d) => MIGRATION_RULES.has(d.rule)).length;
  const portability = diagnostics.length - migration;
  const counts = [...(portability > 0 ? [counted(portability, "portability")] : []), ...(migration > 0 ? [counted(migration, "migration")] : [])];
  return [...diagnostics.map(formatDiagnostic), counts.join(", ")].join("\n");
}
