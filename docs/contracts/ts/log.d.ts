/**
 * Log (LOG). Behavior: docs/components/log.md.
 * Stored entry format: contracts/schemas/log-entry.schema.json.
 */

export type Severity = "debug" | "info" | "warn" | "error";

export interface LogService {
  /** Records one entry. Never throws and never fails the calling operation. */
  write(component: string, severity: Severity, message: string): void;
}
