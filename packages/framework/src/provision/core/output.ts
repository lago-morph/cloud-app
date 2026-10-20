/** Output and exit statuses shared by the PROV core sequences (CLI-REQ-003, CLI-REQ-004). */
import { EXIT, type CliIo } from "../../cli/io.js";

/** Where a sequence prints: progress to stdout, failures to stderr. */
export type ProvisionIo = Pick<CliIo, "stdout" | "stderr">;

export type ProvisionStatus = typeof EXIT.ok | typeof EXIT.failed;

export { EXIT };

/** A thrown value's message only (never a stack, never the value of an argument). */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function line(io: ProvisionIo, text: string): void {
  io.stdout(`${text}\n`);
}

export function errorLine(io: ProvisionIo, text: string): void {
  io.stderr(`${text}\n`);
}
