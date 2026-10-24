/**
 * LOG public names (contract: docs/contracts/ts/log.d.ts). Types only.
 * Written by B-01; the implementation is B-04's.
 */

export type Severity = "debug" | "info" | "warn" | "error";

export interface LogService {
  /** Records one entry. Never throws and never fails the calling operation. */
  write(component: string, severity: Severity, message: string): void;
}
