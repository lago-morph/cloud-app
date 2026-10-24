/**
 * CLI entry used by the package binary (bin/prototype-framework.js): CLI-REQ-001 commands,
 * honest exit statuses (CLI-REQ-003), no secret output (CLI-REQ-004). The working directory
 * is the app directory.
 */
import { runCommand } from "./main.js";

/** Runs one CLI command and resolves to the process exit status (CLI-REQ-003). */
export async function main(argv: readonly string[]): Promise<number> {
  return runCommand(argv, {
    cwd: process.cwd(),
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    stdin: process.stdin,
  });
}
