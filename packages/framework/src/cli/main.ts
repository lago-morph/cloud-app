/**
 * The command table and dispatch of the package binary (CLI-REQ-001, CLI-REQ-003).
 * Exit statuses: 0 success, 1 failure, 2 usage error.
 */

import { UsageError } from "./args.js";
import { describeFailure } from "./failure.js";
import { EXIT, type CliIo, type Command } from "./io.js";
import { buildBinding, devBinding, generateMigrationBinding, resetLocalBinding, secretsBinding, verifyBinding } from "./wiring.js";

export { EXIT, type CliIo, type Command } from "./io.js";

export interface Entry {
  readonly summary: string;
  readonly run: Command;
}

/** A command whose implementation belongs to a later work item: fails naming what it needs. */
function notYet(prerequisite: string): Command {
  return async (_args, io) => {
    io.stderr(`this command is not available yet: it requires ${prerequisite}\n`);
    return EXIT.failed;
  };
}

const COMMANDS: Readonly<Record<string, Entry>> = {
  dev: { summary: "run the app locally on http://localhost:<port>", run: devBinding },
  verify: { summary: "the pre-completion verification (offline)", run: verifyBinding },
  "generate-migration": { summary: "generate-migration [--name <slug>]: the next migration pair from the table definitions", run: generateMigrationBinding },
  build: { summary: "build --target <t> --stage <s>: build a deployment without deploying it", run: buildBinding },
  deploy: { summary: "deploy --target <t> --stage <s>: deploy a stage", run: notYet("the Cloudflare provisioning operations (work item D-05)") },
  smoke: { summary: "smoke --target <t> --stage <s>: run the app's smoke tests against a stage", run: notYet("the smoke runner (work items C-04, D-05)") },
  remove: { summary: "remove --target <t> --stage <s>: remove a stage", run: notYet("the Cloudflare provisioning operations (work item D-05)") },
  secrets: { summary: "secrets set <name> --target <t> --stage <s>: set a secret from standard input", run: secretsBinding },
  "setup-account": { summary: "setup-account --target <t>: one-time account setup", run: notYet("the Cloudflare provisioning operations (work item D-05)") },
  "certify-auth": { summary: "certify-auth --target <t> --stage <s>: guided login-provider certification", run: notYet("a deployed production stage with a Google client (work item D-05)") },
  "reset-local": { summary: "clear local state (local D1, R2 and .logs/)", run: resetLocalBinding },
};

export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

function usage(): string {
  const width = Math.max(...COMMAND_NAMES.map((n) => n.length));
  return ["usage: prototype-framework <command> [options]", "", "commands:", ...COMMAND_NAMES.map((n) => `  ${n.padEnd(width)}  ${COMMANDS[n]?.summary ?? ""}`)].join("\n") + "\n";
}

export type CommandTable = Readonly<Record<string, Entry>>;

export { describeFailure };

export async function runCommand(argv: readonly string[], io: CliIo, table: CommandTable = COMMANDS): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined) {
    io.stderr(usage());
    return EXIT.usage;
  }
  const entry = Object.hasOwn(table, name) ? table[name] : undefined;
  if (entry === undefined) {
    io.stderr(`unknown command ${JSON.stringify(name)}\n${usage()}`);
    return EXIT.usage;
  }
  try {
    return await entry.run(args, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${name}: ${error.message}\n`);
      return EXIT.usage;
    }
    io.stderr(`${name} failed: ${describeFailure(error)}\n`);
    return EXIT.failed;
  }
}
