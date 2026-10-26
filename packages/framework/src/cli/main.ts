/**
 * The command table and dispatch of the package binary (CLI-REQ-001, CLI-REQ-003).
 * Exit statuses: 0 success, 1 failure, 2 usage error.
 */

import { UsageError } from "./args.js";
import { describeFailure } from "./failure.js";
import { EXIT, type CliIo, type Command } from "./io.js";
import { buildBinding, cloud, cloudflareSetupBinding, devBinding, generateMigrationBinding, mailBinding, resetLocalBinding, secretsBinding, upgradeBinding, verifyBinding, versionCheckBinding } from "./wiring.js";

export { EXIT, type CliIo, type Command } from "./io.js";

export interface Entry {
  readonly summary: string;
  readonly run: Command;
}

/** `smoke` (C-04; never loads Vitest's Node API for other commands), with the cloud process check (D-05) in front. */
const smokeBinding: Command = cloud("smoke", async (env) => {
  const [{ smokeBinding: smoke }, { withCloudProcessCheck }] = await Promise.all([import("./commands/smoke.js"), import("./commands/smoke-cloud.js")]);
  return withCloudProcessCheck(await smoke(), env);
});

/** The cloud commands (D-05), each bound through `cloud` (`.env.cloudflare`, DEC-0570). */
const deployBinding: Command = cloud("deploy", async (env) => (await import("./commands/deploy.js")).deployBinding(env));
const removeBinding: Command = cloud("remove", async (env) => (await import("./commands/remove.js")).removeBinding(env));
const stopBinding: Command = cloud("stop", async (env) => (await import("./commands/stop-start.js")).stopBinding(env));
const startBinding: Command = cloud("start", async (env) => (await import("./commands/stop-start.js")).startBinding(env));
const setupAccountBinding: Command = cloud("setup-account", async (env) => (await import("./commands/setup-account.js")).setupAccountBinding(env));
/** `check-login` (PWD §2): the real login provider on a production stage, with the mail sink. */
const checkLoginBinding: Command = cloud("check-login", async (env) => (await import("./commands/check-login.js")).checkLoginBinding(env));
/** `admins` (CLI-REQ-005): the local D1, or the D1 HTTP API on Cloudflare. */
const adminsBinding: Command = cloud("admins", async (env) => (await import("./commands/admins.js")).adminsBinding(env));

const COMMANDS: Readonly<Record<string, Entry>> = {
  dev: { summary: "run the app locally on http://localhost:<port>", run: devBinding },
  verify: { summary: "the pre-completion verification (offline)", run: verifyBinding },
  "generate-migration": { summary: "generate-migration [--name <slug>]: the next migration pair from the table definitions", run: generateMigrationBinding },
  build: { summary: "build --target <t> --stage <s>: build a deployment without deploying it", run: buildBinding },
  deploy: { summary: "deploy --target <t> --stage <s> [--start]: deploy a stage (a stopped stage stays stopped unless --start)", run: deployBinding },
  smoke: { summary: "smoke --target <t> --stage <s>: run the app's smoke tests against a stage", run: smokeBinding },
  remove: { summary: "remove --target <t> --stage <s> [--confirm-production <s>]: remove a stage (a production stage is backed up first)", run: removeBinding },
  stop: { summary: "stop --target <t> --stage <s>: stop a stage; deploy leaves it stopped", run: stopBinding },
  start: { summary: "start --target <t> --stage <s>: start a stopped stage", run: startBinding },
  secrets: { summary: "secrets set <name> --target <t> --stage <s>: set a secret from standard input", run: secretsBinding },
  "setup-account": { summary: "setup-account --target <t>: one-time account setup", run: setupAccountBinding },
  "cloudflare-setup": { summary: "cloudflare-setup [--email-domain <d>] [--switch-account]: the re-runnable Cloudflare setup (tokens, account, email domain)", run: cloudflareSetupBinding },
  "check-login": { summary: "check-login --target <t> --stage <s>: automated real-login check on a production stage", run: checkLoginBinding },
  "reset-local": { summary: "clear local state (local D1, R2, .logs/ and .mail/)", run: resetLocalBinding },
  mail: { summary: "mail last --to <address> [--target <t>]: print the latest framework email sent to an address", run: mailBinding },
  admins: { summary: "admins grant <email> | revoke <email> | list --target <t> --stage <s> [--confirm-production <s>]: the admin role", run: adminsBinding },
  "version-check": { summary: "compare the app's framework, its skill copies and npm's latest release; changes nothing", run: versionCheckBinding },
  upgrade: { summary: "upgrade [<version>]: move the app to a framework release (default: latest), refresh its skill copy and verify", run: upgradeBinding },
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
