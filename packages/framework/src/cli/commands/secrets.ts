/**
 * `secrets set <name> --target <t> --stage <s>` (CLI-REQ-001, SEC-REQ-004): the value comes
 * from standard input only, through SEC's `set-command.ts`; no output ever contains it
 * (CLI-REQ-004). Locally the value goes to `<app>/.dev.vars` as `SECRET_<NAME>`; the stage is
 * accepted but unused locally (one `.dev.vars`, DEC-0158). The Cloudflare store is
 * D-05's.
 */
import { secretLocation } from "../../config/secret-locations.js";
import { checkSettableName, parseSecretsSetArgs, readSecretValue, SecretsSetUsageError } from "../../secrets/set-command.js";
import { UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";

export interface SecretsDeps {
  /** The secret names the app in `appDir` declares. */
  loadDeclaredSecrets(appDir: string): Promise<readonly string[]>;
  setLocalSecret(appDir: string, name: string, value: string): Promise<void>;
}

/** SEC's usage errors become the CLI's (exit 2); their messages never contain an argument. */
async function usage<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SecretsSetUsageError) throw new UsageError(error.message);
    throw error;
  }
}

export function secretsCommand(deps: SecretsDeps): Command {
  return async (args, io) => {
    const [sub, ...rest] = args;
    if (sub !== "set") throw new UsageError("the only secrets subcommand is: secrets set <name> --target <t> --stage <s> (value on standard input)");
    const { name, target } = await usage(() => parseSecretsSetArgs(rest));
    if (target !== "local") {
      io.stderr(`secrets set --target ${target} is not available yet: it requires the Cloudflare provisioning operations (work item D-05)\n`);
      return EXIT.failed;
    }
    const declared = await deps.loadDeclaredSecrets(io.cwd);
    await usage(() => checkSettableName(name, declared));
    const value = await usage(() => readSecretValue(io.stdin));
    await deps.setLocalSecret(io.cwd, name, value);
    io.stdout(`set secret ${name} for target local as ${secretLocation("local", name)} in .dev.vars\n`);
    return EXIT.ok;
  };
}
